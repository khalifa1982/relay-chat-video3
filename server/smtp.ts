/**
 * Built-in SMTP mailer (v2.87) — email WITHOUT a third-party API.
 *
 * A zero-dependency SMTP client on node:net/node:tls: EHLO → STARTTLS (587)
 * or implicit TLS (465) → AUTH LOGIN → MAIL FROM/RCPT TO → DATA. Works with
 * ANY standard mailbox: the operator's domain mail server, a hosting
 * provider's SMTP, Gmail with an app password, etc. When configured it takes
 * priority over Resend in server/email.ts (which remains only as a fallback).
 *
 * Honest constraint (why credentials are still required): truly serverless
 * direct-to-MX delivery is impossible from this deployment — Cloud Run blocks
 * outbound port 25 entirely, and mail sent without SPF/DKIM alignment is
 * rejected or spam-foldered by every major receiver. "Built into the server"
 * therefore means: the PROTOCOL client is built in (no third-party SDK or
 * API), pointed at a mailbox you own.
 *
 * Env (add via Manus Settings → Secrets; read per-call like TURN_*):
 *   SMTP_HOST     — e.g. mail.example.com / email-smtp.<region>.amazonaws.com /
 *                   smtp.gmail.com  (enables SMTP)
 *   SMTP_PORT     — default 587 (STARTTLS); use 465 with SMTP_SECURE=1
 *   SMTP_SECURE   — "1" = implicit TLS from byte one (port 465 style)
 *   SMTP_USER     — mailbox login
 *   SMTP_PASS     — mailbox password / app password
 *   SMTP_FROM     — sender, e.g. "RELAY <no-reply@example.com>"
 *   EMAIL_FROM    — v2.92: accepted as an ALIAS for SMTP_FROM (checked second).
 *                   AWS SES .envs commonly use this name; without either, From
 *                   falls back to SMTP_USER — which on SES is an AKIA… key id
 *                   that SES rejects as a sender, so set one of the two.
 *   MAIL_PROVIDER — v2.92, lives in server/email.ts: "smtp" forces this SMTP
 *                   path (Resend never used), "resend" forces Resend (SMTP
 *                   ignored), unset/other = auto (SMTP first, Resend fallback).
 */
import net from "net";
import tls from "tls";
import crypto from "crypto";

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/** Resolved SMTP config, or null when not configured. */
export function smtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST || "";
  if (!host) return null;
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const secure = process.env.SMTP_SECURE === "1" || process.env.SMTP_SECURE === "true";
  const port = Number(process.env.SMTP_PORT || (secure ? 465 : 587));
  return {
    host,
    port,
    secure,
    user,
    pass,
    // v2.92 (R4A): EMAIL_FROM is an accepted alias for SMTP_FROM — the owner's
    // SES .env uses it. Order matters: an explicit SMTP_FROM still wins; the
    // SMTP_USER fallback stays last (it's an AKIA… access-key id on SES, which
    // SES rejects as a From — the alias exists precisely to avoid that).
    from: process.env.SMTP_FROM || process.env.EMAIL_FROM || user,
  };
}

/* ── pure, unit-tested building blocks ───────────────────────────────────── */

/** RFC 5321 §4.5.2 dot-stuffing: a line starting with "." gets a "." prefix. */
export function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
}

/** Pull the display address out of `Name <addr>` (or pass a bare addr through). */
export function bareAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

/**
 * Parse one (possibly multi-line) SMTP reply. Returns the 3-digit code and
 * whether more lines of the same reply are still expected ("250-..." form).
 */
export function parseSmtpReply(line: string): { code: number; more: boolean } {
  const code = Number(line.slice(0, 3));
  return { code: Number.isFinite(code) ? code : 0, more: line.charAt(3) === "-" };
}

/** Build the full RFC 822 message (headers + multipart/alternative body). */
export function buildMimeMessage(input: {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  date?: Date;
  messageId?: string;
}): string {
  const boundary = "relay-" + crypto.randomBytes(12).toString("hex");
  const date = (input.date ?? new Date()).toUTCString();
  const domain = bareAddress(input.from).split("@")[1] || "relay.local";
  const messageId = input.messageId ?? `<${crypto.randomBytes(16).toString("hex")}@${domain}>`;
  // RFC 2047 is overkill for our ASCII subjects; encode defensively anyway.
  const subject = /^[\x20-\x7e]*$/.test(input.subject)
    ? input.subject
    : `=?UTF-8?B?${Buffer.from(input.subject, "utf8").toString("base64")}?=`;
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to.join(", ")}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    ...(input.replyTo ? [`Reply-To: ${input.replyTo}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.html, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
    `--${boundary}--`,
    "",
  ];
  return lines.join("\r\n");
}

/* ── the wire client ─────────────────────────────────────────────────────── */

const SMTP_TIMEOUT_MS = 20_000;

interface Wire {
  write(data: string): void;
  /** Await the next complete reply (multi-line aware). */
  reply(): Promise<number>;
  upgradeTls(host: string): Promise<void>;
  end(): void;
}

function makeWire(socket: net.Socket | tls.TLSSocket, onSocketSwap: (s: tls.TLSSocket) => void): Wire {
  let sock: net.Socket | tls.TLSSocket = socket;
  let buffer = "";
  let waiter: { resolve: (code: number) => void; reject: (e: Error) => void } | null = null;

  const pump = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    // Deliver only when the FINAL line of the reply has arrived ("250 " form).
    for (;;) {
      const nl = buffer.indexOf("\r\n");
      if (nl < 0) return;
      const line = buffer.slice(0, nl);
      const { code, more } = parseSmtpReply(line);
      buffer = buffer.slice(nl + 2);
      if (!more) {
        waiter?.resolve(code);
        waiter = null;
        return;
      }
    }
  };
  const fail = (e: Error) => {
    waiter?.reject(e);
    waiter = null;
  };
  const attach = (s: net.Socket | tls.TLSSocket) => {
    s.on("data", pump);
    s.on("error", fail);
    s.on("close", () => fail(new Error("smtp: connection closed")));
    s.setTimeout(SMTP_TIMEOUT_MS, () => { fail(new Error("smtp: timeout")); s.destroy(); });
  };
  attach(sock);

  return {
    write: data => { sock.write(data); },
    reply: () =>
      new Promise<number>((resolve, reject) => {
        if (waiter) { reject(new Error("smtp: overlapping reads")); return; }
        waiter = { resolve, reject };
      }),
    upgradeTls: (host: string) =>
      new Promise<void>((resolve, reject) => {
        sock.removeAllListeners("data");
        sock.removeAllListeners("error");
        sock.removeAllListeners("close");
        sock.setTimeout(0);
        const secured = tls.connect({ socket: sock, host, servername: host }, () => resolve());
        secured.on("error", reject);
        attach(secured);
        sock = secured;
        onSocketSwap(secured);
      }),
    end: () => { try { sock.end(); } catch { /* */ } },
  };
}

export interface SmtpSendResult {
  ok: boolean;
  error?: string;
}

/** Send one message. Never throws — errors come back in the result. */
export async function smtpSend(input: {
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}): Promise<SmtpSendResult> {
  const cfg = smtpConfig();
  if (!cfg) return { ok: false, error: "smtp not configured" };
  let wire: Wire | null = null;
  try {
    const raw: net.Socket | tls.TLSSocket = cfg.secure
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
      : net.connect({ host: cfg.host, port: cfg.port });
    await new Promise<void>((resolve, reject) => {
      raw.once(cfg.secure ? "secureConnect" : "connect", () => resolve());
      raw.once("error", reject);
    });
    let w = makeWire(raw, () => { /* swapped internally */ });
    wire = w;

    const expect = async (want: number, what: string) => {
      const code = await w.reply();
      if (code !== want) throw new Error(`smtp: ${what} got ${code} (wanted ${want})`);
    };

    await expect(220, "greeting");
    w.write(`EHLO relay.app\r\n`);
    await expect(250, "EHLO");
    if (!cfg.secure) {
      w.write("STARTTLS\r\n");
      await expect(220, "STARTTLS");
      await w.upgradeTls(cfg.host);
      w.write(`EHLO relay.app\r\n`);
      await expect(250, "EHLO (tls)");
    }
    if (cfg.user) {
      w.write("AUTH LOGIN\r\n");
      await expect(334, "AUTH LOGIN");
      w.write(Buffer.from(cfg.user, "utf8").toString("base64") + "\r\n");
      await expect(334, "AUTH user");
      w.write(Buffer.from(cfg.pass, "utf8").toString("base64") + "\r\n");
      await expect(235, "AUTH pass");
    }
    w.write(`MAIL FROM:<${bareAddress(cfg.from)}>\r\n`);
    await expect(250, "MAIL FROM");
    for (const rcpt of input.to) {
      w.write(`RCPT TO:<${bareAddress(rcpt)}>\r\n`);
      await expect(250, "RCPT TO");
    }
    w.write("DATA\r\n");
    await expect(354, "DATA");
    const mime = buildMimeMessage({
      from: cfg.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      replyTo: input.replyTo,
    });
    w.write(dotStuff(mime) + "\r\n.\r\n");
    await expect(250, "message accept");
    w.write("QUIT\r\n");
    wire.end();
    return { ok: true };
  } catch (err) {
    try { wire?.end(); } catch { /* */ }
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}
