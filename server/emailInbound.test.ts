import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  inboundConfig,
  inboundAddress,
  parseInboundAddress,
  signInbound,
  stripQuotedReply,
  collectRecipients,
  extractBody,
  extractFrom,
  normalizeEmail,
  verifyWebhookSignature,
} from "./emailInbound";

const SAVE = { ...process.env };
beforeEach(() => {
  process.env.INBOUND_EMAIL_DOMAIN = "inbound.your-chat.org";
  process.env.INBOUND_EMAIL_LOCALPART = "relay";
  process.env.INBOUND_EMAIL_SECRET = "test-secret";
  delete process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
});
afterEach(() => {
  process.env = { ...SAVE };
});

describe("inbound config gate", () => {
  it("is disabled without INBOUND_EMAIL_DOMAIN", () => {
    delete process.env.INBOUND_EMAIL_DOMAIN;
    expect(inboundConfig().enabled).toBe(false);
    expect(parseInboundAddress("relay+1.2.deadbeef@inbound.your-chat.org")).toBeNull();
  });
});

describe("signed reply-address round-trip", () => {
  it("builds and parses its own address", () => {
    const addr = inboundAddress(42, 7);
    expect(addr).toMatch(/^relay\+42\.7\.[0-9a-f]{20}@inbound\.your-chat\.org$/);
    expect(parseInboundAddress(addr)).toEqual({ conversationId: 42, identityId: 7 });
  });

  it("parses a 'Display Name <addr>' form", () => {
    const addr = inboundAddress(100, 3);
    expect(parseInboundAddress(`RELAY <${addr}>`)).toEqual({ conversationId: 100, identityId: 3 });
  });

  it("rejects a forged signature", () => {
    expect(parseInboundAddress("relay+42.7.00000000000000000000@inbound.your-chat.org")).toBeNull();
  });

  it("rejects a tampered conversation id (sig no longer matches)", () => {
    const addr = inboundAddress(42, 7); // sig is for 42.7
    const tampered = addr.replace("relay+42.", "relay+43.");
    expect(parseInboundAddress(tampered)).toBeNull();
  });

  it("rejects the wrong domain and wrong localpart", () => {
    const sig = signInbound(1, 2);
    expect(parseInboundAddress(`relay+1.2.${sig}@evil.com`)).toBeNull();
    expect(parseInboundAddress(`bounce+1.2.${sig}@inbound.your-chat.org`)).toBeNull();
  });

  it("rejects malformed locals", () => {
    expect(parseInboundAddress("relay@inbound.your-chat.org")).toBeNull();
    expect(parseInboundAddress("relay+1.2@inbound.your-chat.org")).toBeNull();
    expect(parseInboundAddress("relay+x.y.z@inbound.your-chat.org")).toBeNull();
    expect(parseInboundAddress("not-an-email")).toBeNull();
  });
});

describe("stripQuotedReply", () => {
  it("keeps the new text and drops the quoted original", () => {
    const body = [
      "Sounds good, see you then!",
      "",
      "On Tue, Jun 27, 2026 at 9:00 AM RELAY <relay@x> wrote:",
      "> You missed a call from Anya",
      "> Open RELAY to call back",
    ].join("\n");
    expect(stripQuotedReply(body)).toBe("Sounds good, see you then!");
  });

  it("stops at an Outlook original-message divider", () => {
    const body = "My reply\n-----Original Message-----\nFrom: RELAY\nblah";
    expect(stripQuotedReply(body)).toBe("My reply");
  });

  it("drops a signature after the '-- ' delimiter", () => {
    const body = "Got it.\n-- \nSent from my phone";
    expect(stripQuotedReply(body)).toBe("Got it.");
  });

  it("handles CRLF and empty input", () => {
    expect(stripQuotedReply("line1\r\nline2")).toBe("line1\nline2");
    expect(stripQuotedReply("")).toBe("");
  });
});

describe("collectRecipients + extractBody", () => {
  it("collects to/cc as strings, arrays, and {address} objects, top-level or under data", () => {
    const payload = {
      data: {
        to: ["relay+1.2.x@inbound.your-chat.org", { address: "cc@x.com" }],
        cc: "third@x.com",
      },
    };
    const r = collectRecipients(payload);
    expect(r).toContain("relay+1.2.x@inbound.your-chat.org");
    expect(r).toContain("cc@x.com");
    expect(r).toContain("third@x.com");
  });

  it("prefers text over html and falls back to html", () => {
    expect(extractBody({ data: { text: "hi", html: "<b>hi</b>" } }).text).toBe("hi");
    expect(extractBody({ text: "top" }).text).toBe("top");
    expect(extractBody({ data: { html: "<b>x</b>" } }).html).toBe("<b>x</b>");
  });
});

describe("From extraction (mailbox-owner binding)", () => {
  it("normalizes 'Name <addr>', bare, and object forms to a lowercased address", () => {
    expect(normalizeEmail("Anya <Anya@Example.COM>")).toBe("anya@example.com");
    expect(normalizeEmail("  USER@X.io ")).toBe("user@x.io");
    expect(normalizeEmail({ address: "A@B.co" })).toBe("a@b.co");
    expect(normalizeEmail({ email: "C@D.co" })).toBe("c@d.co");
    expect(normalizeEmail(undefined)).toBe("");
  });

  it("extracts From from top-level or under data", () => {
    expect(extractFrom({ from: "X <x@y.z>" })).toBe("x@y.z");
    expect(extractFrom({ data: { from: "q@r.s" } })).toBe("q@r.s");
    expect(extractFrom({})).toBe("");
  });
});

describe("verifyWebhookSignature (Svix scheme)", () => {
  function sign(secretB64: string, id: string, ts: string, body: string): string {
    const key = Buffer.from(secretB64, "base64");
    const exp = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
    return `v1,${exp}`;
  }

  it("passes through (true) when no webhook secret is configured", () => {
    expect(verifyWebhookSignature("{}", { id: "a", timestamp: "1", signature: "v1,zzz" })).toBe(true);
  });

  it("validates a correct signature and rejects a wrong one", () => {
    const keyB64 = Buffer.from("super-secret-key").toString("base64");
    process.env.INBOUND_EMAIL_WEBHOOK_SECRET = "whsec_" + keyB64;
    const id = "msg_1";
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ hello: "world" });
    const good = sign(keyB64, id, ts, body);
    expect(verifyWebhookSignature(body, { id, timestamp: ts, signature: good })).toBe(true);
    expect(verifyWebhookSignature(body, { id, timestamp: ts, signature: "v1,deadbeef" })).toBe(false);
  });

  it("rejects a stale timestamp (replay)", () => {
    const keyB64 = Buffer.from("k").toString("base64");
    process.env.INBOUND_EMAIL_WEBHOOK_SECRET = "whsec_" + keyB64;
    const id = "m";
    const ts = String(Math.floor(Date.now() / 1000) - 10_000); // way old
    const body = "{}";
    const good = sign(keyB64, id, ts, body);
    expect(verifyWebhookSignature(body, { id, timestamp: ts, signature: good })).toBe(false);
  });

  it("rejects when required headers are missing", () => {
    process.env.INBOUND_EMAIL_WEBHOOK_SECRET = "whsec_" + Buffer.from("k").toString("base64");
    expect(verifyWebhookSignature("{}", {})).toBe(false);
  });
});

/* ── ROUND 6 — support@ routing to the owner ─────────────────────────────── */
import { isSupportRecipient, formatSupportBody, extractSubject } from "./emailInbound";
import { readFileSync } from "node:fs";

describe("isSupportRecipient — support[+tag]@domain matcher", () => {
  it("matches support@ at the inbound domain, case-insensitively", () => {
    expect(isSupportRecipient(["support@in.example.org"], "in.example.org")).toBe(true);
    expect(isSupportRecipient(["SUPPORT@IN.EXAMPLE.ORG"], "in.example.org")).toBe(true);
    expect(isSupportRecipient(["Help Desk <support@in.example.org>"], "in.example.org")).toBe(true);
  });
  it("ignores a +tag on the localpart", () => {
    expect(isSupportRecipient(["support+billing@in.example.org"], "in.example.org")).toBe(true);
  });
  it("REJECTS other localparts, other domains, and an unset domain", () => {
    expect(isSupportRecipient(["relay@in.example.org"], "in.example.org")).toBe(false);
    expect(isSupportRecipient(["support@elsewhere.org"], "in.example.org")).toBe(false);
    expect(isSupportRecipient(["notsupport@in.example.org"], "in.example.org")).toBe(false);
    expect(isSupportRecipient(["support@in.example.org"], "")).toBe(false);
  });
});

describe("formatSupportBody — the owner-visible message", () => {
  it("formats sender + subject + body per the spec", () => {
    expect(formatSupportBody("a@b.c", "Hi", "Need help")).toBe("📧 a@b.c\nSubject: Hi\n\nNeed help");
  });
  it("degrades gracefully on missing fields and caps at 8000 chars", () => {
    expect(formatSupportBody("", "", "")).toBe("📧 (unknown sender)\nSubject: (no subject)\n\n");
    expect(formatSupportBody("a@b.c", "s", "x".repeat(9000)).length).toBe(8000);
  });
});

describe("extractSubject", () => {
  it("reads subject from the root or under data", () => {
    expect(extractSubject({ subject: " Hello " })).toBe("Hello");
    expect(extractSubject({ data: { subject: "Nested" } })).toBe("Nested");
    expect(extractSubject({})).toBe("");
  });
});

describe("support routing — handler wiring (source pins)", () => {
  const src = readFileSync("server/emailInbound.ts", "utf8");
  it("routes support mail to the OWNER's self conversation before no-match", () => {
    const supportIdx = src.indexOf("isSupportRecipient(recipients");
    const noMatchIdx = src.indexOf('reason: "no-match"');
    expect(supportIdx).toBeGreaterThan(-1);
    expect(supportIdx).toBeLessThan(noMatchIdx);
    expect(src).toMatch(/OWNER_OPEN_ID/);
    expect(src).toMatch(/getOrCreateDmConversation\(ownerIdent\.id, ownerIdent\.id\)/);
    expect(src).toMatch(/routed: "support"/);
  });
  it("skips the from-mismatch check for support mail (strangers by design)", () => {
    // the support branch returns before the from-mismatch block runs
    const supportIdx = src.indexOf("isSupportRecipient(recipients");
    const mismatchIdx = src.indexOf("from-mismatch");
    expect(supportIdx).toBeLessThan(mismatchIdx);
  });
  it("a failed store returns 5xx so the provider retries (mail never lost)", () => {
    expect(src).toMatch(/support store failed/);
  });
});
