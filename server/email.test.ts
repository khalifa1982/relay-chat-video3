import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sendEmail, emailEnabled, emailFrom, stripHtml } from "./email";

describe("email (Resend) — feature gate + helpers", () => {
  const SAVE_KEY = process.env.RESEND_API_KEY;
  const SAVE_FROM = process.env.RESEND_FROM;
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
  });
  afterEach(() => {
    if (SAVE_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = SAVE_KEY;
    if (SAVE_FROM === undefined) delete process.env.RESEND_FROM;
    else process.env.RESEND_FROM = SAVE_FROM;
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

  it("sendEmail() no-ops (never hits the network) when the key is absent", async () => {
    const res = await sendEmail({ to: "x@y.z", subject: "s", html: "<p>h</p>" });
    expect(res).toEqual({ ok: false, skippedReason: "disabled" });
  });

  it("stripHtml() produces a readable plain-text fallback", () => {
    expect(stripHtml("<p>Hello <b>world</b> &amp; more</p>")).toBe("Hello world & more");
    expect(stripHtml("<style>x{}</style><div>Hi&nbsp;there</div>")).toBe("Hi there");
  });
});
