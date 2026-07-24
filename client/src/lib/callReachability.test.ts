import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.83 — call reachability batch, static pins.
 *
 * Issue 1 ("History redial drops within two seconds, before it rings"):
 *   • callee-side ZOMBIE ring state must not blind-auto-reject a fresh call
 *   • a mid-dial re-register must not reap the caller's dial room (server)
 *   • an unreachable-but-real callee gets a fast honest error{offline} + the
 *     leave-a-message card (v2.99.11 retired the v2.83 paging keep-alive)
 *   • pre-establishment SFU Disconnected retries instead of hanging up
 *   • a failed dial shows its reason ON the dial card before teardown
 * Issue 2 (iOS: no ring sound / notification):
 *   • ringtone AudioContext is unlocked by a real user gesture at boot
 *   • ring adds vibration + tab-title flash + a system notification
 *   • returning to the foreground reconnects the SSE immediately
 *   • Web Push wakes closed/background devices (sw.js + subscription plumbing)
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CLIENT = read("client/src/lib/relayClient.ts");
const SERVER = read("server/relay.ts");
const SW = read("client/public/sw.js");
const NOTIF = read("client/src/app/notifications.ts");
const SHELL = read("client/src/app/AppShell.tsx");
const BANNER = read("client/src/app/PushBanner.tsx");
const PUSHC = read("client/src/app/pushClient.ts");
const HISTORY = read("client/src/pages/app/History.tsx");
const DIALER = read("client/src/pages/app/Dialer.tsx");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const ROUTERS = read("server/v2routers.ts");
const V2DB = read("server/v2db.ts");
const WEBPUSH = read("server/webPush.ts");
const CORE = read("server/_core/index.ts");

describe("issue 1 — pre-ring dial drops", () => {
  it("a stale/same-caller pendingRing REPLACES instead of auto-rejecting the fresh ring", () => {
    expect(CLIENT).toMatch(/pendingRing && pendingRing\.from !== m\.from && Date\.now\(\) - \(pendingRing\.at \|\| 0\) <= 70_000/);
    expect(CLIENT).toMatch(/waitingRing && waitingRing\.from !== m\.from && Date\.now\(\) - \(waitingRing\.at \|\| 0\) <= 70_000/);
    // Rings are stamped so staleness is decidable.
    expect(CLIENT).toMatch(/pendingRing = \{ from: m\.from!, fromName: m\.fromName!, roomId: m\.roomId!, video: !!m\.video, at: Date\.now\(\) \}/);
  });

  it("returning to the foreground sweeps zombie ring state (frozen 60s timers)", () => {
    expect(CLIENT).toMatch(/Zombie-ring sweep/);
    expect(CLIENT).toMatch(/pendingRing && Date\.now\(\) - \(pendingRing\.at \|\| 0\) > 70_000/);
  });

  it("pre-establishment LiveKit Disconnected RETRIES the SFU join instead of killing the dial", () => {
    expect(CLIENT).toMatch(/if \(!establishedOnce\) \{\s*\n\s*lkRoom = null;\s*\n\s*lkConnected = false;\s*\n\s*diag\("livekit: disconnected pre-establishment — retrying, not hanging up"\);\s*\n\s*sendWS\(\{ type: "refresh-livekit" \}\);\s*\n\s*return;/);
  });

  it("a failed dial presents its outcome ON the dial card (failDial) before tearing down", () => {
    expect(CLIENT).toMatch(/function failDial\(message: string, reason: string\)/);
    expect(CLIENT).toMatch(/failDial\("They declined\.", "peer-rejected"\)/);
    expect(CLIENT).toMatch(/failDial\("They're on another call\.", "peer-busy"\)/);
    expect(CLIENT).toMatch(/failDial\(m\.message \|\| "They're unreachable right now\.", "server-error:"/);
    expect(CLIENT).toMatch(/failDial\("No answer — they'll see your missed call\.", "no-answer"\)/);
    // An explicit End during the failure card must cancel the delayed hangUp.
    expect(CLIENT).toMatch(/clearFailDial\(\); \/\/ an explicit End during the failure card mustn't re-fire/);
  });

  it("SERVER: a mid-dial re-register no longer reaps the caller's solo dial room", () => {
    expect(SERVER).toMatch(/const midDial =\s*\n\s*!!c && c\.ringing\.size > 0 && !!rmeta && !rmeta\.accepted &&\s*\n\s*Date\.now\(\) - rmeta\.startedAt < PENDING_RING_TTL_MS;/);
    expect(SERVER).toMatch(/if \(midDial\) return;/);
  });

  it("SERVER: dead-but-in-grace callee sockets are detectable (alive) and divert to paging", () => {
    expect(SERVER).toMatch(/alive\?: \(\) => boolean/);
    expect(SERVER).toMatch(/alive: \(\) => !closed/);
    expect(SERVER).toMatch(/!!target && \(!onPageCallee \|\| !target\.socket\.alive \|\| target\.socket\.alive\(\)\)/);
  });

  it("SERVER: pending rings are recorded, redelivered on register, and cleared on accept/reject/cancel", () => {
    expect(SERVER).toMatch(/pendingRings: Map<string, PendingRing>/);
    expect(SERVER).toMatch(/export function deliverPendingRing/);
    // Both register paths (fresh + re-affirm) redeliver — to the registering
    // channel's OWN socket (v2.99.5 multi-device: the primary may be another
    // device that is already ringing).
    const hits = SERVER.match(/deliverPendingRing\(reg, (conn\.pin|pin), conn\.socket\)/g) || [];
    expect(hits.length).toBe(2);
    expect(SERVER).toMatch(/clearPendingRing\(reg, calleePin, \{ from: callerPin \}\)/); // cancel
    expect(SERVER).toMatch(/clearPendingRing\(reg, conn\.pin, \{ from: targetPin \}\)/);  // reject
    expect(SERVER).toMatch(/clearPendingRing\(reg, newcomerPin, \{ roomId \}\)/);         // accept
  });

  it("CALLER UX (v2.99.11): a cold OFFLINE dial gets a fast honest error + leave-a-message card — the 'Reaching their phone…' paging status is RETIRED", () => {
    // Owner directive: an offline user must NOT be auto-rung. The server answers
    // a cold dial to an offline identity with error{offline} naming the callee
    // (no `paging: true` ack), and the client turns that into the voicemail/SMS
    // card via failDial("server-error:offline").
    // v2.99.44 adds `pin` (which invitee) so a group dial can tell when the
    // LAST one has resolved; the message itself is unchanged.
    expect(SERVER).toMatch(/code: "offline",\s*\n\s*pin: to,\s*\n\s*message: \(info\.name \|\| "They"\) \+ " is offline right now\."/);
    expect(SERVER).not.toMatch(/paging: true/);
    expect(CLIENT).not.toMatch(/setCallStatus\("ringing", "Reaching their phone…"\)/);
    expect(CLIENT).toMatch(/reason === "no-answer" \|\| reason === "peer-rejected" \|\| reason === "server-error:offline"/);
  });

  it("voice-first everywhere: History redial, missed banner, Messages call button, hardware Enter", () => {
    expect(HISTORY).toMatch(/engine\.dial\(num, \{ voice: true \}\)/);
    expect(HISTORY).toMatch(/engine\.dialGroup\(nums, \{ voice: true \}\)/);
    expect(DIALER).toMatch(/engine\.dial\(missedLatest\.number, \{ voice: true \}\)/);
    expect(DIALER).toMatch(/startCallNow\(\{ voice: true \}\);\s*\n\s*\}\s*\n\s*\}\s*\n\s*\};\s*\n\s*window\.addEventListener\("keydown", onKey\)/);
    expect(MESSAGES).toMatch(/dialer\?to=\$\{encodeURIComponent\(thread\.peerNumber\)\}&voice=1/);
  });

  it("History rows carry a live reachability LED from ONE batched presence query", () => {
    expect(HISTORY).toMatch(/trpc\.directory\.presenceMany\.useQuery/);
    expect(HISTORY).toMatch(/function PresenceLed/);
    expect(ROUTERS).toMatch(/presenceMany: publicProcedure/);
    expect(ROUTERS).toMatch(/numbers: z\.array\(NumberSchema\)\.max\(100\)/);
  });
});

describe("issue 2 — iOS ring sound + notifications", () => {
  it("the ringtone/cue AudioContexts are unlocked by a REAL first gesture (iOS autoplay rule)", () => {
    expect(CLIENT).toMatch(/function unlockEngineAudio\(\)/);
    expect(CLIENT).toMatch(/const onFirstGesture = \(\) => \{\s*\n\s*unlockEngineAudio\(\);/);
    expect(CLIENT).toMatch(/document\.addEventListener\("pointerdown", onFirstGesture\)/);
    // …and re-resumed when the app returns to the foreground (iOS re-suspends).
    expect(CLIENT).toMatch(/ringtoneCtx && ringtoneCtx\.state === "suspended"/);
    // The app-layer notification chime context gets the same treatment.
    expect(SHELL).toMatch(/unlockAudio\(\);\s*\n\s*document\.removeEventListener\("pointerdown", unlock\)/);
  });

  it("an incoming ring vibrates (Android), flashes the tab title, and raises a system notification when hidden", () => {
    expect(CLIENT).toMatch(/navigator\.vibrate\?\.\(\[400, 200, 400\]\)/);
    expect(CLIENT).toMatch(/startTitleFlash\("📞 Incoming call — RELAY"\)/);
    expect(CLIENT).toMatch(/notify\(\{\s*\n\s*title: `Incoming \$\{m\.video \? "video" : "voice"\} call`/);
    // stopRingtone is the single funnel that also stops vibration + title flash.
    expect(CLIENT).toMatch(/navigator\.vibrate\?\.\(0\)/);
    expect(CLIENT).toMatch(/stopTitleFlash\(\);\s*\n\s*\}/);
  });

  it("returning to the foreground reconnects the SSE IMMEDIATELY (the device becomes reachable in <1s)", () => {
    expect(CLIENT).toMatch(/if \(!destroyed && \(!ws \|\| ws\.readyState !== 1 \|\| !wsReady\)\) \{\s*\n\s*try \{ ws\?\.close\(\); \} catch \{ \/\* \*\/ \}\s*\n\s*connectWS\(\);/);
  });

  it("notify() prefers ServiceWorker showNotification (iOS installed PWA can't use the constructor)", () => {
    expect(NOTIF).toMatch(/navigator\.serviceWorker\.controller/);
    expect(NOTIF).toMatch(/reg\.showNotification\(opts\.title/);
    expect(NOTIF).toMatch(/data: \{ url: opts\.url \|\| "\/app\/dialer" \}/);
  });

  it("sw.js handles push + notificationclick (wake → focus/open the app)", () => {
    expect(SW).toMatch(/addEventListener\("push"/);
    expect(SW).toMatch(/showNotification\(d\.title \|\| "RELAY"/);
    expect(SW).toMatch(/requireInteraction: isCall/);
    expect(SW).toMatch(/addEventListener\("notificationclick"/);
    expect(SW).toMatch(/openWindow\(url\)/);
  });

  it("push subscription plumbing: VAPID key endpoint, subscribe/unsubscribe, DB table, client helper, banner", () => {
    expect(ROUTERS).toMatch(/export const v2PushRouter = router\(\{/);
    expect(ROUTERS).toMatch(/publicKey: publicProcedure\.query/);
    expect(V2DB).toMatch(/CREATE TABLE IF NOT EXISTS \\`push_subscriptions\\`/);
    expect(V2DB).toMatch(/export async function upsertPushSubscription/);
    expect(PUSHC).toMatch(/pushManager\.subscribe\(\{\s*\n\s*userVisibleOnly: true/);
    expect(BANNER).toMatch(/iosNeedsInstallForPush\(\)/);
    expect(SHELL).toMatch(/<PushBanner \/>/);
  });

  it("server records the miss + wakes the RETURNING callee with a missed-call push (v2.99.11: no incoming-call auto-ring), stable derived VAPID keys", () => {
    // v2.99.11 (owner: an offline user must NOT be auto-rung): _core's paging
    // hook no longer sends a full-screen incoming-call push. It resolves the
    // identity only; the miss is recorded and a missed-call push/email reaches
    // the callee when they next open the app.
    expect(CORE).not.toMatch(/kind: "incoming-call"/);
    expect(CORE).toMatch(/kind: "missed-call"/);
    expect(CORE).toMatch(/return \{ exists: true, name: callee\.displayName \?\? undefined \}/);
    expect(WEBPUSH).toMatch(/export function deriveVapidKeys/);
    // The incoming-call push kind + its 70s TTL stay as generic push infra (the
    // native Android app still uses it for ring-when-closed via FCM data).
    expect(WEBPUSH).toMatch(/TTL: payload\.kind === "incoming-call" \? 70 : 3600/);
  });
});
