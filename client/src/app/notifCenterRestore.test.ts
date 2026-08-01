/**
 * Board 2d (notification center, with 5h's device-approval and empty states) and
 * board 4g (guest restore) — v2.106.12.
 *
 * The substantive change is not the material: it is that a waiting sign-in can be
 * APPROVED FROM THE PANEL. v2.99.7 shipped the approval flow with Profile → Devices
 * as the only place to act, so the notification announced something and then made
 * you go and find it. What the tests here mostly guard is the degradation — the row
 * must never disappear because a caller passed no handlers, which is the failure I
 * wrote and caught while building it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { copyOnScreen, whyCopyMissing } from "../../../server/testing/copyOnScreen";

const CLIENT = join(process.cwd(), "client", "src");
const code = (p: string) => codeOnly(readFileSync(join(CLIENT, p), "utf8"));

describe("board 2d — the notification center", () => {
  const src = code("app/MissedCalls.tsx");

  it("acting inline is derived ONCE, so the two branches cannot disagree", () => {
    // Both the inline block and the fallback row read this one flag. Two separate
    // conditions is how the row comes to render twice, or not at all.
    expect(src).toMatch(/const inlineApprove =\s*\n?\s*pendingDevices === 1 && pendingDetail && onApproveDevice && onDeclineDevice/);
  });

  it("a caller with no handlers still gets the row", () => {
    // The defect I wrote first: gating the inline block on the handlers while the
    // fallback was gated on `pendingDevices > 1` meant one pending sign-in with no
    // handlers rendered NOTHING — the notification lost rather than degraded.
    expect(src).toMatch(/\{pendingDevices > 0 && !inlineApprove && \(/);
    expect(src).not.toMatch(/\{pendingDevices > 1 && \(/);
  });

  it("only ever offered for exactly ONE waiting sign-in", () => {
    // With two, a single Approve pair would act on one while describing both.
    expect(src).toMatch(/pendingDevices === 1 && pendingDetail/);
  });

  it("the inline row is not a button, because it contains buttons", () => {
    // Nested buttons are invalid HTML — the rule this repo follows on thread rows
    // and call tiles.
    const at = src.indexOf("{inlineApprove && (");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("{pendingDevices > 0 && !inlineApprove", at));
    // The `<li>`'s first element is a div, not a button. Asserted by looking at what
    // FOLLOWS the `<li>` rather than by a shape pattern — `codeOnly` has already
    // removed the comment in between, and an over-specified whitespace pattern fails
    // on correct code (it just did).
    // `codeOnly` collapses a JSX `{/* … */}` to a bare `{}`, so a "starts with"
    // check fails on correct code (it just did). The PROPERTY is that the row's own
    // container is a div — i.e. the first TAG after the `<li>` is not a button.
    const firstTag = /<([a-zA-Z]+)/.exec(block.slice(block.indexOf("<li>") + 4));
    expect(firstTag?.[1]).toBe("div");
    expect(block).toMatch(/onClick=\{\(\) => \{\s*\n?\s*setOpen\(false\);\s*\n?\s*inlineApprove\.approve/);
    expect(block).toMatch(/inlineApprove\.decline\(inlineApprove\.detail\.sid\)/);
  });

  it("Approve is the accent and Decline is destructive", () => {
    const at = src.indexOf("{inlineApprove && (");
    const block = src.slice(at, src.indexOf("{pendingDevices > 0 && !inlineApprove", at));
    expect(block).toMatch(/className="rcta rounded-full/);
    expect(block).toMatch(/border-destructive\/40[^"]*text-destructive/);
  });

  it("the empty state names what lands here", () => {
    // 5h. An empty panel that does not say what it is for reads as broken the first
    // time somebody opens it.
    //
    // REPOINTED THROUGH `copyOnScreen` (#159): this froze the two English LITERALS,
    // which the Arabic sweep moved into `dict/alerts.ts` — so as written it forbade
    // localising the panel while saying nothing about the property it stands for,
    // which is that the empty state still SAYS these two things. `copyOnScreen` is
    // satisfied by the literal OR by a key whose English half carries it, and is
    // strictly stronger than what it replaces: reaching the dictionary also proves
    // an Arabic half exists, because `Entry` requires both.
    for (const line of ["All caught up", "Missed calls, messages and sign-ins land here"]) {
      expect(copyOnScreen(src, line), whyCopyMissing(src, line)).toBe(true);
    }
  });

  it("the panel carries the sheet material and the board's mono header", () => {
    expect(src).toMatch(/className="rsheet max-md:fixed/);
    expect(src).toMatch(/letterSpacing: "\.26em"/);
  });
});

describe("board 2d — the handlers live where the query is", () => {
  const shell = code("app/AppShell.tsx");

  it("both bell mounts get them, so mobile and desktop cannot differ", () => {
    expect((shell.match(/onApproveDevice=\{approveDevice\}/g) || []).length).toBe(2);
    expect((shell.match(/onDeclineDevice=\{declineDevice\}/g) || []).length).toBe(2);
  });

  it("declining uses the SAME revoke the Devices list uses", () => {
    // A second "decline" mutation is how the panel and the Devices list come to mean
    // different things by the same word.
    expect(shell).toMatch(/const revokeSession = trpc\.otpAuth\.revokeSession\.useMutation\(\)/);
    expect(shell).toMatch(/const approveSession = trpc\.otpAuth\.approveSession\.useMutation\(\)/);
  });

  it("both refresh through one helper", () => {
    expect((shell.match(/refreshPending\(\);/g) || []).length).toBe(2);
    expect(shell).toMatch(/utils\.otpAuth\.pendingSessions\.invalidate\(\)/);
  });

  it("a failure is named rather than swallowed", () => {
    // A silent failure leaves somebody waiting on a device that will never be let
    // in, with nothing saying why.
    expect((shell.match(/onError: \(e\) => toast\.error\(/g) || []).length).toBe(2);
  });
});

describe("board 4g — guest restore", () => {
  const src = code("app/GuestRestore.tsx");

  it("the card is no longer green", () => {
    // Green means ONLINE in this app. "Welcome back" is not a presence claim.
    expect(src).not.toMatch(/--relay-online/);
    expect(src).toMatch(/var\(--rb, #3FE0C5\)/);
  });

  it("its accent fallbacks are LITERALS, never a self-reference", () => {
    // `var(--rb, var(--rb))` is a custom-property cycle, which resolves to the
    // guaranteed-invalid value — so the declaration is DROPPED and the card renders
    // with no border at all. That cycle bit v2.106.7; it must not come back here.
    expect(src).not.toMatch(/var\(--rb[^)]*var\(--rb/);
    expect(src).toMatch(/rgba\(var\(--rb-rgb, 63, 224, 197\), 0\.32\)/);
  });

  it("shows the guest badge the board draws", () => {
    // A stranded recovery record can only ever name an UNCLAIMED identity, so
    // "guest" is a fact here rather than a guess.
    expect(src).toMatch(/<RoleBadge role="guest" \/>/);
  });

  it("the age comes from the browser's own note and reuses the shared formatter", () => {
    // The server returns no timestamp. `formatElapsedSince` is the app's one
    // duration formatter, so this card and the dialer preview cannot describe the
    // same span differently.
    expect(src).toMatch(/formatElapsedSince\(record\.savedAt, Date\.now\(\)\)/);
    expect(src).toMatch(/Saved \{savedAgo\}/);
  });

  it("a missing or impossible timestamp renders nothing rather than an absurdity", () => {
    // A record written before `savedAt` existed carries 0; a clock that has gone
    // backwards would give a negative span.
    expect(src).toMatch(/record\.savedAt > 0 && record\.savedAt <= Date\.now\(\)/);
  });

  it("still forgets the key in exactly one place, and not on a failure path", () => {
    // The stored key is the ONLY copy in existence (v2.99.68). This release must not
    // have added a second call site while restyling around it.
    expect((src.match(/forgetGuestRecovery\(\)/g) || []).length).toBe(1);
  });
});
