/**
 * READ-RECEIPT & TYPING PRIVACY (QW-9, v2.107.61) — two reciprocal, WhatsApp-style
 * toggles. Turning read receipts OFF stops you sending your read ticks AND stops you
 * seeing others'; turning typing OFF stops you sending "typing…" AND stops you seeing
 * theirs. Both default ON via "off" flags, so the migration preserves current behaviour.
 *
 * The whole point is that the reciprocity is ENFORCED, not merely hidden in the UI, and
 * that it holds on BOTH paths — the real-time SSE and a full reload. So this pins each
 * enforcement seam: the stored off-flags + their on/off inversion, the migrator, the
 * three receipt gates (own-status cap, own-time blanking, read-event fan-out) plus the
 * DM-peer reload gate, both typing gates (source emit + viewer delivery), the settings
 * UI, the bilingual strings, and the version. House style: codeOnly()-stripped source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./testing/codeOnly";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const schema = codeOnly(read("../drizzle/schema.ts"));
const v2db = codeOnly(read("./v2db.ts"));
const routers = codeOnly(read("./v2routers.ts"));
const realtime = codeOnly(read("../client/src/app/useRealtime.ts"));
const profile = codeOnly(read("../client/src/pages/app/Profile.tsx"));
const profileDict = read("../client/src/app/dict/profile.ts");
const version = read("../shared/version.ts");

const hasBilingualKey = (src: string, key: string, prefix: string): boolean => {
  const at = src.indexOf(`"${key}":`);
  if (at < 0) return false;
  const rest = src.slice(at + key.length);
  const nextKey = rest.indexOf(`"${prefix}`, 3);
  const entry = nextKey > 0 ? rest.slice(0, nextKey) : rest.slice(0, 500);
  return /\ben:/.test(entry) && /\bar:/.test(entry);
};

/* ─────────────────── stored as "off" flags, read as "on" ─────────────────── */

describe("QW-9 — stored off, so the default stays ON", () => {
  it("adds readReceiptsOff and typingOff to identities", () => {
    expect(schema).toMatch(/readReceiptsOff: boolean\("readReceiptsOff"\)/);
    expect(schema).toMatch(/typingOff: boolean\("typingOff"\)/);
  });

  it("the boot migrator ADDs both, additive so existing identities keep receipts+typing", () => {
    expect(v2db).toMatch(
      /\{ table: "identities", column: "readReceiptsOff", ddl: "ADD COLUMN `readReceiptsOff` boolean" \}/,
    );
    expect(v2db).toMatch(
      /\{ table: "identities", column: "typingOff", ddl: "ADD COLUMN `typingOff` boolean" \}/,
    );
  });

  it("the resolved identity inverts the off-flags into on-terms (NULL reads as ON)", () => {
    expect(v2db).toMatch(/sendReadReceipts: row\.readReceiptsOff !== true/);
    expect(v2db).toMatch(/showTyping: row\.typingOff !== true/);
  });

  it("saving inverts on-terms back to the stored off-flag", () => {
    expect(v2db).toMatch(/set\.readReceiptsOff = patch\.sendReadReceipts !== true/);
    expect(v2db).toMatch(/set\.typingOff = patch\.showTyping !== true/);
  });
});

/* ─────────────────── read-receipt reciprocity is enforced ─────────────────── */

describe("QW-9 — read receipts, both directions and both paths", () => {
  it("my own bubbles' status caps at delivered when I OR (in a DM) my peer opted out", () => {
    expect(routers).toMatch(
      /\(!me\.sendReadReceipts \|\| peerReceiptsOff\) && r\.senderIdentityId === me\.id && r\.status === "read"\s*\?\s*"delivered"/,
    );
  });

  it("my own sent times are blanked under the same condition (info-panel half)", () => {
    // Both deliveredAt and readAt gate on the same reciprocity predicate.
    const hits = [
      ...routers.matchAll(
        /\(!me\.sendReadReceipts \|\| peerReceiptsOff\) && r\.senderIdentityId === me\.id \? null :/g,
      ),
    ];
    expect(hits.length).toBe(2);
  });

  it("the read-event fan-out is skipped when the reader has receipts off", () => {
    expect(routers).toMatch(/if \(wasMember && me\.sendReadReceipts\)/);
  });

  it("the DM-peer reload gate exists, is DM-only, and fails OPEN", () => {
    const at = v2db.indexOf("export async function dmPeerReceiptsOff");
    const fn = v2db.slice(at, at + 1500);
    // A group returns false (its tick is aggregate); a peer lookup drives the result.
    expect(fn).toMatch(/convo\.kind === "group"\) return false/);
    expect(fn).toMatch(/peer\?\.off === true/);
    // Fail-open: a blip must not silently strip receipts.
    expect(fn).toMatch(/return false; \/\/ fail OPEN/);
  });

  it("the list handler computes the peer gate once per page, not per message", () => {
    const at = routers.indexOf("const peerReceiptsOff = await dmPeerReceiptsOff");
    expect(at).toBeGreaterThan(0);
    // It sits BEFORE the rows.map serialization it feeds.
    expect(at).toBeLessThan(routers.indexOf("return rows.map((r) => {", at));
  });
});

/* ─────────────────── typing reciprocity is enforced ─────────────────── */

describe("QW-9 — typing, both directions", () => {
  it("a person with typing off emits no typing event at the source", () => {
    expect(routers).toMatch(/if \(!me\.showTyping\) return \{ ok: true \}/);
  });

  it("and never SEES others' typing on delivery (the reciprocal half)", () => {
    expect(realtime).toMatch(/whoami\.getData\(\)\?\.showTyping === false\) break/);
  });
});

/* ─────────────────── settings UI + wire ─────────────────── */

describe("QW-9 — the settings screen exposes both toggles", () => {
  it("whoami carries both flags in on-terms", () => {
    expect(routers).toMatch(/sendReadReceipts: ctx\.identity\.sendReadReceipts/);
    expect(routers).toMatch(/showTyping: ctx\.identity\.showTyping/);
  });

  it("updateProfile accepts both in on-terms", () => {
    expect(routers).toMatch(/sendReadReceipts: z\.boolean\(\)\.optional\(\)/);
    expect(routers).toMatch(/showTyping: z\.boolean\(\)\.optional\(\)/);
  });

  it("the profile screen renders the two reciprocal toggles optimistically", () => {
    expect(profile).toMatch(/function ReadReceiptTypingToggles/);
    expect(profile).toMatch(/save\.mutate\(\{ sendReadReceipts: !receipts \}\)/);
    expect(profile).toMatch(/save\.mutate\(\{ showTyping: !typing \}\)/);
    // Optimistic whoami flip with rollback.
    expect(profile).toMatch(/utils\.identity\.whoami\.setData/);
  });
});

/* ─────────────────── i18n + version ─────────────────── */

describe("QW-9 — strings are bilingual and it ships in 2.107.61", () => {
  it("the receipt/typing setting strings are in en and ar", () => {
    for (const k of [
      "profile.receiptsSectionLabel",
      "profile.readReceiptsTitle",
      "profile.readReceiptsDesc",
      "profile.typingTitle",
      "profile.typingDesc",
      "profile.receiptsFooter",
    ]) {
      expect(hasBilingualKey(profileDict, k, '"profile.'), k).toBe(true);
    }
  });

  /* REWRITTEN TO THE PROPERTY (v2.107.62), the THIRD file to carry this defect after
     `groupDescription` and `pinnedMessages`. Freezing the exact release string makes the
     pin go red on the NEXT release while saying nothing about the feature it is named
     for, so it has to be hand-bumped every time anything else ships — and a pin nobody
     trusts is a pin nobody reads. The version has exactly ONE owner
     (`client/src/app/updateChecker.test.ts`); what matters here is only that this feature
     shipped at or after the release that introduced it. */
  it("the app version is at or past the release that introduced it", () => {
    const m = /APP_VERSION = "(\d+)\.(\d+)\.(\d+)"/.exec(version);
    expect(m, "version.ts must declare a version").toBeTruthy();
    const got = [+m![1], +m![2], +m![3]];
    const min = [2, 107, 61];
    expect(got[0] * 1e6 + got[1] * 1e3 + got[2]).toBeGreaterThanOrEqual(
      min[0] * 1e6 + min[1] * 1e3 + min[2],
    );
  });
});
