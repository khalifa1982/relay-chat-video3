/**
 * The `x-relay-device-id` header and the one rule for reading it.
 *
 * This lives in its own dependency-free module because THREE different entry
 * points now need it — the tRPC context resolver, the legacy
 * `POST /api/auth/register` route, and any future non-tRPC route that mints an
 * identity — and two of those already import each other. A second copy of the
 * rule is worse than a small file: the whole reason a guest's number, contacts
 * and messages could be orphaned at registration (v2.99.49) is that two places
 * disagreed about which identity a browser was using.
 */
export const DEVICE_ID_HEADER = "x-relay-device-id";

/**
 * Normalize a device id coming off the wire.
 *
 * The client mints it from `crypto.getRandomValues`, so it is always lowercase
 * hex; anything else is a bogus or hand-crafted header and is rejected rather
 * than sanitized. Length bounds keep it a plausible identifier and keep the
 * value that reaches an indexed column bounded.
 */
export function normalizeDeviceId(raw: unknown): string | null {
  // Node gives an array when a header is repeated; take the first.
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < 8 || trimmed.length > 64) return null;
  if (!/^[a-f0-9]+$/i.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/** Read + normalize the header off any Express-shaped request. */
export function deviceIdFromRequest(req: { headers?: unknown }): string | null {
  const headers = req.headers;
  if (!headers || typeof headers !== "object") return null;
  return normalizeDeviceId((headers as Record<string, unknown>)[DEVICE_ID_HEADER]);
}
