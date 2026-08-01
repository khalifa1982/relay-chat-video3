/**
 * v2.102.1 — the editor for a group's own name, photo and status.
 *
 * v2.102.0 shipped the data (a 6-digit group id, an avatar, a status from the shared
 * vocabulary), the guarded write endpoint and every READ surface — but nothing in the
 * app called it, so a member could not pick any of it from a screen. This is that
 * screen.
 *
 * THE LOAD-BEARING PROPERTY IS NOT THE SHEET — IT IS THAT NOTHING WAS DUPLICATED.
 * A group's status and a person's are the same vocabulary (v2.101.1) and a group's
 * photo goes through the same upload pipeline as a person's (v2.99.2). Two copies of
 * either is how the two surfaces come to look and behave differently one edit at a
 * time — and v2.99.89 found a DEAD duplicate upload path in Profile doing exactly
 * that. So the picker is EXTRACTED and the avatar picker's save sink is INJECTED, and
 * these tests assert the absence of a second copy rather than the presence of a first.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./testing/codeOnly";
import { copyOnScreen } from "./testing/copyOnScreen";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const PICKER = read("client/src/app/ProfileStatusPicker.tsx");
const SHEET = read("client/src/app/GroupInfoSheet.tsx");
const AVATAR = read("client/src/app/AvatarPicker.tsx");
const SECTIONS = read("client/src/pages/app/ProfileHubSections.tsx");
const MESSAGES = read("client/src/pages/app/Messages.tsx");
const ROUTERS = read("server/v2routers.ts");


describe("one status picker, two owners of the mutation", () => {
  it("the picker is its own component and there is exactly one of it", () => {
    expect((PICKER.match(/export function ProfileStatusPicker/g) || []).length).toBe(1);
  });

  it("BOTH callers render the shared one rather than their own grid", () => {
    expect(SECTIONS).toMatch(/<ProfileStatusPicker/);
    expect(SHEET).toMatch(/<ProfileStatusPicker/);
    // The five-button grid can only exist in the shared component. If either caller
    // maps the metadata itself, the extraction has been undone.
    expect((PICKER.match(/PROFILE_STATUS_META\.map/g) || []).length).toBe(1);
    expect(codeOnly(SECTIONS)).not.toMatch(/PROFILE_STATUS_META/);
    expect(codeOnly(SHEET)).not.toMatch(/PROFILE_STATUS_META/);
  });

  it("each caller owns ONLY its own mutation — the picker owns none", () => {
    // The picker must stay presentational, or "which endpoint does this write to"
    // becomes a branch inside it and the group and the person start sharing a
    // decision that is not theirs to share.
    expect(codeOnly(PICKER)).not.toMatch(/useMutation|trpc\./);
    expect(SECTIONS).toMatch(/useProfileSave/);
    expect(SHEET).toMatch(/trpc\.messages\.setGroupProfile\.useMutation/);
  });

  it("the note's follow-the-server rule lives in the picker, so the 2nd caller inherits it", () => {
    // A refetch must not erase a note somebody is halfway through typing. Kept in the
    // shared component rather than restated per caller, which is what makes it a
    // property rather than something the next caller has to remember.
    expect(PICKER).toMatch(/if \(!editing\) setDraft\(note \?\? ""\)/);
    expect(PICKER).toMatch(/onFocus=\{\(\) => setEditing\(true\)\}/);
    expect(codeOnly(SHEET)).not.toMatch(/setEditing\b/);
  });

  it("tapping the current status clears it, and both callers honour the null", () => {
    expect(PICKER).toMatch(/onClick=\{\(\) => onPick\(on \? null : key\)\}/);
    // A caller that dropped the null would leave somebody unable to clear a status.
    expect(SECTIONS).toMatch(/profileStatus: k \?\? ""/);
    expect(SHEET).toMatch(/profileStatus: k \?\? ""/);
  });

  it("a group's empty hint is its own — 'presence decides' means nothing for a group", () => {
    // A group has no presence, so the person-shaped hint would be a false statement
    // about what an empty status implies.
    expect(PICKER).toMatch(/emptyHint\?: string/);
    expect(SHEET).toMatch(/emptyHint=/);
  });

  it("colour stays inline, never a runtime-composed Tailwind class", () => {
    expect(PICKER).toMatch(/style=\{on \? \{ borderColor: color/);
    expect(codeOnly(PICKER)).not.toMatch(/border-\[\$\{/);
  });
});

describe("one avatar picker, with the save sink injected", () => {
  it("the sink is optional and DEFAULTS to the identity path", () => {
    // The default is what keeps every existing call site byte-identical. A required
    // prop would have meant touching Profile and the registration screen too.
    expect(AVATAR).toMatch(/onSave\?: \(url: string \| null\) => Promise<void>/);
    const save = AVATAR.slice(AVATAR.indexOf("async function save("), AVATAR.indexOf("async function pickEmoji("));
    expect(save.length).toBeGreaterThan(120);
    expect(save).toMatch(/if \(onSave\) \{/);
    expect(save).toMatch(/await updateProfile\.mutateAsync\(\{ avatarUrl: url \}\)/);
    expect(save).toMatch(/utils\.identity\.whoami\.invalidate\(\)/);
  });

  it("the group passes its own sink, and does NOT write the caller's identity", () => {
    expect(SHEET).toMatch(/onSave=\{async \(url\) => \{/);
    expect(SHEET).toMatch(/save\.mutateAsync\(\{ conversationId, avatarUrl: url \}\)/);
    // Writing the member's own avatarUrl when they set a group photo would replace
    // their face with the group's everywhere.
    expect(codeOnly(SHEET)).not.toMatch(/identity\.updateProfile/);
  });

  it("there is exactly ONE upload pipeline — the sheet re-implements none of it", () => {
    // The whole reason the sink is injected. A second copy would duplicate the emoji
    // renderer, the animated-GIF path, the 4 MB cap and the mime check.
    expect(SHEET).toMatch(/<AvatarPicker/);
    expect(codeOnly(SHEET)).not.toMatch(/uploadAvatarImage|renderEmojiAvatar|renderAnimatedEmojiAvatar/);
    expect(AVATAR).toMatch(/uploadAvatarImage/);
  });

  it("the picker's copy is parameterised, so a group is not called 'your photo'", () => {
    expect(AVATAR).toMatch(/title = "Choose your avatar"/);
    expect(AVATAR).toMatch(/removeLabel = "your photo"/);
    // Anchored on the prop boundary: an unanchored /title="…"/ is a SUBSTRING of
    // `data-title="…"`, so renaming the prop used to pass (caught by mutation).
    /* REPOINTED THROUGH `copyOnScreen` (#156): both strings moved into `dict/groups.ts`,
       so the prop is now `title={t("groups.choosePhoto")}`. The property is unchanged —
       this sheet passes GROUP wording rather than inheriting the picker's "your photo" —
       and asking it this way is strictly stronger, because reaching the dictionary also
       proves an Arabic half exists. The prop BOUNDARY is still pinned separately below,
       which is what the old anchoring was for. */
    expect(copyOnScreen(SHEET, "Choose a group photo")).toBe(true);
    expect(copyOnScreen(SHEET, "the group photo")).toBe(true);
    expect(SHEET).toMatch(/(?:^|\s)title=\{t\("groups\./m);
    expect(SHEET).toMatch(/(?:^|\s)removeLabel=\{t\("groups\./m);
  });
});

describe("the sheet itself", () => {
  it("it gates nothing — membership is the SERVER's check", () => {
    // A client-side check on a row several people share is a suggestion, not a rule,
    // and having one here would imply the server's could be relaxed.
    const proc = ROUTERS.slice(ROUTERS.indexOf("  setGroupProfile: publicProcedure"), ROUTERS.indexOf("  createGroup: publicProcedure"));
    expect(proc.length).toBeGreaterThan(400);
    expect(proc).toMatch(/requireIdentity\(ctx\)/);
    expect(proc).toMatch(/setGroupProfile\(input\.conversationId, me\.id/);
  });

  it("nothing is optimistic — it writes a row other people are looking at", () => {
    // A failure already painted as success would leave this member believing they
    // renamed a group everybody else still sees under the old name.
    expect(codeOnly(SHEET)).not.toMatch(/onMutate/);
    expect(SHEET).toMatch(/onError:/);
  });

  it("BOTH reads are invalidated, because the thread list shows the same fields", () => {
    // Invalidating one would leave the other advertising what was just changed —
    // the v2.99.87 defect, where only the feed was refreshed.
    expect(SHEET).toMatch(/utils\.messages\.threads\.invalidate\(\)/);
    expect(SHEET).toMatch(/utils\.messages\.conversationInfo\.invalidate\(\{ conversationId \}\)/);
  });

  it("the name field cannot be erased by a refetch mid-edit either", () => {
    expect(SHEET).toMatch(/if \(!editingName\) setName\(title \?\? ""\)/);
    expect(SHEET).toMatch(/onFocus=\{\(\) => setEditingName\(true\)\}/);
    // …and an unchanged name is not written at all.
    expect(SHEET).toMatch(/if \(next === \(title \?\? ""\)\) return;/);
  });

  it("the group id renders LTR and grouped, like every number in the app", () => {
    // Pinned on the ID's OWN element. A bare /dir="ltr"/ was satisfied by the member
    // rows' numbers, so deleting it from the id itself passed (caught by mutation).
    // BOUNDED BY THE BUTTON'S OWN CLOSING TAG (v2.105.9). It used to end at the first
    // `<span className="sr-only">`, and v2.105.9 added an invite-link section ABOVE this
    // component containing one — so the end anchor moved BEFORE the start and the slice
    // silently became `""`. The `length > 80` guard below is what caught it, which is
    // why that guard exists; the fix is an anchor that cannot be preceded, namely the
    // element's own terminator.
    const btnStart = SHEET.indexOf("onClick={copyNumber}");
    expect(btnStart).toBeGreaterThan(-1);
    const btn = SHEET.slice(btnStart, SHEET.indexOf("</button>", btnStart));
    expect(btn.length).toBeGreaterThan(80);
    expect(btn).toMatch(/dir="ltr"/);
    expect(btn).toMatch(/\{number\.slice\(0, 3\)\}-\{number\.slice\(3\)\}/);
    // Every number-bearing element carries it, so an RTL locale cannot reorder any of
    // them. REWRITTEN IN v2.105.9 FROM A FIXED COUNT OF 2 TO THE PROPERTY ITSELF: the
    // count went stale the moment an unrelated LTR island (the invite link, which is a
    // URL and not a number) was legitimately added, and it never expressed the property
    // anyway — a count rises equally for an addition that DOES carry `dir` and cannot
    // fall for a number rendered WITHOUT one. So each number carrier is now named.
    const memberNum = SHEET.slice(SHEET.indexOf("{m.number}") - 240, SHEET.indexOf("{m.number}"));
    expect(memberNum).toMatch(/dir="ltr"/);
    // …and there are still exactly two places a NUMBER is rendered, so a third arriving
    // without the attribute has to come through this test.
    const numberSites =
      (codeOnly(SHEET).match(/\{m\.number\}|\{number\.slice\(0, 3\)\}/g) || []).length;
    expect(numberSites).toBe(2);
    // COUNTED ON STRIPPED CODE where a count is used at all: the comment above the id
    // explains the rule and therefore contains the string, so counting the raw file read
    // 3 and failed — the prose trap, for the eleventh time in this repo.
    expect((codeOnly(SHEET).match(/dir="ltr"/g) || []).length).toBeGreaterThanOrEqual(numberSites);
    // A group created before v2.102.0 has none, and says so rather than showing a gap.
    expect(copyOnScreen(SHEET, "no ID")).toBe(true);
  });

  it("a broken group photo falls back to the glyph, not the browser's icon", () => {
    const imgs = SHEET.match(/onError=\{\(e\) => \{/g) || [];
    // The hero photo and each member's photo.
    expect(imgs.length).toBeGreaterThanOrEqual(2);
    expect(SHEET).toMatch(/<Users className="size-10" \/>/);
  });

  it("the roster is managed here, through the ONE conversation-membership writer", () => {
    // REWRITTEN v2.105.16 (#108). v2.102.1 pinned this list as READ-ONLY, and the reason
    // it gave is the one that still matters: "two ways to change who is in a group is two
    // places that can disagree about it." The owner asked for add/remove by hand, so the
    // list is no longer read-only — but that concern is honoured rather than dropped,
    // because the two things are different domains: the CALL screen's add-person puts
    // somebody in a signaling ROOM, while this puts them in the CONVERSATION, and
    // conversation membership still has exactly one writer (`admitGroupMember`), asserted
    // in groupInvite.test.ts.
    //
    // So what this pin now checks is that the sheet reaches the SERVER for every roster
    // change and invents no membership rule of its own.
    expect(SHEET).toMatch(/trpc\.messages\.conversationInfo\.useQuery/);
    expect(SHEET).toMatch(/trpc\.messages\.addGroupMember\.useMutation/);
    expect(SHEET).toMatch(/trpc\.messages\.removeGroupMember\.useMutation/);
    expect(SHEET).toMatch(/trpc\.messages\.setGroupMembersCanAdd\.useMutation/);
    // Nothing is optimistic: each write invalidates and re-reads rather than painting a
    // roster change this member cannot know landed for everybody else.
    for (const m of ["addMember", "removeMember", "setCanAdd"]) {
      const at = SHEET.indexOf(`const ${m} = trpc.messages.`);
      expect(at, `${m} should be declared`).toBeGreaterThan(-1);
      const decl = SHEET.slice(at, at + 900);
      expect(decl, `${m} re-reads rather than guessing`).toMatch(
        /utils\.messages\.conversationInfo\.invalidate/,
      );
      expect(decl, `${m} is not optimistic`).not.toMatch(/onMutate/);
    }
  });

  it("the destructive half is admin-only and never offered where it cannot work", () => {
    // Removing is admin-only with NO toggle, and withheld against the creator (their
    // adminship is derived from having made the group, so no write could restore it) and
    // against yourself (that is leaving, which does not exist yet). The server refuses all
    // three regardless; this is about not offering them.
    expect(SHEET).toMatch(/\{iAmAdmin && !m\.isCreator && !m\.isMe && \(/);
    // Adding widens to a plain member ONLY on the server's own answer, never inferred.
    expect(SHEET).toMatch(/\{\(iAmAdmin \|\| info\.data\?\.membersCanAdd\) && \(/);
    // And the toggle itself stays admin-only.
    expect(SHEET).toMatch(/\{iAmAdmin && \(\s*\n\s*<button[\s\S]{0,200}role="switch"/);
  });

  it("closing the sheet cannot unmount an OPEN avatar picker", () => {
    // The original assertion compared indexes against the last `</div>`, which is a
    // fragile proxy: a mutation that moved the picker into dead code after the sheet
    // still satisfied it. Worse, the code did NOT have this property — a bare
    // `if (!open) return null` unmounts the picker with the sheet. Both are fixed:
    // the early return tolerates an open picker, and the BODY is gated instead.
    expect(SHEET).toMatch(/if \(!open && !pickingAvatar\) return null;/);
    expect(SHEET).toMatch(/\{open && \(/);
    // …and the picker is a sibling of the gated body, not inside it.
    const body = SHEET.slice(SHEET.indexOf("{open && ("), SHEET.indexOf("<AvatarPicker"));
    expect(body).toMatch(/\n      \)\}\n/);
  });

  it("the status write derives NO presence for a group", () => {
    // A group has no presence, so there is nothing for an availability to describe.
    // Asserted on the SERVER function, which is where a derivation would have to live.
    const fn = ROUTERS.slice(ROUTERS.indexOf("  setGroupProfile: publicProcedure"), ROUTERS.indexOf("  createGroup: publicProcedure"));
    expect(codeOnly(fn)).not.toMatch(/statusOverride|overrideForStatus/);
  });
});

describe("the way in", () => {
  it("the group header tap opens the sheet — it did nothing for a group before", () => {
    expect(MESSAGES).toMatch(/const openHeader = \(\) => \{/);
    const fn = MESSAGES.slice(MESSAGES.indexOf("const openHeader = () => {"));
    const body = fn.slice(0, fn.indexOf("\n  };"));
    expect(body).toMatch(/if \(isGroup\) setGroupInfoOpen\(true\)/);
    // …and a DM still opens the peer profile, so nothing was traded away.
    expect(body).toMatch(/openPeerProfile\(thread\.peerNumber, peerProfileChat\)/);
  });

  it("ONE handler serves both kinds, wired to click AND keyboard", () => {
    // Two handlers is two places that can come to disagree about which tap does what.
    expect((MESSAGES.match(/const openHeader = \(\) => \{/g) || []).length).toBe(1);
    expect(MESSAGES).toMatch(/onClick=\{openHeader\}/);
    expect(MESSAGES).toMatch(/openHeader\(\);/);
    // The header is focusable for a group now, not only for a DM.
    expect(MESSAGES).toMatch(/role=\{isGroup \|\| thread\?\.peerNumber \? "button" : undefined\}/);
    expect(MESSAGES).toMatch(/tabIndex=\{isGroup \|\| thread\?\.peerNumber \? 0 : undefined\}/);
  });

  it("the header disc shows the group's own photo", () => {
    // It drew the generic glyph even for a group WITH a picture, so the thread row and
    // the conversation's own header disagreed about the same group.
    /* REWRITTEN (v2.106.89): this froze the raw `<img>` ternary, which was itself the
       shape that made a CHANGED photo invisible and left a hole on failure. The property
       is only that the header renders the group's OWN photo rather than a generic glyph. */
    const hdr = MESSAGES.slice(MESSAGES.indexOf('<div className="relative shrink-0">'));
    expect(hdr.slice(0, 1400)).toMatch(/<GroupAvatar\s+url=\{thread\?\.groupAvatarUrl\}/);
  });

  it("the sheet only mounts for a group", () => {
    expect(MESSAGES).toMatch(/\{isGroup && \(\s*\n\s*<GroupInfoSheet/);
  });
});
