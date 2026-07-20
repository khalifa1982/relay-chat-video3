import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendEmail, emailEnabled, emailFrom, mailProvider, stripHtml } from "./email";

describe("email (Resend) — feature gate + helpers", () => {
  const SAVE_KEY = process.env.RESEND_API_KEY;
  const SAVE_FROM = process.env.RESEND_FROM;
  const SAVE_EMAIL_FROM = process.env.EMAIL_FROM;
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
    delete process.env.EMAIL_FROM;
  });
  afterEach(() => {
    if (SAVE_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = SAVE_KEY;
    if (SAVE_FROM === undefined) delete process.env.RESEND_FROM;
    else process.env.RESEND_FROM = SAVE_FROM;
    if (SAVE_EMAIL_FROM === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = SAVE_EMAIL_FROM;
  });

  it("emailEnabled() reflects RESEND_API_KEY", () => {
    expect(emailEnabled()).toBe(false);
    process.env.RESEND_API_KEY = "re_test";
    expect(emailEnabled()).toBe(true);
  });

  it("emailFrom() defaults to onboarding@resend.dev and honors RESEND_FROM", () => {
    expect(emailFrom()).toBe("onboarding@resend.dev");
    process.env.RESEND_FROM = "RELAY <notifications@your-chat.org>";
    expect(emailFrom()).toBe("RELAY <notifications@your-chat.org>");
  });

  it("emailFrom() honors EMAIL_FROM under Resend too (RESEND_FROM > EMAIL_FROM > default) — v2.92 P2", () => {
    process.env.EMAIL_FROM = "RELAY <no-reply@example.io>";
    expect(emailFrom()).toBe("RELAY <no-reply@example.io>");
    process.env.RESEND_FROM = "RELAY <notifications@example.org>";
    expect(emailFrom()).toBe("RELAY <notifications@example.org>");
  });

  it("sendEmail() no-ops (never hits the network) when the key is absent", async () => {
    const res = await sendEmail({ to: "x@y.z", subject: "s", html: "<p>h</p>" });
    expect(res).toEqual({ ok: false, skippedReason: "disabled" });
  });

  it("stripHtml() produces a readable plain-text fallback", () => {
    expect(stripHtml("<p>Hello <b>world</b> &amp; more</p>")).toBe("Hello world & more");
    expect(stripHtml("<style>x{}</style><div>Hi&nbsp;there</div>")).toBe("Hi there");
  });
});

describe("v2.92 R4A — MAIL_PROVIDER explicit switch", () => {
  const KEYS = [
    "MAIL_PROVIDER",
    "RESEND_API_KEY",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "EMAIL_FROM",
  ] as const;
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("mailProvider() parses the env: smtp/resend (case- and space-tolerant), anything else = auto", () => {
    expect(mailProvider()).toBe("auto");
    process.env.MAIL_PROVIDER = "smtp";
    expect(mailProvider()).toBe("smtp");
    process.env.MAIL_PROVIDER = " RESEND ";
    expect(mailProvider()).toBe("resend");
    process.env.MAIL_PROVIDER = "sendgrid"; // unknown → historical auto-priority
    expect(mailProvider()).toBe("auto");
  });

  it("emailEnabled() counts ONLY the forced side when a provider is forced", () => {
    // Forced smtp: a Resend key alone no longer counts as "email works".
    process.env.MAIL_PROVIDER = "smtp";
    process.env.RESEND_API_KEY = "re_test";
    expect(emailEnabled()).toBe(false);
    process.env.SMTP_HOST = "mail.example.com";
    expect(emailEnabled()).toBe(true);
    // Forced resend: an SMTP host alone no longer counts.
    process.env.MAIL_PROVIDER = "resend";
    delete process.env.RESEND_API_KEY;
    expect(emailEnabled()).toBe(false);
    process.env.RESEND_API_KEY = "re_test";
    expect(emailEnabled()).toBe(true);
    // Auto (unset): either side enables — the historical OR.
    delete process.env.MAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    expect(emailEnabled()).toBe(true); // SMTP_HOST still set
  });

  it("MAIL_PROVIDER=smtp NEVER touches Resend — even with a key set and SMTP unconfigured", async () => {
    process.env.MAIL_PROVIDER = "smtp";
    process.env.RESEND_API_KEY = "re_test";
    const fetchSpy = vi.fn(async () => {
      throw new Error("Resend must not be called under MAIL_PROVIDER=smtp");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const res = await sendEmail({ to: "x@y.z", subject: "s", html: "<p>h</p>" });
    expect(res).toEqual({ ok: false, skippedReason: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("MAIL_PROVIDER=smtp: a FAILED smtp send reports the failure instead of rerouting via Resend", async () => {
    process.env.MAIL_PROVIDER = "smtp";
    process.env.RESEND_API_KEY = "re_test";
    // Loopback port 1 — nothing listens there; the connect fails immediately.
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASS = "p";
    process.env.EMAIL_FROM = "no-reply@example.com";
    const fetchSpy = vi.fn(async () => {
      throw new Error("Resend must not be called under MAIL_PROVIDER=smtp");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const res = await sendEmail({ to: "x@y.z", subject: "s", html: "<p>h</p>" });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.skippedReason).toBeUndefined(); // a real attempt failed — not "disabled"
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("MAIL_PROVIDER=resend SKIPS smtp even when SMTP_HOST is set", async () => {
    process.env.MAIL_PROVIDER = "resend";
    // If the smtp branch ran it would try (and fail) this dead host first and
    // log an smtp warning — assert it never does.
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1";
    process.env.RESEND_API_KEY = "re_test";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "email_123" }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await sendEmail({ to: "x@y.z", subject: "s", html: "<p>h</p>" });
    expect(res).toEqual({ ok: true, id: "email_123" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const smtpWarns = warnSpy.mock.calls.filter(args => String(args[0]).includes("smtp"));
    expect(smtpWarns).toEqual([]);
  });
});
