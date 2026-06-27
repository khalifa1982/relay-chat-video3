/* ──────────────────────────────────────────────────────────────────────────
 * Inbound email → post into a RELAY thread.
 *
 * Feature-gated like the rest: dormant until INBOUND_EMAIL_DOMAIN is set. When a
 * RELAY notification email is sent (e.g. a missed call), its Reply-To is a
 * SIGNED address that encodes the conversation + the recipient identity:
 *
 *     relay+{conversationId}.{identityId}.{sig}@{INBOUND_EMAIL_DOMAIN}
 *
 * `sig` is an HMAC over "{conversationId}.{identityId}" so a third party can't
 * forge an address to post into an arbitrary thread (they'd need our secret).
 * When the recipient replies, the operator's inbound provider (Resend Inbound)
 * webhooks the email to POST /api/email/inbound; we verify the signed address,
 * confirm membership, strip the quoted history, and post the reply as a message
 * FROM that identity into that conversation.
 *
 * Env:
 *   INBOUND_EMAIL_DOMAIN          enables the feature (e.g. "inbound.your-chat.org")
 *   INBOUND_EMAIL_LOCALPART       optional, default "relay"
 *   INBOUND_EMAIL_SECRET          optional; HMAC key (falls back to JWT_SECRET)
 *   INBOUND_EMAIL_WEBHOOK_SECRET  optional; Svix signing secret ("whsec_…") to
 *                                 verify the provider's webhook signature
 * ────────────────────────────────────────────────────────────────────────── */
import crypto from "crypto";
import { type Express } from "express";
import { getConversationParticipantIds, sendMessage, getIdentityById } from "./v2db";
import { getUserById } from "./db";
import { publishToIdentity } from "./v2events";
import { stripHtml } from "./email";

export interface InboundConfig {
  enabled: boolean;
  domain: string;
  localpart: string;
}

export function inboundConfig(): InboundConfig {
  const domain = (process.env.INBOUND_EMAIL_DOMAIN || "").trim().toLowerCase();
  const localpart = (process.env.INBOUND_EMAIL_LOCALPART || "relay").trim().toLowerCase();
  return { enabled: !!domain, domain, localpart };
}

function inboundSecret(): string {
  return process.env.INBOUND_EMAIL_SECRET || process.env.JWT_SECRET || "relay-inbound-dev-secret";
}

/** HMAC tag (first 20 hex chars) over the convo+identity tuple. */
export function signInbound(conversationId: number, identityId: number): string {
  return crypto
    .createHmac("sha256", inboundSecret())
    .update(`${conversationId}.${identityId}`)
    .digest("hex")
    .slice(0, 20);
}

/** Build the signed Reply-To address for (conversation, recipient identity). */
export function inboundAddress(conversationId: number, identityId: number): string {
  const { localpart, domain } = inboundConfig();
  const sig = signInbound(conversationId, identityId);
  return `${localpart}+${conversationId}.${identityId}.${sig}@${domain}`;
}

export interface ParsedInbound {
  conversationId: number;
  identityId: number;
}

/**
 * Parse + verify a signed inbound address. Accepts the full "Name <addr>" or a
 * bare address. Returns null if it isn't ours, is malformed, or the HMAC fails
 * (timing-safe compare).
 */
export function parseInboundAddress(raw: string): ParsedInbound | null {
  const cfg = inboundConfig();
  if (!cfg.enabled || !raw) return null;
  // Extract the bare address from "Display Name <addr>" if present.
  const angle = raw.match(/<([^>]+)>/);
  const addr = (angle ? angle[1] : raw).trim().toLowerCase();
  const at = addr.lastIndexOf("@");
  if (at < 0) return null;
  const local = addr.slice(0, at);
  const domain = addr.slice(at + 1);
  if (domain !== cfg.domain) return null;
  const plus = local.indexOf("+");
  if (plus < 0 || local.slice(0, plus) !== cfg.localpart) return null;
  const parts = local.slice(plus + 1).split(".");
  if (parts.length !== 3) return null;
  const conversationId = Number(parts[0]);
  const identityId = Number(parts[1]);
  const sig = parts[2];
  if (!Number.isInteger(conversationId) || conversationId <= 0) return null;
  if (!Number.isInteger(identityId) || identityId <= 0) return null;
  const expected = signInbound(conversationId, identityId);
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return { conversationId, identityId };
}

/**
 * Strip the quoted original + common signatures from a reply, leaving just the
 * newly-typed text. Handles "On … wrote:", leading ">" quote blocks, Outlook's
 * "-----Original Message-----", and "-- " signature delimiters.
 */
export function stripQuotedReply(body: string): string {
  if (!body) return "";
  const normalized = body.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^On .+wrote:$/i.test(t)) break; // "On Tue, … <x> wrote:"
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(t)) break;
    if (/^_{5,}$/.test(t)) break; // Outlook divider
    if (/^From:\s.+/i.test(t) && out.length > 0) break; // forwarded header block
    if (t === "--" || t === "-- ") break; // signature delimiter
    if (t.startsWith(">")) continue; // quoted line
    out.push(line);
  }
  return out.join("\n").trim();
}

/**
 * From a webhook payload of unknown-but-bounded shape, collect every candidate
 * recipient address (top-level or under `data`; string, array, or {address}
 * objects). Used to find OUR signed address among the To/Cc set.
 */
export function collectRecipients(payload: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown) => {
    if (!v) return;
    if (typeof v === "string") { out.push(v); return; }
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.address === "string") out.push(o.address);
      if (typeof o.email === "string") out.push(o.email);
    }
  };
  const root = payload as Record<string, unknown>;
  if (root && typeof root === "object") {
    visit(root.to);
    visit(root.cc);
    const data = root.data as Record<string, unknown> | undefined;
    if (data && typeof data === "object") {
      visit(data.to);
      visit(data.cc);
    }
  }
  return out;
}

/** Pull the best text body out of a webhook payload (text preferred over html). */
export function extractBody(payload: unknown): { text: string; html: string } {
  const root = (payload || {}) as Record<string, unknown>;
  const data = (root.data as Record<string, unknown>) || root;
  const text = typeof data.text === "string" ? data.text : (typeof root.text === "string" ? root.text : "");
  const html = typeof data.html === "string" ? data.html : (typeof root.html === "string" ? root.html : "");
  return { text, html };
}

/** Lowercased bare email from "Name <addr>" / "addr" / {address}|{email}. */
export function normalizeEmail(raw: unknown): string {
  let s = "";
  if (typeof raw === "string") s = raw;
  else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.address === "string") s = o.address;
    else if (typeof o.email === "string") s = o.email;
  }
  const angle = s.match(/<([^>]+)>/);
  return (angle ? angle[1] : s).trim().toLowerCase();
}

/** The sender address of the inbound email (top-level or under data). */
export function extractFrom(payload: unknown): string {
  const root = (payload || {}) as Record<string, unknown>;
  const data = (root.data as Record<string, unknown>) || {};
  return normalizeEmail(root.from ?? data.from ?? "");
}

/**
 * Verify a Svix-style webhook signature (the scheme Resend uses). Returns true
 * when no secret is configured (verification is opt-in hardening) OR when the
 * signature validates. Pure + testable.
 */
export function verifyWebhookSignature(
  rawBody: string,
  headers: { id?: string; timestamp?: string; signature?: string }
): boolean {
  const secret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET || "";
  if (!secret) return true; // opt-in; rely on the signed address otherwise
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  // Reject stale timestamps (>5 min skew) to blunt replay.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const keyB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(keyB64, "base64");
  } catch {
    return false;
  }
  const signed = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", key).update(signed).digest("base64");
  // Header is space-separated "v1,<sig>" pairs; accept if any matches.
  for (const part of signature.split(" ")) {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    if (!sig) continue;
    try {
      if (sig.length === expected.length &&
          crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return true;
      }
    } catch {
      /* length mismatch → not a match */
    }
  }
  return false;
}

/**
 * Mount POST /api/email/inbound — the provider (Resend Inbound) webhook. Always
 * replies 200 on OUR processing errors (so the provider doesn't retry forever);
 * a failed SIGNATURE check is the one 401. No-op (200, disabled) until
 * INBOUND_EMAIL_DOMAIN is set.
 */
export function registerEmailInbound(app: Express): void {
  // The global express.json() parses req.body AND stashes the exact bytes on
  // req.rawBody for this path (see _core/index.ts) — we verify the signature
  // over rawBody and read the already-parsed payload from req.body.
  app.post(
    "/api/email/inbound",
    async (req, res) => {
      try {
        if (!inboundConfig().enabled) {
          res.status(200).json({ ok: false, reason: "disabled" });
          return;
        }
        const rawBuf = (req as { rawBody?: Buffer }).rawBody;
        // Use the EXACT bytes for signature verification; if they're somehow
        // missing, raw="" fails the HMAC closed (only matters when a webhook
        // secret is configured — otherwise verifyWebhookSignature returns true).
        const raw = Buffer.isBuffer(rawBuf) ? rawBuf.toString("utf8") : "";
        const sigOk = verifyWebhookSignature(raw, {
          id: req.header("svix-id") || req.header("webhook-id") || undefined,
          timestamp: req.header("svix-timestamp") || req.header("webhook-timestamp") || undefined,
          signature: req.header("svix-signature") || req.header("webhook-signature") || undefined,
        });
        if (!sigOk) {
          console.warn("[inbound] webhook signature verification failed");
          res.status(401).json({ ok: false, reason: "bad-signature" });
          return;
        }
        // req.body was parsed by the global express.json(); fall back to parsing
        // rawBody only if (somehow) body is empty.
        let payload: unknown = req.body;
        if (payload == null || (typeof payload === "object" && Object.keys(payload as object).length === 0)) {
          try {
            payload = JSON.parse(raw);
          } catch {
            res.status(200).json({ ok: false, reason: "bad-json" });
            return;
          }
        }
        // Find OUR signed address among the recipients (bounded — don't HMAC an
        // unbounded recipient list).
        let parsed: ParsedInbound | null = null;
        for (const r of collectRecipients(payload).slice(0, 50)) {
          parsed = parseInboundAddress(r);
          if (parsed) break;
        }
        if (!parsed) {
          res.status(200).json({ ok: false, reason: "no-match" });
          return;
        }
        // Defense in depth: the signed identity must actually be in the thread.
        const members = await getConversationParticipantIds(parsed.conversationId);
        if (!members.includes(parsed.identityId)) {
          res.status(200).json({ ok: false, reason: "not-member" });
          return;
        }
        // Bind the reply to the mailbox owner: the email's From MUST match the
        // registered email of the signed identity. This stops a leaked/forwarded
        // reply address from being replayed by a different sender to post as that
        // user (the signed address alone is otherwise a bearer credential).
        const ident = await getIdentityById(parsed.identityId);
        const ownerEmail =
          ident?.userId != null ? (await getUserById(ident.userId))?.email : null;
        const from = extractFrom(payload);
        if (!ownerEmail || !from || from !== ownerEmail.trim().toLowerCase()) {
          console.warn("[inbound] From mismatch — dropping reply");
          res.status(200).json({ ok: false, reason: "from-mismatch" });
          return;
        }
        const { text, html } = extractBody(payload);
        const body = stripQuotedReply(text || stripHtml(html)).slice(0, 8000);
        if (!body) {
          res.status(200).json({ ok: false, reason: "empty" });
          return;
        }
        // A DB failure here would otherwise be swallowed as 200 (provider won't
        // retry) → the user's reply is lost. Return 5xx so the provider retries.
        let row;
        try {
          row = await sendMessage({
            conversationId: parsed.conversationId,
            senderIdentityId: parsed.identityId,
            kind: "text",
            body,
            meta: { viaEmail: true },
          });
        } catch (dbErr) {
          console.warn("[inbound] sendMessage failed:", dbErr);
          res.status(503).json({ ok: false, reason: "store-failed" });
          return;
        }
        for (const pid of members) {
          try {
            publishToIdentity(pid, {
              kind: "message",
              conversationId: parsed.conversationId,
              from: parsed.identityId,
            });
          } catch {
            /* push is best-effort */
          }
        }
        res.status(200).json({ ok: true, id: row?.id });
      } catch (err) {
        console.warn("[inbound] error:", err);
        res.status(200).json({ ok: false, reason: "error" });
      }
    }
  );
}
