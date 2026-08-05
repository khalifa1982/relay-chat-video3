/**
 * v2.107.41 — ONE FACE FOR "LOADING" (see ListStates.tsx for the full essay).
 *
 * Eleven surfaces said it with a bare grey sentence; three admin consoles said
 * it with NOTHING (an empty list that read as "no data" until rows popped in).
 * All of them now speak through `ListLoading` — spinner beside the surface's
 * own translated sentence, announced once via `role="status"`. These pins hold
 * the contract, the coverage counts, and the one deliberate exemption.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf8");
const COMP = read("client/src/app/ListStates.tsx");

describe("the component's contract", () => {
  it("spinner + the caller's translated label, announced as a status", () => {
    expect(COMP).toMatch(/role="status"/);
    expect(COMP).toMatch(/<Loader2 className="size-3\.5 shrink-0 animate-spin" aria-hidden="true" \/>/);
    expect(COMP).toMatch(/<span>\{label\}<\/span>/);
  });
});

describe("coverage — every audited surface speaks through it", () => {
  const expected: Array<[string, number]> = [
    // 1 search + 3 consoles (the consoles previously rendered NOTHING while loading)
    ["client/src/pages/app/Admin.tsx", 4],
    ["client/src/pages/app/Dialer.tsx", 1],
    ["client/src/pages/app/GroupCallScreen.tsx", 2],
    // threads, in-conversation history, message search
    ["client/src/pages/app/Messages.tsx", 3],
    ["client/src/pages/app/History.tsx", 1],
    ["client/src/pages/app/Profile.tsx", 1],
  ];
  for (const [file, n] of expected) {
    it(`${file} → ${n}× ListLoading`, () => {
      const src = read(file);
      expect(src).toMatch(/import \{ ListLoading \} from "@\/app\/ListStates";/);
      expect(src.split("<ListLoading ").length - 1).toBe(n);
    });
  }

  it("the admin consoles gained a REAL loading branch (blank-card fix)", () => {
    const src = read("client/src/pages/app/Admin.tsx");
    // The old guard fused empty with not-loading; the branches are separate now.
    expect(src).not.toMatch(/length === 0 && !\w+\.isLoading/);
  });
});

describe("the deliberate exemption", () => {
  it("Contacts keeps its SKELETON — a shape-true ghost list beats any spinner", () => {
    const src = read("client/src/pages/app/Contacts.tsx");
    expect(src).toMatch(/contacts\.isLoading \? \(\s*<ul>\s*\{Array\.from\(\{ length: 5 \}\)/);
    expect(src).not.toMatch(/ListLoading/);
  });
});
