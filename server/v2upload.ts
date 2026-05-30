/* ============================================================
   HTTP attachment upload endpoint for the v2.0 messages tab.

   Clients POST { dataBase64, mimeType, filename, width?, height?,
   durationMs? } with `credentials: 'include'` so the guest or
   user cookie comes along. The endpoint:
     1. resolves the caller's identity from the request,
     2. stores the bytes via the project's `storagePut` helper,
     3. records the attachment row in the DB,
     4. returns { id, url, mimeType, sizeBytes, ... } so the client
        can immediately attach it to a `messages.send` mutation.

   We keep this on plain Express (not tRPC) because tRPC's superjson
   pipeline isn't ideal for big base64 payloads, and we already cap
   the JSON body at 50mb in `_core/index.ts`.
   ============================================================ */

import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { sdk } from "./_core/sdk";
import { storagePut } from "./storage";
import { extractDeviceId, GUEST_COOKIE } from "./_core/context";
import {
  ensureUserIdentity,
  getIdentityByDeviceId,
  getIdentityByGuestToken,
  recordAttachment,
} from "./v2db";

const ALLOWED_MIME = /^(image|video|audio|application|text)\//i;
const MAX_BYTES = 40 * 1024 * 1024; // 40 MB ceiling per attachment

function safeName(name: string | undefined, fallback: string) {
  const trimmed = (name || "").trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

export function registerV2Upload(app: Express) {
  app.post("/api/v2/upload", async (req: Request, res: Response) => {
    try {
      // ── resolve caller identity (registered first, then guest) ──
      let user: { id: number; name?: string | null } | null = null;
      try {
        const u = await sdk.authenticateRequest(req);
        user = u ? { id: u.id, name: u.name ?? null } : null;
      } catch {
        user = null;
      }

      let identityId: number | null = null;
      const guestToken: string | undefined = req.cookies?.[GUEST_COOKIE];
      const deviceId = extractDeviceId(req);
      if (user) {
        const ident = await ensureUserIdentity({
          userId: user.id,
          displayName: user.name || "User",
          guestToken: guestToken ?? null,
        });
        identityId = ident.id;
      } else {
        // Cookie first, device id as fallback. Same resolution order
        // as the tRPC context resolver — see server/_core/context.ts.
        if (guestToken) {
          const ident = await getIdentityByGuestToken(guestToken);
          if (ident) identityId = ident.id;
        }
        if (identityId == null && deviceId) {
          const ident = await getIdentityByDeviceId(deviceId);
          if (ident) identityId = ident.id;
        }
      }
      if (identityId == null) {
        return res.status(401).json({ error: "No identity. Sign in or start a guest session." });
      }

      // ── validate payload ──
      const { dataBase64, mimeType, filename, width, height, durationMs } = req.body || {};
      if (typeof dataBase64 !== "string" || typeof mimeType !== "string") {
        return res.status(400).json({ error: "dataBase64 and mimeType are required" });
      }
      if (!ALLOWED_MIME.test(mimeType)) {
        return res.status(400).json({ error: "Unsupported mime type" });
      }

      // strip an optional `data:...;base64,` prefix
      const commaIdx = dataBase64.indexOf(",");
      const raw = dataBase64.startsWith("data:") && commaIdx > 0 ? dataBase64.slice(commaIdx + 1) : dataBase64;
      const buf = Buffer.from(raw, "base64");
      if (buf.length === 0) return res.status(400).json({ error: "Empty payload" });
      if (buf.length > MAX_BYTES) {
        return res.status(413).json({ error: `Attachment exceeds ${Math.floor(MAX_BYTES / 1024 / 1024)} MB limit` });
      }

      const ext = (mimeType.split("/")[1] || "bin").split(/[+;]/)[0].slice(0, 8);
      const hash = crypto.randomBytes(4).toString("hex");
      const fnSafe = safeName(filename, `attachment_${hash}.${ext}`);
      const key = `relay-chat/${identityId}/${Date.now()}_${hash}_${fnSafe}`;

      const { key: storedKey, url } = await storagePut(key, buf, mimeType);

      const row = await recordAttachment({
        storageKey: storedKey,
        url,
        mimeType,
        sizeBytes: buf.length,
        width: typeof width === "number" ? width : null,
        height: typeof height === "number" ? height : null,
        durationMs: typeof durationMs === "number" ? durationMs : null,
        filename: fnSafe,
        uploadedByIdentityId: identityId,
      });

      return res.json({
        id: row.id,
        url,
        storageKey: storedKey,
        mimeType,
        sizeBytes: buf.length,
        width: row.width ?? null,
        height: row.height ?? null,
        durationMs: row.durationMs ?? null,
        filename: fnSafe,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Log but keep the API response narrow.
      console.error("[v2upload] failed:", msg);
      return res.status(500).json({ error: "Upload failed" });
    }
  });
}
