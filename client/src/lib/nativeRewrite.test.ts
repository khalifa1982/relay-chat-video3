import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Native rewrite M1 (mobile/native — compiled React Native, per the owner's
 * mandate: "a real app such as WhatsApp and Telegram", no webview). These pins
 * bind the M1 invariants: same backend, same identity mechanism, same tabs.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("native rewrite — M1 foundation", () => {
  it("is a React Native app (no Capacitor/webview) with the store package id", () => {
    const pkg = JSON.parse(read("mobile/native/package.json"));
    expect(pkg.dependencies["react-native"]).toBeTruthy();
    expect(pkg.dependencies["@capacitor/core"]).toBeUndefined();
    const gradle = read("mobile/native/android/app/build.gradle");
    expect(gradle).toContain('applicationId "org.yourchat.relay"');
    expect(gradle).toContain('applicationIdSuffix ".next"');
  });

  it("talks to the EXISTING backend unmodified: tRPC/superjson + device-id identity", () => {
    const api = read("mobile/native/src/lib/api.ts");
    expect(api).toContain("/api/trpc");
    expect(api).toMatch(/transformer: superjson/);
    expect(api).toMatch(/x-relay-device-id/);
    expect(api).toMatch(/identity\.startGuest|"identity\.whoami"/);
  });

  it("carries the web app's tab structure + per-tab accents", () => {
    const app = read("mobile/native/App.tsx");
    for (const t of ["Calls", "History", "Messages", "Contacts", "Profile"]) {
      expect(app).toContain(`"${t}"`);
    }
    const theme = read("mobile/native/src/lib/theme.ts");
    for (const k of ["tabCalls", "tabHistory", "tabMessages", "tabContacts"]) {
      expect(theme).toContain(k);
    }
  });

  it("M2: messaging + contacts write-parity against the EXACT server shapes", () => {
    const api = read("mobile/native/src/lib/api.ts");
    // Procedure paths transcribed from server/v2routers.ts.
    for (const proc of [
      '"messages.openThread"', '"messages.list"', '"messages.send"',
      '"messages.markRead"', '"messages.typing"', '"messages.remove"',
      '"messages.conversationInfo"', '"contacts.upsert"', '"contacts.remove"',
    ]) expect(api).toContain(proc);
    // The threads shape uses the REAL field names (M1 had guessed wrong ones).
    for (const f of ["peerDisplayName", "lastMessageBody", "unreadCount", "peerIsOnline", "peerVerified"])
      expect(api).toContain(f);
    // Upload rides the same HTTP endpoint + device-id identity as the web.
    expect(api).toContain("/api/v2/upload");
    expect(api).toContain("dataBase64");
    // Realtime: the same v2 SSE bus the web consumes.
    const ev = read("mobile/native/src/lib/events.ts");
    expect(ev).toContain("/api/v2/events");
    expect(ev).toContain("x-relay-device-id");
    // Conversation screen: receipts from message.status, unsend, reply, typing.
    const conv = read("mobile/native/src/screens/Conversation.tsx");
    expect(conv).toMatch(/status === "read" \? "\s*✓✓" : "\s*✓"/);
    expect(conv).toContain("api.unsend");
    expect(conv).toContain("replyToId");
    expect(conv).toContain("api.typing");
    // Contacts write ops + Android-safe action sheet (Alert caps at 3 buttons).
    const cl = read("mobile/native/src/screens/ContactsList.tsx");
    expect(cl).toContain("contactUpsert");
    expect(cl).toContain("Modal");
  });

  it("M3: the call engine port speaks the production protocol", () => {
    const sig = read("mobile/native/src/call/signaling.ts");
    expect(sig).toContain("/api/relay/stream?cid=");
    expect(sig).toContain("/api/relay/send");
    expect(sig).toMatch(/250 \* Math\.pow\(3, attempt\)/); // v2.80 retry parity
    const eng = read("mobile/native/src/call/engine.tsx");
    // Staged progress incl. the v2.83 paging state + stale-ring replace rule.
    expect(eng).toContain('"paging"');
    expect(eng).toMatch(/cur\.from !== m\.from && Date\.now\(\) - cur\.at <= 70_000/);
    // Mutual-consent video protocol (v2.81 vocabulary).
    for (const t of ['"video-request"', '"video-accept"', '"video-decline"']) expect(eng).toContain(t);
    // Mesh glare rule: the NEWCOMER (joined.members) offers.
    expect(eng).toMatch(/case "joined":[\s\S]*?meshOffer/);
    // 1:1 auto-end + 65s no-answer backstop.
    expect(eng).toContain('hangupInternal("remote-left")');
    expect(eng).toContain("65_000");
    // One WebRTC stack for mesh + SFU; native audio routing.
    expect(eng).toContain("@livekit/react-native-webrtc");
    expect(eng).toContain("InCallManager");
    // Wired into the UI.
    expect(read("mobile/native/App.tsx")).toContain("<CallOverlay />");
    expect(read("mobile/native/src/screens/Dialer.tsx")).toContain("call.dial(dialed");
  });

  it("CI builds the milestone APK", () => {
    const wf = read(".github/workflows/native-rn.yml");
    expect(wf).toContain("RELAY-RN-debug-apk");
    expect(wf).toContain("mobile/native/android");
  });
});
