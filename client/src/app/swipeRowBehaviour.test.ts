import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { trayWidth } from "./SwipeRow";

/**
 * THE SWIPE ROW HOLDS THE OWNER'S THREE REQUIREMENTS (v2.106.60).
 *
 * Verbatim: "when you slide right or left, that bar shouldn't be transparent; it should
 * only show you the icons, either on the left or the right. When you remove your hand,
 * the bar should stop where you slid it, and you can then click on these buttons: pen,
 * delete, or whatever is mentioned there."
 *
 * All three were MEASURED against the real bundle before anything was changed, and the
 * two obvious theories were both wrong — which is why these pins are on the mechanisms
 * that actually decided the behaviour rather than on the ones that looked guilty:
 *
 *   - the tray DID open on release and was then closed by the CLICK that ends the drag,
 *     so `OPEN_THRESHOLD` and `COMMIT_FRACTION` were never involved and lowering them
 *     would have fixed nothing (measured: 60/100/140/180/220/260px all sprang back);
 *   - the row's translucency comes from the CALLER's `active:`/`hover:` tint, not from
 *     anything in this component, because `:active` is true for a whole pointer drag.
 *
 * The behavioural half — that a real drag now stays open, reveals one side, and leaves a
 * tappable button — is verified by driving the built bundle in a browser, because whether
 * a gesture settles open is exactly what a source pin cannot answer. These pins guard the
 * mechanisms that verification rests on.
 */

const ROOT = "/home/user/relay-chat-video3";
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SWIPE_PATH = "client/src/app/SwipeRow.tsx";
const SWIPE = read(SWIPE_PATH);
const CODE = codeOnly(SWIPE);

/** A function's body, bounded by its own brace balance.
 *  NOT `indexOf("\n}")`: for a function whose parameter is an inline object type the
 *  first line-starting `}` closes the PARAMETER, so the slice contains none of the body —
 *  the trap this repo has recorded five times. */
function fnBody(src: string, decl: string): string {
  const at = src.indexOf(decl);
  expect(at, `${decl} not found`).toBeGreaterThan(-1);
  let i = src.indexOf("{", at + decl.length - 1);
  // Walk past a parameter list / return type to the brace that opens the body.
  let depth = 0;
  for (let k = at; k < src.length; k++) {
    const c = src[k];
    if (c === "(" || c === "<") depth++;
    else if (c === ")" || c === ">") depth--;
    else if (c === "{" && depth <= 0) {
      i = k;
      break;
    }
  }
  let d = 0;
  for (let k = i; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") {
      d--;
      if (d === 0) return src.slice(i, k + 1);
    }
  }
  throw new Error(`unbalanced body for ${decl}`);
}

describe("(c) the gesture that opens a tray cannot also close it", () => {
  it("finish flags the gesture as having just opened, and only when it settled a side", () => {
    const body = fnBody(CODE, "const finish = (e: React.PointerEvent)");
    // The flag must be derived from the side that was chosen, never set unconditionally:
    // set on a close, the very next tap on the row would be swallowed instead of opening it.
    expect(body).toMatch(/d\.justOpened\s*=\s*side\s*!==\s*null/);
    const flagAt = body.indexOf("d.justOpened");
    const settleAt = body.indexOf("settle(side)");
    expect(flagAt).toBeGreaterThan(-1);
    expect(settleAt).toBeGreaterThan(flagAt);
  });

  it("onClickCapture swallows that click WITHOUT closing, and clears the flag", () => {
    const at = CODE.indexOf("onClickCapture");
    expect(at).toBeGreaterThan(-1);
    const handler = CODE.slice(at, CODE.indexOf("\n      >", at));
    expect(handler.length).toBeGreaterThan(120);
    // The justOpened branch must come FIRST and must return before the closing branch.
    const guardAt = handler.indexOf("drag.current.justOpened");
    const closeAt = handler.indexOf("settle(null)");
    expect(guardAt).toBeGreaterThan(-1);
    expect(closeAt).toBeGreaterThan(guardAt);
    const guarded = handler.slice(guardAt, closeAt);
    expect(guarded).toMatch(/justOpened\s*=\s*false/);
    expect(guarded).toMatch(/return/);
    // It still has to stop the row's own tap firing, or a swipe would also open the thread.
    expect(guarded).toMatch(/preventDefault\(\)/);
    expect(guarded).toMatch(/stopPropagation\(\)/);
  });

  it("a press-and-hold that opened the tray is not re-decided when the finger lifts", () => {
    // The hold settles a side while `d.x` is still 0, so letting `finish` run its
    // threshold logic afterwards closed the tray the hold had just opened.
    const hold = CODE.slice(CODE.indexOf("d.holdTimer = setTimeout"), CODE.indexOf("}, HOLD_MS)"));
    expect(hold).toMatch(/dd\.heldOpen\s*=\s*true/);
    expect(hold).toMatch(/dd\.justOpened\s*=\s*true/);
    const body = fnBody(CODE, "const finish = (e: React.PointerEvent)");
    const early = body.indexOf("if (d.heldOpen) return");
    expect(early).toBeGreaterThan(-1);
    expect(body.indexOf("const x = d.x")).toBeGreaterThan(early);
  });

  it("both flags are cleared when a new gesture starts, so neither can go stale", () => {
    const body = fnBody(CODE, "const onPointerDown = (e: React.PointerEvent)");
    expect(body).toMatch(/d\.heldOpen\s*=\s*false/);
    expect(body).toMatch(/d\.justOpened\s*=\s*false/);
  });

  it("a full swipe never RUNS an action — it opens, per the owner's ask", () => {
    // "the bar should stop where you slid it, and you can then click on these buttons".
    expect(CODE).not.toMatch(/COMMIT_FRACTION/);
    const body = fnBody(CODE, "const finish = (e: React.PointerEvent)");
    // No action may be invoked from the gesture itself; only from a real button tap.
    expect(body).not.toMatch(/\.onSelect\(\)/);
    expect(CODE).toMatch(/onClick=\{\(\)\s*=>\s*\{\s*settle\(null\);\s*a\.onSelect\(\);/);
  });

  it("opening is an ABSOLUTE distance, so a 3-action side needs no more drag than a 2-action one", () => {
    // A fraction of the tray width made the right-hand side (3 actions, 216px) need twice
    // the drag of the left (2 actions, 146px) for the identical gesture.
    expect(CODE).not.toMatch(/OPEN_THRESHOLD/);
    expect(CODE).toMatch(/const OPEN_PX\s*=\s*(\d+)/);
    const px = Number(/const OPEN_PX\s*=\s*(\d+)/.exec(CODE)![1]);
    // Bounded on BOTH sides: below the claim threshold it would open on scroll jitter,
    // and a large value is the spring-back the owner is complaining about.
    expect(px).toBeGreaterThan(10);
    expect(px).toBeLessThanOrEqual(48);
    const body = fnBody(CODE, "const finish = (e: React.PointerEvent)");
    expect(body).toMatch(/x >= OPEN_PX/);
    expect(body).toMatch(/x <= -OPEN_PX/);
  });
});

describe("(b) only the dragged side's icons are revealed", () => {
  it("paint is the ONE funnel that sets both position and which side shows", () => {
    const body = fnBody(CODE, "const paint = useCallback(");
    expect(body).toMatch(/leftTrayRef\.current\.style\.visibility\s*=\s*x > 0/);
    expect(body).toMatch(/rightTrayRef\.current\.style\.visibility\s*=\s*x < 0/);
    // Same function that writes the transform — two funnels could disagree about which
    // side a given offset reveals.
    expect(body).toMatch(/style\.transform\s*=/);
  });

  it("visibility (not opacity), so a hidden tray's buttons leave hit-testing too", () => {
    const body = fnBody(CODE, "const paint = useCallback(");
    expect(body).not.toMatch(/style\.opacity/);
  });

  it("React owns the SETTLED truth so a re-render cannot contradict the drag", () => {
    const tray = CODE.slice(CODE.indexOf("const tray = ("), CODE.indexOf("{actions.map("));
    expect(tray).toMatch(/visibility:\s*open === side \? "visible" : "hidden"/);
    // Each tray is addressable, or paint cannot reach it.
    expect(tray).toMatch(/ref=\{side === "left" \? leftTrayRef : rightTrayRef\}/);
  });
});

describe("(a) nothing shows through the row while it slides", () => {
  /** Every file that mounts a SwipeRow, so the sweep covers the one added next. */
  const callSites = (() => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${e}`;
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
        else if (/\.tsx$/.test(e) && !rel.endsWith(SWIPE_PATH) && read(rel).includes("<SwipeRow")) out.push(rel);
      }
    };
    walk("client/src");
    return out;
  })();

  it("finds the call sites at all (a vacuous sweep passes for the wrong reason)", () => {
    expect(callSites.length).toBeGreaterThan(0);
    expect(callSites).toContain("client/src/pages/app/Messages.tsx");
  });

  it("no row class uses a TRANSLUCENT background in any state", () => {
    /* THE MEASURED DEFECT: `active:bg-muted/35` resolved to `oklab(… / 0.35)` while the
       row was being dragged — `:active` is true for the whole gesture — so both trays'
       pucks and the app's live background canvas read straight through the row's own
       name and preview text. An alpha-suffixed background utility anywhere in a swipe
       row's class list reintroduces it, and this component cannot see its caller's
       classes, so the rule has to be enforced from outside. */
    for (const file of callSites) {
      const src = codeOnly(read(file));
      let from = 0;
      let seen = 0;
      for (;;) {
        const at = src.indexOf("rowClassName={", from);
        if (at < 0) break;
        seen++;
        // Balance braces from the prop's own `{` so a multi-line expression is covered.
        let d = 0;
        let end = at + "rowClassName=".length;
        for (let k = end; k < src.length; k++) {
          if (src[k] === "{") d++;
          else if (src[k] === "}") {
            d--;
            if (d === 0) {
              end = k;
              break;
            }
          }
        }
        const expr = src.slice(at, end + 1);
        expect(expr.length).toBeGreaterThan(20);
        expect(
          expr,
          `${file}: a swipe row's background must be opaque in every state — an alpha ` +
            `modifier makes it see-through for the whole drag`,
        ).not.toMatch(/\bbg-[a-z]+(-[a-z0-9]+)*\/\d/);
        from = end;
      }
      expect(seen, `${file}: found <SwipeRow but no rowClassName to check`).toBeGreaterThan(0);
    }
  });

  it("the row's base and its selected tint are not two rivals in one class list", () => {
    /* Two `background-color` utilities of equal specificity are decided by stylesheet
       EMISSION order, not by the order written here — so which one applied was never
       this file's decision. The base belongs only in the branch that wants it. */
    const src = codeOnly(read("client/src/pages/app/Messages.tsx"));
    const at = src.indexOf("rowClassName={");
    const expr = src.slice(at, src.indexOf("left={", at));
    expect(expr).toMatch(/isActive \? "bg-muted"/);
    expect(expr).not.toMatch(/transition-colors bg-background "/);
  });
});

describe("the tray geometry is derived from the classes that draw it", () => {
  it("trayWidth is the padding plus the pucks plus the gaps", () => {
    // The open offset used to be a flat 76*count against a real 216px tray for three
    // actions, so a full drag over-revealed by 12px and showed whatever sits behind.
    expect(trayWidth(0)).toBe(0);
    expect(trayWidth(1)).toBe(6 + 64 + 6);
    expect(trayWidth(2)).toBe(146);
    expect(trayWidth(3)).toBe(216);
  });

  it("its constants agree with the JSX that has to match them", () => {
    expect(CODE).toMatch(/const PUCK_W = 64/);
    expect(CODE).toMatch(/const TRAY_GAP = 6/);
    expect(CODE).toMatch(/const TRAY_PAD = 6/);
    // gap-1.5 and px-1.5 are 6px; w-[64px] is the button.
    expect(CODE).toMatch(/w-\[64px\]/);
    expect(CODE).toMatch(/gap-1\.5 px-1\.5/);
    expect(CODE).not.toMatch(/ACTION_W/);
  });

  it("both open offsets come from it, so neither side can drift", () => {
    expect(CODE).toMatch(/const leftW = trayWidth\(left\.length\)/);
    expect(CODE).toMatch(/const rightW = trayWidth\(right\.length\)/);
  });
});

describe("the board's own values for the revealed tray", () => {
  it("the puck is a 40px squircle at a 13px radius, per the board", () => {
    expect(CODE).toMatch(/size-10 place-items-center rounded-\[13px\]/);
    expect(CODE).not.toMatch(/size-11/);
    expect(CODE).not.toMatch(/rounded-full/);
  });

  it("no backdrop-blur per puck per row", () => {
    // The surface behind it is opaque now, so a blur buys nothing and costs paint on the
    // app's densest scrolling list (the v2.99.84 rule).
    expect(CODE).not.toMatch(/backdrop-blur/);
  });

  it("the revealed surface is set as colour PLUS image, never the background shorthand", () => {
    /* `background:` is a shorthand that resets `background-color` to transparent, so
       writing the board's rgba(255,255,255,.02) lift through it would silently undo the
       opaque panel underneath while looking identical in the source — the v2.106.40
       `.rglass` trap. */
    const tray = CODE.slice(CODE.indexOf("const tray = ("), CODE.indexOf("{actions.map("));
    expect(tray).toMatch(/backgroundColor:\s*"var\(--card\)"/);
    expect(tray).toMatch(/backgroundImage:\s*"linear-gradient\(rgba\(255,255,255,\.02\),/);
    expect(tray).not.toMatch(/\bbackground:\s*["`]/);
  });
});

describe("what the rework must not have broken", () => {
  it("the scroller still keeps vertical panning", () => {
    // The one line that stops the whole list feeling broken inside a scroll container.
    expect(SWIPE).toMatch(/touchAction: "pan-y"/);
  });

  it("the gesture is still claimed only after a mostly-horizontal move", () => {
    const body = fnBody(CODE, "const onPointerMove = (e: React.PointerEvent)");
    expect(body).toMatch(/Math\.abs\(dy\) > Math\.abs\(dx\) && Math\.abs\(dy\) > CLAIM_PX/);
    expect(body).toMatch(/if \(Math\.abs\(dx\) < CLAIM_PX\) return/);
    // Claiming must still happen only after the browser has had its chance to scroll.
    expect(body.indexOf("setPointerCapture")).toBeGreaterThan(body.indexOf("CLAIM_PX"));
  });

  it("the drag still writes the transform imperatively, never through React state", () => {
    // A state update per pointer move re-renders the whole thread list every frame.
    const body = fnBody(CODE, "const onPointerMove = (e: React.PointerEvent)");
    expect(body).not.toMatch(/setOpen/);
    expect(body).toMatch(/paint\(x, false\)/);
  });

  it("a buried action is not focusable", () => {
    expect(CODE).toMatch(/tabIndex=\{open === side \? 0 : -1\}/);
  });
});
