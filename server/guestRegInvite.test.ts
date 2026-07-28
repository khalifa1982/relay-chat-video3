/**
 * v2.105.15 — AN ADMIN CAN SUGGEST HOW A GUEST SHOULD REGISTER, AND CANNOT
 * REGISTER THEM (#111).
 *
 * WHY THIS FEATURE WAS REFUSED ONCE, AND WHAT CHANGED
 * --------------------------------------------------
 * v2.99.99 shipped registered ↔ admin in the panel and deliberately did NOT ship
 * guest → registered, recording it as an ACCOUNT-TAKEOVER PRIMITIVE: an admin
 * attaches an address they control to somebody else's guest identity, then signs in
 * as them with an ordinary email code and owns their number, contacts and history.
 *
 * Nothing about that reasoning has been softened. What makes this release safe is a
 * property of `ensureUserIdentity` — the ONLY writer that turns a guest identity
 * into a registered one. Its claim candidates come exclusively from the REQUESTING
 * BROWSER (the identity `createContext` resolved, the request's own guest cookie,
 * the request's own device id), each claimed under `WHERE id = ? AND userId IS
 * NULL`. No parameter names an identity. So the completing request has to come from
 * the device that actually holds the guest identity, and an admin acting alone can
 * link nothing.
 *
 * This release therefore writes a SUGGESTION and touches that path not at all. The
 * tests below are mostly about what the new code CANNOT do.
 *
 * SAID PLAINLY: this does not defeat an admin who talks a guest into tapping
 * through and reads them the code out loud. Nothing can. But it grants such an
 * admin no capability they lacked — they could already say "open Register and type
 * this address" — which is precisely the difference from the design that was
 * refused, where the admin acted alone.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { activeRegInvite, REG_INVITE_TTL_MS } from "./v2db";
import { codeOnly } from "./testing/codeOnly";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const V2DB = read("server/v2db.ts");
const V2DB_CODE = codeOnly(V2DB);
const ROUTERS = read("server/v2routers.ts");
const ROUTERS_CODE = codeOnly(ROUTERS);
const SCHEMA = read("drizzle/schema.ts");
const ADMIN_UI = read("client/src/pages/app/Admin.tsx");
const ADMIN_UI_CODE = codeOnly(ADMIN_UI);
const PROFILE = read("client/src/pages/app/Profile.tsx");
const AUTH_PANEL = read("client/src/app/AuthPanel.tsx");
const AUTH_PANEL_CODE = codeOnly(AUTH_PANEL);

/**
 * The body of a named top-level function.
 *
 * Anchored with `\b` and asserted to exist, because `inviteGuestRegistration` is a
 * PREFIX of nothing here today but the six-file collision in v2.104.0 (where
 * `deleteMessage` silently re-pointed at `deleteMessageAsGroupAdmin`) is what this
 * shape exists to prevent. The opening brace is the one whose preceding text has
 * balanced parens/braces/angles, so a destructured parameter or a `Promise<{…}>`
 * return type cannot be mistaken for the body (the v2.105.9 locator bug).
 */
function fnBody(src: string, name: string): string {
  const decl = new RegExp(`export (?:async )?function ${name}\\b`);
  const m = decl.exec(src);
  expect(m, `${name} should be declared`).toBeTruthy();
  const from = m!.index;
  let i = from;
  let par = 0;
  let ang = 0;
  let brace = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(") par++;
    else if (c === ")") par--;
    else if (c === "<") ang++;
    else if (c === ">") ang--;
    else if (c === "{") {
      if (par === 0 && ang <= 0 && brace === 0) break;
      brace++;
    } else if (c === "}") brace--;
  }
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = src.slice(start, i + 1);
  expect(body.length, `${name}'s body should not be empty`).toBeGreaterThan(60);
  return body;
}

/** A tRPC procedure's body, bounded by the NEXT procedure so it cannot run long. */
function procBody(src: string, name: string): string {
  const at = src.indexOf(`  ${name}: publicProcedure`);
  expect(at, `${name} should be a procedure`).toBeGreaterThan(-1);
  const rest = src.slice(at + 4);
  const next = rest.search(/\n  [A-Za-z][A-Za-z0-9]*: (?:public|protected)Procedure/);
  const body = next === -1 ? rest : rest.slice(0, next);
  expect(body.length, `${name}'s slice should not be empty`).toBeGreaterThan(100);
  return body;
}

describe("activeRegInvite — ONE reader of the expiry rule", () => {
  const base = { userId: null as number | null };

  it("returns the suggestion while it is fresh, with the derived expiry", () => {
    const at = new Date(1_700_000_000_000);
    const inv = activeRegInvite(
      { ...base, regInviteEmail: "them@example.com", regInviteAt: at },
      at.getTime() + 1000
    );
    expect(inv).toEqual({
      email: "them@example.com",
      at,
      expiresAt: new Date(at.getTime() + REG_INVITE_TTL_MS),
    });
  });

  it("is null once the window has passed", () => {
    const at = new Date(1_700_000_000_000);
    expect(
      activeRegInvite(
        { ...base, regInviteEmail: "them@example.com", regInviteAt: at },
        at.getTime() + REG_INVITE_TTL_MS + 1
      )
    ).toBeNull();
  });

  it("the boundary is EXCLUSIVE — an invite exactly at its expiry is not live", () => {
    // A `<` here rather than `<=` would leave one instant where the panel and the
    // guest's card could legitimately disagree, which is the whole reason the rule
    // has one reader.
    const at = new Date(1_700_000_000_000);
    expect(
      activeRegInvite(
        { ...base, regInviteEmail: "them@example.com", regInviteAt: at },
        at.getTime() + REG_INVITE_TTL_MS
      )
    ).toBeNull();
  });

  it("a REGISTERED identity reads as having no invite, whatever the columns say", () => {
    // Belt and braces against a stale row: there is nothing for somebody with an
    // account to be invited to, so the suggestion must not render on their profile.
    const at = new Date(Date.now());
    expect(
      activeRegInvite({ userId: 42, regInviteEmail: "them@example.com", regInviteAt: at })
    ).toBeNull();
  });

  it("either column missing means no invite", () => {
    const at = new Date(Date.now());
    expect(activeRegInvite({ ...base, regInviteEmail: null, regInviteAt: at })).toBeNull();
    expect(
      activeRegInvite({ ...base, regInviteEmail: "them@example.com", regInviteAt: null })
    ).toBeNull();
    // An empty or whitespace-only address is not an address.
    expect(activeRegInvite({ ...base, regInviteEmail: "   ", regInviteAt: at })).toBeNull();
  });

  it("an unparseable timestamp reads as no invite rather than throwing", () => {
    expect(
      activeRegInvite({
        ...base,
        regInviteEmail: "them@example.com",
        regInviteAt: new Date("not a date"),
      })
    ).toBeNull();
  });
});

describe("inviteGuestRegistration writes a hint and CANNOT register anybody", () => {
  const BODY = fnBody(V2DB, "inviteGuestRegistration");
  const CODE = codeOnly(BODY);

  it("writes ONLY the two invite columns — never userId, verified, or a users row", () => {
    // THE LOAD-BEARING ASSERTION OF THE RELEASE. The takeover v2.99.99 refused is
    // exactly "an admin causes an identity to become registered", so this function
    // must be unable to express that at all.
    //
    // Scoped to the `.set(…)` PAYLOAD rather than swept across the body, because the
    // body legitimately READS `userId` (that is the not-a-guest refusal) — a
    // body-wide `not.toMatch(/userId:/)` matched the SELECT projection and failed for
    // a reason unrelated to the property.
    const sets = [...CODE.matchAll(/\.set\((\{[^}]*\})\)/g)].map((m) => m[1]);
    expect(sets.length, "exactly one write payload").toBe(1);
    const payload = sets[0];
    expect(payload).toMatch(/regInviteEmail: email/);
    expect(payload).toMatch(/regInviteAt: new Date\(nowMs\)/);
    // Nothing else is settable from here — enumerated, so a THIRD key has to be a
    // deliberate act rather than something that slips in beside the two.
    const keys = [...payload.matchAll(/([A-Za-z_]\w*):/g)].map((m) => m[1]).sort();
    expect(keys).toEqual(["regInviteAt", "regInviteEmail"]);
    expect(CODE).not.toMatch(/\.insert\(/);
    expect(CODE).not.toMatch(/\.update\(users\)/);
    // No account minting and no session, by name.
    for (const forbidden of [
      "ensureUserIdentity",
      "createOtpUser",
      "markUserEmailVerified",
      "setSessionCookie",
      "mintOtp",
      "dispatchOtp",
    ]) {
      expect(CODE, `${forbidden} must not be reachable from here`).not.toContain(forbidden);
    }
  });

  it("refuses an identity that already has an account", () => {
    expect(CODE).toMatch(/if \(row\.userId != null\) return \{ ok: false, reason: "not-a-guest" \}/);
  });

  it("the WRITE is scoped to an unclaimed row, not just the read", () => {
    // A guest who registers between the read and the write must not have a
    // suggestion stamped onto their now-registered identity. Pinned on the UPDATE
    // specifically and counted, because a re-read's copy of the same clause
    // satisfying the assertion while the write loses it is the survivor class this
    // repo has hit four times (v2.102.2, v2.103.0, v2.104.0, v2.105.6).
    expect(CODE).toMatch(
      /\.where\(and\(eq\(identities\.id, identityId\), isNull\(identities\.userId\)\)\)/
    );
    expect((CODE.match(/isNull\(identities\.userId\)/g) || []).length).toBe(1);
    // And the verdict comes from affectedRows, so a lost race reads as a refusal.
    expect(CODE).toMatch(/affectedRows/);
    expect(CODE).toMatch(/if \(!changed\) return \{ ok: false, reason: "not-a-guest" \}/);
  });

  it("refuses an address that already belongs to an account, BEFORE writing", () => {
    // This is a security property, not tidiness: without it, binding
    // victim@example.com to a stranger's guest identity blocks the victim's own
    // registration AND lands their sign-in code in somebody else's data. One
    // address, one account (v2.99.49 M50/F3).
    expect(CODE).toMatch(/const owner = await findUserByEmailAny\(email\)/);
    expect(CODE).toMatch(/if \(owner\) return \{ ok: false, reason: "email-taken" \}/);
    expect(CODE.indexOf("findUserByEmailAny")).toBeLessThan(CODE.indexOf(".update(identities)"));
  });

  it("reuses the ONE address resolver rather than a private copy", () => {
    // Two implementations of "is this address taken" is how the two come to
    // disagree about which addresses are free.
    expect(V2DB_CODE).toMatch(/import \{ findUserByEmailAny \} from "\.\/authOtp"/);
    expect((V2DB_CODE.match(/findUserByEmailAny/g) || []).length).toBe(2); // import + the one call
  });

  it("normalizes and shape-checks the address", () => {
    expect(CODE).toMatch(/const email = normalizeEmail\(rawEmail\)/);
    expect(CODE).toMatch(/reason: "bad-email"/);
    expect(CODE).toMatch(/email\.length > 320/);
  });
});

describe("the claim drops the suggestion when the guest registers", () => {
  it("ensureUserIdentity nulls both invite columns alongside the other guest handles", () => {
    // The moment the row stops being a guest the hint has served its only purpose,
    // and a dangling bearer-ish leftover on a registered identity is precisely what
    // the surrounding comment there warns about.
    const body = fnBody(V2DB, "ensureUserIdentity");
    expect(body).toMatch(/regInviteEmail: null,/);
    expect(body).toMatch(/regInviteAt: null,/);
    // Still in the same conditional claim, which is what makes it safe.
    expect(body).toMatch(
      /\.where\(and\(eq\(identities\.id, candidateId\), isNull\(identities\.userId\)\)\)/
    );
  });

  it("this release does not touch how the claim resolves WHO to claim", () => {
    // The takeover would be an admin naming the identity. The candidate list must
    // stay exclusively browser-derived.
    const body = codeOnly(fnBody(V2DB, "ensureUserIdentity"));
    expect(body).toMatch(/addCandidate\(input\.resolvedIdentityId\)/);
    expect(body).toMatch(/getIdentityByGuestToken\(input\.guestToken\)/);
    expect(body).toMatch(/getIdentityByDeviceId\(input\.deviceId\)/);
    // No invite column is ever a candidate source.
    expect(body).not.toMatch(/regInvite\w*\s*\)?\s*,?\s*\/\/|addCandidate\([^)]*regInvite/);
  });
});

describe("the admin procedures are gated and cannot mint an account", () => {
  const INVITE = procBody(ROUTERS, "inviteGuestRegistration");
  const INVITE_CODE = codeOnly(INVITE);

  it("re-derives admin from the users row before doing anything", () => {
    expect(INVITE_CODE).toMatch(/const me = await requireAdmin\(ctx\);/);
    expect(INVITE_CODE.indexOf("requireAdmin")).toBeLessThan(
      INVITE_CODE.indexOf("inviteGuestRegistration(")
    );
  });

  it("is rate-limited like every other identity-resolving admin call", () => {
    expect(INVITE_CODE).toMatch(/directoryGate\(ctx\)/);
    expect(INVITE_CODE.indexOf("directoryGate")).toBeLessThan(
      INVITE_CODE.indexOf("inviteGuestRegistration(")
    );
  });

  it("cannot mint an account, a code or a session", () => {
    for (const forbidden of [
      "ensureUserIdentity",
      "createOtpUser",
      "markUserEmailVerified",
      "setSessionCookie",
      "mintOtp",
      "dispatchOtp",
      "sendEmail",
    ]) {
      expect(INVITE_CODE, `${forbidden} must not appear here`).not.toContain(forbidden);
    }
  });

  it("every refusal is NAMED, because each needs a different next step", () => {
    // Quotes are OPTIONAL in the needle: a hyphenated key must be quoted in an
    // object literal and `unavailable` need not be, so demanding the quoted form
    // failed on the one key JavaScript lets you write bare — a test bug, not a
    // missing refusal.
    for (const reason of ["not-found", "not-a-guest", "bad-email", "email-taken", "unavailable"]) {
      expect(INVITE, `${reason} should be a named refusal`).toMatch(
        new RegExp(`(?:"${reason}"|\\b${reason}\\b)\\s*:`)
      );
    }
    // The taken-address refusal says WHY, since that one is a security property the
    // operator has to understand rather than a typo to retry.
    expect(INVITE).toMatch(/One address, one account/);
  });

  it("the trace carries ids only — never the third party's address", () => {
    const log = INVITE_CODE.slice(INVITE_CODE.indexOf("console.warn"));
    expect(log).toMatch(/identity \$\{input\.identityId\}/);
    expect(log).not.toMatch(/\$\{input\.email\}/);
    expect(log).not.toMatch(/res\.email/);
  });

  it("withdrawing requires the same authority as suggesting", () => {
    const clear = procBody(ROUTERS, "clearGuestRegistrationInvite");
    expect(codeOnly(clear)).toMatch(/await requireAdmin\(ctx\)/);
  });
});

describe("the guest sees it, and only the guest can dismiss it", () => {
  it("whoami reads through the shared helper, not the raw columns", () => {
    const who = procBody(ROUTERS, "whoami");
    expect(codeOnly(who)).toMatch(/activeRegInvite\(ctx\.identity\)/);
    // The raw columns are deliberately NOT put on the wire — the expiry rule has to
    // apply, or a lapsed suggestion would still render.
    expect(codeOnly(who)).not.toMatch(/regInviteEmail: ctx\.identity/);
  });

  it("dismissRegInvite takes NO id, so nobody can clear somebody else's", () => {
    const at = ROUTERS.indexOf("  dismissRegInvite: publicProcedure");
    expect(at).toBeGreaterThan(-1);
    const body = ROUTERS.slice(at, at + 700);
    expect(codeOnly(body)).toMatch(/clearRegInvite\(ctx\.identity\.id\)/);
    // No `.input(` at all: there is nothing for a caller to name.
    const upToMutation = body.slice(0, body.indexOf(".mutation("));
    expect(upToMutation).not.toMatch(/\.input\(/);
  });
});

describe("the suggestion is prefilled, never auto-sent", () => {
  it("suggestedEmail is a SEPARATE prop from initialEmail", () => {
    expect(AUTH_PANEL_CODE).toMatch(/suggestedEmail = ""/);
    expect(AUTH_PANEL_CODE).toMatch(/suggestedEmail\?: string;/);
  });

  it("it fills the field and an address the user typed still wins", () => {
    expect(AUTH_PANEL_CODE).toMatch(
      /useState\(initialEmail \|\| suggestedEmail\)/
    );
  });

  it("it does NOT reach the auto-send effect — that is the whole distinction", () => {
    // `initialEmail` auto-routes and mails a code, which is right when the user
    // typed it at the gate. Doing that for an address somebody ELSE proposed would
    // send a code to an inbox the guest has not yet looked at, defeating the point
    // of showing them the suggestion at all.
    const at = AUTH_PANEL_CODE.indexOf("const didAutoRef");
    expect(at).toBeGreaterThan(-1);
    const effect = AUTH_PANEL_CODE.slice(at, AUTH_PANEL_CODE.indexOf("async function submitEmail"));
    expect(effect.length).toBeGreaterThan(200);
    expect(effect).toMatch(/initialEmail\.trim\(\)/);
    expect(effect).not.toContain("suggestedEmail");
  });

  it("Profile passes it as suggestedEmail and not as initialEmail", () => {
    expect(codeOnly(PROFILE)).toMatch(/suggestedEmail=\{me\.regInvite\?\.email \?\? ""\}/);
    expect(codeOnly(PROFILE)).not.toMatch(/initialEmail=\{me\.regInvite/);
  });
});

describe("both surfaces tell the truth about how far the button reaches", () => {
  it("the admin panel says it creates no account and sends nothing", () => {
    expect(ADMIN_UI).toMatch(/doesn't create\s*\n?\s*an account or send anything/);
  });

  it("the guest's card says the address is theirs to change", () => {
    expect(PROFILE).toMatch(/An administrator suggested an address/);
    expect(PROFILE).toMatch(/You can change it/);
  });

  it("and warns that whoever owns the inbox can sign in", () => {
    // The one hazard no code guard can close: an admin cannot COMPLETE a
    // registration (that needs a request from the guest's own browser), but they can
    // suggest an address they control, and whoever reads that inbox can then sign in
    // with an email code. It is unchanged by this feature — "type this address" was
    // always sayable — so the mitigation is informing the person who can refuse.
    expect(PROFILE).toMatch(/Use an address you own/);
    expect(PROFILE).toMatch(/can sign in to this\s*\n?\s*number/);
  });

  it("the address is rendered LTR-isolated on both surfaces", () => {
    // An email beside an RTL display name would otherwise reorder (the v2.99.77
    // PinTag lesson).
    for (const [name, src] of [
      ["Admin", ADMIN_UI],
      ["Profile", PROFILE],
    ] as const) {
      expect(src, `${name} isolates the address`).toMatch(
        /dir="ltr"\s*\n?\s*style=\{\{ unicodeBidi: "isolate" \}\}/
      );
    }
  });

  it("the guest's suggestion card renders only when there IS one", () => {
    // A block that is usually absent beats a row that is usually a dead end.
    expect(codeOnly(PROFILE)).toMatch(/\{me\.regInvite && \(/);
  });

  it("the panel's per-row field is keyed by row, so it cannot leak between people", () => {
    // The panel lists several people with the same control in the same place; a
    // single shared string is how a half-typed address ends up submitted against
    // the wrong row.
    expect(ADMIN_UI_CODE).toMatch(/useState<Record<number, string>>\(\{\}\)/);
    expect(ADMIN_UI_CODE).toMatch(/inviteEmail\[r\.id\]/);
  });
});

describe("schema and migrator", () => {
  it("both columns are declared, additive and nullable", () => {
    expect(SCHEMA).toMatch(/regInviteEmail: varchar\("regInviteEmail", \{ length: 320 \}\)/);
    expect(SCHEMA).toMatch(/regInviteAt: timestamp\("regInviteAt"\)/);
    // NOT notNull — every pre-release row has neither, which is what makes the
    // migration a no-op.
    expect(SCHEMA).not.toMatch(/regInviteEmail:[^\n]*notNull/);
    expect(SCHEMA).not.toMatch(/regInviteAt:[^\n]*notNull/);
  });

  it("the boot migrator adds both", () => {
    expect(V2DB).toMatch(
      /\{ table: "identities", column: "regInviteEmail", ddl: "ADD COLUMN `regInviteEmail` varchar\(320\)" \}/
    );
    expect(V2DB).toMatch(
      /\{ table: "identities", column: "regInviteAt", ddl: "ADD COLUMN `regInviteAt` timestamp NULL" \}/
    );
  });

  it("the admin projection resolves the invite through the shared reader", () => {
    // Not a second expiry comparison here — that is why activeRegInvite is a
    // function rather than an inline check at each of its two call sites.
    const body = fnBody(V2DB, "adminFindIdentities");
    expect(codeOnly(body)).toMatch(/activeRegInvite\(\{/);
    expect(codeOnly(body)).not.toMatch(/REG_INVITE_TTL_MS/);
  });
});
