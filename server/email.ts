/* ============================================================
   Outbound email via Resend (feature-gated on RESEND_API_KEY).

   Plain `fetch` to https://api.resend.com/emails — no `resend` npm
   dependency needed for outbound. Every call site is fire-and-forget:
   sendEmail() NEVER throws; it logs and returns { ok:false } on failure.

   TEST-MODE FROM CONSTRAINT: with ONLY a RESEND_API_KEY and no
   DNS-verified sending domain, Resend is in test mode — it delivers
   only FROM `onboarding@resend.dev` TO the Resend account owner's own
   email; any other recipient returns 422 (logged, harmless). To email
   arbitrary registered users, verify a sending domain in the Resend
   dashboard (add the DKIM/SPF DNS records) and set
   RESEND_FROM="RELAY <notifications@yourdomain.com>".
   ============================================================ */

import { smtpConfig, smtpSend } from "./smtp";

export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string | string[];
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  skippedReason?: string;
  error?: string;
}

/**
 * v2.92 (R4A): explicit MAIL_PROVIDER switch (read per-call, like everything
 * else here):
 *   "smtp"       → force the built-in SMTP client, even if RESEND_API_KEY is
 *                  set. Resend is NEVER used — not even as a failure fallback.
 *   "resend"     → force Resend, even if SMTP_HOST is set. SMTP is skipped.
 *   unset/other  → "auto", the historical behavior: SMTP first when configured,
 *                  Resend as the fallback.
 */
export function mailProvider(): "smtp" | "resend" | "auto" {
  const v = (process.env.MAIL_PROVIDER || "").trim().toLowerCase();
  if (v === "smtp" || v === "resend") return v;
  return "auto";
}

/** Read per-call (like iceServers/TURN) so the key can be added via Manus
 *  Secrets without a restart. v2.87: the BUILT-IN SMTP client (server/smtp.ts,
 *  SMTP_HOST et al.) takes priority — no third-party API; Resend remains a
 *  fallback for deploys that still use it. v2.92: MAIL_PROVIDER can force
 *  either side, in which case only that side counts as "enabled". */
export function emailEnabled(): boolean {
  const provider = mailProvider();
  if (provider === "smtp") return Boolean(smtpConfig());
  if (provider === "resend") return Boolean(process.env.RESEND_API_KEY);
  return Boolean(smtpConfig()) || Boolean(process.env.RESEND_API_KEY);
}

export function emailFrom(): string {
  // v2.92 (P2): EMAIL_FROM (the SES-style var, already the SMTP_FROM alias in
  // server/smtp.ts) is honored under Resend too, so one From var covers both
  // providers. An explicit RESEND_FROM still wins.
  return process.env.RESEND_FROM || process.env.EMAIL_FROM || "onboarding@resend.dev";
}

/**
 * Wrap a transactional email's inner HTML fragment in a complete, standards-
 * compliant HTML document (ROUND 5 / v2.92.2).
 *
 * Every RELAY email template used to return a bare `<div>`. Mail clients handle
 * that inconsistently — Gmail and Outlook reflow or re-style a fragment that
 * lacks a `<!doctype>`/`<head>`, and with no `charset` non-ASCII copy can
 * mojibake. This adds the envelope every transactional email should carry:
 * doctype, `<html lang>`, UTF-8 charset, a mobile viewport, and a `<title>`.
 *
 * The body stays LIGHT on purpose. All RELAY fragments are light-themed
 * (near-black text on light inner cards) and the inner HTML is emitted VERBATIM,
 * so a light body preserves each email's exact existing appearance — the
 * instruction's skeleton showed a dark `#0b0c10` body (copied from the
 * verified-account browser page), which would render our dark copy unreadable.
 * `color-scheme:light` also stops dark-mode clients from auto-inverting the
 * palette and washing the text out.
 *
 * `title` is a TRUSTED static string at every call site and is NOT escaped
 * here — never pass user-controlled text as the title.
 */
export function wrapEmailDocument(inner: string, title: string): string {
  return (
    `<!doctype html><html lang="en"><head>` +
    `<meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light">` +
    `<title>${title}</title></head>` +
    `<body style="margin:0;padding:0;background:#ffffff;color:#0E1014">${inner}</body></html>`
  );
}

/** Best-effort plain-text fallback from HTML (strip tags + unescape entities). */
export function stripHtml(html: string): string {
  return html
    // Drop the document head (title + metas) so the ROUND-5 envelope's <title>
    // never leaks into the text/plain fallback — the body copy stays identical.
    // \b so this never matches the start of a <header> element.
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const provider = mailProvider();
  // v2.87: built-in SMTP first — the operator's own mailbox, no third party.
  // v2.92: MAIL_PROVIDER=resend skips this branch even when SMTP_HOST is set.
  if (provider !== "resend" && smtpConfig()) {
    const to = Array.isArray(input.to) ? input.to : [input.to];
    const replyTo = Array.isArray(input.replyTo) ? input.replyTo[0] : input.replyTo;
    const r = await smtpSend({
      to,
      subject: input.subject,
      html: input.html,
      text: input.text ?? stripHtml(input.html),
      replyTo,
    });
    if (r.ok) return { ok: true };
    // v2.92: MAIL_PROVIDER=smtp means SMTP is authoritative — a failure is a
    // failure, never silently rerouted through a third party the operator
    // explicitly opted out of.
    if (provider === "smtp") {
      console.warn(`[email] smtp send failed (${r.error}) — MAIL_PROVIDER=smtp, no Resend fallback`);
      return { ok: false, error: r.error };
    }
    console.warn(`[email] smtp send failed (${r.error}) — trying Resend fallback if configured`);
    // fall through to Resend when it's also configured
  }
  if (provider === "smtp") {
    // Forced SMTP but SMTP_HOST isn't set — honest no-op, mirrors the
    // no-RESEND_API_KEY gate below.
    console.log(
      `[email] disabled (MAIL_PROVIDER=smtp but no SMTP_HOST) — would send to ${JSON.stringify(input.to)} subject="${input.subject}"`
    );
    return { ok: false, skippedReason: "disabled" };
  }
  const apiKey = process.env.RESEND_API_KEY || "";
  if (!apiKey) {
    // Feature gate — call sites never need to guard.
    console.log(
      `[email] disabled (no RESEND_API_KEY) — would send to ${JSON.stringify(input.to)} subject="${input.subject}"`
    );
    return { ok: false, skippedReason: "disabled" };
  }
  const body: Record<string, unknown> = {
    from: input.from || emailFrom(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text ?? stripHtml(input.html),
  };
  if (input.replyTo) body.reply_to = input.replyTo; // Resend uses snake_case
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // The test-mode 422 (non-owner recipient without a verified domain)
      // surfaces here — logged, never thrown.
      console.warn(
        `[email] Resend ${res.status} sending to ${JSON.stringify(input.to)}: ${detail}`
      );
      return { ok: false, error: `resend ${res.status}: ${detail}` };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: json.id };
  } catch (err) {
    console.warn("[email] send failed:", err);
    return { ok: false, error: String(err) };
  }
}
