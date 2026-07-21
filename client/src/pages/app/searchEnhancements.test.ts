import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Messaging + History search (v2.95). Both are pure client-side filters over the
 * already-loaded lists (no new requests) — source-pinned since there's no DOM
 * test env.
 */
describe("Messages thread-list search", () => {
  const src = read("client/src/pages/app/Messages.tsx");
  it("has a search box that filters the thread list by name/number", () => {
    expect(src).toMatch(/const \[threadSearch, setThreadSearch\]/);
    expect(src).toMatch(/placeholder="Search conversations"/);
    // filter matches peer name OR (digits-only) number
    expect(src).toMatch(/peerDisplayName \|\| ""\)\.toLowerCase\(\)\.includes\(q\)/);
    expect(src).toMatch(/qDigits\.length > 0 && \(t\.peerNumber \|\| ""\)\.includes\(qDigits\)/);
  });
  it("shows a no-matches state", () => {
    expect(src).toMatch(/threadCategories\.length === 0 \?/);
    expect(src).toMatch(/No conversations match/);
  });
});

describe("History search", () => {
  const src = read("client/src/pages/app/History.tsx");
  it("has a search box + a searchTextOf matcher over name/number/PIN", () => {
    expect(src).toMatch(/const \[historySearch, setHistorySearch\]/);
    expect(src).toMatch(/placeholder="Search calls by name or number"/);
    expect(src).toMatch(/function searchTextOf\(it: Item\)/);
    // conferences are matched on every participant + the party-line title
    expect(src).toMatch(/c\.participants\.map\(\(p\) => `\$\{p\.name\} \$\{p\.number\}`\)/);
  });
  it("search combines with the All/Dialed/Missed filter and has a no-match state", () => {
    expect(src).toMatch(/\}, \[items, filter, historySearch\]\)/);
    expect(src).toMatch(/No calls match/);
  });
});
