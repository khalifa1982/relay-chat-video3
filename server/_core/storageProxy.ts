import type { Express } from "express";
import { Readable } from "node:stream";
import { ENV } from "./env";
import { s3Config, s3PresignGetUrl } from "../s3";
import { createContext } from "./context";
import { authorizeStorageKey } from "../v2db";

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
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    // Traversal guard: keys are flat storage identifiers minted by storagePut;
    // a ".." SEGMENT is never legitimate and could confuse prefix-scoped
    // ownership checks upstream of a signed URL. Segment-wise on purpose
    // (v2.91 review D2, matching sanitizeS3Key): filenames legitimately
    // contain ".." runs ("photo..2020.png" → key "…_photo..2020.png") and a
    // substring check 400'd those keys forever — including pre-v2.91 rows.
    // Express percent-decodes before req.params, so an encoded traversal
    // ("%2e%2e") still arrives here as a real ".." segment and is caught.
    if (key.split("/").some((s) => s === ".." || s === ".")) {
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
      const upstream = await fetch(upstreamUrl, range ? { headers: { Range: range } } : undefined);
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
      nodeStream.pipe(res);
    } catch (err) {
      console.error("[StorageProxy] stream failed:", err);
      if (!res.headersSent) res.status(502).send("Storage proxy error");
    }
  });
}
