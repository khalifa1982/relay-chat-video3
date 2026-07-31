/**
 * PRESENCE STOPS BLOCKING CALLS — REACHABILITY DECIDES.
 *
 * THE PROBLEM, measured in production rather than inferred: `presence` is bound to a
 * live SOCKET SESSION (`presence.socketSessionId`), so backgrounding the app, locking
 * the phone or closing the tab drops it — `socketSessionId` goes NULL and `isOnline`
 * becomes 0. Nearly every row in production reads `isOnline: 0` at any moment, so a
 * gate keyed on presence refused calls to most of the user base most of the time.
 *
 * AND IT WAS GUARDING A LIMITATION THAT NO LONGER EXISTS. A VoIP push was sent from
 * the app server to a physical device: APNs returned HTTP 200 and the handset rendered
 * the full-screen CallKit incoming-call UI with the app not in the foreground. A
 * backgrounded phone is exactly what that wakes.
 *
 * THE SHARPEST TRAP IN THIS CHANGE, and the reason `canRingIdentity` exists at all:
 * the obvious move is to reuse `hasPushSubscription`, and that would have broken the
 * one device the whole feature is for. That function filters to
 * `('webpush','fcm','expo')` and EXCLUDES both APNs kinds deliberately (v2.105.11/12)
 * — its only consumer asks "did they already get a NOTIFICATION, so is an email
 * redundant", and a VoIP push carries no `aps.alert`, so it is not a notification.
 * Reusing it would have reported the verified CallKit iPhone as unreachable and gone
 * on refusing calls to it. Two questions, two predicates.
 *
 * The parts that are pure are DRIVEN; the wire shape and the two client gates are
 * pinned, because there is no MySQL here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly } from "./testing/codeOnly";

const V2DB = readFileSync("server/v2db.ts", "utf8");
const ROUTERS = readFileSync("server/v2routers.ts", "utf8");
const GATE = readFileSync("client/src/app/OnboardingGate.tsx", "utf8");
const JOIN = readFileSync("client/src/pages/app/Join.tsx", "utf8");

/** A named function's body, brace-matched from the brace reached with parens and
 *  angles closed — so a destructured parameter or a `Promise<{…}>` return type cannot
 *  be mistaken for the body (the v2.105.9 / v2.105.27 trap). */
function fnBody(src: string, name: string): string {
  const at = src.search(new RegExp(`function\\s+${name}\\b`));
  expect(at, `${name} must exist`).toBeGreaterThanOrEqual(0);
  let i = at, paren = 0, angle = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "<") angle++;
    else if (c === ">") angle--;
    else if (c === "{" && paren === 0 && angle <= 0) break;
  }
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  const body = src.slice(start, i + 1);
  expect(body.length, `${name}'s body must be a real slice`).toBeGreaterThan(40);
  return body;
}

describe("canRingIdentity is NOT hasPushSubscription — the trap that would break CallKit", () => {
  const ring = fnBody(V2DB, "canRingIdentity");
  const msg = fnBody(V2DB, "hasPushSubscription");

  it("the ring predicate accepts BOTH APNs kinds", () => {
    /* `apns-voip` is the only thing that renders full-screen CallKit on a locked
       iPhone and is the best ring target in the fleet; `apns` is a standard alert.
       Excluding either would refuse calls to the devices most able to receive them. */
    for (const k of ["'apns-voip'", "'apns'", "'webpush'", "'fcm'", "'expo'"]) {
      expect(ring, `ring predicate is missing ${k}`).toContain(k);
    }
  });

  it("the MESSAGE predicate still excludes them, and that is deliberate", () => {
    /* Not a copy-paste oversight to fix: `hasPushSubscription` backs the
       offline-message email's "they already got a notification" decision, and a VoIP
       push is not a notification. Counting APNs there would leave the recipient with
       NEITHER a push nor an email — strictly worse. The two must stay different. */
    expect(msg).not.toContain("'apns-voip'");
    expect(msg).not.toContain("'apns'");
    expect(msg).toContain("'webpush'");
  });

  it("they are genuinely two different predicates, not one aliased", () => {
    // A future "simplification" that makes one call the other reintroduces the trap
    // in whichever direction it collapses.
    expect(ring).not.toMatch(/hasPushSubscription/);
    expect(msg).not.toMatch(/canRingIdentity/);
  });

  it("the ring predicate FAILS OPEN, because it decides whether to OFFER a call", () => {
    /* Failing shut would hide the call button because a query hiccuped — which is the
       bug being removed. Failing open offers the call and lets the dial report the
       truth, the same rule v2.99.17 gave the dialer's own `nonexistent` check. */
    expect(ring).toMatch(/catch\s*\{\s*return true;?\s*\}/);
    expect(ring).toMatch(/if \(!db\) return true;/);
  });

  it("it does NOT consult the user's push switch", () => {
    /* That switch silences notifications; this asks whether a device exists to ring at
       all, and the switch is enforced inside `sendPushToIdentity` where every transport
       fans out. Deciding it in two places is how the two answers come to disagree. */
    expect(ring).not.toMatch(/pushEnabled/);
  });

  it("it reads only the subscription table, and writes nothing", () => {
    expect(ring).toMatch(/from\(pushSubscriptions\)/);
    for (const w of [".insert(", ".update(", ".delete("]) {
      expect(ring, `ring predicate must not ${w}`).not.toContain(w);
    }
    // A callee's tokens are looked up by identity only — no claimHash/ownership rule
    // is weakened, and no token value is selected.
    expect(ring).toMatch(/select\(\{ id: pushSubscriptions\.id \}\)/);
    expect(ring).not.toMatch(/endpoint|p256dh|auth\b|claimHash/);
  });
});

describe("the wire: reachable rides ALONGSIDE presence", () => {
  it("directory.lookup emits `reachable` for a person", () => {
    expect(ROUTERS).toMatch(/const reachable = \(pres\?\.isOnline \?\? false\) \|\| \(await canRingIdentity\(id\.id\)\)/);
    expect(ROUTERS).toMatch(/\n\s+reachable,\n/);
  });

  it("a live socket short-circuits the push lookup", () => {
    /* `||` order is load-bearing for cost, not just for correctness: for the common
       case — somebody with the app open — this must not spend a query. And it is the
       owner's own rule that a live socket takes the socket path. */
    const m = ROUTERS.match(/const reachable = [^;]+;/);
    expect(m).toBeTruthy();
    expect(m![0].indexOf("isOnline")).toBeLessThan(m![0].indexOf("canRingIdentity"));
  });

  it("a party line is always reachable", () => {
    // Joining a line rings nobody — you land on the room — so an EMPTY line must stay
    // joinable. Deriving it from occupancy would make an empty line uncallable, which
    // is the opposite of what a party line is for.
    expect(ROUTERS).toMatch(/partyLine: true,[\s\S]{0,400}?reachable: true,/);
  });

  it("presence is still emitted, and still suppressed for a stale guest", () => {
    // "Do not remove presence tracking" — it remains correct for showing status and
    // for choosing the socket path. The v2.95 privacy suppression is untouched.
    expect(ROUTERS).toMatch(/isOnline: hidden \? false : \(pres\?\.isOnline \?\? false\)/);
    expect(ROUTERS).toMatch(/idle: hidden \? false : \(pres\?\.idle \?\? false\)/);
    expect(ROUTERS).toMatch(/presenceHidden: hidden,/);
  });

  it("reachability is NOT suppressed with presence, and that is deliberate", () => {
    /* The privacy rule hides whether somebody is online RIGHT NOW. Reachability says
       only that a call could reach a device. Withholding it would refuse calls to
       exactly the long-inactive guests the suppression protects — the bug, not the
       privacy. Nothing new is disclosed: this endpoint already returns their name,
       avatar, badge and tier for any number. */
    expect(ROUTERS).not.toMatch(/reachable: hidden \?/);
  });
});

/* The two halves of the invite-join card. They are separate components — one for a
   visitor with no identity, one for somebody signed in — and each declares its own
   flags, which is exactly how one of them comes to be left behind (the v2.99.15
   symptom). Every assertion below runs against BOTH, and the identifiers are named
   rather than pattern-guessed: `joinBlocked` contains `Blocked`, not `blocked`, so a
   loose substring anchor silently fails on correct code (it did, first run). */
const SCREENS = [
  {
    name: "OnboardingGate (guest)",
    src: GATE,
    flag: "calleeUnreachable",
    block: "joinBlocked",
    missing: "numberNotFound",
    line: "isPartyLine",
  },
  {
    name: "Join (signed in)",
    src: JOIN,
    flag: "unreachable",
    block: "blocked",
    missing: "notFound",
    line: "isLine",
  },
] as const;

describe("both client gates key on reachability, and neither on presence", () => {
  for (const s of SCREENS) {
    /** The flag's own initialiser, comments stripped — so a comment ABOUT presence
     *  can never satisfy an assertion about the code (the recurring prose trap). */
    const init = (name: string) => {
      const m = codeOnly(s.src).match(new RegExp(`const ${name} =[^;]*`));
      expect(m, `${s.name}: no ${name} declaration`).toBeTruthy();
      return m![0];
    };

    it(`${s.name}: the block is derived from reachable, never from isOnline`, () => {
      const decl = init(s.flag);
      expect(decl).toMatch(/reachable/);
      expect(decl, `${s.name}: still gates on presence`).not.toMatch(/isOnline/);
    });

    it(`${s.name}: fails OPEN when the field is absent`, () => {
      // A rolling deploy serves both bundles for ~60s; refusing on a missing field
      // would turn that window into a calling outage.
      expect(init(s.flag)).toMatch(/reachable \?\? true/);
    });

    it(`${s.name}: a party line is exempt from the block`, () => {
      // Joining a line rings nobody, so an empty line must stay joinable.
      expect(init(s.flag)).toContain(`!${s.line}`);
    });

    it(`${s.name}: the honest guard survives — nothing to ring still blocks`, () => {
      // The one guard that must remain: a call that can wake nothing must not be
      // offered, because a guest has no thread to leave a message on. Both halves of
      // it are required, so dropping either the no-such-number case or the
      // nothing-to-ring case is caught.
      const decl = init(s.block);
      expect(decl, `${s.name}: lost the no-such-number guard`).toContain(s.missing);
      expect(decl, `${s.name}: lost the nothing-to-ring guard`).toContain(s.flag);
    });

    it(`${s.name}: the block actually disables the join control`, () => {
      // Computing the flag and then not reading it is the silent-no-op shape: the
      // card would offer a call it knows cannot connect.
      expect(codeOnly(s.src)).toMatch(new RegExp(`disabled=\\{[^}]*${s.block}`));
    });

    it(`${s.name}: the copy no longer promises "back online"`, () => {
      // For the state that remains, coming online is not what would change it — there
      // is no device to come online. Read on comment-stripped source, because the
      // comment explaining the change legitimately contains the old phrase.
      const code = codeOnly(s.src);
      expect(code).not.toMatch(/back online/i);
      expect(code).toMatch(/no device we can ring/);
    });
  }
});

describe("the ring-timeout ladder, which is already push-aware", () => {
  /* The task asks whether a push-routed call needs a LONGER ring. Read against the
     code, the one number that would have to change does not: the callee's auto-decline
     is armed when their ring card is PRESENTED — including on the push-delivered path,
     where `deliverPendingRing` hands the ring over as the app opens — so a phone woken
     from a locked screen gets its full 60s from the moment the person sees the call,
     not from when the caller dialled.

     What the caller's 65s bounds is how long they stare at the card, which is an
     ordinary ring length rather than a limitation of the push path. Raising it is a
     product decision about the caller's patience, so it is left alone and the LADDER
     is pinned instead, because the ordering is what makes the three honest. */
  const RELAY = readFileSync("server/relay.ts", "utf8");
  const CLIENT = readFileSync("client/src/lib/relayClient.ts", "utf8");

  it("callee auto-decline < caller backstop < server pending-ring TTL", () => {
    const serverTtl = Number(
      RELAY.match(/PENDING_RING_TTL_MS = ([\d_]+)/)![1].replace(/_/g, ""),
    );
    const callerBackstop = Number(
      CLIENT.match(/failDial\("No answer[^;]*;\s*\}, ([\d_]+)\)/)![1].replace(/_/g, ""),
    );
    const calleeDecline = Math.max(
      ...[...CLIENT.matchAll(/declineInvite\(\);\s*\}, ([\d_]+)\)/g)].map((m) =>
        Number(m[1].replace(/_/g, "")),
    ));

    // The callee gives up first, so the caller is TOLD "declined" rather than timing
    // out on nothing; the caller resolves before the server forgets the pending ring,
    // or they would ring on against a room the server has already stopped holding.
    expect(calleeDecline).toBeLessThan(callerBackstop);
    expect(callerBackstop).toBeLessThan(serverTtl);
  });

  it("the callee's clock is armed at PRESENTATION, so a pushed ring is not short-changed", () => {
    // Every arming site sits with the ring card being shown — never at dial.
    for (const m of CLIENT.matchAll(/ringTimeoutT = setTimeout\(/g)) {
      const before = CLIENT.slice(Math.max(0, m.index! - 400), m.index!);
      expect(before, "a ring timeout armed away from the ring card").toMatch(
        /emitPhase\("ringing"\)|ringOverlay/,
      );
    }
  });
});

describe("what the server already did, pinned so it cannot regress", () => {
  it("the relay pages only when a push actually landed", () => {
    /* This is the rule the task asks for and it shipped in v2.105.12 — it is pinned
       here rather than rebuilt. `pushed > 0` is what separates "we woke a device, so
       keep the dial open" from "nothing can be woken, so say so and offer a message". */
    const relay = readFileSync("server/relay.ts", "utf8");
    expect(relay).toMatch(/if \(\(info\.pushed \?\? 0\) > 0\)/);
    expect(relay).toMatch(/pendingRings\.set/);
  });

  it("the ring goes through the ONE funnel that enforces the push switch", () => {
    // A parallel ring sender would bypass the user's own master switch however
    // well-intentioned (v2.105.12).
    const core = readFileSync("server/_core/index.ts", "utf8");
    expect(core).toMatch(/sendPushToIdentity\(callee\.id, \{[\s\S]{0,80}kind: "incoming-call"/);
  });

  it("a blocked caller still cannot ring, and the refusal is indistinguishable", () => {
    /* E4 (v2.98.6): a blocked person waking a locked phone with a CallKit ring is the
       loudest possible form of what blocking closed. It reports `pushed: 0`, i.e. the
       same shape as an ordinary unreachable callee, so the reply is no oracle. */
    const core = codeOnly(readFileSync("server/_core/index.ts", "utf8"));
    expect(core).toMatch(/isNumberBlockedBy\(callee\.id, info\.callerPin\)/);
    expect(core).toMatch(/pushed: 0/);
  });
});
