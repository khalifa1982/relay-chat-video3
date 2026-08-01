import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { translate } from "./i18n";
import { buildInviteMessage, inviteLeadLine, inviteWhoLabel } from "./inviteMessage";

/**
 * THE SHARED INVITE MESSAGE (#161).
 *
 * Owner, with a screenshot of a party-line invite as it ARRIVED: *"this is it's look very
 * ugly … put the username and then space between two brackets … make a BR break … and
 * also below put kind of a stand-up code for the relay … make it unique. don't make the
 * message very long."*
 *
 * DRIVEN, not source-pinned, because every claim here is about the STRING somebody
 * receives — whether there is a blank line between the sentence and the link, whether a
 * missing name interpolates "undefined", whether the Arabic half survives interpolation.
 * A source assertion can answer none of those.
 */
const ROOT = path.resolve(__dirname, "../../..");
const en = (k: any, v?: any) => translate("en", k, v);
const ar = (k: any, v?: any) => translate("ar", k, v);
const WHO = { name: "Khalifa Alhammadi", pin: "777777" };
const URL = "https://your-chat.io/i/794254";

describe("who is inviting you", () => {
  it("is FIRST NAME plus the number in brackets, as the owner specified", () => {
    expect(inviteWhoLabel(WHO)).toBe("Khalifa (777-777)");
  });

  it("uses the app's own NNN-NNN grouping, never a bare or space-separated run", () => {
    /* THE PHONE-LINKIFICATION HALF OF THE BUG. The old text said `dial 794 254`, and a
       spaced six-digit run after the word "dial" is maximally phone-shaped — the owner's
       screenshot shows the client rendering it as a green underlined tel: link, i.e. the
       most tappable thing in the invite dialled their own carrier. Stated honestly: this
       REDUCES that, it cannot guarantee it — linkifier heuristics belong to the client. */
    const label = inviteWhoLabel(WHO)!;
    expect(label).toContain("777-777");
    expect(label).not.toContain("777 777");
    expect(label).not.toMatch(/dial/i);
  });

  it("is NULL rather than partial when either half is missing or malformed", () => {
    /* "Khalifa ()" and " (777-777)" are both worse than the anonymous phrasing, and an
       identity query that has not resolved yet is a real state on all three screens. */
    expect(inviteWhoLabel(null)).toBeNull();
    expect(inviteWhoLabel({ name: "Khalifa", pin: null })).toBeNull();
    expect(inviteWhoLabel({ name: "", pin: "777777" })).toBeNull();
    expect(inviteWhoLabel({ name: "   ", pin: "777777" })).toBeNull();
    expect(inviteWhoLabel({ name: "Khalifa", pin: "77777" })).toBeNull(); // five digits
    expect(inviteWhoLabel({ name: "Khalifa", pin: "77a777" })).toBeNull();
  });
});

describe("the message a recipient actually sees", () => {
  it("is THREE blocks with a blank line between each — the owner's 'BR break'", () => {
    const msg = buildInviteMessage(en, { who: WHO, url: URL });
    const blocks = msg.split("\n\n");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toBe("Khalifa (777-777) invited you to join RELAY");
    expect(blocks[1]).toBe(URL);
    expect(blocks[2]).toBe("⚡ RELAY — six digits, no phone number.");
  });

  it("puts the LINK on a line of its own, never run into the sentence", () => {
    /* The defect in the screenshot: the sentence and the URL arrived as one wrapped line,
       because `navigator.share({text, url})` lets the RECEIVING app join them — with a
       space, in WhatsApp's case. */
    const msg = buildInviteMessage(en, { who: WHO, url: URL });
    const lines = msg.split("\n");
    expect(lines).toContain(URL);
    // and nothing else shares that line
    expect(lines.filter((l) => l.includes("your-chat.io"))).toEqual([URL]);
  });

  it("names the ROOM when there is one, and does not invent one when there isn't", () => {
    const room = buildInviteMessage(en, { who: WHO, title: "Gigh Meeting", url: URL });
    expect(room.split("\n\n")[0]).toBe(
      'Khalifa (777-777) invited you to join "Gigh Meeting" on RELAY',
    );
    expect(buildInviteMessage(en, { who: WHO, url: URL })).not.toMatch(/""|on RELAY/);
    // A blank or whitespace title is the same as none, not an empty pair of quotes.
    expect(buildInviteMessage(en, { who: WHO, title: "   ", url: URL })).toBe(
      buildInviteMessage(en, { who: WHO, url: URL }),
    );
  });

  it("NEVER interpolates undefined when the identity has not resolved", () => {
    /* The realistic failure of adding a name to a message: the query is in flight the
       first time somebody taps Share. */
    for (const who of [null, undefined, {}, { name: "Khalifa" }, { pin: "777777" }] as const) {
      const msg = buildInviteMessage(en, { who: who as never, url: URL });
      expect(msg).not.toMatch(/undefined|null|NaN/);
      expect(msg.split("\n\n")[0]).toBe("You're invited to join RELAY");
    }
    expect(
      buildInviteMessage(en, { title: "Gigh Meeting", url: URL }).split("\n\n")[0],
    ).toBe('You\'re invited to join "Gigh Meeting" on RELAY');
  });

  it("stays SHORT — the owner asked twice", () => {
    const msg = buildInviteMessage(en, { who: WHO, title: "Gigh Meeting", url: URL });
    expect(msg.split("\n").filter(Boolean)).toHaveLength(3);
    expect(msg.length).toBeLessThan(180);
  });

  it("carries the standing sign-off, and it is the LAST block", () => {
    // "put kind of a stand-up code for the relay … make it unique."
    const msg = buildInviteMessage(en, { who: WHO, url: URL });
    expect(msg.endsWith("⚡ RELAY — six digits, no phone number.")).toBe(true);
  });
});

describe("Arabic", () => {
  it("renders a complete sentence with the placeholders substituted", () => {
    const msg = buildInviteMessage(ar, { who: WHO, title: "اجتماع", url: URL });
    expect(msg).toContain("Khalifa (777-777)");
    expect(msg).toContain("اجتماع");
    expect(msg).not.toMatch(/\{who\}|\{title\}/);
    expect(msg.split("\n\n")).toHaveLength(3);
  });

  it("substitutes by NAME, so a different word order in the Arabic still resolves", () => {
    /* `invite.fromLineRoom` puts `{who}` and `{title}` in a different order in the two
       halves on purpose — Arabic reads better with the verb leading. That is only safe
       because `translate` substitutes by name; a positional scheme would swap the
       person and the room. */
    const arLead = inviteLeadLine(ar, { who: WHO, title: "اجتماع" });
    expect(arLead.indexOf("Khalifa")).toBeLessThan(arLead.indexOf("اجتماع"));
    expect(arLead).toMatch(/[؀-ۿ]/);
  });

  it("keeps the URL and the number in Western digits and Latin script", () => {
    /* v2.106.84's rule: a number a person acts on is Western everywhere. And the link
       must survive verbatim — an invite whose URL was localised is an invite nobody can
       open. */
    const msg = buildInviteMessage(ar, { who: WHO, url: URL });
    expect(msg).toContain(URL);
    expect(msg).toContain("777-777");
    expect(msg).not.toMatch(/[٠-٩۰-۹]/); // Arabic-Indic digits
  });
});

describe("there is exactly ONE invite message in the app", () => {
  /* THE REASON THIS MODULE EXISTS. There were four share/copy sites with three different
     wordings, which is how the text the owner is complaining about came to exist at all —
     nothing fails when two screens describe the same act differently. */
  const files = [
    "client/src/app/ShareNumber.tsx",
    "client/src/pages/app/Dialer.tsx",
    "client/src/pages/app/GroupCallScreen.tsx",
  ];

  it("no share site composes its own wording", () => {
    for (const f of files) {
      const src = codeOnly(readFileSync(path.join(ROOT, f), "utf8"));
      expect(src, f).not.toMatch(/on RELAY — dial/);
      expect(src, f).not.toMatch(/Reach me on RELAY|Call me on RELAY/);
      // The old shape: handing the share sheet a `url` and letting it choose the layout.
      expect(src, f).not.toMatch(/navigator\.share\(/);
    }
  });

  it("every site routes through the shared composer", () => {
    for (const f of files) {
      const src = codeOnly(readFileSync(path.join(ROOT, f), "utf8"));
      expect(src, f).toMatch(/shareInviteMessage|buildInviteMessage/);
    }
  });

  it("Share and Copy of a party line say the SAME thing", () => {
    /* They used to differ — Copy said `X — dial NNN-NNN on RELAY or open <url>` while
       Share said something else again. Both now build from one `lineInvite(l)`. */
    const src = codeOnly(
      readFileSync(path.join(ROOT, "client/src/pages/app/GroupCallScreen.tsx"), "utf8"),
    );
    expect(src).toMatch(/function lineInvite\(/);
    expect([...src.matchAll(/lineInvite\(l\)/g)].length).toBe(2);
  });

  it("the composer hands the share sheet ONE field, never text + url", () => {
    /* If both are passed, the receiving app decides the layout and WhatsApp joins them
       with a space — which is the bug. */
    const src = codeOnly(readFileSync(path.join(ROOT, "client/src/app/inviteMessage.ts"), "utf8"));
    expect(src).toMatch(/navigator\.share\(\{ title: inviteLeadLine\(t, opts\), text \}\)/);
    expect(src).not.toMatch(/navigator\.share\([^)]*\burl\b/);
  });
});
