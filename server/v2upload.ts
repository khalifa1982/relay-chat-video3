/* ============================================================
   HTTP attachment upload endpoint for the v2.0 messages tab.

   TWO wire formats on the same POST /api/v2/upload (v2.88):

   1. RAW BINARY (primary — the web client since v2.88):
      Content-Type: application/octet-stream, the file bytes as the
      body, metadata in the query string (?filename=&mime=&width=&
      height=&durationMs=). No base64 inflation: a 40 MB upload peaks
      at ~40 MB of process memory instead of the ~250-300 MB the
      base64→string→Buffer pipeline cost on the 512 MiB instance (an
      OOM there wiped the in-memory relay registry and dropped every
      live call).
   2. LEGACY base64 JSON ({ dataBase64, mimeType, filename, … }) —
      kept for old clients and mobile/native's uploadAttachment,
      capped at 10 MB decoded (plenty for voice notes/images; the
      JSON body parser itself caps at 15 MB in `_core/index.ts`).

   Both paths:
     1. resolve the caller's identity via the shared context resolver,
     2. store the bytes via the project's `storagePut` helper,
     3. record the attachment row in the DB,
     4. return { id, url, mimeType, sizeBytes, ... } so the client
        can immediately attach it to a `messages.send` mutation.

   We keep this on plain Express (not tRPC) because tRPC's superjson
   pipeline isn't ideal for binary/base64 payloads.
   ============================================================ */

import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { storagePut } from "./storage";
import { s3Config } from "./s3";
import { createContext } from "./_core/context";
import { recordAttachment } from "./v2db";

const ALLOWED_MIME = /^(image|video|audio|application|text)\//i;
// Deny script-bearing subtypes even when their top-level type passes ALLOWED_MIME.
// image/svg+xml is the notable one — it's an "image" but can embed <script>, so
// serving it same-origin would be a stored-XSS vector.
const BLOCKED_MIME =
  /^(image\/svg\+xml|text\/html|application\/xhtml\+xml|application\/javascript|application\/x-msdownload|application\/x-sh)/i;
const MAX_BYTES = 40 * 1024 * 1024; // 40 MB ceiling per attachment (raw path)
// Legacy base64-JSON route: 10 MB decoded. Base64 peaks at ~3-6x the payload in
// process memory, so big files must use the raw path (the web client does).
const MAX_BASE64_BYTES = 10 * 1024 * 1024;
// Thumbnails (v2.89): a ≤512px webp/jpeg is a few tens of KB; 2 MB is generous.
const MAX_THUMB_BYTES = 2 * 1024 * 1024;

function safeName(name: string | undefined, fallback: string) {
  const trimmed = (name || "").trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

export function registerV2Upload(app: Express) {
  app.post("/api/v2/upload", async (req: Request, res: Response) => {
    try {
      // ── resolve caller identity via the SAME context resolver as tRPC and
      // the SSE bus (v2.88). The old hand-rolled resolution knew OAuth, guest
      // cookies, and device ids — but NOT the `relay_session` cookie minted by
      // email-OTP/PIN sign-in, so every registered (non-OAuth) member got a
      // 401 on avatars, attachments, and voice notes.
      let identityId: number | null = null;
      try {
        const ctx = await createContext({ req, res } as Parameters<typeof createContext>[0]);
        identityId = ctx.identity?.id ?? null;
      } catch {
        identityId = null;
      }
      if (identityId == null) {
        return res.status(401).json({ error: "No identity. Sign in or start a guest session." });
      }

      // ── extract payload (raw binary vs legacy base64 JSON) ──
      let buf: Buffer;
      let mimeType: string;
      let filename: string | undefined;
      let width: number | undefined;
      let height: number | undefined;
      let durationMs: number | undefined;
      const qnum = (v: unknown): number | undefined => {
        const n = typeof v === "string" ? Number(v) : NaN;
        return Number.isFinite(n) ? n : undefined;
      };
      let thumbKey: string | undefined;
      if (Buffer.isBuffer(req.body)) {
        // RAW path: bytes in the body, metadata in the query string.
        buf = req.body;
        mimeType = String(req.query.mime || "");
        filename = typeof req.query.filename === "string" ? req.query.filename : undefined;
        width = qnum(req.query.width);
        height = qnum(req.query.height);
        durationMs = qnum(req.query.durationMs);
        if (!mimeType) {
          return res.status(400).json({ error: "mime query parameter is required" });
        }
        // ── THUMBNAIL mode (v2.89): `?thumb=1` stores the bytes and returns
        // {storageKey,url} WITHOUT creating an attachment row. The client
        // uploads the ≤512px thumb first, then references its storageKey on
        // the full image's upload (`?thumbKey=`). Images only, small cap.
        if (req.query.thumb === "1") {
          if (!/^image\//i.test(mimeType) || BLOCKED_MIME.test(mimeType)) {
            return res.status(400).json({ error: "Thumbnails must be images" });
          }
          if (buf.length === 0) return res.status(400).json({ error: "Empty payload" });
          if (buf.length > MAX_THUMB_BYTES) {
            return res.status(413).json({ error: "Thumbnail exceeds 2 MB limit" });
          }
          const text = (mimeType.split("/")[1] || "img").split(/[+;]/)[0].slice(0, 8);
          const thash = crypto.randomBytes(4).toString("hex");
          // The identity-scoped prefix doubles as the OWNERSHIP check when the
          // key is later referenced on the main upload.
          const tkey = `relay-chat/${identityId}/thumb_${Date.now()}_${thash}.${text}`;
          const stored = await storagePut(tkey, buf, mimeType);
          return res.json({ thumb: true, storageKey: stored.key, url: stored.url });
        }
        // Optional thumbnail reference minted by a prior `?thumb=1` upload.
        // Must live in the CALLER'S OWN storage namespace — anything else could
        // graft a stranger's (or an arbitrary) object into a message bubble.
        // v2.91: the native S3 driver may bake a bucket-level prefix into
        // stored keys. With the DEFAULT prefix ("relay-chat/") the shape is
        // unchanged (ensure-style, no double-prefix); with a CUSTOM prefix the
        // key is `${prefix}relay-chat/<identityId>/…` — strip exactly one
        // configured prefix before the ownership check.
        const rawThumbKey = req.query.thumbKey;
        if (typeof rawThumbKey === "string" && rawThumbKey.length > 0) {
          const ownerNs = `relay-chat/${identityId}/`;
          const s3Prefix = s3Config()?.prefix ?? "";
          const inOwnerNs =
            rawThumbKey.startsWith(ownerNs) ||
            (!!s3Prefix &&
              rawThumbKey.startsWith(s3Prefix) &&
              rawThumbKey.slice(s3Prefix.length).startsWith(ownerNs));
          // Segment-wise traversal check (v2.91 review D2, same form as
          // storageProxy + sanitizeS3Key): a thumb filename may legally
          // contain ".." runs; only a full "."/".." path segment is hostile.
          const hasTraversalSegment = rawThumbKey
            .split("/")
            .some((s) => s === ".." || s === ".");
          if (rawThumbKey.length <= 256 && inOwnerNs && !hasTraversalSegment) {
            thumbKey = rawThumbKey;
          } else {
            return res.status(400).json({ error: "Invalid thumbKey" });
          }
        }
        if (buf.length > MAX_BYTES) {
          return res.status(413).json({ error: `Attachment exceeds ${Math.floor(MAX_BYTES / 1024 / 1024)} MB limit` });
        }
      } else {
        // LEGACY base64 JSON path (old clients + mobile/native).
        const body = (req.body || {}) as Record<string, unknown>;
        const dataBase64 = body.dataBase64;
        if (typeof dataBase64 !== "string" || typeof body.mimeType !== "string") {
          return res.status(400).json({ error: "dataBase64 and mimeType are required" });
        }
        mimeType = body.mimeType;
        filename = typeof body.filename === "string" ? body.filename : undefined;
        width = typeof body.width === "number" ? body.width : undefined;
        height = typeof body.height === "number" ? body.height : undefined;
        durationMs = typeof body.durationMs === "number" ? body.durationMs : undefined;
        // strip an optional `data:...;base64,` prefix
        const commaIdx = dataBase64.indexOf(",");
        const raw = dataBase64.startsWith("data:") && commaIdx > 0 ? dataBase64.slice(commaIdx + 1) : dataBase64;
        buf = Buffer.from(raw, "base64");
        if (buf.length > MAX_BASE64_BYTES) {
          return res.status(413).json({
            error: `Base64 uploads are capped at ${Math.floor(MAX_BASE64_BYTES / 1024 / 1024)} MB — send larger files as application/octet-stream`,
          });
        }
      }
      if (!ALLOWED_MIME.test(mimeType) || BLOCKED_MIME.test(mimeType)) {
        return res.status(400).json({ error: "Unsupported mime type" });
      }
      if (buf.length === 0) return res.status(400).json({ error: "Empty payload" });

      const ext = (mimeType.split("/")[1] || "bin").split(/[+;]/)[0].slice(0, 8);
      const hash = crypto.randomBytes(4).toString("hex");
      const fnSafe = safeName(filename, `attachment_${hash}.${ext}`);
      const key = `relay-chat/${identityId}/${Date.now()}_${hash}_${fnSafe}`;

      const { key: storedKey, url } = await storagePut(key, buf, mimeType);

      // The thumb's servable URL is derived from its key exactly the way
      // storagePut derives the main url — never taken from the client.
      const thumbUrl = thumbKey ? `/manus-storage/${thumbKey}` : null;

      const row = await recordAttachment({
        storageKey: storedKey,
        url,
        mimeType,
        sizeBytes: buf.length,
        width: typeof width === "number" ? width : null,
        height: typeof height === "number" ? height : null,
        durationMs: typeof durationMs === "number" ? durationMs : null,
        filename: fnSafe,
        thumbKey: thumbKey ?? null,
        thumbUrl,
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
        thumbUrl: row.thumbUrl ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Log but keep the API response narrow.
      console.error("[v2upload] failed:", msg);
      return res.status(500).json({ error: "Upload failed" });
    }
  });
}
