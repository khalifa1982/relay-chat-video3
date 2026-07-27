import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.64 — fixes a real layout collapse in the Messages conversation view
 * (composer floating mid-screen, message list reduced to a sliver) and
 * consolidates two visually-identical bell icons in the app header into one.
 * Static guards pin both fixes so they can't silently regress.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const APPSHELL = read("client/src/app/AppShell.tsx");
const MISSED = read("client/src/app/MissedCalls.tsx");

describe("AppShell — exactly one bell-family icon in the header", () => {
  it("the standalone DndToggle component is gone", () => {
    expect(APPSHELL).not.toMatch(/function DndToggle/);
    expect(APPSHELL).not.toMatch(/<DndToggle/);
  });

  it("Do Not Disturb is wired into NotificationBell instead, on both desktop and mobile", () => {
    const dndProps = (APPSHELL.match(/dnd=\{dnd\}\s*\n\s*onDndChange=\{setDnd\}/g) || []).length;
    expect(dndProps).toBe(2); // desktop sidebar + mobile header
  });

  it("Bell/BellOff icons are no longer imported directly into AppShell (they live in MissedCalls' NotificationBell)", () => {
    expect(APPSHELL).not.toMatch(/\bBell\b/);
    expect(APPSHELL).not.toMatch(/\bBellOff\b/);
  });
});

describe("NotificationBell — DND toggle lives in the panel", () => {
  it("accepts dnd + onDndChange props and renders a Switch bound to them", () => {
    expect(MISSED).toMatch(/dnd: boolean;\s*\n\s*onDndChange: \(value: boolean\) => void;/);
    expect(MISSED).toMatch(/<Switch checked=\{dnd\} onCheckedChange=\{onDndChange\}/);
  });

  it("the trigger button visually reflects DND state (BellOff + its own tint when on)", () => {
    // Rewritten in v2.99.86 to the PROPERTY rather than one exact expression. The
    // old pin froze the whole `{dnd ? <BellOff …/> : <Bell …/>}` line, so it broke
    // the moment the Bell gained a blink class — while saying nothing about the
    // thing that matters, which is that the three states are visually distinct.
    // DND must be BellOff and must NOT be green: green now means "all clear", and
    // one colour meaning both that and "alerts silenced" is the inversion this
    // release exists partly to avoid.
    expect(MISSED).toMatch(/dnd \? \(\s*<BellOff className="size-\[18px\]" \/>/);
    expect(MISSED).toMatch(/<Bell className=\{"size-\[18px\] " \+ \(blink \? "relay-blink" : ""\)\}/);
    // DND has its own token; clear is green; something waiting is destructive.
    expect(MISSED).toMatch(/dnd\s*\?\s*"bg-\[color:var\(--relay-dnd\)\]\/15 text-\[color:var\(--relay-dnd\)\]"/);
    expect(MISSED).toMatch(/text-\[color:var\(--relay-green-text\)\]/);
    expect(MISSED).toMatch(/bg-destructive\/15 text-destructive/);
  });
});

const MSG = read("client/src/pages/app/Messages.tsx");

describe("Messages — conversation-view layout no longer collapses (WebKit flex-absolute bug)", () => {
  it("the message-list wrapper is a real flex column, not relative-with-only-absolute-children", () => {
    expect(MSG).toMatch(/className="relative flex flex-col flex-1 min-h-0"/);
  });

  it("the scroll container is an in-flow flex child, not position:absolute", () => {
    expect(MSG).toMatch(/className="flex-1 min-h-0 overflow-y-auto px-3 md:px-5 py-4 space-y-0\.5/);
    expect(MSG).not.toMatch(/className="absolute inset-0 overflow-y-auto/);
  });

  it("page root fills the shell with flex-1 and no negative-margin hacks — the bottom tab bar is an in-flow sibling in AppShell (content ends exactly at its top edge), and a historical -mb-28 hack once hid the composer behind the old fixed nav", () => {
    expect(MSG).toMatch(/className="flex-1 flex md:p-6 gap-0 md:gap-6 min-h-0"/);
    expect(MSG).not.toMatch(/className="[^"]*-mb-28/);
  });
});
