import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.73 — bottom-nav overhaul, static pins.
 *
 * Three coupled invariants shipped together and none may silently regress:
 *  1. The mobile tab bar is an IN-FLOW flex sibling docked at the very bottom
 *     (NOT position:fixed) — so page content ends exactly at its top edge with
 *     zero gap, zero overlap, and no clearance padding anywhere.
 *  2. Because of (1), the Messages composer sits immediately above the nav and
 *     the message list scrolls above both.
 *  3. Each tab lights up in its OWN accent color when active (Calls green,
 *     History sky, Messages orange, Contacts purple) with a premium gradient
 *     squircle + glow, applied via inline styles (runtime-composed Tailwind
 *     class names are invisible to the JIT compiler and would ship as no-ops).
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SHELL = read("client/src/app/AppShell.tsx");
const ENGINE = read("client/src/app/RelayEngine.tsx");

describe("AppShell — docked in-flow bottom nav (no gap above, nothing hidden under)", () => {
  it("the mobile tab bar is in-flow (shrink-0 flex child), not position:fixed", () => {
    expect(SHELL).not.toMatch(/fixed bottom-2 inset-x-3/);
    expect(SHELL).toMatch(/relay-appshell-chrome md:hidden shrink-0/);
  });

  it("the scroll container carries NO clearance padding and is a flex column so pages fill it with flex-1 (height:100% does not resolve against flex-derived heights)", () => {
    expect(SHELL).not.toMatch(/pb-28/);
    expect(SHELL).toMatch(/className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col">\{children\}<\/div>/);
    // dvh (not svh): the shell tracks the REAL viewport as the browser bar
    // expands/collapses, so the tab bar is always flush with the true bottom.
    expect(SHELL).toMatch(/max-md:h-dvh/);
    expect(SHELL).not.toMatch(/max-md:h-svh/);
  });

  it("the DOCUMENT is locked while the shell is mounted — all scrolling is internal, so the app can never be shoved past its own end (v2.76 overscroll fix)", () => {
    expect(SHELL).toMatch(/documentElement\.classList\.add\("relay-app-lock"\)/);
    expect(SHELL).toMatch(/body\.classList\.add\("relay-app-lock"\)/);
    const CSS = read("client/src/index.css");
    expect(CSS).toMatch(/html\.relay-app-lock,\s*\nbody\.relay-app-lock \{\s*\n\s*height: 100%;\s*\n\s*overflow: hidden;\s*\n\s*overscroll-behavior: none;/);
  });

  it("the bar is docked full-width at the very bottom: border-t (not a floating rounded pill)", () => {
    expect(SHELL).toMatch(/border-t border-white\/10/);
  });

  it("keeps the home-indicator safe-area inset", () => {
    expect(SHELL).toMatch(/env\(safe-area-inset-bottom\)/);
  });

  it("stays hidden during calls (body.relay-call-active hides all appshell chrome)", () => {
    expect(ENGINE).toMatch(/body\.relay-call-active \.relay-appshell-chrome \{ display: none !important; \}/);
  });
});

describe("AppShell — per-tab active accent colors + premium icons", () => {
  it("every tab declares its own color + darker shade: Calls green, History sky, Messages orange, Contacts purple", () => {
    expect(SHELL).toMatch(/key: "dialer",[^\n]*color: "#22c55e", shade: "#15803d"/);
    expect(SHELL).toMatch(/key: "history",[^\n]*color: "#38bdf8", shade: "#0369a1"/);
    expect(SHELL).toMatch(/key: "messages",[^\n]*color: "#fb923c", shade: "#c2410c"/);
    expect(SHELL).toMatch(/key: "contacts",[^\n]*color: "#a78bfa", shade: "#7c3aed"/);
  });

  it("the active tab renders a gradient squircle with a matching glow (inline styles, not runtime Tailwind)", () => {
    expect(SHELL).toMatch(/linear-gradient\(135deg, \$\{tab\.color\} 0%, \$\{tab\.shade\} 100%\)/);
    expect(SHELL).toMatch(/boxShadow: `0 4px 14px \$\{tab\.color\}59/);
  });

  it("the active label is tinted in the tab's hue (darker shade on the light theme for contrast)", () => {
    expect(SHELL).toMatch(/theme === "light" \? tab\.shade : tab\.color/);
  });

  it("uses the refreshed icon set (History / MessageCircle / UsersRound, not Clock / MessageSquare / UserRound)", () => {
    expect(SHELL).toMatch(/icon: History/);
    expect(SHELL).toMatch(/icon: MessageCircle/);
    expect(SHELL).toMatch(/icon: UsersRound/);
    expect(SHELL).not.toMatch(/icon: Clock/);
    expect(SHELL).not.toMatch(/icon: MessageSquare\b/);
    expect(SHELL).not.toMatch(/icon: UserRound\b/);
  });

  it("the desktop sidebar mirrors the per-tab accent (tinted active row, not the global sidebar-accent)", () => {
    const tinted = SHELL.match(/theme === "light" \? tab\.shade : tab\.color/g) || [];
    expect(tinted.length).toBeGreaterThanOrEqual(2); // sidebar row + mobile label
    expect(SHELL).toMatch(/color-mix\(in oklab, \$\{tab\.color\} 16%, transparent\)/);
    expect(SHELL).not.toMatch(/bg-sidebar-accent text-sidebar-accent-foreground/);
  });

  it("unread/missed badges survived the redesign", () => {
    expect(SHELL).toMatch(/tab\.key === "messages" && unreadTotal > 0/);
    expect(SHELL).toMatch(/tab\.key === "history" && missedCount > 0/);
  });
});
