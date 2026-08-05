/**
 * Push keep-alive — the "a call can actually wake this device" guard (v2.107.49).
 *
 * Owner ("test — call me at 777777"): a call to a backgrounded phone only rings
 * if the server holds a push subscription to wake it, and the owner's own account
 * had none. The silent (re)subscribe used to live only inside <PushBanner>, which
 * returns null in the native shell and self-dismisses on the web — so it often
 * never ran. This pins that the keep-alive now runs app-wide AND that it stays
 * silent (it must never trigger a permission prompt on its own).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const HOOK = readFileSync("client/src/app/usePushKeepAlive.ts", "utf8");
const SHELL = readFileSync("client/src/app/AppShell.tsx", "utf8");

describe("push keep-alive — silent, and never prompts", () => {
  it("only ensures a subscription when permission is ALREADY granted (no prompt from here)", () => {
    expect(HOOK).toMatch(/getNotifPermission\(\) !== "granted"/);
    // It must call the idempotent ensurer, not the permission REQUEST.
    expect(HOOK).toContain("ensurePushSubscription");
    expect(HOOK).not.toMatch(/requestNotifPermission|Notification\.requestPermission/);
  });

  it("skips native shells (they ring over APNs/FCM, not Web Push)", () => {
    expect(HOOK).toMatch(/if \(isNativeShell\(\)\) return/);
  });

  it("skips when there is no PushManager at all", () => {
    expect(HOOK).toMatch(/if \(!pushSupported\(\)\) return/);
  });

  it("gates on a session so an anonymous visitor is never subscribed", () => {
    expect(HOOK).toMatch(/if \(!enabled\) return/);
  });
});

describe("push keep-alive — wired app-wide", () => {
  it("AppShell mounts the keep-alive for every signed-in session", () => {
    expect(SHELL).toContain("usePushKeepAlive");
    expect(SHELL).toMatch(/usePushKeepAlive\(Boolean\(me\)\)/);
  });
});
