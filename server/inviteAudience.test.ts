/* ──────────────────────────────────────────────────────────────────────────
 * v2.105.23 — WHO A GROUP INVITE LINK ADMITS (the last piece of #108).
 *
 * The owner's list for #108 read, verbatim: "invitation URL that joins the group
 * directly (guest enters a name, registered logs in) with an admin-chosen audience of
 * guests-only / registered-only / all". v2.105.9 shipped the link; the audience was
 * the one clause it did not carry.
 *
 * The two properties worth most here are BEHAVIOURAL, not structural:
 *   1. An OPEN token is byte-identical to the pre-audience format, so every link
 *      minted in the last seven days survives the deploy that adds this. A source pin
 *      cannot tell you that — only re-deriving the old MAC by hand can.
 *   2. The two token shapes are domain-separated, so neither can be edited into the
 *      other by adding or dropping a segment.
 * ────────────────────────────────────────────────────────────────────────── */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { codeOnly } from "./testing/codeOnly";

const KEY = "audience-test-fleet-secret";

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

/** A plain import is enough: `busSecret()` reads the env at CALL time and memoises
 *  nothing, so each case's `beforeEach` is already in force. (A `?cachebust` query on a
 *  `.ts` specifier is rejected by the loader — "Invalid loader value" — which is how the
 *  first draft of this file failed nine cases for a reason unrelated to the code.) */
async function mod() {
  return await import("./groupInvite");
}

const saved: Record<string, string | undefined> = {};
const ENV_KEYS = ["REDIS_BUS_SECRET", "JWT_SECRET"];

beforeEach(() => {
  ENV_KEYS.forEach((k) => (saved[k] = process.env[k]));
  process.env.JWT_SECRET = KEY;
  delete process.env.REDIS_BUS_SECRET;
});

afterEach(() => {
  ENV_KEYS.forEach((k) => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
});

describe("v2.105.23 — the audience travels inside the signed token", () => {
  it("an open link is four segments and a restricted one is five", async () => {
    const { mintGroupInvite } = await mod();
    expect(mintGroupInvite(7, 0, "all")!.split(".").length).toBe(4);
    expect(mintGroupInvite(7, 0, "guest")!.split(".").length).toBe(5);
    expect(mintGroupInvite(7, 0, "registered")!.split(".").length).toBe(5);
  });

  it("an omitted audience means `all`, which is what every pre-v2.105.23 link meant", async () => {
    const { mintGroupInvite, verifyGroupInvite } = await mod();
    const t = mintGroupInvite(7, 3)!;
    expect(t.split(".").length).toBe(4);
    expect(verifyGroupInvite(t)!.audience).toBe("all");
  });

  it("a link minted BEFORE audiences existed still verifies", async () => {
    /* THE LOAD-BEARING BACK-COMPAT TEST. A link lives seven days and a rolling deploy
     * takes about a minute, so a format change that invalidated outstanding tokens would
     * silently break every link an admin handed out this week. The old MAC is rebuilt here
     * by hand — from the pre-change formula, not from the module — because asking the
     * module to prove its own compatibility with itself proves nothing. */
    const { verifyGroupInvite, GROUP_INVITE_TTL_MS } = await mod();
    const now = 1_800_000_000_000;
    const exp = now + GROUP_INVITE_TTL_MS;
    const cid = 42;
    const epoch = 5;
    const legacyMac = crypto
      .createHmac("sha256", KEY)
      .update(`invite|${cid}|${epoch}|${exp}`) // the v2.105.9 string, verbatim
      .digest("hex")
      .slice(0, 32);
    const legacy = `${exp}.${cid}.${epoch}.${legacyMac}`;
    const claim = verifyGroupInvite(legacy, now);
    expect(claim).not.toBeNull();
    expect(claim!.conversationId).toBe(cid);
    expect(claim!.epoch).toBe(epoch);
    expect(claim!.audience).toBe("all");
  });

  it("a restricted audience round-trips", async () => {
    const { mintGroupInvite, verifyGroupInvite } = await mod();
    for (const aud of ["guest", "registered"] as const) {
      const claim = verifyGroupInvite(mintGroupInvite(9, 1, aud)!);
      expect(claim).not.toBeNull();
      expect(claim!.audience).toBe(aud);
      expect(claim!.conversationId).toBe(9);
    }
  });

  it("the audience cannot be edited: neither appended to an open token nor dropped from a restricted one", async () => {
    const { mintGroupInvite, verifyGroupInvite } = await mod();
    // Widen an open token to a restricted one, or a restricted one to another audience.
    const open = mintGroupInvite(11, 0, "all")!;
    const openParts = open.split(".");
    expect(
      verifyGroupInvite(`${openParts[0]}.${openParts[1]}.${openParts[2]}.registered.${openParts[3]}`),
    ).toBeNull();

    const guestOnly = mintGroupInvite(11, 0, "guest")!;
    const gp = guestOnly.split(".");
    // Swap `guest` for `registered`, keeping the MAC — the domain separation is what bites.
    expect(verifyGroupInvite(`${gp[0]}.${gp[1]}.${gp[2]}.registered.${gp[4]}`)).toBeNull();
    // Strip the audience segment and present the rest as an open token.
    expect(verifyGroupInvite(`${gp[0]}.${gp[1]}.${gp[2]}.${gp[4]}`)).toBeNull();
  });

  it("a five-segment token carrying the literal `all` is refused — one encoding per token", async () => {
    /* `all` is MAC'd over the four-segment string, so without the explicit refusal this
     * shape would verify and there would be two spellings of one token. */
    const { mintGroupInvite, verifyGroupInvite } = await mod();
    const p = mintGroupInvite(13, 0, "all")!.split(".");
    expect(verifyGroupInvite(`${p[0]}.${p[1]}.${p[2]}.all.${p[3]}`)).toBeNull();
  });

  it("an unrecognised audience refuses at BOTH mint and verify", async () => {
    const { mintGroupInvite, verifyGroupInvite, normalizeInviteAudience } = await mod();
    expect(normalizeInviteAudience("everyone")).toBeNull();
    expect(normalizeInviteAudience("ALL")).toBeNull(); // case-exact, like every other key here
    expect(normalizeInviteAudience(" all")).toBeNull();
    expect(normalizeInviteAudience(null)).toBeNull();
    expect(normalizeInviteAudience(undefined)).toBeNull();
    // Minting refuses rather than falling back to `all`: a mint that quietly drops the
    // restriction hands out a wider link than the admin asked for.
    expect(mintGroupInvite(5, 0, "everyone" as never)).toBeNull();
    // And a token naming an unknown audience cannot verify, however it was produced.
    const p = mintGroupInvite(5, 0, "guest")!.split(".");
    expect(verifyGroupInvite(`${p[0]}.${p[1]}.${p[2]}.staff.${p[4]}`)).toBeNull();
  });

  it("segment counts other than four or five are refused", async () => {
    const { mintGroupInvite, verifyGroupInvite } = await mod();
    const p = mintGroupInvite(5, 0, "guest")!.split(".");
    expect(verifyGroupInvite(`${p[0]}.${p[1]}.${p[2]}`)).toBeNull();
    expect(verifyGroupInvite(`${p[0]}.${p[1]}.${p[2]}.${p[3]}.${p[4]}.x`)).toBeNull();
  });

  it("no fleet secret means no audience-restricted links either", async () => {
    delete process.env.JWT_SECRET;
    delete process.env.REDIS_BUS_SECRET;
    const { mintGroupInvite, verifyGroupInvite } = await mod();
    expect(mintGroupInvite(5, 0, "registered")).toBeNull();
    // Verification refuses everything, so the feature does not exist rather than
    // existing unauthenticated.
    expect(verifyGroupInvite("1.2.3.registered.deadbeefdeadbeefdeadbeefdeadbeef")).toBeNull();
  });
});

describe("v2.105.23 — inviteAudienceAdmits is the one rule", () => {
  it("an open link admits every tier, and does not consult the tier at all", async () => {
    const { inviteAudienceAdmits } = await mod();
    for (const tier of ["guest", "registered", "admin", null, undefined, "nonsense"]) {
      expect(inviteAudienceAdmits("all", tier as never)).toBe(true);
    }
  });

  it("registered-only admits registered AND admin, and refuses a guest", async () => {
    const { inviteAudienceAdmits } = await mod();
    expect(inviteAudienceAdmits("registered", "registered")).toBe(true);
    // An admin holds a registered account by construction; refusing them would be absurd.
    expect(inviteAudienceAdmits("registered", "admin")).toBe(true);
    expect(inviteAudienceAdmits("registered", "guest")).toBe(false);
  });

  it("guest-only admits ONLY a guest", async () => {
    const { inviteAudienceAdmits } = await mod();
    expect(inviteAudienceAdmits("guest", "guest")).toBe(true);
    // Guests-only was asked for as guests-only. Reading it loosely would make the
    // setting mean nothing.
    expect(inviteAudienceAdmits("guest", "registered")).toBe(false);
    expect(inviteAudienceAdmits("guest", "admin")).toBe(false);
  });

  it("a restricted link fails SHUT on an unreadable tier", async () => {
    const { inviteAudienceAdmits } = await mod();
    for (const tier of [null, undefined, "", "unknown"]) {
      expect(inviteAudienceAdmits("registered", tier as never)).toBe(false);
      expect(inviteAudienceAdmits("guest", tier as never)).toBe(false);
    }
  });

  it("an AUDIENCE outside the union refuses, not admits", async () => {
    /* The trailing `return false` is unreachable for a well-typed caller — the union has
     * three members and all three are handled — so a mutation flipping it to `true` was
     * invisible to every other case here. Driving it with an off-union value makes the
     * defensive branch a TESTED one rather than a survivor recorded as harmless: it is the
     * direction that matters, since a future fourth audience added to the type but not to
     * this function would otherwise admit everybody. */
    const { inviteAudienceAdmits } = await mod();
    for (const tier of ["guest", "registered", "admin", null]) {
      expect(inviteAudienceAdmits("staff" as never, tier as never)).toBe(false);
    }
  });
});

describe("v2.105.23 — the gate is wired where it cannot be walked around", () => {
  const routers = codeOnly(read("server/v2routers.ts"));

  function proc(name: string): string {
    const start = routers.indexOf(`  ${name}: publicProcedure`);
    expect(start).toBeGreaterThan(-1);
    // Bounded by the NEXT procedure declaration, so the slice cannot run on into a
    // neighbour whose own guards would satisfy an assertion about this one (the
    // unbounded-slice fragility, recorded repeatedly).
    const rest = routers.slice(start + 10);
    const next = rest.search(/\n  [A-Za-z][A-Za-z0-9_]*: publicProcedure/);
    const body = next === -1 ? routers.slice(start) : routers.slice(start, start + 10 + next);
    expect(body.length).toBeGreaterThan(120);
    return body;
  }

  it("acceptGroupInvite gates on the audience, and does so BEFORE admitting", () => {
    const body = proc("acceptGroupInvite");
    const gate = body.indexOf("inviteAudienceAdmits");
    const admit = body.indexOf("joinGroupByInvite");
    expect(gate).toBeGreaterThan(-1);
    expect(admit).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(admit);
    // The refusal throws — a gate that computes a verdict and drops it is not a gate.
    expect(body).toMatch(/inviteAudienceAdmits[\s\S]{0,200}?throw new TRPCError/);
  });

  it("the gate is skipped for somebody who is ALREADY a member", () => {
    /* The audience governs ADMISSION. Without this, a guest who joined via a guest-only
     * link and later REGISTERED — keeping their identity and number, per v2.99.49 — would
     * be refused from a group they are already in. */
    const body = proc("acceptGroupInvite");
    const membership = body.indexOf("getConversationParticipantIds");
    const gate = body.indexOf("inviteAudienceAdmits");
    expect(membership).toBeGreaterThan(-1);
    expect(membership).toBeLessThan(gate);
    // Pinned as the CONDITION, not merely as an ordering: `if (false && …)` satisfies an
    // index comparison untouched while the gate has stopped deciding anything.
    expect(body).toMatch(
      /if \(!\(await getConversationParticipantIds\(claim\.conversationId\)\)\.includes\(me\.id\)\) \{/,
    );
  });

  it("the epoch and signature are checked before the audience is ever named", () => {
    /* Every other refusal on this endpoint is deliberately uniform so it cannot be used
     * to discover which conversation ids exist. Naming the audience is safe ONLY because
     * it is reached after a signature this fleet minted has verified. */
    const body = proc("acceptGroupInvite");
    const verify = body.indexOf("verifyGroupInvite");
    const epoch = body.indexOf("getGroupInviteEpoch");
    const gate = body.indexOf("inviteAudienceAdmits");
    expect(verify).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(epoch);
    expect(epoch).toBeLessThan(gate);
  });

  it("the preview reports admission, and an existing member is always admitted", () => {
    const body = proc("groupInvitePreview");
    expect(body).toMatch(/audience: claim\.audience/);
    expect(body).toMatch(/admitted: alreadyMember \|\| inviteAudienceAdmits\(/);
  });

  it("the mint echoes the audience it SIGNED, not the one it was handed", () => {
    /* Otherwise a sheet could label a link with a restriction the token does not carry. */
    const body = proc("createGroupInvite");
    expect(body).toMatch(/const audience: GroupInviteAudience = input\.audience \?\? "all"/);
    expect(body).toMatch(/mintGroupInvite\(input\.conversationId, epoch, audience\)/);
    expect(body).toMatch(/audience \}/); // returned alongside the token
  });

  it("the input accepts exactly the three audiences", () => {
    const body = proc("createGroupInvite");
    expect(body).toMatch(/audience: z\.enum\(\["all", "guest", "registered"\]\)\.optional\(\)/);
  });

  it("the tier rule has ONE reader for a single identity", () => {
    /* Three call sites now ask "which tier is this person" (whoami's badge, plus the
     * audience gate at preview and at accept). Two copies of the rule is how a screen
     * comes to offer a Join button the accept then refuses.
     *
     * ASSERTED AS "no single-identity site re-derives it", NOT as a count of the
     * expression: `contacts.list` legitimately carries its own copy inside a map over a
     * BATCH of identities, where a per-row await would be a query per contact. A bare
     * count reads 2 and would have to be edited every time that batched projection
     * moved — pinning a number rather than the property. */
    expect(routers).toMatch(/async function identityTier\(/);
    expect(routers).toMatch(/const role: IdentityRole = await identityTier\(ctx\.identity\)/);
    for (const name of ["groupInvitePreview", "acceptGroupInvite"]) {
      const body = proc(name);
      expect(body).toMatch(/identityTier\(me\)/);
      expect(body).not.toMatch(/verified \? "registered" : "guest"/);
      expect(body).not.toMatch(/getRolesByIdentityIds/);
    }
  });

  it("requireIdentity carries `verified`, so the tier needs no database for the common case", () => {
    /* `getRolesByIdentityIds` fails soft by design (it backs a badge). Without `verified`
     * on the resolved identity, a DB blip would read a registered caller as a guest — and
     * for a registered-only link that means refusing the very person it was minted for. */
    const req = routers.slice(
      routers.indexOf("function requireIdentity"),
      routers.indexOf("async function identityTier"),
    );
    expect(req.length).toBeGreaterThan(80);
    expect(req).toMatch(/verified: boolean;/);
  });
});

describe("v2.105.23 — the screens say the requirement instead of refusing a live control", () => {
  const invite = codeOnly(read("client/src/pages/GroupInvite.tsx"));
  const sheet = codeOnly(read("client/src/app/GroupInfoSheet.tsx"));

  it("the join button is REPLACED when the caller is not admitted, never merely disabled", () => {
    // A control that looks live and always refuses is worse than one that is not there
    // (the v2.103.3 rule).
    expect(invite).toMatch(/\{g\.admitted \? \(/);
    // The requirement is rendered in the other arm.
    expect(invite).toMatch(/This link is for registered accounts/);
    expect(invite).toMatch(/This link is for guest accounts only/);
  });

  it("a guest refused by a registered-only link is given somewhere to go", () => {
    /* Profile carries the "Register with email" button and the copy saying the number and
     * contacts carry over, so this lands on something actionable rather than a dead end. */
    expect(invite).toMatch(/navigate\("\/app\/profile"\)/);
    expect(invite).toMatch(/Register with email from your profile/);
  });

  it("the sheet's label is read back from the server's echo, not from the picker", () => {
    const sec = sheet.slice(
      sheet.indexOf("function InviteLinkSection"),
      sheet.indexOf("export function GroupInfoSheet"),
    );
    expect(sec).toMatch(/setLinkAudience\(r\.audience\)/);
    // The label reads the ECHO; the picker's own value only ever feeds the next mint.
    expect(sec).toMatch(/\{linkAudience === "registered"/);
  });

  it("the picker stays available after a mint, so a second audience can be minted", () => {
    /* Both links stay valid — that is the whole reason the audience lives in the token
     * rather than in a column. */
    const sec = sheet.slice(
      sheet.indexOf("function InviteLinkSection"),
      sheet.indexOf("export function GroupInfoSheet"),
    );
    expect(sec).toMatch(/Create another link/);
    expect(sec).toMatch(/role="radiogroup"/);
    /* THE PICKED VALUE MUST REACH THE MINT. Without this the picker is decoration: every
     * link would be minted `all` whatever the admin selected, and nothing on screen would
     * say so — the feature silently not working. (Found by mutation: dropping `audience`
     * from the call survived every other assertion here.) */
    expect(sec).toMatch(/create\.mutate\(\{ conversationId, audience \}\)/);
    // Every option is reachable. Read from the whole file, not the section slice: the
    // options table sits ABOVE the component (it is module-level data, not state), so a
    // slice anchored on `function InviteLinkSection` cannot see it — which is exactly how
    // the first draft of this assertion failed on correct code.
    for (const v of ["all", "guest", "registered"]) {
      expect(sheet).toMatch(new RegExp(`value: "${v}"`));
    }
    // …and the section really does render that table rather than a second hand-rolled one.
    expect(sec).toMatch(/AUDIENCE_OPTIONS\.map\(/);
  });
});
