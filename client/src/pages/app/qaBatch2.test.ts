import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * v2.99.23 — heavy-QA sweep fixes, batch 2 (ephemeral messages).
 *   H2 (HIGH): a still-LOCKED view-once/disappearing received message was
 *              extractable via the Copy/Reply context menu WITHOUT burning, and
 *              the reply bar printed its raw body (replyingTo lacked `meta`, so
 *              previewOf's disappearing-guard was bypassed).
 *   M3 (MED):  disappearing messages in a GROUP burn for everyone the instant
 *              the first member opens the single shared row — gate the composer
 *              toggle (and the send) to 1:1 until per-recipient burn exists.
 *   M5 (MED):  the reply target leaked across conversation switches.
 * (M11 — full server-side content-gating-until-consume — is deferred; it needs
 *  a consume-to-reveal content-delivery redesign. Documented in todo.md.)
 */
const MSGS = readFileSync(join(__dirname, "Messages.tsx"), "utf8");

describe("v2.99.23 QA H2 — a locked expiring message can't be extracted from the menu", () => {
  it("suppresses the received-message menu while an expiring message is still locked (unrevealed, unburned)", () => {
    expect(MSGS).toMatch(/const locked = isExpiring && !revealed\.has\(m\.id\) && !burned;/);
    expect(MSGS).toMatch(/if \(locked\) return null;/);
  });
  it("carries meta on the reply target so previewOf masks a disappearing message's body in the reply bar", () => {
    // the replyingTo state + setter both include meta
    expect(MSGS).toMatch(/senderIdentityId: number;\s*\n\s*body: string \| null;\s*\n\s*kind: string;\s*\n\s*\/\/ meta MUST ride along/);
    expect(MSGS).toMatch(/kind: string; meta\?: unknown \} \| null\) \{/);
    // and the draft-reconstruct path passes meta through
    expect(MSGS).toMatch(/meta: \(m as \{ meta\?: unknown \}\)\.meta \}\);/);
    // previewOf already masks on meta.expire (regression guard)
    expect(MSGS).toMatch(/\?\.expire != null\) return t\("msg\.disappearingPreview"\);/);
  });
});

describe("v2.99.23 QA M5 — reply target is per-conversation", () => {
  it("clears the reply target when the conversation changes", () => {
    expect(MSGS).toMatch(/useEffect\(\(\) => \{ setReplyingToState\(null\); \}, \[conversationId\]\);/);
  });
});

describe("v2.99.23 QA M3 — disappearing messages are 1:1 only", () => {
  it("hides the disappearing-message toggle in group threads", () => {
    expect(MSGS).toMatch(/QA M3: 1:1 ONLY/);
    // the toggle Button is wrapped in a !isGroup gate
    expect(MSGS).toMatch(/\{!isGroup && \(\s*\n\s*<Button/);
  });
  it("never attaches meta.expire on a group send (defensive backstop)", () => {
    expect(MSGS).toMatch(/const exp = isGroup \? null : expire;/);
  });
});
