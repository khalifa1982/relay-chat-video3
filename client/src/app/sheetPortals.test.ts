/**
 * FULLSCREEN OVERLAYS ARE PORTALLED (v2.107.33) — the owner's screenshot: the
 * photo editor's Cancel / Use buttons sliced under the bottom tab bar, only
 * their top edge peeking out, untappable.
 *
 * THE MECHANICS, recorded once more because this is the THIRD strike of the
 * class (v2.106.27, v2.107.2, v2.107.25): the page content wrapper is a z-10
 * stacking context and the mobile chrome is z-30, so an overlay mounted inside
 * a page resolves its z INSIDE the wrapper and competes as 10 — `z-[130]` on
 * the element is powerless. A portal to document.body removes every ancestor
 * from the fight by construction.
 *
 * These pins hold BOTH halves: the portal itself, and the `dark relay-v2` root
 * classes that make portalling safe — a sheet that inherits its theme from the
 * tree would lose it the moment it leaves that tree.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SHEETS = [
  "client/src/app/ImageEditSheet.tsx",
  "client/src/app/MediaEditSheet.tsx",
  "client/src/app/VideoRecordSheet.tsx",
];

describe("fullscreen sheets escape the page's stacking context", () => {
  for (const rel of SHEETS) {
    it(`${path.basename(rel)} portals to document.body and carries its own theme`, () => {
      const src = read(rel);
      expect(src).toContain('import { createPortal } from "react-dom";');
      expect(src).toContain("return createPortal(");
      expect(src).toMatch(/,\n\s*document\.body\n\s*\);/);
      // The portal-safety precondition: the root brings `dark relay-v2` WITH it.
      expect(src).toContain('"dark relay-v2 fixed inset-0 z-[130]');
    });
  }

  it("the media lightbox (inside Messages.tsx) is portalled too — same mount point, same trap", () => {
    const src = read("client/src/pages/app/Messages.tsx");
    expect(src).toContain('import { createPortal } from "react-dom";');
    // Its own colors are all literal (bg-black/90, white chrome), so it needs
    // no theme classes to survive the move — pinned as the fullscreen z-[90]
    // root going through the portal.
    expect(src).toMatch(/return createPortal\(\n\s*<div\n\s*className="fixed inset-0 z-\[90\]/);
  });
});
