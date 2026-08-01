import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Messaging + History search (v2.95, rewritten in v2.99.96).
 *
 * These pins used to freeze the IMPLEMENTATION — the exact
 * `peerDisplayName.toLowerCase().includes(q)` expression and the `searchTextOf`
 * joined-haystack helper — which is precisely what the owner's "the search doesn't
 * detect hundred percent" required us to replace. Frozen that way, they would have
 * asserted the defect. They now pin the PROPERTIES that must hold: both surfaces are
 * local filters over already-loaded data, both go through the ONE shared matcher, and
 * neither hand-rolls a substring test of its own.
 */
describe("Messages thread-list search", () => {
  const src = read("client/src/pages/app/Messages.tsx");
  it("filters locally through the shared matcher", () => {
    expect(src).toMatch(/const \[threadSearch, setThreadSearch\]/);
    expect(src).toMatch(/placeholder="Search conversations"/);
    expect(src).toMatch(/import \{ matchQuery \} from "@\/app\/searchMatch"/);
    expect(src).toMatch(/matchQuery\(threadSearch, \[/);
  });
  it("searches the group TITLE as well as the peer name and number", () => {
    // A group used to be findable only if the query happened to appear in the
    // composed peer name, so searching a group by its own title matched nothing.
    // v2.102.0 added the group's OWN 6-digit id as a fourth field, so this asserts the
    // three that were here plus that the call still goes through matchQuery — rather
    // than freezing an exact argument list that grows every time a group gains a field.
    /* 2026-08-01: the window was {0,120}, which one added field plus its reason
       overflowed. Bounded by the call's own closing bracket instead, so it cannot go
       stale again — and the FIELDS are what this asserts, below. */
    expect(src).toMatch(/matchQuery\(threadSearch, \[[\s\S]*?\n\s*\]\)/);
    for (const f of ["t.peerDisplayName", "t.peerNumber", "t.title", "t.groupNumber"]) {
      expect(src, f).toContain(f);
    }
  });
  it("no longer hand-rolls its own substring test", () => {
    expect(src).not.toMatch(/peerDisplayName \|\| ""\)\.toLowerCase\(\)\.includes\(q\)/);
    expect(src).not.toMatch(/qDigits/);
  });
  it("shows a no-matches state", () => {
    expect(src).toMatch(/threadCategories\.length === 0 \?/);
    expect(src).toMatch(/No conversations match/);
  });
});

describe("History search", () => {
  const src = read("client/src/pages/app/History.tsx");
  it("filters locally through the shared matcher", () => {
    expect(src).toMatch(/const \[historySearch, setHistorySearch\]/);
    expect(src).toMatch(/placeholder="Search calls by name or number"/);
    expect(src).toMatch(/import \{ matchQuery \} from "@\/app\/searchMatch"/);
    expect(src).toMatch(/matchQuery\(historySearch, searchFieldsOf\(it, savedNameOf\)\)/);
  });
  it("offers FIELDS, not one joined haystack", () => {
    // The old `searchTextOf` joined everything and then stripped non-digits from the
    // WHOLE string, so a digit run spanning two fields matched — a false positive.
    expect(src).toMatch(/function searchFieldsOf\(/);
    expect(src).not.toMatch(/function searchTextOf\(/);
    expect(src).not.toMatch(/hay\.replace\(\/\\D\/g, ""\)/);
  });
  it("search combines with the All/Dialed/Missed filter and has a no-match state", () => {
    expect(src).toMatch(/\}, \[items, filter, historySearch, savedNameOf\]\)/);
    expect(src).toMatch(/No calls match/);
  });
});
