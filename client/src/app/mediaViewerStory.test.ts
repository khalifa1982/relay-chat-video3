/**
 * Board 4e (media viewer) and 2c's slide counter — v2.106.13.
 *
 * The viewer used to be bytes on black: a close button, a download, and nothing
 * else. Opening a photo fullscreen therefore LOST every piece of context the bubble
 * around it had — who sent it, when, and its caption. That context was one function
 * call away the whole time (`senderLabel` already existed), which is what makes this
 * a gap rather than a design decision.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { DICT } from "./i18n";

const CLIENT = join(process.cwd(), "client", "src");
const code = (p: string) => codeOnly(readFileSync(join(CLIENT, p), "utf8"));

describe("board 4e — the fullscreen media viewer carries its context", () => {
  const src = code("pages/app/Messages.tsx");

  it("both openers pass the message, so the two cannot differ", () => {
    // The thread renders attachments down two paths (the ordinary bubble and the
    // revealed-expiring one). One of them keeping the bare setter is exactly the
    // half-shipped shape the v2.99.85 sender-label count caught.
    expect((src.match(/onOpen=\{openMedia\(m\)\}/g) || []).length).toBe(2);
    expect(src).not.toMatch(/onOpen=\{setLightbox\}/);
  });

  it("the sender is the label the thread already resolves, not a second rule", () => {
    // `senderLabel` handles "You", the group roster and the DM peer fallback. A
    // private copy here is how the bubble and the viewer come to name one person
    // two different ways.
    expect(src).toMatch(/sender: senderLabel\(m\.senderIdentityId\)/);
  });

  it("AttachmentView is left alone", () => {
    // It renders the same media inside a bubble that already shows the sender, so
    // teaching it about message identity would hand it a fact it has no use for.
    const at = src.indexOf("function AttachmentView");
    expect(at).toBeGreaterThan(-1);
    const params = src.slice(at, src.indexOf("}: {", at));
    expect(params).not.toMatch(/\bsender\b/);
    expect(params).not.toMatch(/\bcaption\b/);
  });

  it("the chrome renders only when the opener supplied it", () => {
    // A caller that passes none must get exactly the previous viewer rather than an
    // empty row where the name would be.
    expect(src).toMatch(/\{\(media\.sender \|\| media\.at\) && \(/);
    /* Since v2.107.32 the caption line is PAGER-AWARE: an album page shows its
       own caption, the album-level one (the message body) as the fallback, and
       a single-media caller sees exactly the old `media.caption` behavior. The
       chrome rule is unchanged — no caption supplied, no row rendered. */
    expect(src).toMatch(/\{\(items \? \(current\.caption \|\| media\.caption\) : media\.caption\) && \(/);
  });

  it("the timestamp is LTR-isolated and the name follows its own direction", () => {
    // A date can have its parts reordered inside an RTL paragraph; a display name
    // must be allowed to be RTL.
    const at = src.indexOf('{(media.sender || media.at) && (');
    const block = src.slice(at, at + 1200);
    expect(block).toMatch(/dir="auto"/);
    expect(block).toMatch(/dir="ltr"/);
  });

  it("the encryption footer cannot swallow the tap that closes the viewer", () => {
    /* The whole backdrop is the close target, so any full-width overlay on top of it has to
       be inert or it becomes a dead zone.
       RE-ANCHORED (v2.106.40): this located the footer by its COPY, and the copy said
       "Media is end-to-end encrypted" — a claim the app cannot keep, since `messages.body` is
       plain `text` and the server runs a SQL `LIKE` over it. The property here is the
       INERTNESS, not the sentence, so it now anchors on the word the footer will always
       carry and asserts the honest wording separately. */
    // Anchored on the key, not the sentence: the footer's copy is translated now, and
    // an anchor made of copy silently slides to -1 the moment that happens — which
    // `slice(-1, …)` then turns into a window over the END of the file (the recurring
    // negative-index trap, v2.99.78 / v2.106.65).
    const at = src.indexOf('t("msg.encryptedInTransit")');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, at - 400), at)).toMatch(/pointer-events-none/);
    expect(src, "and it must not claim end-to-end").not.toMatch(/end-to-end/i);
  });

  it("the media is shorter than the viewport so the caption has room", () => {
    // Board 4e stacks photo over caption over footer. At the old 90vh the caption
    // would have been pushed off the bottom of the screen.
    expect(src).toMatch(/max-h-\[78vh\]/);
    expect(src).not.toMatch(/max-h-\[90vh\] max-w-\[92vw\] rounded-lg/);
  });
});

describe("board 2c — the story viewer says where you are in the reel", () => {
  const src = code("pages/app/Status.tsx");

  it("renders the position out of the total", () => {
    /* THE "of" WAS A FRAGMENT BETWEEN TWO JSX EXPRESSIONS, which is a sentence glued at
       the English seam and cannot be translated — Arabic does not necessarily put its
       joining word between the same two numbers. It is ONE key with both numbers
       interpolated now, so this pins the property (the position and the total both
       reach the counter) rather than the arrangement. */
    expect(src).toMatch(/t\("status\.slideOf", \{ index: ii \+ 1, total: group\.items\.length \}\)/);
    const e = DICT["status.slideOf"];
    expect(e.en).toBe("{index} of {total}");
    for (const half of [e.en, e.ar]) {
      expect(half).toContain("{index}");
      expect(half).toContain("{total}");
    }
  });

  it("withheld for a single-slide reel", () => {
    // "1 of 1" is noise, and the single progress bar above already says it.
    expect(src).toMatch(/\{group\.items\.length > 1 && \(/);
  });

  it("the counter is LTR, because it is a number pair", () => {
    /* THE ANCHOR WAS THE ENGLISH LITERAL, and once the counter moved into the
       dictionary `indexOf` answered -1 — after which `slice(Math.max(0, -201), -1)` is
       the WHOLE FILE minus one character, which contains `dir="ltr"` somewhere and made
       this pass VACUOUSLY. That is the negative-index trap this repo records at v2.99.78
       and v2.106.65, and a vacuous pass is worse than a red test because it reports
       safety. Re-anchored on the key, and the anchor is asserted to exist first. */
    const at = src.indexOf('t("status.slideOf"');
    expect(at, "the slide counter is still rendered").toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, at - 200), at)).toMatch(/dir="ltr"/);
  });
});
