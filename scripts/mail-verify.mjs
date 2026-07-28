#!/usr/bin/env node
/**
 * Prove the FLEET can deliver mail to a given address — the second of task
 * #44's three items ("offline-message email delivery").
 *
 * WHERE IT RUNS, AND WHY IT CANNOT RUN ANYWHERE ELSE
 * -------------------------------------------------
 * The SMTP credentials exist only in /home/relay/.env on the app instances, so
 * this runs there (via the `live-verify` action in aws-ops.yml). Nothing secret
 * is printed: not SMTP_PASS, not the AUTH payload, not the server's greeting
 * banner beyond its first line.
 *
 * WHY IT STOPS BEFORE `DATA` BY DEFAULT
 * -------------------------------------
 * The thing that actually broke in production (v2.97.2) was not the mailer — it
 * was that SES was in its SANDBOX, so it refused every recipient that was not a
 * pre-verified identity. An SMTP server decides that at `RCPT TO`, before a
 * single byte of the message body. So the default dialogue is
 *
 *     EHLO → STARTTLS → EHLO → AUTH → MAIL FROM → RCPT TO → RSET → QUIT
 *
 * which answers "can this fleet, with these credentials, deliver to that
 * person" exactly, and sends NO mail to them. That matters: a health check that
 * mails somebody every time it runs is a health check people turn off. Pass
 * `--send` when you want a real message to land in the inbox — an end-to-end
 * confirmation a human then reads.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not import the app's own `sendEmail`. That lives inside the esbuild
 * bundle (`dist/index.js`) with no separate entry point, and a parallel
 * implementation of the mailer is the one thing that must not exist here — a
 * second copy could pass while production was broken (the objection recorded
 * against a parallel test sender in v2.99.91). So this speaks the protocol
 * directly and verifies the TRANSPORT and the CREDENTIALS, which is the half
 * that can fail in production only; the message-building half is unit-tested in
 * `server/emailTemplates.test.ts` against the real functions.
 *
 * Exit 0 = the fleet can deliver to that address. 1 = it cannot, and the
 * refusal is printed verbatim so the reason is the server's own words rather
 * than my paraphrase of them.
 *
 *   node scripts/mail-verify.mjs --to someone@example.com
 *   node scripts/mail-verify.mjs --to someone@example.com --send
 */
import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

/** The From address, resolved by the SAME precedence `server/smtp.ts` uses.
 *  A second rule here would be a second answer to "who are we sending as",
 *  which is how a check comes to pass against a sender production never uses —
 *  and on SES the wrong answer is an `AKIA…` key id the service rejects. */
export function resolveFrom(env) {
  const raw = env.SMTP_FROM || env.EMAIL_FROM || env.SMTP_USER || "";
  const m = /<([^>]+)>/.exec(raw);
  return (m ? m[1] : raw).trim();
}

/** Config read from the environment, with `configured` stating plainly whether
 *  there is anything to test. Exported so a test can drive it without env.
 *
 *  `tlsCa` is optional and normally absent, in which case TLS verification is
 *  the Node default — STRICT, exactly as `server/smtp.ts` is. It exists for the
 *  case of a relay presenting a certificate from a private CA: supplying that
 *  CA keeps verification full-strength, where the alternative people reach for
 *  (`rejectUnauthorized: false`) turns it off entirely. It is never a way to
 *  skip verification. */
export function readSmtpConfig(env) {
  const host = (env.SMTP_HOST || "").trim();
  const port = Number(env.SMTP_PORT || "587") || 587;
  const secure = /^(1|true|yes)$/i.test(String(env.SMTP_SECURE || "").trim());
  const user = (env.SMTP_USER || "").trim();
  const pass = env.SMTP_PASS || "";
  const from = resolveFrom(env);
  const caRaw = (env.SMTP_TLS_CA || "").trim();
  let tlsCa;
  if (caRaw) {
    // Accept the PEM itself or a path to it; a path that cannot be read is left
    // undefined rather than half-applied, so verification stays strict against
    // the public roots instead of silently trusting nothing.
    if (/^-----BEGIN/.test(caRaw)) tlsCa = caRaw;
    else {
      try {
        tlsCa = fs.readFileSync(caRaw, "utf8");
      } catch {
        tlsCa = undefined;
      }
    }
  }
  return { host, port, secure, user, pass, from, tlsCa, configured: Boolean(host && from) };
}

/* ── a minimal, read-only SMTP client ─────────────────────────────────────── */

function connect(cfg) {
  return new Promise((resolve, reject) => {
    const sock = cfg.secure
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, ...(cfg.tlsCa ? { ca: cfg.tlsCa } : {}) })
      : net.connect({ host: cfg.host, port: cfg.port });
    const onErr = (e) => reject(e);
    sock.setTimeout(15000, () => reject(new Error("timed out connecting")));
    sock.once("error", onErr);
    sock.once(cfg.secure ? "secureConnect" : "connect", () => {
      sock.off("error", onErr);
      resolve(sock);
    });
  });
}

/** One reply may span several `data` events and one event may hold several
 *  replies, so the buffer is owned by the session and drained per reply. The
 *  buffer is CLEARED across a STARTTLS upgrade — a plaintext segment can carry
 *  extra lines that would otherwise be read as the first encrypted reply
 *  (CVE-2011-0411, the same defect fixed in server/smtp.ts in v2.99.20). */
function session(sock) {
  let buf = "";
  let waiter = null;
  const feed = (chunk) => {
    buf += chunk.toString("utf8");
    tryResolve();
  };
  const tryResolve = () => {
    if (!waiter) return;
    // A final reply line is `NNN ` (space); `NNN-` is a continuation.
    const m = /^(?:\d{3}-[^\n]*\n)*(\d{3}) [^\n]*\n/.exec(buf);
    if (!m) return;
    const text = buf.slice(0, m[0].length);
    buf = buf.slice(m[0].length);
    const w = waiter;
    waiter = null;
    w.resolve({ code: Number(m[1]), text: text.trimEnd() });
  };
  sock.on("data", feed);
  return {
    read() {
      return new Promise((resolve, reject) => {
        waiter = { resolve, reject };
        tryResolve();
        setTimeout(() => {
          if (waiter && waiter.resolve === resolve) {
            waiter = null;
            reject(new Error("timed out waiting for a reply"));
          }
        }, 15000);
      });
    },
    send(line) {
      sock.write(line + "\r\n");
      return this.read();
    },
    clearBuffer() {
      buf = "";
    },
    detach() {
      sock.off("data", feed);
    },
  };
}

export async function verifyMail(cfg, to, opts = {}) {
  /* The socket is closed on EVERY exit, including a refusal. Without this the
     connection is leaked whenever the dialogue throws — which is precisely the
     interesting case, so a run that reports several problems would leave several
     half-open sessions behind on somebody else's mail server. */
  let closeSocket = () => {};
  try {
    return await runDialogue(cfg, to, opts, (fn) => {
      closeSocket = fn;
    });
  } finally {
    closeSocket();
  }
}

async function runDialogue(cfg, to, opts, registerClose) {
  const steps = [];
  const note = (name, ok, detail) => {
    steps.push({ name, ok, detail });
    return ok;
  };
  const ehloName = opts.ehloName || "relay-health-check";
  let sock = await connect(cfg);
  registerClose(() => {
    try {
      sock.destroy();
    } catch {
      /* already gone */
    }
  });
  let s = session(sock);

  const greet = await s.read();
  if (greet.code !== 220) throw new Error(`server did not greet us: ${greet.text}`);
  note("connect", true, `${cfg.host}:${cfg.port} — ${greet.text.split("\n")[0].slice(0, 90)}`);

  let ehlo = await s.send(`EHLO ${ehloName}`);
  if (ehlo.code !== 250) throw new Error(`EHLO refused: ${ehlo.text}`);

  if (!cfg.secure) {
    if (!/STARTTLS/i.test(ehlo.text)) throw new Error("server does not offer STARTTLS on this port");
    const st = await s.send("STARTTLS");
    if (st.code !== 220) throw new Error(`STARTTLS refused: ${st.text}`);
    s.detach();
    s.clearBuffer();
    const upgraded = await new Promise((resolve, reject) => {
      const t = tls.connect(
        { socket: sock, servername: cfg.host, ...(cfg.tlsCa ? { ca: cfg.tlsCa } : {}) },
        () => resolve(t),
      );
      t.once("error", reject);
    });
    sock = upgraded;
    registerClose(() => {
      try {
        sock.destroy();
      } catch {
        /* already gone */
      }
    });
    s = session(sock);
    ehlo = await s.send(`EHLO ${ehloName}`);
    if (ehlo.code !== 250) throw new Error(`post-TLS EHLO refused: ${ehlo.text}`);
    note("starttls", true, `upgraded; cipher ${upgraded.getCipher?.()?.name || "?"}`);
  } else {
    note("starttls", true, "implicit TLS (port was already encrypted)");
  }

  if (cfg.user && cfg.pass) {
    const a1 = await s.send("AUTH LOGIN");
    if (a1.code !== 334) throw new Error(`AUTH LOGIN refused: ${a1.text}`);
    const a2 = await s.send(Buffer.from(cfg.user, "utf8").toString("base64"));
    if (a2.code !== 334) throw new Error(`username stage refused: ${a2.text}`);
    const a3 = await s.send(Buffer.from(cfg.pass, "utf8").toString("base64"));
    if (a3.code !== 235) throw new Error(`credentials REJECTED (${a3.code}) — SMTP_USER/SMTP_PASS are wrong or revoked`);
    note("auth", true, "credentials accepted");
  } else {
    note("auth", true, "no SMTP_USER/SMTP_PASS set — skipped (unauthenticated relay)");
  }

  const mf = await s.send(`MAIL FROM:<${cfg.from}>`);
  if (mf.code !== 250) throw new Error(`sender <${cfg.from}> refused: ${mf.text}`);
  note("mail from", true, `<${cfg.from}> accepted`);

  const rc = await s.send(`RCPT TO:<${to}>`);
  if (rc.code !== 250 && rc.code !== 251) {
    // THE check. On SES in sandbox this is where an unverified recipient is
    // refused, which is exactly the production failure #44 asks about — so the
    // server's own wording is passed through untouched.
    throw new Error(`recipient <${to}> REFUSED (${rc.code}): ${rc.text.split("\n").pop()}`);
  }
  note("rcpt to", true, `<${to}> accepted (${rc.code})`);

  if (opts.send) {
    const d = await s.send("DATA");
    if (d.code !== 354) throw new Error(`DATA refused: ${d.text}`);
    const now = new Date().toUTCString();
    const body = [
      `From: ${cfg.from}`,
      `To: ${to}`,
      "Subject: RELAY delivery check",
      `Date: ${now}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "This is an automated RELAY delivery check, sent from the app fleet.",
      "It confirms the server can reach this inbox. Nothing needs doing.",
      "",
      ".",
    ].join("\r\n");
    sock.write(body + "\r\n");
    const done = await s.read();
    if (done.code !== 250) throw new Error(`message rejected at DATA: ${done.text}`);
    note("send", true, `accepted for delivery: ${done.text.split("\n").pop().slice(0, 90)}`);
  } else {
    const rs = await s.send("RSET");
    note("rset", rs.code === 250, "transaction abandoned — no mail was sent");
  }

  try {
    await s.send("QUIT");
  } catch {
    /* a server that hangs up on QUIT has still answered everything above */
  }
  sock.end();
  return steps;
}

/* ── main ─────────────────────────────────────────────────────────────────── */
const IS_MAIN =
  !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (IS_MAIN) {
  const to = flag("to", "");
  const cfg = readSmtpConfig(process.env);

  console.log("MAIL VERIFY");
  if (!cfg.configured) {
    // Not a failure: a deployment may legitimately use the Resend fallback
    // instead, and reporting that as broken would be a false alarm.
    console.log("  SKIP  SMTP is not configured on this host (SMTP_HOST / a From address unset).");
    console.log("        RELAY then falls back to Resend, which this check cannot exercise.");
    console.log("MAIL_VERIFY_EXIT=0");
    process.exit(0);
  }
  if (!to) {
    console.error("  FAIL  --to <address> is required (nothing to verify delivery TO).");
    console.log("MAIL_VERIFY_EXIT=1");
    process.exit(1);
  }
  console.log(`  host ${cfg.host}:${cfg.port} ${cfg.secure ? "(implicit TLS)" : "(STARTTLS)"} · from <${cfg.from}> · to <${to}>`);
  console.log(`  mode ${has("send") ? "SEND — a real message will be delivered" : "PROBE — stops before DATA, no mail is sent"}\n`);

  let failed = 0;
  try {
    const steps = await verifyMail(cfg, to, { send: has("send") });
    for (const st of steps) console.log(`  ${(st.ok ? "PASS" : "FAIL").padEnd(5)} ${st.name.padEnd(11)} ${st.detail}`);
    failed = steps.filter((s) => !s.ok).length;
    console.log(
      failed
        ? "\nThe dialogue completed but a step failed — see above."
        : `\nThe fleet can deliver to <${to}>.`,
    );
  } catch (e) {
    console.error(`  FAIL  ${e && e.message ? e.message : String(e)}`);
    failed = 1;
  }
  console.log(`MAIL_VERIFY_EXIT=${failed ? 1 : 0}`);
  process.exit(failed ? 1 : 0);
}
