import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { codeOnly } from "../../../../server/testing/codeOnly";
import { copyOnScreen } from "../../../../server/testing/copyOnScreen";
import { DICT } from "../../app/i18n";

/* ============================================================================
   BOARD 5b — REJOIN A LIVE CALL
   ============================================================================

   The frame is "History entry + host knock approval": a highlighted History row
   reading "Live now · 3 in the call · hosted by Layla" with a solid accent Join
   pill, plus the host's own Approve/Decline prompt.

   These pin PROPERTIES, not pixels. The three that carry real weight are:

     1. The card is on the ACCENT, not the presence green. That is a vocabulary
        rule the board states outright and this repo has now had to enforce six
        times (v2.99.86 DND, v2.106.9 speaking tile, v2.106.11 push banner,
        v2.106.18 waveform, v2.106.42 pin marker). Green means ONLINE; "a call
        is live" is an activity and Join is a CTA.

     2. The card never invents a fact `directory.liveRoom` does not return, and
        never claims a joining rule the server does not implement. The frame's
        own footnote is refused on exactly that ground — see the last describe.

     3. Every capability the shipped card had survives the restyle: it still
        knocks, still polls, still degrades to nothing off the signaling node.

   AUTHORIZATION IS NOT TOUCHED, and that is asserted rather than assumed:
   `liveRoomInfo` is gated on the requester having previously been in that room,
   which is what makes this endpoint safe to expose at all.
   ========================================================================== */

const ROOT = resolve(import.meta.dirname, "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const HISTORY_PATH = "client/src/pages/app/History.tsx";
const HISTORY_RAW = read(HISTORY_PATH);
const HISTORY = codeOnly(HISTORY_RAW);
const RELAY = read("server/relay.ts");
const ROUTER = read("server/v2routers.ts");
const CSS = read("client/src/index.css");

/**
 * A window bounded by its OWN end, never by a fixed character count.
 *
 * A stale anchor makes `indexOf` return -1, and `slice(-1 - 900)` is
 * `slice(-901)` — which silently reads the LAST 901 characters from the other
 * end of the file. That trap hid a broken pin for nineteen releases
 * (v2.106.20), so both anchors are asserted to exist and the window is asserted
 * long enough that a silent collapse to "" cannot pass vacuously.
 */
function region(src: string, startAnchor: string, endAnchor: string, minLen = 1): string {
  const a = src.indexOf(startAnchor);
  expect(a, `start anchor missing: ${startAnchor}`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(endAnchor, a + startAnchor.length);
  expect(b, `end anchor missing after start: ${endAnchor}`).toBeGreaterThan(a);
  const slice = src.slice(a, b);
  expect(slice.length, `window too short for ${startAnchor}`).toBeGreaterThanOrEqual(minLen);
  return slice;
}

/* The component's own body. Bounded by the file's end because `LiveRejoinCard`
   is the last declaration — asserted below, so if something is appended after
   it this window narrows rather than silently swallowing a neighbour. */
const CARD = region(HISTORY, "function LiveRejoinCard(", "\n}\n", 600);

describe("board 5b — the live-rejoin card exists and is the one this screen renders", () => {
  it("is still mounted from History, still polls liveRoom, and still knocks", () => {
    // The three capabilities `server/liveRejoin.test.ts` has pinned since
    // v2.99.9. Restated here because a RESTYLE is exactly the change that
    // silently drops one of them, and a card that no longer knocks is a Join
    // button that does nothing.
    expect(HISTORY).toMatch(/<LiveRejoinCard key=\{num\} number=\{num\}/);
    expect(CARD).toMatch(/trpc\.directory\.liveRoom\.useQuery/);
    expect(CARD).toMatch(/engine\.knock\(number\)/);
  });

  it("is the last declaration, so the window above cannot swallow a neighbour", () => {
    const at = HISTORY.indexOf("function LiveRejoinCard(");
    expect(HISTORY.slice(at + 1)).not.toMatch(/\nfunction [A-Za-z]/);
  });

  it("renders NOTHING when there is no live room", () => {
    // `liveRoom` returns null for a stranger's call, an ended call, and on any
    // instance that is not the signaling leader. A card that rendered a shell
    // in those cases would advertise a call that cannot be joined.
    expect(CARD).toMatch(/if \(!info\) return null/);
  });

  it("polls, because a call ends without telling this screen", () => {
    expect(CARD).toMatch(/refetchInterval: 15_000/);
    expect(CARD).toMatch(/refetchOnWindowFocus: true/);
  });
});

describe("board 5b — the card is on the ACCENT, because green means ONLINE", () => {
  it("carries no presence-green token at all", () => {
    // The whole point of the restyle. `--relay-online` is the LED hue; it was
    // the card's surface, its disc AND its Join fill, i.e. a presence colour
    // spent on an activity and a CTA.
    expect(CARD).not.toMatch(/relay-online/);
    expect(CARD).not.toMatch(/relay-green-text/);
  });

  it("tints the surface with --primary rather than a raw var(--rb)", () => {
    // `--primary` is repointed at the cycling accent inside `.dark.relay-v2`
    // (v2.106.4) and keeps a measured value in light. The raw variable as text
    // measures ~1.7:1 on a light card, which is why the rule exists.
    expect(CARD).toMatch(/border-primary\/40/);
    expect(CARD).toMatch(/bg-primary\/5\b/);
    expect(CARD).not.toMatch(/var\(--rb/);
  });

  it("says 'Live now' in accent TEXT via text-primary", () => {
    expect(CARD).toMatch(/text-primary\b/);
  });

  it("uses the shared .rcta recipe for the solid Join fill", () => {
    // Not a hand-rolled accent fill: `.rcta` carries the board's `#04211a`
    // on-accent text, which stays legible across all twelve palette hues where
    // plain white fails on the yellow and lime entries.
    expect(CARD).toMatch(/className="rcta /);
    // …and the recipe really is what this claim rests on.
    expect(CSS).toMatch(/\.relay-v2 \.rcta \{[^}]*background: var\(--rb\)/);
    expect(CSS).toMatch(/\.relay-v2 \.rcta \{[^}]*color: #04211a/);
  });

  it("never re-hardcodes the old black-on-green button text", () => {
    // The pre-frame button was `bg-[--relay-online] text-black`. `text-black`
    // returning would mean somebody reinstated a fixed fill under it.
    expect(CARD).not.toMatch(/text-black/);
  });
});

describe("board 5b — the frame's live pip", () => {
  it("pulses on OPACITY only and honours reduced motion", () => {
    // The frame animates a 6px accent dot. This screen is the app's densest
    // scrolling list, so the animation must be compositor-only (Tailwind's
    // `animate-pulse` is opacity) and must not run for a viewer who asked for
    // less motion — the same rule every other pip in this app follows.
    expect(CARD).toMatch(/motion-safe:animate-pulse/);
    expect(CARD).not.toMatch(/animate-ping/);
  });

  it("is aria-hidden, because the words beside it already say it", () => {
    const pip = region(CARD, "aria-hidden", "/>", 40);
    expect(pip).toMatch(/rounded-full/);
    expect(pip).toMatch(/bg-primary\b/);
  });
});

describe("board 5b — the sub-line reads Live now · N in the call · hosted by X", () => {
  it("renders all three runs from the dictionary, in the frame's order", () => {
    const live = CARD.indexOf('t("history.liveNow")');
    const count = CARD.indexOf("inCallCountKey(info.count)");
    const host = CARD.indexOf('t("history.hostedBy"');
    expect(live, "history.liveNow").toBeGreaterThan(-1);
    expect(count, "the in-call count").toBeGreaterThan(-1);
    expect(host, "history.hostedBy").toBeGreaterThan(-1);
    expect(live).toBeLessThan(count);
    expect(count).toBeLessThan(host);
  });

  it("says those words on this screen (satisfied by literal OR by the key's English)", () => {
    // Asks the property — this sentence reaches this screen — rather than
    // freezing the key, which is an implementation detail.
    expect(copyOnScreen(HISTORY_RAW, "Live now")).toBe(true);
    expect(copyOnScreen(HISTORY_RAW, "hosted by")).toBe(true);
    expect(copyOnScreen(HISTORY_RAW, "Join")).toBe(true);
    /* "in the call" is DELIBERATELY not asked of `copyOnScreen`, and the reason
       is a limit worth naming rather than a gap. That helper resolves LITERAL
       `t("key")` call sites; the count is `t(inCallCountKey(info.count), …)`, a
       key chosen at RUNTIME, which no static reader can follow — the same limit
       v2.106.93 recorded for `guestExpiryKey`. Asking it here returns false on
       CORRECT source, so the property is pinned at the SELECTOR instead, in the
       band test below. */
  });

  it("every band the selector can choose really says it, in both halves", () => {
    // The runtime-key half of the pin above. All four bands are checked because
    // a family where only the `Few` form carries the words is a screen that
    // reads correctly at 3 and says nothing at 1.
    for (const band of ["One", "Two", "Few", "Many"]) {
      const key = `history.inCallCount${band}` as keyof typeof DICT;
      const entry = DICT[key] as { en: string; ar: string } | undefined;
      expect(entry, `missing ${key}`).toBeTruthy();
      expect(entry!.en, `${key} English`).toContain("in the call");
      // The Arabic half must be real Arabic, not the English pasted across —
      // the cheap way to satisfy a both-halves check.
      expect(entry!.ar, `${key} Arabic`).toMatch(/[؀-ۿ]/);
    }
    // …and the selector genuinely reaches all four, so the loop above is not
    // checking keys nothing can produce.
    const sel = region(HISTORY, "function inCallCountKey(", "\n}", 100);
    for (const band of ["One", "Two", "Few", "Many"]) {
      expect(sel, `band ${band}`).toContain(`history.inCallCount${band}`);
    }
  });

  it("withholds the host run entirely when nobody is recorded as host", () => {
    // `liveRoom` returns `hostName: null` when the host has no live client
    // record. A dangling " · hosted by " with nothing after it is the shape a
    // bare interpolation produces, and it reads as a rendering fault.
    expect(CARD).toMatch(/info\.hostName \?/);
  });

  it("keeps the count out of the TITLE, so it is never printed twice", () => {
    // The pre-frame card used the count as its title fallback while ALSO
    // rendering it on the line below — the same number in two type sizes.
    const title = region(CARD, "const title =", "return (", 80);
    expect(title).not.toMatch(/inCallCountKey/);
    expect(title).toMatch(/t\("history\.call"\)/);
  });

  it("counts through the banded key, because Arabic needs a dual at 2", () => {
    // "{n} in the call" cannot be one string with a number dropped in. The
    // whole-key-per-band shape is what `history.inCallCountTwo` exists for.
    expect(CARD).toMatch(/t\(inCallCountKey\(info\.count\), \{ count: info\.count \}\)/);
  });

  it("lets the sub-line wrap rather than starving the live run on a narrow phone", () => {
    // The host name is the only unbounded value here; `shrink-0` +
    // `whitespace-nowrap` on the live run plus `flex-wrap` on the row means a
    // long name reflows instead of squeezing "Live now · 3 in the call" away.
    expect(CARD).toMatch(/flex-wrap/);
    const liveRun = region(CARD, 'shrink-0 whitespace-nowrap', "</span>", 40);
    expect(liveRun).toMatch(/text-primary/);
  });
});

describe("board 5b — the disc follows this screen's own group/person language", () => {
  it("draws the group squircle for a multi-party room, never one member's face", () => {
    // v2.99.77's rule, one step along: N people do not have one face any more
    // than they have one presence, so borrowing a member's photo for the room
    // would be a guess presented as a fact.
    expect(CARD).toMatch(/const isGroup = info\.count > 1/);
    const disc = region(CARD, "{isGroup ? (", ") : (", 120);
    expect(disc).toMatch(/rounded-xl/); // squircle, per the frame
    expect(disc).toMatch(/<Users /);
    expect(disc).not.toMatch(/PeerAvatar/);
  });

  it("draws the real person for a room of one, where the number provably IS them", () => {
    const solo = region(CARD, ") : (", "\n      )}", 60);
    expect(solo).toMatch(/<PeerAvatar/);
    expect(solo).toMatch(/number=\{number\}/);
    expect(solo).toMatch(/rounded-full|size=\{40\}/);
  });

  it("passes avatarUrl explicitly, because liveRoom deliberately returns none", () => {
    // The router's own comment: names only, no pins. So there is no photo to
    // pass and the prop is null rather than a value invented at the call site.
    expect(CARD).toMatch(/avatarUrl=\{null\}/);
  });
});

describe("board 5b — nothing here outruns what the server actually returns", () => {
  it("reads only fields liveRoom puts on the wire", () => {
    // `count`, `hostName`, `members[].name`. Anything else would be a fact the
    // card invented — the class of defect this repo keeps removing.
    const reads = [...CARD.matchAll(/\binfo\.([A-Za-z]+)/g)].map((m) => m[1]);
    expect(new Set(reads)).toEqual(new Set(["members", "count", "hostName"]));
  });

  it("never renders a member's 6-digit number, which the payload does not carry", () => {
    expect(CARD).not.toMatch(/PinTag/);
    expect(CARD).not.toMatch(/formatPin/);
  });

  it("…and the router really does withhold pins, so that claim is not vacuous", () => {
    const proc = region(ROUTER, "liveRoom: publicProcedure", "\n  /**", 300);
    expect(proc).toMatch(/members: info\.members\.map\(\(m\) => \(\{ name: m\.name, role: m\.role \}\)\)/);
    expect(proc).not.toMatch(/pin: m\.pin/);
  });
});

describe("board 5b — the authorization gate is untouched", () => {
  it("liveRoomInfo still refuses a requester who was never in the room", () => {
    // The relationship gate is the whole reason this endpoint can be exposed:
    // you can only see the live roster of a call you were already part of, so
    // it is no enumeration or eavesdrop oracle over the number space.
    const fn = region(RELAY, "export function liveRoomInfo(", "\n}\n", 600);
    expect(fn).toMatch(/if \(requester !== meta\.hostPin && !meta\.roster\.has\(requester\)\) return null/);
    /* …and it never advertises a call the requester is already an active member
       of, which is what keeps the card off the screen mid-call.

       WRITTEN AS TWO NEEDLES ON ONE LINE rather than one pattern with a `[^)]*`
       bridge: the real condition is
         `room.has(requester) && reg.clients.get(requester)?.roomId === rid`
       and a negated character class cannot span the `)` inside `get(requester)`.
       My first attempt did exactly that and failed on CORRECT source — the
       paren trap this repo records at v2.99.24 and v2.106.62. */
    const alreadyIn = fn
      .split("\n")
      .find((l) => l.includes("room.has(requester)"));
    expect(alreadyIn, "the already-a-member early return is gone").toBeTruthy();
    expect(alreadyIn!).toContain("return null");
  });

  it("the card does not weaken the gate by asking about somebody else's number", () => {
    // The query is keyed on the card's own prop, which comes from the busy-LED
    // set derived from THIS viewer's own log — never a number typed in.
    expect(CARD).toMatch(/\.useQuery\(\s*\{ number \}/);
  });
});

describe("board 5b — the frame's footnote is REFUSED, with the reason recorded", () => {
  /* The frame ends with:
       "Guests always knock · registered members you invited join directly"

     That is not true of this app and rendering it would be a false promise on
     the one screen where being wrong costs somebody a call they thought they
     were about to join.

     `liveRoomInfo`'s gate is ROSTER MEMBERSHIP — "were you in this room
     before" — and it says nothing about guest vs registered. Every route from
     this card goes through `knock`, so a registered member who was invited
     knocks exactly like a guest does. There is no direct-join path to point at.

     Declining a board claim the code does not keep is the same call v2.106.40
     made on 1d's second end-to-end claim and v2.106.62 made on 3c's "seen by
     4". The tier words are pinned ABSENT so the sentence cannot arrive later
     without somebody re-reading this. */
  it("makes no guest-vs-registered claim about how joining works", () => {
    expect(CARD).not.toMatch(/\bguest/i);
    expect(CARD).not.toMatch(/\bregistered\b/i);
    expect(CARD).not.toMatch(/join directly/i);
  });

  it("the gate really is roster membership rather than a tier check", () => {
    /* Without this the assertion above would be a claim about a rule that might
       not exist — it would pass just as well if the server DID split on tier.

       ASKED AS "NO TIER DECISION", NOT "NO TIER WORD", and that correction is
       the finding. My first version was `not.toMatch(/verified|guest|registered/i)`
       and it failed on CORRECT source, because the function contains the literal
       `{ name: "Guest" }` — the fallback DISPLAY NAME for a client that never
       set one. Treating that word as evidence of a tier gate is a guard crying
       wolf on correct code, so the rule now names the identifiers a real tier
       check would have to reach for. */
    const fn = region(RELAY, "export function liveRoomInfo(", "\n}\n", 600);
    expect(fn).toMatch(/meta\.roster\.has\(requester\)/);
    expect(fn).not.toMatch(/\.verified\b/);
    expect(fn).not.toMatch(/\bisGuest\b/);
    expect(fn).not.toMatch(/\btier\b/i);
    // The one legitimate occurrence, pinned so the rule above cannot be
    // satisfied by the word simply disappearing for an unrelated reason.
    expect(fn).toMatch(/name: "Guest"/);
  });
});

describe("board 5b — the card mirrors in Arabic", () => {
  it("uses no physical-direction spacing utility", () => {
    // History.tsx is swept whole by `client/src/app/rtl-history.test.ts`; this
    // narrows the same rule onto the component this frame rebuilds, so a
    // regression here names 5b rather than the file.
    const PHYSICAL =
      /(?<![\w-])-?(?:p|m)[lr]-[\w./[\]%-]+|(?<![\w-])-?(?:left|right)-[\w./[\]%-]+|(?<![\w-])text-(?:left|right)(?![\w-])/g;
    expect(CARD.match(PHYSICAL) ?? []).toEqual([]);
  });

  it("lets the name and the host resolve their own direction", () => {
    // An Arabic display name inside an English-ordered row reorders without it.
    expect(CARD).toMatch(/dir="auto"/);
  });
});
