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
    expect(src).toMatch(/\{media\.caption && \(/);
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
    const at = src.indexOf("Encrypted in transit");
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
    expect(src).toMatch(/\{ii \+ 1\} of \{group\.items\.length\}/);
  });

  it("withheld for a single-slide reel", () => {
    // "1 of 1" is noise, and the single progress bar above already says it.
    expect(src).toMatch(/\{group\.items\.length > 1 && \(/);
  });

  it("the counter is LTR, because it is a number pair", () => {
    const at = src.indexOf("{ii + 1} of {group.items.length}");
    expect(src.slice(Math.max(0, at - 200), at)).toMatch(/dir="ltr"/);
  });
});
