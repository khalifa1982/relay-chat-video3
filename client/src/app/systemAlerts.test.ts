/**
 * Board 4k — system alerts and dialogs (v2.106.11).
 *
 * The frame draws four surfaces: the push-permission banner (accent Enable), the
 * message toast (avatar + ring, Reply), the update dialog (with the version on it)
 * and the sign-out confirmation (red Sign out).
 *
 * THE LOAD-BEARING TEST HERE IS NOT ABOUT THIS RELEASE — it is the sweep at the
 * bottom, which reads EVERY alert dialog in the app and requires that one whose own
 * copy claims the action cannot be undone confirms with a destructive button. That
 * is a property, so it covers the dialog somebody adds next; a list of the seven
 * that exist today would go stale the moment an eighth arrives, which is exactly how
 * this codebase has repeatedly ended up with one rule and a call site that forgot it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const CLIENT = join(process.cwd(), "client", "src");
const read = (p: string) => readFileSync(join(CLIENT, p), "utf8");
const code = (p: string) => codeOnly(read(p));

/**
 * The body of a named function, from its own opening brace to its own close.
 *
 * NOT "the first `{` after the name" and NOT "up to the first `\n}`" — for
 * `function f({ a, b }: {…})` both of those land on the DESTRUCTURED PARAMETER
 * OBJECT, so the slice contains the props and none of the code. That trap has now
 * bitten in four separate files (v2.105.9, v2.105.27, v2.106.4, and this one, where
 * it failed on perfectly correct source). The fix is the class rather than the
 * instance: the body brace is the first one reached with parens and angles closed.
 */
function fnBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}`);
  if (at === -1) throw new Error(`no function ${name}`);
  let paren = 0;
  let angle = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === "(") paren++;
    else if (c === ")") paren--;
    else if (c === "<") angle++;
    else if (c === ">") angle--;
    else if (c === "{" && paren === 0 && angle <= 0) {
      let depth = 0;
      for (let j = i; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
      }
      break;
    }
  }
  throw new Error(`no body for ${name}`);
}

describe("board 4k — the confirm button's colour is decided by the action", () => {
  it("AlertDialogAction takes `destructive` and maps it to the destructive variant", () => {
    const body = fnBody(code("components/ui/alert-dialog.tsx"), "AlertDialogAction");
    // Guard against the slice being the parameter object rather than the body — the
    // trap this file's own helper exists for.
    expect(body).toMatch(/return \(/);
    // The prop exists, and it DECIDES the variant rather than merely being accepted.
    expect(body).toMatch(/destructive\b/);
    expect(body).toMatch(
      /buttonVariants\(\{\s*variant:\s*destructive\s*\?\s*"destructive"\s*:\s*"default"\s*\}\)/
    );
    // And it is observable on the rendered element, so the sweep below can be about
    // markup rather than about a class string that tailwind-merge may rewrite.
    expect(body).toMatch(/data-destructive=\{destructive \? "" : undefined\}/);
  });

  it("a plain action still resolves to the default (accent) variant", () => {
    // The negative half: `destructive` must be OPT-IN. If the ternary were inverted
    // or defaulted the other way, every ordinary confirmation in the app would turn
    // red and the warning colour would stop meaning anything.
    const body = code("components/ui/alert-dialog.tsx");
    expect(body).not.toMatch(/destructive\?\s*:\s*boolean\s*=\s*true/);
    expect(body).toMatch(/destructive\?:\s*boolean/);
  });
});

describe("board 4k — the push banner", () => {
  const src = code("app/PushBanner.tsx");

  it("the Enable CTA is the accent, not green", () => {
    // Green is presence in this app. v2.99.86 moved DND off it and v2.106.9 moved the
    // speaking tile off it for the same reason; a green "enable notifications" chip
    // would be a third meaning for the one colour that has to carry exactly one.
    expect(src).toMatch(/className="rcta shrink-0/);
    expect(src).not.toMatch(/bg-emerald-500\/90/);
  });

  it("no emerald survives anywhere in the banner", () => {
    // Not just the button: the fill, the border, the glyph and the dismiss control
    // were all emerald, and half a conversion is worse than none — a green border
    // around an accent CTA reads as a rendering fault.
    expect(src).not.toMatch(/emerald/);
  });

  it("the accent comes from the cycling variable rather than a frozen hue", () => {
    expect(src).toMatch(/rgba\(var\(--rb-rgb\), 0\.10\)/);
    expect(src).toMatch(/color: "var\(--rb\)"/);
  });

  it("the iOS install note stays sky, because it carries no action", () => {
    // Deliberate: the install happens in Safari's own share menu, which no button on
    // this page can open. Painting it in the accent would promise a tap that is not
    // there. Sky is not overloaded, so it costs nothing to leave it.
    expect(src).toMatch(/border-sky-400\/25/);
    expect(src).toMatch(/Install RELAY \(iOS\)/);
  });
});

describe("board 4k — the update dialog names the version", () => {
  const src = code("app/UpdateChecker.tsx");

  it("the version the server answered with is kept, not discarded", () => {
    // It was already fetched and compared; only the render threw it away, so the card
    // could say nothing more than "a fresh version is ready".
    expect(src).toMatch(/setServerVersion\(serverV\)/);
    expect(src).toMatch(/const \[serverVersion, setServerVersion\] = useState\(""\)/);
  });

  it("both numbers rendered are real, and neither is a literal", () => {
    // A hardcoded "v2.106.0" would satisfy a source pin and then lie about what is
    // deployed — the exact promise v2.105.19 made the avatar menu keep.
    expect(src).toMatch(/v\{serverVersion\}/);
    expect(src).toMatch(/v\{APP_VERSION\}/);
    expect(src).not.toMatch(/v2\.\d+\.\d+/);
  });

  it("the version is bidi-isolated", () => {
    // A dot-separated number can have its parts reordered inside an RTL paragraph.
    const window = src.slice(src.indexOf("New version available"));
    expect(window.slice(0, 900)).toMatch(/dir="ltr"/);
  });

  it("falls back to the old wording rather than rendering a bare 'v'", () => {
    // serverVersion is "" until a poll has answered, and the card can render on a
    // resumed session before that.
    expect(src).toMatch(/A fresh version of RELAY is ready/);
  });

  it("the card carries the sheet material", () => {
    expect(src).toMatch(/className="rsheet w-\[min\(92vw,360px\)\]/);
  });
});

describe("board 4k — the message toast", () => {
  const src = code("app/MessagePopups.tsx");

  it("shows the sender's avatar, and only when there is a number to resolve", () => {
    // A group thread has no peerNumber; PeerAvatar keyed on nothing would render an
    // empty disc, so groups keep the glyph.
    expect(src).toMatch(/peerNumber \? \(\s*<PeerAvatar/);
    expect(src).toMatch(/<MessageSquare className="size-4 shrink-0 text-primary" \/>/);
  });

  it("the avatar is decorative", () => {
    // Clickable, it opens a story or a profile from a card whose only job is to get
    // you into the conversation.
    const at = src.indexOf("<PeerAvatar");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, src.indexOf("/>", at))).toMatch(/clickable=\{false\}/);
  });

  it("the toast carries the sheet material", () => {
    expect(src).toMatch(/className="rsheet overflow-hidden rounded-2xl/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   THE SWEEP. Every alert dialog in the app, checked against its own copy.
   ──────────────────────────────────────────────────────────────────────────── */

/** Phrasings the app uses to tell somebody an action cannot be taken back. */
const IRREVERSIBLE =
  /can't be undone|cannot be undone|can't get it back|won't come back|not recoverable|for good/i;

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (e.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Every `<AlertDialogContent> … </AlertDialogContent>` region, comments stripped. */
function dialogs(): { file: string; body: string }[] {
  const out: { file: string; body: string }[] = [];
  for (const p of tsxFiles(CLIENT)) {
    if (p.includes("components/ui/")) continue; // the primitive itself
    const src = codeOnly(readFileSync(p, "utf8"));
    let i = src.indexOf("<AlertDialogContent");
    while (i !== -1) {
      const end = src.indexOf("</AlertDialogContent>", i);
      if (end === -1) break;
      out.push({ file: p.slice(CLIENT.length + 1), body: src.slice(i, end) });
      i = src.indexOf("<AlertDialogContent", end);
    }
  }
  return out;
}

describe("every irreversible confirmation confirms in red", () => {
  const all = dialogs();

  it("the sweep actually found the dialogs", () => {
    // A sweep that matches nothing passes for the wrong reason — the failure mode
    // this repo has hit with `indexOf` anchors returning -1.
    expect(all.length).toBeGreaterThanOrEqual(8);
    expect(all.some((d) => d.file.endsWith("useSignOut.tsx"))).toBe(true);
  });

  it("a dialog whose own copy says the action is final passes `destructive`", () => {
    const missing = all
      .filter((d) => IRREVERSIBLE.test(d.body) && d.body.includes("<AlertDialogAction"))
      .filter((d) => !/<AlertDialogAction[^>]*\n?\s*destructive/.test(d.body))
      .map((d) => `${d.file}: ${(d.body.match(/<AlertDialogTitle>([^<]*)/) ?? [])[1] ?? "?"}`);
    expect(missing).toEqual([]);
  });

  it("and at least the five known ones are covered, by title", () => {
    // The sweep above is the property; this is the tripwire that proves the sweep is
    // looking at real dialogs rather than at an empty set of matches.
    const red = all
      .filter((d) => /<AlertDialogAction[^>]*\n?\s*destructive/.test(d.body))
      .map((d) => (d.body.match(/<AlertDialogTitle>\s*([^<{]*)/) ?? [])[1]?.trim() ?? "");
    for (const t of [
      "Remove contact?",
      "Clear your entire call history?",
      "Delete this message for you?",
      "Remove this message for everyone?",
      "Unsend this message?",
    ]) {
      expect(red).toContain(t);
    }
  });

  it("the RECOVERABLE thread delete deliberately stays accent", () => {
    // v2.103.0 built "delete this chat for you" so the thread returns by itself the
    // moment anybody messages again, and the copy says so. Painting it red would make
    // the warning colour mean "a dialog" instead of "you cannot undo this".
    const chat = dialogs().find((d) => d.body.includes("Delete this chat for you?"));
    expect(chat).toBeDefined();
    expect(chat!.body).not.toMatch(/<AlertDialogAction[^>]*\n?\s*destructive/);
    expect(chat!.body).toMatch(/it comes back here if they/);
  });

  it("a guest sign-out is red and a registered one is not", () => {
    // Two different acts behind one dialog: a guest's number does not come back, an
    // account sign-out is undone by signing back in.
    const d = dialogs().find((x) => x.body.includes("Sign out and forget this number?"));
    expect(d).toBeDefined();
    expect(d!.body).toMatch(/destructive=\{isGuest\}/);
  });
});
