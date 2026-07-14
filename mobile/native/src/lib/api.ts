/**
 * Typed client for RELAY's EXISTING backend — the tRPC/superjson HTTP API the
 * web app uses, consumed unmodified (the parity mandate: same endpoints, same
 * shapes). M1 hand-types the procedures it uses; a generated type bundle from
 * server/routers.ts replaces these in M2 so drift is impossible.
 */
import { createTRPCUntypedClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { getDeviceId } from "./deviceId";

/** The live backend. Point at a preview deployment for testing if needed. */
export const BASE_URL = "https://www.your-chat.org";

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
  favourite: boolean | null;
  category: string | null;
  blocked: boolean | null;
  isOnline?: boolean;
  verified?: boolean | null;
}

export interface ThreadRow {
  conversationId: number;
  peerNumber: string | null;
  title: string;
  lastBody: string | null;
  lastAt: string | Date | null;
  unread: number;
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

export const api = {
  whoami: () => client.query("identity.whoami") as Promise<Whoami | null>,
  startGuest: async (displayName: string) =>
    client.mutation("identity.startGuest", {
      displayName,
      deviceId: await getDeviceId(),
    }) as Promise<Whoami & { reused?: boolean }>,
  heartbeat: () => client.mutation("directory.heartbeat") as Promise<unknown>,
  lookup: (number: string) =>
    client.query("directory.lookup", { number }) as Promise<LookupResult | null>,
  contacts: () => client.query("contacts.list") as Promise<ContactRow[]>,
  threads: () => client.query("messages.threads") as Promise<ThreadRow[]>,
  callHistory: () => client.query("calls.history") as Promise<CallRow[]>,
  conferenceHistory: () =>
    client.query("calls.conferenceHistory") as Promise<ConferenceRow[]>,
};
