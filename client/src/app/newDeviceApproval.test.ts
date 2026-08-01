import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { copyOnScreen, whyCopyMissing } from "../../../server/testing/copyOnScreen";

/**
 * v2.99.7 — new-device login approval, CLIENT wiring (source pins; jsdom isn't
 * configured here, matching the repo convention for component wiring).
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("AuthPanel waiting stage", () => {
  const src = read("client/src/app/AuthPanel.tsx");
  it("adds a 'waiting' stage and parks there when verifyOtp returns pending", () => {
    expect(src).toMatch(/type Stage =[^;]*"waiting"/);
    expect(src).toMatch(/\(res as \{ pending\?: boolean \}\)\?\.pending/);
    expect(src).toMatch(/setStage\("waiting"\)/);
  });
  it("does NOT invalidate whoami while pending (a pending cookie doesn't authenticate)", () => {
    // The pending branch returns BEFORE the whoami.invalidate()/onVerified() call.
    const fn = src.slice(src.indexOf("async function verifyCode"), src.indexOf("async function resend"));
    const pendingIdx = fn.indexOf('setStage("waiting")');
    const invalidateIdx = fn.indexOf("utils.identity.whoami.invalidate()");
    expect(pendingIdx).toBeGreaterThan(-1);
    expect(invalidateIdx).toBeGreaterThan(pendingIdx); // invalidate is only on the non-pending path below
  });
  it("polls sessionApprovalStatus while waiting and proceeds on approval / resets on denial", () => {
    expect(src).toMatch(/trpc\.otpAuth\.sessionApprovalStatus\.useQuery/);
    expect(src).toMatch(/enabled: stage === "waiting"/);
    expect(src).toMatch(/if \(s === "approved"\)/);
    expect(src).toMatch(/if \(s === "denied"\)/);
  });
});

describe("useRealtime device_pending handler", () => {
  const src = read("client/src/app/useRealtime.ts");
  it("mirrors the device_pending event and refreshes the pending-sessions list + toasts", () => {
    expect(src).toMatch(/kind: "device_pending"; sid: string; label: string/);
    expect(src).toMatch(/case "device_pending":/);
    expect(src).toMatch(/utils\.otpAuth\.pendingSessions\.invalidate\(\)/);
  });
});

describe("notification center + Profile devices approval UI", () => {
  it("the bell counts pending devices and offers a Review row → Profile devices", () => {
    const bell = read("client/src/app/MissedCalls.tsx");
    expect(bell).toMatch(/pendingDevices/);
    expect(bell).toMatch(/const total = missedCount \+ unreadCount \+ pendingDevices/);
    /* REPOINTED THROUGH `copyOnScreen` (#159): `/new device.*waiting/` matched the
       English literal, which the Arabic sweep moved into `dict/alerts.ts`. The
       property is that the row SAYS how many sign-ins are waiting — asserted for
       both halves of the count, since Arabic forces a one/many split the English
       `device{s}` suffix used to fake, and a pin on only one of them would let the
       other silently go missing. */
    for (const line of ["new device waiting", "new devices waiting"]) {
      expect(copyOnScreen(bell, line), whyCopyMissing(bell, line)).toBe(true);
    }
    const shell = read("client/src/app/AppShell.tsx");
    expect(shell).toMatch(/trpc\.otpAuth\.pendingSessions\.useQuery/);
    expect(shell).toMatch(/onOpenDevices=\{\(\) => navigate\("\/app\/profile#devices"\)\}/);
  });
  it("Profile Devices renders Approve/Decline for each pending sign-in", () => {
    const prof = read("client/src/pages/app/Profile.tsx");
    expect(prof).toMatch(/trpc\.otpAuth\.pendingSessions\.useQuery/);
    expect(prof).toMatch(/trpc\.otpAuth\.approveSession\.useMutation/);
    expect(prof).toMatch(/id="devices"/);
    expect(prof).toMatch(/New sign-in waiting/);
  });
});
