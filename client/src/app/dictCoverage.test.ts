import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * EVERY DICTIONARY KEY HAS A READER (v2.106.91).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────
 * v2.106.86 retired `--relay-zoom` because a published value nothing consumes still
 * READS as a contract: the next person needing that thing reaches for it and
 * reintroduces whatever bug it caused. A translation key is the same shape, and worse in
 * one way — an unread key looks like coverage. Somebody counting keys would conclude a
 * screen is translated when nothing on it is.
 *
 * ── AND IT FOUND A REAL DEFECT ON ITS FIRST RUN, WHICH IS WHY IT IS A GUARD ───────────
 * `msg.groupConversation` went to zero readers in v2.106.89: the thread row's group disc
 * carried `aria-label="Group conversation"`, and swapping in the shared `GroupAvatar`
 * dropped it silently — a screen reader lost the only thing distinguishing a group row
 * from a person's. Nothing else would have caught that, because no test asserts the
 * absence of an attribute nobody thought about.
 *
 * ── THE EXEMPTIONS ARE NAMED, NOT A THRESHOLD ────────────────────────────────────────
 * A count-based tolerance ("fewer than N dead keys") is how a real one hides among the
 * accepted ones. Each entry below states WHY that key has no reader; an exemption that
 * stops being true fails the second half of this test, so the list cannot rot.
 */
const ROOT = path.resolve(__dirname, "../../..");
const DICT_DIR = path.join(ROOT, "client/src/app/dict");

/**
 * Keys that legitimately have no reader today. NOT a budget — each is a decision.
 *
 * These are the generic vocabulary `core.ts` publishes for surfaces still to be swept
 * (`GroupInfoSheet`, `Admin`). They are kept rather than deleted because they are the
 * SHARED words — a second contributor inventing `common.retry` again is how two spellings
 * of one button arrive — and because deleting and re-adding them churns the Arabic.
 */
const UNREAD_BY_DESIGN: Record<string, string> = {
  "common.delete": "shared vocabulary, for the group/admin sweep still to come",
  "common.retry": "shared vocabulary, for the group/admin sweep still to come",
  "common.search": "shared vocabulary, for the group/admin sweep still to come",
  "common.signOut": "shared vocabulary, for the group/admin sweep still to come",
  "appearance.title": "the pane's heading comes from Profile's own PANE_TITLE map",
  "appearance.sample": "the preview line is not rendered yet",
  "contacts.nOnline": "superseded by the section header's own count expression",
  "dialer.from": "superseded when the dial readout dropped the viewer's own number",
  "dialer.myNumber": "superseded when the dial readout dropped the viewer's own number",
  "msg.clearAction": "superseded by the swipe tray's own labels",
  "nav.profile": "the avatar menu names the person, not the word Profile",
};

function definedKeys(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of fs.readdirSync(DICT_DIR)) {
    if (!f.endsWith(".ts") || f === "index.ts" || f === "types.ts") continue;
    const src = fs.readFileSync(path.join(DICT_DIR, f), "utf8");
    for (const m of src.matchAll(/^\s*"([a-zA-Z]+\.[a-zA-Z0-9]+)":/gm)) out.set(m[1], f);
  }
  return out;
}

function appSources(): string {
  let all = "";
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "dict") continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        all += fs.readFileSync(p, "utf8");
      }
    }
  };
  walk(path.join(ROOT, "client/src"));
  return all;
}

describe("the dictionary has no dead keys", () => {
  const keys = definedKeys();
  const src = appSources();

  it("is reading a real dictionary (guards against a vacuous pass)", () => {
    expect(keys.size).toBeGreaterThan(300);
    expect(src.length).toBeGreaterThan(500_000);
  });

  it("every key is read by something, or is exempt WITH a stated reason", () => {
    const dead = [...keys.keys()].filter((k) => !src.includes(k));
    const unexplained = dead.filter((k) => !(k in UNREAD_BY_DESIGN));
    expect(
      unexplained,
      `these keys have no reader and no recorded reason — either wire them or say why:\n` +
        unexplained.map((k) => `  ${k}  (${keys.get(k)})`).join("\n"),
    ).toEqual([]);
  });

  it("no exemption is STALE — a key that gained a reader must leave the list", () => {
    /* Without this the list only ever grows, and an exemption left behind after the key
       was wired is a hole the next dead key hides in (the v2.106.31 pattern). */
    const stale = Object.keys(UNREAD_BY_DESIGN).filter((k) => src.includes(k));
    expect(stale, `these are wired now — drop them from UNREAD_BY_DESIGN:\n${stale.join("\n")}`).toEqual([]);
  });

  it("no exemption names a key that no longer exists", () => {
    const gone = Object.keys(UNREAD_BY_DESIGN).filter((k) => !keys.has(k));
    expect(gone, `these keys were deleted — drop them from UNREAD_BY_DESIGN:\n${gone.join("\n")}`).toEqual([]);
  });

  it("each language is labelled in ITS OWN language, as a literal", () => {
    /* The reason there is deliberately no `appearance.arabic` / `appearance.english`:
       "Arabic" written in English is exactly the label that fails the person it is for —
       somebody who has landed in a language they cannot read and needs a way out. */
    expect(keys.has("appearance.arabic")).toBe(false);
    expect(keys.has("appearance.english")).toBe(false);
    const profile = fs.readFileSync(path.join(ROOT, "client/src/pages/app/Profile.tsx"), "utf8");
    expect(profile).toMatch(/العربية/);
    expect(profile).toMatch(/lang="ar"/);
  });
});
