/**
 * v2.107.73 — group-call name, RECEIVER side.
 *
 * v2.107.68 gave the CALLER the dialed group's title in the call header; the
 * callee still saw only the caller's name. This closes the loop: every invite
 * of a NAMED group dial carries `groupName`, the server sanitizes and relays it
 * on the ring (live, late-delivered, and the wake-up push alike), and the
 * callee's ring card leads with the group's title — caller demoted to the sub
 * line, identity verification (pin/flag/photo) staying the caller's — with the
 * in-call header matching after accept.
 *
 * THE 1:1 INVARIANT is the safety story: a dial with no group name must emit
 * invites, rings and pending records BYTE-IDENTICAL to pre-2.107.73 — which is
 * why every addition is a conditional spread, pinned below.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const CLIENT = readFileSync(resolve(root, "client/src/lib/relayClient.ts"), "utf8");
const RELAY = readFileSync(resolve(root, "server/relay.ts"), "utf8");
const CORE = readFileSync(resolve(root, "server/_core/index.ts"), "utf8");

describe("caller → server: the invite carries the group's title (and ONLY then)", () => {
  it("one helper decides, and it fails to the empty object for 1:1 / ad-hoc", () => {
    expect(CLIENT).toMatch(
      /function inviteGroupExtras\(\): \{ groupName\?: string \} \{\s*\n\s*return callGroupName \? \{ groupName: callGroupName \} : \{\};\s*\n\s*\}/,
    );
  });

  it("EVERY invite send spreads it — seven sites, none forgotten", () => {
    /* Group dials send invites from seven places: the first target (with
       `parties`), the fan-out loop, the sequential next, the mid-call queue
       drain, the mid-call ADD-PERSON pad, and both single-dial paths. A missed
       site is a callee who rings nameless — the add pad was nearly one. */
    const singleLine = CLIENT.match(/sendWS\(\{ type: "invite",[^\n]*/g) || [];
    expect(singleLine.length).toBe(6);
    for (const s of singleLine) {
      expect(s, s).toContain("...inviteGroupExtras()");
    }
    // The seventh spans lines (the parties-carrying room creator):
    expect(CLIENT).toMatch(
      /type: "invite", to: first, video: camOn, parties: clean\.length \+ 1, \.\.\.inviteGroupExtras\(\),/,
    );
    expect((CLIENT.match(/\.\.\.inviteGroupExtras\(\)/g) || []).length).toBe(7);
  });

  it("the wire type declares it on Msg, next to fromName", () => {
    expect(CLIENT).toMatch(/fromName\?: string;[\s\S]{0,220}groupName\?: string;/);
  });
});

describe("server: sanitize once, then relay to ring, page, pending and late delivery", () => {
  it("caller-supplied text is sanitized: string-only, control chars stripped, capped at 64", () => {
    expect(RELAY).toMatch(
      /typeof rawGroupName === "string"\s*\n\s*\? rawGroupName\.replace\(\/\[\\u0000-\\u001f\\u007f\]\/g, ""\)\.trim\(\)\.slice\(0, 64\)\s*\n\s*: ""/,
    );
  });

  it("the LIVE ring includes it — as a conditional spread, so 1:1 stays byte-identical", () => {
    const ring = RELAY.slice(RELAY.indexOf("const ringMsg = {"));
    expect(ring.slice(0, 500)).toMatch(/\.\.\.\(groupName \? \{ groupName \} : \{\}\),/);
  });

  it("BOTH pendingRings.set sites carry it, so a re-registering device is rung with the same title", () => {
    const hits = RELAY.match(/pendingRings\.set\(to, \{[\s\S]{0,900}?\}\);/g) || [];
    expect(hits.length).toBe(2);
    for (const h of hits) {
      expect(h, h.slice(0, 80)).toMatch(/\.\.\.\(groupName \? \{ groupName \} : \{\}\),?/);
    }
    expect(RELAY).toMatch(/groupName\?: string;[\s\S]{0,1200}pushed\?: boolean;/);
  });

  it("deliverPendingRing re-sends it from the stored record", () => {
    const fn = RELAY.slice(
      RELAY.indexOf("export function deliverPendingRing"),
      RELAY.indexOf("/** Record/refresh a participant"),
    );
    expect(fn).toMatch(/\.\.\.\(pr\.groupName \? \{ groupName: pr\.groupName \} : \{\}\),/);
  });

  it("the page hook is told, and the wake-up push titles the group like the ring card will", () => {
    expect(RELAY).toMatch(
      /onPageCallee\(\{ calleePin: to, callerPin, callerName: me\.name, \.\.\.\(groupName \? \{ groupName \} : \{\}\), roomId: pagingRoom, video: wantVideo \}\)/,
    );
    // The hook's TYPE declares it, so a wiring that drops it fails to compile.
    expect(RELAY).toMatch(/export type PageCalleeHook[\s\S]{0,400}groupName\?: string;/);
    expect(CORE).toMatch(
      /title: `\$\{info\.groupName \? info\.groupName \+ " — " : ""\}\$\{info\.callerName \|\| "Someone"\} is calling`/,
    );
  });
});

describe("callee: the ring leads with the group, the caller stays verifiable", () => {
  it("pendingRing and waitingRing both capture the title", () => {
    expect(CLIENT).toMatch(
      /pendingRing = \{ from: m\.from!, fromName: m\.fromName!, roomId: m\.roomId!, video: !!m\.video, at: Date\.now\(\), groupName: m\.groupName \}/,
    );
    expect(CLIENT).toMatch(
      /waitingRing = \{ from: m\.from!, fromName: m\.fromName!, roomId: m\.roomId!, flag: m\.flag, video: !!m\.video, at: Date\.now\(\), groupName: m\.groupName \}/,
    );
    expect(CLIENT).toMatch(/interface PendingRing \{[^\n]*groupName\?: string; \}/);
  });

  it("ringWho shows the group's title when present, the caller's name otherwise", () => {
    expect(CLIENT).toMatch(/ringWho\.textContent = m\.groupName \|\| m\.fromName!/);
  });

  it("the caller moves to the SUB line — never erased, because the callee must know who", () => {
    expect(CLIENT).toMatch(
      /ringSub\.textContent = \(m\.groupName \? \(m\.fromName \|\| nameOf\(m\.from!\)\) \+ " · " : ""\) \+ \(m\.video \? "Video call…" : "Voice call…"\)/,
    );
  });

  it("identity verification stays the CALLER's: pin, flag and photo untouched by the title", () => {
    /* The group's name is caller-supplied text; the pin/flag/photo triplet is
       the thing the callee can actually verify. It must keep describing the
       human, not the room. */
    expect(CLIENT).toMatch(/ringPin\.textContent = m\.from && m\.from\.length === 6/);
    expect(CLIENT).toMatch(/ringFlag\.textContent = m\.flag \|\| ""/);
    expect(CLIENT).toMatch(/presentRingProfile\(m\.from!\)/);
    expect(CLIENT).toMatch(/ringAv\.textContent = initials\(m\.fromName!\)/);
  });

  it("the busy-path waiting card and the out-of-tab notification lead with it too", () => {
    expect(CLIENT).toMatch(
      /showCallWaiting\(\(m\.groupName \? m\.groupName \+ " · " : ""\) \+ \(m\.fromName \|\| nameOf\(m\.from!\)\)/,
    );
    expect(CLIENT).toMatch(/\$\{m\.groupName \? m\.groupName \+ " — " : ""\}\$\{m\.fromName \|\| m\.from \|\| "Someone"\}/);
  });

  it("accepting adopts the title into the in-call header — the caller-side slot (v2.107.68)", () => {
    expect(CLIENT).toMatch(/callGroupName = r\.groupName \?\? null;\s*\n\s*inCall = true; roomId = r\.roomId; enterCallUI\("In call"\)/);
    // …and the shared per-call reset still clears it, so the NEXT 1:1 dial
    // cannot leak a stale group title into its invites.
    expect(CLIENT).toMatch(/callIsGroup = false; callGroupName = null;/);
  });
});
