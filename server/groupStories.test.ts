import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "./testing/codeOnly";
import {
  personReelKey,
  personReelKeyByNumber,
  groupReelKey,
  reelKeyKind,
} from "../shared/reelKey";

const R = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const V2DB = R("server/v2db.ts");
const ROUTERS = R("server/v2routers.ts");
const SCHEMA = R("drizzle/schema.ts");
const STATUS = R("client/src/pages/app/Status.tsx");
const OVERLAYS = R("client/src/app/PeerOverlays.tsx");
const MSG = R("client/src/pages/app/Messages.tsx");


/** A function's body, matched EXACTLY by name and bounded by the next export.
 *  A prefix match is what v2.104.0 broke in six files by adding
 *  `deleteMessageAsGroupAdmin` beside `deleteMessage`. */
function fn(src: string, name: string): string {
  const at = src.search(new RegExp(`export async function ${name}\\b`));
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const end = src.indexOf("\nexport ", at + 10);
  const out = src.slice(at, end === -1 ? undefined : end);
  expect(out.length, `${name} body is empty`).toBeGreaterThan(120);
  return out;
}

/** One tRPC procedure's body, bounded by the NEXT procedure rather than by a
 *  fixed slice — the unbounded/fixed-slice fragility this repo has been bitten
 *  by five times, most recently in v2.105.2. */
function proc(name: string, next: string): string {
  const at = ROUTERS.indexOf(`  ${name}: publicProcedure`);
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  const end = ROUTERS.indexOf(`  ${next}:`, at + 10);
  expect(end, `${next} not found after ${name}`).toBeGreaterThan(at);
  const out = ROUTERS.slice(at, end);
  expect(out.length, `${name} slice collapsed`).toBeGreaterThan(200);
  return out;
}

/**
 * v2.105.6 — #110: a GROUP can have a story.
 *
 * Owner, on the previously-declined list: *"DO IT"*.
 *
 * The declining reason (v2.102.1) was true and is now obsolete: `statuses.identityId`
 * is notNull with no conversation reference, so a story belonged to a PERSON and a
 * group could not post one — which is also why the group story ring "would signify
 * nothing". This release adds the addressee, and the ring now means something.
 *
 * WHAT THE TESTS BELOW ARE MOSTLY ABOUT is not the feature. It is the two ways a
 * group story can escape the group it was posted to, and the one way a group can be
 * mistaken for a person.
 */
describe("v2.105.6 — the schema is additive and reads correctly for every existing row", () => {
  it("one nullable column, applied by the boot migrator, plus its index", () => {
    expect(SCHEMA).toMatch(/conversationId: int\("conversationId"\),/);
    expect(V2DB).toMatch(/column: "conversationId", ddl: "ADD COLUMN `conversationId` int"/);
    expect(SCHEMA).toMatch(
      /convoIdx: index\("statuses_convo_idx"\)\.on\(t\.conversationId, t\.expiresAt\)/,
    );
  });

  it("the column is NOT NULL-free and has no DEFAULT — so NULL means 'personal'", () => {
    // NULL is exactly the reading every pre-release row needs, which is what makes
    // the migration a no-op rather than a backfill.
    const st = SCHEMA.slice(SCHEMA.indexOf("export const statuses"), SCHEMA.indexOf("export type Status ="));
    const col = st.slice(st.indexOf('conversationId: int("conversationId")'));
    expect(col.slice(0, 60)).not.toMatch(/notNull|default/);
  });

  it("`identityId` still means the AUTHOR and stays notNull", () => {
    // A group does not write; a member does, and the viewer needs to know which
    // member. Making this nullable to mean "the group posted it" would lose that.
    const st = SCHEMA.slice(SCHEMA.indexOf("export const statuses"), SCHEMA.indexOf("export type Status ="));
    expect(st).toMatch(/identityId: int\("identityId"\)\.notNull\(\)/);
  });
});

describe("v2.105.6 — posting to a group is gated SERVER-SIDE, before any write", () => {
  const post = proc("post", "feed");

  it("`post-story` is a MEMBER capability, and post uses that capability", () => {
    // Its own capability rather than borrowing `edit-profile`: the name has to say
    // what is being checked, and restricting it later must be one line in one place.
    const members = /const MEMBER_CAPABILITIES = new Set<GroupCapability>\(\[([^\]]*)\]\)/.exec(V2DB);
    expect(members).toBeTruthy();
    expect(members![1]).toContain('"post-story"');
    expect(post).toMatch(/checkGroupPermission\(input\.conversationId, me\.id, "post-story"\)/);
  });

  it("the membership check precedes the INSERT", () => {
    // A conversation id is a small sequential integer. Without this, anybody could
    // address a story to any group in the database — and membership is what
    // AUTHORIZES reading one, so it would publish into a room of strangers.
    const gateAt = post.indexOf("checkGroupPermission(");
    const insertAt = post.indexOf("await insertStatus({");
    expect(gateAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(insertAt);
  });

  it("a DM is refused BY NAME, and separately from 'not yours'", () => {
    // A DM borrows the peer's name, photo and status and has none of its own, so
    // there is nothing for a story to hang on; and the two refusals need different
    // next steps from the reader.
    expect(post).toMatch(/gate\.reason === "not-a-group"/);
    expect(post).toMatch(/Stories go to a group, not a direct chat\./);
    expect(post).toMatch(/That group isn't yours to post in\./);
  });

  it("'not a member' and 'no such group' answer IDENTICALLY", () => {
    // Otherwise the endpoint is an existence oracle over conversation ids.
    // `not-found` and `not-a-member` both fall through to the same message.
    const branch = post.slice(post.indexOf("const message ="), post.indexOf("throw new TRPCError", post.indexOf("const message =")));
    expect(branch).toMatch(/not-a-group/);
    expect(branch).toMatch(/unavailable/);
    // Only those two are named; everything else shares one wording.
    expect(branch).not.toMatch(/not-found/);
    expect(branch).not.toMatch(/not-a-member/);
  });

  it("an unavailable gate fails CLOSED, as a server error rather than a refusal", () => {
    // "We couldn't check" is not "you may not" — reporting it as FORBIDDEN would
    // send a legitimate member looking at their own membership.
    expect(post).toMatch(/gate\.reason === "unavailable" \? "INTERNAL_SERVER_ERROR" : "FORBIDDEN"/);
  });

  it("a personal post sends NO conversationId at all", () => {
    // So the request, the row and the fan-out are byte-identical to every
    // pre-v2.105.6 one.
    expect(post).toMatch(/conversationId: group\?\.id \?\? null/);
    expect(codeOnly(STATUS)).toMatch(/\.\.\.\(targetGroupId != null \? \{ conversationId: targetGroupId \} : \{\}\)/);
  });
});

describe("v2.105.6 — a group story cannot escape its group", () => {
  it("the PERSONAL query excludes group stories — and that is the leak guard", () => {
    /* THE SHARPEST FINDING IN THIS RELEASE. `getActiveStatusesForOwners` backs
       `getViewableStatusesOfOwner`, which backs `status.forNumber` — the
       profile-visit surface authorized by the CONTACTS rule. Without this filter,
       opening the profile of somebody in a group with you would hand you their group
       stories on the strength of merely having saved them, i.e. the story escapes via
       a completely different endpoint from the one carrying the membership check. */
    const f = fn(V2DB, "getActiveStatusesForOwners");
    expect(f).toMatch(/isNull\(statuses\.conversationId\)/);
    // And the chain that makes it load-bearing is really there.
    expect(fn(V2DB, "getViewableStatusesOfOwner")).toMatch(/getActiveStatusesForOwners\(\[ownerId\]\)/);
    expect(proc("forNumber", "viewers")).toMatch(/getViewableStatusesOfOwner\(me\.id, owner\.id\)/);
  });

  it("membership REPLACES the audience for a group story, rather than composing", () => {
    // `audience` describes a PERSONAL story's reach (my contacts, or everyone).
    // Neither meaning applies to a group story, so an author whose default happens
    // to say "everyone" must not make a twenty-member group's story world-readable.
    const f = fn(V2DB, "statusAudienceAuthorized");
    const groupAt = f.indexOf("if (conversationId != null)");
    const everyoneAt = f.indexOf('normalizeStatusAudience(audience) === "everyone"');
    expect(groupAt).toBeGreaterThan(-1);
    expect(everyoneAt).toBeGreaterThan(-1);
    expect(groupAt).toBeLessThan(everyoneAt);
    // The group branch RETURNS — it does not fall through into the contacts rule.
    const branch = f.slice(groupAt, everyoneAt);
    expect(branch).toMatch(/return !!member;/);
  });

  it("a block still outranks membership, in both directions", () => {
    // A block has always hidden statuses both ways and a shared group is no reason
    // to undo it — the same rule `messages.send` applies inside a group.
    const f = fn(V2DB, "statusAudienceAuthorized");
    const blockA = f.indexOf("isNumberBlockedBy(ownerId, requester.number)");
    const blockB = f.indexOf("isNumberBlockedBy(requesterId, owner.number)");
    const groupAt = f.indexOf("if (conversationId != null)");
    expect(blockA).toBeGreaterThan(-1);
    expect(blockB).toBeGreaterThan(-1);
    expect(blockA).toBeLessThan(groupAt);
    expect(blockB).toBeLessThan(groupAt);
  });

  it("membership is read LIVE, scoped to the caller, and by the pair key", () => {
    // Live rather than frozen at post time: somebody removed from a group should
    // stop seeing its stories, and somebody added should see the ones still inside
    // their 24h window. `conversation_participants` has NO surrogate id column —
    // its primary key IS the pair — so the projection names identityId.
    const f = fn(V2DB, "statusAudienceAuthorized");
    const branch = f.slice(f.indexOf("if (conversationId != null)"));
    expect(branch).toMatch(/eq\(conversationParticipants\.conversationId, conversationId\)/);
    expect(branch).toMatch(/eq\(conversationParticipants\.identityId, requesterId\)/);
    expect(branch).toMatch(/select\(\{ identityId: conversationParticipants\.identityId \}\)/);
  });

  it("the MEDIA gate threads the group through, or members lose their own photos", () => {
    // `authorizeStorageKey` judges a `/status_` key by the audience rule. Without
    // the group, a member would be refused the media of a story their own group
    // authorized — which renders as a broken image, not as an error.
    expect(V2DB).toMatch(/conversationId: statuses\.conversationId,/);
    const gate = V2DB.slice(V2DB.indexOf("if (/\\/status_/.test(storageKey))"));
    const call = gate.slice(gate.indexOf("statusAudienceAuthorized("), gate.indexOf(");", gate.indexOf("statusAudienceAuthorized(")));
    expect(call).toMatch(/st\.conversationId/);
  });

  it("markViewed and reply BOTH pass the group — the two that would fail silently", () => {
    // Without it a member's view is never recorded (the ring stays lit forever) and
    // their reply is refused with the generic "unavailable".
    const mv = proc("markViewed", "getPrivacy");
    expect(mv).toMatch(/statusAudienceAuthorized\(me\.id, st\.identityId, st\.audience, st\.conversationId\)/);
    const rp = ROUTERS.slice(ROUTERS.indexOf("  reply: publicProcedure"));
    expect(rp.slice(0, 6000)).toMatch(
      /statusAudienceAuthorized\(me\.id, st\.identityId, st\.audience, st\.conversationId\)/,
    );
  });

  it("`getActiveStatusesForConversations` is a PROJECTION, with no gate of its own", () => {
    // One predicate decides who may watch a group story. A second membership test
    // living in the query is how one surface comes to authorize what another refuses.
    const f = fn(V2DB, "getActiveStatusesForConversations");
    expect(f).toMatch(/inArray\(statuses\.conversationId, conversationIds\)/);
    expect(f).toMatch(/gt\(statuses\.expiresAt, new Date\(\)\)/);
    expect(codeOnly(f)).not.toMatch(/identityId/);
    expect(codeOnly(f)).not.toMatch(/conversationParticipants/);
  });

  it("the feed's group candidates come from MY OWN memberships", () => {
    const feed = proc("feed", "mine");
    expect(feed).toMatch(/getGroupConversationIdsFor\(me\.id\)/);
    expect(feed).toMatch(/getActiveStatusesForConversations\(myGroupIds\)/);
    // A group whose meta row did not come back (not kind="group") is DROPPED rather
    // than rendered under a placeholder name.
    expect(feed).toMatch(/if \(!g\) continue;/);
  });

  it("a blocked member contributes nothing, but never hides the whole group", () => {
    // A block is between two people. Dropping a whole group because one member in it
    // blocked me would hide nineteen other people's stories.
    const feed = proc("feed", "mine");
    expect(feed).toMatch(/hiddenAuthors/);
    expect(feed).toMatch(/blockedIdents\.has\(r\.identityId\)/);
    expect(feed).toMatch(/r\.identityId === me\.id \|\|/);
  });
});

describe("v2.105.6 — the realtime fan-out reaches the right people", () => {
  it("the CHOICE of audience lives in exactly one place", () => {
    // A group story reaches the group's members; a personal one reaches the contact
    // graph. Those are different queries, so the decision between them must be
    // single — a second call site picking for itself is how a group story comes to
    // be announced to the author's contacts, who cannot open it.
    const pub = ROUTERS.slice(
      ROUTERS.indexOf("async function publishStatusEvent("),
      ROUTERS.indexOf("export const v2StatusRouter"),
    );
    expect(pub.length).toBeGreaterThan(200);
    expect(pub).toMatch(/conversationId != null\s*\?\s*await getGroupStatusAudienceIds\(conversationId, ownerId\)/);
    expect(pub).toMatch(/: await getStatusAudienceIds\(ownerId, ownerNumber\)/);
    // Neither audience query appears anywhere else in the router.
    expect((ROUTERS.match(/getGroupStatusAudienceIds\(/g) ?? []).length).toBe(1);
    expect((ROUTERS.match(/getStatusAudienceIds\(/g) ?? []).length).toBe(1);
  });

  it("the group audience is the group's OTHER members", () => {
    const f = fn(V2DB, "getGroupStatusAudienceIds");
    expect(f).toMatch(/eq\(conversationParticipants\.conversationId, conversationId\)/);
    expect(f).toMatch(/filter\(\(id\) => id !== authorId\)/);
  });

  it("the event NAMES the group, not the author", () => {
    // The client renders "<name> posted a story"; for a group the newsworthy
    // subject is the group, matching where the ring appears.
    const pub = ROUTERS.slice(
      ROUTERS.indexOf("async function publishStatusEvent("),
      ROUTERS.indexOf("export const v2StatusRouter"),
    );
    expect(pub).toMatch(/name: conversationId != null \? \(groupName \|\| "A group"\) : ownerName/);
  });

  it("DELETE reads the row BEFORE destroying it, so the fan-out can find the group", () => {
    // Once the row is gone there is nothing left to say which group it belonged to,
    // and members would keep a stale ring for up to 24h.
    const rm = proc("remove", "markViewed");
    const readAt = rm.indexOf("await getActiveStatusById(input.id)");
    const delAt = rm.indexOf("await deleteStatus(input.id, me.id)");
    expect(readAt).toBeGreaterThan(-1);
    expect(delAt).toBeGreaterThan(-1);
    expect(readAt).toBeLessThan(delAt);
    expect(rm).toMatch(/before\?\.conversationId \?\? null/);
  });

  it("deleting stays AUTHOR-scoped — a group story is not a shared object", () => {
    // `deleteStatus` is unchanged: only its writer may remove it. A group admin
    // override is a separate capability nobody has asked for, and the story expires
    // in 24h regardless.
    const f = fn(V2DB, "deleteStatus");
    /* PINNED ON THE WRITE, AND COUNTED — the survivor this release's own mutation run
       found, and the FOURTH time this exact class has appeared here (v2.102.2,
       v2.103.0, v2.104.0). The clause occurs twice: once in the ownership SELECT and
       once in the DELETE, so a bare `toMatch` was satisfied by whichever one survived
       — stripping it from the SELECT left the test green. An unscoped DELETE lets
       anybody remove anybody's story, so the write is asserted specifically and the
       count catches a missing clause on EITHER side. */
    expect(f).toMatch(/\.delete\(statuses\)\.where\(and\(eq\(statuses\.id, id\), eq\(statuses\.identityId, ownerId\)\)\)/);
    expect((f.match(/eq\(statuses\.identityId, ownerId\)/g) ?? []).length).toBe(2);
    expect(codeOnly(f)).not.toMatch(/conversationParticipants|groupRole|checkGroupPermission/);
  });
});

describe("v2.105.6 — `mine` covers both kinds, because both are mine", () => {
  it("personal AND my group stories, with the personal query left strict", () => {
    // Relaxing `getActiveStatusesForOwners` to include group rows would have been
    // the small change and the wrong one — it also backs the profile-visit surface.
    const m = proc("mine", "remove");
    expect(m).toMatch(/getActiveStatusesForOwners\(\[me\.id\]\)/);
    expect(m).toMatch(/getActiveStatusesForConversations\(myGroupIds\)/);
    expect(m).toMatch(/\.filter\(\(r\) => r\.identityId === me\.id\)/);
  });
});

describe("v2.105.6 — a group is never mistaken for a person", () => {
  it("reel keys cannot collide across kinds, for any pair of ids", () => {
    // BEHAVIOURAL, because this is the property the whole discriminated shape rests
    // on and a source pin cannot tell you whether two keys can coincide. Identity id
    // 34 and conversation id 34 are unrelated; a group's 6-digit number comes out of
    // the same allocator as a person's.
    for (const n of [0, 1, 7, 34, 601586, 999999, 2 ** 31 - 1]) {
      expect(personReelKey(n)).not.toBe(groupReelKey(n));
      expect(personReelKeyByNumber(String(n))).not.toBe(groupReelKey(n));
      expect(personReelKeyByNumber(String(n))).not.toBe(personReelKey(n));
      expect(reelKeyKind(personReelKey(n))).toBe("person");
      expect(reelKeyKind(personReelKeyByNumber(String(n)))).toBe("person");
      expect(reelKeyKind(groupReelKey(n))).toBe("group");
    }
  });

  it("an unrecognised key is NOT read as a person", () => {
    // Guessing "person" is the direction that renders somebody's face on a group's
    // story. Null forces the reader to decide.
    for (const bad of ["", "p:", "g:", "34", "p:x", "person:34", "P:34", "g:1.5", "pn:abc"]) {
      expect(reelKeyKind(bad)).toBeNull();
    }
  });

  it("the server mints keys through the SHARED constructors", () => {
    // So the side that mints and the side that compares cannot disagree.
    expect(ROUTERS).toMatch(/key: personReelKey\(oid\)/);
    expect(ROUTERS).toMatch(/key: groupReelKey\(cid\)/);
    expect(ROUTERS).toMatch(/from "\.\.\/shared\/reelKey"/);
    expect(OVERLAYS).toMatch(/key: personReelKeyByNumber\(statusNumber\)/);
  });

  it("`isMe` is never true for a group reel", () => {
    // It drives "My story", the delete row and the chain skip — all about a person.
    const feed = proc("feed", "mine");
    const groupHalf = feed.slice(feed.indexOf('kind: "group" as const'));
    expect(groupHalf).toMatch(/isMe: false,/);
    expect(codeOnly(groupHalf)).not.toMatch(/isMe: [^f]/);
  });

  it("`mine` is PER-ITEM, so a group reel does not offer Delete on someone else's slide", () => {
    // Both ownership facts have always been per-item; the reel-level flag was only
    // ever a correct proxy because a reel had one author. `deleteStatus` is
    // author-scoped, so reading it off the reel would render a button that refuses.
    expect(ROUTERS).toMatch(/mine: own,/);
    expect(codeOnly(STATUS)).toMatch(/const isMine = item\?\.mine \?\? !!group\?\.subject\.isMe;/);
  });

  it("`author` is sent ONLY inside a group reel", () => {
    // On a personal reel it would restate the reel's own subject on every item —
    // this codebase has been bitten by shipping fields nobody consumes.
    expect(ROUTERS).toMatch(/\.\.\.\(author \? \{ author \} : \{\}\)/);
    const feed = proc("feed", "mine");
    const personalHalf = feed.slice(feed.indexOf("const reels: StatusReel[]"), feed.indexOf("const myGroupIds"));
    expect(personalHalf).toMatch(/publicStatus\(it, oid === me\.id\)\)/);
    const groupHalf = feed.slice(feed.indexOf('kind: "group" as const'));
    expect(groupHalf).toMatch(/publicStatus\(it, it\.identityId === me\.id, \{/);
  });

  it("the number→story map is PERSON-only", () => {
    // A group's number is the group's own id (v2.102.0), from the same allocator as
    // a person's — so feeding a group into a number-keyed map would draw a group's
    // ring on whoever happens to hold that number.
    const f = OVERLAYS.slice(OVERLAYS.indexOf("export function usePeerStatusMap"), OVERLAYS.indexOf("export function useGroupStatusMap"));
    expect(f).toMatch(/if \(g\.subject\.kind !== "person"\) continue;/);
  });

  it("the group→story map is keyed by CONVERSATION ID, not by number", () => {
    // A group created before v2.102.0 has no number at all, so a number-keyed map
    // would silently exclude exactly those groups.
    const f = OVERLAYS.slice(OVERLAYS.indexOf("export function useGroupStatusMap"), OVERLAYS.indexOf("export function PeerAvatar"));
    expect(f).toMatch(/Map<number, \{ hasUnseen: boolean; hasAny: boolean \}>/);
    expect(f).toMatch(/g\.subject\.conversationId == null\) continue/);
    expect(f).toMatch(/map\.set\(g\.subject\.conversationId,/);
  });

  it("the two openers are separate, and the group one takes an id", () => {
    expect(OVERLAYS).toMatch(/export function openPeerStatus\(number: string\)/);
    expect(OVERLAYS).toMatch(/export function openGroupStatus\(conversationId: number\)/);
    // The host locates a PERSON reel by number and a GROUP reel by conversation id,
    // each filtered by kind so one can never match the other.
    expect(OVERLAYS).toMatch(/g\.subject\.kind === "person" && g\.subject\.number === statusNumber/);
    expect(OVERLAYS).toMatch(/g\.subject\.kind === "group" && g\.subject\.conversationId === statusGroupId/);
  });

  it("a group reel has NO forNumber fallback", () => {
    // A group story is authorized by membership: a reel absent from my feed is one I
    // am not entitled to. Synthesizing an empty reel would render a black screen
    // rather than say so.
    const host = OVERLAYS.slice(OVERLAYS.indexOf("const groupIdx ="));
    expect(host.slice(0, 400)).not.toMatch(/forNumber/);
    expect(OVERLAYS).toMatch(/statusGroupId != null && groupIdx >= 0/);
  });
});

describe("v2.105.6 — the ring, and the composer", () => {
  /** The group-avatar branch of the thread row, bounded by the branch after it. */
  const ring = (() => {
    const at = MSG.indexOf("THE GROUP'S STORY RING");
    expect(at, "the ring branch is gone").toBeGreaterThan(-1);
    const end = MSG.indexOf(") : isNotes ? (", at);
    expect(end, "the isNotes branch that bounds it is gone").toBeGreaterThan(at);
    const out = MSG.slice(at, end);
    expect(out.length, "the ring slice collapsed").toBeGreaterThan(800);
    return out;
  })();

  it("the group ring uses the SAME vocabulary as PeerAvatar's", () => {
    // Gradient = unseen, subtle = seen, absent = no story. One shape must not
    // acquire a second meaning.
    // BOUNDED by the branch that follows it, not by a character count — the
    // fixed-slice fragility this repo has been bitten by five times.
    expect(ring).toMatch(/from-\[#06d6a0\] via-\[#0ea5e9\] to-\[#8b5cf6\]/);
    expect(ring).toMatch(/: "bg-border"/);
    expect(ring).toMatch(/: "";/);
  });

  it("a group with NO story is a plain disc, not a focusable no-op", () => {
    // The v2.103.3 rule: something that looks tappable and does nothing is worse
    // than something plainly inert.
    expect(ring).toMatch(/if \(!st\?\.hasAny\) \{/);
    expect(ring).toMatch(/return <div className="size-\[60px\]">\{disc\}<\/div>;/);
    // The button exists only on the has-a-story path, and it stops the row's own tap
    // from opening the conversation instead.
    expect(ring).toMatch(/openGroupStatus\(t\.conversationId\)/);
    expect(ring).toMatch(/e\.stopPropagation\(\);/);
    // The inert path really is inert: no button, no handler.
    const inert = ring.slice(ring.indexOf("if (!st?.hasAny)"), ring.indexOf("return ("));
    expect(inert.length).toBeGreaterThan(20);
    expect(inert).not.toMatch(/<button|onClick/);
  });

  it("the ring reads the SAME feed cache as the strip above the list", () => {
    // Two independent sources are how a ring and a strip come to disagree about one
    // group.
    expect(MSG).toMatch(/const groupStatus = useGroupStatusMap\(\);/);
    expect(MSG).toMatch(/useGroupStatusMap,/);
  });

  it("the composer's target picker only exists when I am in a group", () => {
    // A picker with one option is a control that cannot do anything, and every
    // existing user with no groups sees exactly the composer they saw before.
    expect(codeOnly(STATUS)).toMatch(/myGroups\.length > 0 && \(/);
    expect(STATUS).toMatch(/setTargetGroupId\(null\)/);
    expect(STATUS).toMatch(/const \[targetGroupId, setTargetGroupId\] = useState<number \| null>\(null\)/);
  });

  it("the audience picker is WITHHELD for a group target, not disabled", () => {
    // A group story's audience IS its membership, so leaving the control on screen
    // would invite somebody to pick "Everyone" and believe they had widened it.
    expect(STATUS).toMatch(/const audiencePickerApplies = targetGroupId == null;/);
    expect(codeOnly(STATUS)).toMatch(/\{audiencePickerApplies \? \(/);
    // …and the copy says who WILL see it instead.
    expect(STATUS).toMatch(/can see this for\s*\n?\s*24h, and it shows under the group/);
  });

  it("the picker reads the thread list the Messages tab already has", () => {
    // No extra request, and the same list that decides what a group is called
    // everywhere else — a separate "my groups" endpoint would be a second answer to
    // one question.
    expect(STATUS).toMatch(/trpc\.messages\.threads\.useQuery/);
    expect(STATUS).toMatch(/\.filter\(\(t\) => t\.kind === "group"\)/);
  });

  it("the viewer names the AUTHOR of a group slide", () => {
    // A group reel legitimately mixes authors; without this a slide would be
    // attributed to the group and there would be no way to tell who wrote it.
    const hdr = STATUS.slice(STATUS.indexOf("{/* header */}"));
    expect(hdr.slice(0, 1600)).toMatch(
      /group\.subject\.kind === "group" && item\.author/,
    );
    expect(hdr.slice(0, 1600)).toMatch(/item\.mine \? "You" : item\.author\.displayName/);
  });

  it("a reply is addressed to the SLIDE'S author, not to the group", () => {
    // The server DMs the author, so naming the group in the bar would promise a
    // group-visible reply the code does not send.
    expect(STATUS).toMatch(/ownerName=\{item\.author\?\.displayName \?\? group\.subject\.displayName\}/);
    const rp = ROUTERS.slice(ROUTERS.indexOf("  reply: publicProcedure"));
    expect(rp.slice(0, 6000)).toMatch(/getOrCreateDmConversation\(me\.id, st\.identityId\)/);
  });
});
