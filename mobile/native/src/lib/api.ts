/**
 * Typed client for RELAY's EXISTING backend — the tRPC/superjson HTTP API the
 * web app uses, consumed unmodified (parity mandate). Every shape below was
 * transcribed from server/v2routers.ts / server/v2upload.ts and is pinned by
 * the M2 verification pass; a generated type bundle replaces these hand types
 * when the server gains a type-export build step.
 */
import { createTRPCUntypedClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { getDeviceId } from "./deviceId";

/** The live backend. Point at a preview deployment for testing if needed. */
// APEX host of the PRIMARY deployment. .org (Manus) was emptied by the owner
// (2026-07-21) — .io (AWS) is now the only backend. Use the apex: a www 301
// would break tRPC POSTs (the old "Couldn't reach RELAY" field bug).
// Everything (tRPC, SSE signaling, v2 events, uploads) derives from this.
export const BASE_URL = "https://your-chat.io";

const client = createTRPCUntypedClient({
  links: [
    httpBatchLink({
      url: `${BASE_URL}/api/trpc`,
      transformer: superjson,
      fetch: (url, opts) =>
        fetch(url, { ...opts, credentials: "include" } as RequestInit),
      headers: async () => ({ "x-relay-device-id": await getDeviceId() }),
    }),
  ],
});

export interface Whoami {
  id: number;
  number: string;
  displayName: string;
  avatarUrl: string | null;
  isGuest: boolean;
  verified: boolean | null;
  email: string | null;
}

export interface ContactRow {
  id: number;
  number: string;
  displayName: string | null;
  avatarUrl: string | null;
  favourite: boolean | null;
  notes: string | null;
  category: "vip" | "family" | "friend" | "team" | null;
  blocked: boolean;
  identityId: number | null;
  isOnline: boolean;
  lastSeenAt: string | Date | null;
  verified: boolean;
}

/** messages.threads — exact server shape (v2routers.ts threads query). */
export interface ThreadRow {
  conversationId: number;
  kind: string; // "dm" | "group"
  title: string | null;
  memberCount: number;
  peerIdentityId: number;
  peerNumber: string | null;
  peerDisplayName: string | null;
  peerAvatarUrl: string | null;
  peerIsOnline: boolean;
  peerVerified: boolean;
  lastMessageAt: string | Date | null;
  lastMessageBody: string | null;
  lastMessageKind: string | null;
  unreadCount: number;
}

export interface Attachment {
  id: number;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  filename?: string | null;
}

/** messages.list row — exact server shape. */
export interface MessageRow {
  id: number;
  conversationId: number;
  senderIdentityId: number;
  kind: "text" | "image" | "video" | "audio" | "file" | "system";
  body: string | null;
  meta: unknown;
  status: string | null; // "read" once the peer has read it
  createdAt: string | Date;
  editedAt: string | Date | null;
  attachment: Attachment | null;
  replyToId: number | null;
}

export interface CallRow {
  id: number;
  direction: "in" | "out";
  status: string;
  startedAt: string | Date;
  durationSec?: number | null;
  other: { number: string; displayName: string } | null;
}

export interface ConferenceRow {
  id: number;
  dialedNumber: string | null;
  partyCount: number;
  startedAt: string | Date;
  durationSec: number;
  participants: Array<{ number: string; name: string; isSelf: boolean }>;
}

export interface LookupResult {
  number: string;
  displayName: string;
  isOnline: boolean;
  verified: boolean | null;
}

export interface ConversationInfo {
  conversationId: number;
  members: Array<{ id: number; number: string; displayName: string; avatarUrl: string | null; isMe: boolean }>;
}

/** Rich user status (v2.95) — story-style. Shapes mirror server/v2routers.ts. */
export interface StatusItem {
  id: number;
  kind: string; // "text" | "image" | "video" | "audio"
  text: string | null;
  bgColor: string | null;
  mediaUrl: string | null;
  mimeType: string | null;
  durationMs: number | null;
  createdAt: string | Date;
  expiresAt: string | Date;
}
export interface StatusGroup {
  owner: { id: number; number: string; displayName: string; avatarUrl: string | null; isMe: boolean };
  items: StatusItem[];
  hasUnseen: boolean;
  latestAt: string | Date;
}
export interface StatusViewer {
  id: number;
  displayName: string;
  number: string;
  avatarUrl: string | null;
}

export const api = {
  // identity / presence
  whoami: () => client.query("identity.whoami") as Promise<Whoami | null>,
  // Server returns a SLIM shape (no verified/email) — callers follow with
  // whoami() for the full identity (Onboarding does).
  startGuest: async (displayName: string) =>
    client.mutation("identity.startGuest", {
      displayName,
      deviceId: await getDeviceId(),
    }) as Promise<Pick<Whoami, "id" | "number" | "displayName" | "avatarUrl" | "isGuest"> & { reused?: boolean }>,
  heartbeat: () => client.mutation("directory.heartbeat") as Promise<unknown>,
  lookup: (number: string) =>
    client.query("directory.lookup", { number }) as Promise<LookupResult | null>,

  // contacts (write-parity M2)
  contacts: () => client.query("contacts.list") as Promise<ContactRow[]>,
  contactUpsert: (input: {
    number: string;
    displayName?: string | null;
    favourite?: boolean;
    notes?: string | null;
    category?: "vip" | "family" | "friend" | "team" | null;
    blocked?: boolean;
  }) => client.mutation("contacts.upsert", input) as Promise<unknown>,
  // Server input is { id } — the contact ROW id, not the number.
  contactRemove: (id: number) =>
    client.mutation("contacts.remove", { id }) as Promise<unknown>,

  // messaging (write-parity M2)
  threads: () => client.query("messages.threads") as Promise<ThreadRow[]>,
  openThread: (number: string) =>
    client.mutation("messages.openThread", { number }) as Promise<{
      conversationId: number;
      otherIdentityId: number;
      otherNumber: string;
      otherDisplayName: string;
      isSelf: boolean;
    }>,
  conversationInfo: (conversationId: number) =>
    client.query("messages.conversationInfo", { conversationId }) as Promise<ConversationInfo>,
  messages: (conversationId: number, opts?: { beforeId?: number; limit?: number }) =>
    client.query("messages.list", { conversationId, ...opts }) as Promise<MessageRow[]>,
  send: (input: {
    conversationId: number;
    kind?: "text" | "image" | "video" | "audio" | "file";
    body?: string | null;
    attachmentId?: number | null;
    replyToId?: number | null;
    // The server returns the RAW inserted row (attachmentId, no joined
    // `attachment` object — only messages.list joins it).
  }) => client.mutation("messages.send", input) as Promise<Omit<MessageRow, "attachment"> & { attachmentId: number | null }>,
  // Group threads (M3.5): server skips unknown numbers, needs ≥1 other member.
  createGroup: (input: { title: string; numbers: string[] }) =>
    client.mutation("messages.createGroup", input) as Promise<{
      conversationId: number;
      title: string | null;
      memberCount: number;
      skipped: number;
    }>,
  markRead: (conversationId: number) =>
    client.mutation("messages.markRead", { conversationId }) as Promise<unknown>,
  typing: (conversationId: number) =>
    client.mutation("messages.typing", { conversationId }) as Promise<unknown>,
  unsend: (messageId: number) =>
    client.mutation("messages.remove", { messageId }) as Promise<unknown>,

  // call history (read since M1)
  callHistory: () => client.query("calls.history") as Promise<CallRow[]>,
  conferenceHistory: () =>
    client.query("calls.conferenceHistory") as Promise<ConferenceRow[]>,

  // push (M4): register the FCM device token so the server can page this
  // phone for incoming calls with the app closed. kind:"fcm" makes the
  // endpoint the raw token — no WebPush keys (server/v2routers.ts push.subscribe).
  pushSubscribe: (token: string) =>
    client.mutation("push.subscribe", { endpoint: token, kind: "fcm" }) as Promise<unknown>,
  pushUnsubscribe: (token: string) =>
    client.mutation("push.unsubscribe", { endpoint: token }) as Promise<unknown>,

  // rich user status (v2.95, story-style)
  status: {
    feed: () => client.query("status.feed") as Promise<{ groups: StatusGroup[] }>,
    mine: () => client.query("status.mine") as Promise<{ items: (StatusItem & { viewCount: number })[] }>,
    post: (input: {
      kind: "text" | "image" | "video" | "audio";
      text?: string;
      bgColor?: string;
      mediaKey?: string;
      mimeType?: string;
      durationMs?: number;
    }) => client.mutation("status.post", input) as Promise<{ id: number; expiresAt: string | Date }>,
    remove: (id: number) => client.mutation("status.remove", { id }) as Promise<{ ok: boolean }>,
    markViewed: (id: number) => client.mutation("status.markViewed", { id }) as Promise<{ ok: boolean }>,
    viewers: (id: number) =>
      client.query("status.viewers", { id }) as Promise<{ viewers: StatusViewer[] }>,
  },
};

/**
 * Attachment upload — the same HTTP endpoint the web uses (POST /api/v2/upload,
 * base64 JSON body; identity via cookie or the x-relay-device-id fallback,
 * verified against server/v2upload.ts). Returns the attachment row whose `id`
 * feeds messages.send({ attachmentId }).
 */
/** Attachment URLs come back server-relative (`/manus-storage/{key}`) — not
 *  fetchable from a native app without the origin prefix. */
export const absUrl = (u: string) => (u.startsWith("http") ? u : `${BASE_URL}${u}`);

export async function uploadAttachment(input: {
  dataBase64: string;
  mimeType: string;
  filename?: string;
  width?: number;
  height?: number;
  durationMs?: number;
}): Promise<Attachment> {
  const res = await fetch(`${BASE_URL}/api/v2/upload`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-relay-device-id": await getDeviceId(),
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error || `Upload failed (${res.status})`);
  }
  return (await res.json()) as Attachment;
}

/**
 * Upload rich-STATUS media (base64 `bare:true`) — stores the bytes with NO
 * attachment row and returns {storageKey,url}, so the storage proxy serves it as
 * a status object (gated to contacts) rather than a public attachment. The key
 * is then passed to api.status.post({ mediaKey }).
 */
export async function uploadStatusMedia(input: {
  dataBase64: string;
  mimeType: string;
}): Promise<{ storageKey: string; url: string }> {
  const res = await fetch(`${BASE_URL}/api/v2/upload`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-relay-device-id": await getDeviceId(),
    },
    body: JSON.stringify({ ...input, bare: true }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error || `Upload failed (${res.status})`);
  }
  return (await res.json()) as { storageKey: string; url: string };
}
