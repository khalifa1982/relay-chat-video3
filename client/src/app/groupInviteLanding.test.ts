import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { groupInviteTokenFromPath, inviteTargetFromSearch } from "./OnboardingGate";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Strip comments — prose ABOUT a pattern is not the pattern (the recurring trap). */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const GATE = read("client/src/app/OnboardingGate.tsx");
const GATE_CODE = codeOnly(GATE);

/**
 * BOARD FRAME 4h — THE GROUP-INVITE LANDING.
 *
 * ── WHICH HALF OF THE FRAME THIS FILE OWNS ───────────────────────────────────────────
 * `/g/<token>` renders `OnboardingGate` wrapping `GroupInvite` (see `App.tsx`), so the
 * frame spans TWO screens and the owner's own note says so ("`app/OnboardingGate.tsx` +
 * `pages/app/JoinInvite`"). `OnboardingGate` runs ONLY before an identity exists — it
 * returns its children the moment `me` is truthy — so this file owns the pre-identity
 * landing and `GroupInvite.tsx` owns everything after.
 *
 * That split is not a preference, it is forced by the server: `groupInvitePreview` opens
 * with `requireIdentity(ctx)`, deliberately (v2.105.9), because telling an anonymous
 * caller which conversations exist would widen a signed-capability read to anybody who
 * can guess a URL. So the group's NAME, PHOTO and MEMBER ROW — three quarters of what the
 * frame draws — cannot be shown on the pre-identity landing at all, and the tests below
 * pin what this screen says INSTEAD of inventing them.
 *
 * ── WHAT WAS ACTUALLY BROKEN ─────────────────────────────────────────────────────────
 * Before this frame, an identity-less visitor on a group invite link fell through to the
 * ORDINARY sign-in screen with nothing anywhere saying they had been invited to a group.
 */
describe("groupInviteTokenFromPath — pull the group token out of the path", () => {
  it("extracts the token from a /g/<token> path", () => {
    expect(groupInviteTokenFromPath("/g/abc.123.def")).toBe("abc.123.def");
    expect(groupInviteTokenFromPath("/g/12.3.1700000000000.registered.deadbeef")).toBe(
      "12.3.1700000000000.registered.deadbeef",
    );
  });

  it("tolerates a trailing slash and never swallows a query or hash", () => {
    expect(groupInviteTokenFromPath("/g/tok/")).toBe("tok");
    // `pathname` never contains these, but a caller passing a full URL tail must not
    // produce a token with the query glued onto it.
    expect(groupInviteTokenFromPath("/g/tok?x=1")).toBe(null);
    expect(groupInviteTokenFromPath("/g/tok#frag")).toBe(null);
  });

  it("decodes a percent-encoded token", () => {
    expect(groupInviteTokenFromPath("/g/a%2Eb")).toBe("a.b");
  });

  it("returns null rather than throwing on a malformed escape", () => {
    // decodeURIComponent throws on a lone `%`; a landing screen must not crash on a URL.
    expect(() => groupInviteTokenFromPath("/g/%zz")).not.toThrow();
    expect(groupInviteTokenFromPath("/g/%zz")).toBe(null);
  });

  it("returns null for every non-group path", () => {
    expect(groupInviteTokenFromPath("")).toBe(null);
    expect(groupInviteTokenFromPath("/")).toBe(null);
    expect(groupInviteTokenFromPath("/g")).toBe(null);
    expect(groupInviteTokenFromPath("/g/")).toBe(null);
    expect(groupInviteTokenFromPath("/app/messages")).toBe(null);
    expect(groupInviteTokenFromPath("/group/tok")).toBe(null);
    // A nested segment is not a token — the route is `/g/:token`, one segment.
    expect(groupInviteTokenFromPath("/g/a/b")).toBe(null);
  });

  it("is bounded, so a pathological URL cannot be rendered off", () => {
    expect(groupInviteTokenFromPath("/g/" + "a".repeat(256))).toBe("a".repeat(256));
    expect(groupInviteTokenFromPath("/g/" + "a".repeat(257))).toBe(null);
  });

  /* THE TWO LINK KINDS MUST NEVER RESOLVE TO EACH OTHER. `/i/<pin>` carries a NUMBER and
     dials it; `/g/<token>` carries a signed capability and joins a conversation. One
     screen guessing which of the two a URL meant would be guessing on a string somebody
     else chose — which is the reason `GroupInvite` is its own route in the first place. */
  it("cannot be confused with a call link, in either direction", () => {
    expect(groupInviteTokenFromPath("/i/555555")).toBe(null);
    expect(groupInviteTokenFromPath("/app/dialer")).toBe(null);
    // …and the call parser reads the SEARCH, so a group path yields no call target.
    expect(inviteTargetFromSearch("")).toBe(null);
  });

  it("agrees with the route App.tsx actually registers", () => {
    /* A parser that disagreed with the router is the class this repo keeps paying for
       (v2.99.71, v2.105.11): the route would render the gate and the gate would show the
       generic sign-in screen, with nothing saying why. Read the real route rather than
       restating it. */
    const app = codeOnly(read("client/src/App.tsx"));
    const m = /path=\{?"(\/g\/[^"]+)"/.exec(app);
    expect(m, "App.tsx no longer registers a /g/ route").toBeTruthy();
    const [, pattern] = m!;
    expect(pattern).toBe("/g/:token");
    // The parser accepts exactly what that pattern matches.
    expect(groupInviteTokenFromPath(pattern.replace(":token", "sample"))).toBe("sample");
  });
});

describe("board 4h — the pre-identity group-invite landing", () => {
  it("a group link no longer falls through to the generic sign-in screen", () => {
    // THE BUG THIS FIXES. The early return used to be `if (!showJoin)`, so every
    // visitor without a `?to=` call target got `LoginScreen` — including one who had
    // just tapped a group invite.
    expect(GATE_CODE).toMatch(/showGroupJoin/);
    expect(GATE_CODE, "the group branch must gate the LoginScreen early return").toMatch(
      /if \(!showJoin && !showGroupJoin\) return <LoginScreen/,
    );
  });

  it("the group card is reached from the PATH, and the call card still from ?to=", () => {
    // Each card is driven by its own half of the URL; neither reads the other's.
    expect(GATE_CODE).toMatch(/groupInviteTokenFromPath\(\s*typeof window[\s\S]{0,90}pathname/);
    expect(GATE_CODE).toMatch(/inviteTargetFromSearch\(\s*typeof window[\s\S]{0,90}\.search/);
    // The call-link card is unchanged and still call-only, so #109 cannot regress.
    expect(GATE_CODE).toMatch(/const showJoin = !!callTarget && !emailMode;/);
    // A URL carrying BOTH is treated as a call, never as two cards at once.
    expect(GATE_CODE).toMatch(/const showGroupJoin = !!groupToken && !callTarget && !emailMode;/);
  });

  /* ── THE SAFETY PROPERTY, AND IT IS THE ONE THAT MATTERS MOST ──────────────────────
     v2.99.57/M48: arriving on a URL must never perform the act the URL describes. There
     it was `?to=` placing a CALL on one click; here it would be a link making somebody a
     member of a group with no gesture. This screen may only mint an identity — the join
     itself is a second, deliberate tap on the screen after it. */
  it("does not join, or move toward joining, on arrival", () => {
    for (const forbidden of [
      "acceptGroupInvite",
      "groupInvitePreview",
      "joinByInvite",
    ]) {
      expect(
        GATE_CODE,
        `the pre-identity landing must not call ${forbidden}`,
      ).not.toContain(forbidden);
    }
    // No auto-submit: the only thing that starts an identity is the form's own submit.
    expect(GATE_CODE).not.toMatch(/useEffect\([^)]*startGuest/);
  });

  it("renders the frame's own furniture", () => {
    // 74px group puck — the SHARED GroupAvatar, not a fourth private copy of the
    // group-photo fallback (v2.106.89 consolidated three of those).
    expect(GATE_CODE).toMatch(/<GroupAvatar\b[\s\S]{0,140}size=\{74\}/);
    expect(GATE_CODE).toMatch(/from "\.\/GroupAvatar"/);
    // The eyebrow, the heading and the frame's display-name note.
    expect(GATE).toMatch(/You are invited to join/i);
    expect(GATE).toMatch(/you'll pick a display name first/i);
  });

  it("the join CTA is the board's accent recipe, never the raw accent as text", () => {
    /* `.rcta` is solid `--rb` with the board's `#04211a` on-accent text, which stays
       legible across all twelve hues. The raw accent AS TEXT measures ~1.7:1 on a light
       card, which is why the recipe exists at all (v2.106.31). */
    const cta = /className="rcta[^"]*"/.exec(GATE_CODE);
    expect(cta, "the group CTA lost the .rcta recipe").toBeTruthy();
    // And the recipe is real, not a class name nobody defines.
    expect(read("client/src/index.css")).toMatch(/\.relay-v2 \.rcta\s*\{/);
    // No raw accent variable in a colour position anywhere in this file.
    expect(GATE_CODE).not.toMatch(/color:\s*var\(--rb/);
    expect(GATE_CODE).not.toMatch(/text-\[var\(--rb/);
  });

  it("uses logical properties, so the card mirrors in Arabic", () => {
    /* The app renders Arabic and this screen carries the language switch, so it is the
       LAST place a physical side should appear. The standing sweep covers the whole file;
       this pins the property at the point of change. */
    expect(GATE_CODE).not.toMatch(/(?<![\w-])(?:pl|pr|ml|mr)-(?:\[|\d|px|auto)/);
    expect(GATE_CODE).not.toMatch(/(?<![\w-])text-(?:left|right)(?![\w-])/);
  });
});

/**
 * ── THE END-TO-END CHIP IS DECLINED, AND THE REASON IS PINNED SO IT STAYS DECLINED ────
 *
 * The frame draws "END-TO-END ENCRYPTED GROUP". This app cannot keep that promise, and
 * v2.106.40 already declined the identical chip on board 1d rather than restyle it. The
 * test asserts the REASON as well as the absence — a bare "no E2E string here" pin would
 * go quiet the day somebody adds real encryption, and would say nothing about why.
 */
describe("board 4h — the encryption claim the app can actually keep", () => {
  it("the app is provably NOT end-to-end encrypted for messages", () => {
    // The body is stored as plain text…
    expect(read("drizzle/schema.ts")).toMatch(/body:\s*text\("body"\)/);
    // …and the SERVER substring-searches it, which is only possible on plaintext it reads.
    expect(read("server/v2db.ts")).toMatch(/like\(messages\.body/);
  });

  it("the landing makes no end-to-end claim", () => {
    expect(GATE_CODE).not.toMatch(/end-to-end/i);
    expect(GATE_CODE).not.toMatch(/END-TO-END ENCRYPTED GROUP/i);
  });

  it("it reuses the honest wording v2.106.40 established, rather than a second one", () => {
    // Two independently-written encryption sentences is how two screens come to promise
    // different things; this reads the key the other surface already renders.
    expect(GATE_CODE).toMatch(/t\("msg\.encryptedInTransit"\)/);
    const dict = read("client/src/app/dict/messages.ts");
    expect(dict).toMatch(/"msg\.encryptedInTransit"/);
    // The key's English is an IN-TRANSIT claim, not an end-to-end one.
    const en = /"msg\.encryptedInTransit":\s*\{[\s\S]{0,200}?en:\s*"([^"]+)"/.exec(dict);
    expect(en, "msg.encryptedInTransit lost its English half").toBeTruthy();
    expect(en![1]).toMatch(/in transit/i);
    expect(en![1]).not.toMatch(/end-to-end/i);
  });
});

/**
 * ── THE REFUSED STATE (a registered-only link opened by a guest) ──────────────────────
 *
 * It EXISTS, it is SERVER-DRIVEN, and it is rendered ONCE — in `GroupInvite.tsx`, which
 * is the half of frame 4h that runs after an identity exists. It cannot move onto this
 * pre-identity landing: the verdict comes from `groupInvitePreview`, which requires an
 * identity by design, and guessing the audience client-side from the token would be a
 * second implementation of a rule whose authority is a signature this client cannot
 * verify — the exact class that shipped two production defects (v2.99.71, v2.105.11).
 *
 * So these pin BOTH sides: the refusal really is rendered where it belongs, and this
 * screen does not duplicate or pre-empt it — while still carrying the one ACTIONABLE
 * part of the frame's refused band, the registered door, at the only point where taking
 * it still avoids the dead end.
 */
describe("board 4h — the refused state", () => {
  const JOIN = codeOnly(read("client/src/pages/GroupInvite.tsx"));

  it("is rendered, from the server's own verdict", () => {
    // The server decides admission and reports it; the screen branches on that field.
    expect(read("server/v2routers.ts")).toMatch(/admitted:\s*alreadyMember \|\| inviteAudienceAdmits/);
    expect(JOIN).toMatch(/g\.admitted\s*\?/);
    expect(JOIN).toMatch(/g\.audience === "registered"/);
  });

  it("names the requirement and offers a way out, rather than a dead control", () => {
    // A refused guest is told what is needed and routed to the screen that fixes it.
    expect(JOIN).toMatch(/registered accounts/i);
    expect(JOIN).toMatch(/\/app\/profile/);
    // The Join button is REPLACED, not disabled — no control that looks live and refuses.
    expect(JOIN).not.toMatch(/disabled=\{!g\.admitted\}/);
  });

  it("the pre-identity landing does not guess the audience", () => {
    /* It holds the token, so it COULD read the audience segment — and must not. The
       token's meaning is established by a MAC this client cannot check, so a client-side
       reading is a confident answer that goes silently wrong the day the format moves. */
    expect(GATE_CODE).not.toMatch(/\baudience\b/);
    expect(GATE_CODE).not.toMatch(/groupToken\.split\(/);
    expect(GATE_CODE).not.toMatch(/registered-only/i);
  });

  it("offers the registered door BEFORE a guest identity is minted", () => {
    /* This is the actionable half of the frame's refused band, delivered at the only
       point where it still prevents the dead end: after this tap a guest identity
       already exists, and a registered-only link will refuse it. */
    const card = GATE_CODE.slice(GATE_CODE.indexOf("showGroupJoin ? ("));
    expect(card.length, "the group card slice collapsed").toBeGreaterThan(400);
    const end = card.indexOf("\n        ) : (");
    const scoped = end > 0 ? card.slice(0, end) : card;
    expect(scoped, "the group card slice ran past its own branch").not.toContain("gate.tagline");
    expect(scoped).toMatch(/setEmailMode\(true\)/);
    expect(scoped).toMatch(/t\("gate\.haveAccount"\)/);
  });

  it("the registered door really reaches the account flow", () => {
    // `emailMode` un-gates the group card, and the early return then hands over to the
    // sign-in screen — so the door is not a button that sets a flag nobody reads.
    expect(GATE_CODE).toMatch(/!emailMode/);
    expect(GATE_CODE).toMatch(/if \(!showJoin && !showGroupJoin\) return <LoginScreen/);
  });
});
