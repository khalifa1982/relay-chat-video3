import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import {
  ensureUserIdentity,
  getIdentityByGuestToken,
  type ResolvedIdentity,
} from "../v2db";

export const GUEST_COOKIE = "relay_guest";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  identity: ResolvedIdentity | null; // either guest or registered, when known
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    user = null;
  }

  let identity: ResolvedIdentity | null = null;

  // Registered user takes precedence — ensure they have an identity row.
  if (user) {
    try {
      identity = await ensureUserIdentity({
        userId: user.id,
        displayName: user.name || "User",
        guestToken: (opts.req.cookies?.[GUEST_COOKIE] as string | undefined) ?? null,
      });
    } catch {
      identity = null;
    }
  } else {
    // Guest path — restore identity from the 30-day cookie if it's still valid.
    const token = (opts.req.cookies?.[GUEST_COOKIE] as string | undefined) ?? null;
    if (token) {
      try {
        identity = await getIdentityByGuestToken(token);
      } catch {
        identity = null;
      }
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    identity,
  };
}
