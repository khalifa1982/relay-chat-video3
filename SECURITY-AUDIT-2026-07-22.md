# RELAY — Security Audit & Remediation

**Date:** 2026-07-22
**Scope:** Full reachable attack surface — client ↔ server connections (tRPC API, SSE + POST signaling), the WebRTC signaling engine, storage/attachment authorization, auth flows, the mailer, the SigV4 S3 signer, rate limiting, and the DB access layer. Owner-requested comprehensive review of "all app connections, front and back, and the database."
**Baseline commit:** `56c819e` (branch `claude/install-security-plugin-4g9z8p`)
**Method:** Automated vulnerability scan (Claude Security), followed by independent verification of every candidate finding against the current source, then targeted fixes with regression tests. No production data or live systems were touched.

**Result:** 5 findings confirmed (1 High, 2 Medium, 2 Low). **All 5 fixed.** Full suite green: **1179 passing / 1 skipped**, `tsc --noEmit` clean, production build clean.

Owner-accepted design decisions documented in `CLAUDE.md` (SSE-instead-of-WebSocket signaling, the intentionally-kept `/api/oauth/callback`, and the temporary `RELAY_OTP_REGISTER_BYPASS` email-outage stopgap) were reviewed and are **not** defects.

---

## Summary table

| ID | Severity | Area | Status |
|----|----------|------|--------|
| F1 | **High** | Signaling `register` had no binding to the authenticated identity | Fixed |
| F2 | Medium | `updateProfile` accepted an avatar key the caller didn't own → laundered to public | Fixed |
| F3 | Medium | Burning view-once media made it *more* accessible (served unauthenticated) | Fixed |
| F4 | Low | Per-IP rate limits keyed on a spoofable `X-Forwarded-For` hop | Fixed |
| F5 | Low | Unauthenticated, unthrottled directory enumeration | Fixed |

---

## F1 — Signaling number claimed with no identity binding (HIGH)

**Where:** `server/relay.ts` — the `register` handler and `POST /api/relay/send`.

**Problem.** The SSE + POST signaling transport was keyed only by a **client-minted `cid`**, and a client claimed its 6-digit number via the client-supplied `msg.pin` in the `register` message. Neither endpoint consulted the session/guest cookie, and `register` granted any requested number that was free (or already owned by the same `cid`). Because numbers are public identifiers (directory previews, `/i/<pin>` links), the only barrier — the number being currently connected — is absent for any user whose app is backgrounded or closed.

**Impact.** An attacker who knows a target number (public) and finds it not currently connected could:
- **Intercept inbound calls** — register the victim's number, then answer calls dialed to the victim over live voice/video + the in-call data channel; and
- **Spoof caller-ID** — place calls presenting the victim's name and number to a third party.

This was conspicuous next to `/api/v2/events` and the whole tRPC layer, which already bind the connection to a server-resolved identity via `createContext`.

**Fix.** Bind the claimed number to the authenticated caller. `POST /api/relay/send` now, for `register` messages only, resolves the caller's own identity number from their session/guest cookie (via the same `createContext` used everywhere else) and stamps it on a **server-only** `__ownedNumber` field (any client-supplied value is stripped first). The `register` handler uses that number and ignores a mismatched `msg.pin`:
- resolved number → the caller gets **their own** number (also self-heals a client stale after `regenerateNumber`);
- resolved to `null` (no cookie, or a resolution error) → an explicit claim is **refused**; a fresh number is allocated (fail closed);
- field absent (direct `handleMessage` / unit tests) → legacy behavior preserved.

Because `EventSource` can't send custom headers but the signaling **POSTs** can, the client now also attaches the stable `x-relay-device-id` header on `/api/relay/send`, so guests whose cookie was dropped by Safari ITP / privacy mode still resolve to their real number (same cookie-loss fallback the tRPC client and upload route use). Only `register` pays the async identity-resolution cost; every other signaling message (offer/answer/ICE) still runs fully synchronously.

**Residual note.** The `signal` case still relays SDP/ICE to any registered number without a room-membership check. With numbers now bound to identities this is a much smaller surface (you can only originate from your own number), but a room-membership assertion on `signal` is recommended as follow-up hardening.

**Tests.** `server/securityAudit.test.ts` — a client is bound to its resolved number and a mismatched requested pin is ignored; an attacker cannot seize a victim's offline number; a null identity cannot claim a free number; same-cid reconnect keeps its bound number; the legacy no-field path is unchanged; plus source pins for the handler's strip/resolve/fail-closed wiring.

---

## F2 — Avatar URL accepted a key the caller didn't own (MEDIUM)

**Where:** `server/v2routers.ts` `identity.updateProfile` → `authorizeStorageKey` / `isIdentityAvatarKey` (`server/v2db.ts`) → `server/_core/storageProxy.ts`.

**Problem.** `updateProfile` validated only the **shape** of `avatarUrl` (`/manus-storage/…`, `http(s)://`, `data:image/`), not ownership — unlike `attachments.register` and `status.post`, which enforce `keyInOwnerNamespace`. `authorizeStorageKey` then rescues any key equal to *some* identity's current `avatarUrl` as a semi-public avatar, which the storage proxy serves to **anyone, even unauthenticated**.

**Impact.** A conversation participant could set their own `avatarUrl` to another user's **private attachment key** and thereby promote that private file to a stable, world-readable URL — surviving the sender's unsend.

**Fix.** `updateProfile` now rejects a `/manus-storage/` `avatarUrl` whose key is not in the caller's own upload namespace (`keyInOwnerNamespace(key, me.id, …)`), matching `attachments.register` and `status.post`. Absolute (`https`) and `data:` URIs are unaffected — they never resolve through the storage proxy. (F1/F2 reinforce each other: a stranger's attachment key lives in the sender's namespace, so it can no longer be laundered into an avatar.)

**Tests.** `server/securityAudit.test.ts` pins the ownership gate on the write path; `server/attachmentAuth.test.ts` already proves `keyInOwnerNamespace` correctness.

---

## F3 — Burning view-once media made it unauthenticated-public (MEDIUM)

**Where:** `server/v2db.ts` `consumeExpiringMessage` + `authorizeStorageKey` + `server/_core/storageProxy.ts`.

**Problem.** On "burn", `consumeExpiringMessage` **deleted the attachments row** to "revoke media access." But the S3 object persists, and with no row `authorizeStorageKey` classifies the key as `kind:"unknown"` — which the storage proxy serves **without any auth check**. Net effect: a destroyed view-once clip went from participant-gated to world-served-if-URL-known. (Status media, by contrast, correctly fails *closed*.)

**Impact.** A "burned" clip's `/manus-storage/<key>` URL kept resolving for anyone (no login), the opposite of the feature's privacy promise.

**Fix.** `consumeExpiringMessage` no longer deletes the row. The message's `attachmentId` is nulled (which already revokes participant access via `getAttachmentForIdentity` — no conversation references the file), and keeping the row keeps the key classified as `attachment`, so `authorizeStorageKey` returns *unauthorized* and the proxy returns **403** for every non-uploader — fail **closed**, matching the status-media model (ephemeral at the access layer even though the object lingers in the bucket).

**Tests.** `server/peerIdentityBatch.test.ts` (updated) asserts consume nulls the link, does **not** delete the row, and documents the fail-closed rationale.

---

## F4 — Rate limits keyed on a spoofable `X-Forwarded-For` hop (LOW)

**Where:** `server/rateLimit.ts` `clientIpOf`, `server/v2routers.ts` `pickClientIp`.

**Problem.** Both trusted the **leftmost** `X-Forwarded-For` hop. Behind the documented AWS ALB (which *appends* the real peer IP to the right), the leftmost value is attacker-supplied, so rotating `X-Forwarded-For` mints a fresh rate-limit bucket per request and defeats every per-IP limiter (`/api/relay/send`, OTP gate, stream/ICE, party-line, status). Account-level protections (OTP attempt cap, PIN lockout — keyed on email/account) still held, so this weakened abuse/DoS backstops, not account security.

**Fix.** Both helpers now trust the hop the front proxy **appended** — `trustedProxyHops()` positions from the right (default `1` = a single ALB; set `RELAY_TRUSTED_PROXY_HOPS=2` for a CloudFront → ALB chain). A client cannot forge that hop. `CF-Connecting-IP` remains preferred where Cloudflare is the front proxy. Falls back to the leftmost real hop then the socket address.

**Tests.** `server/rateLimit.test.ts` and `server/geoSelf.test.ts` (updated) assert the rightmost hop is trusted, a rotating spoofed leftmost hop can't change the keyed IP, and `RELAY_TRUSTED_PROXY_HOPS` is honored.

**Ops note.** Deployments with more than one trusted proxy in front of the app must set `RELAY_TRUSTED_PROXY_HOPS` to the proxy count. The `.io` ALB-only deployment needs no change (default 1).

---

## F5 — Unauthenticated, unthrottled directory enumeration (LOW)

**Where:** `server/v2routers.ts` `directory.lookup` and `directory.presenceMany`.

**Problem.** `lookup` is a `publicProcedure` with no rate gate; for any 6-digit number it returns existence, display name, avatar URL, verified badge, and live presence. The 10⁶ number space was freely and silently enumerable — a full scrape of the user directory.

**Fix.** A generous per-IP token bucket (`directoryGate`: 120 burst, ~60/min sustained, keyed on the now-trusted client IP, honoring `RELAY_RATELIMIT_OFF`) now gates `lookup` and `presenceMany`. This is invisible to any real dialer but turns a full enumeration into a multi-day, obvious grind. The endpoints stay **public** on purpose — an unidentified visitor opening an `/i/<pin>` call link resolves the callee via `lookup` before entering a name — so requiring identity was deliberately avoided.

**Tests.** `server/securityAudit.test.ts` pins the limiter/gate definition, its application to both procedures, and the `RELAY_RATELIMIT_OFF` escape hatch.

---

## Files changed

- `server/relay.ts` — F1: server-only `__ownedNumber`, resolved via `createContext` on `register`, bound in the register handler.
- `client/src/lib/relayClient.ts` — F1: send `x-relay-device-id` on `/api/relay/send`.
- `server/v2routers.ts` — F2: avatar-key ownership gate; F4: `pickClientIp` trusts the appended hop; F5: `directoryGate` on `lookup`/`presenceMany`.
- `server/v2db.ts` — F3: stop deleting the attachment row on consume (fail closed).
- `server/rateLimit.ts` — F4: `trustedProxyHops()` + rightmost-hop `clientIpOf`.
- Tests: `server/securityAudit.test.ts` (new), `server/rateLimit.test.ts`, `server/geoSelf.test.ts`, `server/peerIdentityBatch.test.ts`, `server/relayCluster.integration.test.ts`.

## Recommended follow-ups (not in this change)

- Add a room-membership assertion to the signaling `signal` case (F1 residual).
- Consider deleting/overwriting the S3 object on view-once consume for defense-in-depth (the access layer already fails closed).
- Set `RELAY_TRUSTED_PROXY_HOPS` explicitly on any deployment with more than one front proxy.
