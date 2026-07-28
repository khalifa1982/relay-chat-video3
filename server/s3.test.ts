/* ============================================================
   v2.91 — zero-dependency native S3 driver (SigV4).

   The signing core is verified against the OFFICIAL AWS Signature
   Version 4 example vectors from the Amazon S3 API Reference,
   "Authenticating Requests (AWS Signature Version 4)":

     • "Signature Calculations for the Authorization Header:
        Transferring Payload in a Single Chunk" — the
        `examplebucket` GET Object and PUT Object examples
        (sig-v4-header-based-auth.html).
     • "Authenticating Requests: Using Query Parameters" — the
        24-hour presigned-URL example for
        https://examplebucket.s3.amazonaws.com/test.txt
        (sigv4-query-string-auth.html).

   All examples share the documented test credentials:
     AWSAccessKeyId   AKIAIOSFODNN7EXAMPLE
     AWSSecretKey     wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
     region us-east-1 · timestamp 20130524T000000Z

   AWS publishes these specifically as test cases: "You can use this
   example as a test case to verify the signature that your code
   calculates." Expected canonical requests / strings-to-sign /
   signatures below are byte-for-byte from those docs.
   ============================================================ */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  awsUriEncode,
  awsUriEncodePath,
  buildCanonicalRequest,
  buildPutHeaders,
  buildStringToSign,
  canonicalQueryString,
  normalizeS3Prefix,
  presignGetCore,
  s3Address,
  s3Config,
  s3ObjectKey,
  s3PresignGetUrl,
  sanitizeS3Key,
  sha256Hex,
  signRequest,
  toAmzDate,
} from "./s3";
import { storagePut, storageGetSignedUrl } from "./storage";

const AK = "AKIAIOSFODNN7EXAMPLE";
const SK = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const AMZ_DATE = "20130524T000000Z";
const CREDS = { accessKey: AK, secret: SK, region: "us-east-1" };

const S3_ENV_KEYS = [
  "S3_BUCKET",
  "S3_REGION",
  "S3_ACCESS_KEY",
  "S3_SECRET",
  "S3_ENDPOINT",
  "S3_FORCE_PATH_STYLE",
  "S3_PREFIX",
] as const;
let savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  savedEnv = {};
  for (const k of S3_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of S3_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

function enableS3Env(extra: Record<string, string> = {}) {
  process.env.S3_BUCKET = "unit-bucket";
  process.env.S3_REGION = "ap-south-1";
  process.env.S3_ACCESS_KEY = AK;
  process.env.S3_SECRET = SK;
  Object.assign(process.env, extra);
}

/* ── official vector 1: GET Object, Authorization-header auth ── */

describe("SigV4 header auth — official AWS GET Object example", () => {
  const parts = {
    method: "GET" as const,
    canonicalUri: "/test.txt",
    query: {},
    headers: {
      Host: "examplebucket.s3.amazonaws.com",
      Range: "bytes=0-9",
      "x-amz-content-sha256":
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "x-amz-date": AMZ_DATE,
    },
    payloadHash:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  };

  it("reproduces the documented canonical request byte-for-byte", () => {
    const { canonicalRequest, signedHeaders } = buildCanonicalRequest(parts);
    expect(canonicalRequest).toBe(
      [
        "GET",
        "/test.txt",
        "",
        "host:examplebucket.s3.amazonaws.com",
        "range:bytes=0-9",
        "x-amz-content-sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "x-amz-date:20130524T000000Z",
        "",
        "host;range;x-amz-content-sha256;x-amz-date",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ].join("\n")
    );
    expect(signedHeaders).toBe("host;range;x-amz-content-sha256;x-amz-date");
  });

  it("reproduces the documented string-to-sign and final signature", () => {
    const signed = signRequest(CREDS, parts, AMZ_DATE);
    expect(signed.stringToSign).toBe(
      [
        "AWS4-HMAC-SHA256",
        "20130524T000000Z",
        "20130524/us-east-1/s3/aws4_request",
        "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972",
      ].join("\n")
    );
    expect(signed.signature).toBe(
      "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    );
    expect(signed.scope).toBe("20130524/us-east-1/s3/aws4_request");
  });
});

/* ── official vector 2: PUT Object, Authorization-header auth ── */

describe("SigV4 header auth — official AWS PUT Object example", () => {
  // PUT test$file.text with payload "Welcome to Amazon S3." and the
  // x-amz-storage-class + Date headers signed, exactly as documented.
  const payloadHash = sha256Hex("Welcome to Amazon S3.");
  const parts = {
    method: "PUT" as const,
    canonicalUri: awsUriEncodePath("/test$file.text"),
    query: {},
    headers: {
      Date: "Fri, 24 May 2013 00:00:00 GMT",
      Host: "examplebucket.s3.amazonaws.com",
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": AMZ_DATE,
      "x-amz-storage-class": "REDUCED_REDUNDANCY",
    },
    payloadHash,
  };

  it("hashes the documented payload to the documented x-amz-content-sha256", () => {
    expect(payloadHash).toBe(
      "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072"
    );
  });

  it("URI-encodes the object key in the canonical URI ($ → %24)", () => {
    expect(parts.canonicalUri).toBe("/test%24file.text");
  });

  it("reproduces the documented canonical request, string-to-sign, and signature", () => {
    const { canonicalRequest, signedHeaders } = buildCanonicalRequest(parts);
    expect(canonicalRequest).toBe(
      [
        "PUT",
        "/test%24file.text",
        "",
        "date:Fri, 24 May 2013 00:00:00 GMT",
        "host:examplebucket.s3.amazonaws.com",
        "x-amz-content-sha256:44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
        "x-amz-date:20130524T000000Z",
        "x-amz-storage-class:REDUCED_REDUNDANCY",
        "",
        "date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class",
        "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
      ].join("\n")
    );
    expect(signedHeaders).toBe(
      "date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class"
    );
    const signed = signRequest(CREDS, parts, AMZ_DATE);
    expect(sha256Hex(canonicalRequest)).toBe(
      "9e0e90d9c76de8fa5b200d8c849cd5b8dc7a3be3951ddb7f6a76b4158342019d"
    );
    expect(signed.signature).toBe(
      "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd"
    );
  });

  it("buildPutHeaders emits the driver's own signed PUT header set", () => {
    // The driver signs host + x-amz-content-sha256 + x-amz-date (Content-Type
    // is sent unsigned) — assert the Authorization envelope shape.
    const headers = buildPutHeaders(
      CREDS,
      {
        protocol: "https:",
        host: "examplebucket.s3.amazonaws.com",
        pathEncoded: "/test.txt",
      },
      payloadHash,
      AMZ_DATE
    );
    expect(headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request,SignedHeaders=host;x-amz-content-sha256;x-amz-date,Signature=[0-9a-f]{64}$/
    );
    expect(headers["x-amz-date"]).toBe(AMZ_DATE);
    expect(headers["x-amz-content-sha256"]).toBe(payloadHash);
  });
});

/* ── official vector 3: presigned GET URL (query-string auth) ── */

describe("SigV4 presign — official AWS presigned-URL example", () => {
  const now = new Date("2013-05-24T00:00:00Z");

  it("toAmzDate formats the documented timestamp", () => {
    expect(toAmzDate(now)).toBe("20130524T000000Z");
  });

  it("reproduces the documented canonical request and string-to-sign", () => {
    const query = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${AK}/20130524/us-east-1/s3/aws4_request`,
      "X-Amz-Date": AMZ_DATE,
      "X-Amz-Expires": "86400",
      "X-Amz-SignedHeaders": "host",
    };
    const signed = signRequest(
      CREDS,
      {
        method: "GET",
        canonicalUri: "/test.txt",
        query,
        headers: { host: "examplebucket.s3.amazonaws.com" },
        payloadHash: "UNSIGNED-PAYLOAD",
      },
      AMZ_DATE
    );
    expect(signed.canonicalRequest).toBe(
      [
        "GET",
        "/test.txt",
        "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host",
        "host:examplebucket.s3.amazonaws.com",
        "",
        "host",
        "UNSIGNED-PAYLOAD",
      ].join("\n")
    );
    expect(buildStringToSign(AMZ_DATE, signed.scope, signed.canonicalRequest)).toBe(
      [
        "AWS4-HMAC-SHA256",
        "20130524T000000Z",
        "20130524/us-east-1/s3/aws4_request",
        "3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04",
      ].join("\n")
    );
    expect(signed.signature).toBe(
      "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
    );
  });

  it("presignGetCore emits the documented final URL byte-for-byte", () => {
    const url = presignGetCore({
      protocol: "https:",
      host: "examplebucket.s3.amazonaws.com",
      pathEncoded: "/test.txt",
      accessKey: AK,
      secret: SK,
      region: "us-east-1",
      expiresSeconds: 86400,
      now,
    });
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
    );
  });
});

/* ── UriEncode + canonical query string rules ── */

describe("awsUriEncode (S3 UriEncode rules)", () => {
  it("leaves unreserved characters alone, uppercases hex, encodes !'()* too", () => {
    expect(awsUriEncode("AZaz09-._~")).toBe("AZaz09-._~");
    expect(awsUriEncode("a b")).toBe("a%20b"); // space is %20, never "+"
    expect(awsUriEncode("it's*!(ok)")).toBe("it%27s%2A%21%28ok%29");
    expect(awsUriEncode("/")).toBe("%2F"); // slash encoded outside key paths
  });
  it("preserves slashes only via the path variant", () => {
    expect(awsUriEncodePath("photos/Jan/sample.jpg")).toBe("photos/Jan/sample.jpg");
    expect(awsUriEncodePath("a b/c$d")).toBe("a%20b/c%24d");
  });
  it("sorts canonical query params bytewise by encoded key", () => {
    expect(canonicalQueryString({ b: "2", A: "1", "a-x": "3" })).toBe(
      "A=1&a-x=3&b=2"
    );
  });
});

/* ── config gating ── */

describe("s3Config gating (per-call env read)", () => {
  it("is null when unset and null when any of the four required vars is missing", () => {
    expect(s3Config()).toBeNull();
    enableS3Env();
    for (const k of ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET"]) {
      const v = process.env[k];
      delete process.env[k];
      expect(s3Config()).toBeNull();
      process.env[k] = v as string;
    }
    expect(s3Config()).not.toBeNull();
  });

  it("defaults the prefix to relay-chat/ and honors explicit overrides", () => {
    enableS3Env();
    expect(s3Config()!.prefix).toBe("relay-chat/");
    process.env.S3_PREFIX = "custom-prefix"; // trailing slash added
    expect(s3Config()!.prefix).toBe("custom-prefix/");
    process.env.S3_PREFIX = ""; // explicit empty = no prefix
    expect(s3Config()!.prefix).toBe("");
  });

  it("parses S3_FORCE_PATH_STYLE and S3_ENDPOINT", () => {
    enableS3Env({ S3_ENDPOINT: "https://minio.local:9000", S3_FORCE_PATH_STYLE: "1" });
    const cfg = s3Config()!;
    expect(cfg.endpoint).toBe("https://minio.local:9000");
    expect(cfg.forcePathStyle).toBe(true);
    process.env.S3_FORCE_PATH_STYLE = "true";
    expect(s3Config()!.forcePathStyle).toBe(true);
    process.env.S3_FORCE_PATH_STYLE = "0";
    expect(s3Config()!.forcePathStyle).toBe(false);
  });

  /* ── THE ENDPOINT IS PARSED AT CONFIG TIME (v2.105.17) ─────────────────────
   * `s3Config()` non-null is the backend SELECTOR: storage.ts commits to the S3 branch
   * and never falls back to Forge. So an endpoint that cannot be used must make the
   * driver report OFF, not fail once per request — and the two real ways to write one
   * wrong fail in two different, equally undiagnosable ways.
   */

  it("an endpoint with no scheme reports the driver OFF, not a per-request 500", () => {
    // Exactly how Cloudflare's dashboard presents an R2 endpoint. `new URL()` THROWS
    // on it, which used to surface as a generic 500 naming neither S3 nor the variable.
    enableS3Env({ S3_ENDPOINT: "abc123.r2.cloudflarestorage.com" });
    expect(s3Config()).toBeNull();
  });

  it("an endpoint with an EMPTY host is refused — the silent one", () => {
    /* `new URL("minio:9000")` does NOT throw: it yields protocol "minio:" and an empty
       host. The signer then presigns https:///bucket/key with the signature computed
       over an empty Host header, so the fetch resolves the BUCKET NAME as a hostname —
       a wrong request that looks like a DNS problem. This is how MinIO endpoints are
       conventionally written, so it is the likelier of the two. */
    enableS3Env({ S3_ENDPOINT: "minio:9000" });
    expect(s3Config()).toBeNull();
    // A scheme we cannot speak is refused for the same reason.
    enableS3Env({ S3_ENDPOINT: "s3://bucket" });
    expect(s3Config()).toBeNull();
    enableS3Env({ S3_ENDPOINT: "ftp://files.example.org" });
    expect(s3Config()).toBeNull();
  });

  it("a REAL endpoint still configures — http and https, with and without a port", () => {
    // The fail-shut direction is only correct if it does not refuse what works: R2,
    // MinIO over plain http on a LAN, and a bare https host must all pass through.
    for (const ok of [
      "https://abc.r2.cloudflarestorage.com",
      "http://minio.local:9000",
      "https://minio.local:9000",
      "http://127.0.0.1:9000",
    ]) {
      enableS3Env({ S3_ENDPOINT: ok });
      expect(s3Config()?.endpoint).toBe(ok);
    }
  });

  it("normalizeS3Prefix trims slashes and guarantees one trailing slash", () => {
    expect(normalizeS3Prefix("/a/b/")).toBe("a/b/");
    expect(normalizeS3Prefix("a")).toBe("a/");
    expect(normalizeS3Prefix("")).toBe("");
    expect(normalizeS3Prefix("///")).toBe("");
  });
});

/* ── key hygiene ── */

describe("key prefix + traversal safety", () => {
  it("sanitizeS3Key strips leading slashes and collapses doubles", () => {
    expect(sanitizeS3Key("//a//b//c.txt")).toBe("a/b/c.txt");
  });
  it("REJECTS traversal and degenerate segments", () => {
    expect(() => sanitizeS3Key("../etc/passwd")).toThrow(/Unsafe/);
    expect(() => sanitizeS3Key("a/../b")).toThrow(/Unsafe/);
    expect(() => sanitizeS3Key("a/./b")).toThrow(/Unsafe/);
    expect(() => sanitizeS3Key("")).toThrow(/empty/);
    expect(() => sanitizeS3Key("a/ bad")).toThrow(/control/);
    expect(() => sanitizeS3Key("x".repeat(901))).toThrow(/too long/);
  });
  it("s3ObjectKey applies the configured prefix", () => {
    expect(s3ObjectKey({ prefix: "relay-chat/" }, "generated/a.png")).toBe(
      "relay-chat/generated/a.png"
    );
    expect(s3ObjectKey({ prefix: "" }, "generated/a.png")).toBe("generated/a.png");
  });
  it("is ensure-style: never double-prefixes an already-namespaced key", () => {
    // v2upload keys are already `relay-chat/<identityId>/…` — with the default
    // prefix they must come out byte-identical to the Forge backend's keys or
    // the thumbKey ownership check would break.
    expect(s3ObjectKey({ prefix: "relay-chat/" }, "relay-chat/42/file.webp")).toBe(
      "relay-chat/42/file.webp"
    );
    expect(s3ObjectKey({ prefix: "prod/" }, "relay-chat/42/file.webp")).toBe(
      "prod/relay-chat/42/file.webp"
    );
  });
});

/* ── addressing ── */

describe("s3Address (virtual-host vs path-style)", () => {
  const base = { bucket: "b", region: "ap-south-1" };
  it("AWS default: virtual-hosted regional endpoint over https", () => {
    expect(s3Address({ ...base, forcePathStyle: false }, "k/x.png")).toEqual({
      protocol: "https:",
      host: "b.s3.ap-south-1.amazonaws.com",
      pathEncoded: "/k/x.png",
    });
  });
  it("custom endpoint + path-style (R2 / MinIO)", () => {
    expect(
      s3Address(
        { ...base, endpoint: "https://acc.r2.cloudflarestorage.com", forcePathStyle: true },
        "k/x.png"
      )
    ).toEqual({
      protocol: "https:",
      host: "acc.r2.cloudflarestorage.com",
      pathEncoded: "/b/k/x.png",
    });
  });
  it("custom endpoint without path-style bucket-prefixes the host; http + port kept", () => {
    expect(
      s3Address({ ...base, endpoint: "http://minio.local:9000", forcePathStyle: false }, "x")
    ).toEqual({ protocol: "http:", host: "b.minio.local:9000", pathEncoded: "/x" });
  });
  it("URI-encodes key characters in the path", () => {
    expect(s3Address({ ...base, forcePathStyle: false }, "a b/c$d").pathEncoded).toBe(
      "/a%20b/c%24d"
    );
  });
});

/* ── app-level presign wrapper ── */

describe("s3PresignGetUrl (wrapper shape)", () => {
  it("presigns the stored key AS-IS (no re-prefixing on reads) with all X-Amz params", () => {
    enableS3Env();
    const cfg = s3Config()!;
    const url = s3PresignGetUrl(cfg, "relay-chat/42/photo.webp", 300, new Date("2026-01-02T03:04:05Z"));
    const u = new URL(url);
    expect(u.host).toBe("unit-bucket.s3.ap-south-1.amazonaws.com");
    expect(u.pathname).toBe("/relay-chat/42/photo.webp");
    expect(u.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(u.searchParams.get("X-Amz-Credential")).toBe(
      `${AK}/20260102/ap-south-1/s3/aws4_request`
    );
    expect(u.searchParams.get("X-Amz-Date")).toBe("20260102T030405Z");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(u.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("rejects traversal keys on the read path too", () => {
    enableS3Env();
    expect(() => s3PresignGetUrl(s3Config()!, "relay-chat/../secrets")).toThrow(/Unsafe/);
  });
});

/* ── storage.ts driver selection ── */

describe("storagePut / storageGetSignedUrl driver selection", () => {
  it("uses the native S3 driver when S3_* is set and returns the /manus-storage/{key} URL shape", async () => {
    enableS3Env();
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { key, url } = await storagePut("relay-chat/7/pic.png", Buffer.from("x"), "image/png");
    // Same URL contract as the Forge driver — clients/DB stay storage-agnostic.
    expect(url).toBe(`/manus-storage/${key}`);
    expect(key).toMatch(/^relay-chat\/7\/pic_[0-9a-f]{8}\.png$/); // hash suffix + no double prefix
    expect(fetchMock).toHaveBeenCalledTimes(1); // ONE direct PUT — no Forge presign round-trip
    const [putUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(putUrl)).toBe(
      `https://unit-bucket.s3.ap-south-1.amazonaws.com/${key}`
    );
    expect(init.method).toBe("PUT");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=/);
    expect(headers["x-amz-content-sha256"]).toBe(sha256Hex("x"));
    expect(headers["Content-Type"]).toBe("image/png");
  });

  it("applies the default prefix to keys outside the relay-chat namespace", async () => {
    enableS3Env();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const { key } = await storagePut("generated/img.png", "data");
    expect(key).toMatch(/^relay-chat\/generated\/img_[0-9a-f]{8}\.png$/);
  });

  it("surfaces a non-2xx PUT as an error", async () => {
    enableS3Env();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    await expect(storagePut("a/b.txt", "x")).rejects.toThrow(/S3 PUT failed \(403\)/);
  });

  it("storageGetSignedUrl presigns locally under S3 (no fetch at all)", async () => {
    enableS3Env();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const url = await storageGetSignedUrl("relay-chat/7/pic.png");
    expect(url).toContain("X-Amz-Signature=");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the Forge driver when S3_* is absent (gating)", async () => {
    // Without S3 env AND without Forge env the Forge branch must be the one
    // that runs — proven by its distinctive config error.
    await expect(storagePut("a/b.txt", "x")).rejects.toThrow(
      /BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY/
    );
    await expect(storageGetSignedUrl("a/b.txt")).rejects.toThrow(
      /BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY/
    );
  });
});
