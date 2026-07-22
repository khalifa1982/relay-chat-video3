/**
 * v2.96 peer-identity batch — contract pins.
 *
 * The batch has four legs, all pinned here from source (they're UI/wiring
 * changes with no pure functions to unit-test in Node):
 *  1. AVATARS EVERYWHERE — the client renders the peer's LIVE photo in thread
 *     rows, the chat header, contacts, and history; contacts.list merges the
 *     identity's CURRENT avatar over the frozen saved copy (the propagation
 *     bug: a changed profile photo never reached anyone who saved you).
 *  2. STATUS REALTIME — status.post/remove fan a "status" SSE event out to the
 *     reverse audience; the client invalidates the feed + shows a quiet toast,
 *     and every avatar carries a status RING (gradient = unseen) that opens
 *     the story viewer from anywhere.
 *  3. MEDIA PREVIEWS — voice notes get a custom dark player (native <audio>
 *     is gone), generic files get a styled card, the lightbox can download.
 *  4. SELF-DESTRUCT — meta.expire ("once" | 5 | 10 | 30) locks the bubble for
 *     the recipient; opening burns the row for everyone via
 *     messages.consumeExpiring (attachment row deleted → media access
 *     revoked), and expiring content never leaks via thread previews, search,
 *     or reply quotes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

const V2EVENTS = read("server/v2events.ts");
const V2ROUTERS = read("server/v2routers.ts");
const V2DB = read("server/v2db.ts");
const USE_REALTIME = read("client/src/app/useRealtime.ts");
const APP_SHELL = read("client/src/app/AppShell.tsx");
const PEER_OVERLAYS = read("client/src/app/PeerOverlays.tsx");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const CONTACTS = read("client/src/pages/app/Contacts.tsx");
const HISTORY = read("client/src/pages/app/History.tsx");
const DIALER = read("client/src/pages/app/Dialer.tsx");
const RELAY_ENGINE = read("client/src/app/RelayEngine.tsx");
const RELAY_CLIENT = read("client/src/lib/relayClient.ts");

describe("status realtime (v2.96)", () => {
  it("the SSE event union carries a 'status' kind on both sides", () => {
    expect(V2EVENTS).toMatch(/kind:\s*"status";\s*number:\s*string;\s*name:\s*string/);
    expect(USE_REALTIME).toMatch(/kind:\s*"status";\s*number:\s*string;\s*name:\s*string/);
  });
  it("status.post AND remove fan out to the reverse audience", () => {
    // One publish helper, called from both mutations.
    expect(V2ROUTERS).toMatch(/async function publishStatusEvent\(/);
    const calls = V2ROUTERS.match(/publishStatusEvent\(me\.id,\s*me\.number,\s*me\.displayName/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });
  it("the reverse audience mirrors the feed rule (saved me, non-blocked, both ways)", () => {
    expect(V2DB).toMatch(/export async function getStatusAudienceIds\(/);
    // Drops savers who blocked me AND anyone I blocked back.
    expect(V2DB).toMatch(/savers\.filter\(\(r\) => r\.blocked !== true\)/);
    expect(V2DB).toMatch(/blockedNumbers\.has\(i\.number\)/);
  });
  it("the client invalidates the feed and toasts QUIETLY (no notify/ring) on status", () => {
    const statusCase = USE_REALTIME.slice(USE_REALTIME.indexOf('case "status"'));
    expect(statusCase).toMatch(/utils\.status\.feed\.invalidate\(\)/);
    expect(statusCase).toMatch(/relay:open-status/); // toast's View action deep-opens the viewer
    const caseBlock = statusCase.slice(0, statusCase.indexOf("break;"));
    expect(caseBlock).not.toMatch(/notify\(/);
    expect(caseBlock).not.toMatch(/playCallRing|playMessageChime/);
  });
  it("removal events refresh silently (no toast for removed)", () => {
    expect(USE_REALTIME).toMatch(/if \(!payload\.removed\)/);
  });
  it("the Messages tab shows the unseen-status dot on BOTH navs", () => {
    expect(APP_SHELL).toMatch(/hasUnseenStatus/);
    const dots = APP_SHELL.match(/tab\.key === "messages" && hasUnseenStatus/g) ?? [];
    expect(dots.length).toBe(2); // desktop sidebar + mobile bar
  });
});

describe("avatars everywhere (v2.96)", () => {
  it("contacts.list serves the LIVE identity avatar over the frozen saved copy", () => {
    expect(V2ROUTERS).toMatch(/liveAvatarByNumber\.get\(r\.number\) \?\? r\.avatarUrl/);
  });
  it("conferenceHistory participants carry live avatarUrls (one batched query)", () => {
    expect(V2ROUTERS).toMatch(/avatarByNumber\.get\(p\.number\)/);
  });
  it("PeerAvatar rings: gradient for unseen, subtle for seen, click opens status/profile", () => {
    expect(PEER_OVERLAYS).toMatch(/from-\[#06d6a0\] via-\[#0ea5e9\] to-\[#8b5cf6\]/);
    expect(PEER_OVERLAYS).toMatch(/st\.hasUnseen[\s\S]*?:\s*"bg-border"/);
    expect(PEER_OVERLAYS).toMatch(/if \(st\?\.hasAny\) openPeerStatus\(number\);\s*\n\s*else openPeerProfile\(number\);/);
  });
  it("the host is mounted once in the AppShell", () => {
    expect(APP_SHELL).toMatch(/<PeerOverlaysHost \/>/);
  });
  it("thread rows + chat header render PeerAvatar with the peer's photo", () => {
    expect(MESSAGES).toMatch(/avatarUrl=\{t\.peerAvatarUrl\}/);
    expect(MESSAGES).toMatch(/avatarUrl=\{thread\?\.peerAvatarUrl\}/);
  });
  it("contact rows render PeerAvatar and the main tap opens the profile popup", () => {
    expect(CONTACTS).toMatch(/avatarUrl=\{c\.avatarUrl\}/);
    expect(CONTACTS).toMatch(/onClick=\{\(\) => openPeerProfile\(c\.number\)\}/);
  });
  it("history rows render PeerAvatar (tone-tinted initials fallback) + clickable names", () => {
    expect(HISTORY).toMatch(/avatarUrl=\{call\.other\?\.avatarUrl\}/);
    expect(HISTORY).toMatch(/avatarUrl=\{peer\?\.avatarUrl\}/);
    expect(HISTORY).toMatch(/fallbackClassName=\{tone\.bubble/);
    const profileClicks = HISTORY.match(/openPeerProfile\(/g) ?? [];
    expect(profileClicks.length).toBeGreaterThanOrEqual(2);
  });
  it("the dialer's 6-digit preview name opens the profile popup", () => {
    expect(DIALER).toMatch(/openPeerProfile\(previewIdentity\.number\)/);
  });
});

describe("quick-add contacts (v2.96)", () => {
  it("history rows offer one-tap add when the peer isn't saved", () => {
    expect(HISTORY).toMatch(/savedNumbers/);
    expect(HISTORY).toMatch(/!saved && onAddContact && peerNum/);
    expect(HISTORY).toMatch(/!isGroup && !saved && onAddContact && peer\?\.number/);
  });
  it("the profile popup has add-to-contacts (disabled once saved)", () => {
    expect(PEER_OVERLAYS).toMatch(/disabled=\{saved \|\| upsert\.isPending\}/);
    expect(PEER_OVERLAYS).toMatch(/Add to contacts/);
  });
  it("in-call: the engine exposes a read-only roster and the host renders the save chip", () => {
    expect(RELAY_CLIENT).toMatch(/getRoster: \(\) => Array<\{ pin: string; name: string \}>/);
    expect(RELAY_ENGINE).toMatch(/phase === "in-call" \? <InCallSaveContacts/);
    // The chip must never render for peers already saved (v2.96.1: icon-only,
    // no dismissed-set — it simply vanishes once everyone is saved).
    expect(RELAY_ENGINE).toMatch(/!saved\.has\(r\.pin\)/);
  });
});

describe("media previews (v2.96)", () => {
  it("voice notes use the custom player — the native <audio controls> is gone", () => {
    expect(MESSAGES).toMatch(/<VoiceNotePlayer url=\{url\} mine=\{mine\} \/>/);
    // No JSX <audio> element anywhere (the doc comment naming the old one is fine).
    expect(MESSAGES).not.toMatch(/<audio\s+src=/);
  });
  it("the custom player handles MediaRecorder's Infinity-duration quirk", () => {
    expect(MESSAGES).toMatch(/a\.duration === Infinity/);
    expect(MESSAGES).toMatch(/Number\.MAX_SAFE_INTEGER/);
  });
  it("generic files render as a styled card with a download affordance", () => {
    expect(MESSAGES).toMatch(/function FileCard\(/);
    expect(MESSAGES).toMatch(/Tap to open or download/);
  });
  it("a broken image falls back to the file card instead of a white rectangle", () => {
    expect(MESSAGES).toMatch(/onError=\{\(\) => setImgBroken\(true\)\}/);
    expect(MESSAGES).toMatch(/if \(imgBroken\) return <FileCard/);
  });
  it("the lightbox offers a download of the full-size original", () => {
    const lightbox = MESSAGES.slice(MESSAGES.indexOf("function MediaLightbox"));
    expect(lightbox).toMatch(/href=\{media\.url\}/);
    expect(lightbox).toMatch(/download=\{media\.name \|\| true\}/);
  });
});

describe("self-destructing messages (v2.96)", () => {
  it("send's meta schema is still CLOSED and accepts expire once|5|10|30", () => {
    expect(V2ROUTERS).toMatch(/voicemail: z\.literal\(true\)\.optional\(\)/);
    expect(V2ROUTERS).toMatch(
      /\.union\(\[z\.literal\("once"\), z\.literal\(5\), z\.literal\(10\), z\.literal\(30\)\]\)/
    );
  });
  it("consume burns for everyone: participant-only, non-sender, exactly once", () => {
    expect(V2DB).toMatch(/export async function consumeExpiringMessage\(/);
    expect(V2DB).toMatch(/if \(row\.senderIdentityId === input\.identityId\) return null;/);
    expect(V2DB).toMatch(/if \(!pids\.includes\(input\.identityId\)\) return null;/);
    expect(V2DB).toMatch(/meta\.consumedAt != null\) return null;/);
  });
  it("burning REVOKES media access by failing closed, not by deleting the row (F3)", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("export async function consumeExpiringMessage"),
      V2DB.indexOf("export async function markThreadRead")
    );
    // The message's attachmentId is nulled (revokes participant access via
    // getAttachmentForIdentity)…
    expect(fn).toMatch(/attachmentId: null/);
    // …but the attachments ROW is deliberately NOT deleted. Deleting it made
    // getAttachmentByStorageKey return null → authorizeStorageKey classified the
    // still-present S3 object as `unknown`, which the storage proxy serves to
    // ANYONE. Keeping the row keeps it classified as `attachment` → 403 for every
    // non-uploader (fail closed).
    expect(fn).not.toMatch(/db\.delete\(attachments\)/);
    expect(fn).toMatch(/fails CLOSED/);
  });
  it("the burn fans a message event out to every participant", () => {
    const proc = V2ROUTERS.slice(V2ROUTERS.indexOf("consumeExpiring:"));
    expect(proc).toMatch(/for \(const pid of res\.participantIds\)/);
    expect(proc).toMatch(/publishToIdentity\(pid,\s*\{ kind: "message"/);
  });
  it("expiring content never leaks: thread previews, search, reply quotes", () => {
    expect(V2DB).toMatch(/expire\?: unknown \} \| null\)\?\.expire != null[\s\S]{0,40}\? null/); // listThreads preview
    expect(V2DB).toMatch(/rows\.filter\(\(r\) => \(r\.meta as \{ expire\?: unknown \} \| null\)\?\.expire == null\)/); // search
    expect(MESSAGES).toMatch(/return "⏱ Disappearing message";/); // reply quote
  });
  it("the composer cycles off → view-once → 5s → 10s → 30s and resets per send", () => {
    expect(MESSAGES).toMatch(
      /v === null \? "once" : v === "once" \? 5 : v === 5 \? 10 : v === 10 \? 30 : null/
    );
    expect(MESSAGES).toMatch(/setExpire\(null\); \/\/ per-send setting/);
  });
  it("the recipient's locked bubble reveals a LOCAL copy and burns server-side", () => {
    expect(MESSAGES).toMatch(/function revealExpiring\(m: Msg\)/);
    expect(MESSAGES).toMatch(/consumeExpiring\.mutate\(\{ messageId: m\.id \}\)/);
    expect(MESSAGES).toMatch(/Tap to view/);
    expect(MESSAGES).toMatch(/This message has disappeared/);
  });
  it("voice notes honor the composer's disappearing setting", () => {
    const blob = MESSAGES.slice(MESSAGES.indexOf("async function uploadBlob"));
    expect(blob.slice(0, 800)).toMatch(/meta: exp != null \? \{ expire: exp \} : undefined/);
  });
});
