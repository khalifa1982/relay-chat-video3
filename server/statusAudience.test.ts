import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { normalizeStatusAudience } from "./v2db";
import { AUDIENCE_OPTIONS, audienceOption } from "../client/src/app/statusAudience";

/**
 * v2.99.55 — status audience: "everyone" or "contacts only" (owner ask).
 *
 * The whole feature turns on ONE property: a value that isn't recognisably
 * "everyone" must resolve to the PRIVATE option, everywhere, on both sides of
 * the wire. Every other test here exists to protect the ways that property has
 * historically been lost in this codebase:
 *
 *  - a per-post decision read from a mutable per-user default (retroactive
 *    widening — a story posted to contacts becoming public 6h later),
 *  - two gates that were written independently and drift apart (v2.99.50: the
 *    upload door and the serve door disagreed about media types),
 *  - a fan-out set that is quietly unbounded,
 *  - a field shipped to clients that no surface renders (v2.99.40 #4).
 */
const ROOT = path.resolve(__dirname, "..");
const V2DB = fs.readFileSync(path.join(ROOT, "server/v2db.ts"), "utf8");
const ROUTERS = fs.readFileSync(path.join(ROOT, "server/v2routers.ts"), "utf8");

/**
 * Body of a top-level `export async function name(` — CODE ONLY, cut at the
 * closing brace in column 0. Deliberately not "up to the next export": that
 * sweeps in the NEXT function's doc comment, and a negative assertion then
 * matches prose rather than code. This has bitten several tests in this repo.
 */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  // Balance parens first to skip the parameter list — `insertStatus` takes a
  // multi-line object literal type, so a naive "first `{`" lands inside the
  // signature and a naive "first `\n}`" ends at the signature's close.
  let i = src.indexOf("(", start);
  for (let depth = 0; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) break;
  }
  // The body's `{` is the one whose MATCHING `}` sits at column 0 — i.e. the one
  // that opens the function block.
  //
  // It used to be "the first `{` that ends a line", and that was wrong the moment
  // a return type was written across several lines: `): Promise<{` also ends a
  // line, so the helper returned the TYPE LITERAL and every assertion against the
  // body silently searched the wrong text. Found when a genuinely-present
  // `audience: statuses.audience` was reported missing.
  let open = -1;
  let j = -1;
  for (let k = i; k < src.length; k++) {
    if (src[k] !== "{") continue;
    // Brace-match this candidate; the function's own block is the one that closes
    // with a `}` at the start of a line (column 0).
    let end = k;
    for (let depth = 0; end < src.length; end++) {
      if (src[end] === "{") depth++;
      else if (src[end] === "}" && --depth === 0) break;
    }
    // Column 0 alone is NOT enough: a multi-line return type closes with
    // `} | null> {`, which also starts at column 0. The function's own block is
    // the one whose closing line is NOTHING BUT the brace (optionally `};`).
    const rest = src.slice(end + 1, src.indexOf("\n", end) === -1 ? undefined : src.indexOf("\n", end));
    if (src[end - 1] === "\n" && /^;?\s*$/.test(rest)) {
      open = k;
      j = end;
      break;
    }
  }
  expect(open, `${name} has a body`).toBeGreaterThan(-1);
  return src.slice(start, j + 1);
}

describe("normalizeStatusAudience — fails closed on anything but the literal", () => {
  it("resolves the two real values", () => {
    expect(normalizeStatusAudience("everyone")).toBe("everyone");
    expect(normalizeStatusAudience("contacts")).toBe("contacts");
  });

  it("NULL/undefined mean CONTACTS — every pre-v2.99.55 row, so the column is a no-op migration", () => {
    expect(normalizeStatusAudience(null)).toBe("contacts");
    expect(normalizeStatusAudience(undefined)).toBe("contacts");
  });

  it("a garbled, cased, padded, or future value can never widen a status", () => {
    for (const bad of [
      "",
      " everyone",
      "everyone ",
      "EVERYONE",
      "Everyone",
      "every1",
      "public",
      "all",
      "everyone,contacts",
      "contacts_and_everyone",
      "0",
      "1",
      "true",
      "null",
      "undefined",
      "%65veryone",
    ]) {
      expect(normalizeStatusAudience(bad), `"${bad}" must not resolve to everyone`).toBe("contacts");
    }
  });

  it("the client normalizer agrees with the server one on every input", () => {
    // Two copies of a rule is what caused the v2.99.49 identity bug; here the
    // copies are unavoidable (one runs in the browser), so pin that they match.
    for (const v of [null, undefined, "", "everyone", "contacts", "EVERYONE", "public", " everyone"]) {
      expect(audienceOption(v).value, `disagreement on ${JSON.stringify(v)}`).toBe(
        normalizeStatusAudience(v),
      );
    }
  });
});

describe("the audience is a property of the POST, not of the poster", () => {
  it("statuses.audience is stamped at insert from the resolved value", () => {
    const body = fnBody(V2DB, "insertStatus");
    expect(body).toMatch(/audience: input\.audience/);
  });

  it("insertStatus REQUIRES an audience — it can't be forgotten at a call site", () => {
    // Not optional: a `?` here would let a new caller silently write NULL, which
    // normalizes to contacts (safe) but detaches the row from the user's choice.
    const sig = V2DB.slice(
      V2DB.indexOf("export async function insertStatus("),
      V2DB.indexOf("): Promise<StatusRow | null>", V2DB.indexOf("export async function insertStatus(")),
    );
    expect(sig).toMatch(/audience: StatusAudience;/);
  });

  it("the media gate authorizes against THIS status's audience, not the owner's default", () => {
    // The retroactive-widening trap: reading the identity's CURRENT preference
    // here would republish every live contacts-only story the moment someone
    // flipped their default to everyone.
    /* REWRITTEN for v2.105.5, to the property rather than the formatting: the
       call grew a fourth argument (the group a story was addressed to) and became
       multi-line, so the frozen single-line shape broke while saying nothing about
       whether the gate reads THIS post's audience. */
    const gate = fnBody(V2DB, "authorizeStorageKey");
    expect(gate).toMatch(/statusAudienceAuthorized\(/);
    // The arguments come from the STATUS ROW, never from the owner's preference.
    const call = gate.slice(gate.indexOf("statusAudienceAuthorized("));
    expect(call).toMatch(/st\.identityId/);
    expect(call).toMatch(/st\.audience/);
    expect(gate).not.toMatch(/getIdentityStatusAudience/);
    expect(V2DB).not.toMatch(/getIdentityStatusAudience\([^)]*\)[\s\S]{0,80}authorizeStorageKey/);
  });

  it("getActiveStatusByMediaKey selects the audience (or the gate above reads undefined)", () => {
    const body = fnBody(V2DB, "getActiveStatusByMediaKey");
    expect(body).toMatch(/audience: statuses\.audience/);
  });

  it("markViewed passes the per-status audience too", () => {
    expect(ROUTERS).toMatch(
      /statusAudienceAuthorized\(me\.id, st\.identityId, st\.audience\)/,
    );
  });

  it("post resolves the audience ONCE and defaults to contacts if the read fails", () => {
    const post = ROUTERS.slice(ROUTERS.indexOf("  post: publicProcedure"), ROUTERS.indexOf("  feed: publicProcedure"));
    expect(post).toMatch(/input\.audience \?\? \(await getIdentityStatusAudience\(me\.id\)/);
    // A DB hiccup reading the default must not publish wider than intended.
    expect(post).toMatch(/catch\(\(\) => "contacts" as const\)/);
  });

  it("setIdentityStatusAudience only ever writes the identity DEFAULT, never a status row", () => {
    const body = fnBody(V2DB, "setIdentityStatusAudience");
    expect(body).toMatch(/\.update\(identities\)/);
    expect(body).not.toMatch(/statuses/);
  });
});

describe("a block outranks the audience", () => {
  it("both block checks run BEFORE the everyone short-circuit", () => {
    // "Everyone" must never mean "everyone, including someone I blocked".
    const body = fnBody(V2DB, "statusAudienceAuthorized");
    const ownerBlocked = body.indexOf("isNumberBlockedBy(ownerId, requester.number)");
    const iBlocked = body.indexOf("isNumberBlockedBy(requesterId, owner.number)");
    const everyone = body.indexOf('normalizeStatusAudience(audience) === "everyone"');
    expect(ownerBlocked).toBeGreaterThan(-1);
    expect(iBlocked).toBeGreaterThan(-1);
    expect(everyone).toBeGreaterThan(-1);
    expect(ownerBlocked).toBeLessThan(everyone);
    expect(iBlocked).toBeLessThan(everyone);
  });

  it("still fails closed with no DB and on a missing identity row", () => {
    const body = fnBody(V2DB, "statusAudienceAuthorized");
    expect(body).toMatch(/if \(!db\) return false;/);
    expect(body).toMatch(/if \(!owner \|\| !requester\) return false;/);
  });
});

describe("the realtime fan-out stays bounded", () => {
  it("getStatusAudienceIds is NOT widened by an everyone audience", () => {
    // Its reverse is every identity in the database: widening it would mean a
    // full-table scan and an SSE publish to every user on every status post.
    const body = fnBody(V2DB, "getStatusAudienceIds");
    expect(body).not.toMatch(/everyone/);
    expect(body).not.toMatch(/audience/);
  });

  it("…and says why, so the asymmetry isn't 'fixed' later", () => {
    const doc = V2DB.slice(
      V2DB.lastIndexOf("/**", V2DB.indexOf("export async function getStatusAudienceIds")),
      V2DB.indexOf("export async function getStatusAudienceIds"),
    );
    expect(doc).toMatch(/DELIBERATELY NOT widened/);
  });

  it("the everyone option therefore has a PULL discovery surface", () => {
    // Without this, "everyone" is authorized-but-invisible: the feed is bounded
    // to contacts, so a non-contact would never see the story exists.
    expect(V2DB).toMatch(/export async function getViewableStatusesOfOwner\(/);
    expect(ROUTERS).toMatch(/forNumber: publicProcedure/);
  });
});

describe("status.forNumber is not an oracle and not a free query", () => {
  const fn = ROUTERS.slice(ROUTERS.indexOf("  forNumber: publicProcedure"));
  const body = fn.slice(0, fn.indexOf("\n    }),") + 6);

  it("requires an identity and is rate-limited before any DB work", () => {
    const me = body.indexOf("requireIdentity(ctx)");
    const gate = body.indexOf("statusGate(ctx)");
    const db = body.indexOf("getIdentityByNumber");
    expect(me).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(me);
    expect(db).toBeGreaterThan(gate);
  });

  it("answers an unknown number and an unauthorized one IDENTICALLY (empty, not an error)", () => {
    expect(body).toMatch(/if \(!owner\) return \{ items: \[\], hasUnseen: false \};/);
    expect(body).toMatch(/if \(rows\.length === 0\) return \{ items: \[\], hasUnseen: false \};/);
    expect(body).not.toMatch(/TRPCError/);
  });

  it("filters through the shared predicate rather than re-implementing it", () => {
    expect(body).toMatch(/getViewableStatusesOfOwner\(me\.id, owner\.id\)/);
    const helper = fnBody(V2DB, "getViewableStatusesOfOwner");
    expect(helper).toMatch(/statusAudienceAuthorized\(requesterId, ownerId, a\)/);
    // Per-post, so a contacts-only story and an everyone story from the same
    // person are judged separately.
    expect(helper).toMatch(/normalizeStatusAudience\(r\.audience\)/);
  });
});

describe("the wire shape ships only what a surface renders", () => {
  it("audience is sent for MY OWN statuses only", () => {
    const body = ROUTERS.slice(
      ROUTERS.indexOf("function publicStatus("),
      ROUTERS.indexOf("/** Fan a realtime"),
    );
    expect(body).toMatch(/own = false/);
    expect(body).toMatch(/\.\.\.\(own \? \{ audience: normalizeStatusAudience\(r\.audience\) \} : \{\}\)/);
  });

  it("every call site decides `own` explicitly", () => {
    // feed marks only my own group; mine is always me; forNumber compares ids.
    expect(ROUTERS).toMatch(/publicStatus\(it, oid === me\.id\)/);
    expect(ROUTERS).toMatch(/publicStatus\(r, true\)/);
    expect(ROUTERS).toMatch(/publicStatus\(r, owner\.id === me\.id\)/);
  });
});

describe("the migration cannot change anyone's visibility", () => {
  it("both columns are additive and nullable", () => {
    for (const ddl of [
      "ADD COLUMN `statusAudience` varchar(16)",
      "ADD COLUMN `audience` varchar(16)",
    ]) {
      expect(V2DB).toContain(ddl);
    }
    // No DEFAULT and no NOT NULL: existing rows stay NULL ⇒ contacts ⇒ today's
    // exact behaviour, which is what makes shipping this a no-op until a user
    // opts in.
    expect(V2DB).not.toMatch(/ADD COLUMN `statusAudience`[^\n]*(NOT NULL|DEFAULT)/);
    expect(V2DB).not.toMatch(/ADD COLUMN `audience`[^\n]*(NOT NULL|DEFAULT)/);
  });

  it("the private option is the one NULL resolves to", () => {
    expect(normalizeStatusAudience(null)).toBe(AUDIENCE_OPTIONS[0].value);
    expect(AUDIENCE_OPTIONS[0].value).toBe("contacts");
  });
});

describe("the two options are described the same way on every surface", () => {
  it("there are exactly two, and the copy lives in one module", () => {
    expect(AUDIENCE_OPTIONS.map((o) => o.value)).toEqual(["contacts", "everyone"]);
    for (const o of AUDIENCE_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.hint.length).toBeGreaterThan(0);
      expect(o.posted.length).toBeGreaterThan(0);
    }
  });

  it("the composer and Profile both render from that module, not their own strings", () => {
    const composer = fs.readFileSync(path.join(ROOT, "client/src/pages/app/Status.tsx"), "utf8");
    const profile = fs.readFileSync(path.join(ROOT, "client/src/pages/app/Profile.tsx"), "utf8");
    expect(composer).toMatch(/from "@\/app\/statusAudience"/);
    expect(profile).toMatch(/from "@\/app\/statusAudience"/);
    expect(composer).toMatch(/AUDIENCE_OPTIONS\.map/);
    expect(profile).toMatch(/AUDIENCE_OPTIONS\.map/);
  });

  it("the 'everyone' copy does not promise a broadcast the server never performs", () => {
    // The feed is bounded, so "everyone will see it in their feed" would be a
    // lie. The wording has to be about reach, not about push.
    const everyone = AUDIENCE_OPTIONS[1];
    expect(everyone.hint.toLowerCase()).toMatch(/profile/);
    expect(everyone.posted.toLowerCase()).toMatch(/profile/);
  });

  it("Profile states that the setting is not retroactive", () => {
    const profile = fs.readFileSync(path.join(ROOT, "client/src/pages/app/Profile.tsx"), "utf8");
    const sec = profile.slice(
      profile.indexOf("function StatusPrivacySection("),
      profile.indexOf("function DndSection("),
    );
    expect(sec).toMatch(/already posted keeps the audience/i);
    expect(sec).toMatch(/Blocking someone always hides/i);
    // Guests post statuses too — the section must not be gated on a user row.
    expect(sec).not.toMatch(/signedIn/);
  });
});
