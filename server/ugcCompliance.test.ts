/**
 * UGC COMPLIANCE (Apple 1.2, v2.107.54) — the three precautions that still needed
 * code after account-deletion (5.1.1(v)) and reporting/blocking/removal already
 * shipped:
 *
 *   (2) a terms agreement, at account creation, stating a NO-TOLERANCE policy for
 *       objectionable content and abusive users;
 *   (3) a method for FILTERING objectionable content on the broadcast surfaces;
 *   (8) CONTACT INFORMATION inside the app for reporting inappropriate activity.
 *
 * House style: source-string pins over codeOnly()-stripped source, so a test can
 * never pass on a comment that merely describes the behaviour. The content filter is
 * a real headless module, so it is also exercised as genuine unit tests.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./testing/codeOnly";
import { containsObjectionable, sanitizeUgcText } from "../shared/contentFilter";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const routers = codeOnly(read("./v2routers.ts"));
const login = codeOnly(read("../client/src/app/LoginScreen.tsx"));
const appTsx = codeOnly(read("../client/src/App.tsx"));
const messages = codeOnly(read("../client/src/pages/app/Messages.tsx"));
const guidelines = codeOnly(read("../client/src/pages/CommunityGuidelines.tsx"));
const guidelinesRaw = read("../client/src/pages/CommunityGuidelines.tsx");
const navDict = read("../client/src/app/dict/nav.ts");
const msgDict = read("../client/src/app/dict/messages.ts");

const hasBilingualKey = (src: string, key: string, prefix: string): boolean => {
  const at = src.indexOf(`"${key}":`);
  if (at < 0) return false;
  const rest = src.slice(at + key.length);
  const nextKey = rest.indexOf(`"${prefix}`, 3);
  const entry = nextKey > 0 ? rest.slice(0, nextKey) : rest.slice(0, 400);
  return /\ben:/.test(entry) && /\bar:/.test(entry);
};

/* ─────────────────── (2) terms agreement + no-tolerance gate ─────────────────── */

describe("Apple 1.2 (2) — terms agreement with a no-tolerance policy at sign-up", () => {
  it("the guest CTA is disabled until the terms are agreed to", () => {
    // The CTA's disabled expression must include the agreement flag, alongside the
    // existing name + busy checks — so a new account cannot be created without it.
    expect(login).toMatch(/disabled=\{!p\.guestName\.trim\(\) \|\| !p\.agreedToTerms \|\| p\.busy\}/);
  });

  it("submitGuest refuses when terms are not agreed to (belt-and-braces)", () => {
    // Not just the disabled button — the submit handler itself guards, so a
    // programmatic submit can't slip past the gate.
    const at = login.indexOf("async function submitGuest");
    expect(at).toBeGreaterThan(0);
    const body = login.slice(at, at + 400);
    expect(body).toMatch(/if \(!agreedToTerms\) return;/);
  });

  it("threads an agreedToTerms flag through the card as real state", () => {
    expect(login).toMatch(/const \[agreedToTerms, setAgreedToTerms\] = useState\(false\)/);
    expect(login).toMatch(/agreedToTerms: boolean; setAgreedToTerms: \(v: boolean\) => void;/);
    // A real checkbox drives it (explicit consent, not a passive "by continuing" line).
    expect(login).toMatch(/type="checkbox"/);
    expect(login).toMatch(/checked=\{p\.agreedToTerms\}/);
  });

  it("the agreement links to the guidelines and names the no-tolerance policy", () => {
    // The link target is the acceptable-use page…
    expect(login).toMatch(/href="\/guidelines"/);
    // …and the agreement copy itself states zero tolerance (in the dict).
    expect(hasBilingualKey(navDict, "login.agreeSuffix", '"login.')).toBe(true);
    const at = navDict.indexOf('"login.agreeSuffix":');
    const entry = navDict.slice(at, at + 300);
    expect(entry).toMatch(/zero tolerance/i);
  });

  it("all four agreement dict keys are bilingual", () => {
    for (const key of ["login.agreePrefix", "login.agreeGuidelines", "login.agreeSuffix", "login.agreeAria"]) {
      expect(hasBilingualKey(navDict, key, '"login.')).toBe(true);
    }
  });
});

/* ─────────────────── the Community Guidelines page ─────────────────── */

describe("Apple 1.2 — Community Guidelines / acceptable-use page", () => {
  it("is registered at /guidelines and lazy-loaded", () => {
    expect(appTsx).toMatch(/const CommunityGuidelines = lazy\(\(\) => import\("\.\/pages\/CommunityGuidelines"\)\)/);
    expect(appTsx).toMatch(/path=\{"\/guidelines"\} component=\{CommunityGuidelines\}/);
  });

  it("states the no-tolerance policy unmissably", () => {
    expect(guidelines).toMatch(/zero tolerance for objectionable content and abusive behaviour/i);
  });

  it("explains report, block, and remove — the required mechanisms", () => {
    expect(guidelines).toMatch(/Report objectionable content/i);
    expect(guidelines).toMatch(/Block abusive users/i);
    expect(guidelines).toMatch(/Remove your own content/i);
  });

  it("commits to acting on reports within 24 hours and ejecting offenders", () => {
    expect(guidelines).toMatch(/within .{0,8}24 hours/i);
    expect(guidelines).toMatch(/eject/i);
  });

  it("names the child-safety category and law-enforcement referral", () => {
    expect(guidelines).toMatch(/minors|child/i);
    expect(guidelines).toMatch(/law enforcement|authorities/i);
  });

  it("derives the contact address from the serving host (no hardcoded domain)", () => {
    // siteEmail(...) not a literal @domain — the same bundle serves every deploy.
    expect(guidelines).toMatch(/siteEmail\("report"\)/);
    expect(guidelinesRaw).not.toMatch(/@your-chat\.io/);
  });
});

/* ─────────────────── (3) content filtering ─────────────────── */

describe("Apple 1.2 (3) — objectionable-content filter (behaviour)", () => {
  it("masks a listed slur while preserving length", () => {
    // A term certain to be on the list: the n-word. Masked to same-length asterisks.
    const dirty = "you " + Buffer.from("bmlnZ2Vy", "base64").toString("utf8") + " here";
    const clean = sanitizeUgcText(dirty);
    expect(clean).not.toEqual(dirty);
    expect(clean).toMatch(/you \*{6} here/);
    expect(containsObjectionable(dirty)).toBe(true);
    expect(containsObjectionable(clean)).toBe(false);
  });

  it("leaves ordinary text untouched, including Scunthorpe-problem words", () => {
    for (const ok of ["hello there", "class analysis", "Scunthorpe United", "assignment"]) {
      expect(sanitizeUgcText(ok)).toEqual(ok);
      expect(containsObjectionable(ok)).toBe(false);
    }
  });

  it("passes null / undefined / empty straight through", () => {
    expect(sanitizeUgcText(null)).toBeNull();
    expect(sanitizeUgcText(undefined)).toBeUndefined();
    expect(sanitizeUgcText("")).toEqual("");
  });

  it("matches whole words only (a slur embedded in a longer token is left alone)", () => {
    // Boundary-anchored: the filter must not mangle an innocent superstring.
    const embedded = "passable";
    expect(sanitizeUgcText(embedded)).toEqual(embedded);
  });
});

describe("Apple 1.2 (3) — filter wired into the broadcast UGC write paths", () => {
  it("imports sanitizeUgcText from the shared module", () => {
    expect(routers).toMatch(/import \{ sanitizeUgcText \} from "\.\.\/shared\/contentFilter"/);
  });

  it("filters the profile display name and status note", () => {
    expect(routers).toMatch(/displayName: sanitizeUgcText\(input\.displayName\)/);
    expect(routers).toMatch(/statusNote: sanitizeUgcText\(input\.statusNote\)/);
  });

  it("filters a story's text", () => {
    expect(routers).toMatch(/const text = sanitizeUgcText\(\(input\.text \?\? ""\)\.trim\(\)\)/);
  });

  it("filters a group's name (at creation and on edit) and its status note", () => {
    expect(routers).toMatch(/title: sanitizeUgcText\(input\.title\)/); // createGroup
    expect(routers).toMatch(/title: input\.title !== undefined \? sanitizeUgcText\(input\.title\) : undefined/); // setGroupProfile
    expect(routers).toMatch(/statusNote: input\.statusNote !== undefined \? sanitizeUgcText\(input\.statusNote\) : undefined/);
  });

  it("filters a party-line title", () => {
    expect(routers).toMatch(/title: sanitizeUgcText\(input\.title\)/);
  });

  it("does NOT filter private message bodies (wrong tool, real harm)", () => {
    // The `send` proc must not sanitize `body` — private 1:1/group messages are not
    // the 1.2 broadcast surface, and masking private speech is a harm, not a fix.
    const at = routers.indexOf("send: publicProcedure");
    expect(at).toBeGreaterThan(0);
    const sendProc = routers.slice(at, at + 6000);
    expect(sendProc).not.toMatch(/sanitizeUgcText\(.*body/);
  });
});

/* ─────────────────── (8) in-app report contact ─────────────────── */

describe("Apple 1.2 (8) — contact information in-app for reporting", () => {
  it("the report dialog shows a report contact address", () => {
    expect(messages).toMatch(/siteEmail\("report"\)/);
    // The label is bilingual and names reporting inappropriate activity.
    expect(hasBilingualKey(msgDict, "msg.reportContact", '"msg.')).toBe(true);
    const at = msgDict.indexOf('"msg.reportContact":');
    const entry = msgDict.slice(at, at + 300);
    expect(entry).toMatch(/report/i);
  });

  it("imports siteEmail so the address follows the serving host", () => {
    expect(messages).toMatch(/import \{ siteEmail \} from "@\/lib\/siteHost"/);
  });
});
