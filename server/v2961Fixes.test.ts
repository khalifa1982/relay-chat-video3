/**
 * v2.96.1 — owner feedback batch (4 points + call-screen extras), contract pins.
 *
 *  1. BROKEN AVATARS root cause: profile photos were uploaded through the
 *     ATTACHMENT path, so the v2.95 participant gate 403'd everyone but the
 *     uploader (owner sees the photo, everyone else a broken image). Fixed at
 *     BOTH ends: new uploads are `?bare=1` (no attachments row), and
 *     authorizeStorageKey rescues LEGACY keys that are some identity's
 *     current avatar. PeerAvatar also degrades to initials on img error.
 *  2. AUTO-REFRESH: a newer deploy reloads silently when idle too — the
 *     "Refresh now" card is only the stale-edge loop-guard fallback.
 *  3. IN-CALL CLARITY: mic/cam controls carry real on/off glyphs (slashed
 *     variant when off); the in-call save-contact chip is icon-only; the
 *     copyright/version tag is hidden during calls.
 *  4. IN-CALL CHAT redesign: bottom sheet on phones (End stays clear), every
 *     message shows avatar + name + time, mine right / theirs left.
 *  5. CAMERA FLIP: stop-first on every platform + retry/backoff + recovery
 *     (the "flip hangs until I toggle a few times" report). PiP on iOS waits
 *     for a decoded frame, verifies the mode flipped, and is honest on
 *     voice-only calls.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

const V2DB = read("server/v2db.ts");
const UPLOAD_LIB = read("client/src/lib/uploadAttachment.ts");
const PROFILE = read("client/src/pages/app/Profile.tsx");
const PEER_OVERLAYS = read("client/src/app/PeerOverlays.tsx");
const UPDATE_CHECKER = read("client/src/app/UpdateChecker.tsx");
const RELAY_ASSETS = read("client/src/lib/relayAssets.ts");
const RELAY_CLIENT = read("client/src/lib/relayClient.ts");
const RELAY_ENGINE = read("client/src/app/RelayEngine.tsx");

describe("avatar propagation — the broken-image root cause (v2.96.1)", () => {
  it("profile photos upload BARE (no attachments row → no participant gate)", () => {
    expect(UPLOAD_LIB).toMatch(/export async function uploadAvatarImage\(/);
    expect(UPLOAD_LIB).toMatch(/async function uploadBare\(/);
    expect(UPLOAD_LIB).toMatch(/bare: "1"/);
    // v2.99.89 moved this from Profile to AvatarPicker, which is where the avatar
    // upload actually happens — Profile's own copy of the call turned out to be
    // unreachable (nothing clicked its file input) and was deleted. Both the photo
    // and the emoji/animated paths go through the bare uploader, so assert both
    // rather than the one that happened to be pinned.
    const PICKER = read("client/src/app/AvatarPicker.tsx");
    expect(PICKER).toMatch(/uploadAvatarImage\(file, \{ mimeType: file\.type \}\)/);
    expect(PICKER).toMatch(/uploadAvatarImage\(blob, \{/);
    // The old row-creating path must be gone from the avatar flow, in BOTH files.
    expect(PICKER).not.toMatch(/uploadAttachment\(/);
    expect(PROFILE).not.toMatch(/uploadAttachment\(/);
    expect(PROFILE).not.toMatch(/uploadAvatarImage/);
  });
  it("legacy avatar keys (attachment-rowed) are rescued in authorizeStorageKey", () => {
    expect(V2DB).toMatch(/export async function isIdentityAvatarKey\(/);
    expect(V2DB).toMatch(/kind: "avatar"; authorized: true/);
    // The rescue runs ONLY on the would-be-403 path, after both attachment rules.
    const fn = V2DB.slice(
      V2DB.indexOf("export async function authorizeStorageKey"),
      V2DB.indexOf("export async function getAttachmentForIdentity")
    );
    expect(fn).toMatch(
      /if \(await isIdentityAvatarKey\(storageKey\)\) return \{ kind: "avatar", authorized: true \};\s*\n\s*return \{ kind: "attachment", authorized: false \};/
    );
  });
  it("isIdentityAvatarKey matches relative AND legacy absolute-origin avatar URLs, LIKE-escaped", () => {
    const fn = V2DB.slice(
      V2DB.indexOf("export async function isIdentityAvatarKey"),
      V2DB.indexOf("export async function authorizeStorageKey")
    );
    expect(fn).toMatch(/eq\(identities\.avatarUrl, exact\)/);
    expect(fn).toMatch(/like\(identities\.avatarUrl, `%\/manus-storage\/\$\{escaped\}`\)/);
    expect(fn).toMatch(/replace\(\/\(\[\\\\%_\]\)\/g, "\\\\\$1"\)/);
  });
  it("PeerAvatar degrades to initials when the photo 403s/404s (never a broken-image glyph)", () => {
    expect(PEER_OVERLAYS).toMatch(/const \[failedUrl, setFailedUrl\] = useState<string \| null>\(null\)/);
    expect(PEER_OVERLAYS).toMatch(/onError=\{\(\) => setFailedUrl\(avatarUrl!\)\}/);
    expect(PEER_OVERLAYS).toMatch(/failedUrl !== avatarUrl/);
  });
});

describe("auto-refresh on update (v2.96.1)", () => {
  it("idle reloads silently too — no Refresh click needed", () => {
    expect(UPDATE_CHECKER).toMatch(/p === "in-call" \|\| p === "idle"/);
  });
  it("the card is only the stale-edge fallback (after a recent reload that didn't stick)", () => {
    expect(UPDATE_CHECKER).toMatch(/recentlyReloaded\(\)/);
    expect(UPDATE_CHECKER).toMatch(/LOOP-GUARD FALLBACK/);
  });
});

describe("in-call control clarity (v2.96.1)", () => {
  it("mic + camera buttons carry BOTH glyphs, slashed variant shown when .off", () => {
    expect(RELAY_ASSETS).toMatch(/id="camBtn"[\s\S]{0,200}class="ic-on"/);
    expect(RELAY_ASSETS).toMatch(/id="micBtn"[\s\S]{0,200}class="ic-on"/);
    // camera-off = slashed video glyph; the CSS swap:
    expect(RELAY_ASSETS).toMatch(/\.ctrl \.ic-off\{display:none\}/);
    expect(RELAY_ASSETS).toMatch(/\.ctrl\.off \.ic-on\{display:none\}/);
    expect(RELAY_ASSETS).toMatch(/\.ctrl\.off \.ic-off\{display:block\}/);
  });
  it("the in-call save-contact control is ICON-ONLY (owner: 'just show the button')", () => {
    const chip = RELAY_ENGINE.slice(RELAY_ENGINE.indexOf("function InCallSaveContacts"));
    // A round icon button with an aria-label/title — no visible "Save <name>" text node.
    expect(chip).toMatch(/<UserPlus className="size-\[18px\]" \/>/);
    expect(chip).toMatch(/aria-label=\{`Save \$\{candidate\.name \|\| candidate\.pin\} to contacts`\}/);
    expect(chip).not.toMatch(/\{upsert\.isPending \? "Saving…"/);
  });
  it("the copyright/version tag is hidden while a call is active", () => {
    expect(RELAY_ENGINE).toMatch(
      /body\.relay-call-active \.relay-root \.version-tag \{ display: none !important; \}/
    );
  });
});

describe("in-call chat redesign (v2.96.1, owner spec)", () => {
  it("is a BOTTOM SHEET on phones — the End pill's corner stays clear", () => {
    expect(RELAY_ASSETS).toMatch(/height:min\(72dvh,560px\)/);
    expect(RELAY_ASSETS).toMatch(/border-radius:22px 22px 0 0/);
    // Composer clears the iOS home bar.
    expect(RELAY_ASSETS).toMatch(/\.chat-input\{padding:11px 12px max\(11px,env\(safe-area-inset-bottom\)\)\}/);
  });
  it("each message row shows avatar + name + TIME; mine right, theirs left", () => {
    expect(RELAY_ASSETS).toMatch(/\.mrow\.me\{align-self:flex-end;flex-direction:row-reverse\}/);
    expect(RELAY_ASSETS).toMatch(/\.mrow\.them\{align-self:flex-start\}/);
    expect(RELAY_ASSETS).toMatch(/\.mrow \.mtime/);
    expect(RELAY_CLIENT).toMatch(/row\.className = "mrow " \+ \(mine \? "me" : "them"\)/);
    expect(RELAY_CLIENT).toMatch(/toLocaleTimeString\(\[\], \{ hour: "numeric", minute: "2-digit" \}\)/);
    // v2.99.4: the avatar+name+time moved INTO the glass .mident chip (plus the
    // sender's PIN) — same information, richer presentation.
    expect(RELAY_CLIENT).toMatch(/<div class="mident">/);
    expect(RELAY_CLIENT).toMatch(/initials\(who\)/);
  });
});

describe("camera flip + PiP reliability (v2.96.1)", () => {
  it("flip retries acquisition with backoff and recovers the original camera on failure", () => {
    expect(RELAY_CLIENT).toMatch(/async function acquireFlippedCameraWithRetry\(/);
    expect(RELAY_CLIENT).toMatch(/const delays = \[0, 300, 700\];/);
    expect(RELAY_CLIENT).toMatch(/await acquireFlippedCameraWithRetry\(facingMode\)/);
  });
  it("a fresh-but-muted flip track rebinds the self tile on unmute (no black tile)", () => {
    expect(RELAY_CLIENT).toMatch(/freshTrack\.addEventListener\("unmute"/);
  });
  it("iOS PiP waits for a decoded frame, then VERIFIES the mode actually flipped", () => {
    expect(RELAY_CLIENT).toMatch(/if \(v\.readyState < 2\)/);
    expect(RELAY_CLIENT).toMatch(/addEventListener\("loadeddata", done, \{ once: true \}\)/);
    expect(RELAY_CLIENT).toMatch(/throw new Error\("ios-pip-refused"\)/);
  });
  it("a voice-only call gets an honest 'needs video' message instead of a fake success", () => {
    expect(RELAY_CLIENT).toMatch(/if \(IS_IOS && !iosPipStream\(\)\) \{/);
    expect(RELAY_CLIENT).toMatch(/Picture-in-Picture needs video/);
  });
});
