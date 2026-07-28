/**
 * v2.99.95 — the presence LED stops reporting the VIEWER on somebody else's face.
 *
 * THE BUG, reported by the owner three times: a person shows a green "online" LED in
 * Call History while Contacts and every other surface show them grey. Their last
 * screenshot contains the proof of the mechanism: the one row with a green dot reads
 * "Incoming", and the two rows with grey dots read "Outgoing".
 *
 * WHY THAT PAIRING IS THE SMOKING GUN. There is exactly ONE shared
 * `conference_history` row per call room, and the CALLER seeds `dialedNumber` with the
 * number they dialled. So on the RECIPIENT'S screen `dialedNumber` holds the
 * recipient's own number — and the LED was keyed on `dialedNumber` FIRST, with the
 * peer only as a fallback. An answered incoming call therefore asked for the viewer's
 * own presence, which is online by definition while they are looking at the screen,
 * and painted it on the caller's avatar. Outgoing rows were correct because there
 * `dialedNumber` really is the peer.
 *
 * The rule is tested BEHAVIOURALLY against a row shaped like that screenshot, because
 * a source pin cannot tell you which number a row ends up asking about.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { conferenceRowKeys } from "./History";
import { codeOnly } from "../../../../server/testing/codeOnly";

const HISTORY = readFileSync(new URL("./History.tsx", import.meta.url), "utf8");
const GROUPCALL = readFileSync(new URL("./GroupCallScreen.tsx", import.meta.url), "utf8");


const ME = "777777";
const PEER = "805555";

/** The owner's screenshot: an answered INCOMING 1:1. dialedNumber is the VIEWER. */
const incoming = {
  dialedNumber: ME,
  partyCount: 2,
  participants: [
    { number: PEER, isSelf: false },
    { number: ME, isSelf: true },
  ],
};

/** The mirror case: an answered OUTGOING 1:1. dialedNumber is the PEER. */
const outgoing = {
  dialedNumber: PEER,
  partyCount: 2,
  participants: [
    { number: ME, isSelf: true },
    { number: PEER, isSelf: false },
  ],
};

describe("which number a conference row is about", () => {
  it("an INCOMING answered call resolves to the PEER, never to the viewer", () => {
    // THE BUG. Before this release the answer here was ME — the viewer's own number
    // — so the LED could only ever be green.
    const k = conferenceRowKeys(incoming);
    expect(k.peerNumber).toBe(PEER);
    expect(k.peerNumber).not.toBe(ME);
  });

  it("an OUTGOING answered call resolves to the peer too — the correct case stays correct", () => {
    expect(conferenceRowKeys(outgoing).peerNumber).toBe(PEER);
  });

  it("the CALL-BACK target is the peer as well, so an incoming row cannot self-dial", () => {
    // Same wrong key, second symptom: Message / Video / Call on an incoming answered
    // row targeted the viewer's own number, which the signaling layer refuses with
    // error{self} — a button that silently does nothing.
    expect(conferenceRowKeys(incoming).callBack).toBe(PEER);
    expect(conferenceRowKeys(outgoing).callBack).toBe(PEER);
  });

  it("a PARTY LINE keeps dialedNumber, because there it is the LINE and not a person", () => {
    // Redialling a line's own number rejoins the room without ringing anybody
    // (v2.89). Taking dialedNumber away here would break rejoining a line.
    const line = {
      partyLine: true,
      dialedNumber: "500500",
      partyCount: 3,
      participants: [
        { number: ME, isSelf: true },
        { number: PEER, isSelf: false },
        { number: "601586", isSelf: false },
      ],
    };
    expect(conferenceRowKeys(line).callBack).toBe("500500");
  });

  it("falls back to dialedNumber only when there is NO peer in the roster", () => {
    // A room nobody else ever joined. Answering "" would lose the only number we have.
    const alone = { dialedNumber: PEER, partyCount: 1, participants: [{ number: ME, isSelf: true }] };
    expect(conferenceRowKeys(alone).peerNumber).toBe("");
    expect(conferenceRowKeys(alone).callBack).toBe(PEER);
  });

  it("knows a group from a 1:1, by party count OR by roster size", () => {
    expect(conferenceRowKeys(incoming).isGroup).toBe(false);
    expect(
      conferenceRowKeys({ ...incoming, partyCount: 3 }).isGroup
    ).toBe(true);
    expect(
      conferenceRowKeys({
        dialedNumber: PEER,
        partyCount: 2,
        participants: [
          { number: ME, isSelf: true },
          { number: PEER, isSelf: false },
          { number: "601586", isSelf: false },
        ],
      }).isGroup
    ).toBe(true);
  });

  it("never returns the viewer among the other parties", () => {
    expect(conferenceRowKeys(incoming).otherNumbers).toEqual([PEER]);
  });
});

describe("the LED can no longer be keyed off dialedNumber", () => {
  it("dialedNumber never reaches a presence lookup", () => {
    // The structural half of the fix: even if somebody re-adds a presence call site,
    // it cannot be handed dialedNumber, because the sets are reached only through
    // `presenceOf` and the row resolves its own key.
    const code = codeOnly(HISTORY);
    expect(code).not.toMatch(/onlineSet\.has\([^)]*dialedNumber/);
    expect(code).not.toMatch(/inCallSet\.has\([^)]*dialedNumber/);
    expect(code).not.toMatch(/idleSet\.has\([^)]*dialedNumber/);
  });

  it("the viewer's OWN number is never put into the presence batch", () => {
    // We are online by definition while looking at this screen, so a self entry can
    // only come back green — and it would also make the busy set probe
    // directory.liveRoom for our own number.
    const code = codeOnly(HISTORY);
    const fn = code.slice(code.indexOf("const presenceNumbers = useMemo"));
    const body = fn.slice(0, fn.indexOf("}, [items"));
    expect(body.length).toBeGreaterThan(100);
    expect(body).toMatch(/n !== self/);
    // And dialedNumber is no longer added to the batch at all.
    expect(body).not.toMatch(/dialedNumber/);
  });

  it("presence reaches the rows as ONE lookup, not as pre-resolved booleans", () => {
    // The call site cannot safely decide which number a row is about — that is the
    // whole bug — so it no longer tries.
    // COUNTED, not merely present: a bare `toMatch` was satisfied by one row kind
    // while the other had been cut off from presence entirely (found by the mutation
    // run). Counted against the number of ROW MOUNTS rather than a fixed number, so
    // adding a view — v2.99.98's grouped list added two more mounts — cannot make
    // this stale, and cannot let a new mount go without presence either.
    const mounts =
      (HISTORY.match(/<ConferenceItem\b/g)?.length ?? 0) + (HISTORY.match(/<SoloItem\b/g)?.length ?? 0);
    expect(mounts).toBeGreaterThanOrEqual(2);
    expect(HISTORY.match(/presenceOf=\{presenceOf\}/g)?.length).toBe(mounts);
    const code = codeOnly(HISTORY);
    expect(code).not.toMatch(/presenceOf=\{undefined\}/);
    expect(code).not.toMatch(/online=\{presence\.data/);
    expect(code).not.toMatch(/inCall=\{inCallSet\.has/);
  });

  it("a GROUP row draws no presence LED at all", () => {
    // N people do not have one presence; showing an arbitrary member's as the
    // group's is a guess presented as a fact.
    expect(HISTORY).toMatch(/const rowPresence = isGroup \? undefined : presenceOf\?\.\(peerNumber\)/);
  });
});

describe("one LED rule, everywhere", () => {
  it("History's LED defers to presenceDot instead of its own ternary", () => {
    expect(HISTORY).toMatch(/import \{ presenceDot \} from "@\/app\/presenceDot"/);
    expect(HISTORY).toMatch(/const dot = presenceDot\(p\)/);
    // …and the verdict is actually APPLIED. Calling the rule and then painting a
    // hand-rolled colour anyway passed the assertions above — caught by the mutation
    // run, and the same declaration-versus-use trap this repo keeps finding.
    expect(HISTORY).toMatch(/background: dot\.color/);
    expect(HISTORY).toMatch(/boxShadow: dot\.glow/);
    expect(HISTORY).toMatch(/aria-label=\{dot\.label\}/);
    // The old hand-rolled colour branch is gone — not merely supplemented.
    const code = codeOnly(HISTORY);
    expect(code).not.toMatch(/\? "bg-amber-400"/);
    expect(code).not.toMatch(/bg-\[color:var\(--relay-offline\)\]/);
    expect(code).not.toMatch(/p\.isOnline \? "var\(--relay-online\)"/);
  });

  it("History learned the IDLE state, which it used to throw away", () => {
    // directory.presenceMany has carried `idle` since v2.99.92 and this screen
    // ignored it, so a backgrounded person read as full-strength green here while
    // Contacts said "away" — one person, two answers.
    expect(HISTORY).toMatch(/const idleSet = useMemo/);
    expect(HISTORY).toMatch(/idle: idleSet\.has\(n\)/);
  });

  it("the group-call picker defers to it too — the last inline copy is gone", () => {
    expect(GROUPCALL).toMatch(/import \{ presenceDot \} from "@\/app\/presenceDot"/);
    expect(GROUPCALL).toMatch(/presenceDot\(\{ isOnline: c\.isOnline, idle: c\.idle \}\)/);
    const code = codeOnly(GROUPCALL);
    expect(code).not.toMatch(/c\.isOnline\s*\n?\s*\? "bg-\[color:var\(--relay-online\)\]"/);
  });

  it("no surface hand-rolls a presence colour any more", () => {
    // The standing guard: every dot must come from the shared rule, or two surfaces
    // will disagree about one person again (v2.99.77, v2.99.95).
    for (const [name, src] of [
      ["History.tsx", HISTORY],
      ["GroupCallScreen.tsx", GROUPCALL],
    ] as const) {
      const code = codeOnly(src);
      expect(code, `${name} still branches on isOnline for a colour`).not.toMatch(
        /isOnline[\s\S]{0,40}\?\s*"bg-\[color:var\(--relay-online/
      );
    }
  });
});

describe("the story you cannot delete", () => {
  const OVERLAYS = readFileSync(new URL("../../app/PeerOverlays.tsx", import.meta.url), "utf8");

  it("a synthesised group DERIVES whether the story is mine", () => {
    // v2.99.86 started routing the top bar's "See my status" through
    // openPeerStatus(me.number). When the cached feed missed, this host synthesised a
    // group with `isMe: false` HARDCODED — so your own story rendered with no Viewers
    // list, no audience chip and, the reported symptom, NO DELETE ROW.
    expect(OVERLAYS).toMatch(/isMe: !!me\?\.number && me\.number === statusNumber/);
    const code = codeOnly(OVERLAYS);
    expect(code).not.toMatch(/isMe: false/);
  });

  it("it knows who we are, so the derivation is possible at all", () => {
    expect(OVERLAYS).toMatch(/const \{ me \} = useIdentity\(\)/);
  });
});
