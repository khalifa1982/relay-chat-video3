/* ──────────────────────────────────────────────────────────────────────────
 * Zero-dependency native S3 storage driver (v2.91).
 *
 * Why: the self-hosted `.io` deploy has no Manus Forge proxy, so attachments
 * need a first-party S3 (or R2/MinIO) backend. Following the repo's
 * zero-dependency pattern (server/smtp.ts raw-socket SMTP, server/fcm.ts
 * hand-rolled OAuth JWT), this module implements AWS Signature Version 4
 * with nothing but node:crypto:
 *
 *   - `s3Put`           — PUT an object (Authorization-header auth,
 *                         single-chunk payload, x-amz-content-sha256).
 *   - `s3PresignGetUrl` — presigned GET (query-string auth, X-Amz-* params,
 *                         UNSIGNED-PAYLOAD) for the /manus-storage proxy's
 *                         307 redirects.
 *
 * The signing core is PURE (deterministic given a clock) and is verified in
 * server/s3.test.ts against the OFFICIAL AWS SigV4 example vectors from the
 * Amazon S3 API Reference ("Authenticating Requests (AWS Signature
 * Version 4)"): the `examplebucket`/`test.txt` GET + PUT header examples and
 * the 86400s presigned-URL example, byte-for-byte.
 *
 * Config (read PER-CALL, like TURN_*, so ops can flip it
 * without a rebuild):
 *   S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET   — all four required
 *   S3_ENDPOINT           optional — non-AWS S3 (R2, MinIO, …)
 *   S3_FORCE_PATH_STYLE   optional — "1"/"true": https://endpoint/bucket/key
 *   S3_PREFIX             optional — key prefix, default "relay-chat/"
 *                         (ensure-style: a key that already starts with the
 *                         prefix is NOT double-prefixed — v2upload keys are
 *                         already namespaced `relay-chat/<identityId>/…`)
 *
 * When S3_* is absent, server/storage.ts falls back to the Manus Forge
 * presign flow — that's the `.org` deploy, byte-identical to before.
 * ────────────────────────────────────────────────────────────────────────── */
import crypto from "crypto";

export interface S3Config {
  bucket: string;
  region: string;
  accessKey: string;
  secret: string;
  /** Full origin, e.g. "https://<account>.r2.cloudflarestorage.com". */
  endpoint?: string;
  forcePathStyle: boolean;
  /** Normalized: no leading slash, trailing slash unless empty. */
  prefix: string;
}

/** Trim slashes; guarantee a single trailing "/" unless the prefix is empty. */
export function normalizeS3Prefix(raw: string): string {
  const p = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  return p ? `${p}/` : "";
}

/** Read the S3 driver config from env. Null (driver off) unless all four
 *  required vars are present. Read per-call so secrets can be added live. */
export function s3Config(): S3Config | null {
  const bucket = (process.env.S3_BUCKET || "").trim();
  const region = (process.env.S3_REGION || "").trim();
  const accessKey = (process.env.S3_ACCESS_KEY || "").trim();
  const secret = (process.env.S3_SECRET || "").trim();
  if (!bucket || !region || !accessKey || !secret) return null;
  /* THE ENDPOINT IS PARSED HERE, ONCE (v2.105.17), because `s3Config()` returning
     non-null is the backend SELECTOR — `storage.ts` commits to the S3 branch and never
     falls back to Forge. An unparsed endpoint therefore fails per REQUEST, in two ways
     that are both worse than an honest "driver off":
       • `S3_ENDPOINT=abc.r2.cloudflarestorage.com` — exactly how Cloudflare's dashboard
         presents it, with no scheme — throws `TypeError: Invalid URL` on every call,
         surfacing as a generic 500 that names neither S3 nor the variable.
       • `S3_ENDPOINT=minio:9000` — how MinIO endpoints are conventionally written — does
         NOT throw: `new URL()` accepts it as protocol "minio:", so nothing downstream
         ever speaks the scheme the operator meant.
     THE PROTOCOL CHECK IS WHAT CATCHES BOTH; the `!u.host` conjunct is measured to be
     UNREACHABLE and is said so rather than left reading as load-bearing. For a special
     scheme the WHATWG parser cannot yield an empty host: it either fails (`https://`,
     `https://:8080/x`) or promotes the first path segment (`https:///bucket` → host
     "bucket"). It is kept because this is a config gate and the conjunct costs nothing,
     but a mutation removing it SURVIVES by construction, not for want of a test. */
  const rawEndpoint = (process.env.S3_ENDPOINT || "").trim();
  let endpoint: string | undefined;
  if (rawEndpoint) {
    try {
      const u = new URL(rawEndpoint);
      if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.host) return null;
      endpoint = rawEndpoint;
    } catch {
      return null;
    }
  }
  return {
    bucket,
    region,
    accessKey,
    secret,
    endpoint,
    forcePathStyle: /^(1|true)$/i.test(process.env.S3_FORCE_PATH_STYLE || ""),
    // `??` not `||`: an explicit S3_PREFIX="" means "no prefix".
    prefix: normalizeS3Prefix(process.env.S3_PREFIX ?? "relay-chat/"),
  };
}

/* ── key hygiene ───────────────────────────────────────────────── */

/**
 * Sanitize a caller-supplied storage key: strip leading slashes, collapse
 * duplicate slashes, and REJECT traversal-looking segments outright. S3 keys
 * are a flat namespace ("../" has no meaning to S3 itself), but keys flow
 * back through /manus-storage/* URLs and the thumbKey ownership check, where
 * a ".." segment could confuse prefix matching — throw early instead.
 */
export function sanitizeS3Key(relKey: string): string {
  const key = relKey.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
  if (!key) throw new Error("S3 key is empty");
  if (key.length > 900) throw new Error("S3 key too long"); // S3 hard cap is 1024 bytes
  const segments = key.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    throw new Error(`Unsafe S3 key: ${relKey}`);
  }
  // Control chars break canonical-request signing and are never legitimate.
  if (/[\u0000-\u001f\u007f]/.test(key)) throw new Error("S3 key contains control characters");
  return key;
}

/**
 * Apply the configured prefix (ensure-style): sanitize, then prepend the
 * prefix unless the key already starts with it. With the default prefix
 * ("relay-chat/") the v2upload keys — already `relay-chat/<identityId>/…` —
 * come out byte-identical to the Forge backend's, so DB rows, thumbKey
 * ownership checks, and /manus-storage URLs are storage-agnostic.
 */
export function s3ObjectKey(cfg: Pick<S3Config, "prefix">, relKey: string): string {
  const key = sanitizeS3Key(relKey);
  if (!cfg.prefix || key.startsWith(cfg.prefix)) return key;
  return cfg.prefix + key;
}

/* ── SigV4 primitives (pure) ───────────────────────────────────── */

/** AWS UriEncode: RFC 3986 with uppercase hex; unreserved = A-Za-z0-9-._~ */
export function awsUriEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/** Encode an object-key path segment-wise ("/" preserved, never encoded). */
export function awsUriEncodePath(path: string): string {
  return path.split("/").map(awsUriEncode).join("/");
}

export function sha256Hex(data: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

/** Derive the SigV4 signing key: HMAC chain over date/region/service. */
export function sigV4SigningKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string
): Buffer {
  return hmac(hmac(hmac(hmac("AWS4" + secret, dateStamp), region), service), "aws4_request");
}

/** "20130524T000000Z" from a Date. */
export function toAmzDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Canonical query string: keys+values UriEncoded, sorted bytewise by key. */
export function canonicalQueryString(query: Record<string, string>): string {
  return Object.entries(query)
    .map(([k, v]) => [awsUriEncode(k), awsUriEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export interface CanonicalParts {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  /** Already URI-encoded absolute path, starting with "/". */
  canonicalUri: string;
  /** Raw (unencoded) query params; encoded+sorted here. */
  query: Record<string, string>;
  /** Raw headers; lowercased, trimmed, space-collapsed, sorted here. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the payload, or "UNSIGNED-PAYLOAD". */
  payloadHash: string;
}

/** Build the SigV4 canonical request + the signed-headers list. */
export function buildCanonicalRequest(p: CanonicalParts): {
  canonicalRequest: string;
  signedHeaders: string;
} {
  const hdrs = Object.entries(p.headers)
    .map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s{2,}/g, " ")] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const canonicalHeaders = hdrs.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaders = hdrs.map(([k]) => k).join(";");
  const canonicalRequest = [
    p.method,
    p.canonicalUri,
    canonicalQueryString(p.query),
    canonicalHeaders,
    signedHeaders,
    p.payloadHash,
  ].join("\n");
  return { canonicalRequest, signedHeaders };
}

/** "AWS4-HMAC-SHA256\n<amzDate>\n<scope>\n<hex(sha256(canonicalRequest))>" */
export function buildStringToSign(
  amzDate: string,
  scope: string,
  canonicalRequest: string
): string {
  return ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
}

export interface SignedRequest {
  canonicalRequest: string;
  stringToSign: string;
  signedHeaders: string;
  scope: string;
  signature: string;
}

/** Full SigV4 computation for one request (pure; clock passed in). */
export function signRequest(
  creds: { accessKey: string; secret: string; region: string },
  parts: CanonicalParts,
  amzDate: string
): SignedRequest {
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${creds.region}/s3/aws4_request`;
  const { canonicalRequest, signedHeaders } = buildCanonicalRequest(parts);
  const stringToSign = buildStringToSign(amzDate, scope, canonicalRequest);
  const signature = crypto
    .createHmac("sha256", sigV4SigningKey(creds.secret, dateStamp, creds.region, "s3"))
    .update(stringToSign)
    .digest("hex");
  return { canonicalRequest, stringToSign, signedHeaders, scope, signature };
}

/* ── addressing ────────────────────────────────────────────────── */

export interface S3Address {
  protocol: "https:" | "http:";
  /** host[:port] */
  host: string;
  /** URI-encoded absolute path to the object, starting with "/". */
  pathEncoded: string;
}

/**
 * Resolve host + path for a (already-prefixed) object key.
 *   - AWS default:            https://<bucket>.s3.<region>.amazonaws.com/<key>
 *   - endpoint, virtual-host: https://<bucket>.<endpoint-host>/<key>
 *   - endpoint, path-style:   https://<endpoint-host>/<bucket>/<key>   (R2/MinIO)
 */
export function s3Address(
  cfg: Pick<S3Config, "bucket" | "region" | "endpoint" | "forcePathStyle">,
  key: string
): S3Address {
  const encKey = awsUriEncodePath(key);
  if (cfg.endpoint) {
    const u = new URL(cfg.endpoint);
    const protocol = u.protocol === "http:" ? "http:" : "https:";
    if (cfg.forcePathStyle) {
      return { protocol, host: u.host, pathEncoded: `/${cfg.bucket}/${encKey}` };
    }
    return { protocol, host: `${cfg.bucket}.${u.host}`, pathEncoded: `/${encKey}` };
  }
  return {
    protocol: "https:",
    host: `${cfg.bucket}.s3.${cfg.region}.amazonaws.com`,
    pathEncoded: `/${encKey}`,
  };
}

/* ── presigned GET (query-string auth) ─────────────────────────── */

/**
 * Pure presign core (host/path passed in) — unit-tested byte-for-byte against
 * the official AWS presigned-URL example. `s3PresignGetUrl` is the thin
 * config-resolving wrapper the app uses.
 */
export function presignGetCore(p: {
  protocol: "https:" | "http:";
  host: string;
  pathEncoded: string;
  accessKey: string;
  secret: string;
  region: string;
  expiresSeconds: number;
  now: Date;
}): string {
  const amzDate = toAmzDate(p.now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${p.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${p.accessKey}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(p.expiresSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  const signed = signRequest(
    { accessKey: p.accessKey, secret: p.secret, region: p.region },
    {
      method: "GET",
      canonicalUri: p.pathEncoded,
      query,
      headers: { host: p.host },
      payloadHash: "UNSIGNED-PAYLOAD",
    },
    amzDate
  );
  // X-Amz-Signature is appended AFTER the canonical (sorted) params — it is
  // never part of the canonical query string it signs.
  const qs = `${canonicalQueryString(query)}&X-Amz-Signature=${signed.signature}`;
  return `${p.protocol}//${p.host}${p.pathEncoded}?${qs}`;
}

/**
 * Presigned GET URL for an object key AS STORED (prefix already baked in at
 * upload time — read paths never re-prefix). Default 300s expiry comfortably
 * exceeds the storage proxy's 60s redirect cache.
 */
export function s3PresignGetUrl(
  cfg: S3Config,
  storedKey: string,
  expiresSeconds = 300,
  now: Date = new Date()
): string {
  const key = sanitizeS3Key(storedKey);
  const addr = s3Address(cfg, key);
  return presignGetCore({
    ...addr,
    accessKey: cfg.accessKey,
    secret: cfg.secret,
    region: cfg.region,
    expiresSeconds,
    now,
  });
}

/* ── PUT (Authorization-header auth, single chunk) ─────────────── */

/** Pure header builder for a PUT — exported for tests; s3Put does the fetch. */
export function buildPutHeaders(
  cfg: Pick<S3Config, "accessKey" | "secret" | "region">,
  addr: S3Address,
  payloadHash: string,
  amzDate: string
): Record<string, string> {
  const signed = signRequest(
    { accessKey: cfg.accessKey, secret: cfg.secret, region: cfg.region },
    {
      method: "PUT",
      canonicalUri: addr.pathEncoded,
      query: {},
      headers: {
        host: addr.host,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
      },
      payloadHash,
    },
    amzDate
  );
  return {
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${signed.scope},` +
      `SignedHeaders=${signed.signedHeaders},Signature=${signed.signature}`,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
}

/**
 * Upload `data` to `storedKey` (already prefixed via `s3ObjectKey`).
 * Content-Type is sent but deliberately NOT signed (SigV4 requires host +
 * x-amz-* signed; unsigned extras are allowed) — keeps the canonical request
 * minimal and byte-stable.
 */
export async function s3Put(
  cfg: S3Config,
  storedKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<void> {
  const key = sanitizeS3Key(storedKey);
  const body: Buffer = Buffer.isBuffer(data)
    ? data
    : typeof data === "string"
      ? Buffer.from(data)
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const addr = s3Address(cfg, key);
  const amzDate = toAmzDate(new Date());
  const headers = buildPutHeaders(cfg, addr, sha256Hex(body), amzDate);
  const url = `${addr.protocol}//${addr.host}${addr.pathEncoded}`;
  const resp = await fetch(url, {
    method: "PUT",
    headers: { ...headers, "Content-Type": contentType },
    body: body as unknown as BodyInit,
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`S3 PUT failed (${resp.status}): ${detail.slice(0, 300)}`);
  }
}
