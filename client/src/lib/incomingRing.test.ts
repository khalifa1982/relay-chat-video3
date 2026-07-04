import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.79 — incoming-call overlay overhaul + missed-call pathways, static pins.
 *
 * Issue 1: the ring overlay is a rich caller card — circular avatar, large
 * name + national flag, the caller's PIN for identity verification, an
 * Answer-as-Voice / Answer-as-Video split (mic/camera icons), a prominent red
 * Decline, and a quick-reply fold-out that messages the caller ("I'll call
 * you back shortly") and declines.
 * Issue 2: every missed-call notification pathway (landing toast, Dialer
 * banner, bell panel) must actually NAVIGATE to the Missed log — History with
 * the Missed filter pre-selected via ?filter=missed.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CLIENT = read("client/src/lib/relayClient.ts");
const ASSETS = read("client/src/lib/relayAssets.ts");
const ENGINE = read("client/src/app/RelayEngine.tsx");
const SHELL = read("client/src/app/AppShell.tsx");
const DIALER = read("client/src/pages/app/Dialer.tsx");
const HISTORY = read("client/src/pages/app/History.tsx");

describe("incoming-call overlay — rich caller card", () => {
  it("shows the caller's PIN and national flag alongside the name", () => {
    for (const id of ["ringPin", "ringFlag"]) expect(ASSETS).toContain('id="' + id + '"');
    expect(CLIENT).toMatch(/ringPin\.textContent = m\.from && m\.from\.length === 6 \? m\.from\.slice\(0, 3\) \+ "-" \+ m\.from\.slice\(3\)/);
    expect(CLIENT).toMatch(/ringFlag\.textContent = m\.flag \|\| ""/);
  });

  it("the avatar is CIRCULAR (contemporary ring-screen look)", () => {
    expect(ASSETS).toMatch(/\.ring-card \.av\{[^}]*border-radius:50%/);
  });

  it("offers a split answer — Voice (mic icon, camera stays off) and Video (camera icon)", () => {
    expect(ASSETS).toContain('id="acceptVoiceBtn"');
    expect(ASSETS).toContain('id="acceptBtn"');
    expect(CLIENT).toMatch(/acceptInvite\(opts\?: \{ voice\?: boolean \}\)/);
    expect(CLIENT).toMatch(/acceptInvite\(\{ voice: true \}\)/);
    // Voice answer mirrors the voice-dial rule: camera off, upgradeable in-call.
    expect(CLIENT).toMatch(/if \(opts\?\.voice && localStream && localStream\.getVideoTracks\(\)\.length > 0\) \{\s*\n\s*setCam\(false\);\s*\n\s*\}/);
  });

  it("Decline stays prominent and full-width (red)", () => {
    expect(ASSETS).toMatch(/r-decline r-decline-wide" id="declineBtn"/);
  });

  it("quick replies: fold-out canned responses that message the caller and decline", () => {
    expect(ASSETS).toContain('id="quickReplyBtn"');
    expect(ASSETS).toContain('id="quickReplies"');
    expect(ASSETS).toMatch(/data-msg="I'll call you back shortly\."/);
    expect(CLIENT).toMatch(/onQuickReply\?\.\(r\.from, text\); toast\("Reply sent — call declined"\)/);
    expect(CLIENT).toMatch(/declineInvite\(\);\s*\n\s*\}\);\s*\n\s*\}\);/);
  });

  it("the quick reply is delivered through the v2 messaging stack (engine → host hook → openThread + send)", () => {
    expect(CLIENT).toMatch(/setOnQuickReply: \(cb: \(\(toPin: string, text: string\) => void\) \| null\) => void;/);
    expect(ENGINE).toMatch(/handle\.setOnQuickReply\(\(toPin, text\) => quickReplyRef\.current\(toPin, text\)\)/);
    expect(ENGINE).toMatch(/openThread\s*\n?\s*\.mutateAsync\(\{ number: toPin \}\)/);
    expect(ENGINE).toMatch(/sendMessage\.mutateAsync\(\{ conversationId: r\.conversationId, kind: "text", body: text \}\)/);
  });

  it("a fresh ring always starts with the reply menu folded", () => {
    expect(CLIENT).toMatch(/\$\("quickReplies"\)\?\.classList\.remove\("open"\)/);
  });
});

describe("missed-call pathways — every notification leads to the Missed log", () => {
  it("the landing toast routes to History with the Missed filter", () => {
    expect(SHELL).toMatch(/navigate\("\/app\/history\?filter=missed"\)/);
  });

  it("the bell panel's history action routes to the Missed filter (both desktop + mobile)", () => {
    const hits = SHELL.match(/onOpenHistory=\{\(\) => navigate\("\/app\/history\?filter=missed"\)\}/g) || [];
    expect(hits.length).toBe(2);
  });

  it("the Dialer's missed banner is a working LINK to the Missed log (was inert text)", () => {
    expect(DIALER).toMatch(/setLocation\("\/app\/history\?filter=missed"\)/);
    expect(DIALER).toMatch(/tap to see all/);
  });

  it("History honours ?filter=missed|dialed|all as a deep link (and reacts to later changes)", () => {
    expect(HISTORY).toMatch(/new URLSearchParams\(search\)\.get\("filter"\)/);
    expect(HISTORY).toMatch(/useState<Filter>\(urlFilter \?\? "all"\)/);
    expect(HISTORY).toMatch(/if \(urlFilter\) setFilter\(urlFilter\);/);
  });
});
