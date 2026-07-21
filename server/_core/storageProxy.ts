import type { Express } from "express";
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
      if (authz.kind === "attachment") {
        if (!authz.authorized) {
          res.status(403).send("Forbidden");
          return;
        }
      } else if (identityId == null) {
        // Not a known message attachment (an avatar / other object) — require a
        // signed-in user; never serve it to an anonymous URL holder.
        res.status(403).send("Forbidden");
        return;
      }
    } catch (e) {
      console.error("[StorageProxy] authz error:", e);
      res.status(503).send("Storage temporarily unavailable");
      return;
    }

    const now = Date.now();
    const cached = cacheGet(key, now);
    if (cached) {
      res.set("Cache-Control", "private, max-age=60");
      res.redirect(307, cached);
      return;
    }

    // ── Native S3 branch (v2.91) — presign locally, no network round-trip.
    // Same 60s cache + 307 semantics as the Forge branch below; the presigned
    // GET's 300s expiry comfortably outlives the cache window.
    const s3 = s3Config();
    if (s3) {
      try {
        const url = s3PresignGetUrl(s3, key, 300);
        cacheSet(key, url, now);
        res.set("Cache-Control", "private, max-age=60");
        res.redirect(307, url);
      } catch (err) {
        console.error("[StorageProxy] s3 presign failed:", err);
        res.status(502).send("Storage proxy error");
      }
      return;
    }

    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }

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

      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }

      cacheSet(key, url, now);
      res.set("Cache-Control", "private, max-age=60");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
