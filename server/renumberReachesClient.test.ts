import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./testing/codeOnly";

/**
 * v2.106.86 — A RENUMBER REACHES A CLIENT NOBODY TOUCHED.
 *
 * Owner, on a real renumber:
 *   "there was a user. his pin is 543-101 Mansoor. when he was online I changed his
 *    PIN to 222-222. he was calling me after the change [and it] is showing me his old
 *    pin on the call but the front end showing the new pin, and his number was staying
 *    in my contact list for both — which I told you, when you change it, automatically
 *    change everywhere."
 *
 * ── ONE STALE VALUE, BOTH SYMPTOMS ───────────────────────────────────────────────
 * The call-routing registry is IN MEMORY and keyed on the 6-digit PIN, and a client
 * only ever registers a pin it believes is its own. So a renumber has to reach the
 * CLIENT before routing can be right. Three paths were supposed to do that:
 *
 *   1. the `number` SSE event, fired by `notifyNumberChanged` — but the operator CLI
 *      (`scripts/admin-tool.mjs`) writes STRAIGHT to MySQL, importing only
 *      `mysql2/promise`, so no server hook can fire. Its own header says so.
 *   2. `whoami`'s `refetchOnWindowFocus` (v2.99.83), added as the backstop for exactly
 *      that path — but an app in the FOREGROUND never blurs. He was ONLINE, which is
 *      precisely the state in which it cannot fire.
 *   3. a reload, which is something a user has to think of doing.
 *
 * So he stayed registered as 543101 indefinitely. His calls carried the old pin (the
 * owner's first symptom), the recipient's client saw an unsaved number and offered to
 * save it, and the address book ended up holding BOTH numbers for one person — the
 * second symptom, from the same cause. The database was correct throughout, which is
 * why "the front end showing the new pin".
 *
 * ── THE FIX, AND WHY IT IS THE CHEAP ONE ─────────────────────────────────────────
 * `requireIdentity` already re-reads the identity row on every heartbeat, so the true
 * number is in hand 30 seconds at a time, for free, for every online client. Returning
 * it costs no query, no endpoint, no secret and no second implementation of the
 * propagation rule — and it closes the class rather than the instance, because it
 * covers ANY out-of-band writer including ones nobody has written yet.
 *
 * The CLIENT compares and invalidates `whoami`; `setPreferredPin` then does the
 * re-register it has always done. The server deliberately does NOT compare, because it
 * would have to be TOLD what the client thinks its number is, and a client-supplied
 * value is a worse authority than the row we just read.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const ROUTERS = read("server/v2routers.ts");
const PRESENCE = read("client/src/app/PresenceManager.tsx");
const V2DB = read("server/v2db.ts");
const CLI = read("scripts/admin-tool.mjs");

/** The heartbeat procedure's body, bounded by the next procedure so a later one
 *  cannot be read by accident. */
function heartbeatBody(): string {
  const start = ROUTERS.indexOf("heartbeat: publicProcedure");
  expect(start, "the heartbeat procedure must exist").toBeGreaterThan(-1);
  const end = ROUTERS.indexOf("markIdle: publicProcedure", start);
  expect(end, "markIdle must follow heartbeat").toBeGreaterThan(start);
  return ROUTERS.slice(start, end);
}

describe("v2.106.86 — the heartbeat carries the authoritative number", () => {
  it("the beat returns the identity's CURRENT number", () => {
    /* THE PROPERTY. Without it there is no signal at all for a writer that cannot
       fire the hook, and an app left open never learns its number moved. */
    expect(codeOnly(heartbeatBody())).toMatch(/return\s*\{[^}]*\bnumber:\s*me\.number\b/);
  });

  it("it costs NO extra query — the identity is already resolved for this request", () => {
    /* The whole reason this is affordable. `requireIdentity` reads the row; anything
       that went back to the database here would put a per-client 30s read on the
       fleet to serve a rare event, which is the trade this deliberately avoids. */
    const body = codeOnly(heartbeatBody());
    expect(body).toMatch(/requireIdentity\(ctx\)/);
    expect(body).not.toMatch(/getIdentityBy|db\.select|\.from\(identities\)/);
  });

  it("the server does not decide — it reports, and the client compares", () => {
    /* Deliberate. Comparing server-side would need the client to send what it BELIEVES
       its number is, and a client-supplied value is a worse authority than the row
       just read; it would also add a wire field whose only use is being distrusted. */
    expect(codeOnly(heartbeatBody())).not.toMatch(/claimedNumber|input\.(pin|number)/);
  });
});

describe("v2.106.86 — the client acts on it, once, and only on a real change", () => {
  it("a beat whose number DISAGREES invalidates whoami", () => {
    /* Invalidate rather than patch the cache: `whoami` carries more than the number,
       and a hand-written entry would be a second, partial copy of a payload the
       server owns. */
    const code = codeOnly(PRESENCE);
    expect(code).toMatch(/whoami\.data\?\.number\s*&&\s*whoami\.data\.number\s*!==\s*truth/);
    expect(code).toMatch(/utils\.identity\.whoami\.invalidate\(\)/);
  });

  it("a MISSING number reads as no-news, never as a change", () => {
    /* A rolling deploy serves both bundles for ~60s, so an older server answers with
       no `number` at all. Treating that as a change would make every client of the
       old server refetch on every beat — a self-inflicted 30s poll across the fleet. */
    const code = codeOnly(PRESENCE);
    expect(code).toMatch(/if\s*\(!truth\s*\|\|\s*!\/\^\\d\{6\}\$\/\.test\(truth\)\)\s*return;/);
  });

  it("EVERY heartbeat call site carries the handler, not just the interval one", () => {
    /* The visibilitychange handler beats too — it is the one that fires when somebody
       returns to the app, i.e. the case most likely to be carrying a stale number.
       A handler on only one of the two would fix the slow path and miss the fast one. */
    const calls = PRESENCE.match(/heartbeat\.mutate\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) expect(c).toMatch(/onSuccess:\s*onBeat/);
  });

  it("the reaction is per-call, not attached to the mutation hook", () => {
    /* `useMutation({ onSuccess })` would fire for ANY future caller of this mutation,
       including one added for a different reason. Scoping it to the beats keeps the
       behaviour where its justification is. */
    expect(codeOnly(PRESENCE)).not.toMatch(/heartbeat\s*=\s*trpc\.directory\.heartbeat\.useMutation\(\{/);
  });
});

describe("v2.106.86 — the paths that DID work are untouched", () => {
  it("the in-process hook still fires from the single number writer", () => {
    /* The fast path for everything that goes through the server. This release adds a
       backstop; it must not have replaced the thing that was already correct. */
    expect(codeOnly(V2DB)).toMatch(/notifyNumberChanged\(\{\s*identityId,\s*oldNumber,\s*newNumber\s*\}\)/);
  });

  it("the operator CLI still propagates every number-bearing column itself", () => {
    /* It cannot fire the hook, so its OWN propagation is what keeps contacts and the
       conference roster correct — and the owner's "both numbers in my contact list"
       was NOT this failing: the stale duplicate is deleted here. The second row came
       from the stale caller-ID being offered for saving, which is the same root cause
       the heartbeat now closes. */
    const code = codeOnly(CLI);
    expect(code).toMatch(/UPDATE identities SET number/);
    expect(code).toMatch(/DELETE FROM contacts WHERE id IN/);
    expect(code).toMatch(/UPDATE contacts SET number/);
    expect(code).toMatch(/UPDATE conference_participants SET number/);
  });

  it("the CLI's operator note no longer promises something weaker than the truth", () => {
    /* v2.106.77's rule: a stale reason is worse than none. The note used to say the
       person stays on the old number "until their client re-registers (reopening the
       app is immediate)" — which described the very hole this release closed, and
       would send an operator to tell somebody to reopen an app that no longer needs
       it. */
    expect(CLI).toMatch(/presence heartbeat does within/);
    expect(CLI).not.toMatch(/re-registers \(reopening the app is immediate\)\./);
  });
});
