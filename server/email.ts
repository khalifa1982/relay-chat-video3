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

/** Read per-call (like iceServers/TURN) so the key can be added via Manus
 *  Secrets without a restart. */
export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function emailFrom(): string {
  return process.env.RESEND_FROM || "onboarding@resend.dev";
}

/** Best-effort plain-text fallback from HTML (strip tags + unescape entities). */
export function stripHtml(html: string): string {
  return html
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
