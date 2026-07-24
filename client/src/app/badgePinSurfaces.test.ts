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
  it("the badge shows in the dropdown label (opened by tapping the avatar) beside the name", () => {
    const label = shell.slice(shell.indexOf('<DropdownMenuLabel className="min-w-0">'), shell.indexOf("<DropdownMenuSeparator"));
    expect(label).toMatch(/\{me\.displayName\}/);
    expect(label).toMatch(/<RoleBadge role=\{roleFromFlags\(me\.role, me\.verified\)\}/);
    expect(label).toMatch(/formatNumber\(me\.number\)/); // PIN under the name
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
    expect(m).toMatch(/isDm && t\.peerNumber && \/\^\\d\{6\}\$\/\.test\(t\.peerNumber\)/);
    expect(m).toMatch(/\$\{t\.peerNumber\.slice\(0, 3\)\}-\$\{t\.peerNumber\.slice\(3\)\}/);
  });
  it("Contacts rows already render name + badge + formatted PIN", () => {
    const c = read("client/src/pages/app/Contacts.tsx");
    expect(c).toMatch(/<RoleBadge role=\{roleFromFlags\(c\.role, c\.verified\)\}/);
    expect(c).toMatch(/c\.number\.slice\(0, 3\) \+ "-" \+ c\.number\.slice\(3\)/);
  });
});
