/* ============================================================
   "Dubai, AE · Email code", TRANSLATED — the one client-side renderer.

   WHY THIS EXISTS. `describeLogin` on the server composes place · method into a
   finished English phrase, and BOTH surfaces that show a waiting sign-in — the
   notification centre and Profile → Devices — rendered that phrase verbatim. So on
   an Arabic screen the one detail that is genuinely prose, HOW somebody got in,
   arrived in English.

   ONLY THE METHOD MOVES, and that is the whole scope. A city name arrives written
   as the geo service writes it, an ISO country code is the same in every language,
   and an IP is digits — translating any of those would be inventing a fact rather
   than rendering one. The server still sends the composed `detail` for a client on
   the previous bundle; this prefers the enum when it is there.

   TWO CONSUMERS, ONE FUNCTION, for the reason this codebase keeps re-learning: two
   copies of "how do I phrase a login" is how two screens come to describe one
   sign-in differently, which is exactly what `server/loginOrigin.ts` says in its
   own header about the three surfaces it serves.
   ============================================================ */
import type { TKey } from "./i18n";

type T = (key: TKey, vars?: Record<string, string | number>) => string;

/** The three ways in, exactly as the server enumerates them. */
export type LoginMethodWire = "code" | "pin" | "register";

const METHOD_KEY: Record<LoginMethodWire, TKey> = {
  code: "alerts.loginMethodCode",
  pin: "alerts.loginMethodPin",
  register: "alerts.loginMethodRegister",
};

/**
 * Narrow whatever arrived on the wire to a method we have a key for.
 *
 * FAILS TO NULL rather than to a default, matching `normalizeLoginMethod` on the
 * server and for the same reason: this is a claim shown to the account owner about
 * how somebody got into their account, and "4-digit passcode" when it was really an
 * email code is worse than saying nothing.
 */
export function loginMethodKey(v: unknown): TKey | null {
  return typeof v === "string" && v in METHOD_KEY ? METHOD_KEY[v as LoginMethodWire] : null;
}

/**
 * The one-line summary, with the method translated: `place · method`.
 *
 * The separator appears ONLY between two present halves — an interpolation that
 * always emits " · " is how a card ends up reading "Dubai, AE ·" with nothing after
 * it, which is the trap `describeLogin` already records on the server side.
 *
 * `fallback` is the server's pre-composed English `detail`, used when the payload
 * carries no `method` at all — a rolling deploy serves both bundles for about a
 * minute, and during it an older server's reply must still show something rather
 * than blanking the line.
 */
export function loginDetailLine(
  d: { place?: string | null; method?: unknown; detail?: string | null },
  t: T,
): string | null {
  const key = loginMethodKey(d.method);
  if (!key) return d.detail || null;
  const place = (d.place || "").trim();
  const method = t(key);
  return place ? `${place} · ${method}` : method;
}
