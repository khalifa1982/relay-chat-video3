/* ──────────────────────────────────────────────────────────────────────────
 * #114 — stateless group invite links (v2.105.9).
 *
 * The token half is tested BEHAVIOURALLY against the real crypto, because "a link
 * revoked by an epoch bump stops working" is not a claim a source pin can make. The
 * database half is pinned at source, because no MySQL is reachable here — said plainly
 * rather than implied.
 * ────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { codeOnly } from "./testing/codeOnly";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** Exact-boundary function locator. `indexOf("export async function " + name)` matches a
 *  PREFIX, and this repo has been bitten by that six times — `claimIdentityNumber` is a
 *  prefix of `claimIdentityNumberAsAdmin`, `deleteMessage` of
 *  `deleteMessageAsGroupAdmin` — so the name must end at a word boundary. */
function fnAt(src: string, name: string): string {
  const re = new RegExp(`export (?:async )?function ${name}\\b`);
  const m = re.exec(src);
  if (!m) throw new Error(`function not found: ${name}`);
  const start = m.index;
  // The BODY's opening brace — not the `{` of a destructured parameter (`input: {…}`)
  // and not one inside a return type (`Promise<{…}>`). Both of those bit on the first
  // draft of this file: counting from the first `{` returned the parameter object, and
  // every assertion against the body then failed for the wrong reason. The body brace is
  // the first one whose preceding text has balanced parens, braces and angles.
  const open = (() => {
    for (let i = start; i < src.length; i++) {
      if (src[i] !== "{") continue;
      const pre = src.slice(start, i);
      const bal = (a: string, b: string) =>
        (pre.split(a).length - 1) === (pre.split(b).length - 1);
      // `=>` would count as a stray `>`; there are none in these signatures, but strip
      // it anyway so a default value cannot skew the angle balance.
      const angles = pre.replace(/=>/g, "");
      const angleBal =
        (angles.split("<").length - 1) === (angles.split(">").length - 1);
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

const KEYS = ["REDIS_BUS_SECRET", "JWT_SECRET", "SESSION_SECRET"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.JWT_SECRET = "test-fleet-secret-for-invites";
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function mod() {
  return await import("./groupInvite");
}

describe("#114 — the invite token round-trips and is bounded", () => {
  it("mints a token that verifies back to the same conversation and epoch", async () => {
    const { mintGroupInvite, verifyGroupInvite } = await mod();
    const t = mintGroupInvite(4242, 0);
    expect(t).toBeTruthy();
    const claim = verifyGroupInvite(t!);
    expect(claim).toEqual(expect.objectContaining({ conversationId: 4242, epoch: 0 }));
  });

  it("EPOCH 0 IS A REAL EPOCH — a group that has never revoked must still be invitable", async () => {
    // NULL reads as 0, so if 0 were treated as falsy anywhere in the chain the feature
    // would be broken for every group until somebody revoked once.
    const { mintGroupInvite, verifyGroupInvite } = await mod();
    const t = mintGroupInvite(7, 0);
    expect(t).toBeTruthy();
    expect(verifyGroupInvite(t!)?.epoch).toBe(0);
  });

  it("a token minted at one epoch still verifies — the CALLER compares epochs", async () => {
    // This module has no database and deliberately cannot check revocation itself; the
    // signature stays valid and the procedure is what refuses a stale epoch. Pinned so
    // nobody later assumes verification alone is sufficient authorization.
    const { mintGroupInvite, verifyGroupInvite } = await mod();
    const t = mintGroupInvite(9, 3)!;
    expect(verifyGroupInvite(t)?.epoch).toBe(3);
  });

  it("refuses an expired token", async () => {
    const { mintGroupInvite, verifyGroupInvite, GROUP_INVITE_TTL_MS } = await mod();
    const now = 1_000_000_000_000;
    const t = mintGroupInvite(5, 0, "all", now)!;
    expect(verifyGroupInvite(t, now + GROUP_INVITE_TTL_MS - 1)).not.toBeNull();
    expect(verifyGroupInvite(t, now + GROUP_INVITE_TTL_MS + 1)).toBeNull();
  });

  it("a clock in the audience position refuses rather than minting", async () => {
    // v2.105.23 inserted `audience` ahead of `nowMs`, so a caller that still passes a
    // timestamp third lands a number where an audience belongs. `normalizeInviteAudience`
    // fails to NULL, so that mints NOTHING — which is the direction that matters: the
    // alternative reading (fall back to `all`) would hand out an OPEN link to a caller
    // who believes they restricted it. Test files are excluded from `tsc`, so this is
    // the only thing standing between that mistake and a silently wrong token.
    const { mintGroupInvite } = await mod();
    expect(mintGroupInvite(5, 0, 1_000_000_000_000 as never)).toBeNull();
  });

  it("refuses a tampered conversation id, epoch or signature", async () => {
    const { mintGroupInvite, verifyGroupInvite } = await mod();
    const t = mintGroupInvite(11, 2)!;
    const [exp, cid, epoch, mac] = t.split(".");
    expect(verifyGroupInvite(`${exp}.99.${epoch}.${mac}`)).toBeNull();
    expect(verifyGroupInvite(`${exp}.${cid}.7.${mac}`)).toBeNull();
    expect(verifyGroupInvite(`${exp}.${cid}.${epoch}.${"0".repeat(mac.length)}`)).toBeNull();
    // Extending the expiry is the attack that matters most: it is the only bound on a
    // bearer token that nobody has to revoke.
    expect(verifyGroupInvite(`${Number(exp) + 86_400_000}.${cid}.${epoch}.${mac}`)).toBeNull();
  });

  it("refuses junk without throwing", async () => {
    const { verifyGroupInvite } = await mod();
    for (const v of [null, undefined, 42, {}, "", "a.b.c.d", "1.2.3", "x".repeat(400)]) {
      expect(verifyGroupInvite(v as unknown)).toBeNull();
    }
  });

  it("MINT AND VERIFY EACH REFUSE ON THEIR OWN with no fleet secret", async () => {
    // Asserted SEPARATELY. A v2.105.7 mutation that gave only VERIFY a fallback key
    // SURVIVED, because the test observed the pair together and mint was still gated —
    // so the pair looked closed while verification alone would accept anything signed
    // with a guessable constant.
    // `busSecret()` reads the env on every call, so no module reload is needed — the
    // same functions are driven with and without a key.
    const { mintGroupInvite, verifyGroupInvite } = await mod();
    const good = mintGroupInvite(3, 0)!;
    expect(good).toBeTruthy();

    delete process.env.JWT_SECRET;
    // MINT refuses on its own…
    expect(mintGroupInvite(3, 0)).toBeNull();
    // …and VERIFY refuses on its own, for a token that WOULD have verified a moment ago.
    // Asserting only the pair is what let a verify-side fallback key survive in v2.105.7.
    expect(verifyGroupInvite(good)).toBeNull();

    // And a token forged under a guessable constant is refused, so a fallback key
    // reintroduced in either half is caught rather than merely unlikely.
    for (const guess of ["", "secret", "changeme", "relay"]) {
      process.env.JWT_SECRET = guess;
      const forged = guess ? mintGroupInvite(3, 0) : null;
      delete process.env.JWT_SECRET;
      if (forged) expect(verifyGroupInvite(forged)).toBeNull();
    }
  });

  it("is NOT bound to a pin — that is the difference from a call seed", async () => {
    // A call seed carries moderation and is pin-bound so a leak is useless. An invite is
    // a link by construction: pin-binding it would make it a one-person invite. Pinned
    // because "bind it like the seed" is a plausible-sounding change that would break
    // the feature entirely.
    const src = read("server/groupInvite.ts");
    const mint = fnAt(src, "mintGroupInvite");
    expect(mint).not.toMatch(/callerPin/);
    const verify = fnAt(src, "verifyGroupInvite");
    expect(verify).not.toMatch(/callerPin/);
  });
});

describe("#114 — the join watermark is its own column, and the two rules compose", () => {
  const db = read("server/v2db.ts");
  const schema = read("drizzle/schema.ts");

  it("visibleFloorFor takes the MAX of cleared and joined", async () => {
    const { visibleFloorFor } = await import("./v2db");
    expect(visibleFloorFor({})).toBe(0);
    expect(visibleFloorFor({ clearedUpToMessageId: 50 })).toBe(50);
    expect(visibleFloorFor({ joinedAtMessageId: 90 })).toBe(90);
    expect(visibleFloorFor({ clearedUpToMessageId: 50, joinedAtMessageId: 90 })).toBe(90);
    expect(visibleFloorFor({ clearedUpToMessageId: 120, joinedAtMessageId: 90 })).toBe(120);
    // NULL on either side must not swallow the other.
    expect(visibleFloorFor({ clearedUpToMessageId: null, joinedAtMessageId: 4 })).toBe(4);
  });

  it("joinedAtMessageId is a SEPARATE column from clearedUpToMessageId", () => {
    // THE LOAD-BEARING PROPERTY. Reusing the cleared column would make a group you were
    // just added to INVISIBLE, because listThreads drops a thread whose newest message is
    // at or below that watermark — deliberately, for "delete for me".
    expect(schema).toMatch(/joinedAtMessageId: int\("joinedAtMessageId"\)/);
    expect(schema).toMatch(/clearedUpToMessageId: int\("clearedUpToMessageId"\)/);
  });

  it("the THREAD-DROP rule reads the cleared column ALONE, never the shared floor", () => {
    const fn = fnAt(db, "listThreads");
    // The drop branch adds to clearedHidden; it must key on clearedUpToMessageId only.
    const dropBlock = fn.slice(fn.indexOf("const clearedHidden"), fn.indexOf("const hidden"));
    expect(dropBlock).toMatch(/clearedUpToMessageId/);
    expect(codeOnly(dropBlock)).not.toMatch(/visibleFloorFor/);
    // …and the join watermark's own block must remove the preview WITHOUT adding to
    // clearedHidden, or the thread disappears.
    const joinBlock = fn.slice(fn.indexOf("const joinedAt = p.joinedAtMessageId"));
    const joinStmt = joinBlock.slice(0, joinBlock.indexOf("\n  }") + 4);
    expect(joinStmt).toMatch(/latestByConvo\.delete/);
    expect(codeOnly(joinStmt)).not.toMatch(/clearedHidden/);
  });

  it("all three MESSAGE readers use the shared floor", () => {
    // One predicate, three readers — search is the likeliest place to forget a
    // visibility rule, which is how a hidden message comes back through search.
    for (const name of ["listMessages", "searchMessages", "recomputeUnreadFor"]) {
      expect(fnAt(db, name)).toMatch(/visibleFloorFor\(/);
    }
  });

  it("the unread recompute floors the read watermark at the visible floor", () => {
    // Without it, a member joining a busy group is handed an unread count for history
    // they may not read — a badge no tap can clear.
    const fn = fnAt(db, "recomputeUnreadFor");
    expect(fn).toMatch(/Math\.max\(\s*part\.lastReadMessageId \?\? 0,\s*visibleFloorFor\(part\)\s*\)/);
  });
});

describe("#114 — minting is admin-only and joining grants nothing", () => {
  const db = read("server/v2db.ts");
  const routers = read("server/v2routers.ts");

  it("invite-link is NOT a member capability", () => {
    // Its absence from the set is what makes it admin-only. If it were added there,
    // every member could admit strangers — a decision nobody has made.
    const line = /const MEMBER_CAPABILITIES = new Set<GroupCapability>\(\[([^\]]*)\]\)/.exec(db);
    expect(line).toBeTruthy();
    expect(line![1]).not.toMatch(/invite-link/);
    // …and it must actually BE a capability, or the gate would never be consulted.
    expect(db).toMatch(/\| "invite-link"/);
  });

  it("both write procedures gate on invite-link before doing anything", () => {
    const create = routers.slice(
      routers.indexOf("createGroupInvite: publicProcedure"),
      routers.indexOf("revokeGroupInvites: publicProcedure"),
    );
    expect(create.length).toBeGreaterThan(200);
    expect(create.indexOf('"invite-link"')).toBeGreaterThan(-1);
    // The gate must precede the mint, or an unauthorized caller gets a usable token
    // before being refused.
    expect(create.indexOf('"invite-link"')).toBeLessThan(create.indexOf("mintGroupInvite("));
    const revoke = fnAt(db, "revokeGroupInvites");
    expect(revoke.indexOf('"invite-link"')).toBeGreaterThan(-1);
    expect(revoke.indexOf('"invite-link"')).toBeLessThan(revoke.indexOf(".update(conversations)"));
  });

  it("the epoch bump is computed IN SQL, never read-then-written", () => {
    // Two admins revoking together would otherwise both read the same value and write
    // the same successor, so the second revoke is a no-op and a link minted between the
    // reads SURVIVES a revocation its holder was told had happened.
    const fn = fnAt(db, "revokeGroupInvites");
    expect(fn).toMatch(/COALESCE\(\$\{conversations\.inviteEpoch\}, 0\) \+ 1/);
  });

  it("joining writes NO role and no admin field", () => {
    // A link-joined member is an ordinary member. This is the composition v2.104.0's
    // review kept closed by having no "members are admins when there is no admin"
    // fallback: if the join granted a role, an invite would be a takeover primitive.
    const fn = codeOnly(fnAt(db, "joinGroupByInvite"));
    expect(fn).not.toMatch(/groupRole/);
    expect(fn).not.toMatch(/ownerIdentityId/);
  });

  it("joining an existing membership changes nothing — the watermark is never rewritten", () => {
    // Re-opening a link you already used is the ordinary case. Rewriting the watermark on
    // a founding member would silently delete their entire history from their own view.
    //
    // The rule now lives in `admitGroupMember`, the ONE writer for "somebody becomes a
    // member after the group existed" (v2.105.16) — the invite-link route and adding by
    // hand share it, because two copies of "which message does a new member start seeing
    // from" is how the two routes come to disagree about reading the backlog. The property
    // is unchanged; only its home moved, so this pin follows it rather than being relaxed.
    const fn = fnAt(db, "admitGroupMember");
    const guard = fn.indexOf("if (existing) return { ok: true, joined: false }");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(fn.indexOf("joinedAtMessageId:"));
  });

  it("the invite route reaches that single writer rather than inserting its own row", () => {
    // If `joinGroupByInvite` ever grows its own INSERT again, the watermark rule has two
    // owners and this is the assertion that catches it.
    const fn = fnAt(db, "joinGroupByInvite");
    expect(fn).toMatch(/return admitGroupMember\(input\)/);
    expect(fn).not.toMatch(/\.insert\(conversationParticipants\)/);
    // And exactly one place in the file performs that insert-with-watermark.
    expect((db.match(/joinedAtMessageId: newest\?\.id \?\? null/g) || []).length).toBe(1);
  });

  it("the accept procedure re-checks the epoch, not just the signature", () => {
    // Preview and accept are separate requests and a revoke can land between them.
    const accept = routers.slice(routers.indexOf("acceptGroupInvite: publicProcedure"));
    const body = accept.slice(0, accept.indexOf("\n  list: publicProcedure"));
    expect(body).toMatch(/verifyGroupInvite\(input\.token\)/);
    expect(body).toMatch(/epoch !== claim\.epoch/);
    expect(body.indexOf("verifyGroupInvite")).toBeLessThan(body.indexOf("joinGroupByInvite"));
  });

  it("every preview and accept refusal reads identically — no existence oracle", () => {
    const preview = routers.slice(
      routers.indexOf("groupInvitePreview: publicProcedure"),
      routers.indexOf("acceptGroupInvite: publicProcedure"),
    );
    expect(preview.length).toBeGreaterThan(200);
    // Every failure path returns the SAME thing (null), so a caller cannot tell an
    // expired token from a nonexistent conversation.
    const returns = preview.match(/return null;/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(3);
    const accept = routers.slice(routers.indexOf("acceptGroupInvite: publicProcedure"));
    const body = accept.slice(0, accept.indexOf("\n  list: publicProcedure"));
    const msgs = (body.match(/That invite link is no longer valid\./g) ?? []).length;
    expect(msgs).toBeGreaterThanOrEqual(3);
  });
});

describe("#114 — both columns are additive and nullable", () => {
  const db = read("server/v2db.ts");
  it("the boot migrator adds them and nothing else about them", () => {
    expect(db).toMatch(
      /\{ table: "conversations", column: "inviteEpoch", ddl: "ADD COLUMN `inviteEpoch` int" \}/,
    );
    expect(db).toMatch(/column: "joinedAtMessageId",\s*ddl: "ADD COLUMN `joinedAtMessageId` int",/);
    // NOT NULL or a DEFAULT would rewrite every existing row; both must read as NULL.
    expect(db).not.toMatch(/ADD COLUMN `inviteEpoch` int NOT NULL/);
    expect(db).not.toMatch(/ADD COLUMN `joinedAtMessageId` int NOT NULL/);
  });
});

describe("#114 — the join route is its own, and does not auto-join", () => {
  const app = read("client/src/App.tsx");
  const page = read("client/src/pages/GroupInvite.tsx");

  it("/g/:token is separate from /i/:pin", () => {
    expect(app).toMatch(/path=\{"\/g\/:token"\}/);
    expect(app).toMatch(/path=\{"\/i\/:pin"\}/);
  });

  it("the screen needs an identity, so it sits inside OnboardingGate", () => {
    const route = app.slice(app.indexOf('path={"/g/:token"}'), app.indexOf('path={"/docs"}'));
    expect(route).toMatch(/<OnboardingGate>/);
  });

  it("joining takes a TAP — nothing auto-joins on arrival", () => {
    // Auto-joining would make membership something a link confers with no gesture, the
    // class v2.99.57/M48 closed for `?to=`, where arriving on a URL placed a call.
    const code = codeOnly(page);
    expect(code).toMatch(/onClick=\{join\}/);
    // The mutation must not be fired from an effect.
    expect(code).not.toMatch(/useEffect\([^)]*\)\s*=>\s*\{[^}]*acceptGroupInvite/);
    expect(code).not.toMatch(/useEffect\([\s\S]{0,400}?accept\.mutate/);
  });

  it("the invite section is absent for a non-admin rather than disabled", () => {
    // A control that always refuses is worse than one that is not there (v2.103.3).
    const sheet = read("client/src/app/GroupInfoSheet.tsx");
    expect(sheet).toMatch(/\{iAmAdmin && <InviteLinkSection conversationId=\{conversationId\} \/>\}/);
  });

  it("no link is minted until asked", () => {
    // Generating one on sheet open would put a live bearer capability on screen for
    // anybody who merely looked at the group's details.
    const sheet = codeOnly(read("client/src/app/GroupInfoSheet.tsx"));
    const sec = sheet.slice(sheet.indexOf("function InviteLinkSection"), sheet.indexOf("export function GroupInfoSheet"));
    // Pinned as the PROPERTY rather than the argument list: there is exactly ONE mint in
    // this section and it is reached from a click. Freezing `{ conversationId }` broke the
    // moment the audience joined it while saying nothing about whether a mint could fire
    // on mount — which is the only thing this test exists to prevent.
    expect(sec.match(/create\.mutate\(/g)?.length ?? 0).toBe(1);
    expect(sec).toMatch(/onClick=\{\(\) => create\.mutate\(\{[^}]*conversationId/);
    expect(sec).not.toMatch(/useEffect/);
  });
});
