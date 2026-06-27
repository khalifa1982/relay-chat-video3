/* ============================================================
   v2.0 tRPC routers — the API surface for the phone-app shell.

   Every router exported here is namespaced under appRouter as a
   sibling of `auth` and `system`. See server/routers.ts for the
   final composition.
   ============================================================ */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { identities } from "../drizzle/schema";
import { router, publicProcedure } from "./_core/trpc";
import { GUEST_COOKIE } from "./_core/context";
import { getSessionCookieOptions } from "./_core/cookies";
import {
  bindDeviceIdToIdentity,
  createGuestIdentity,
  deleteContact,
  getAttachmentForIdentity,
  getAttachmentsByIds,
  getIdentitiesByIds,
  getIdentitiesByNumbers,
  getIdentityByDeviceId,
  getIdentityById,
  getIdentityByNumber,
  getOrCreateDmConversation,
  createGroupConversation,
  getPresenceAudienceIds,
  getPresenceForIds,
  listCallHistory,
  listContacts,
  listMessages,
  listThreads,
  markOnline,
  markOffline,
  markThreadRead,
  recordAttachment,
  recordCallStart,
  sendMessage,
  touchGuestExpiry,
  updateIdentityProfile,
  upsertContact,
  getConversationParticipantIds,
  recentAutoReplyExists,
} from "./v2db";
import { publishToIdentity, publishPresenceTo } from "./v2events";

export const NumberSchema = z
  .string()
  .regex(/^\d{6}$/, { message: "Number must be 6 digits" });

const DisplayNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(64, "Name is too long");

/**
 * Avatar URL — accepts either an absolute URL (e.g. an external CDN
 * link) or a server-relative storage path emitted by our `storagePut`
 * helper, which returns `/manus-storage/{key}` (the platform serves it
 * via signed redirect). `z.string().url()` only accepts absolute URLs,
 * which would reject every avatar that came from our own upload
 * endpoint.
 */
const AvatarUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    v =>
      v.startsWith("/manus-storage/") ||
      /^https?:\/\//i.test(v) ||
      v.startsWith("data:image/"),
    { message: "Invalid avatar URL" }
  );

const GUEST_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function guestCookieOptions(req: Parameters<typeof getSessionCookieOptions>[0]) {
  const base = getSessionCookieOptions(req);
  return { ...base, maxAge: GUEST_DAYS_MS };
}

/**
 * Require any identity (guest or registered). Throws UNAUTHORIZED otherwise.
 */
function requireIdentity(ctx: { identity: unknown }) {
  const id = ctx.identity as {
    id: number;
    number: string;
    displayName: string;
    isGuest: boolean;
  } | null;
  if (!id) throw new TRPCError({ code: "UNAUTHORIZED", message: "No identity" });
  return id;
}

/* ── auth/identity router ─────────────────────────────────────── */

export const v2AuthRouter = router({
  /**
   * Return whatever identity is attached to the current request.
   * Used by the client to decide between "show name input" and
   * "show app shell" without a redirect.
   */
  whoami: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.identity) return null;
    // Touch the guest cookie so 30-day countdown resets on activity.
    if (ctx.identity.isGuest) {
      try {
        await touchGuestExpiry(ctx.identity.id);
      } catch {
        /* swallow */
      }
    }
    return {
      id: ctx.identity.id,
      number: ctx.identity.number,
      displayName: ctx.identity.displayName,
      avatarUrl: ctx.identity.avatarUrl,
      isGuest: ctx.identity.isGuest,
      guestExpiresAt: ctx.identity.guestExpiresAt,
    };
  }),

  /**
   * Start (or restart) a guest session.
   *
   * The resolution order is strict, and was completely reworked in
   * v2.1.0 to fix the "my number changes randomly / accounts collide"
   * class of bug:
   *
   *   1. Cookie or device-id already resolved to an identity in ctx?
   *      Reuse it. The context resolver has already done the heavy
   *      lifting; we just re-issue a fresh cookie so the 30-day window
   *      doesn't drift.
   *   2. No ctx identity, but the caller's device id maps to an
   *      existing guest row? Return THAT row. This is the survival
   *      path when the cookie was dropped between page loads but the
   *      browser is the same as before.
   *   3. Neither — mint a brand-new identity, bind the device id, and
   *      issue a cookie.
   *
   * The displayName is now treated as a hint for case (3) only: in
   * cases (1) and (2) we keep the existing row's displayName so a
   * silent rename can't happen behind the user's back.
   */
  startGuest: publicProcedure
    .input(
      z.object({
        displayName: DisplayNameSchema,
        // Optional but strongly recommended — see context.ts for shape.
        deviceId: z
          .string()
          .regex(/^[a-f0-9]{16,64}$/i)
          .optional()
          .nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const deviceId =
        input.deviceId?.toLowerCase() ?? ctx.deviceId ?? null;

      // (1) Already authenticated via context.
      if (ctx.identity) {
        if (ctx.identity.isGuest && deviceId) {
          await bindDeviceIdToIdentity(ctx.identity.id, deviceId).catch(
            () => {}
          );
        }
        await touchGuestExpiry(ctx.identity.id).catch(() => {});
        return {
          id: ctx.identity.id,
          number: ctx.identity.number,
          displayName: ctx.identity.displayName,
          avatarUrl: ctx.identity.avatarUrl,
          isGuest: ctx.identity.isGuest,
          reused: true as const,
        };
      }

      // (2) Survival path — cookie was dropped but device id still
      // points at a guest row. Reuse it and reissue the cookie.
      if (deviceId) {
        const byDevice = await getIdentityByDeviceId(deviceId).catch(
          () => null
        );
        if (byDevice) {
          // Re-mint a guest token so the user gets a fresh cookie
          // (the old one is gone) without changing identity.
          const freshToken = (await import("crypto")).randomBytes(24).toString(
            "hex"
          );
          const expires = new Date(Date.now() + GUEST_DAYS_MS);
          const db = await getDb();
          if (db) {
            await db
              .update(identities)
              .set({ guestToken: freshToken, guestExpiresAt: expires })
              .where(eq(identities.id, byDevice.id));
          }
          ctx.res.cookie(GUEST_COOKIE, freshToken, guestCookieOptions(ctx.req));
          return {
            id: byDevice.id,
            number: byDevice.number,
            displayName: byDevice.displayName,
            avatarUrl: byDevice.avatarUrl,
            isGuest: true as const,
            reused: true as const,
          };
        }
      }

      // (3) Fresh identity. Bind the device id now.
      const { identity, guestToken } = await createGuestIdentity({
        displayName: input.displayName,
        deviceId,
      });
      ctx.res.cookie(GUEST_COOKIE, guestToken, guestCookieOptions(ctx.req));
      return {
        id: identity.id,
        number: identity.number,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        isGuest: identity.isGuest,
        reused: false as const,
      };
    }),

  /**
   * Explicit sign-out for guest sessions (clears the guest cookie).
   */
  signOutGuest: publicProcedure.mutation(async ({ ctx }) => {
    const opts = guestCookieOptions(ctx.req);
    ctx.res.clearCookie(GUEST_COOKIE, { ...opts, maxAge: -1 });
    return { ok: true };
  }),

  /**
   * Update display name or avatar URL on the current identity.
   */
  updateProfile: publicProcedure
    .input(
      z.object({
        displayName: DisplayNameSchema.optional(),
        avatarUrl: AvatarUrlSchema.nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      await updateIdentityProfile(me.id, input);
      const fresh = await getIdentityById(me.id);
      return fresh;
    }),
});

/* ── directory (numbers / lookups) ────────────────────────────── */

export interface GeoSelfResult {
  ip: string | null;
  country: string | null;
  countryName: string | null;
  city: string | null;
  flagEmoji: string | null;
}

const GEO_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const geoCache = new Map<
  string,
  { value: GeoSelfResult; expiresAt: number }
>();

/** Reset the in-process cache. Used by tests. */
export function _resetGeoCache(): void {
  geoCache.clear();
}

/**
 * Convert an ISO 3166-1 alpha-2 country code into the matching flag
 * emoji by mapping each ASCII letter to its regional-indicator codepoint.
 * Returns null for invalid input.
 */
export function flagEmojiFromIso2(
  code: string | null | undefined
): string | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  const A = 0x1f1e6 - "A".charCodeAt(0);
  return String.fromCodePoint(c.charCodeAt(0) + A, c.charCodeAt(1) + A);
}

/**
 * Best-effort extraction of the caller's public IP from an Express
 * request. Honors `CF-Connecting-IP` and `X-Forwarded-For`, falling
 * back to `req.ip`. Strips IPv6-mapped IPv4 prefixes.
 */
export function pickClientIp(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null };
  ip?: string;
}): string | null {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) {
    return cf.trim().replace(/^::ffff:/i, "");
  }
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.replace(/^::ffff:/i, "");
  }
  if (req.ip) return req.ip.replace(/^::ffff:/i, "");
  const sock = req.socket?.remoteAddress;
  if (sock) return sock.replace(/^::ffff:/i, "");
  return null;
}

/** Returns true for IPs we should not run a public geo lookup against. */
export function isPrivateOrLocalIp(ip: string): boolean {
  if (!ip) return true;
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip.startsWith("169.254.")) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) {
    return true;
  }
  return false;
}

export const v2DirectoryRouter = router({
  /** Look up a single number — returns null when unknown. */
  lookup: publicProcedure
    .input(z.object({ number: NumberSchema }))
    .query(async ({ input }) => {
      const id = await getIdentityByNumber(input.number);
      if (!id) return null;
      const [pres] = await getPresenceForIds([id.id]);
      return {
        id: id.id,
        number: id.number,
        displayName: id.displayName,
        avatarUrl: id.avatarUrl,
        isOnline: pres?.isOnline ?? false,
        lastSeenAt: pres?.lastSeenAt ?? null,
      };
    }),

  /**
   * Resolve the caller's request IP to a country (ISO 3166-1 alpha-2)
   * and a flag emoji using a free public geo service (`ipapi.co`).
   * Cached in-process for 12h per IP. Returns nulls on failure or
   * for private/loopback addresses — the UI gracefully omits the
   * flag chip when null.
   */
  geoSelf: publicProcedure.query(async ({ ctx }) => {
    const empty: GeoSelfResult = {
      ip: null,
      country: null,
      countryName: null,
      city: null,
      flagEmoji: null,
    };
    const ip = pickClientIp(ctx.req);
    if (!ip) return empty;
    if (isPrivateOrLocalIp(ip)) return { ...empty, ip };

    const cached = geoCache.get(ip);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(
        `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
        {
          signal: ctrl.signal,
          headers: { "User-Agent": "relay-chat-video/2.0" },
        }
      );
      clearTimeout(timer);
      if (!res.ok) return { ...empty, ip };
      const json = (await res.json()) as {
        country_code?: string | null;
        country_name?: string | null;
        city?: string | null;
        error?: boolean;
      };
      if (json.error) return { ...empty, ip };
      const country = (json.country_code || "").trim().toUpperCase() || null;
      const out: GeoSelfResult = {
        ip,
        country,
        countryName: json.country_name || null,
        city: json.city || null,
        flagEmoji: flagEmojiFromIso2(country),
      };
      geoCache.set(ip, {
        value: out,
        expiresAt: Date.now() + GEO_CACHE_TTL_MS,
      });
      return out;
    } catch {
      return { ...empty, ip };
    }
  }),

  /** Get presence for an array of identity ids. */
  presence: publicProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).max(200) }))
    .query(async ({ input }) => {
      if (input.ids.length === 0) return [];
      return getPresenceForIds(input.ids);
    }),

  /**
   * Heartbeat: mark me online and bump my lastSeenAt. Client should call
   * this every ~30s while the app is open.
   */
  heartbeat: publicProcedure.mutation(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const { becameOnline } = await markOnline(me.id, null);
    // Only push presence to people who care (contacts + conversation peers), and
    // only on an actual offline->online transition — not on every 30s tick.
    // Fire-and-forget; failures don't affect the heartbeat result.
    if (becameOnline) {
      try {
        const audience = await getPresenceAudienceIds(me.id, me.number);
        publishPresenceTo(audience, me.number, true, new Date());
      } catch {
        /* ignore */
      }
    }
    return { ok: true, at: new Date() };
  }),

  /** Explicit "I'm leaving" beacon. */
  goOffline: publicProcedure.mutation(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    await markOffline(me.id);
    try {
      const audience = await getPresenceAudienceIds(me.id, me.number);
      publishPresenceTo(audience, me.number, false, new Date());
    } catch {
      /* ignore */
    }
    return { ok: true };
  }),
});

/* ── contacts router ──────────────────────────────────────────── */

export const v2ContactsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const rows = await listContacts(me.id);
    // Resolve every contact's identity in ONE query (was N+1: one per contact).
    const idents = await getIdentitiesByNumbers(rows.map((r) => r.number));
    const idByNumber = new Map(idents.map((i) => [i.number, i.id]));
    const ids = idents.map((i) => i.id);
    const presList = await getPresenceForIds(ids);
    const presByIdentity = new Map(presList.map((p) => [p.identityId, p]));
    return rows.map((r) => {
      const ident = idByNumber.get(r.number);
      const pres = ident != null ? presByIdentity.get(ident) : undefined;
      return {
        id: r.id,
        number: r.number,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        favourite: r.favourite,
        notes: r.notes,
        identityId: ident ?? null,
        isOnline: pres?.isOnline ?? false,
        lastSeenAt: pres?.lastSeenAt ?? null,
      };
    });
  }),

  upsert: publicProcedure
    .input(
      z.object({
        number: NumberSchema,
        displayName: z.string().trim().max(64).nullable().optional(),
        avatarUrl: AvatarUrlSchema.nullable().optional(),
        favourite: z.boolean().optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      if (input.number === ctx.identity!.number) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You can't add yourself as a contact",
        });
      }
      const row = await upsertContact({ ownerId: me.id, ...input });
      return row;
    }),

  remove: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      await deleteContact(me.id, input.id);
      return { ok: true };
    }),
});

/* ── messages router ──────────────────────────────────────────── */

export const v2MessagesRouter = router({
  threads: publicProcedure.query(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const base = await listThreads(me.id);
    if (base.length === 0) return [];
    const pres = await getPresenceForIds(base.map((b) => b.otherIdentityId));
    const byId = new Map(pres.map((p) => [p.identityId, p]));
    return base.map((b) => {
      const p = byId.get(b.otherIdentityId);
      return {
        conversationId: b.conversationId,
        kind: b.kind,
        title: b.title,
        memberCount: b.memberCount,
        peerIdentityId: b.otherIdentityId,
        peerNumber: b.otherNumber,
        peerDisplayName: b.otherDisplayName,
        peerAvatarUrl: b.otherAvatarUrl,
        peerIsOnline: p?.isOnline ?? false,
        peerLastSeenAt: p?.lastSeenAt ?? null,
        lastMessageAt: b.lastMessageAt,
        lastMessageBody: b.lastMessagePreview,
        lastMessageKind: b.lastMessageKind,
        unreadCount: b.unreadCount,
      };
    });
  }),

  /**
   * Open or create a 1:1 conversation with the given number. Passing
   * the caller's own number creates (or returns) a private "note to
   * self" thread — useful for saving links, ideas, or attachments.
   */
  openThread: publicProcedure
    .input(z.object({ number: NumberSchema }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const other = await getIdentityByNumber(input.number);
      if (!other) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That number isn't a RELAY user yet",
        });
      }
      const isSelf = other.id === me.id;
      const convo = await getOrCreateDmConversation(me.id, other.id);
      return {
        conversationId: convo.id,
        otherIdentityId: other.id,
        otherNumber: other.number,
        otherDisplayName: isSelf ? "Notes (You)" : other.displayName,
        otherAvatarUrl: other.avatarUrl,
        isSelf,
      };
    }),

  /**
   * Convenience procedure: open (or create) the caller's note-to-self
   * thread without needing to know their own number first. The client
   * uses this to power the "Note to self" quick action in the New
   * Conversation dialog.
   */
  openSelfThread: publicProcedure.mutation(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const convo = await getOrCreateDmConversation(me.id, me.id);
    return {
      conversationId: convo.id,
      otherIdentityId: me.id,
      otherNumber: me.number,
      otherDisplayName: "Notes (You)",
      otherAvatarUrl: null,
      isSelf: true,
    };
  }),

  /**
   * Create a named group from a set of 6-digit numbers. The caller is always a
   * member. Unknown numbers are skipped (we report which resolved). Needs at
   * least one other valid member.
   */
  createGroup: publicProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(128),
        numbers: z.array(NumberSchema).min(1).max(19), // + creator = 20 cap
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const unique = Array.from(new Set(input.numbers)).filter((n) => n !== me.number);
      const members = await getIdentitiesByNumbers(unique);
      if (members.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add at least one other RELAY number to start a group.",
        });
      }
      const convo = await createGroupConversation({
        creatorId: me.id,
        memberIds: members.map((m) => m.id),
        title: input.title,
      });
      // Push a hint so every member's thread list refreshes.
      try {
        for (const pid of [me.id, ...members.map((m) => m.id)]) {
          publishToIdentity(pid, { kind: "message", conversationId: convo.id, from: me.id });
        }
      } catch {
        /* best-effort */
      }
      return {
        conversationId: convo.id,
        title: convo.title,
        memberCount: members.length + 1,
        skipped: unique.length - members.length,
      };
    }),

  /**
   * Members of a conversation (id, number, name, avatar) — used by the group
   * conversation view to label messages with sender names and show the roster.
   */
  conversationInfo: publicProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const memberIds = await getConversationParticipantIds(input.conversationId);
      if (!memberIds.includes(me.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this conversation." });
      }
      const idents = await getIdentitiesByIds(memberIds);
      return {
        conversationId: input.conversationId,
        members: idents.map((i) => ({
          id: i.id,
          number: i.number,
          displayName: i.displayName,
          avatarUrl: i.avatarUrl ?? null,
          isMe: i.id === me.id,
        })),
      };
    }),

  list: publicProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        beforeId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const rows = await listMessages({
        conversationId: input.conversationId,
        identityId: me.id,
        beforeId: input.beforeId,
        limit: input.limit,
      });
      // Resolve attachments in ONE query (was N+1: one round-trip per message).
      const attIds = rows
        .map((r) => r.attachmentId)
        .filter((x): x is number => typeof x === "number");
      const attById = new Map((await getAttachmentsByIds(attIds)).map((a) => [a.id, a]));
      return rows.map((r) => ({
        id: r.id,
        conversationId: r.conversationId,
        senderIdentityId: r.senderIdentityId,
        kind: r.kind,
        body: r.body,
        meta: r.meta,
        status: r.status,
        createdAt: r.createdAt,
        editedAt: r.editedAt,
        attachment: r.attachmentId ? (attById.get(r.attachmentId) ?? null) : null,
        replyToId: r.replyToId ?? null,
      }));
    }),

  send: publicProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        kind: z
          .enum(["text", "image", "video", "audio", "file"])
          .optional()
          .default("text"),
        body: z.string().max(8000).nullable().optional(),
        attachmentId: z.number().int().positive().nullable().optional(),
        replyToId: z.number().int().positive().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      if (
        (!input.body || input.body.trim().length === 0) &&
        !input.attachmentId
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Message must have body or attachment",
        });
      }
      const row = await sendMessage({
        conversationId: input.conversationId,
        senderIdentityId: me.id,
        kind: input.kind,
        body: input.body ?? null,
        attachmentId: input.attachmentId ?? null,
        replyToId: input.replyToId ?? null,
      });
      // Fan out a push hint to every participant so their UIs refetch.
      // Includes the sender so their other tabs also stay in sync.
      try {
        const peers = await getConversationParticipantIds(input.conversationId);
        for (const pid of peers) {
          publishToIdentity(pid, {
            kind: "message",
            conversationId: input.conversationId,
            from: me.id,
          });
        }
      } catch {
        /* push is best-effort; polling is the safety net */
      }

      // Offline auto-reply (1:1 only — avoids group spam). If the single other
      // party is offline and hasn't auto-replied in the last 10 min, post a
      // one-time auto-reply FROM them so the sender knows they'll reply later.
      try {
        const peerIds = (
          await getConversationParticipantIds(input.conversationId)
        ).filter((p) => p !== me.id);
        if (peerIds.length === 1) {
          const peerId = peerIds[0];
          const [pres] = await getPresenceForIds([peerId]);
          const offline = !pres?.isOnline;
          if (
            offline &&
            !(await recentAutoReplyExists(input.conversationId, peerId, 10 * 60 * 1000))
          ) {
            const peer = await getIdentityById(peerId);
            const name = peer?.displayName || "They";
            const autoRow = await sendMessage({
              conversationId: input.conversationId,
              senderIdentityId: peerId,
              kind: "text",
              body: `${name} is away right now and will reply when they're back. (Auto-reply)`,
              meta: { autoReply: true },
            });
            if (autoRow) {
              publishToIdentity(me.id, {
                kind: "message",
                conversationId: input.conversationId,
                from: peerId,
              });
              publishToIdentity(peerId, {
                kind: "message",
                conversationId: input.conversationId,
                from: peerId,
              });
            }
          }
        }
      } catch {
        /* auto-reply is best-effort */
      }

      return row;
    }),

  markRead: publicProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      await markThreadRead({
        conversationId: input.conversationId,
        identityId: me.id,
      });
      // Notify the peer so their read-receipt ticks update.
      try {
        const peers = await getConversationParticipantIds(input.conversationId);
        for (const pid of peers) {
          if (pid !== me.id) {
            publishToIdentity(pid, {
              kind: "read",
              conversationId: input.conversationId,
              reader: me.id,
            });
          }
        }
      } catch {
        /* ignore */
      }
      return { ok: true };
    }),
});

/* ── attachments router ───────────────────────────────────────── */

export const v2AttachmentsRouter = router({
  /**
   * Register an attachment after the file has been uploaded via the HTTP
   * `/api/v2/upload` endpoint (which does the actual storagePut). This
   * router-level entry exists for clients that already have storage keys
   * (e.g. server-driven flows or tests).
   */
  register: publicProcedure
    .input(
      z.object({
        storageKey: z.string().min(1).max(256),
        url: z.string().min(1),
        mimeType: z.string().min(1).max(128),
        sizeBytes: z.number().int().nonnegative(),
        width: z.number().int().positive().optional().nullable(),
        height: z.number().int().positive().optional().nullable(),
        durationMs: z.number().int().positive().optional().nullable(),
        filename: z.string().max(256).optional().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const row = await recordAttachment({
        ...input,
        uploadedByIdentityId: me.id,
      });
      return row;
    }),

  get: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      // Authorization: only return an attachment the caller uploaded or that
      // belongs to a conversation they participate in. Without this gate, any
      // caller could enumerate sequential ids and read every attachment URL.
      const me = requireIdentity(ctx);
      return getAttachmentForIdentity(input.id, me.id);
    }),
});

/* ── calls router (history + start log) ───────────────────────── */

export const v2CallsRouter = router({
  history: publicProcedure.query(async ({ ctx }) => {
    const me = requireIdentity(ctx);
    const rows = await listCallHistory(me.id, 100);
    // join the "other" identity for each row for friendly display
    const otherIds = Array.from(
      new Set(
        rows.map((r) => (r.callerIdentityId === me.id ? r.calleeIdentityId : r.callerIdentityId))
      )
    );
    // Resolve the "other" identity for every row in ONE query. (This replaced a
    // dead single-row query plus an N+1 loop.)
    const otherById = new Map((await getIdentitiesByIds(otherIds)).map((o) => [o.id, o]));
    return rows.map((r) => {
      const otherId = r.callerIdentityId === me.id ? r.calleeIdentityId : r.callerIdentityId;
      const other = otherById.get(otherId);
      return {
        id: r.id,
        direction: r.callerIdentityId === me.id ? ("out" as const) : ("in" as const),
        status: r.status,
        channel: r.channel,
        startedAt: r.startedAt,
        answeredAt: r.answeredAt,
        endedAt: r.endedAt,
        durationSec: r.durationSec,
        other: other
          ? {
              identityId: other.id,
              number: other.number,
              displayName: other.displayName,
              avatarUrl: other.avatarUrl,
            }
          : null,
      };
    });
  }),

  /** Caller calls this immediately before sending the SDP offer. */
  logStart: publicProcedure
    .input(
      z.object({
        calleeNumber: NumberSchema,
        channel: z.enum(["voice", "video"]).optional().default("video"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const me = requireIdentity(ctx);
      const callee = await getIdentityByNumber(input.calleeNumber);
      if (!callee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Number not found" });
      }
      const row = await recordCallStart({
        callerIdentityId: me.id,
        calleeIdentityId: callee.id,
        channel: input.channel,
      });
      return row;
    }),
});
