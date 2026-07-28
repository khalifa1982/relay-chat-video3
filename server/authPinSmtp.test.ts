import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { judgePinAttempt, isValidPin, PIN_MAX_ATTEMPTS } from "./authPin";
import { hashPassword } from "./authCrypto";
import { dotStuff, bareAddress, parseSmtpReply, buildMimeMessage, smtpConfig } from "./smtp";

describe("4-digit PIN login (v2.87)", () => {
  const hash = hashPassword("1234");

  it("validates the PIN shape (exactly 4 digits)", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("0000")).toBe(true);
    for (const bad of ["123", "12345", "12a4", "", " 1234"]) expect(isValidPin(bad)).toBe(false);
  });

  it("correct PIN signs in and no-pin/locked accounts are refused", () => {
    expect(judgePinAttempt({ loginPinHash: hash, loginPinAttempts: 0, loginPinLockedAt: null }, "1234"))
      .toEqual({ outcome: "ok" });
    expect(judgePinAttempt({ loginPinHash: null, loginPinAttempts: 0, loginPinLockedAt: null }, "1234"))
      .toEqual({ outcome: "no-pin" });
    expect(judgePinAttempt({ loginPinHash: hash, loginPinAttempts: 0, loginPinLockedAt: new Date() }, "1234"))
      .toEqual({ outcome: "locked" });
  });

  it("the spec's exact ladder: three wrong entries warn, the FOURTH locks", () => {
    expect(PIN_MAX_ATTEMPTS).toBe(3);
    // wrong #1 (0 prior) → 3 more survivable
    expect(judgePinAttempt({ loginPinHash: hash, loginPinAttempts: 0, loginPinLockedAt: null }, "9999"))
      .toEqual({ outcome: "wrong", attemptsLeft: 3 });
    // wrong #2
    expect(judgePinAttempt({ loginPinHash: hash, loginPinAttempts: 1, loginPinLockedAt: null }, "9999"))
      .toEqual({ outcome: "wrong", attemptsLeft: 2 });
    // wrong #3 — the last forgiven one
    expect(judgePinAttempt({ loginPinHash: hash, loginPinAttempts: 2, loginPinLockedAt: null }, "9999"))
      .toEqual({ outcome: "wrong", attemptsLeft: 1 });
    // wrong #4 — LOCKS
    expect(judgePinAttempt({ loginPinHash: hash, loginPinAttempts: 3, loginPinLockedAt: null }, "9999"))
      .toEqual({ outcome: "locked-now" });
  });

  it("a correct PIN on the 3rd try still signs in (attempts don't poison success)", () => {
    expect(judgePinAttempt({ loginPinHash: hash, loginPinAttempts: 2, loginPinLockedAt: null }, "1234"))
      .toEqual({ outcome: "ok" });
  });
});

describe("built-in SMTP mailer (v2.87)", () => {
  it("dot-stuffs leading dots and normalizes newlines (RFC 5321 §4.5.2)", () => {
    expect(dotStuff(".hello\n..x\nok")).toBe("..hello\r\n...x\r\nok");
    expect(dotStuff("a\nb")).toBe("a\r\nb");
  });

  it("extracts bare addresses from display form", () => {
    expect(bareAddress("RELAY <no-reply@your-chat.org>")).toBe("no-reply@your-chat.org");
    expect(bareAddress("plain@x.org")).toBe("plain@x.org");
  });

  it("parses single- and multi-line reply forms", () => {
    expect(parseSmtpReply("250 OK")).toEqual({ code: 250, more: false });
    expect(parseSmtpReply("250-STARTTLS")).toEqual({ code: 250, more: true });
    expect(parseSmtpReply("354 go ahead")).toEqual({ code: 354, more: false });
  });

  it("builds a well-formed multipart/alternative message", () => {
    const m = buildMimeMessage({
      from: "RELAY <no-reply@your-chat.org>",
      to: ["a@b.c"],
      subject: "Your RELAY sign-in code",
      html: "<b>123456</b>",
      text: "123456",
      date: new Date(0),
      messageId: "<test@your-chat.org>",
    });
    for (const must of [
      "From: RELAY <no-reply@your-chat.org>",
      "To: a@b.c",
      "Subject: Your RELAY sign-in code",
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="',
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Type: text/html; charset="utf-8"',
    ]) expect(m).toContain(must);
    expect(m).toContain(Buffer.from("123456", "utf8").toString("base64"));
  });

  it("is disabled without SMTP_HOST (Resend fallback keeps working)", () => {
    const save = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    expect(smtpConfig()).toBeNull();
    if (save !== undefined) process.env.SMTP_HOST = save;
  });

  it("reads the full env shape", () => {
    const saved = { ...process.env };
    process.env.SMTP_HOST = "mail.x.org";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_SECURE = "1";
    process.env.SMTP_USER = "u@x.org";
    process.env.SMTP_PASS = "p";
    process.env.SMTP_FROM = "RELAY <u@x.org>";
    expect(smtpConfig()).toEqual({
      host: "mail.x.org", port: 465, secure: true, user: "u@x.org", pass: "p", from: "RELAY <u@x.org>",
    });
    for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("v2.92 R4A: EMAIL_FROM is an alias for SMTP_FROM (SES envs), SMTP_FROM still wins", () => {
    const KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "EMAIL_FROM"];
    const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    process.env.SMTP_HOST = "email-smtp.ap-south-1.amazonaws.com";
    process.env.SMTP_USER = "AKIAEXAMPLEKEYID"; // SES SMTP username — NOT a valid From
    process.env.SMTP_PASS = "p";
    try {
      // EMAIL_FROM alone fills From (the whole point: never fall back to the AKIA user).
      process.env.EMAIL_FROM = "RELAY <no-reply@example.com>";
      expect(smtpConfig()?.from).toBe("RELAY <no-reply@example.com>");
      // An explicit SMTP_FROM outranks the alias.
      process.env.SMTP_FROM = "RELAY <smtp-from@example.com>";
      expect(smtpConfig()?.from).toBe("RELAY <smtp-from@example.com>");
      /* NEITHER SET → NOT CONFIGURED (rewritten v2.105.17).
         This used to assert the last-resort SMTP_USER fallback produced
         from === "AKIAEXAMPLEKEYID" — and the line above it already said that value is
         "NOT a valid From". So the test was PINNING THE PRODUCTION FAILURE v2.97.2
         recorded: SES rejects an AKIA key id as a sender, and `emailEnabled()` still
         reported true, so mail was "enabled" and every message bounced.
         A From must contain an "@" or `smtpConfig()` reports off — which is what sends
         an operator to the variable that is actually missing. */
      delete process.env.SMTP_FROM;
      delete process.env.EMAIL_FROM;
      expect(smtpConfig()).toBeNull();
    } finally {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k] as string;
      }
    }
  });

  describe("v2.105.17 — a config that reports READY must be able to open a socket", () => {
    const KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "EMAIL_FROM"];
    let saved: Record<string, string | undefined> = {};
    beforeEach(() => {
      saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
      for (const k of KEYS) delete process.env[k];
      process.env.SMTP_HOST = "mail.x.org";
      process.env.SMTP_FROM = "RELAY <u@x.org>";
    });
    afterEach(() => {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k] as string;
      }
    });

    it("a garbage SMTP_PORT falls back to the default instead of reporting NaN", () => {
      /* THE DEFECT. `Number("587 ;")` is NaN, and NaN passed straight through into the
         config — so `emailEnabled()` returned true, `net.connect` threw
         ERR_SOCKET_BAD_PORT into a catch that resolves {ok:false}, and mail was
         "enabled" while nothing was ever sent. A trailing character is exactly what a
         hand-edited `.env` line acquires. */
      for (const bad of ["", "587 ;", "abc", "-1", "0", "70000", "  "]) {
        process.env.SMTP_PORT = bad;
        const cfg = smtpConfig();
        expect(cfg).not.toBeNull();
        expect(Number.isInteger(cfg!.port)).toBe(true);
        expect(cfg!.port).toBe(587); // SMTP_SECURE unset ⇒ STARTTLS submission
      }
    });

    it("the fallback follows SMTP_SECURE, so an implicit-TLS host lands on 465", () => {
      process.env.SMTP_SECURE = "1";
      process.env.SMTP_PORT = "not-a-port";
      expect(smtpConfig()!.port).toBe(465);
    });

    it("a REAL port is still honoured — the guard refuses garbage, not values", () => {
      for (const [raw, want] of [["25", 25], ["587", 587], ["465", 465], ["2525", 2525], ["65535", 65535]] as const) {
        process.env.SMTP_PORT = raw;
        expect(smtpConfig()!.port).toBe(want);
      }
    });

    it("AUTH requires BOTH halves — never base64(\"\") as a password", () => {
      /* Source-pinned deliberately: reaching the AUTH exchange means a real socket and
         a TLS upgrade, and the property is one conjunct. With only the user set, the
         dialogue used to send an empty password and the server's refusal named the
         CREDENTIAL, sending an operator to rotate a key when the config was the fault.
         Relays that need no AUTH (a VPC-local postfix) are the case this preserves. */
      const src = fs.readFileSync(path.join(__dirname, "smtp.ts"), "utf8");
      expect(src).toMatch(/if \(cfg\.user && cfg\.pass\) \{/);
      // And it is the ONLY gate on the exchange, so neither half can be dropped later.
      expect(src).not.toMatch(/if \(cfg\.user\) \{/);
    });
  });
});
