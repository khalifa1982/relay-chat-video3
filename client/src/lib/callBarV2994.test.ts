import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RELAY_CSS, RELAY_MARKUP } from "./relayAssets";

/**
 * v2.99.4 — in-call control bar redesign + mobile sound menu + in-call chat
 * upgrade (owner spec, 4 screenshots):
 *  - every control is a COLORED icon chip with a text LABEL underneath
 *    (mic swaps Mute/Unmute, camera swaps Cam off/Cam on with the .off class);
 *  - Sound opens a real Loudspeaker / Earpiece / Bluetooth menu on phones;
 *  - a ⋯ More menu holds Record + Diagnostics with descriptions;
 *  - the in-call chat gets an emoji palette and a GLASS identity chip
 *    (avatar + username + PIN + time) on every message.
 * Layout was verified headlessly (430px phone + 1280px desktop: 13 buttons,
 * 0 clipped, 12 distinct chip colors; pre-connect dial screen intact).
 */
const CLIENT = fs.readFileSync(path.resolve(__dirname, "relayClient.ts"), "utf8");

describe("control bar: labeled colored chips (v2.99.4)", () => {
  it("every bar button wraps its icon in .ctrl-ic and carries a .ctrl-lbl", () => {
    /* v2.99.36 (owner): moreBtn removed. `recordBtn` was also in this list until
       v2.106.53 — recording was an Egress job on the retired media server, so the
       control had nothing behind it and a chip that cannot record is worse than none. */
    for (const id of ["micBtn", "camBtn", "flipCamBtn", "screenBtn", "qualityBtn", "audioBtn", "pipBtn", "filterBtn", "addBtn", "hostBtn", "chatBtn"]) {
      const btn = RELAY_MARKUP.match(new RegExp(`<button[^>]*id="${id}"[^>]*>([\\s\\S]*?)</button>`));
      expect(btn, `#${id} must exist`).toBeTruthy();
      expect(btn![1], `#${id} needs the icon chip`).toContain('class="ctrl-ic"');
      expect(btn![1], `#${id} needs a label`).toContain("ctrl-lbl");
    }
  });
  it("mic label swaps Mute/Unmute and camera swaps Cam off/Cam on via the .off class", () => {
    expect(RELAY_MARKUP).toMatch(/<span class="lbl-on">Mute<\/span><span class="lbl-off">Unmute<\/span>/);
    expect(RELAY_MARKUP).toMatch(/<span class="lbl-on">Cam off<\/span><span class="lbl-off">Cam on<\/span>/);
    expect(RELAY_CSS).toMatch(/\.ctrl \.lbl-off\{display:none\}/);
    expect(RELAY_CSS).toMatch(/\.ctrl\.off \.lbl-on\{display:none\}/);
    expect(RELAY_CSS).toMatch(/\.ctrl\.off \.lbl-off\{display:inline\}/);
  });
  it("each control keeps its distinct colour identity", () => {
    /* REWRITTEN (v2.106.6). This froze the hue as a `color` DECLARATION inside an ID
       rule — and that shape was itself the bug: an ID is compared before any number of
       classes, so an ID rule owning `color` (or the chip's fill) makes the `.off` and
       `.on` states unreachable. The muted-mic red chip never rendered for four releases
       because of it. The property here is only that each control HAS its own hue; it now
       arrives as `--ctrl-hue`, which the base rule reads, so state can win by order. */
    expect(RELAY_CSS).toMatch(/#micBtn\{--ctrl-hue:#34d399/);
    expect(RELAY_CSS).toMatch(/#camBtn\{--ctrl-hue:#38bdf8/);
    expect(RELAY_CSS).toMatch(/#audioBtn\{--ctrl-hue:#fb923c/);
    expect(RELAY_CSS).toMatch(/#filterBtn\{--ctrl-hue:#e879f9/);
    expect(RELAY_CSS).toMatch(/#hostBtn\{--ctrl-hue:#facc15/);
    expect(RELAY_CSS).toMatch(/\.ctrl \.ctrl-ic\{[^}]*color:var\(--ctrl-hue/);
  });
  it("state classes restyle the CHIP (the button itself is now a transparent column)", () => {
    expect(RELAY_CSS).toMatch(/\.ctrl\.off \.ctrl-ic\{background:rgba\(255,92,114/);
    /* The ACTIVE fill is the cycling accent now (board phase 3) rather than the fixed
       cyan this used to freeze; the property is that ACTIVE has its own fill at all. */
    expect(RELAY_CSS).toMatch(/\.ctrl\.on \.ctrl-ic\{background:rgba\((?:63,224,197|var\(--rb-rgb\))/);
    expect(RELAY_CSS).toMatch(/\.ctrl\.voiced:not\(\.off\) \.ctrl-ic\{animation:relayMicVoiced/);
  });
  it("the HD/SD text lives in #qualityTxt so updateQualityBtn never wipes the label", () => {
    expect(RELAY_MARKUP).toMatch(/<span id="qualityTxt">HD<\/span>/);
    expect(CLIENT).toMatch(/const t = \$\("qualityTxt"\);\s*\n\s*if \(t\) t\.textContent/);
  });
  it("the hang-up button keeps its dedicated circle (explicit grid centering, v2.98.3 lesson)", () => {
    expect(RELAY_CSS).toMatch(/\.ctrl\.hangup\{width:58px;height:58px;[^}]*display:grid;place-items:center/);
  });
});

describe("v2.99.36 (owner): the ⋯ More menu + Diagnostics panel are REMOVED", () => {
  it("no More button/menu and no Diagnostics UI remain in the markup", () => {
    expect(RELAY_MARKUP).not.toMatch(/id="moreMenu"/);
    expect(RELAY_MARKUP).not.toMatch(/id="moreBtn"/);
    expect(RELAY_MARKUP).not.toMatch(/id="diagMenuBtn"/);
    expect(RELAY_MARKUP).not.toMatch(/id="diagBtn"/);
    expect(RELAY_MARKUP).not.toMatch(/id="diagOverlay"/);
    expect(RELAY_MARKUP).not.toMatch(/Diagnostics/);
  });
  it("Record is gone entirely — control, indicator, CSS and wiring", () => {
    /* v2.106.53. Recording was a room-composite Egress job on the hosted media
       server; the owner cancelled that account, so there is nothing to start. A
       control that is permanently hidden is dead weight, and one that is VISIBLE and
       cannot record is worse — so the chip, the "● REC" header indicator, their CSS
       and the click wiring all go together rather than leaving a stub. */
    expect(RELAY_MARKUP).not.toMatch(/id="recordBtn"/);
    expect(RELAY_MARKUP).not.toMatch(/id="recIndicator"/);
    expect(RELAY_CSS).not.toMatch(/#recordBtn/);
    expect(RELAY_CSS).not.toMatch(/\.rec-ind\b/);
    expect(CLIENT).not.toMatch(/recordBtn/);
    expect(CLIENT).not.toMatch(/toggleRecording/);
    expect(CLIENT).not.toMatch(/recordingAvailable/);
  });
  it("the wiring, the toggleDiag panel and the '?' shortcut are gone", () => {
    expect(CLIENT).not.toMatch(/moreMenu/);
    expect(CLIENT).not.toMatch(/moreBtn/);
    expect(CLIENT).not.toMatch(/function toggleDiag/);
    expect(CLIENT).not.toMatch(/diagMenuBtn/);
    expect(CLIENT).not.toMatch(/e\.key === "\?"/);
  });
  it("but the internal diag() event log is KEPT for console debugging", () => {
    expect(CLIENT).toMatch(/function diag\(line: string\)/);
    expect(CLIENT).toMatch(/diagLog\.push\(entry\)/);
  });
});

describe("mobile sound menu: Loudspeaker / Earpiece / Bluetooth (v2.99.4)", () => {
  it("phones get the three-route menu with honest per-route descriptions", () => {
    expect(CLIENT).toMatch(/mobileAudioRow\("loud", "🔊", "Loudspeaker"/);
    expect(CLIENT).toMatch(/mobileAudioRow\("ear", "📞", "Earpiece"/);
    expect(CLIENT).toMatch(/mobileAudioRow\("bt", "🎧", "Bluetooth \/ headset"/);
  });
  it("routes act on the loudspeaker force (earpiece/bluetooth DROP it so the OS default route carries audio)", () => {
    const fn = CLIENT.slice(CLIENT.indexOf("async function setMobileRoute"), CLIENT.indexOf("function onAudioMenuClick"));
    expect(fn).toMatch(/loudspeakerEnable\(\)/);
    expect(fn).toMatch(/loudspeakerDisable\(\)/);
    expect(fn).toMatch(/setLoudspeakerPref\(false\)/);
    // Native Android keeps the real OS speakerphone path.
    expect(fn).toMatch(/isNativeAndroid\(\)/);
  });
  it("the menu click handler understands BOTH route rows (mobile) and sink rows (desktop)", () => {
    expect(CLIENT).toMatch(/button\[data-route\]/);
    expect(CLIENT).toMatch(/button\[data-sink\]/);
  });
});

describe("in-call chat: glass identity chip + emoji palette (v2.99.4)", () => {
  it("every message renders a .mident glass chip with avatar + name + PIN + time", () => {
    expect(CLIENT).toMatch(/<div class="mident">/);
    expect(CLIENT).toMatch(/fmtPin\(idPin\)/);
    expect(RELAY_CSS).toMatch(/\.mident\{[^}]*backdrop-filter:blur/);
    expect(RELAY_CSS).toMatch(/\.mrow\.me \.mident\{margin-left:auto/);
  });
  it("chat frames carry the sender PIN (old clients ignore the extra field)", () => {
    expect(CLIENT).toMatch(/JSON\.stringify\(\{ name: me\.name, text, id, pin: me\.pin \|\| undefined \}\)/);
    expect(CLIENT).toMatch(/typeof d\.pin === "string" \? d\.pin : undefined/);
  });
  it("sender avatars resolve via the public directory.lookup once per pin (cached, decoration-only)", () => {
    expect(CLIENT).toMatch(/const chatAvatars = new Map<string, string \| null>\(\)/);
    expect(CLIENT).toMatch(/function ensureChatAvatar\(pin\?: string\)/);
    expect(CLIENT).toMatch(/chatAvatars\.set\(pin, null\); \/\/ in-flight marker/);
  });
  it("the composer has a real emoji palette: toggle button, lazy build, caret insertion", () => {
    expect(RELAY_MARKUP).toMatch(/id="chatEmojiBtn"/);
    expect(RELAY_MARKUP).toMatch(/id="chatEmojis"/);
    expect(CLIENT).toMatch(/const CHAT_EMOJIS = \[/);
    expect(CLIENT).toMatch(/function insertChatEmoji\(emoji: string\)/);
    expect(CLIENT).toMatch(/f\.setSelectionRange\(pos, pos\)/);
    expect(RELAY_CSS).toMatch(/\.chat-emojis\.open\{display:flex\}/);
  });
});
