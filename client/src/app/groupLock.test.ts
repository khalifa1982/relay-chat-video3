/* ──────────────────────────────────────────────────────────────────────────
 * v2.105.20 — the 4-digit group lock (#108's last piece).
 *
 * DRIVEN BEHAVIOURALLY, because every property that matters is "does this code
 * open that group" and a source pin cannot answer it. `localStorage` is stubbed
 * (the unit env is Node); `crypto.subtle` is real, so the hashing under test is
 * the hashing that ships.
 *
 * The source pins below cover the two things a behavioural test cannot see: that
 * the gate sits where no route can go round it, and that the hashing is IMPORTED
 * rather than copied.
 * ────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { codeOnly } from "../../../server/testing/codeOnly";

/* ── a real-enough localStorage, installed before the modules load ───────── */
class MemStore {
  private m = new Map<string, string>();
  throwOnWrite = false;
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    if (this.throwOnWrite) throw new Error("QuotaExceededError");
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
  /** Force a malformed value in, the way a older build or a hostile edit would. */
  poke(k: string, v: string) {
    this.m.set(k, v);
  }
}
const store = new MemStore();
vi.stubGlobal("localStorage", store);

const {
  isValidLockCode,
  isGroupLocked,
  isGroupHidden,
  setGroupLock,
  verifyGroupLock,
  removeGroupLock,
  attemptOpenGroup,
  relockGroup,
  unlockGroupForSession,
  lockedConversationIds,
  onGroupLocksChanged,
} = await import("./groupLock");
const { setPasscode, clearPasscode } = await import("./passcode");

const A = 101;
const B = 202;

beforeEach(() => {
  store.clear();
  store.throwOnWrite = false;
  relockGroup(A);
  relockGroup(B);
});

describe("the code's shape", () => {
  it("is exactly four digits", () => {
    expect(isValidLockCode("1234")).toBe(true);
    expect(isValidLockCode("0000")).toBe(true);
    expect(isValidLockCode("123")).toBe(false);
    expect(isValidLockCode("12345")).toBe(false);
  });

  it("refuses anything the keypad cannot reproduce", () => {
    // Shape-checked, not length-checked: each of these is four characters and none
    // could be typed back on a numeric pad, so storing one would be a lock whose
    // code cannot be re-entered.
    expect(isValidLockCode("12 4")).toBe(false);
    expect(isValidLockCode("12.4")).toBe(false);
    expect(isValidLockCode("١٢٣٤")).toBe(false); // Arabic-Indic digits
    expect(isValidLockCode(1234)).toBe(false);
    expect(isValidLockCode(null)).toBe(false);
    expect(isValidLockCode(undefined)).toBe(false);
  });
});

describe("a lock cannot be set without a way back", () => {
  it("REFUSES with no app passcode — the load-bearing safety property", async () => {
    // The app passcode is the ONLY recovery from a forgotten group code (there is no
    // server side to reset). Allowing a lock without one ships a control that can
    // strand somebody from their own group, with "clear all site data" — which
    // destroys the guest identity and its 6-digit number — as the only way out.
    clearPasscode();
    expect(await setGroupLock(A, "1234")).toBe("needs-app-passcode");
    expect(isGroupLocked(A)).toBe(false);
  });

  it("and it refuses BEFORE writing anything, so a refusal leaves no half-lock", async () => {
    clearPasscode();
    await setGroupLock(A, "1234");
    expect(lockedConversationIds()).toEqual([]);
  });

  it("succeeds once one exists", async () => {
    await setPasscode("9999");
    expect(await setGroupLock(A, "1234")).toBe("ok");
    expect(isGroupLocked(A)).toBe(true);
  });

  it("a malformed code is refused before the passcode is even consulted", async () => {
    clearPasscode();
    expect(await setGroupLock(A, "12")).toBe("bad-code");
  });
});

describe("locking, hiding and re-locking", () => {
  beforeEach(async () => {
    await setPasscode("9999");
  });

  it("locking while you are READING it does not shut you out", async () => {
    await setGroupLock(A, "1234");
    // Otherwise setting a lock would immediately blank the conversation you set it
    // from, which reads as the app having crashed.
    expect(isGroupHidden(A)).toBe(false);
    expect(isGroupLocked(A)).toBe(true);
  });

  it("re-locking hides it again without removing the lock", async () => {
    await setGroupLock(A, "1234");
    relockGroup(A);
    expect(isGroupHidden(A)).toBe(true);
    expect(isGroupLocked(A)).toBe(true);
  });

  it("unlocking one group does not unlock another", async () => {
    await setGroupLock(A, "1234");
    await setGroupLock(B, "5678");
    relockGroup(A);
    relockGroup(B);
    unlockGroupForSession(A);
    expect(isGroupHidden(A)).toBe(false);
    expect(isGroupHidden(B)).toBe(true);
  });

  it("an UNLOCKED group is never hidden", () => {
    expect(isGroupHidden(999)).toBe(false);
  });

  it("reports every locked id, for the service-worker mirror", async () => {
    await setGroupLock(A, "1234");
    await setGroupLock(B, "5678");
    expect(lockedConversationIds().sort()).toEqual([A, B]);
  });
});

describe("verifying a code", () => {
  beforeEach(async () => {
    await setPasscode("9999");
    await setGroupLock(A, "1234");
    relockGroup(A);
  });

  it("accepts the right code and rejects a wrong one", async () => {
    expect(await verifyGroupLock(A, "1234")).toBe(true);
    expect(await verifyGroupLock(A, "4321")).toBe(false);
  });

  it("each group has its OWN code", async () => {
    await setGroupLock(B, "5678");
    expect(await verifyGroupLock(B, "1234")).toBe(false);
    expect(await verifyGroupLock(A, "5678")).toBe(false);
  });

  it("an unlocked group verifies NOTHING, so this is no oracle for whether a lock exists", async () => {
    // Returning true for "no lock set" would make the function usable to probe which
    // groups are locked, and would make a caller that trusts it open a locked group.
    expect(await verifyGroupLock(B, "1234")).toBe(false);
    expect(await verifyGroupLock(B, "0000")).toBe(false);
  });

  it("the stored value is a HASH, never the code", () => {
    // The whole point of hashing four digits is small, but storing them in the clear
    // would put them next to the app passcode's own hash and invite a reader to
    // assume both are safe.
    //
    // ASSERTED ON THE PARSED STRUCTURE, NOT AS A SUBSTRING SWEEP OF THE BLOB. The
    // first version was `expect(raw).not.toContain("1234")`, and it FLAKED on
    // perfectly correct code: a record is an 80-character hex string (16 salt + 64
    // hash), which gives ~74 four-character windows each with a 1-in-65536 chance of
    // being exactly "1234" — about one run in 900, and it fired with the salt
    // `9e12349bf1e6a7ca`. Searching a hex blob for a 4-digit needle is a
    // false-positive generator; the real property is that no FIELD holds the code and
    // no field beyond salt+hash exists to hide it in.
    const rec = JSON.parse(store.getItem("relay_glock_v1") || "{}") as Record<
      string,
      Record<string, unknown>
    >;
    const entries = Object.values(rec);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(Object.keys(e).sort()).toEqual(["hash", "salt"]);
      expect(e.salt).not.toBe("1234");
      expect(e.hash).not.toBe("1234");
      expect(String(e.hash)).toMatch(/^[0-9a-f]{64}$/);
      expect(String(e.salt)).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("two groups with the SAME code get different hashes, because each is salted", async () => {
    await setGroupLock(B, "1234");
    const s = JSON.parse(store.getItem("relay_glock_v1")!);
    expect(s[String(A)].hash).not.toBe(s[String(B)].hash);
  });
});

describe("attemptOpenGroup — the ONE rule the gate uses", () => {
  beforeEach(async () => {
    await setPasscode("9999");
    await setGroupLock(A, "1234");
    relockGroup(A);
  });

  it("the group's own code unlocks for the session and LEAVES the lock in place", async () => {
    expect(await attemptOpenGroup(A, "1234")).toBe("unlocked");
    expect(isGroupHidden(A)).toBe(false);
    expect(isGroupLocked(A)).toBe(true); // still locked for next time
  });

  it("the app passcode REMOVES the lock — a recovery you must repeat is not a recovery", async () => {
    expect(await attemptOpenGroup(A, "9999")).toBe("recovered");
    expect(isGroupHidden(A)).toBe(false);
    expect(isGroupLocked(A)).toBe(false);
  });

  it("the group code is tried FIRST, so the ordinary path never removes a lock", async () => {
    // If the order were reversed, a group whose code happened to equal the app
    // passcode would be silently unlocked-and-removed every time it was opened.
    await setGroupLock(B, "9999"); // same as the app passcode
    relockGroup(B);
    expect(await attemptOpenGroup(B, "9999")).toBe("unlocked");
    expect(isGroupLocked(B)).toBe(true);
  });

  it("a wrong code opens nothing and removes nothing", async () => {
    expect(await attemptOpenGroup(A, "0000")).toBe("no");
    expect(isGroupHidden(A)).toBe(true);
    expect(isGroupLocked(A)).toBe(true);
  });

  it("with no app passcode there is no recovery arm to exploit", async () => {
    clearPasscode();
    expect(await attemptOpenGroup(A, "0000")).toBe("no");
    expect(isGroupLocked(A)).toBe(true);
  });
});

describe("removing a lock", () => {
  beforeEach(async () => {
    await setPasscode("9999");
    await setGroupLock(A, "1234");
  });

  it("takes the group code", async () => {
    expect(await removeGroupLock(A, "1234")).toBe(true);
    expect(isGroupLocked(A)).toBe(false);
  });

  it("or the app passcode, which is the recovery", async () => {
    expect(await removeGroupLock(A, "9999")).toBe(true);
    expect(isGroupLocked(A)).toBe(false);
  });

  it("and neither anything else", async () => {
    expect(await removeGroupLock(A, "0001")).toBe(false);
    expect(isGroupLocked(A)).toBe(true);
  });

  it("removing one leaves the others alone", async () => {
    await setGroupLock(B, "5678");
    await removeGroupLock(A, "1234");
    expect(isGroupLocked(B)).toBe(true);
  });
});

describe("degrading rather than trapping", () => {
  it("a storage failure REPORTS itself instead of claiming the group is locked", async () => {
    await setPasscode("9999");
    store.throwOnWrite = true;
    expect(await setGroupLock(A, "1234")).toBe("storage-unavailable");
    expect(isGroupLocked(A)).toBe(false);
  });

  it("a malformed store reads as NOTHING locked, not as everything locked", () => {
    // Failing the other way would make every group permanently unopenable on a
    // browser whose localStorage is unreadable — and the lock is a screen over data
    // the device already has, so "we cannot tell" has to mean "show it".
    store.poke("relay_glock_v1", "not json at all");
    expect(lockedConversationIds()).toEqual([]);
    expect(isGroupLocked(A)).toBe(false);
  });

  it("an entry with no hash is DROPPED, not kept as an un-openable half-lock", () => {
    store.poke("relay_glock_v1", JSON.stringify({ [A]: { salt: "aa" }, [B]: { salt: "bb", hash: "cc" } }));
    expect(isGroupLocked(A)).toBe(false); // would match no code at all
    expect(isGroupLocked(B)).toBe(true);
  });

  it("an array, or a null, reads as nothing locked", () => {
    store.poke("relay_glock_v1", "[1,2,3]");
    expect(lockedConversationIds()).toEqual([]);
    store.poke("relay_glock_v1", "null");
    expect(lockedConversationIds()).toEqual([]);
  });
});

describe("the change hook, which is what keeps the service worker current", () => {
  it("fires on set, on remove and on unlock", async () => {
    await setPasscode("9999");
    let n = 0;
    const off = onGroupLocksChanged(() => n++);
    await setGroupLock(A, "1234");
    const afterSet = n;
    expect(afterSet).toBeGreaterThan(0);
    relockGroup(A);
    unlockGroupForSession(A);
    await removeGroupLock(A, "1234");
    expect(n).toBeGreaterThan(afterSet);
    off();
    const frozen = n;
    await setGroupLock(A, "1234");
    expect(n).toBe(frozen); // unsubscribed
  });

  it("one throwing listener does not stop the rest", async () => {
    await setPasscode("9999");
    let reached = false;
    const off1 = onGroupLocksChanged(() => {
      throw new Error("boom");
    });
    const off2 = onGroupLocksChanged(() => {
      reached = true;
    });
    await setGroupLock(A, "1234");
    expect(reached).toBe(true);
    off1();
    off2();
  });
});

/* ── source pins: the things behaviour cannot see ─────────────────────────── */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("the hashing is IMPORTED, never copied", () => {
  it("groupLock owns no crypto of its own", () => {
    // Two implementations of "hash a 4-digit code" is how two stores come to
    // disagree about what a stored hash means, and the one that drifts silently
    // stops matching. `passcode.ts` exports the primitives for exactly this.
    const src = read("client/src/app/groupLock.ts");
    expect(src).toMatch(/import \{[^}]*hashCode[^}]*\} from "\.\/passcode"/);
    expect(src).not.toMatch(/crypto\.subtle/);
    expect(src).not.toMatch(/SHA-256/);
    expect(src).not.toMatch(/getRandomValues/);
  });

  it("and it never touches the app passcode's own storage keys", () => {
    const src = read("client/src/app/groupLock.ts");
    expect(src).not.toMatch(/relay_pass_hash/);
    expect(src).not.toMatch(/relay_pass_salt/);
  });
});

describe("the gate sits where no route can go round it", () => {
  const MSG = read("client/src/pages/app/Messages.tsx");

  it("is a FULL early return in the conversation view, ahead of the ordinary header", () => {
    /* Gating the thread row's TAP would leave a deep link, a notification tap, a
       reload with ?c=<id>, and the swipe row's own navigation each needing their own
       check — and one of them would have been forgotten.

       FOUND BY MUTATION: this first compared INDEXES, which
       `if (false && isGroup && isGroupHidden(conversationId))` satisfies untouched —
       the text stayed put before the header while the gate had stopped deciding
       anything. Pin-the-location-not-the-property, for the third time in two
       releases. So the condition is now pinned EXACTLY, with a constant-false
       conjunct forbidden, and the position is checked on that same statement. */
    const stmt = MSG.split("\n").filter((l) => l.includes("isGroupHidden(conversationId)"));
    expect(stmt, "exactly one gate").toHaveLength(1);
    expect(stmt[0]).toMatch(/^\s*if \(isGroup && isGroupHidden\(conversationId\)\) \{$/);

    const gate = MSG.indexOf("if (isGroup && isGroupHidden(conversationId))");
    const header = MSG.indexOf("{/* conversation header —");
    expect(gate).toBeGreaterThan(-1);
    expect(header).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(header);
    expect(MSG).toMatch(/<GroupLockGate conversationId=\{conversationId\}/);
  });

  it("the view SUBSCRIBES, or a correct code would leave the gate on screen", () => {
    expect(MSG).toMatch(/useGroupLocks\(\);/);
  });

  it("the thread row redacts the preview and suppresses the typing line", () => {
    expect(MSG).toMatch(/const hidden = isGroup && isGroupHidden\(t\.conversationId\)/);
    expect(MSG).toMatch(/hidden\s*\?\s*"Locked"/);
    expect(MSG).toMatch(/\{typing && !hidden \? \(/);
  });

  it("it keys on isGroupHidden, not isGroupLocked — an unlocked group reads normally", () => {
    // Using `isGroupLocked` for the row would keep the preview redacted for the whole
    // session even while the conversation is open beside it.
    const row = MSG.slice(MSG.indexOf("const hidden = isGroup"));
    expect(row.slice(0, 200)).not.toMatch(/isGroupLocked/);
  });
});

describe("the notification is REDACTED, not suppressed", () => {
  const SW = read("client/public/sw.js");

  it("a locked group still alerts — it just names nobody", () => {
    // A mute means "do not tell me" and drops the notification. A lock means "do not
    // show it on this screen", so dropping it would silently lose messages the user
    // still wants to know about.
    expect(SW).toMatch(/async function lockedConv\(d\)/);
    expect(SW).toMatch(/hide \? "RELAY" : d\.title \|\| "RELAY"/);
    expect(SW).toMatch(/New message in a locked chat/);
  });

  it("the two questions are separate: mute decides WHETHER, the lock decides WHAT", () => {
    expect(SW).toMatch(/Promise\.all\(\[suppressed\(d\), lockedConv\(d\)\]\)/);
    // A locked-but-unmuted push must still be shown, so `hide` may never reach the
    // early return.
    expect(SW).toMatch(/if \(skip\) return undefined;/);
  });

  it("an older page's prefs (no `locked` field) read as nothing locked", () => {
    // Mid-rollout the page may be older than the worker. Absent must mean today's
    // behaviour, never "redact everything".
    expect(SW).toMatch(/Array\.isArray\(p\.locked\) \? p\.locked : \[\]/);
  });
});

describe("the worker's copy is kept current by ONE subscription", () => {
  it("swPrefs subscribes; groupLock does not import swPrefs (that would be a cycle)", () => {
    const prefs = read("client/src/app/swPrefs.ts");
    const lock = read("client/src/app/groupLock.ts");
    expect(prefs).toMatch(/onGroupLocksChanged\(\(\) => syncAlertPrefsToSw\(\)\)/);
    /* THE PROSE-ANCHOR TRAP, in the very file that documents it — caught by this
       test failing on correct code. A bare `not.toMatch(/swPrefs/)` matched
       groupLock's OWN COMMENT explaining why the edge points the other way, so it
       would have failed on a perfectly good module and passed on a bad one only by
       coincidence. What matters is the IMPORT, so that is what is asserted. */
    expect(lock).not.toMatch(/^\s*import[^\n]*swPrefs/m);
    expect(lock).not.toMatch(/import\(["']\.\/swPrefs/);
  });

  it("and it reads the lock list through the module that owns it", () => {
    // Re-parsing `relay_glock_v1` here would be a second reader of that shape, which
    // is how the page and the worker come to disagree about which groups are locked.
    const prefs = read("client/src/app/swPrefs.ts");
    expect(prefs).toMatch(/lockedConversationIds\(\)/);
    expect(prefs).not.toMatch(/relay_glock_v1/);
  });
});

describe("/api/health says which media transport the fleet is on (v2.105.20)", () => {
  const CORE = read("server/_core/index.ts");

  it("reports the LiveKit gate, so 'am I on the SFU or the mesh?' needs no second browser", () => {
    // It was not answerable before: the flag only reaches a client inside the
    // `registered` signaling frame, so finding out required opening a call. It is the
    // biggest lever on call CPU and latency (the mesh runs N-1 encoders per phone),
    // so it belongs beside `redisBus` and `cluster`.
    expect(CORE).toMatch(/media: \{ livekit: livekitConfig\(\)\.enabled \}/);
    expect(CORE).toMatch(/import \{ attachRelay, livekitConfig \} from "\.\.\/relay"/);
  });

  it("a BOOLEAN only — never the URL, never the key", () => {
    // Same discipline as `redisBus: Boolean(REDIS_URL)`: the health endpoint is
    // unauthenticated, so it may report WHETHER a credential is configured and never
    // any part of it.
    /* ON STRIPPED CODE. The first cut of this failed on correct code, because the
       comment I wrote INSIDE the handler names `LIVEKIT_URL` in order to explain what
       the gate is — text ABOUT a pattern satisfying a search FOR it. The prose-anchor
       trap, for the third time in this session's two releases. */
    const health = CORE.slice(CORE.indexOf('app.get("/api/health"'));
    const body = codeOnly(health.slice(0, health.indexOf("});")));
    expect(body).not.toMatch(/LIVEKIT_URL/);
    expect(body).not.toMatch(/LIVEKIT_API_KEY/);
    expect(body).not.toMatch(/LIVEKIT_API_SECRET/);
    expect(body).not.toMatch(/livekitConfig\(\)\.url/);
    // …and the strip is doing work rather than hiding a defect: the raw slice really
    // does contain the string, in the comment.
    expect(health.slice(0, health.indexOf("});"))).toMatch(/LIVEKIT_URL/);
  });
});

describe("the lock control is offered to any MEMBER, not just an admin", () => {
  const SHEET = read("client/src/app/GroupInfoSheet.tsx");

  it("is not behind iAmAdmin", () => {
    // `invite-link` is admin-only because it admits strangers to a group everybody
    // shares. A lock changes what appears on the actor's OWN screen and grants them
    // nothing over anyone else, so admin-gating it would stop an ordinary member
    // hiding a chat on their own phone.
    const mount = SHEET.slice(SHEET.indexOf("<GroupLockSection"));
    expect(mount).toBeTruthy();
    const before = SHEET.slice(0, SHEET.indexOf("<GroupLockSection"));
    const lastLine = before.slice(before.lastIndexOf("\n", before.length - 2));
    expect(lastLine).not.toMatch(/iAmAdmin && $/);
  });

  it("and it says what the lock is NOT, so it cannot read as a permission", () => {
    // Whitespace-tolerant: this is JSX copy, so a prettier reflow moves the line
    // breaks and a literal-space pattern would go stale on a change that alters
    // nothing anybody reads.
    const flat = SHEET.replace(/\s+/g, " ");
    expect(flat).toMatch(/not a permission/);
    expect(flat).toMatch(/other devices still show them/);
  });
});
