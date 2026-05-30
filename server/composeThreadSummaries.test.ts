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
