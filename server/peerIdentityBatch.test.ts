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
import { copyOnScreen } from "../server/testing/copyOnScreen";

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
    /* REWRITTEN v2.105.6: the old needle required the three arguments on ONE line,
       which the group-aware signature (two more arguments) no longer is. The property
       is that the helper has at least two CALL SITES — post and remove — so a removal
       cannot silently stop clearing stale rings. */
    const calls = V2ROUTERS.match(/publishStatusEvent\(\s*me\.id,/g) ?? [];
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
    // v2.99.54 strengthened this: the lookup used to key on the roster's FROZEN
    // number, so a person who regenerated their number silently lost their photo
    // from everybody's History. It now resolves by identityId, with the
    // by-number lookup kept only for guests who never had an identity.
    expect(V2ROUTERS).toMatch(/getIdentitiesByIds\(rosterIds\)/);
    expect(V2ROUTERS).toMatch(/avatarUrl: live\?\.avatarUrl \?\?/);
    expect(V2ROUTERS).toMatch(/avatarByNumber\.get\(frozenNumber\)/);
  });
  it("PeerAvatar rings: bright for unseen, subtle for seen, click opens status/profile", () => {
    /* REWRITTEN (v2.106.4): this froze the exact three-hue gradient CLASS STRING, so it
       forbade the ring ever becoming the cycling accent while saying nothing about the
       property it exists for — that unseen and seen are visibly DIFFERENT, which is the
       whole signal. The bright state is now the shared `.rstoryring` utility (whose own
       light/dark forms are pinned in accentEverywhere.test.ts), and the seen state is
       still the subtle border. */
    expect(PEER_OVERLAYS).toMatch(/st\.hasUnseen\s*\?\s*"rstoryring"\s*:\s*"bg-border"/);
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
    expect(copyOnScreen(PEER_OVERLAYS, "Add to contacts")).toBe(true);
  });
  it("in-call add-to-contacts lives in exactly ONE place: the per-tile pill", () => {
    // REWRITTEN in v2.99.82. This pinned the top-left `InCallSaveContacts` chip as
    // MOUNTED. Owner: "add contact ... currently you're putting on the profile, on
    // the video, and also you put it on the top left. Just put it one place. Under
    // the name of each user."
    //
    // Nothing was lost by unmounting it, and three things improved: the chip only
    // ever offered the FIRST unsaved peer (a `roster.find`) while the pill is
    // per-peer; it polled every 3s; and it derived a SECOND saved-set from
    // contacts.list that could disagree with the engine's own.
    const engineCode = RELAY_ENGINE
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(engineCode).not.toMatch(/<InCallSaveContacts/);
    // The roster accessor stays — the engine's own saved-set push uses it.
    expect(RELAY_CLIENT).toMatch(/getRoster: \(\) => Array<\{ pin: string; name: string \}>/);
    // The per-tile pill is the single carrier, and it still never shows for a peer
    // who is already saved.
    expect(RELAY_CLIENT).toMatch(/savedContactPins\.has\(pin\)\) return "";/);
  });
});

describe("media previews (v2.96)", () => {
  it("voice notes use the custom player — the native <audio controls> is gone", () => {
    // v2.99.72 threads the stored duration in, so the props grew. Pin the COMPONENT,
    // not the exact prop list — the invariant is that no native <audio> came back.
    /* MATCHED ON THE ELEMENT, not on its first two props in that order (v2.106.89): the
       mount is multi-line now that it also carries the note's identity for the run
       hand-over, and a one-line pattern froze formatting rather than the property. */
    expect(MESSAGES).toMatch(/<VoiceNotePlayer\b/);
    expect(MESSAGES).toMatch(/url=\{url\}/);
    // No JSX <audio> element anywhere (the doc comment naming the old one is fine).
    expect(MESSAGES).not.toMatch(/<audio\s+src=/);
  });
  it("the custom player handles MediaRecorder's Infinity-duration quirk", () => {
    // REWRITTEN in v2.99.72 rather than relaxed. This pinned the two things that WERE
    // the bug: `duration === Infinity` as the trigger, and a MAX_SAFE_INTEGER seek as
    // the cure. That seek ran from `loadedmetadata` — which fires just after the click
    // that started playback — so it jumped the element to the end, fired `ended`, and
    // froze the clock at 0:00. The quirk still has to be HANDLED; the invariant is now
    // that it is handled without touching a playing element.
    expect(MESSAGES).toMatch(/Number\.isFinite\(d\) && d > 0/);
    expect(MESSAGES).toMatch(/a\.currentTime = 1e101;/);
    expect(MESSAGES).toMatch(/if \(probingRef\.current \|\| !a\.paused\) return;/);
    expect(MESSAGES).not.toMatch(/currentTime = Number\.MAX_SAFE_INTEGER/);
  });
  it("generic files render as a styled card with a download affordance", () => {
    expect(MESSAGES).toMatch(/function FileCard\(/);
    expect(copyOnScreen(MESSAGES, "Tap to open or download")).toBe(true);
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
    // getAttachmentForIdentity). v2.99.37 (M22): that write moved into the
    // shared ATOMIC `burnExpiringMessage` helper, so assert the delegation here
    // and the nulling itself at the helper.
    expect(fn).toMatch(/await burnExpiringMessage\(/);
    expect(
      V2DB.slice(
        V2DB.indexOf("async function burnExpiringMessage"),
        V2DB.indexOf("export async function consumeExpiringMessage"),
      ),
    ).toMatch(/attachmentId: null/);
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
    // The reply quote MASKS the body rather than quoting it. Pinned as the guard plus
    // the words it substitutes: the sentence moved into the dictionary, and freezing the
    // `return "…"` shape would have forbidden that while saying nothing about the leak.
    expect(MESSAGES).toMatch(
      /\?\.expire != null\) return t\("msg\.disappearingPreview"\)/,
    ); // reply quote
    expect(copyOnScreen(MESSAGES, "⏱ Disappearing message")).toBe(true);
  });
  it("the composer cycles off → view-once → 5s → 10s → 30s and resets per send", () => {
    expect(MESSAGES).toMatch(
      /v === null \? "once" : v === "once" \? 5 : v === 5 \? 10 : v === 10 \? 30 : null/
    );
    expect(MESSAGES).toMatch(/setExpire\(null\); \/\/ per-send setting/);
  });
  it("the recipient's locked bubble reveals via the server (which burns it) — v2.99.34 M11", () => {
    expect(MESSAGES).toMatch(/function revealExpiring\(m: Msg\)/);
    // M11: content is withheld from list; reveal goes through the server
    // endpoint, which returns it once and burns it (no client consumeExpiring).
    expect(MESSAGES).toMatch(/await revealExpiringMutation\.mutateAsync\(\{ messageId: m\.id \}\)/);
    expect(copyOnScreen(MESSAGES, "Tap to view")).toBe(true);
    expect(copyOnScreen(MESSAGES, "This message has disappeared")).toBe(true);
  });
  it("voice notes honor the composer's disappearing setting", () => {
    const blob = MESSAGES.slice(MESSAGES.indexOf("async function uploadBlob"));
    expect(blob.slice(0, 800)).toMatch(/meta: exp != null \? \{ expire: exp \} : undefined/);
  });
});
