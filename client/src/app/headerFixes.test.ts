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

  it("the trigger button visually reflects DND state (BellOff + tint when on)", () => {
    expect(MISSED).toMatch(/\{dnd \? <BellOff className="size-\[18px\]" \/> : <Bell className="size-\[18px\]" \/>\}/);
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

  it("does NOT cancel AppShell's mobile pb-28 — that padding is the only clearance keeping the fixed bottom tab bar from overlapping the composer, not reclaimable dead space", () => {
    expect(MSG).toMatch(/className="h-full flex md:p-6 gap-0 md:gap-6 min-h-0"/);
    expect(MSG).not.toMatch(/className="h-full -mb-28/);
  });
});
