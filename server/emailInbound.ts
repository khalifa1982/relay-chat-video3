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
 *   INBOUND_EMAIL_DOMAIN          enables the feature (e.g. "inbound.example.org")
 *   INBOUND_EMAIL_LOCALPART       optional, default "relay"
 *   INBOUND_EMAIL_SECRET          optional; HMAC key (falls back to JWT_SECRET)
 *   INBOUND_EMAIL_WEBHOOK_SECRET  optional; Svix signing secret ("whsec_…") to
 *                                 verify the provider's webhook signature
 * ────────────────────────────────────────────────────────────────────────── */
import crypto from "crypto";
import { type Express, type Request, type Response } from "express";
import {
  getConversationParticipantIds,
  sendMessage,
  getIdentityById,
  getIdentityByUserId,
  getOrCreateDmConversation,
  setUserNotificationPrefs,
} from "./v2db";
import { getUserById, getUserByOpenId } from "./db";
import { publishToIdentity } from "./v2events";
import { stripHtml } from "./email";
import { createRateLimiter, clientIpOf } from "./rateLimit";
import { verifyUnsubscribeToken } from "./unsubscribe";

// SECURITY (S11): the inbound webhook was unthrottled. Add a modest per-IP token
// bucket — a legitimate provider (Resend Inbound) fires occasional webhooks, so
// this never bites real traffic but caps abuse/replay floods. Honors
// RELAY_RATELIMIT_OFF like the other gates.
const inboundIpLimiter = createRateLimiter({ capacity: 60, refillPerSec: 1 });
// The unsubscribe route is unauthenticated and does a DB read+write per POST,
// so it gets its OWN modest bucket (a shared one would let unsubscribe traffic
// starve the provider webhook, and vice versa). Swept like every other limiter.
const unsubscribeIpLimiter = createRateLimiter({ capacity: 30, refillPerSec: 0.5 });
setInterval(() => unsubscribeIpLimiter.sweep(Date.now(), 30 * 60_000), 30 * 60_000).unref();

/** Escape a value destined for a double-quoted HTML attribute. */
function escapeHtmlAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
setInterval(() => inboundIpLimiter.sweep(Date.now(), 30 * 60_000), 30 * 60_000).unref();

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
  const secret = process.env.INBOUND_EMAIL_SECRET || process.env.JWT_SECRET;
  if (secret) return secret;
  // SECURITY (S11): this key signs the reply-to address that binds an inbound
  // email to a conversation. The public constant fallback would let anyone forge
  // a valid reply address in production — fail CLOSED there (a real deploy always
  // has JWT_SECRET). Dev/test keep the fallback so the flow stays runnable
  // without an env.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "INBOUND_EMAIL_SECRET or JWT_SECRET must be set in production — refusing to sign inbound reply addresses with the public dev fallback."
    );
  }
  return "relay-inbound-dev-secret";
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
/**
 * Longest header value we will even attempt to parse as an address.
 *
 * SECURITY (M42 — ReDoS / event-loop stall): `raw` is an untrusted header value
 * off the inbound-email webhook body, and that route accepts 5 MB of JSON. The
 * `/<([^>]+)>/` match below backtracks quadratically on input that contains a
 * `<` but NO `>`: for every `<` position the engine lets `[^>]+` run to the end
 * of the string, fails to find `>`, then gives back one character at a time. A
 * 5 MB payload of `<` is therefore on the order of 10^13 steps. Node is
 * single-threaded and this process serves every SSE stream, every signaling POST
 * and the whole API, so ONE such request stalls calls and messaging for all
 * users — a full outage from a single POST, and the webhook signature check is
 * opt-in (`INBOUND_EMAIL_WEBHOOK_SECRET`), so it can be unauthenticated.
 *
 * A real value is tiny: RFC 5321 caps an addr-spec at 320 bytes, and a
 * display-name plus angle-addr is still far under this. Rejecting anything
 * longer costs nothing legitimate and makes the regex's worst case irrelevant by
 * bounding n, rather than relying on a cleverer pattern.
 */
const MAX_INBOUND_ADDRESS_LEN = 1024;

export function parseInboundAddress(raw: string): ParsedInbound | null {
  const cfg = inboundConfig();
  if (!cfg.enabled || !raw) return null;
  if (raw.length > MAX_INBOUND_ADDRESS_LEN) return null; // M42 — see above
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

/** The subject line of the inbound email (top-level or under data). */
export function extractSubject(payload: unknown): string {
  const root = (payload || {}) as Record<string, unknown>;
  const data = (root.data as Record<string, unknown>) || {};
  const s = root.subject ?? data.subject;
  return typeof s === "string" ? s.trim() : "";
}

/**
 * ROUND 6 — support routing. True when any recipient is
 * support[+tag]@INBOUND_EMAIL_DOMAIN (case-insensitive; the +tag is ignored).
 * Pure + exported for tests.
 */
export function isSupportRecipient(recipients: string[], domain: string): boolean {
  const d = (domain || "").trim().toLowerCase();
  if (!d) return false;
  for (const r of recipients) {
    const addr = normalizeEmail(r);
    const at = addr.lastIndexOf("@");
    if (at < 0 || addr.slice(at + 1) !== d) continue;
    const local = addr.slice(0, at);
    const bare = local.includes("+") ? local.slice(0, local.indexOf("+")) : local;
    if (bare === "support") return true;
  }
  return false;
}

/** The message body a routed support email produces in the owner's thread. */
export function formatSupportBody(from: string, subject: string, text: string): string {
  const subj = subject || "(no subject)";
  const body = (text || "").trim();
  return `📧 ${from || "(unknown sender)"}\nSubject: ${subj}\n\n${body}`.slice(0, 8000);
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
 * Mount `/api/email/unsubscribe` (v2.99.42) — the opt-out carried by the
 * offline-message nudge's `List-Unsubscribe` header and its footer link.
 *
 * GET NEVER WRITES; only POST does. That split is the whole point, not
 * pedantry: the token appears twice in the recipient's inbox, and mail security
 * gateways routinely FETCH links found in mail to detonate them (Microsoft Safe
 * Links, Proofpoint/Barracuda URL rewriting, corporate AV scanners). Express
 * also answers HEAD from `app.get`. So a handler that wrote on GET would let a
 * scanner silently unsubscribe someone before they ever opened the message —
 * they'd just stop getting notifications, with nothing to explain why. Exactly
 * the failure RFC 8058 introduced one-click POST to avoid.
 *
 * So GET renders a confirm page whose button POSTs (no sign-in, still one
 * click), and the RFC 8058 flow is unaffected because a mail client honouring
 * `List-Unsubscribe-Post` POSTs on its own.
 *
 * Neither verb needs a session: the token IS the authorization. It can only
 * turn message email OFF — never on, and it reaches no other setting — so a
 * leaked link costs at most one channel the user re-enables in Profile.
 */
export function registerEmailUnsubscribe(app: Express): void {
  const page = (res: Response, title: string, detail: string, status: number, formAction?: string) => {
    // formAction is only ever passed a token that has ALREADY verified, so it is
    // `<digits>.<base64url>` by construction; escaped anyway, because reflecting
    // a query parameter into markup is how this kind of page grows an XSS.
    const button = formAction
      ? `<form method="post" action="${escapeHtmlAttr(formAction)}" style="margin:26px 0 0">` +
        `<button type="submit" style="appearance:none;border:0;cursor:pointer;background:#3FE0C5;color:#04201B;` +
        `font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:14px 24px;border-radius:12px">` +
        `Unsubscribe me</button></form>`
      : "";
    res
      .status(status)
      .type("html")
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
          `<meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<meta name="robots" content="noindex">` +
          `<title>${title} · RELAY</title></head>` +
          `<body style="margin:0;background:#0E1014;color:#F5F7FA;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">` +
          `<div style="max-width:440px;margin:12vh auto;padding:0 24px;text-align:center">` +
          `<div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">RELAY</div>` +
          `<h1 style="font-size:22px;margin:20px 0 10px">${title}</h1>` +
          `<p style="font-size:15px;line-height:1.6;color:#A7B0BF;margin:0">${detail}</p>` +
          button +
          `</div></body></html>`
      );
  };
  const badLink = (res: Response) =>
    page(
      res,
      "That link didn't work",
      "It may have been altered in transit. You can turn message emails off any time in RELAY under Profile → Notifications.",
      400
    );

  // GET / HEAD — read-only. Verify the token so a broken link still says so,
  // then offer the button. No write happens on this path.
  app.get("/api/email/unsubscribe", (req: Request, res: Response) => {
    const raw = typeof req.query.t === "string" ? req.query.t : "";
    const userId = raw ? verifyUnsubscribeToken(raw) : null;
    if (!userId) {
      badLink(res);
      return;
    }
    page(
      res,
      "Turn off message emails?",
      "We'll stop emailing you when messages arrive while you're offline. Calls and messages still reach you in the app, and you can turn these emails back on in Profile → Notifications.",
      200,
      `/api/email/unsubscribe?t=${encodeURIComponent(raw)}`
    );
  });

  // POST — the only writing path. Used by the confirm button above AND by mail
  // clients doing RFC 8058 one-click (whose body we don't need to read).
  app.post("/api/email/unsubscribe", async (req: Request, res: Response) => {
    if (
      process.env.RELAY_RATELIMIT_OFF !== "1" &&
      !unsubscribeIpLimiter.allow(clientIpOf(req), Date.now())
    ) {
      res.status(429).type("text").send("Too many requests — please try again shortly.");
      return;
    }
    const raw = typeof req.query.t === "string" ? req.query.t : "";
    const userId = raw ? verifyUnsubscribeToken(raw) : null;
    if (!userId) {
      badLink(res);
      return;
    }
    try {
      await setUserNotificationPrefs(userId, { emailNotifyMessage: false });
      page(
        res,
        "You're unsubscribed",
        "We won't email you about new messages again. Calls and messages still arrive in the app as normal, and you can turn these emails back on in Profile → Notifications.",
        200
      );
    } catch {
      // The write failed — say so honestly rather than claiming success for
      // something that didn't happen.
      page(
        res,
        "We couldn't save that",
        "Something went wrong on our side. Please try the link again, or turn message emails off in RELAY under Profile → Notifications.",
        500
      );
    }
  });
}

/**
 * Mount POST /api/email/inbound — the provider (Resend Inbound) webhook. Always
 * replies 200 on OUR processing errors (so the provider doesn't retry forever);
 * a failed SIGNATURE check is the one 401. No-op (200, disabled) until
 * INBOUND_EMAIL_DOMAIN is set.
 */
export function registerEmailInbound(app: Express): void {
  registerEmailUnsubscribe(app);
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
        if (
          process.env.RELAY_RATELIMIT_OFF !== "1" &&
          !inboundIpLimiter.allow(clientIpOf(req), Date.now())
        ) {
          res.status(429).json({ ok: false, reason: "rate_limited" });
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
        const recipients = collectRecipients(payload).slice(0, 50);
        let parsed: ParsedInbound | null = null;
        for (const r of recipients) {
          parsed = parseInboundAddress(r);
          if (parsed) break;
        }
        if (!parsed) {
          // ROUND 6 — support@ routing. Mail to support@<domain> has no signed
          // address by design (it comes from strangers), so it lands here.
          // Deliver it to the APP OWNER as a message in their self ("Notes")
          // conversation. The from-mismatch check is deliberately SKIPPED for
          // this branch — it exists only to bind conversation REPLIES to their
          // mailbox owner; support mail is unauthenticated by nature (and the
          // webhook signature above already proves it came via our provider).
          if (isSupportRecipient(recipients, inboundConfig().domain)) {
            const openId = (process.env.OWNER_OPEN_ID || "").trim();
            const owner = openId ? await getUserByOpenId(openId).catch(() => null) : null;
            const ownerIdent = owner ? await getIdentityByUserId(owner.id).catch(() => null) : null;
            if (!ownerIdent) {
              console.warn("[inbound] support email but no owner identity (OWNER_OPEN_ID)");
              res.status(200).json({ ok: false, reason: "support-no-owner" });
              return;
            }
            const { text, html } = extractBody(payload);
            const bodyText = (text || stripHtml(html)).trim();
            const supportBody = formatSupportBody(extractFrom(payload), extractSubject(payload), bodyText);
            try {
              const convo = await getOrCreateDmConversation(ownerIdent.id, ownerIdent.id);
              const row = await sendMessage({
                conversationId: convo.id,
                senderIdentityId: ownerIdent.id,
                kind: "text",
                body: supportBody,
                meta: { viaEmail: true, support: true },
              });
              try {
                publishToIdentity(ownerIdent.id, {
                  kind: "message",
                  conversationId: convo.id,
                  from: ownerIdent.id,
                });
              } catch { /* best-effort */ }
              res.status(200).json({ ok: true, routed: "support", id: row?.id });
            } catch (dbErr) {
              // 5xx so the provider retries — a support mail must not be lost.
              console.warn("[inbound] support store failed:", dbErr);
              res.status(503).json({ ok: false, reason: "store-failed" });
            }
            return;
          }
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
