/**
 * ADOPT-AND-RETIRE, browser side (v2.99.68): the one durable thing a guest keeps.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * A guest identity holds a real 6-digit number, contacts, message threads and call
 * history. Both halves of the mechanism that resolve it are session-scoped on
 * purpose — the device id lives in `sessionStorage` and the guest cookie is a
 * session cookie — so closing the browser used to strand all of it with no way
 * back. That was an explicit product decision about a SHARED browser, and it stays
 * intact: nothing here is sent automatically and nothing here changes how an
 * identity is resolved on an ordinary request.
 *
 * What it adds is a record the PERSON can act on: "601-586 was mine, give it back."
 * Because it takes a deliberate tap, the shared-browser property is preserved by
 * the thing that actually protects it — an explicit sign-out deletes the record.
 *
 * WHY localStorage AND NOT A COOKIE
 * ---------------------------------
 * A cookie is sent on every request, which is exactly what would make recovery
 * automatic again. localStorage is only read when we choose to read it. It also
 * survives the guest cookie being dropped by ITP/ETP/Shields, which is the other
 * way people were losing their number.
 *
 * The stored `number` and `name` are a DISPLAY CACHE so the prompt can say which
 * number it is offering before any network call. They are never authoritative —
 * the server re-derives both from the key, so a hand-edited record cannot make the
 * prompt claim an identity the key does not name.
 */

const STORAGE_KEY = "relay_guest_recovery";

export type GuestRecoveryRecord = {
  /** The recovery key. 64 lowercase hex characters, minted server-side. */
  key: string;
  /** Display cache only — the server is the authority on both of these. */
  number: string;
  name: string;
  /** Unix ms, for "you last used this N days ago" copy. */
  savedAt: number;
};

const KEY_RE = /^[a-f0-9]{64}$/;

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Safari private mode throws on access rather than returning undefined.
    return null;
  }
}

/**
 * Read the stored record, or null.
 *
 * Validates the KEY's shape and rejects the whole record when it fails, because a
 * record whose key cannot possibly work is worse than none: it would render a
 * restore prompt that is guaranteed to fail. `number` and `name` are only ever
 * displayed, so they are coerced rather than validated.
 */
export function readGuestRecovery(): GuestRecoveryRecord | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuestRecoveryRecord> | null;
    const key =
      typeof parsed?.key === "string" ? parsed.key.trim().toLowerCase() : "";
    if (!KEY_RE.test(key)) return null;
    return {
      key,
      number: typeof parsed?.number === "string" ? parsed.number : "",
      name: typeof parsed?.name === "string" ? parsed.name : "",
      savedAt: typeof parsed?.savedAt === "number" ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Store (or refresh) the record for the identity this browser is using.
 *
 * Called whenever the server hands back a recovery key. A null/blank key is a
 * no-op rather than a delete — the server returns null to mean "this row already
 * has a key", and treating that as "forget the record" would throw away the only
 * copy of a key that is still perfectly valid.
 */
export function rememberGuestRecovery(input: {
  key: string | null | undefined;
  number?: string;
  name?: string;
}): void {
  const key =
    typeof input.key === "string" ? input.key.trim().toLowerCase() : "";
  if (!KEY_RE.test(key)) return;
  const s = storage();
  if (!s) return;
  try {
    const rec: GuestRecoveryRecord = {
      key,
      number: input.number ?? "",
      name: input.name ?? "",
      savedAt: Date.now(),
    };
    s.setItem(STORAGE_KEY, JSON.stringify(rec));
  } catch {
    /* storage full or disabled — recovery is a convenience, never a blocker */
  }
}

/**
 * Update the cached display fields without touching the key.
 *
 * Needed because the key is issued once but the person can rename themselves or
 * regenerate their number afterwards, and a prompt offering a number they no
 * longer own reads as a bug even though the key still resolves correctly.
 */
export function refreshGuestRecoveryLabel(number: string, name: string): void {
  const existing = readGuestRecovery();
  if (!existing) return;
  if (existing.number === number && existing.name === name) return;
  rememberGuestRecovery({ key: existing.key, number, name });
}

/**
 * Delete the record. Called on an explicit sign-out — that is the gesture that
 * makes a shared browser safe, and it is why automatic resolution did not have to
 * be loosened to give people their data back.
 */
export function forgetGuestRecovery(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}
