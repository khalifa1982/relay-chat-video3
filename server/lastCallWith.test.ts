/* ──────────────────────────────────────────────────────────────────────────
 * v2.105.24 — "when was my last call with this person?"
 *
 * The owner asked for this on the OUTGOING dial card ("my last call when it was"),
 * i.e. on the screen where you are deciding whether to dial again.
 *
 * THE PROPERTY THIS FILE EXISTS FOR IS THAT IT READS TWO TABLES. The cheap
 * implementation — filter the `calls.history` payload already cached in the Dialer — is
 * not merely incomplete, it is wrong in the worst direction:
 *
 *   `call_history` never holds an ANSWERED row. Nothing writes the "answered" status and
 *   nothing UPDATEs a row; `recordCallStart` ("initiated") is reachable only from
 *   `calls.logStart`, which NO client calls. So in production that table is a
 *   missed/declined log, and every call that actually connected exists solely as a
 *   `conference_history` row.
 *
 * Filtering it alone would therefore report the last time you FAILED to reach somebody
 * and say nothing about any real conversation — a confidently wrong statement about the
 * caller's own history, on the one screen where it would change what they do next.
 *
 * NOT VERIFIED AGAINST A DATABASE, said plainly: no MySQL is reachable here, so the
 * statements are pinned by reading and the arithmetic that can be isolated is driven
 * directly. Nobody has watched a real "last spoke" figure appear.
 * ────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { codeOnly } from "./testing/codeOnly";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** Exact-boundary function locator. `indexOf("export async function " + name)` matches a
 *  PREFIX, and this repo has been bitten by that repeatedly (`claimIdentityNumber` is a
 *  prefix of `claimIdentityNumberAsAdmin`), so the name must end at a word boundary. */
function fnAt(src: string, name: string): string {
  const re = new RegExp(`export (?:async )?function ${name}\\b`);
  const m = re.exec(src);
  if (!m) throw new Error(`function not found: ${name}`);
  const start = m.index;
  const open = (() => {
    for (let i = start; i < src.length; i++) {
      if (src[i] !== "{") continue;
      const pre = src.slice(start, i);
      const bal = (a: string, b: string) => pre.split(a).length === pre.split(b).length;
      const angles = pre.replace(/=>/g, "");
      const angleBal = angles.split("<").length === angles.split(">").length;
      if (bal("(", ")") && bal("{", "}") && angleBal) return i;
    }
    return -1;
  })();
  if (open < 0) throw new Error(`body brace not found: ${name}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function: ${name}`);
}

const DB = read("server/v2db.ts");
const ROUTERS = read("server/v2routers.ts");
const BODY = codeOnly(fnAt(DB, "getLastCallWith"));

describe("v2.105.24 — the premise: call_history holds no answered calls", () => {
  /* If these stop being true the two-table design should be revisited — so they are
   * asserted about the SERVER rather than taken on trust from a comment. */
  it("nothing writes an `answered` status, and nothing UPDATEs a call_history row", () => {
    const db = codeOnly(DB);
    expect(db).not.toMatch(/status:\s*"answered"/);
    expect(db).not.toMatch(/\.update\(callHistory\)/);
  });

  it("`recordCallStart` — the only writer of a non-missed row — has no client caller", () => {
    /* So the "initiated" branch is unreachable in production and the table is a
     * missed/declined log. Asserted by sweeping the CLIENT for the procedure name. */
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(rel);
      }
    };
    walk("client/src");
    /* On CODE, not prose: History.tsx carries a comment recording that nothing calls
     * logStart, so a raw search matches the very file documenting the absence and the
     * assertion fails on correct code — the prose-anchor trap, which this session's
     * releases have now hit five times. */
    const callers = files.filter((f) => /calls\.logStart/.test(codeOnly(read(f))));
    expect(callers).toEqual([]);
    // …and prove the strip is doing work rather than hiding a real caller.
    expect(read("client/src/pages/app/History.tsx")).toMatch(/calls\.logStart/);
  });
});

describe("v2.105.24 — getLastCallWith reads BOTH tables", () => {
  it("queries call_history AND conference_history", () => {
    expect(BODY).toMatch(/\.from\(callHistory\)/);
    expect(BODY).toMatch(/\.from\(conferenceHistory\)/);
  });

  it("finds a shared conference by joining conference_participants to ITSELF", () => {
    /* "a conference we were BOTH in" is two participant rows for one conferenceId, so the
     * table needs two aliases. A single join would match any conference either of us was
     * in — i.e. it would report a call with somebody else entirely. */
    expect(BODY).toMatch(/alias\(conferenceParticipants,/);
    const aliases = BODY.match(/alias\(conferenceParticipants,\s*"[^"]+"\)/g) ?? [];
    expect(aliases.length).toBe(2);
    expect(BODY).toMatch(/\.innerJoin\(mine,/);
    expect(BODY).toMatch(/\.innerJoin\(theirs,/);
    // Both halves of the pair are constrained, or the join proves nothing.
    expect(BODY).toMatch(/eq\(mine\.identityId,\s*meIdentityId\)/);
    expect(BODY).toMatch(/eq\(theirs\.identityId,\s*peerIdentityId\)/);
  });

  it("the attempt lookup matches EITHER direction", () => {
    // "My last call with them" is not a question about who dialled.
    expect(BODY).toMatch(/eq\(callHistory\.callerIdentityId,\s*meIdentityId\)/);
    expect(BODY).toMatch(/eq\(callHistory\.calleeIdentityId,\s*peerIdentityId\)/);
    expect(BODY).toMatch(/eq\(callHistory\.callerIdentityId,\s*peerIdentityId\)/);
    expect(BODY).toMatch(/eq\(callHistory\.calleeIdentityId,\s*meIdentityId\)/);
    expect(BODY).toMatch(/\bor\(/);
  });

  it("both queries order by id, never by startedAt", () => {
    /* startedAt has 1-second granularity and ties unstably — the reason
     * listConferenceHistory already orders by id. Ordering by the timestamp would make
     * "the last call" flap between two calls started in the same second. */
    expect(BODY).toMatch(/orderBy\(desc\(callHistory\.id\)\)/);
    expect(BODY).toMatch(/orderBy\(desc\(conferenceHistory\.id\)\)/);
    expect(BODY).not.toMatch(/orderBy\(desc\((?:callHistory|conferenceHistory)\.startedAt\)\)/);
  });

  it("the caller's Clear-history watermark is applied to BOTH sides", () => {
    /* Applied to one side only, a cleared call would reappear through the other — the
     * class of bug where a rule has N call sites and the N-th forgets it. */
    expect(BODY).toMatch(/gt\(callHistory\.startedAt,\s*clearedAt\)/);
    expect(BODY).toMatch(/gt\(conferenceHistory\.startedAt,\s*clearedAt\)/);
    const guards = BODY.match(/clearedAt \? gt\(/g) ?? [];
    expect(guards.length).toBe(2);
  });

  it("each side is bounded to ONE row", () => {
    // The point of a dedicated query is not paying for a payload to find one figure.
    const limits = BODY.match(/\.limit\(1\)/g) ?? [];
    expect(limits.length).toBe(2);
  });

  it("refuses self, and fails to NULL rather than throwing", () => {
    expect(BODY).toMatch(/meIdentityId === peerIdentityId\) return null/);
    // One decorative line must never break a dial.
    expect(BODY).toMatch(/catch \(e\)[\s\S]*?return null/);
    expect(BODY).toMatch(/if \(!db\) return null/);
  });

  it("the conference result is USED, not merely fetched", () => {
    /* Found by mutation: replacing `answeredRows[0]?.startedAt` with a bare null left every
     * other assertion here green — the query still ran, its result was discarded, and the
     * function was back to being a missed/declined log. Pinning that a query EXISTS says
     * nothing about whether it DECIDES anything; this is the pin-the-declaration-not-the-use
     * class, which this session's releases have hit repeatedly. */
    expect(BODY).toMatch(/const spoke = answeredRows\[0\]\?\.startedAt \?\? null/);
    expect(BODY).toMatch(/const attempt = attemptRows\[0\]\?\.startedAt \?\? null/);
    // Neither side may be hardcoded away.
    expect(BODY).not.toMatch(/const (?:spoke|attempt) = null/);
    // Both feed the verdict.
    expect(BODY).toMatch(/if \(attempt && spoke\)/);
    expect(BODY).toMatch(/if \(!attempt && !spoke\) return null/);
  });

  it("the NEWER of the two wins, and reports which kind it was", () => {
    /* A bare timestamp would say "2h ago" about a call they DECLINED exactly as it would
     * about a conversation — so the outcome travels with the time. */
    expect(BODY).toMatch(/spoke\.getTime\(\) >= attempt\.getTime\(\)/);
    expect(BODY).toMatch(/\{ at: spoke, answered: true \}/);
    expect(BODY).toMatch(/\{ at: attempt, answered: false \}/);
  });
});

describe("v2.105.24 — calls.lastWith is caller-scoped and no oracle", () => {
  const proc = (() => {
    const start = ROUTERS.indexOf("  lastWith: publicProcedure");
    expect(start).toBeGreaterThan(-1);
    const rest = ROUTERS.slice(start + 10);
    const next = rest.search(/\n  [A-Za-z][A-Za-z0-9_]*: publicProcedure/);
    const body = next === -1 ? ROUTERS.slice(start) : ROUTERS.slice(start, start + 10 + next);
    expect(body.length).toBeGreaterThan(200);
    return codeOnly(body);
  })();

  it("takes the identity from the CONTEXT, never from input", () => {
    /* This is what makes it impossible to ask about somebody else's call history: the
     * only identity it can use is the caller's own. */
    expect(proc).toMatch(/const me = requireIdentity\(ctx\)/);
    expect(proc).toMatch(/getLastCallWith\(me\.id, peer\.id, clearedAt\)/);
    // The input carries a number and nothing else.
    expect(proc).toMatch(/\.input\(z\.object\(\{ number: NumberSchema \}\)\)/);
    expect(proc).not.toMatch(/identityId:/);
  });

  it("is rate-limited BEFORE any database work", () => {
    // F5: every number-taking resolver is gated, because each element is an existence probe.
    const gate = proc.indexOf("directoryGate(ctx)");
    const lookup = proc.indexOf("getIdentityByNumber");
    expect(gate).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(lookup);
  });

  it("an unknown number and a peer with no shared call answer IDENTICALLY", () => {
    /* Otherwise the endpoint reports which of the 10^6 numbers exist. Both are
     * `{at: null}` — not an error, so the card simply renders no line. */
    expect(proc).toMatch(/if \(!peer \|\| peer\.id === me\.id\) return \{ at: null, answered: false \}/);
    expect(proc).toMatch(/at: last\?\.at \?\? null/);
    expect(proc).not.toMatch(/NOT_FOUND/);
  });

  it("reads the caller's OWN clear-history watermark", () => {
    expect(proc).toMatch(/getHistoryClearedAt\(me\.id\)/);
    // Never the peer's — it is not the caller's to see.
    expect(proc).not.toMatch(/getHistoryClearedAt\(peer\.id\)/);
  });
});
