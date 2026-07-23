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
    for (const id of ["micBtn", "camBtn", "flipCamBtn", "screenBtn", "qualityBtn", "audioBtn", "pipBtn", "filterBtn", "addBtn", "hostBtn", "chatBtn", "moreBtn"]) {
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
  it("each control has a distinct color identity on its chip", () => {
    // Spot-check a spread of the 12 per-id tints.
    expect(RELAY_CSS).toMatch(/#micBtn \.ctrl-ic\{color:#34d399/);
    expect(RELAY_CSS).toMatch(/#camBtn \.ctrl-ic\{color:#38bdf8/);
    expect(RELAY_CSS).toMatch(/#audioBtn \.ctrl-ic\{color:#fb923c/);
    expect(RELAY_CSS).toMatch(/#filterBtn \.ctrl-ic\{color:#e879f9/);
    expect(RELAY_CSS).toMatch(/#hostBtn \.ctrl-ic\{color:#facc15/);
    expect(RELAY_CSS).toMatch(/#moreBtn \.ctrl-ic\{color:#cbd5e1/);
  });
  it("state classes restyle the CHIP (the button itself is now a transparent column)", () => {
    expect(RELAY_CSS).toMatch(/\.ctrl\.off \.ctrl-ic\{background:rgba\(255,92,114/);
    expect(RELAY_CSS).toMatch(/\.ctrl\.on \.ctrl-ic\{background:rgba\(63,224,197/);
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

describe("⋯ More menu: Record + Diagnostics rows (v2.99.4)", () => {
  it("has the menu with a labeled Record row (same #recordBtn id — JS untouched) and a Diagnostics row", () => {
    expect(RELAY_MARKUP).toMatch(/id="moreMenu"/);
    expect(RELAY_MARKUP).toMatch(/id="moreBtn"/);
    const rec = RELAY_MARKUP.match(/<button[^>]*id="recordBtn"[^>]*>([\s\S]*?)<\/button>/);
    expect(rec).toBeTruthy();
    expect(rec![0]).toMatch(/class="mm-item"/);
    expect(rec![0]).toMatch(/style="display:none"/); // revealed only when recording is configured
    expect(rec![1]).toContain("Record call");
    expect(RELAY_MARKUP).toMatch(/id="diagMenuBtn"[\s\S]{0,400}Diagnostics/);
  });
  it("is wired: moreBtn toggles, diag row opens diagnostics, outside click dismisses", () => {
    expect(CLIENT).toMatch(/\$\("moreBtn"\) as HTMLElement \| null\)\?\.addEventListener\("click"/);
    expect(CLIENT).toMatch(/\$\("diagMenuBtn"\) as HTMLElement \| null\)\?\.addEventListener\("click"/);
    expect(CLIENT).toMatch(/if \(outside\("moreMenu", "moreBtn"\)\)/);
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
