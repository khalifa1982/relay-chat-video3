/**
 * v2.100.0 — deleting a person, the only irreversible path in this codebase.
 *
 * Two owner asks turn out to be one operation: a guest identity unused for 30 days
 * is deleted automatically, and an admin can *"delete him completely. Whoever he
 * took, whoever he had contact data, everything will delete."*
 *
 * THE LOAD-BEARING TEST IN THIS FILE IS THE COMPLETENESS SCAN, and it is not about
 * this release at all — it is about the next table somebody adds. There are ZERO
 * foreign keys in this schema, so nothing cascades and nothing detects an orphan:
 * a new `identityId` column that the purge does not know about produces no error,
 * the rows simply sit there naming a person who no longer exists. So the scan reads
 * `drizzle/schema.ts`, finds every identity-shaped column, and FAILS THE BUILD if
 * any of them has no declared disposition — the same contract
 * `numberContinuity.test.ts` has enforced for the 6-digit number since v2.99.54.
 * It is verified by planting a fake column and watching it fail BY NAME.
 *
 * The decisions with a real blast radius are tested BEHAVIOURALLY, because a source
 * pin cannot tell you whether a six-person group survives one lapsed guest.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./testing/codeOnly";
import {
  GUEST_PURGE_BATCH,
  GUEST_PURGE_DAYS,
  IDENTITY_REFERENCING_COLUMNS,
  guestDaysLeft,
  guestPurgeMode,
  planConversationPurge,
  redactRoster,
} from "./purgeIdentity";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const PURGE = read("server/purgeIdentity.ts");
const SCHEMA = read("drizzle/schema.ts");
const ROUTERS = read("server/v2routers.ts");
const V2DB = read("server/v2db.ts");
const BOOT = read("server/_core/index.ts");
const ADMIN_PAGE = read("client/src/pages/app/Admin.tsx");
const OVERLAYS = read("client/src/app/PeerOverlays.tsx");


/**
 * Every (table, column) pair declared in `drizzle/schema.ts`.
 *
 * Parsed from the file rather than imported, so the scan sees what a human editing
 * the schema sees. A chunk runs from one `mysqlTable(` to the next; the table's
 * real name is the first quoted string in it (NOT the exported const, which
 * differs — `conversationParticipants` vs `conversation_participants`).
 */
function schemaColumns(): Array<{ table: string; column: string }> {
  const out: Array<{ table: string; column: string }> = [];
  const chunks = SCHEMA.split(/mysqlTable\(/).slice(1);
  for (const chunk of chunks) {
    const name = /^\s*"([^"]+)"/.exec(chunk)?.[1];
    if (!name) continue;
    const body = chunk.slice(0, chunk.length);
    for (const m of body.matchAll(/^ {4}(\w+):\s*(?:int|varchar|text|timestamp|boolean|json|mysqlEnum)\(/gm)) {
      out.push({ table: name, column: m[1] });
    }
  }
  return out;
}

/** Column names that name an identity or the account behind one. A column with
 *  one of these names is a reference the purge MUST have an answer for.
 *
 *  WIDENED in v2.104.0 for `deletedByIdentityId`, and the reason is worth recording:
 *  an adversarial review pointed out that this alternation is ANCHORED and hand-kept,
 *  so a new identity-naming column whose name it does not happen to list escapes the
 *  machine check entirely — the build would NOT fail by name, which is the one thing
 *  this guard exists to guarantee. The pattern is the weak link in an otherwise
 *  machine-checked contract, so any new `*IdentityId` column has to be added here in
 *  the same commit that adds the column. The `*IdentityId$` suffix would be a stronger
 *  rule than an enumeration, but it is deliberately NOT used: a typo'd or renamed
 *  column would then be silently covered by the pattern while its registry entry went
 *  stale, and the reverse-direction test below exists precisely to catch that. */
const REFERENCE_SHAPE =
  /^(identityId|ownerId|ownerIdentityId|senderIdentityId|deletedByIdentityId|uploadedByIdentityId|callerIdentityId|calleeIdentityId|viewerId|watcherId|targetId|fromIdentityId|toIdentityId|userId)$/;

describe("the cascade is COMPLETE — machine-checked against the schema", () => {
  it("the scan actually finds the schema (it cannot pass by reading nothing)", () => {
    const cols = schemaColumns();
    expect(cols.length).toBeGreaterThan(80);
    // Spot-check three shapes the parser has to get right: a plain int, a column
    // in a table whose export name differs from its SQL name, and a JSON column.
    expect(cols).toEqual(expect.arrayContaining([{ table: "presence", column: "identityId" }]));
    expect(cols).toEqual(
      expect.arrayContaining([{ table: "conversation_participants", column: "identityId" }])
    );
    expect(cols).toEqual(
      expect.arrayContaining([{ table: "conference_history", column: "participants" }])
    );
  });

  it("EVERY identity-referencing column in the schema has a declared disposition", () => {
    // THE GUARD. A new table with an `identityId` and no entry here is a set of
    // rows naming a deleted person, forever, with nothing to notice.
    const declared = new Set(
      IDENTITY_REFERENCING_COLUMNS.map((c) => `${c.table}.${c.column}`)
    );
    const missing = schemaColumns()
      .filter((c) => REFERENCE_SHAPE.test(c.column))
      .map((c) => `${c.table}.${c.column}`)
      .filter((k) => !declared.has(k));
    expect(
      missing,
      `these identity-referencing columns have no entry in IDENTITY_REFERENCING_COLUMNS: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("and the scan really would catch a new one (verified by planting a column)", () => {
    // Proves the assertion above can FAIL. Without this, an over-narrow regex or a
    // broken parser would make the guard silently vacuous — which is worse than no
    // guard, because it reports safety.
    const planted = [...schemaColumns(), { table: "brand_new_table", column: "identityId" }];
    const declared = new Set(IDENTITY_REFERENCING_COLUMNS.map((c) => `${c.table}.${c.column}`));
    const missing = planted
      .filter((c) => REFERENCE_SHAPE.test(c.column))
      .map((c) => `${c.table}.${c.column}`)
      .filter((k) => !declared.has(k));
    expect(missing).toEqual(["brand_new_table.identityId"]);
  });

  it("every DECLARED column still exists in the schema (a rename cannot go unnoticed)", () => {
    // The other direction. A renamed column would leave a stale entry that reads as
    // covered while the real column escapes — the same way a `numberContinuity`
    // entry pointing at nothing would.
    const real = new Set(schemaColumns().map((c) => `${c.table}.${c.column}`));
    const stale = IDENTITY_REFERENCING_COLUMNS.map((c) => `${c.table}.${c.column}`).filter(
      (k) => !real.has(k) && !k.endsWith(".id") // .id is autoincrement().primaryKey(), a shape the parser skips
    );
    expect(stale, `stale entries: ${stale.join(", ")}`).toEqual([]);
  });

  it("the three things that must NOT be deleted are declared keep-safer, with their finding", () => {
    const by = (t: string, c: string) =>
      IDENTITY_REFERENCING_COLUMNS.find((x) => x.table === t && x.column === c);
    // Deleting an attachments row makes the media MORE readable, because
    // authorizeStorageKey cannot classify a key with no row and the proxy serves it
    // (v2.98.4/F3). The row is the lock.
    expect(by("attachments", "uploadedByIdentityId")?.strategy).toBe("keep-safer");
    // Deleting a third party's contact row silently UNBLOCKS a blocked person,
    // because `blocked` lives on that row (v2.99.28/M13).
    expect(by("contacts", "number")?.strategy).toBe("keep-safer");
    // …while their OWN address book does go.
    expect(by("contacts", "ownerId")?.strategy).toBe("cascade");
  });

  it("and the code obeys those two decisions", () => {
    const code = codeOnly(PURGE);
    // Never deletes an attachments row, by any spelling.
    expect(code).not.toMatch(/delete\(attachments\)/);
    expect(code).not.toMatch(/DELETE FROM `?attachments/i);
    // Deletes contacts by OWNER only — never by number, which is somebody else's row.
    expect(code).toMatch(/delete\(contacts\)\.where\(eq\(contacts\.ownerId, identityId\)\)/);
    expect(code).not.toMatch(/delete\(contacts\)[\s\S]{0,80}contacts\.number/);
  });
});

describe("the 6-digit number is retired, never reissued", () => {
  it("the tombstone stamps claimedAt, which is exactly the reservation reaper's guard", () => {
    // `reapUnclaimedReservations` deletes any row whose number is absent from both
    // number tables — precisely the state a purge creates — and its guard is
    // `claimedAt IS NULL`. Without this stamp, purging a guest would put their
    // number back into circulation for a stranger.
    expect(V2DB).toMatch(/DELETE FROM \\`number_reservations\\`[\s\S]{0,120}\\`claimedAt\\` IS NULL/);
    expect(PURGE).toMatch(/INSERT INTO \\`number_reservations\\`/);
    expect(PURGE).toMatch(/ON DUPLICATE KEY UPDATE \\`claimedAt\\` = COALESCE\(\\`claimedAt\\`, NOW\(\)\)/);
  });

  it("COALESCE, not an overwrite — a real claim time is never lost", () => {
    expect(PURGE).toMatch(/COALESCE\(\\`claimedAt\\`, NOW\(\)\)/);
  });

  it("nothing in the purge ever DELETES from the ledger, or RELEASES a reservation", () => {
    // The ledger is monotonic on purpose: a number somebody wrote down must never
    // later connect them to a stranger.
    const code = codeOnly(PURGE);
    expect(code).not.toMatch(/DELETE FROM \\`number_reservations/i);
    expect(code).not.toMatch(/releaseUnusedNumberReservation/);
  });

  it("the tombstone happens BEFORE anything is destroyed, at both call sites", () => {
    // Order, not mere presence (the v2.99.75 lesson). If the cascade ran first and
    // then failed, the number would be free with the identity already gone.
    for (const site of ["adminPurgeIdentity", "reapExpiredGuests"]) {
      const start = PURGE.indexOf(`export async function ${site}`);
      expect(start, site).toBeGreaterThan(0);
      const body = PURGE.slice(start, PURGE.indexOf("\n}", start));
      const tomb = body.indexOf("tombstoneNumber(");
      const casc = body.indexOf("cascade(");
      expect(tomb, `${site} must tombstone`).toBeGreaterThan(0);
      expect(casc, `${site} must cascade`).toBeGreaterThan(0);
      expect(tomb, `${site}: tombstone must precede the cascade`).toBeLessThan(casc);
    }
  });
});

describe("the claim — one statement that both decides and disarms", () => {
  const claimBody = () => {
    const start = PURGE.indexOf("export async function claimIdentityForPurge");
    return PURGE.slice(start, PURGE.indexOf("\n/**", start));
  };

  it("the GUEST predicate carries every conjunct, so a registered identity cannot be selected", () => {
    const g = claimBody();
    // Split at the ternary's colon so the guest branch is read on its own — the
    // admin branch deliberately has none of these.
    const guestBranch = g.slice(g.indexOf('guard === "guest-expired"'), g.indexOf("      : sql`UPDATE"));
    expect(guestBranch.length).toBeGreaterThan(200);
    expect(guestBranch).toMatch(/\\`userId\\` IS NULL/);
    expect(guestBranch).toMatch(/\\`verified\\` IS NULL OR \\`verified\\` = 0/);
    expect(guestBranch).toMatch(/\\`guestExpiresAt\\` IS NOT NULL/);
    expect(guestBranch).toMatch(/\\`guestExpiresAt\\` < NOW\(\)/);
    expect(guestBranch).toMatch(/\\`purgeStartedAt\\` IS NULL/);
  });

  it("the ADMIN predicate is only the claim itself — it may delete a registered account", () => {
    const g = claimBody();
    const adminBranch = g.slice(g.indexOf("      : sql`UPDATE"), g.indexOf("const res"));
    expect(adminBranch.length).toBeGreaterThan(100);
    expect(adminBranch).toMatch(/\\`purgeStartedAt\\` IS NULL/);
    // It must NOT inherit the guest conjuncts, or an admin could never delete a
    // registered user — which is the whole of the owner's ask.
    expect(adminBranch).not.toMatch(/\\`userId\\` IS NULL/);
    expect(adminBranch).not.toMatch(/guestExpiresAt/);
  });

  it("the predicate is written INSIDE the claim, never accepted from a caller", () => {
    // One boolean serving two questions is the mistake CLAUDE.md records for
    // `isOnline`. A caller that could supply its own WHERE could delete a
    // registered account by accident.
    expect(PURGE).toMatch(/guard: PurgeGuard/);
    const code = codeOnly(PURGE);
    expect(code).not.toMatch(/where\??:\s*(SQL|string)/);
    expect(code).not.toMatch(/predicate\s*[:)]/);
  });

  it("the claim NULLs all three handles that could resurrect the row", () => {
    // From the instant it commits, no guest cookie, no device id and no
    // Adopt-and-Retire recovery key can land a live request on a row being
    // destroyed — without holding a write lock for the whole cascade.
    const g = claimBody();
    expect((g.match(/\\`guestToken\\` = NULL/g) || []).length).toBe(2);
    expect((g.match(/\\`deviceId\\` = NULL/g) || []).length).toBe(2);
    expect((g.match(/\\`recoveryHash\\` = NULL/g) || []).length).toBe(2);
  });

  it("the verdict comes from affectedRows, so two instances cannot both claim one row", () => {
    expect(PURGE).toMatch(/affectedRows/);
    expect(PURGE).toMatch(/if \(affected !== 1\) return \{ ok: false \}/);
  });

  it("EVERY guest resolver is closed by the nulled handles — enumerated, not assumed", () => {
    // v2.99.49 was real data loss caused by these resolvers disagreeing about which
    // identity a browser is using, so a claimed row reaching one of them would
    // reintroduce that class — a live request landing on a row mid-destruction.
    //
    // This is defended STRUCTURALLY rather than by adding a `purgeStartedAt IS NULL`
    // conjunct to each: every one of them looks a guest up BY one of the three
    // handles the claim NULLs, so nulling them closes all of them at once and no
    // fourth resolver can be forgotten. The alternative — editing four hot auth
    // paths — is precisely where v2.99.49's bug lived.
    const resolvers = Array.from(
      V2DB.matchAll(/export async function (getIdentityBy\w+|findRecoverableGuestIdentity)\(/g)
    ).map((m) => m[1]);
    // Guest-resolving sites only: by-id and by-number resolve anybody, and a purge
    // in flight legitimately still has a row for a few seconds.
    const guestSites = resolvers.filter((n) => /GuestToken|DeviceId|Recoverable/.test(n));
    expect(guestSites.sort()).toEqual([
      "findRecoverableGuestIdentity",
      "getIdentityByDeviceId",
      "getIdentityByGuestToken",
    ]);
    // Each really does key on a handle the claim destroys.
    const bodyOf = (name: string) => {
      const at = V2DB.indexOf(`export async function ${name}(`);
      return V2DB.slice(at, V2DB.indexOf("\n}", at));
    };
    expect(bodyOf("getIdentityByGuestToken")).toMatch(/identities\.guestToken/);
    expect(bodyOf("getIdentityByDeviceId")).toMatch(/identities\.deviceId/);
    expect(bodyOf("findRecoverableGuestIdentity")).toMatch(/identities\.recoveryHash/);
  });

  it("purgeStartedAt is declared in the schema AND the additive boot-migrator", () => {
    expect(SCHEMA).toMatch(/purgeStartedAt: timestamp\("purgeStartedAt"\)/);
    expect(V2DB).toMatch(/ADD COLUMN `purgeStartedAt` timestamp NULL/);
  });
});

describe("order is the safety property", () => {
  const cascadeBody = () => {
    const start = PURGE.indexOf("async function cascade(");
    return PURGE.slice(start, PURGE.indexOf("\n/**", start));
  };

  it("the identities row is deleted LAST, and restates the claim", () => {
    // Kill it first and no later pass could ever find the wreckage. Restating the
    // claim means a row somebody un-claimed underneath us survives rather than
    // being deleted unclaimed.
    const b = cascadeBody();
    expect(b).toMatch(/DELETE FROM \\`identities\\`[\s\S]{0,120}\\`purgeStartedAt\\` IS NOT NULL/);
    const idDel = b.indexOf("DELETE FROM \\`identities\\`");
    for (const earlier of [
      "delete(presence)",
      "delete(pushSubscriptions)",
      "delete(contacts)",
      "delete(statuses)",
      "delete(callHistory)",
      "delete(conferenceParticipants)",
      "delete(conversations)",
    ]) {
      const at = b.indexOf(earlier);
      expect(at, `${earlier} must exist`).toBeGreaterThan(0);
      expect(at, `${earlier} must precede the identities delete`).toBeLessThan(idDel);
    }
  });

  it("reachability is severed before content is destroyed", () => {
    // Every intermediate state must leave the person strictly LESS reachable than
    // the step before, so a cascade that dies halfway is safe rather than half-
    // visible: nothing can ring, alert or notify them from the first step onward.
    const b = cascadeBody();
    const content = b.indexOf("delete(messages)");
    expect(content).toBeGreaterThan(0);
    for (const step of ["delete(presence)", "delete(pushSubscriptions)", "delete(onlineWatches)"]) {
      const at = b.indexOf(step);
      // EXISTENCE FIRST. Without this the assertion passes when the statement is
      // DELETED outright, because indexOf returns -1 and -1 is less than anything —
      // found by the mutation run, which removed the onlineWatches delete and stayed
      // green. An unsevered watch means a purged person can still trigger a
      // "they're back online" push at somebody.
      expect(at, `${step} must exist`).toBeGreaterThan(0);
      expect(at, `${step} must precede content deletion`).toBeLessThan(content);
    }
  });

  it("a survivor's reply is unhooked BEFORE the replied-to message is deleted", () => {
    // Otherwise a surviving group thread carries a quote bar pointing at a row
    // that is gone.
    const b = cascadeBody();
    const trim = b.indexOf("for (const conversationId of trim)");
    expect(trim).toBeGreaterThan(0);
    const seg = b.slice(trim);
    const nullReply = seg.indexOf("\\`replyToId\\` = NULL");
    const delMsgs = seg.indexOf("delete(messages)");
    expect(nullReply).toBeGreaterThan(0);
    expect(delMsgs).toBeGreaterThan(0);
    expect(nullReply).toBeLessThan(delMsgs);
  });

  it("unreadCount is RECOMPUTED, never decremented", () => {
    // A decrement is not idempotent; a retried sweep would drive a stored counter
    // negative, which is the v2.99.74 lesson in a second place.
    const b = cascadeBody();
    expect(b).toMatch(/SET cp\.\\`unreadCount\\` = \(\s*SELECT COUNT\(\*\)/);
    const code = codeOnly(PURGE);
    expect(code).not.toMatch(/unreadCount\\?` = \\?`?unreadCount\\?`? -/);
    expect(code).not.toMatch(/unreadCount: sql`[^`]*- 1/);
  });

  it("the account is deleted only when there IS one, and after the identity", () => {
    // Without the users row an admin "delete" lasts until the person signs in again
    // with the same email and is handed a fresh identity.
    const b = cascadeBody();
    expect(b).toMatch(/if \(userId != null\)/);
    expect(b.indexOf("DELETE FROM \\`identities\\`")).toBeLessThan(b.indexOf("delete(users)"));
    expect(b).toMatch(/delete\(sessions\)\.where\(eq\(sessions\.userId, userId\)\)/);
    expect(b).toMatch(/delete\(emailOtps\)/);
  });
});

describe("redactRoster — a conference log belongs to the survivors too", () => {
  const R = [
    { number: "777777", name: "Khalifa", identityId: 3 },
    { number: "805555", name: "Sara", identityId: 62 },
    { number: "601586", name: "Idris", identityId: null },
  ];

  it("removes the person by identityId and leaves everyone else", () => {
    const { roster, removed } = redactRoster(R, 62, "805555");
    expect(removed).toBe(1);
    expect(roster.map((e) => e.identityId ?? e.number)).toEqual([3, "601586"]);
  });

  it("falls back to the NUMBER only for an entry that carries no id", () => {
    // Rosters written before ids were recorded have only a number.
    const { roster, removed } = redactRoster(R, 999, "601586");
    expect(removed).toBe(1);
    expect(roster).toHaveLength(2);
  });

  it("never removes a DIFFERENT id that happens to share the number", () => {
    // A renumber or a reissued line can put one number on two entries across time.
    // Matching on it would delete a stranger from somebody else's call log.
    const { roster, removed } = redactRoster(R, 999, "805555");
    expect(removed).toBe(0);
    expect(roster).toHaveLength(3);
  });

  it("passes an unparseable entry through rather than dropping it", () => {
    const { roster, removed } = redactRoster([null, "x", { identityId: 62 }], 62, null);
    expect(removed).toBe(1);
    expect(roster).toHaveLength(2);
  });

  it("a non-array roster yields an empty one rather than throwing", () => {
    expect(redactRoster(null, 1, "1").roster).toEqual([]);
    expect(redactRoster("[]", 1, "1").removed).toBe(0);
  });

  it("the row is DELETED only when nobody else was on the call", () => {
    const b = PURGE.slice(PURGE.indexOf("async function cascade("));
    expect(b).toMatch(/if \(survivors\.length === 0\) \{[\s\S]{0,140}delete\(conferenceHistory\)/);
  });
});

describe("planConversationPurge — one lapsed guest must not destroy a group", () => {
  it("a DM goes whole — the other side loses the thread, which is the ask", () => {
    expect(planConversationPurge([{ conversationId: 7, kind: "dm", others: 1 }])).toEqual({
      deleteWhole: [7],
      trim: [],
    });
  });

  it("a GROUP with other members is TRIMMED, not deleted", () => {
    expect(planConversationPurge([{ conversationId: 9, kind: "group", others: 5 }])).toEqual({
      deleteWhole: [],
      trim: [9],
    });
  });

  it("a GROUP nobody is left in goes whole", () => {
    expect(planConversationPurge([{ conversationId: 9, kind: "group", others: 0 }])).toEqual({
      deleteWhole: [9],
      trim: [],
    });
  });

  it("an unknown kind is treated as a DM — fails toward not stranding a thread", () => {
    // A null `kind` on a legacy row, or a kind added later. Leaving a two-person
    // thread half-deleted in somebody's inbox is worse than removing it.
    expect(planConversationPurge([{ conversationId: 1, kind: null, others: 1 }]).deleteWhole).toEqual([1]);
  });

  it("mixed memberships are split correctly in one pass", () => {
    const r = planConversationPurge([
      { conversationId: 1, kind: "dm", others: 1 },
      { conversationId: 2, kind: "group", others: 3 },
      { conversationId: 3, kind: "group", others: 0 },
      { conversationId: 4, kind: "dm", others: 0 },
    ]);
    expect(r.deleteWhole.sort()).toEqual([1, 3, 4]);
    expect(r.trim).toEqual([2]);
  });
});

describe("guestDaysLeft — the countdown beside the blue badge", () => {
  const now = new Date("2026-07-27T12:00:00Z");

  it("is NULL — the field omitted, never 0 — for anybody with no expiry", () => {
    // A registered account must have no state in which it renders a countdown.
    expect(guestDaysLeft(null, now)).toBeNull();
    expect(guestDaysLeft(undefined, now)).toBeNull();
    expect(guestDaysLeft("not a date", now)).toBeNull();
  });

  it("floors, so '1 day left' never shows for something 20 minutes away", () => {
    expect(guestDaysLeft(new Date("2026-07-28T11:40:00Z"), now)).toBe(0);
    expect(guestDaysLeft(new Date("2026-07-29T12:00:01Z"), now)).toBe(2);
  });

  it("clamps at 0 rather than going negative", () => {
    expect(guestDaysLeft(new Date("2026-07-01T12:00:00Z"), now)).toBe(0);
  });

  it("clamps at the window, so a clock skew cannot print an absurd figure", () => {
    expect(guestDaysLeft(new Date("2027-07-27T12:00:00Z"), now)).toBe(GUEST_PURGE_DAYS);
  });

  it("accepts the string form the wire delivers", () => {
    expect(guestDaysLeft("2026-08-06T12:00:00.000Z", now)).toBe(10);
  });

  it("the owner's figure is 30 days, and it is the guest cookie window already", () => {
    // `touchGuestExpiry` pushes guestExpiresAt to now+GUEST_DAYS on EVERY visit, so
    // an expiry in the past means exactly "30 days since they last opened RELAY" —
    // which is why the purge needs no second clock.
    expect(GUEST_PURGE_DAYS).toBe(30);
    expect(V2DB).toMatch(/const GUEST_DAYS = 30;/);
  });
});

describe("the switch — off by default, with a dry run in between", () => {
  const withEnv = <T,>(v: string | undefined, fn: () => T): T => {
    const had = Object.prototype.hasOwnProperty.call(process.env, "RELAY_GUEST_PURGE");
    const prev = process.env.RELAY_GUEST_PURGE;
    if (v === undefined) delete process.env.RELAY_GUEST_PURGE;
    else process.env.RELAY_GUEST_PURGE = v;
    try {
      return fn();
    } finally {
      if (had) process.env.RELAY_GUEST_PURGE = prev;
      else delete process.env.RELAY_GUEST_PURGE;
    }
  };

  it("unset means OFF — nothing is ever deleted without an explicit act", () => {
    expect(withEnv(undefined, guestPurgeMode)).toBe("off");
    expect(withEnv("", guestPurgeMode)).toBe("off");
    expect(withEnv("0", guestPurgeMode)).toBe("off");
    expect(withEnv("yes please", guestPurgeMode)).toBe("off");
  });

  it("`dry` is its own state, so the first real count comes from a log", () => {
    expect(withEnv("dry", guestPurgeMode)).toBe("dry");
    expect(withEnv("DRY-RUN", guestPurgeMode)).toBe("dry");
  });

  it("only an explicit truthy value arms it", () => {
    expect(withEnv("1", guestPurgeMode)).toBe("on");
    expect(withEnv("true", guestPurgeMode)).toBe("on");
    expect(withEnv("ON", guestPurgeMode)).toBe("on");
  });

  it("the reaper returns before touching the DB when off, and deletes nothing on dry", () => {
    const body = PURGE.slice(PURGE.indexOf("export async function reapExpiredGuests"));
    // The gate is the FIRST thing, ahead of getDb — a disabled sweep must cost
    // nothing at all, not one query per half hour forever.
    expect(body.indexOf("guestPurgeMode()")).toBeLessThan(body.indexOf("getDb()"));
    expect(body).toMatch(/if \(mode === "off"\) return 0;/);
    const dry = body.slice(body.indexOf('if (mode === "dry")'), body.indexOf("let purged"));
    expect(dry.length).toBeGreaterThan(80);
    expect(dry).not.toMatch(/cascade\(/);
    expect(dry).not.toMatch(/tombstoneNumber\(/);
    expect(dry).toMatch(/return 0;/);
  });

  it("the dry-run log carries ids and numbers, never a display name", () => {
    const body = PURGE.slice(PURGE.indexOf("export async function reapExpiredGuests"));
    const dry = body.slice(body.indexOf('if (mode === "dry")'), body.indexOf("let purged"));
    expect(dry).toMatch(/#\$\{d\.id\}\/\$\{d\.number\}/);
    expect(dry).not.toMatch(/displayName/);
  });

  it("the SELECT restates the eligibility predicate too", () => {
    // Selecting broadly and relying on the claim to refuse would put registered
    // identities through this function and rest the safety argument on one WHERE.
    const body = PURGE.slice(
      PURGE.indexOf("export async function reapExpiredGuests"),
      PURGE.indexOf("if (due.length === 0)")
    );
    expect(body).toMatch(/isNull\(identities\.userId\)/);
    expect(body).toMatch(/isNull\(identities\.purgeStartedAt\)/);
    expect(body).toMatch(/\\`verified\\` IS NULL OR \\`verified\\` = 0/);
    expect(body).toMatch(/\\`guestExpiresAt\\` IS NOT NULL/);
    expect(body).toMatch(/\\`guestExpiresAt\\` < NOW\(\)/);
  });

  it("the sweep is BOUNDED, because this process owns the signaling registry", () => {
    expect(GUEST_PURGE_BATCH).toBeLessThanOrEqual(50);
    expect(PURGE).toMatch(/\.limit\(GUEST_PURGE_BATCH\)/);
  });

  it("one bad row does not abandon the sweep", () => {
    const body = PURGE.slice(PURGE.indexOf("let purged"));
    expect(body).toMatch(/for \(const row of due\) \{\s*try \{/);
    expect(body).toMatch(/catch \(e\) \{/);
  });

  it("it is wired into the boot reapers, and the interval is registered regardless", () => {
    // Registered unconditionally so turning it on is one env var and a restart —
    // no code change, and no window where half the fleet sweeps.
    expect(BOOT).toMatch(/import \{ reapExpiredGuests \} from "\.\.\/purgeIdentity"/);
    expect(BOOT).toMatch(/reapExpiredGuests\(\)\.catch\(/);
    const at = BOOT.indexOf("reapExpiredGuests().catch(");
    const tail = BOOT.slice(at, at + 200);
    expect(tail).toMatch(/\}, 30 \* 60_000\)\.unref\(\)/);
  });
});

describe("the admin delete", () => {
  it("refuses the caller's own identity", () => {
    // The one account nobody else can restore for you is your own, and an admin
    // deleting themselves can leave a deployment with no administrator.
    expect(PURGE).toMatch(
      /if \(actingIdentityId != null && actingIdentityId === identityId\) \{\s*return \{ ok: false, reason: "not-eligible" \}/
    );
  });

  it("is admin-gated, and the gate precedes the purge", () => {
    const proc = ROUTERS.slice(
      ROUTERS.indexOf("  deleteIdentity: publicProcedure"),
      ROUTERS.indexOf("WHY A NOTIFICATION DID NOT ARRIVE")
    );
    expect(proc.length).toBeGreaterThan(300);
    const gate = proc.indexOf("await requireAdmin(ctx)");
    const call = proc.indexOf("adminPurgeIdentity(");
    expect(gate).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(gate);
  });

  it("passes the ACTING identity through, so the self-check has something to check", () => {
    const proc = ROUTERS.slice(ROUTERS.indexOf("  deleteIdentity: publicProcedure"));
    expect(proc).toMatch(/adminPurgeIdentity\(input\.identityId, me\.id\)/);
  });

  it("goes through the SHARED cascade — never its own implementation", () => {
    // Two copies of "everything" is how the automatic purge and the admin button
    // would come to mean different things.
    const proc = ROUTERS.slice(
      ROUTERS.indexOf("  deleteIdentity: publicProcedure"),
      ROUTERS.indexOf("WHY A NOTIFICATION DID NOT ARRIVE")
    );
    const code = codeOnly(proc);
    expect(code).not.toMatch(/\.delete\(/);
    expect(code).not.toMatch(/DELETE FROM/i);
  });

  it("names the self-deletion refusal separately from a missing id", () => {
    const proc = ROUTERS.slice(ROUTERS.indexOf("  deleteIdentity: publicProcedure"));
    expect(proc).toMatch(/"not-eligible": \{\s*code: "CONFLICT"/);
    expect(proc).toMatch(/Another admin has to do it/);
  });

  it("the trace carries ids and the retired number — never a name or an email", () => {
    const proc = ROUTERS.slice(
      ROUTERS.indexOf("  deleteIdentity: publicProcedure"),
      ROUTERS.indexOf("WHY A NOTIFICATION DID NOT ARRIVE")
    );
    expect(proc).toMatch(/DELETED by identity/);
    expect(codeOnly(proc)).not.toMatch(/displayName|\.email/);
  });

  it("the panel confirms by TYPING the number, not with a Yes/No", () => {
    // Every row has a Delete button in the same place, so a plain confirm protects
    // against hesitation but not against acting on the wrong row — which is the
    // mistake that actually happens on a list.
    expect(ADMIN_PAGE).toMatch(/trpc\.admin\.deleteIdentity\.useMutation/);
    expect(ADMIN_PAGE).toMatch(/confirmNum\.replace\(\/\[\\s\\-\.\]\/g, ""\) !== r\.number/);
    expect(ADMIN_PAGE).toMatch(/Delete permanently/);
  });

  it("the panel says what survives, so 'everything' is not a promise it cannot keep", () => {
    expect(ADMIN_PAGE).toMatch(/Group chats survive for their other members/);
    expect(ADMIN_PAGE).toMatch(/retired for good/);
    expect(ADMIN_PAGE).toMatch(/stay in storage and stay locked shut/);
    // The avatar line is the honest one: a profile photo has always been readable by
    // any signed-in RELAY user, and the purge neither widens that nor erases it,
    // because this codebase has no storage-delete path.
    expect(ADMIN_PAGE).toMatch(/no more readable than before, but not erased/);
    expect(ADMIN_PAGE).toMatch(/A block anyone placed on them stays in place/);
  });

  it("the admin panel's tRPC surface grew by exactly this one procedure", () => {
    // v2.99.91 pinned the exact set so a widening has to be a deliberate act.
    const calls = new Set(
      Array.from(ADMIN_PAGE.matchAll(/trpc\.admin\.(\w+)\./g)).map((m) => m[1])
    );
    expect([...calls].sort()).toEqual([
      "amIAdmin",
      // v2.105.15 (#111): suggesting an address to a guest, and withdrawing it.
      // They write ONE hint and cannot register anybody — completing a
      // registration needs a request from the browser holding that identity.
      "clearGuestRegistrationInvite",
      "deleteIdentity",
      "findIdentities",
      "inviteGuestRegistration",
      "pushDiagnostics",
      "sendTestPush",
      "setAccountType",
      "setIdentityNumber",
    ]);
  });
});

describe("the guest countdown on somebody else's profile", () => {
  it("directory.lookup carries guestDaysLeft, derived from the server's own expiry", () => {
    // Read from `guestExpiresAt` rather than a day count written into the copy, so
    // the figure and the mechanism cannot drift (the v2.99.93 reasoning).
    expect(ROUTERS).toMatch(/guestDaysLeft: guestDaysLeft\(id\.guestExpiresAt\)/);
    expect(ROUTERS).toMatch(/import \{ adminPurgeIdentity, guestDaysLeft \} from "\.\/purgeIdentity"/);
  });

  it("renders on BOTH the popup and the full profile, from ONE component", () => {
    // Two copies is how the two surfaces come to promise different things.
    expect(OVERLAYS).toMatch(/export function GuestExpiryNote\(/);
    expect((OVERLAYS.match(/<GuestExpiryNote /g) || []).length).toBe(2);
  });

  it("renders NOTHING when there is no expiry", () => {
    expect(OVERLAYS).toMatch(/if \(daysLeft == null\) return null;/);
  });

  it("says the clock resets, because a bare countdown implies one nobody can stop", () => {
    // True: touchGuestExpiry pushes guestExpiresAt forward on every visit.
    expect(OVERLAYS).toMatch(/Opening RELAY resets the countdown/);
    expect(V2DB).toMatch(/export async function touchGuestExpiry/);
  });

  it("reads today as 'today', not as '0 days'", () => {
    expect(OVERLAYS).toMatch(/Guest number expires today/);
    expect(OVERLAYS).toMatch(/day\$\{daysLeft === 1 \? "" : "s"\}/);
  });
});
