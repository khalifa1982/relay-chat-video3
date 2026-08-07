/**
 * NOTHING UNDER THE BAR — full-screen overlays must clear the tab bar (v2.107.44).
 *
 * The app shell's mobile tab bar is IN-FLOW (not position:fixed) at z-30 — the
 * last flex child of a viewport-bounded column, so it can never scroll away and
 * nothing slides under it (AppShell). The consequence, which bit twice: a
 * `fixed inset-0` modal rendered INSIDE a page's content region — the scrolling
 * sibling above that bar — is clipped to that region, so the bar composites on
 * top of it no matter its z-index. The owner's screenshots showed exactly this:
 * "Create group call" and "New group" had their primary button sitting UNDER
 * the tab bar.
 *
 * The fix, and the rule this sweep enforces: a full-screen backdrop overlay
 * (`fixed inset-0` with an opaque/dimming background) must either portal to
 * document.body — escaping the clipped content region entirely — OR sit at a
 * z-index above the bar's 30 AND be mounted at the app root (the call engine,
 * the voicemail prompt). Anything `fixed inset-0` + backdrop + inline + z ≤ 30
 * is a button-under-the-bar waiting to happen, and fails here with its location.
 *
 * The check reads source, not a running DOM, so it's a static guarantee that
 * holds every build. A genuinely app-root overlay above z-30 that a future
 * reader wants to keep inline can be listed in ROOT_LEVEL with a reason.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const ROOT = resolve(__dirname, "..");

/** Overlays that are legitimately inline because they mount at the app root
 *  (never inside a page's clipped content region) and sit far above z-30. */
const ROOT_LEVEL: Array<{ ref: string; why: string }> = [
  {
    ref: "app/RelayEngine.tsx",
    why: "the call/ring overlay lives in RelayEngineProvider at the app root (z-80), above the whole shell",
  },
  {
    ref: "app/VoicemailPrompt.tsx",
    why: "top-level prompt rendered at the app root (z-90), not inside a page content region",
  },
];

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== "ui" && e !== "node_modules") yield* walk(p);
    } else if (p.endsWith(".tsx") && !p.includes(".test.")) yield p;
  }
}

type Overlay = { portals: boolean; z: number; ref: string; cls: string };
function overlays(): Overlay[] {
  const out: Overlay[] = [];
  const record = (cls: string, portals: boolean, f: string) => {
    if (!/bg-black|bg-background\b|bg-card\b/.test(cls)) return; // only backdrops
    const zm = cls.match(/\bz-\[(\d+)\]/) ?? cls.match(/\bz-(\d+)\b/);
    out.push({
      portals,
      z: zm ? parseInt(zm[1], 10) : 0,
      ref: relative(ROOT, f),
      cls: cls.slice(0, 60),
    });
  };
  for (const f of walk(ROOT)) {
    const src = readFileSync(f, "utf8");
    const portals = /createPortal\s*\(/.test(src);
    // Plain double-quoted className.
    for (const m of src.matchAll(/className="([^"]*\bfixed inset-0\b[^"]*)"/g)) {
      record(m[1], portals, f);
    }
    // Template-literal className, e.g. className={`relay-v2 ${…} fixed inset-0 …`}.
    // The interpolations are irrelevant to the static classes we key on, so match
    // the backtick body and keep the literal parts.
    for (const m of src.matchAll(/className=\{`([^`]*\bfixed inset-0\b[^`]*)`\}/g)) {
      record(m[1], portals, f);
    }
  }
  return out;
}

describe("full-screen overlays clear the tab bar", () => {
  it("the harness actually finds the app's overlays", () => {
    const all = overlays();
    expect(all.length).toBeGreaterThan(6);
    // the two the owner reported, now portalled, must be present and portalled
    const gc = all.find((o) => o.ref.endsWith("GroupCallScreen.tsx"));
    expect(gc?.portals, "GroupCallScreen must portal").toBe(true);
  });

  it("no inline backdrop overlay sits at or below the tab bar's z-30", () => {
    const risky = overlays().filter(
      (o) =>
        !o.portals &&
        o.z <= 30 &&
        !ROOT_LEVEL.some((r) => o.ref.endsWith(r.ref)),
    );
    expect(
      risky,
      "these `fixed inset-0` backdrops are inline AND at/below z-30 — they will\n" +
        "render clipped inside a page's content region and collide with the tab\n" +
        "bar. Portal them to document.body (see GroupCallScreen v2.107.44):\n" +
        risky.map((o) => `  z=${o.z} ${o.ref} :: ${o.cls}`).join("\n"),
    ).toEqual([]);
  });

  it("every inline exemption is a real app-root overlay above z-30", () => {
    const all = overlays();
    for (const r of ROOT_LEVEL) {
      const hit = all.find((o) => o.ref.endsWith(r.ref) && !o.portals);
      expect(hit, `${r.ref} is exempt but no longer an inline overlay — drop it`).toBeTruthy();
      expect(hit!.z, `${r.ref} must stay above the bar's z-30`).toBeGreaterThan(30);
    }
  });
});
