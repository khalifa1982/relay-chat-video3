/* ============================================================
   v2.99.90 — the dead keys go, the dialer says who you're calling, and a story
   stops dragging you into the next person's.

   Owner, with a screenshot of the app dial pad:
     "This star no need for this bottom. Remove it from here and also remove it from
      the … dial pad, the main page … The star and the hash key. So just keep in the
      center below zero, and on the right is the delete of the numbers."
     "If the number is already on contact, you don't need to show this message. If
      he's not in the contact, just show an icon added to contact but a different
      color, make it nice color … glossy, glossy, and flashy."
     "the number where you dial, make little space … currently, it's showing you the
      dialed number, then the information, then the pad is all together attached."
     "it shows you his badge. It shows you when was his last login. First, to show
      you also he is online, then last login, number of hours … Days that shows you
      one day, two day, three days like this, not date as a date."
     "his profile, there is two things. Not the bio. If he's travel or he's not
      travel, his status. Not the image and video."
     "when you open your store, your own story … it takes you to the other story
      after it finish your own story. This thing doesn't show … don't do it in the
      main profile if you click there or anywhere else. Except if you are in the
      message and you click in the other story … But on your personal story, with
      its finish, it's closed."
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { formatElapsedSince, formatLastSeen } from "@shared/profileFields";
import { peerPresenceLines } from "./Dialer";

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const DIALER = read("client/src/pages/app/Dialer.tsx");
const HOME = read("client/src/pages/Home.tsx");
const STATUS = read("client/src/pages/app/Status.tsx");
const OVERLAYS = read("client/src/app/PeerOverlays.tsx");

/** Strips comment LINES so an assertion cannot pass on prose that mentions the very
 *  pattern it forbids — the mistake this repo has made repeatedly. */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

/* ── 1. the pads lose * and # ─────────────────────────────────────────────── */

describe("both dial pads: blank · 0 · erase", () => {
  /** The app pad's key table. */
  const APP_KEYS = (() => {
    const decl = "const KEYS: { d: string; sub: string }[] = [";
    const at = DIALER.indexOf(decl);
    expect(at).toBeGreaterThan(-1);
    // Sliced AFTER the declaration: the TYPE annotation `{ d: string; sub: string }`
    // itself matches the `{ d: ` needle the count below uses, so including it read
    // 12 entries where there are 11. The same declaration-vs-use trap as v2.99.84.
    return DIALER.slice(at + decl.length, DIALER.indexOf("\n];", at));
  })();
  /** The landing pad's key table. */
  const LP_KEYS = (() => {
    // Sliced after the declaration for the same reason as above: `Array<[string,
    // string]>` contributes two `[` of its own to the count below.
    const decl = "const KEYS: Array<[string, string]> = [";
    const at = HOME.indexOf(decl);
    expect(at).toBeGreaterThan(-1);
    return HOME.slice(at + decl.length, HOME.indexOf("\n];", at));
  })();

  it("the app pad carries no * and no #", () => {
    expect(codeOnly(APP_KEYS)).not.toMatch(/"\*"/);
    expect(codeOnly(APP_KEYS)).not.toMatch(/"#"/);
  });

  it("the landing pad carries no * and no #", () => {
    expect(codeOnly(LP_KEYS)).not.toMatch(/"\*"/);
    expect(codeOnly(LP_KEYS)).not.toMatch(/"#"/);
  });

  it("both keep 0 in the MIDDLE column via a real blank cell", () => {
    // A shortened list would slide 0 into the left column and move the erase key
    // out from under the thumb that was just typing. The blank has to occupy a
    // grid track, so it is a cell rather than an omission.
    expect(APP_KEYS).toMatch(/\{ d: PAD_GAP, sub: "" \},\s*\n\s*\{ d: "0", sub: "\+" \}/);
    expect(LP_KEYS).toMatch(/\[GAP_KEY, ""\], \["0", "\+"\], \[BS_KEY, ""\]/);
  });

  it("the blank is inert: not a button, and silent to a screen reader", () => {
    // An empty focusable control between 9 and 0 is worse than no control.
    const appCell = DIALER.slice(DIALER.indexOf("k.d === PAD_GAP"));
    expect(appCell.slice(0, 900)).toMatch(/<span key=\{k\.d\} aria-hidden="true" \/>/);
    // Bounded to the GAP arm ALONE: a wide window runs into the BS and digit arms,
    // and the digit arm legitimately carries data-lp-key — a slice that overshot was
    // this test's own first bug.
    const gapAt = HOME.indexOf("d === GAP_KEY");
    const lpCell = HOME.slice(gapAt, HOME.indexOf("d === BS_KEY", gapAt));
    expect(lpCell).toMatch(/<span aria-hidden="true"><\/span>/);
    // …and carries no data-lp-key, so the landing page's delegated click handler
    // cannot route a tap on it to press().
    expect(lpCell).not.toMatch(/data-lp-key/);
  });

  it("each pad still has exactly 12 cells", () => {
    // The two tables count differently and that is deliberate, not a slip: the APP
    // pad lists 11 (1-9 + blank + 0) and renders the erase key as a 12th element
    // after the map, because it needs its own gradient, halo and disabled state;
    // the LANDING pad lists all 12 because its erase cell is one HTML string like
    // the rest. Twelve cells either way.
    expect([...APP_KEYS.matchAll(/\{ d: /g)]).toHaveLength(11);
    expect([...LP_KEYS.matchAll(/\[/g)]).toHaveLength(12);
    expect(LP_KEYS).toMatch(/\[BS_KEY, ""\]/);
    expect(DIALER).toMatch(/aria-label="Erase last digit"/);
    expect(HOME).toMatch(/data-lp="backBtn"/);
  });

  it("the app pad still refuses a non-digit into the number", () => {
    // This guard is what made removing `*` safe rather than merely tidy: the length
    // cap used to apply only to digits, so `*` appended without limit.
    const tap = DIALER.slice(DIALER.indexOf("function tap(d: string)"));
    expect(tap.slice(0, 900)).toMatch(/if \(!\/\^\[0-9\]\$\/\.test\(d\)\) return;/);
  });
});

/* ── 2. add-to-contacts ───────────────────────────────────────────────────── */

describe("add to contacts is one glossy icon, or nothing", () => {
  const QA = DIALER.slice(DIALER.indexOf("function QuickAddContact("));

  it("shows NOTHING when they are already a contact", () => {
    expect(QA).toMatch(/if \(isAlready\) return null;/);
    // The old "✓ In your contacts" confirmation is gone, not merely restyled.
    expect(codeOnly(QA)).not.toMatch(/In your contacts/);
  });

  it("is an icon, not a text pill", () => {
    expect(codeOnly(QA)).not.toMatch(/Save \$\{fmt\} to contacts/);
    expect(QA).toMatch(/<UserPlus className="relative size-5"/);
    // Still reachable without sight: the label lives on the button.
    expect(QA).toMatch(/aria-label=\{`Add \$\{number\} to your contacts`\}/);
    expect(QA).toMatch(/title="Add to contacts"/);
  });

  it("wears a colour nothing else on the screen uses", () => {
    // Green is Voice, sky is Video, violet is Group Call, red is erase, amber is
    // Do Not Disturb — a fourth reuse would make the colour stop meaning anything.
    expect(QA).toMatch(/#ec4899|#c026d3/);
    const callRow = DIALER.slice(DIALER.indexOf("{/* Call actions"), DIALER.indexOf("function QuickAddContact("));
    for (const hex of ["#ec4899", "#c026d3", "#f9a8d4"]) {
      expect(callRow, `${hex} is not already a call button`).not.toContain(hex);
    }
  });

  it("is flashy WITHOUT repainting: the halo animates opacity, never box-shadow", () => {
    // A box-shadow keyframe repaints the element every frame — the class of
    // animation v2.99.84 measured and removed 14 of.
    expect(QA).toMatch(/relay-gloss-pulse/);
    const halo = QA.slice(QA.indexOf("relay-gloss-pulse"));
    expect(halo.slice(0, 220)).toMatch(/boxShadow: "0 0 18px 4px/);
    const css = read("client/src/index.css");
    const kf = css.slice(css.indexOf("@keyframes relayGlossPulse"));
    const body = kf.slice(0, kf.indexOf("}\n\n") + 1);
    expect(body).not.toMatch(/box-shadow|filter|width|height/);
    expect(body).toMatch(/opacity/);
  });

  it("cannot be double-tapped into two contacts", () => {
    expect(QA).toMatch(/disabled=\{upsert\.isPending\}/);
  });
});

/* ── 3. the preview ───────────────────────────────────────────────────────── */

describe("how long ago, as a duration and never a date", () => {
  const t0 = 1_700_000_000_000;

  it("seconds under a minute", () => {
    expect(formatElapsedSince(t0 - 8_000, t0)).toBe("8s");
    expect(formatElapsedSince(t0 - 59_000, t0)).toBe("59s");
  });

  it("minutes under an hour", () => {
    expect(formatElapsedSince(t0 - 60_000, t0)).toBe("1m");
    expect(formatElapsedSince(t0 - 14 * 60_000, t0)).toBe("14m");
  });

  it("hours and minutes under a day", () => {
    expect(formatElapsedSince(t0 - (3 * 3600 + 20 * 60) * 1000, t0)).toBe("3h 20m");
    expect(formatElapsedSince(t0 - 5 * 3600_000, t0)).toBe("5h");
  });

  it("days and hours past 24h — 'one day, two day, three days like this'", () => {
    expect(formatElapsedSince(t0 - 24 * 3600_000, t0)).toBe("1d");
    expect(formatElapsedSince(t0 - (2 * 24 + 4) * 3600_000, t0)).toBe("2d 4h");
    expect(formatElapsedSince(t0 - 40 * 24 * 3600_000, t0)).toBe("40d");
  });

  it("NEVER a month name, a year, or a clock", () => {
    // The whole point of a second formatter: the owner explicitly rejected the
    // dated form for this surface.
    for (const ago of [1_000, 3600_000, 26 * 3600_000, 400 * 24 * 3600_000]) {
      const out = formatElapsedSince(t0 - ago, t0);
      expect(out).not.toMatch(/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/);
      expect(out).not.toMatch(/:/);
      expect(out).not.toMatch(/AM|PM/);
      expect(out).not.toMatch(/\b(19|20)\d\d\b/);
    }
  });

  it("degrades to empty rather than lying about an unknown time", () => {
    expect(formatElapsedSince(0, t0)).toBe("");
    expect(formatElapsedSince(Number.NaN, t0)).toBe("");
    // A clock skew must not render a negative duration.
    expect(formatElapsedSince(t0 + 5000, t0)).toBe("0s");
  });

  it("formatLastSeen is left ALONE — the owner asked for its clock in v2.99.66", () => {
    // Replacing it globally would undo an earlier explicit request; Contacts and the
    // profile popup still read it.
    expect(formatLastSeen(t0 - 26 * 3600_000, t0)).toMatch(/last seen/);
    expect(formatLastSeen(t0 - 26 * 3600_000, t0)).toMatch(/at \d/);
  });
});

describe("the dialer preview, in the owner's order", () => {
  const t0 = 1_700_000_000_000;
  const base = { isOnline: false, lastSeenAt: new Date(t0 - 3 * 3600_000), statusOverride: "", inCall: false };

  it("online first: present NOW outranks how long since", () => {
    const r = peerPresenceLines({ ...base, isOnline: true }, t0);
    expect(r.presence).toBe("online now");
    expect(r.online).toBe(true);
    // No elapsed figure while they are here: "last login 3s ago" beside "online
    // now" restates the same fact, and it would need a per-second re-render.
    expect(r.elapsed).toBe("");
  });

  it("then the last login, as a duration", () => {
    const r = peerPresenceLines(base, t0);
    expect(r.presence).toBe("offline");
    expect(r.elapsed).toBe("3h");
  });

  it("on a call wins over online, and still shows no elapsed", () => {
    const r = peerPresenceLines({ ...base, isOnline: true, inCall: true }, t0);
    expect(r.presence).toBe("on a call");
    expect(r.busy).toBe(true);
    expect(r.elapsed).toBe("");
  });

  it("the status they PICKED is its own value, not the presence text", () => {
    // Owner: "his profile, there is two things. Not the bio. If he's travel or he's
    // not travel, his status." So travelling does not overwrite "offline".
    const trav = peerPresenceLines({ ...base, statusOverride: "travel" }, t0);
    expect(trav.chosen).toBe("Travelling ✈️");
    expect(trav.presence).toBe("offline");
    // A manual label is not presence, so how long since they were really here is
    // still news — the elapsed figure stays.
    expect(trav.elapsed).toBe("3h");

    const away = peerPresenceLines({ ...base, isOnline: true, statusOverride: "away" }, t0);
    expect(away.chosen).toBe("Away");
    expect(away.presence).toBe("online now");

    expect(peerPresenceLines(base, t0).chosen).toBe("");
  });

  it("renders badge, presence, elapsed and the chosen status — in that order", () => {
    const at = DIALER.indexOf("const st = peerPresenceLines(");
    expect(at).toBeGreaterThan(-1);
    const block = DIALER.slice(at, DIALER.indexOf('"No RELAY user with this number"', at));
    const iBadge = block.indexOf("<RoleBadge");
    const iPresence = block.indexOf("{st.presence}");
    const iElapsed = block.indexOf("{st.elapsed} ago");
    const iChosen = block.indexOf("{st.chosen}");
    for (const [n, i] of [["badge", iBadge], ["presence", iPresence], ["elapsed", iElapsed], ["chosen", iChosen]] as const) {
      expect(i, `${n} is rendered`).toBeGreaterThan(-1);
    }
    expect(iBadge).toBeLessThan(iPresence);
    expect(iPresence).toBeLessThan(iElapsed);
    expect(iElapsed).toBeLessThan(iChosen);
  });

  it("the elapsed figure is bidi-isolated so RTL cannot reorder '2d 4h'", () => {
    const el = DIALER.slice(DIALER.indexOf("{st.elapsed} ago") - 400, DIALER.indexOf("{st.elapsed} ago"));
    expect(el).toMatch(/dir="ltr"/);
    expect(el).toMatch(/\[unicode-bidi:isolate\]/);
  });

  it("there is real space between the number, the information and the pad", () => {
    // Owner: "it's showing you the dialed number, then the information, then the pad
    // is all together attached. Make space between the little bit."
    const cls = 'className="mt-3 mb-1.5 text-[0.78rem] min-h-4 text-muted-foreground"';
    expect(DIALER).toContain(cls);
    // The cramped original is gone, checked against CODE so the comment explaining
    // the change cannot satisfy the assertion.
    expect(codeOnly(DIALER)).not.toMatch(/mt-1\.5 text-\[0\.78rem\]/);
    // …and the class really is on the information block, i.e. the element carrying
    // the live-region role, not some other div.
    const at = DIALER.indexOf(cls);
    expect(DIALER.slice(at, at + 200)).toMatch(/aria-live="polite"/);
  });
});

/* ── 4. story chaining ────────────────────────────────────────────────────── */

describe("a story only chains where the owner said it should", () => {
  it("chaining is OPT-IN and defaults to off", () => {
    // The default is the safety property: a call site added later inherits the
    // single-story behaviour, which is the rule for everywhere but the strip.
    expect(STATUS).toMatch(/chain = false,/);
    expect(STATUS).toMatch(/chain\?: boolean;/);
  });

  it("next() and prev() both go through the one chain rule", () => {
    const nx = STATUS.slice(STATUS.indexOf("function next() {"));
    const nextBody = nx.slice(0, nx.indexOf("\n  }") + 4);
    expect(nextBody).toMatch(/nextChainable\(gi, 1\)/);
    // No direct group step left anywhere — that was the unconditional chain.
    expect(codeOnly(STATUS)).not.toMatch(/if \(gi \+ 1 < groups\.length\)/);
    const pv = STATUS.slice(STATUS.indexOf("function prev() {"));
    const prevBody = pv.slice(0, pv.indexOf("\n  }") + 4);
    expect(prevBody).toMatch(/nextChainable\(gi, -1\)/);
    expect(codeOnly(STATUS)).not.toMatch(/if \(gi > 0\) \{ const p = gi - 1;/);
  });

  it("with chaining off, the end of the story closes the viewer", () => {
    const fn = STATUS.slice(STATUS.indexOf("function nextChainable("));
    expect(fn.slice(0, 400)).toMatch(/if \(!chain\) return -1;/);
    const nx = STATUS.slice(STATUS.indexOf("function next() {"));
    expect(nx.slice(0, nx.indexOf("\n  }") + 4)).toMatch(/onClose\(\);/);
  });

  it("YOUR OWN story is never part of the chain, in either direction", () => {
    // "on your personal story, with its finish, it's closed."
    const fn = STATUS.slice(STATUS.indexOf("function nextChainable("));
    expect(fn.slice(0, 500)).toMatch(/if \(!groups\[j\]\.owner\.isMe\) return j;/);
  });

  it("the Messages strip is the ONLY thing that opts in", () => {
    expect(STATUS).toMatch(/chain=\{!groups\[viewerAt\]\.owner\.isMe\}/);
    // Exactly one opt-in across the whole client.
    const all = [STATUS, OVERLAYS, read("client/src/pages/app/Messages.tsx")];
    const optIns = all.reduce((n, src) => n + [...src.matchAll(/chain=\{/g)].length, 0);
    expect(optIns).toBe(1);
  });

  it("the universal opener (profile popup, contacts, history, call tiles) does NOT chain", () => {
    // PeerOverlaysHost hands the viewer the WHOLE feed so it can locate the right
    // group; without `chain` that array is now navigable one group only.
    const mount = OVERLAYS.slice(OVERLAYS.indexOf("<StatusViewer"));
    const tag = mount.slice(0, mount.indexOf("/>") + 2);
    expect(tag).toMatch(/groups=\{viewerGroups\}/);
    expect(tag).not.toMatch(/chain/);
  });

  it("the progress bars only ever describe the story on screen", () => {
    // Bars for stories the viewer will never reach would promise chaining that is
    // no longer going to happen.
    const bars = STATUS.slice(STATUS.indexOf("{/* progress bars */}"));
    expect(bars.slice(0, 500)).toMatch(/\{group\.items\.map\(/);
    expect(bars.slice(0, 500)).not.toMatch(/groups\.map\(/);
  });
});

describe("the story ring still reaches every surface it did", () => {
  it("Contacts, Messages and History all draw peers through PeerAvatar", () => {
    // Owner: "wherever it's showing history, in contact … everywhere." Group ROWS
    // have no ring because a group has no avatar or status of its own yet — that is
    // its own piece of work, not a regression here.
    for (const f of [
      "client/src/pages/app/Contacts.tsx",
      "client/src/pages/app/Messages.tsx",
      "client/src/pages/app/History.tsx",
    ]) {
      expect(read(f), `${f} uses PeerAvatar`).toMatch(/<PeerAvatar\b/);
    }
  });

  it("and no story ⇒ the tap opens the profile instead of nothing", () => {
    expect(OVERLAYS).toMatch(/if \(st\?\.hasAny\) openPeerStatus\(number\);/);
    const fn = OVERLAYS.slice(OVERLAYS.indexOf("if (st?.hasAny) openPeerStatus(number);"));
    expect(fn.slice(0, 260)).toMatch(/openPeerProfile\(number\)/);
  });
});
