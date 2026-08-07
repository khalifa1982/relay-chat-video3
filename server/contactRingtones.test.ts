/**
 * PER-CONTACT RINGTONES (QW-11, v2.107.64). A contact can be given one of several
 * synthesized ringtone variants; the call engine resolves the caller's variant at
 * ring time and plays it, and the settings picker previews it.
 *
 * The load-bearing guarantees pinned here:
 *  - the DEFAULT is unchanged — `getRingtone(null/unknown)` returns "classic", and
 *    classic single-sources the existing spec, so every un-set contact rings exactly
 *    as before (verified by exercising the pure resolver directly);
 *  - a stored/incoming ringtone id is validated against the known set server-side;
 *  - resolution is CLIENT-side at ring time (the signaling layer stays contact-free),
 *    threaded caller-number → engine resolver → playRingtone;
 *  - the engine swaps only the note DATA, leaving the delicate audio scheduling;
 *  - the picker sets + previews, and a change reaches the always-mounted engine.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./testing/codeOnly";
import { getRingtone, RINGTONES, RINGTONE_IDS, DEFAULT_RINGTONE_ID, RINGTONE_NOTES } from "../shared/ringtone";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const ringtoneSrc = codeOnly(read("../shared/ringtone.ts"));
const schema = codeOnly(read("../drizzle/schema.ts"));
const v2db = codeOnly(read("./v2db.ts"));
const routers = codeOnly(read("./v2routers.ts"));
const engine = codeOnly(read("../client/src/lib/relayClient.ts"));
const relayEngine = codeOnly(read("../client/src/app/RelayEngine.tsx"));
const contactsUi = codeOnly(read("../client/src/pages/app/Contacts.tsx"));
const preview = codeOnly(read("../client/src/lib/ringtonePreview.ts"));
const contactsDict = read("../client/src/app/dict/contacts.ts");
const version = read("../shared/version.ts");

const hasBilingualKey = (src: string, key: string, prefix: string): boolean => {
  const at = src.indexOf(`"${key}":`);
  if (at < 0) return false;
  const rest = src.slice(at + key.length);
  const nextKey = rest.indexOf(`"${prefix}`, 3);
  const entry = nextKey > 0 ? rest.slice(0, nextKey) : rest.slice(0, 400);
  return /\ben:/.test(entry) && /\bar:/.test(entry);
};

/* ─────────── the DEFAULT is untouched (behavioural, on the real resolver) ─────────── */

describe("QW-11 — an un-set contact rings exactly as before", () => {
  it("getRingtone falls back to classic for null / unknown / empty", () => {
    expect(getRingtone(null).id).toBe("classic");
    expect(getRingtone(undefined).id).toBe("classic");
    expect(getRingtone("").id).toBe("classic");
    expect(getRingtone("no-such-variant").id).toBe("classic");
  });

  it("classic single-sources the existing signature motif", () => {
    const classic = getRingtone("classic");
    // Same array reference the two players used before — one source of truth.
    expect(classic.notes).toBe(RINGTONE_NOTES);
    expect(RINGTONES[0].id).toBe("classic");
    expect(DEFAULT_RINGTONE_ID).toBe("classic");
  });

  it("every variant is a complete, playable spec", () => {
    for (const v of RINGTONES) {
      expect(v.notes.length, `${v.id} has notes`).toBeGreaterThan(0);
      expect(typeof v.wave).toBe("string");
      expect(v.loopMs).toBeGreaterThan(0);
      expect(v.peak).toBeGreaterThan(0);
      for (const n of v.notes) {
        expect(n.freq, `${v.id} note freq`).toBeGreaterThan(0);
        expect(n.dur, `${v.id} note dur`).toBeGreaterThan(0);
      }
    }
    // The five designed variants are all present.
    expect(RINGTONE_IDS.sort()).toEqual(["chime", "classic", "mellow", "pulse", "rising"]);
  });
});

/* ─────────── storage + validation ─────────── */

describe("QW-11 — stored on the contact and validated", () => {
  it("the contacts table carries a ringtone column, additive and nullable", () => {
    expect(schema).toMatch(/ringtone: text\("ringtone"\)/);
    // Boot-migrator ADD COLUMN so live DBs get it without a manual migration.
    expect(v2db).toMatch(/table: "contacts", column: "ringtone", ddl: "ADD COLUMN `ringtone` text"/);
  });

  it("the ringtone is an updatable, partial-safe contact column", () => {
    expect(v2db).toMatch(/"blocked", "callsToVoicemail", "ringtone"/);
    expect(v2db).toMatch(/ringtone: input\.ringtone \?\? null/);
  });

  it("the upsert input validates the id against the known set (no stale/unknown ids)", () => {
    expect(routers).toMatch(/const RINGTONE_IDS_TUPLE = RINGTONE_IDS as \[string, \.\.\.string\[\]\]/);
    expect(routers).toMatch(/ringtone: z\.enum\(RINGTONE_IDS_TUPLE\)\.nullable\(\)\.optional\(\)/);
  });
});

/* ─────────── lightweight resolution endpoint ─────────── */

describe("QW-11 — a lean endpoint feeds the always-mounted engine", () => {
  it("listContactRingtones returns only non-default assignments", () => {
    const at = v2db.indexOf("export async function listContactRingtones");
    const fn = v2db.slice(at, at + 700);
    expect(fn).toMatch(/isNotNull\(contacts\.ringtone\)/);
    expect(fn).toMatch(/number: contacts\.number, ringtone: contacts\.ringtone/);
  });

  it("the contacts router exposes it as its own query (not a field on the heavy list)", () => {
    expect(routers).toMatch(/ringtones: publicProcedure\.query/);
    expect(routers).toMatch(/return \{ ringtones: await listContactRingtones\(me\.id\) \}/);
  });

  it("the list row also carries the ringtone so the picker can tick the current one", () => {
    expect(routers).toMatch(/ringtone: r\.ringtone \?\? null/);
  });
});

/* ─────────── client-side resolution at ring time ─────────── */

describe("QW-11 — the engine resolves the caller's variant and swaps only the note data", () => {
  it("exposes a resolver setter mirroring the translator-injection pattern", () => {
    expect(engine).toMatch(/export function setContactRingtoneResolver\(r: ContactRingtoneResolver \| null\)/);
  });

  it("playRingtone takes the caller number, resolves the variant, and both ring sites pass it", () => {
    expect(engine).toMatch(/function playRingtone\(kind: "incoming" \| "outgoing", fromNumber\?: string \| null\)/);
    expect(engine).toMatch(/getRingtone\(fromNumber && contactRingtoneResolver \? contactRingtoneResolver\(fromNumber\) : null\)/);
    expect(engine).toMatch(/playRingtone\("incoming", m\.from\)/);
    expect(engine).toMatch(/playRingtone\("incoming", promotedRing\.from\)/);
  });

  it("the ring uses the variant's own motif / timbre / loop / level", () => {
    // Note DATA is variant-driven; the scheduling around it is unchanged.
    expect(engine).toMatch(/kind === "incoming" \? variant!\.notes :/);
    expect(engine).toMatch(/osc\.type = kind === "incoming" \? variant!\.wave :/);
    expect(engine).toMatch(/kind === "incoming" \? variant!\.loopMs : 2000/);
  });
});

/* ─────────── the React bridge registers + keeps it fresh ─────────── */

describe("QW-11 — RelayEngine registers the resolver and keeps the map warm", () => {
  it("holds a number→id map fed by the lightweight query and registers a resolver reading it", () => {
    expect(relayEngine).toMatch(/trpc\.contacts\.ringtones\.useQuery/);
    expect(relayEngine).toMatch(/ringtoneMapRef\.current = m/);
    expect(relayEngine).toMatch(/setContactRingtoneResolver\(\(from: string\) => ringtoneMapRef\.current\.get\(from\) \?\? null\)/);
    // …and clears it on teardown so a dead engine leaves no dangling resolver.
    expect(relayEngine).toMatch(/setContactRingtoneResolverRef\.current\?\.\(null\)/);
  });
});

/* ─────────── the picker sets, previews, and reaches the engine ─────────── */

describe("QW-11 — the contact picker", () => {
  it("offers a ringtone submenu that sets the choice and previews it", () => {
    expect(contactsUi).toMatch(/onSetRingtone\(row\.id\); previewRingtone\(row\.id \?\? DEFAULT_RINGTONE_ID\)/);
    expect(contactsUi).toMatch(/onSetRingtone=\{\(id\) =>\s*upsert\.mutate\(\{ number: c\.number, ringtone: id \}\)/);
  });

  it("a ringtone change invalidates the engine's ringtones query, not just the list", () => {
    expect(contactsUi).toMatch(/utils\.contacts\.ringtones\.invalidate\(\)/);
  });

  it("the preview is a self-contained one-shot player (gesture-safe, no engine coupling)", () => {
    expect(preview).toMatch(/export function previewRingtone/);
    // One pass only — it schedules notes once and never sets a loop interval.
    expect(preview).not.toMatch(/setInterval/);
    expect(preview).toMatch(/void closeAt\.close\(\)/); // tears its context down after the motif
  });
});

/* ─────────── i18n + version ─────────── */

describe("QW-11 — strings are bilingual and it shipped at or past its release", () => {
  it("the ringtone strings are in en and ar", () => {
    for (const k of [
      "contacts.ringtone",
      "contacts.ringtoneDefault",
      "contacts.ringtone_chime",
      "contacts.ringtone_pulse",
      "contacts.ringtone_rising",
      "contacts.ringtone_mellow",
    ]) {
      expect(hasBilingualKey(contactsDict, k, '"contacts.'), k).toBe(true);
    }
  });

  it("the app version is at or past the release that introduced it", () => {
    const m = /APP_VERSION = "(\d+)\.(\d+)\.(\d+)"/.exec(version);
    expect(m, "version.ts must declare a version").toBeTruthy();
    const got = [+m![1], +m![2], +m![3]];
    const min = [2, 107, 64];
    expect(got[0] * 1e6 + got[1] * 1e3 + got[2]).toBeGreaterThanOrEqual(min[0] * 1e6 + min[1] * 1e3 + min[2]);
  });
});
