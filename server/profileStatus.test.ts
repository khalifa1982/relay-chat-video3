/**
 * v2.101.1 — the real profile status: work / vacation / travel / free / busy.
 *
 * Owner: *"you are in work, vacation, travel, free, and you can put some notes on
 * it… and it's like four items, travel, vacation, work, three, or busy. and everyone
 * has emoji and color."*
 *
 * THE CONSTRAINT THAT SHAPED THIS, and the reason it is a second column rather than a
 * wider `statusOverride`: that column feeds `effectiveStatus` → `presenceDot`, whose
 * colour vocabulary is four values wide on purpose. Five labels crammed in would have
 * meant teaching the LED five new hues, and CLAUDE.md is explicit that a third meaning
 * for a colour makes colour stop carrying information (v2.99.92). So the label is
 * stored and the availability is DERIVED — one writer, and nothing to keep in sync.
 *
 * Tested behaviourally, because a source pin cannot tell you whether picking
 * "vacation" leaves somebody's dot reading as travelling.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  MAX_STATUS_NOTE,
  PROFILE_STATUSES,
  PROFILE_STATUS_META,
  describeProfileStatus,
  normalizeProfileStatus,
  normalizeStatusNote,
  overrideForStatus,
  profileStatusMeta,
} from "../shared/profileStatus";
import { effectiveStatus, sanitizeStatusOverride } from "../shared/profileFields";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const V2DB = read("server/v2db.ts");
const ROUTERS = read("server/v2routers.ts");
const SCHEMA = read("drizzle/schema.ts");
const SECTIONS = read("client/src/pages/app/ProfileHubSections.tsx");
const OVERLAYS = read("client/src/app/PeerOverlays.tsx");

const codeOnly = (s: string) =>
  s
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");

describe("the five the owner named", () => {
  it("is exactly those five, in that order", () => {
    expect([...PROFILE_STATUSES]).toEqual(["work", "vacation", "travel", "free", "busy"]);
  });

  it("every one has a label, an emoji, a colour and a hint", () => {
    expect(PROFILE_STATUS_META).toHaveLength(PROFILE_STATUSES.length);
    for (const m of PROFILE_STATUS_META) {
      expect(m.label.length, m.key).toBeGreaterThan(2);
      expect(m.emoji.length, m.key).toBeGreaterThan(0);
      expect(m.color, m.key).toMatch(/^#[0-9a-f]{6}$/i);
      expect(m.hint.length, m.key).toBeGreaterThan(10);
    }
  });

  it("no two share an emoji or a colour", () => {
    // The emoji is what actually names the status (the colour is reinforcement), so a
    // duplicate would make two statuses indistinguishable at a glance.
    expect(new Set(PROFILE_STATUS_META.map((m) => m.emoji)).size).toBe(5);
    expect(new Set(PROFILE_STATUS_META.map((m) => m.color)).size).toBe(5);
  });

  it("the metadata lookup and the normalizer agree on every input", () => {
    for (const k of PROFILE_STATUSES) expect(profileStatusMeta(k)?.key).toBe(k);
    // "WORK" is the one that matters: a case-FOLDING normalizer would accept it, so
    // "AWAY" alone never exercised the fold at all (found by the mutation run).
    // Refusing it is right — lowercase keys are the only thing we ever write, so an
    // uppercase value is data we did not produce.
    for (const bad of ["", "WORK", "Vacation", "AWAY", "holiday", null, 7, undefined]) {
      expect(normalizeProfileStatus(bad), String(bad)).toBeNull();
      expect(profileStatusMeta(bad), String(bad)).toBeNull();
    }
  });

  it("FAILS TO NULL, never to a default", () => {
    // This label is a claim the person makes about themselves, shown to everybody who
    // looks them up. "On vacation" when they picked nothing is worse than no label.
    expect(normalizeProfileStatus("vacatio")).toBeNull();
    expect(normalizeProfileStatus(" work ")).toBeNull(); // not a value we ever write
    expect(normalizeProfileStatus("")).toBeNull(); // an explicit clear
  });
});

describe("the availability is DERIVED, and the LED keeps its four colours", () => {
  it("vacation and travel both read as travelling", () => {
    expect(overrideForStatus("vacation")).toBe("travel");
    expect(overrideForStatus("travel")).toBe("travel");
  });

  it("busy reads as away", () => {
    expect(overrideForStatus("busy")).toBe("away");
  });

  it("WORK reads as auto — being at work is not being away", () => {
    // Somebody at work is usually AT their computer, so marking them away would make
    // the LED lie about the most reachable state on the list.
    expect(overrideForStatus("work")).toBe("");
    expect(overrideForStatus("free")).toBe("");
  });

  it("no status, or an unknown one, reads as auto", () => {
    expect(overrideForStatus(null)).toBe("");
    expect(overrideForStatus("holiday")).toBe("");
  });

  it("every derived value is one the EXISTING override already accepts", () => {
    // The whole point: `statusOverride` stays exactly three values wide, so
    // effectiveStatus and presenceDot need no new branch and the colour vocabulary is
    // untouched. If this ever fails, the LED has been handed a value it cannot render.
    for (const k of [...PROFILE_STATUSES, null, "nonsense"]) {
      const derived = overrideForStatus(k);
      expect(sanitizeStatusOverride(derived), `${k} → ${derived}`).toBe(derived);
    }
  });

  it("and it lands on a presence state every surface already knows", () => {
    // Behavioural, through the real effectiveStatus: a label must never produce a
    // fifth display state.
    const known = new Set(["online", "offline", "away", "travel"]);
    for (const k of PROFILE_STATUSES) {
      for (const online of [true, false]) {
        const eff = effectiveStatus(online, overrideForStatus(k), false);
        expect(known.has(eff), `${k}/${online} → ${eff}`).toBe(true);
      }
    }
  });

  it("a busy person reads away even while their app is open", () => {
    // The point of saying "busy": people know before they dial.
    expect(effectiveStatus(true, overrideForStatus("busy"), false)).toBe("away");
  });

  it("someone at work still reads online while active", () => {
    expect(effectiveStatus(true, overrideForStatus("work"), false)).toBe("online");
  });
});

describe("the note", () => {
  it("is bounded to the column", () => {
    expect(MAX_STATUS_NOTE).toBe(140);
    expect(normalizeStatusNote("x".repeat(500))?.length).toBe(140);
    expect(SCHEMA).toMatch(/statusNote: varchar\("statusNote", \{ length: 140 \}\)/);
  });

  it("collapses newlines, so every surface gets the same one-line string", () => {
    // The chip is one line everywhere; a stored newline would be swallowed on one
    // surface and break a layout on another.
    expect(normalizeStatusNote("back\nMonday")).toBe("back Monday");
    expect(normalizeStatusNote("  back   Monday  ")).toBe("back Monday");
  });

  it("empty becomes null rather than an empty string", () => {
    expect(normalizeStatusNote("   ")).toBeNull();
    expect(normalizeStatusNote("\n\n")).toBeNull();
    expect(normalizeStatusNote(42)).toBeNull();
  });
});

describe("one description, so no surface composes its own", () => {
  it("reads emoji · label · note", () => {
    expect(describeProfileStatus("vacation", "back Monday")).toBe("🏖️ On vacation · back Monday");
  });

  it("omits the separator when there is no note", () => {
    expect(describeProfileStatus("busy")).toBe("⛔ Busy");
    expect(describeProfileStatus("busy", "   ")).toBe("⛔ Busy");
  });

  it("is null without a status, even when a note exists", () => {
    // A note on its own is a caption for nothing.
    expect(describeProfileStatus(null, "back Monday")).toBeNull();
  });
});

describe("stored once, derived once", () => {
  it("the columns are declared in the schema AND the additive migrator", () => {
    expect(SCHEMA).toMatch(/profileStatus: varchar\("profileStatus", \{ length: 16 \}\)/);
    expect(V2DB).toMatch(/table: "identities", column: "profileStatus"/);
    expect(V2DB).toMatch(/table: "identities", column: "statusNote"/);
  });

  it("the derivation happens in EXACTLY ONE place", () => {
    // Two places computing an availability from a label is how the label and the dot
    // come to disagree — the divergence class this codebase keeps re-learning.
    const code = codeOnly(V2DB) + codeOnly(ROUTERS);
    expect((code.match(/overrideForStatus\(/g) || []).length).toBe(1);
    expect(V2DB).toMatch(/set\.statusOverride = overrideForStatus\(label\) \|\| null;/);
  });

  it("clearing the status clears the availability it implied", () => {
    // Otherwise somebody back from vacation still reads as travelling, with no label
    // left on screen to explain why.
    expect(overrideForStatus(null)).toBe("");
    const fn = V2DB.slice(V2DB.indexOf("if (patch.profileStatus !== undefined)"));
    const body = fn.slice(0, fn.indexOf("if (patch.statusNote"));
    expect(body).toMatch(/set\.profileStatus = label;/);
    // Unconditional: written even when `label` is null.
    expect(body).not.toMatch(/if \(label\)/);
  });

  it("the client never derives it — that is the server's single writer", () => {
    const client = codeOnly(SECTIONS) + codeOnly(OVERLAYS);
    expect(client).not.toMatch(/overrideForStatus/);
    expect(client).not.toMatch(/statusOverride:/);
  });
});

describe("what reaches the wire", () => {
  it("whoami carries the label, normalized on the way out", () => {
    // A hand-edited row must not be able to render a label no surface has an entry for.
    expect(ROUTERS).toMatch(/profileStatus: normalizeProfileStatus\(ctx\.identity\.profileStatus\)/);
    expect(ROUTERS).toMatch(/statusNote: normalizeStatusNote\(ctx\.identity\.statusNote\)/);
  });

  it("updateProfile accepts a CLOSED enum plus the empty clear", () => {
    const input = ROUTERS.slice(ROUTERS.indexOf('profileStatus: z.enum('), ROUTERS.indexOf("statusNote: z.string()"));
    expect(input).toMatch(/z\.enum\(\["", \.\.\.PROFILE_STATUSES\]\)/);
    expect(ROUTERS).toMatch(/statusNote: z\.string\(\)\.max\(MAX_STATUS_NOTE\)\.optional\(\)/);
  });

  it("directory.lookup WITHHOLDS it when presence is hidden", () => {
    // A guest inactive over a day has presence suppressed for privacy (v2.95), and
    // "On vacation · back Monday" leaks exactly what the suppression withholds — in
    // words, which is worse than a dot.
    expect(ROUTERS).toMatch(/profileStatus: hidden \? null : normalizeProfileStatus\(id\.profileStatus\)/);
    expect(ROUTERS).toMatch(/statusNote: hidden \? null : normalizeStatusNote\(id\.statusNote\)/);
  });

  it("a PARTY LINE never carries one — a line is not a person", () => {
    const line = ROUTERS.slice(ROUTERS.indexOf("const line = await getPartyLineByNumber"));
    expect(line.slice(0, 1400)).toMatch(/profileStatus: null as string \| null/);
  });
});

describe("the picker and the chip", () => {
  it("the picker renders all five from the shared metadata", () => {
    expect(SECTIONS).toMatch(/PROFILE_STATUS_META\.map/);
    // No hand-rolled label list survives — that is what the shared module is for.
    expect(codeOnly(SECTIONS)).not.toMatch(/STATUS_CHOICES/);
  });

  it("tapping the CURRENT status clears it", () => {
    // So the picker is its own "none" control, rather than needing a sixth button
    // whose only job is to undo the other five.
    expect(SECTIONS).toMatch(/profileStatus: k === current \|\| k === null \? "" : k/);
  });

  it("the note only appears alongside a status", () => {
    expect(SECTIONS).toMatch(/\{current && \(/);
  });

  it("a poll cannot erase a note being typed", () => {
    // The field follows the server when it changes underneath us, but not mid-edit.
    expect(SECTIONS).toMatch(/if \(!editingNote\) setNote\(me\.statusNote \?\? ""\)/);
    expect(SECTIONS).toMatch(/onFocus=\{\(\) => setEditingNote\(true\)\}/);
  });

  it("colour is applied INLINE, never as a runtime-composed Tailwind class", () => {
    // The JIT compiler cannot see a class name assembled at render time, so
    // `border-[${color}]` comes out unstyled — the trap recorded for the tab accents.
    expect(SECTIONS).toMatch(/style=\{on \? \{ borderColor: color/);
    expect(codeOnly(SECTIONS)).not.toMatch(/border-\[\$\{/);
    expect(codeOnly(OVERLAYS)).not.toMatch(/bg-\[\$\{meta\.color/);
  });

  it("the chip's LABEL is foreground text, so nothing depends on the hue", () => {
    // Colour reinforces an emoji that already names the status. That is why these
    // five hues need no AA measurement, unlike the --relay-*-text tokens.
    const chip = OVERLAYS.slice(OVERLAYS.indexOf("export function ProfileStatusChip"), OVERLAYS.indexOf("export function GuestExpiryNote"));
    expect(chip.length).toBeGreaterThan(400);
    expect(chip).toMatch(/font-semibold text-foreground/);
    expect(chip).toMatch(/borderColor: `\$\{meta\.color\}59`/);
    // The label is never painted in the status hue.
    expect(chip).not.toMatch(/color: meta\.color/);
  });

  it("the chip renders NOTHING without a status", () => {
    expect(OVERLAYS).toMatch(/const meta = profileStatusMeta\(status\);\s*\n\s*if \(!meta\) return null;/);
  });

  it("BOTH profile surfaces render it, from ONE component", () => {
    // Two copies is how the popup and the full profile come to describe one person
    // differently.
    expect((OVERLAYS.match(/<ProfileStatusChip /g) || []).length).toBe(2);
    expect((OVERLAYS.match(/export function ProfileStatusChip/g) || []).length).toBe(1);
  });

  it("the emoji is aria-hidden — the label already says it", () => {
    const chip = OVERLAYS.slice(OVERLAYS.indexOf("export function ProfileStatusChip"));
    expect(chip.slice(0, 1600)).toMatch(/<span aria-hidden="true">\{meta\.emoji\}<\/span>/);
  });
});
