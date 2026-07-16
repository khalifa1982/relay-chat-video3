import { describe, it, expect } from "vitest";
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
});
