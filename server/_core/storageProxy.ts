import type { Express } from "express";
import { Readable } from "node:stream";
import { ENV } from "./env";
import { s3Config, s3PresignGetUrl, sanitizeS3Key } from "../s3";
import { createContext } from "./context";
import { authorizeStorageKey } from "../v2db";
import { createRateLimiter, clientIpOf } from "../rateLimit";

/* Per-IP rate limit for the UNAUTHENTICATED media proxy (QA M10). Each request
 * can trigger DB work (attachment lookup + the avatar-rescue's identities scan),
 * so an anonymous loop over guessed `status_…`/`avatar_…` keys was an easy DB-CPU
 * DoS with no cap. Generous — a chat screen legitimately bursts many images at
 * once (240 burst, ~4/s sustained per IP) — so only a true flood is throttled.
 * Honors RELAY_RATELIMIT_OFF like the other gates. */
/* M44: raised from (240, 4/s). The threat this guards is DB-CPU cost on the MISS
 * path (the avatar-rescue does a `LIKE '%/manus-storage/<key>'` scan), NOT key
 * enumeration — keys carry a random hex suffix, so they can't be guessed. But
 * the budget is per-IP, and any shared egress puts many real users behind ONE
 * address: carrier CGNAT, an office, a school, a café. RELAY is an image-heavy
 * chat, so a handful of people scrolling media threads together could exhaust a
 * 240 burst and then be rationed at 4/s — and a throttled media request renders
 * as a BROKEN IMAGE, the exact user-visible symptom this project has chased
 * repeatedly. 600 burst / 20-per-second comfortably covers a shared network
 * while still capping a scraper two orders of magnitude below unlimited. */
const storageIpLimiter = createRateLimiter({ capacity: 600, refillPerSec: 20 });
/* M33: sweep idle buckets. Every OTHER limiter in the codebase pairs itself with
 * a periodic sweep (directoryGate, otpGate, statusGate, the SSE open limiter…);
 * this one shipped without it, so its per-IP Map grew for the lifetime of the
 * process on the app's only fully anonymous, high-fan-out endpoint — one entry
 * per distinct IP that ever loaded a single image, never released. A slow but
 * unbounded leak, and trivially accelerated by spraying source addresses. */
setInterval(() => storageIpLimiter.sweep(Date.now(), 30 * 60_000), 30 * 60_000).unref();

/* ── IN-FLIGHT STREAM CEILING (v2.99.57) ─────────────────────────────────────
 * The limiter above bounds the ARRIVAL RATE of media requests; nothing bounded
 * how many were open AT ONCE. Once a request is granted it is never re-examined,
 * so a client that asks for media and then never reads the body accumulates
 * streams indefinitely — each pinning an inbound socket, an upstream connection
 * and its buffered body (~64-80 KiB apiece once backpressure engages). This
 * process is `instances: 1` with `max_memory_restart: "1G"` and it owns the whole
 * in-memory signaling registry plus every SSE stream, so an OOM restart drops
 * every call on the fleet. And the attacker needs nothing but a free guest
 * identity: as the uploader of their own 40MB file they are unconditionally
 * authorized.
 *
 * `v2events.ts` already does exactly this for the sibling long-lived endpoint;
 * this is the same accounting.
 *
 * Sized to be invisible to real use. A media-heavy chat screen opens a few dozen
 * images at once, and a shared egress (CGNAT, an office, a café) multiplies that
 * across people — this endpoint's rate limiter has ALREADY been loosened once
 * (M44, 240→600) precisely because a throttled media request renders as a BROKEN
 * IMAGE. So the per-IP ceiling sits well above a plausible screenful, and the
 * process-wide ceiling is the actual backstop. */
const MAX_INFLIGHT_PER_IP = 60;
const MAX_INFLIGHT_TOTAL = 400;
/** No BYTES for this long ⇒ the client has stopped reading; destroy the stream.
 *  Idle, deliberately, never wall-clock: a large video on a slow connection is a
 *  legitimate slow transfer, and `<video>` seeking opens and abandons Range
 *  requests constantly. Only a stream making NO progress is abusive. */
const STREAM_IDLE_MS = 45_000;
/** Upstream must produce RESPONSE HEADERS within this long. Applied to the header
 *  phase only — an abort signal on `fetch` also kills body streaming, so using it
 *  as a whole-request timeout would cancel legitimate large downloads. */
const UPSTREAM_HEADER_MS = 20_000;

const inflightByIp = new Map<string, number>();
let inflightTotal = 0;

/** Reserve a stream slot, or null when a ceiling is hit. */
function acquireStream(ip: string): { release: () => void } | null {
  const mine = inflightByIp.get(ip) ?? 0;
  if (inflightTotal >= MAX_INFLIGHT_TOTAL || mine >= MAX_INFLIGHT_PER_IP) return null;
  inflightByIp.set(ip, mine + 1);
  inflightTotal++;
  let released = false;
  return {
    // Idempotent: `close` and `finish` can BOTH fire for one response, and a
    // double decrement would corrupt the counter into permanent free capacity —
    // worse than the leak this is here to prevent.
    release() {
      if (released) return;
      released = true;
      inflightTotal = Math.max(0, inflightTotal - 1);
      const n = (inflightByIp.get(ip) ?? 1) - 1;
      if (n <= 0) inflightByIp.delete(ip);
      else inflightByIp.set(ip, n);
    },
  };
}

/** Test seam: current in-flight accounting. */
export function storageInflight(): { total: number; ips: number } {
  return { total: inflightTotal, ips: inflightByIp.size };
}

/* In-process signed-URL cache (v2.88). Every /manus-storage view used to pay a
 * presign round-trip to Forge and told the browser `no-store`, so a chat
 * screen with 20 avatars re-presigned all 20 on every render. Attachment keys
 * are content-addressed and IMMUTABLE (uploads mint a fresh hashed key, never
 * overwrite), so caching is safe:
 *   - server side: remember the signed URL for 60s (comfortably below the
 *     presigned GET's expiry) keyed by storage key;
 *   - client side: `private, max-age=60` on the redirect response lets the
 *     browser reuse the redirect itself without re-asking us at all.
 */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 2_000; // ~200 KB worst case; swept before insert
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/** Test/ops hook — drop every cached signed URL. */
export function _clearStorageProxyCache(): void {
  signedUrlCache.clear();
}

function cacheGet(key: string, now: number): string | null {
  const hit = signedUrlCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    signedUrlCache.delete(key);
    return null;
  }
  return hit.url;
}

function cacheSet(key: string, url: string, now: number): void {
  if (signedUrlCache.size >= CACHE_MAX_ENTRIES) {
    // Cheap pressure valve: drop expired entries first, then oldest-inserted.
    signedUrlCache.forEach((v, k) => {
      if (v.expiresAt <= now) signedUrlCache.delete(k);
    });
    while (signedUrlCache.size >= CACHE_MAX_ENTRIES) {
      const oldest = signedUrlCache.keys().next().value;
      if (oldest === undefined) break;
      signedUrlCache.delete(oldest);
    }
  }
  signedUrlCache.set(key, { url, expiresAt: now + CACHE_TTL_MS });
}

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    // QA M10: cap the unauthenticated media proxy per IP before any DB work.
    const clientIp = clientIpOf(req);
    const limitsOff = process.env.RELAY_RATELIMIT_OFF === "1";
    if (!limitsOff && !storageIpLimiter.allow(clientIp, Date.now())) {
      res.status(429).send("Too many requests");
      return;
    }
    // …and cap how many streams are OPEN AT ONCE (v2.99.57). The bucket above
    // meters arrivals; without this, granted requests that are never read
    // accumulate until the 1GB process is OOM-restarted, taking every call with
    // it. Released from a single idempotent handler bound to both `close` and
    // `finish` below.
    const slot = limitsOff ? { release() {} } : acquireStream(clientIp);
    if (!slot) {
      res.status(429).send("Too many concurrent media streams");
      return;
    }
    res.on("close", () => slot.release());
    res.on("finish", () => slot.release());
    const rawKey = (req.params as Record<string, string>)[0];
    if (!rawKey) {
      res.status(400).send("Missing storage key");
      return;
    }

    // SECURITY: normalize the key to the SAME canonical form `sanitizeS3Key`
    // (used later, only at presign time) produces, and use that ONE value for
    // every downstream step — the authorization check, the cache key, AND the
    // presign. Previously the authorization check ran against the RAW key
    // (an exact-string DB match) while presigning silently normalized it via
    // sanitizeS3Key (which collapses a run of slashes like "a//b" -> "a/b"
    // *before* its own empty-segment check ever sees it — so it does not
    // reject that shape). A request for a real attachment's key with an extra
    // "/" inserted therefore missed the exact-match DB lookup (classified
    // `unknown`, the FAIL-OPEN branch reserved for non-attachment keys like
    // avatars) while still normalizing back to the real object at presign
    // time — serving any known/guessed private attachment to an unauthorized
    // or anonymous requester with no participant check, and also re-exposing
    // "burned" view-once media (F3) via the same route. Canonicalizing once,
    // up front, makes that mismatch structurally impossible: authorization
    // and serving can never disagree about which object is being requested.
    // sanitizeS3Key also subsumes the prior ad-hoc traversal guard (rejects
    // "." / ".." / empty segments, a >900-byte key, and control characters) —
    // Express percent-decodes before req.params, so an encoded traversal
    // ("%2e%2e") still arrives here as a real ".." segment and is caught.
    let key: string;
    try {
      key = sanitizeS3Key(rawKey);
    } catch {
      res.status(400).send("Bad storage key");
      return;
    }

    // ── Participant-only file access ─────────────────────────────────────────
    // A raw /manus-storage URL must NOT open a file on its own (the whole point:
    // a leaked/guessed URL is useless to a non-participant). Resolve the
    // requester's identity (READ-ONLY — createContext never mints a guest) and
    // authorize BEFORE any presign/cache:
    //   • message attachments (files / voice-notes / images / video) → uploader
    //     or a participant in a conversation that references them;
    //   • other keys (avatars) → any authenticated identity, never anonymous.
    // This runs on cache hits too (the signed-URL cache is keyed by object, so it
    // must never be served without an auth check). Fail CLOSED on any error so a
    // DB blip can never leak a file.
    let identityId: number | null = null;
    try {
      const ctx = await createContext({ req, res } as Parameters<typeof createContext>[0]);
      identityId = ctx.identity?.id ?? null;
    } catch {
      identityId = null;
    }
    try {
      const authz = await authorizeStorageKey(key, identityId);
      // Only MESSAGE ATTACHMENTS (the shared files/voice-notes/images/video this
      // feature protects) are participant-gated — a non-participant, or nobody
      // logged in, is refused. Other keys (avatars) are served as before: they're
      // semi-public (already shown in directory previews) and NOT the sensitive
      // "shared files", so gating them would only break profile images (e.g. a
      // pre-onboarding invite preview) with no security benefit.
      if (authz.kind === "attachment" && !authz.authorized) {
        res.status(403).send("Forbidden");
        return;
      }
      // Rich-status media (v2.95) is likewise gated: served ONLY to the owner
      // or their audience (a non-blocked contact) while the status is still
      // ACTIVE. A deleted/expired status, an anonymous request, or a non-contact
      // is refused — status media is ephemeral + contacts-only, not a public
      // avatar. (authorizeStorageKey resolves this from the live `statuses` row.)
      if (authz.kind === "status" && !authz.authorized) {
        res.status(403).send("Forbidden");
        return;
      }
      // v2.99.14: an UNKNOWN key (no attachment row, not status, not a current
      // avatar) is an orphaned or GUESSED object — never serve it to an
      // anonymous caller. (Avatars stay semi-public so pre-onboarding invite
      // previews still resolve; the streaming below means even those never
      // leak a shareable storage URL.) Closes the old fail-open where any
      // unclassified key was world-readable.
      if (authz.kind === "unknown" && identityId == null) {
        res.status(403).send("Forbidden");
        return;
      }
    } catch (e) {
      console.error("[StorageProxy] authz error:", e);
      res.status(503).send("Storage temporarily unavailable");
      return;
    }

    // ── Resolve the backing object's presigned URL — SERVER-ONLY ─────────────
    // v2.99.14 (owner: "the file URL shown in the browser/app must stay in the
    // app; nothing traceable"): we NO LONGER 307-redirect the browser to this
    // presigned URL. That URL is session-independent — once it surfaces in the
    // address bar or devtools (following the old redirect) it is copyable and
    // replayable by ANYONE for its lifetime (exactly how a video-note leaked).
    // The presigned URL is now used only here, to fetch the bytes, which we
    // STREAM back through this cookie-gated route. The browser only ever sees
    // `/manus-storage/<key>`; no shareable storage URL is ever emitted.
    const now = Date.now();
    let upstreamUrl = cacheGet(key, now);
    if (!upstreamUrl) {
      const s3 = s3Config();
      if (s3) {
        try {
          upstreamUrl = s3PresignGetUrl(s3, key, 300);
        } catch (err) {
          console.error("[StorageProxy] s3 presign failed:", err);
          res.status(502).send("Storage proxy error");
          return;
        }
      } else if (ENV.forgeApiUrl && ENV.forgeApiKey) {
        try {
          const forgeUrl = new URL(
            "v1/storage/presign/get",
            ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
          );
          forgeUrl.searchParams.set("path", key);
          const forgeResp = await fetch(forgeUrl, {
            headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
          });
          if (!forgeResp.ok) {
            const body = await forgeResp.text().catch(() => "");
            console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
            res.status(502).send("Storage backend error");
            return;
          }
          const parsed = (await forgeResp.json()) as { url?: string };
          if (!parsed.url) {
            res.status(502).send("Empty signed URL from backend");
            return;
          }
          upstreamUrl = parsed.url;
        } catch (err) {
          console.error("[StorageProxy] forge presign failed:", err);
          res.status(502).send("Storage proxy error");
          return;
        }
      } else {
        res.status(500).send("Storage proxy not configured");
        return;
      }
      cacheSet(key, upstreamUrl, now);
    }

    // ── Stream the bytes through us (Range-aware; upstreamUrl never leaves) ───
    try {
      const range = req.headers.range;
      // Header-phase timeout only: an abort signal on `fetch` also tears down BODY
      // streaming, so using it as a whole-request deadline would cancel a
      // legitimate large or slow download. Cleared the moment headers arrive.
      const ac = new AbortController();
      const headerT = setTimeout(() => ac.abort(), UPSTREAM_HEADER_MS);
      let upstream: Response;
      try {
        upstream = await fetch(upstreamUrl, {
          signal: ac.signal,
          ...(range ? { headers: { Range: range } } : {}),
        });
      } finally {
        clearTimeout(headerT);
      }
      if (!upstream.ok && upstream.status !== 206) {
        // A cached presigned URL may have gone stale — drop it so the next hit
        // re-presigns instead of serving the error again.
        signedUrlCache.delete(key);
        res.status(upstream.status === 404 ? 404 : 502).send("Storage backend error");
        return;
      }
      res.status(upstream.status);
      // Relay only the content headers the browser needs to render + seek media.
      for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      // SECURITY (M38): the Content-Type above originates from the UPLOADER (it's
      // whatever `?mime=` was stored with), and this response is SAME-ORIGIN, so
      // relaying it verbatim let an attacker choose how the victim's browser
      // interprets their bytes. `nosniff` below stops the browser guessing, but it
      // also means the DECLARED type is obeyed — which is the problem, not the
      // cure. The upload denylist is the first line of defence, yet it is a
      // denylist over a very broad allowlist (`text/*`, `application/*`), so
      // anything it forgot — or anything already stored before it was tightened —
      // would still be honoured here.
      //
      // Serve only types that are genuinely safe to render inline as themselves;
      // everything else is downgraded to an opaque download. A file the browser
      // saves cannot execute in our origin, which makes this robust WITHOUT
      // needing to enumerate every dangerous type. This matches how the client
      // already presents attachments (images/video/audio inline, documents as a
      // download card), so it costs nothing in practice.
      const declared = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      // The set covers what a DEVICE hands back, not only what RELAY produces.
      // v2.99.45's self-review enumerated the encoders in voiceNote/videoNote/
      // emojiAvatar and concluded the list was complete — but the avatar and
      // Status pickers upload the RAW `File` with `mimeType: file.type` and no
      // re-encode (uploadBare), and the upload door only tests `^image/`, so an
      // iPhone `image/heic` or an Android `video/3gpp` stores fine and then got
      // downgraded to an opaque download by the serve side. The two gates
      // disagreed; that is the bug, and widening the serve side is the right
      // direction because narrowing the door would REJECT a legitimate photo.
      //
      // INVARIANT for anything added here: binary media containers ONLY. Never a
      // text/*, XML-family, XHTML, SVG or script media type — those are exactly
      // what this allowlist exists to force into a download, and a browser can
      // interpret them as markup in our origin. Pinned by a property test in
      // hardeningPass6.test.ts.
      const INLINE_SAFE_TYPE =
        /^(image\/(png|jpeg|jpg|gif|webp|avif|bmp|x-icon|apng|heic|heif|tiff)|video\/(mp4|webm|ogg|quicktime|x-m4v|3gpp|3gpp2|x-matroska|mpeg)|audio\/(mpeg|mp3|mp4|aac|ogg|wav|wave|x-wav|webm|x-m4a|m4a|flac|3gpp)|application\/pdf)$/;
      if (!INLINE_SAFE_TYPE.test(declared)) {
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", "attachment");
      }
      if (!upstream.headers.get("accept-ranges")) res.setHeader("Accept-Ranges", "bytes");
      // Content-addressed + immutable keys → a short PRIVATE cache is safe and
      // avoids re-streaming on every render. Never `public` (that would be the
      // very shareability we're removing).
      res.setHeader("Cache-Control", "private, max-age=60");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (!upstream.body) {
        res.end();
        return;
      }
      const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
      nodeStream.on("error", (err) => {
        console.error("[StorageProxy] stream error:", err);
        if (!res.headersSent) res.status(502).end();
        else res.destroy();
      });
      // Client aborted (tab closed / seek) → stop pulling from upstream.
      res.on("close", () => nodeStream.destroy());
      // IDLE watchdog (v2.99.57): a client that stops reading applies backpressure,
      // so no bytes flow while the stream stays open forever. Reset on every chunk,
      // so a slow-but-progressing transfer is never interrupted.
      let idleT: NodeJS.Timeout | null = null;
      const armIdle = () => {
        if (idleT) clearTimeout(idleT);
        idleT = setTimeout(() => {
          nodeStream.destroy();
          res.destroy();
        }, STREAM_IDLE_MS);
      };
      nodeStream.on("data", armIdle);
      const clearIdle = () => { if (idleT) { clearTimeout(idleT); idleT = null; } };
      nodeStream.on("end", clearIdle);
      nodeStream.on("close", clearIdle);
      res.on("close", clearIdle);
      armIdle();
      nodeStream.pipe(res);
    } catch (err) {
      console.error("[StorageProxy] stream failed:", err);
      if (!res.headersSent) res.status(502).send("Storage proxy error");
    }
  });
}
