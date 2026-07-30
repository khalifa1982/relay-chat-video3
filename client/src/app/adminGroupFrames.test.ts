/**
 * BOARDS 2h (admin console) AND 2i (group info).
 *
 * These two files hold more consequential decisions than any other pair of screens in
 * the app: one can delete a person and change account types, the other mints a bearer
 * capability that admits strangers to a group. A RESTYLE is exactly the change that
 * quietly drops such a decision, because nothing about the layout depends on it — so
 * this file pins the properties that would cost somebody something, and nothing about
 * how either screen looks.
 *
 * Every assertion below stands for a specific recorded decision. Where one is a
 * security property rather than a nicety, it says so.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { codeOnly } from "../../../server/testing/codeOnly";

const ADMIN = codeOnly(readFileSync("client/src/pages/app/Admin.tsx", "utf8"));
const GROUP = codeOnly(readFileSync("client/src/app/GroupInfoSheet.tsx", "utf8"));

describe("board 2h — the admin panel did not quietly widen", () => {
  it("its tRPC surface is EXACTLY this set", () => {
    /* v2.99.91/v2.99.99: the panel's capabilities are enumerated so that adding one is
       a deliberate act rather than something that arrives with a restyle. This is the
       guard that turned red — correctly — when guest→registered was added, and it is
       the reason that widening got a decision instead of a shrug. */
    const found = [...new Set([...ADMIN.matchAll(/trpc\.admin\.([a-zA-Z]+)/g)].map((m) => m[1]))].sort();
    expect(found).toEqual([
      "amIAdmin",
      "clearGuestRegistrationInvite",
      "deleteIdentity",
      "findIdentities",
      "inviteGuestRegistration",
      "mediaDiagnostics",
      "pushDiagnostics",
      "sendTestPush",
      "setAccountType",
      "setIdentityNumber",
    ]);
  });

  it("the panel is gated on a SERVER answer, never on the cached whoami role", () => {
    // A role that has been through the browser is a rendering hint, never a permission.
    expect(ADMIN).toMatch(/trpc\.admin\.amIAdmin/);
  });

  it("DELETE still confirms by typing the number, not with a Yes/No", () => {
    /* v2.100.0, and the reasoning is specific: the panel lists several people at once
       with a Delete button in the same place on each row, so a plain confirm protects
       against hesitation but NOT against acting on the wrong row — which is the mistake
       that actually happens here. */
    expect(ADMIN).toMatch(/confirmNum/);
    /* The button must be gated on the typed value MATCHING THAT ROW'S number. Pinned as
       the comparison, because asserting the input merely EXISTS says nothing about
       whether it decides anything (the recurring survivor class).

       The typed value is NORMALIZED before comparing — my first version of this
       assertion demanded a bare `confirmNum !== r.number` and failed on correct code,
       because the panel strips spacing and grouping first. That is right rather than
       lax: the app DISPLAYS numbers as `114-212`, so refusing the form it just showed
       you would be the panel arguing with itself. So the pin allows a normalizing call
       and requires only that the comparison is against `r.number`. */
    expect(ADMIN).toMatch(/confirmNum[^\n]*!==\s*r\.number/);
    // ...and it must gate the DISABLED state, not merely exist somewhere.
    const at = ADMIN.search(/confirmNum[^\n]*!==\s*r\.number/);
    const around = ADMIN.slice(Math.max(0, at - 200), at + 200);
    expect(around).toMatch(/disabled/);
  });

  it("the typed value is scoped to ONE row, so it cannot arm a different person's Delete", () => {
    // `confirmNum` is shared state across rows, so opening a second row's panel must not
    // inherit a number typed for the first — otherwise one tap deletes the wrong person.
    expect(ADMIN).toMatch(/setConfirmNum\(""\)/);
  });

  it("no push token is ever rendered in full", () => {
    /* v2.99.91: an FCM token plus the project key can push to that handset, so a device
       is reported as kind + length + a short prefix — enough to tell two devices apart,
       not enough to address either. A restyle that printed the whole token would leak a
       credential to anyone looking over a shoulder. */
    expect(ADMIN).not.toMatch(/\.token\b(?!Prefix|Kind|Len)/);
  });
});

describe("board 2i — the invite link is still a deliberate act", () => {
  it("NO link is minted on sheet open — only on an explicit tap", () => {
    /* v2.105.9: generating one when the sheet opens would put a live bearer capability
       on screen for anybody who merely looked at the group's details. Pinned as "the
       mint happens in an onClick", which a mount-time effect cannot satisfy. */
    expect(GROUP).toMatch(/onClick=\{\(\) => create\.mutate\(/);
    // ...and it must not be reachable from an effect at all.
    const mints = [...GROUP.matchAll(/create\.mutate\(/g)].length;
    expect(mints, "more than one mint site is a second way to leak a link").toBe(1);
  });

  it("the audience the admin picked actually reaches the mint", () => {
    /* v2.105.23 found this by mutation: dropping `audience` from the call made the
       picker DECORATION — every link minted OPEN whatever the admin selected, with
       nothing on screen saying so. That is a security regression disguised as a no-op. */
    expect(GROUP).toMatch(/create\.mutate\(\{\s*conversationId,\s*audience\s*\}\)/);
  });

  it("the invite section is ABSENT for a non-admin, not shown disabled", () => {
    /* The v2.103.3 rule: a control that looks live and always refuses is worse than one
       that is not there. Minting is admin-only because it admits strangers to a shared
       group. */
    /* PINNED ON THE MOUNT ITSELF, and that specificity is the whole assertion. My first
       version matched any `iAmAdmin &&`, and there are FOUR in this file — the three
       per-member role/remove controls satisfied it while the gate on the invite section
       was deleted, so the pin stayed green with a bearer capability that admits
       strangers on screen for every ordinary member. Proven by mutation. */
    expect(GROUP).toMatch(/\{\s*iAmAdmin\s*&&\s*<InviteLinkSection\b/);
    // Exactly one mount, so a second ungated one cannot be added beside it.
    expect([...GROUP.matchAll(/<InviteLinkSection\b/g)].length).toBe(1);
    // And a constant-true gate is forbidden — `{true && …}` would pass the shape above
    // while granting it to everybody.
    expect(GROUP).not.toMatch(/\{\s*true\s*&&\s*<InviteLinkSection\b/);
  });

  it("revoke says what actually happens — members who joined stay", () => {
    // Somebody would otherwise reasonably assume revoking a link ejects whoever used it.
    expect(GROUP).toMatch(/revoke/i);
    expect(GROUP.toLowerCase()).toMatch(/stay|remain|already joined/);
  });

  it("the group's 6-digit id cannot be reordered by an RTL name", () => {
    /* A group id is a NUMBER sitting next to a title that may be Arabic. Without the
       isolation the digits reorder (v2.99.77's PinTag lesson, v2.102.0 for groups). */
    expect(GROUP).toMatch(/dir="ltr"/);
    expect(GROUP).toMatch(/unicode-bidi:isolate/);
  });

  it("the creator's tag is gold, and keeps the APP's word rather than the frame's", () => {
    /* The frame writes this tag "OWNER". The app has called it "Creator" since v2.104.0,
       where adminship is DERIVED from having created the group — so the sheet keeps
       "Creator" and the board item is deliberately declined. My first version of this
       assertion demanded the frame's word and failed on correct code, which is the
       useful direction to be wrong in: a frame's label must not silently rename a role
       the app already has a settled word for.

       Gold because gold already means admin/owner/locked across the app. */
    expect(GROUP).toMatch(/#e8c94a/);
    expect(GROUP).toMatch(/Creator/);
    expect(GROUP).toMatch(/isCreator/);
    expect(GROUP).not.toMatch(/>OWNER</);
  });
});

describe("board 4j — the video sheet still gives the camera back", () => {
  const VIDEO = codeOnly(readFileSync("client/src/app/VideoRecordSheet.tsx", "utf8"));

  it("the camera is released on EVERY exit, not just on a clean finish", () => {
    /* v2.99.39 is the owner reporting "when I finish the call and I minimize the
       browser, the mic and the camera is still active, I cannot even have another
       call". A restyle of a capture surface is precisely where a release path gets
       dropped, and the cost is somebody's camera light staying on. */
    expect([...VIDEO.matchAll(/getTracks\(\)\.forEach|\.stop\(\)/g)].length).toBeGreaterThanOrEqual(2);
    // An unmount must release too — a sheet closed mid-record must not leak the stream.
    expect(VIDEO).toMatch(/useEffect\([\s\S]{0,600}?return \(\) =>/);
  });

  it("it does not spend the presence green on a recording state", () => {
    // Recording is ACTIVE, which is what the accent means since v2.106.6; red is the
    // older-than-this-app convention for "recording" and does not collide here.
    expect(VIDEO).not.toMatch(/--relay-online/);
  });

  it("no accent fallback is a cycle and no class is composed", () => {
    expect(VIDEO).not.toMatch(/var\(--rb[a-z-]*,\s*var\(--rb/);
    for (const m of VIDEO.matchAll(/className=\{`([^`]*)`\}/g)) {
      for (const inner of m[1].matchAll(/\$\{([^}]*)\}/g)) {
        const expr = inner[1].trim();
        expect(/["']/.test(expr) || /^[A-Z][A-Z0-9_]*$/.test(expr), expr.slice(0, 50)).toBe(true);
      }
    }
  });
});

describe("both frames — the palette rules", () => {
  it("neither spends the presence green on something that is not presence", () => {
    /* Six frames have now made this mistake. The ONE legitimate use in Admin is the dot
       beside the "Online" stat, which counts people who are online — so this asserts the
       COUNT of uses and that each sits next to a presence fact, rather than banning the
       token outright, which would be wrong. */
    const adminUses = [...ADMIN.matchAll(/--relay-online/g)].length;
    expect(adminUses, "unexpected --relay-online uses in Admin").toBeLessThanOrEqual(2);
    // The tile that carries the live dot must be the Online one.
    expect(ADMIN).toMatch(/label: "Online"[^}]*live: true/);
    // No other stat may claim to be live.
    expect([...ADMIN.matchAll(/live: true/g)].length).toBe(1);
    // The group sheet makes no presence claim of its own beyond the member rows' own
    // shared LED rule, so it must not hand-roll the token.
    expect(GROUP).not.toMatch(/--relay-online/);
  });

  it("no accent fallback is a custom-property cycle", () => {
    // `var(--rb, var(--rb))` resolves to the guaranteed-invalid value and the browser
    // DROPS the declaration — no colour at all rather than a plain one (v2.106.7).
    expect(ADMIN).not.toMatch(/var\(--rb[a-z-]*,\s*var\(--rb/);
    expect(GROUP).not.toMatch(/var\(--rb[a-z-]*,\s*var\(--rb/);
  });

  it("no class name is assembled from a composed value", () => {
    // Interpolating a CHOICE between complete literals is fine — both appear in source
    // so the JIT sees them. Composing a value is not, and comes out unstyled.
    for (const [name, src] of [["Admin", ADMIN], ["GroupInfoSheet", GROUP]] as const) {
      for (const m of src.matchAll(/className=\{`([^`]*)`\}/g)) {
        for (const inner of m[1].matchAll(/\$\{([^}]*)\}/g)) {
          const expr = inner[1].trim();
          // Either a quoted literal (a choice) or a bare UPPER_CASE constant, which is
          // itself a static string this file declares.
          const okShape = /["']/.test(expr) || /^[A-Z][A-Z0-9_]*$/.test(expr);
          expect(okShape, `${name}: composed class \`${expr.slice(0, 60)}\``).toBe(true);
        }
      }
    }
  });

  it("any animation moves only transform or opacity", () => {
    // The standing guard (v2.106.18) covers keyframes in the shared stylesheets; these
    // two files are Tailwind-only, so the check is that they declare no keyframes of
    // their own animating a repainting property.
    for (const src of [ADMIN, GROUP]) {
      expect(src).not.toMatch(/@keyframes[\s\S]{0,400}?(box-shadow|background-position|border-color|filter)\s*:/);
    }
  });
});
