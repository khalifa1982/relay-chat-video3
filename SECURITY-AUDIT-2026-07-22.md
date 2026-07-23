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

---

# Round 2 — full-platform deep sweep (v2.98.4)

After the initial 5 findings, an exhaustive multi-agent sweep covered 12 attack
surfaces (auth/sessions, the rest of signaling, storage/SigV4, tRPC IDOR, SQL,
crypto/secrets, SSRF, email/inbound, client XSS/CSP, DoS/ReDoS, the Redis-bus
cluster, and HTTP headers/config). Every candidate was put through an
independent adversarial verifier and then re-verified by hand against current
source before any change. **7 confirmed + 6 partial** survived verification; 8
were refuted. All confirmed findings and the meaningful partials are fixed
below (S1–S11).

| ID | Severity | Area | Status |
|----|----------|------|--------|
| S1 | **High** | PIN lockout bypass via a lost-update race (concurrent wrong guesses) | Fixed |
| S2 | Medium | `signal` relay had no room-membership check → ICE-candidate harvesting / IP deanonymization | Fixed |
| S3 | Low | `directory.presence`: anonymous, unthrottled presence + last-seen enumeration (no guest-privacy) | Fixed |
| S4 | Low | `directory.watchOnline`: unthrottled number-enumeration + name-harvest oracle | Fixed |
| S5 | Low | `calls.logStart`: unthrottled existence oracle + call-history row injection | Fixed |
| S6 | Low | `messages.markRead`: read-receipt IDOR across conversations you're not in | Fixed |
| S7 | Low | `POST /api/v2/upload`: no rate limit / quota → storage-cost DoS | Fixed |
| S8 | Low | Web Push endpoint: unvalidated URL → authenticated blind (HTTPS) SSRF | Fixed |
| S9 | Low | OTP attempt-counter lost-update race (same class as S1) | Fixed |
| S10 | Low | Session HMAC secret fell back to a public constant when `JWT_SECRET` unset | Fixed (fail closed in prod) |
| S11 | Low | Inbound-email HMAC secret same fail-open + unthrottled webhook | Fixed (fail closed in prod + rate limit) |

## S1 — PIN lockout bypass via a lost-update race (HIGH)

**Where:** `server/authPin.ts` `attemptPinLogin`.
**Problem.** The wrong-attempt counter was written as `stale_read + 1`: the code read `loginPinAttempts`, judged the verdict, then wrote a fixed value. N concurrent wrong guesses all observed `attempts = 0` and each wrote `1`, so increments were lost and an attacker could blow past the 3-try cap and brute-force the 10⁴ PIN space.
**Fix.** Increment + lock-on-threshold in a single conditional `UPDATE` guarded on `loginPinLockedAt IS NULL`, and derive the verdict from the **persisted** post-increment value (read back), not the stale caller count. Once the count crosses the cap the row locks and every later guess fails the guard. The lock email is sent exactly once (gated on the statement that crossed the threshold via `affectedRows`).

## S2 — `signal` relay had no room-membership check (MEDIUM)

**Where:** `server/relay.ts` `signal` case.
**Problem.** The `signal` relay forwarded SDP/ICE to any *currently-registered* pin with no check that the sender and target share a call. Any client with a guest identity who knew a victim's (public) number could, while the victim is merely online, force a silent WebRTC handshake and harvest the victim's host/srflx ICE candidates — **IP deanonymization** with no call, ring, or media consent.
**Fix.** Relay only when the sender and target share a room (active `pinRoom`/`roomId` **or** held `heldRoom`), mirroring the membership discipline already on `accept`/`reject`. Behavioral test added (positive in-room relay + negative out-of-room drop).

## S3–S5 — enumeration gaps that bypassed the F5 throttle (LOW)

`directory.presence`, `directory.watchOnline`, and `calls.logStart` each resolved identities / presence without the per-IP `directoryGate` that F5 added to `lookup`/`presenceMany`, leaving free enumeration + (for `watchOnline`) name-harvest and (for `logStart`) call-history row injection over the 10⁶ number space. **Fix:** apply `directoryGate(ctx)` to all three, and add the guest-privacy (`isGuestPresenceHidden`) pass to `presence` so hidden guests don't leak last-seen. Endpoints stay public (the `/i/<pin>` direct-join needs them).

## S6 — `markRead` read-receipt IDOR (LOW)

**Where:** `server/v2db.ts` `markThreadRead` + the `messages.markRead` router.
**Problem.** The `unreadCount` write was membership-scoped, but the peer-message `status:"read"` UPDATE was not — any identity could iterate conversation ids and flip other conversations' inbound messages to "read", corrupting real participants' delivery receipts (and the router fanned out a `read` SSE regardless).
**Fix.** Confirm `conversationParticipants` membership inside the same transaction and bail out for non-members; `markThreadRead` now returns whether the caller was a member, and the router only fans out the SSE when true.

## S7 — upload endpoint DoS (LOW)

**Where:** `server/v2upload.ts`.
**Problem.** `POST /api/v2/upload` had no rate limit or quota; a single free guest could loop ~40 MB PUTs into the operator's S3 bucket (storage/egress cost DoS).
**Fix.** Per-IP **and** per-identity token buckets (generous — a photo is thumb + full = 2 calls), checked before any `storagePut`, honoring `RELAY_RATELIMIT_OFF`.

## S8 — Web Push endpoint SSRF (LOW)

**Where:** `server/v2routers.ts` `push.subscribe` → `server/webPush.ts`.
**Problem.** The `webpush` `endpoint` is a client-supplied URL the server later connects to (`web-push` → `https.request`). No validation meant a caller could subscribe with an internal URL and turn a later push into a blind SSRF (e.g. cloud metadata / a VPC service).
**Fix.** New `isAllowedWebPushEndpoint` requires `https:` on a known push-service host (FCM / Mozilla / WNS / Apple); enforced on `subscribe` and again defensively before `sendNotification` (legacy rows dropped). FCM tokens (not URLs) are unaffected.

## S9 — OTP attempt-counter race (LOW)

**Where:** `server/authOtp.ts` `recordOtpFailure`. Same lost-update class as S1. **Fix:** atomic guarded `UPDATE` (increment + burn-on-cap), verdict from the persisted count.

## S10 / S11 — signing secrets failed open in production (LOW)

**Where:** `server/authLocal.ts` `sessionSecret`, `server/emailInbound.ts` `inboundSecret`.
**Problem.** Both fell back to a public constant (`"relay-dev-secret"` / `"relay-inbound-dev-secret"`) when `JWT_SECRET`/`INBOUND_EMAIL_SECRET` were unset. The session token is a bare HMAC over `"<userId>.<exp>"` with no server store, so the public constant would make session forgery for any user trivial. Not exploitable on the correctly-provisioned `.io` fleet (which sets `JWT_SECRET`), but a latent fail-open.
**Fix.** Fail **closed** in production (`NODE_ENV === "production"` → throw rather than sign/verify with the public constant); dev/test keep the fallback. The inbound webhook route also gained a per-IP rate limit.

## Verification (round 2)

`pnpm check` clean; `pnpm test` **1208 passing / 1 skipped**; `pnpm build` clean. New `server/securitySweep.test.ts` (behavioral SSRF-allowlist tests + source pins for S1/S3–S11); `server/relay.test.ts` gained a behavioral S2 test (in-room relay works, out-of-room is dropped).

## Accepted residuals / follow-ups (not changed)

- **Signaling invite fan-out** (partial): no per-caller outstanding-ring cap / `pendingRings` reaper. The verifier downgraded the "one message → O(N)" framing (each invite is an individual rate-limited POST), and the risk of a too-low cap or too-short reaper TTL breaking legitimate group dials / slow-answer paging outweighs the bounded benefit — deliberately not changed in this batch.
- **Inbound webhook signature** stays opt-in (`INBOUND_EMAIL_WEBHOOK_SECRET`), since making it mandatory would break operators running inbound email without it; the reply path is still bound by the `From == owner-email` check.
- Consider deleting/overwriting the S3 object on view-once consume for defense-in-depth (the access layer already fails closed — F3).
- Set `RELAY_TRUSTED_PROXY_HOPS` explicitly on any deployment with more than one front proxy.
- No CSP / `X-Frame-Options` header (deliberate — the app is framed by the editor; refuted as no-exploit); revisit if the framing requirement is dropped.
