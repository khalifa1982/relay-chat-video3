import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.99.10 — the tier badge moved OFF the header avatar corner (owner
 * screenshot: it overlapped the flag/photo) onto the dropdown that opens on
 * tap, and the 6-digit PIN now shows next to the name on every 1:1 surface
 * (owner: "where's the name, the PIN should show everywhere").
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("badge is off the header avatar corner (v2.99.10)", () => {
  const shell = read("client/src/app/AppShell.tsx");
  it("no captionless RoleBadge pinned to the avatar corner anymore", () => {
    expect(shell).not.toMatch(/absolute -left-1 -top-1[\s\S]{0,120}RoleBadge/);
    expect(shell).not.toMatch(/RoleBadge[^\n]*caption=\{false\}/);
  });
  /**
   * REWRITTEN TO THE PROPERTY in v2.105.19, because as written this pinned the
   * v2.99.10 PLACEMENT — name + badge + PIN inside the dropdown label — i.e.
   * exactly what the owner has now asked to remove from that header. Frozen
   * that way it forbade the change while saying nothing about the thing v2.99.10
   * was actually for, which is that the badge is not stuck on the avatar's
   * corner overlapping the photo.
   *
   * The corner rule is the assertion above and it still holds. What the badge
   * must additionally do is RENDER SOMEWHERE the signed-in user can see it, so
   * that is what is pinned here — and the top bar is where it now lives, two
   * elements left of the avatar (v2.99.94's three-zone strip). The menu header
   * is the build stamp; `appShellVersionLabel.test.ts` owns that.
   */
  it("the badge still renders for the signed-in user — in the top bar, not on the corner", () => {
    expect(shell).toMatch(/<IdentityStrip/);
    const bar = read("client/src/app/TopBar.tsx");
    expect(bar).toMatch(/<RoleBadge role=\{roleFromFlags\(role, verified\)\}/);
    // …and the strip is handed the flags it needs to compute the tier, or the
    // badge above would silently render nothing.
    const strip = shell.slice(shell.indexOf("<IdentityStrip"));
    expect(strip.slice(0, 400)).toMatch(/role=\{me\.role\}/);
    expect(strip.slice(0, 400)).toMatch(/verified=\{me\.verified\}/);
  });
});

describe("PIN shows on every 1:1 username surface (v2.99.10)", () => {
  it("Messages chat header shows the peer PIN", () => {
    const m = read("client/src/pages/app/Messages.tsx");
    expect(m).toMatch(/!isGroup && thread\?\.peerNumber && \/\^\\d\{6\}\$\/\.test\(thread\.peerNumber\)/);
  });
  it("Messages thread-list rows show the peer PIN on 1:1 threads", () => {
    const m = read("client/src/pages/app/Messages.tsx");
    // v2.99.37: the row derives a formatted `pin` (1:1 only) up front and renders
    // it on the second line, instead of inlining the guard in JSX.
    // v2.102.0: a GROUP has its own 6-digit id too, so the row derives `ownNumber`
    // — the number of whatever the row is ABOUT — rather than the peer's only.
    // Notes-to-self still shows none, because that is me.
    expect(m).toMatch(/const ownNumber = isGroup \? t\.groupNumber : isDm \? t\.peerNumber : null;/);
    expect(m).toMatch(/\$\{ownNumber\.slice\(0, 3\)\}-\$\{ownNumber\.slice\(3\)\}/);
  });
  it("Contacts rows already render name + badge + formatted PIN", () => {
    const c = read("client/src/pages/app/Contacts.tsx");
    expect(c).toMatch(/<RoleBadge role=\{roleFromFlags\(c\.role, c\.verified\)\}/);
    expect(c).toMatch(/c\.number\.slice\(0, 3\) \+ "-" \+ c\.number\.slice\(3\)/);
  });
});
