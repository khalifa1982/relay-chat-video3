import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { RELAY_CSS } from "./relayAssets";

/**
 * v2.99.8 — in-call minimize box + screen-share maximize + per-tile
 * add-to-contacts + dialpad save + End Call caption fix (owner batch).
 * Layout states verified headlessly; the wiring is pinned against source.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CLIENT = read("client/src/lib/relayClient.ts");
const ENGINE = read("client/src/app/RelayEngine.tsx");
const DIALER = read("client/src/pages/app/Dialer.tsx");

describe("engine handle gains minimize + saved-contacts + save callback", () => {
  it("RelayHandle declares setMinimized / setSavedContacts / setOnSaveContact", () => {
    expect(CLIENT).toMatch(/setMinimized: \(on: boolean\) => void/);
    expect(CLIENT).toMatch(/setSavedContacts: \(pins: string\[\]\) => void/);
    expect(CLIENT).toMatch(/setOnSaveContact: \(cb:/);
  });
  it("setMinimized forces the compact layout deterministically", () => {
    expect(CLIENT).toMatch(/setMinimized\(on\) \{[\s\S]*?compactView = !!on;[\s\S]*?layoutGrid\(\);/);
  });
  it("setSavedContacts stores the set + re-renders the add marks", () => {
    expect(CLIENT).toMatch(/savedContactPins = new Set/);
    expect(CLIENT).toMatch(/refreshAllTileAddMarks\(\)/);
  });
});

describe("per-tile add-to-contacts mark (v2.99.8)", () => {
  it("tileContentHTML emits an add mark for unsaved remote peers only", () => {
    expect(CLIENT).toMatch(/function addContactMarkHTML\(pin: string, name: string\)/);
    expect(CLIENT).toMatch(/if \(!\/\^\\d\{6\}\$\/\.test\(pin\) \|\| savedContactPins\.has\(pin\)\) return "";/);
    expect(CLIENT).toMatch(/data-addc="/);
  });
  it("onGridClick bridges an add tap to React (optimistic mark removal)", () => {
    const fn = CLIENT.slice(CLIENT.indexOf("function onGridClick"), CLIENT.indexOf("function resetSpeakerView"));
    expect(fn).toMatch(/\.closest\?\.\(".tile-addc"\)/);
    expect(fn).toMatch(/savedContactPins\.add\(pin\)/);
    expect(fn).toMatch(/onSaveContact\?\.\(pin, nm\)/);
  });
  it("CSS: the add pill is styled and hidden on tiny thumbs", () => {
    expect(RELAY_CSS).toMatch(/\.relay-tile \.tile-addc\{/);
    expect(RELAY_CSS).toMatch(/#videoGrid\.spotlight \.relay-tile\.is-thumb \.tile-addc\{display:none\}/);
  });
});

describe("screen-share maximize / restore (v2.99.8)", () => {
  it("a per-tile maximize button exists, shown only on .screen tiles", () => {
    expect(CLIENT).toMatch(/class="tile-max-btn"/);
    expect(RELAY_CSS).toMatch(/\.relay-tile\.screen \.tile-max-btn\{display:grid\}/);
  });
  it("onGridClick toggles screenMaximized and layoutGrid full-bleeds it", () => {
    const fn = CLIENT.slice(CLIENT.indexOf("function onGridClick"), CLIENT.indexOf("function resetSpeakerView"));
    expect(fn).toMatch(/\.closest\?\.\(".tile-max-btn"\)/);
    expect(fn).toMatch(/screenMaximized = true/);
    expect(CLIENT).toMatch(/const maxNow = screenMaximized && screenShareIds\.has\(plan\.focusId\)/);
    expect(CLIENT).toMatch(/g\.classList\.toggle\("screen-max", maxNow\)/);
  });
  it("a maximized share collapses back to the grid when the screen ends", () => {
    expect(CLIENT).toMatch(/if \(screenMaximized && spotlightId === id\) \{ screenMaximized = false;/);
    expect(CLIENT).toMatch(/screenShareIds\.clear\(\); compactView = false; screenMaximized = false;/);
  });
});

describe("RelayEngine minimize box + fit (v2.99.8)", () => {
  it("adds a minimized display state, resets on idle, drives the engine", () => {
    expect(ENGINE).toMatch(/const \[minimized, setMinimized\] = useState\(false\)/);
    expect(ENGINE).toMatch(/handleRef\.current\?\.setMinimized\(minimized\)/);
    expect(ENGINE).toMatch(/if \(phase === "idle"\) \{ setMinimized\(false\)/);
  });
  it("keeps app chrome visible while minimized (so Messages/History work behind it)", () => {
    expect(ENGINE).toMatch(/"relay-call-active", phase !== "idle" && !minimized/);
  });
  it("renders Minimize + Fit controls in-call and a draggable mini-box header with people-count + Maximize + hang up", () => {
    expect(ENGINE).toMatch(/setMinimized\(true\)/);
    expect(ENGINE).toMatch(/setFitContain\(\(v\) => !v\)/);
    expect(ENGINE).toMatch(/onPointerDown=\{onMiniDragStart\}/);
    expect(ENGINE).toMatch(/setMinimized\(false\)/); // Maximize
    expect(ENGINE).toMatch(/\{peopleCount\}/);
  });
  it("bridges the per-tile add-contact tap to contacts.upsert + pushes the saved set", () => {
    expect(ENGINE).toMatch(/handle\.setOnSaveContact/);
    expect(ENGINE).toMatch(/handleRef\.current\?\.setSavedContacts/);
  });
});

describe("dialpad save + End Call caption (v2.99.8)", () => {
  it("Dialer offers Save for any complete non-self, non-party-line number", () => {
    expect(DIALER).toMatch(/\/\^\\d\{6\}\$\/\.test\(dialed\) && dialed !== myNumber && !previewIdentity\?\.partyLine/);
    // v2.99.90: the "In your contacts" confirmation this used to pin is GONE at the
    // owner's request ("If the number is already on contact, you don't need to show
    // this message"), so pinning it asserted the very thing they asked to remove.
    // The property that survives is the one this test is named for: a complete,
    // saveable number gets an OFFER, and an already-saved one gets nothing.
    const qa = DIALER.slice(DIALER.indexOf("function QuickAddContact("));
    expect(qa).toMatch(/if \(isAlready\) return null;/);
    expect(qa).toMatch(/upsert\.mutate\(\{ number, displayName:/);
  });
  it("pre-connect controls reserve room so the End Call caption isn't clipped", () => {
    expect(RELAY_CSS).toMatch(/#call\.pre-connect \.controls\{padding-bottom:max\(60px/);
  });
});
