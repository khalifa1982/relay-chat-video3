/* ============================================================
   Unit tests for the pure thread-summary projection helper.

   These cover the v2.0.8 self-DM projection path: when a
   conversation has only the caller as a participant (a "note to
   self" thread), the projection synthesises a "Notes (You)" peer
   row using the caller's own identity instead of dropping the
   conversation.
   ============================================================ */

import { describe, it, expect } from "vitest";
import { composeThreadSummaries } from "./v2db";

const tNow = new Date("2026-05-30T10:00:00Z");
const tOlder = new Date("2026-05-29T10:00:00Z");

const me = {
  id: 7,
  number: "111222",
  displayName: "Me",
  avatarUrl: null,
};

const friend = {
  id: 9,
  number: "333444",
  displayName: "Anya",
  avatarUrl: "/manus-storage/anya.png",
};

describe("composeThreadSummaries", () => {
  it("projects a regular DM with the other participant's name + avatar", () => {
    const out = composeThreadSummaries({
      identityId: me.id,
      myParts: [{ conversationId: 100, unreadCount: 2 }],
      others: [{ conversationId: 100, identityId: friend.id }],
      otherIdentities: [friend],
      myIdentity: me,
      convoRows: [{ id: 100, lastMessageAt: tNow }],
      latestMessageByConvo: new Map([
        [100, { body: "hey", kind: "text" }],
      ]),
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      conversationId: 100,
      otherIdentityId: friend.id,
      otherNumber: friend.number,
      otherDisplayName: "Anya",
      otherAvatarUrl: "/manus-storage/anya.png",
      unreadCount: 2,
      lastMessagePreview: "hey",
      lastMessageKind: "text",
    });
  });

  it("synthesises a 'Notes (You)' projection for a self-conversation (no other row)", () => {
    // Self-DM: my participant row exists, but `others` is empty for
    // this convoId because the only participant is me.
    const out = composeThreadSummaries({
      identityId: me.id,
      myParts: [{ conversationId: 200, unreadCount: 0 }],
      others: [],
      otherIdentities: [],
      myIdentity: me,
      convoRows: [{ id: 200, lastMessageAt: tNow }],
      latestMessageByConvo: new Map([
        [200, { body: "remember to call mom", kind: "text" }],
      ]),
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      conversationId: 200,
      otherIdentityId: me.id, // points back to the caller
      otherNumber: me.number,
      otherDisplayName: "Notes (You)",
      otherAvatarUrl: null,
      unreadCount: 0,
      lastMessagePreview: "remember to call mom",
    });
  });

  it("does NOT double-project when a conversation has both myself and another participant", () => {
    // Defensive case: even if my participant row exists (it always
    // does), we must NOT also synthesise a self-projection for
    // a real DM. Only conversations where `others` lacks the
    // convoId should get the synthetic row.
    const out = composeThreadSummaries({
      identityId: me.id,
      myParts: [{ conversationId: 100, unreadCount: 1 }],
      others: [{ conversationId: 100, identityId: friend.id }],
      otherIdentities: [friend],
      myIdentity: me,
      convoRows: [{ id: 100, lastMessageAt: tNow }],
      latestMessageByConvo: new Map(),
    });
    expect(out).toHaveLength(1);
    expect(out[0].otherDisplayName).toBe("Anya");
  });

  it("returns mixed self + DM threads sorted by lastMessageAt desc", () => {
    const out = composeThreadSummaries({
      identityId: me.id,
      myParts: [
        { conversationId: 100, unreadCount: 0 }, // DM with friend, older
        { conversationId: 200, unreadCount: 0 }, // self-notes, newest
      ],
      others: [{ conversationId: 100, identityId: friend.id }],
      otherIdentities: [friend],
      myIdentity: me,
      convoRows: [
        { id: 100, lastMessageAt: tOlder },
        { id: 200, lastMessageAt: tNow },
      ],
      latestMessageByConvo: new Map([
        [100, { body: "hey", kind: "text" }],
        [200, { body: "shopping list", kind: "text" }],
      ]),
    });
    expect(out).toHaveLength(2);
    expect(out[0].otherDisplayName).toBe("Notes (You)"); // newest first
    expect(out[1].otherDisplayName).toBe("Anya");
  });

  it("falls back gracefully when myIdentity is missing (e.g. transient race) — drops self-only threads instead of crashing", () => {
    const out = composeThreadSummaries({
      identityId: me.id,
      myParts: [{ conversationId: 200, unreadCount: 0 }],
      others: [],
      otherIdentities: [],
      myIdentity: null,
      convoRows: [{ id: 200, lastMessageAt: tNow }],
      latestMessageByConvo: new Map(),
    });
    expect(out).toEqual([]);
  });

  it("projects a GROUP as a single summary with title + member count (not one-per-member)", () => {
    const bob = { id: 11, number: "555666", displayName: "Bob", avatarUrl: null };
    const out = composeThreadSummaries({
      identityId: me.id,
      myParts: [{ conversationId: 300, unreadCount: 4 }],
      // a group has MANY "others" for the same conversation
      others: [
        { conversationId: 300, identityId: friend.id },
        { conversationId: 300, identityId: bob.id },
      ],
      otherIdentities: [friend, bob],
      myIdentity: me,
      convoRows: [{ id: 300, lastMessageAt: tNow, kind: "group", title: "Weekend Trip" }],
      latestMessageByConvo: new Map([[300, { body: "who's driving?", kind: "text" }]]),
    });
    expect(out).toHaveLength(1); // ONE summary, not two
    expect(out[0]).toMatchObject({
      conversationId: 300,
      kind: "group",
      title: "Weekend Trip",
      otherDisplayName: "Weekend Trip",
      otherIdentityId: 0,
      memberCount: 3, // friend + bob + me
      unreadCount: 4,
      lastMessagePreview: "who's driving?",
    });
  });

  it("falls back to member names when a group has no title", () => {
    const bob = { id: 11, number: "555666", displayName: "Bob", avatarUrl: null };
    const out = composeThreadSummaries({
      identityId: me.id,
      myParts: [{ conversationId: 301, unreadCount: 0 }],
      others: [
        { conversationId: 301, identityId: friend.id },
        { conversationId: 301, identityId: bob.id },
      ],
      otherIdentities: [friend, bob],
      myIdentity: me,
      convoRows: [{ id: 301, lastMessageAt: tNow, kind: "group", title: null }],
      latestMessageByConvo: new Map(),
    });
    expect(out[0].kind).toBe("group");
    expect(out[0].otherDisplayName).toBe("Anya, Bob");
  });

  it("drops a DM whose peer identity didn't resolve (does NOT mislabel it 'Notes (You)')", () => {
    // The conversation HAS an other participant row, but that identity is
    // absent from otherIdentities (deleted/orphaned/transient race).
    const out = composeThreadSummaries({
      identityId: me.id,
      myParts: [{ conversationId: 400, unreadCount: 0 }],
      others: [{ conversationId: 400, identityId: 9999 }], // unresolved
      otherIdentities: [], // 9999 not present
      myIdentity: me,
      convoRows: [{ id: 400, lastMessageAt: tNow, kind: "dm", title: null }],
      latestMessageByConvo: new Map(),
    });
    expect(out).toEqual([]); // dropped, not a synthetic self-note
  });

  it("tags regular DMs with kind 'dm' and memberCount 2", () => {
    const out = composeThreadSummaries({
      identityId: me.id,
      myParts: [{ conversationId: 100, unreadCount: 0 }],
      others: [{ conversationId: 100, identityId: friend.id }],
      otherIdentities: [friend],
      myIdentity: me,
      convoRows: [{ id: 100, lastMessageAt: tNow, kind: "dm", title: null }],
      latestMessageByConvo: new Map(),
    });
    expect(out[0]).toMatchObject({ kind: "dm", memberCount: 2, otherDisplayName: "Anya" });
  });

  it("uses 'text' as a default kind when the latest message is missing", () => {
    const out = composeThreadSummaries({
      identityId: me.id,
      myParts: [{ conversationId: 200, unreadCount: 0 }],
      others: [],
      otherIdentities: [],
      myIdentity: me,
      convoRows: [{ id: 200, lastMessageAt: tNow }],
      latestMessageByConvo: new Map(),
    });
    expect(out).toHaveLength(1);
    expect(out[0].lastMessageKind).toBe("text");
    expect(out[0].lastMessagePreview).toBeNull();
  });
});

/* ============================================================
   v2.88 — listThreads preview query is a GROUPWISE-MAX, not a
   full history scan. The old query selected EVERY non-deleted
   message across all of a user's conversations (no LIMIT) and
   picked first-per-convo in JS — polled every few seconds, that
   scan grew linearly with total message history. Pin the shape:
   MAX(id) GROUP BY conversationId, then an inArray fetch of just
   those rows.
   ============================================================ */
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("listThreads groupwise-max shape (v2.88)", () => {
  const src = readFileSync(join(__dirname, "v2db.ts"), "utf8");
  const fn = src.slice(
    src.indexOf("export async function listThreads"),
    src.indexOf("export async function listMessages")
  );

  it("aggregates MAX(id) grouped by conversationId", () => {
    expect(fn).toMatch(/MAX\(\$\{messages\.id\}\)/);
    expect(fn).toMatch(/\.groupBy\(messages\.conversationId\)/);
  });

  it("fetches only the winning rows by id (inArray), not the whole history", () => {
    expect(fn).toMatch(/inArray\(messages\.id,\s*latestIds\)/);
    // The unbounded full-scan shape must stay gone: no ORDER BY createdAt
    // over the un-aggregated messages select.
    expect(fn).not.toMatch(/orderBy\(desc\(messages\.createdAt\)\)/);
  });
});
