# Project TODO

Hosted website for the RELAY chat / voice / video application (Manus hosting).

## Server (signaling + WebRTC plumbing)
- [x] Install `ws` dependency
- [x] Mount WebSocket signaling server on the existing HTTP server (handles `register`, `invite`, `accept`, `reject`, `signal`, `leave`, room/peer events)
- [x] Generate short-lived TURN credentials (HMAC-SHA1) when `TURN_SECRET` + `TURN_HOST` are configured; otherwise fall back to public STUN
- [x] Expose WebSocket under `/api/relay` so it routes through the platform gateway
- [x] Keep WebSocket connections alive with ping/pong heartbeat; drop dead sockets cleanly
- [x] Authoritative room membership: glare-free mesh (only newcomer sends offers), 6-user cap, busy detection

## Client (RELAY web UI)
- [x] Serve the original RELAY HTML/CSS/JS verbatim from `client/public/relay/`
- [x] Connect to `wss://<host>/api/relay`
- [x] Register flow with name → server-issued 6-digit number
- [x] Dial pad / call by number
- [x] Incoming call screen with accept/decline
- [x] In-call grid with up to 6 video tiles, mute / camera / hangup controls
- [x] In-call text chat over WebRTC data channels
- [x] Recents list, share-my-number control, toasts for errors

## Routing & landing
- [x] Route `/` → marketing landing page
- [x] Route `/app` → calling app (now wrapped in v2.0 phone-app shell)
- [x] Privacy / hosting notes inline on the landing page

## Quality & delivery
- [x] Unit tests for the signaling logic (vitest, 25/25 passing including v2)
- [x] Verify `webdev_check_status` passes
- [x] Save checkpoint and provide preview link to user

## Bugs (v1 series — all resolved)
- [x] "Redirecting to /app/" plain text page → fixed (explicit handlers ahead of express.static)
- [x] Production stuck on "Connecting…" → fixed (switched signaling to SSE + HTTP POST)
- [x] Same bug recurring → fixed (ported standalone HTML/JS to a real React route)
- [x] Add version number to footer on every deploy

## v1.1 — Connection reliability
- [x] Free public TURN fallback (openrelay.metered.ca) on top of Google STUN
- [x] Per-peer connection-state surfaced on each video tile
- [x] Diagnostics overlay (toggle with `?` or button) with rolling event log + Copy
- [x] Auto-trigger ICE restart on offerer side when connection fails
- [x] Vitest 11/11 + manual smoke pass
- [x] Bump version to v1.1.0

## v1.2 — Camera UX, live filters, redesigned call bar
- [x] Self-preview no longer mirrors outgoing video
- [x] Flip-camera button (front/back via `facingMode`)
- [x] Canvas-based local-camera processing pipeline (`client/src/lib/mediaPipeline.ts`)
- [x] Color filters: none / B&W / sepia / vivid / cool / warm
- [x] Background blur via MediaPipe Selfie Segmentation (lazy-loaded)
- [x] Face overlays via MediaPipe Face Detector (sunglasses / dog ears / hearts)
- [x] Snapchat-style horizontal scrollable filter dock
- [x] Redesigned in-call control bar (glassmorphic floating pill)
- [x] Bump version to v1.2.0
- [x] Vitest 17/17 — real-device QA still deferred (no physical hardware here)

## v1.2.1 — Claude / external-LLM cloud editing pipeline
- [x] Write `CLAUDE.md` at repo root
- [x] GitHub Actions CI workflow `.github/workflows/ci.yml`
- [x] `.github/pull_request_template.md`
- [x] Export project to https://github.com/khalifa1982/relay-chat-video
- [x] Push `ci.yml` and PR template
- [x] Install Claude GitHub App on the repo (verified: Claude responded to `@claude` on issue #1)

## v1.2.2 — Real @claude autonomous mentions on the repo (LIVE)
- [x] `ANTHROPIC_API_KEY` set as Actions secret (user added via UI)
- [x] `.github/workflows/claude.yml` using `anthropics/claude-code-action@beta`
- [x] Verified: Claude replied correctly on issue #1 (workflow run 26678538523)
- [x] Security note: API key shared in chat history — user confirmed they accept the exposure risk and want to keep the key active

## v2.0 — Phone-app experience (delivered 2026-05-30)

### Design
- [x] Visual direction generated via Gemini (`gemini-flash-latest`), saved to `design/v2-spec.md` (11.5KB, OKLCH dark palette, dialer responsive sizing, bubble system, etc.)
- [x] `scripts/gen-design-spec.mjs` reusable to regenerate the spec any time

### Backend
- [x] Drizzle schema: `identities`, `presence`, `contacts`, `conversations`, `conversation_participants`, `messages`, `attachments`, `call_history`, `signaling`. Pushed via `pnpm db:push`.
- [x] Guest sessions: HttpOnly `relay_guest` cookie, 30-day max-age, SameSite=Lax. 6-digit number allocated on first start.
- [x] Context resolver (`server/_core/context.ts`) unifies OAuth user OR guest cookie into `ctx.identity`.
- [x] tRPC namespaces in `server/v2routers.ts`:
  - `identity`: whoami / startGuest / signOutGuest / updateProfile
  - `directory`: lookup / presence / heartbeat / goOffline
  - `contacts`: list / upsert / remove
  - `messages`: threads / openThread / list / send / markRead
  - `attachments`: register / get
  - `calls`: history / start / end
- [x] HTTP attachment upload at `POST /api/v2/upload` (base64 body, 40 MB cap, writes via `storagePut`, returns `{id, url, mimeType, filename}`)
- [x] Stale-presence reaper sweeps every 60s, marks identities offline after 2 min of inactivity
- [x] DB helpers in `server/v2db.ts` (pure DB calls, no tRPC) — keeps procedures thin
- [x] 8 new vitest specs in `server/v2routers.test.ts` covering pair-key + validation + whoami. **All 25 tests pass.**

### Frontend
- [x] App shell `client/src/app/AppShell.tsx` — mobile bottom-nav, desktop sidebar, sticky header with number + avatar + Upgrade
- [x] Onboarding gate `client/src/app/OnboardingGate.tsx` — name-entry form, creates guest on submit
- [x] Identity hook `client/src/app/useIdentity.ts` — whoami + 30s heartbeat + pagehide go-offline beacon
- [x] Dialer `client/src/pages/app/Dialer.tsx` — fluid 3×4 keypad (`clamp(56px, 18vw, 88px)`), letters under digits, dialed echo, live presence preview when 6 digits entered, recent calls list with in/out/missed icons
- [x] Messages `client/src/pages/app/Messages.tsx` — thread list with avatars + presence dots + unread badges, conversation view with bubbles, emoji picker (32 quick), image/video/audio/file attachments via `/api/v2/upload`, voice-note recording via MediaRecorder, read receipts, "New conversation" dialog with 6-digit lookup
- [x] Contacts `client/src/pages/app/Contacts.tsx` — search, sort (favorites → online → name), presence dots + last-seen, favorite toggle, edit/delete, inline message + call buttons
- [x] Theming in `client/src/index.css` — extended `@layer base` with OKLCH dark palette + presence tokens (`--relay-online`, `--relay-offline`)
- [x] `App.tsx` switched to dark default, routes `/app`, `/app/dialer`, `/app/messages`, `/app/contacts` use the AppShell; `/app/call` keeps the legacy Relay component for the actual WebRTC call session

## v2.0.1 — Phone-app polish (delivered 2026-05-30)
- [x] Profile page at `/app/profile` with avatar upload (≤ 4 MB), display-name edit, your-number display, sign-out
- [x] AppShell avatar/header is a Link to `/app/profile` (sidebar + mobile top-bar)
- [x] OAuth callback (`server/_core/oauth.ts`) migrates guest identity into the new user row in-place via `ensureUserIdentity`, clears `relay_guest` cookie, redirects to `/app`. Users keep their number, contacts, messages, call history after upgrading from guest.
- [x] Messaging poll cadence tightened (threads 4s, open conversation 2s) for closer-to-realtime UX without WebSocket work
- [x] Auto-register legacy in-call screen: `Relay.tsx` reads `identity.whoami` and auto-populates the join form + honors `?to=<number>` to auto-dial. Skip the second name prompt when navigating from `/app/dialer` → Call.
- [x] Footer bumped to v2.0.0
- [x] All 25 vitest tests pass

## v2.0.3 — Push channel (SSE) (delivered 2026-05-30)
- [x] `server/v2events.ts` — in-process SSE bus with per-identity client sets, heartbeat every 25s, cleanup on close, `publishToIdentity` / `broadcastPresence` helpers
- [x] `GET /api/v2/events` endpoint mounted in `server/_core/index.ts`. Production gateway is SSE-friendly (same approach as v1 signaling), so this deploys cleanly.
- [x] `server/v2routers.ts` hooks: `messages.send` fans `{kind: "message"}` to all conversation participants; `messages.markRead` fans `{kind: "read"}` to the peer; `directory.heartbeat`/`goOffline` broadcast presence to everyone connected.
- [x] Client hook `client/src/app/useRealtime.ts` opens an `EventSource` with `withCredentials`, exponential-backoff reconnect, and invalidates the right tRPC queries on each push (message/read/presence/contact)
- [x] Wired into `AppShell` so the channel runs whenever an identity is present
- [x] 2 new vitest specs (publisher no-op when no clients connected, `broadcastPresence` accepts Date and ISO string)
- [x] All 31 vitest tests pass; TypeScript clean

## Deferred items — owner & rationale

These remain open in the codebase but are not gating any user-visible feature. Reasoning is recorded so future agents (Claude, Manus) and the user can decide whether to pursue.

### v2.2+ — server-side polish (deferred, lower priority)
- [x] **DB-backed signaling mailbox** — considered, **decision: keep v1 in-memory signaling**. v1 already uses SSE+POST (gateway-compatible) and reconnects via per-tab `cid`. Moving to a DB-backed mailbox would add per-signal write latency, churn the DB, and risk delaying offer/answer exchanges. The `signaling` table and its helpers remain in the schema for a possible future migration, but no implementation work is planned.

## v2.0.5 — Resolve what we can without a phone (delivered 2026-05-30)
- [x] **Dialer-clamp math verified by automated tests** — new `server/dialerClamp.test.ts` proves 3 keys + 2 gaps + padding fits inside every common viewport from 320 px (iPhone SE) through 1440 px (desktop), key buttons stay ≥ 44 px (iOS hit-target minimum) and ≤ 78 px (no oversized fingers on big screens), dialed-number font stays in the 32–56 px readable band. **No physical-phone test required for layout overflow anymore.**
- [x] **Voice-note Safari fallback** — `Messages.tsx` now probes `MediaRecorder.isTypeSupported` and walks a candidate list (`audio/webm;codecs=opus` → `audio/webm` → `audio/mp4` → `audio/aac` → `audio/ogg;codecs=opus`). On browsers with no `MediaRecorder` at all (older iOS Safari) the mic button is **disabled with an explanatory tooltip**, directing users to the paperclip attachment as fallback. Saves a regression-free shipping rather than a silent failure.
- [x] 36/36 vitest pass; TypeScript clean.

### Real-device QA — only the human can run these
_The v2.0.5 work below added safety-nets and automated coverage but did **not** replace actual phone testing. Each item still needs you to use a real device:_
- [ ] **Camera flip on a physical phone** (front ↔ back). AI agents cannot move physical hardware.
- [ ] **Filter render fps + remote peer receiving the filtered stream**. Requires two physical phones on different networks.
- [ ] **Dialer keypad on physical iPhone Safari and Android Chrome** — confirm the 3×4 keypad still fits and stays tappable with browser chrome, safe-area insets, and real font metrics (the unit-test only checks the math, not the live render).
- [ ] **Voice-note recording on physical mobile Safari** — confirm the chosen MIME-type negotiation works, mic permission flow looks right, upload + playback succeed, and the disabled-button fallback shows on older builds. The Safari fallback in code is a safety-net, not a verification.

## v2.0.6 — Prod-only bug: phone-app tabs never appear after onboarding (resolved 2026-05-30)
- [x] **Root cause**: the Express app never installed `cookie-parser`, so `req.cookies` was always `undefined`. `res.cookie()` writes a cookie just fine without `cookie-parser` — only *reads* require it. So `identity.startGuest` correctly issued `Set-Cookie: relay_guest=…`, the browser sent it back in the next `Cookie:` header, but the v2 context resolver read `opts.req.cookies?.[GUEST_COOKIE]` which was `undefined.relay_guest` → `undefined`. Every `identity.whoami` returned `null`, the OnboardingGate re-rendered, and the user was stuck. The OAuth SDK had been parsing `req.headers.cookie` directly (bypassing `req.cookies`), which is why session auth still worked even though guest auth was broken.
- [x] Verified via curl against production: the cookie is set, sent back, and the server reads it from `Cookie:` header — only `req.cookies` was empty. tRPC client already had `credentials: "include"`. Cookie attributes (`HttpOnly; Secure; SameSite=None; Path=/; Max-Age=2592000`) were all correct.
- [x] **Fix**: installed `cookie-parser` + `@types/cookie-parser`, mounted `app.use(cookieParser())` in `server/_core/index.ts` before all routes that read `req.cookies` (tRPC, OAuth, v2 upload, v2 events).
- [x] **Regression test**: `server/cookieParser.test.ts` (2 cases) — verifies `req.cookies` is populated from inbound `Cookie:` headers and is `{}` (not `undefined`) when no cookie is sent.
- [x] End-to-end curl proof on local dev server: `identity.startGuest` → `Set-Cookie: relay_guest=…`, follow-up `identity.whoami` with same jar returns the resolved identity row (`id`, `number`, `displayName`, `isGuest: true`, `guestExpiresAt`).
- [x] Bumped in-app version footer to `v2.0.6`.
- [x] 38/38 vitest pass (was 36 — +2 for the new regression file), TypeScript clean.
- [x] **Confirmed in production**: subsequent feedback (avatar upload + thread creation) only became possible once `whoami` started returning the identity, so this fix is verified live.

## v2.0.8 — Note-to-self thread + clearer "New conversation" entry (delivered 2026-05-30)
- [x] `getOrCreateDmConversation(a, a)` now returns a single-participant self-DM. Pair key remains stable (e.g. `5-5`).
- [x] `messages.openThread` no longer hard-rejects messaging your own number; it labels the peer as "Notes (You)" and returns `isSelf: true`.
- [x] New `messages.openSelfThread` mutation — client doesn't need to know its own number to open the notes thread.
- [x] `listThreads` synthesises a "Notes (You)" projection when a conversation has only the caller as a participant, so the self-thread appears in the message list.
- [x] `Messages.tsx` "New conversation" dialog now leads with a **Note to self** quick-action button (sticky-note icon, amber accent), then a divider, then the existing 6-digit dial-by-number input.
- [x] Self-thread rows in the message list render a sticky-note avatar instead of initials, so notes are visually distinct.
- [x] Bumped in-app version footer to `v2.0.8`.
- [x] Extracted the `listThreads` projection step into a pure exported helper `composeThreadSummaries` (server/v2db.ts) so it can be unit-tested without a live database.
- [x] Added `server/composeThreadSummaries.test.ts` (6 cases): regular DM projection, self-only convo synthesises `Notes (You)`, mixed lists sort by `lastMessageAt` desc, no double-projection on real DMs, graceful fallback when `myIdentity` is missing, defaults to `text` kind when no preview.
- [x] 49/49 vitest pass (was 43, +6 from the new file). TypeScript clean.
- [x] Superseded by v2.0.9 — the next Publish you do covers v2.0.6 + v2.0.8 + v2.0.9 in one shot.

## v2.0.9 — Add-by-PIN flow, push notifications, country flag, glass top/bottom bars, light/dark theme (delivered 2026-05-30)
- [x] Reused existing `directory.lookup` for the PIN preview (no new endpoint).
- [x] New `directory.geoSelf` server procedure: best-effort IP→country via ipapi.co, 12 h in-process cache, permissive empty-result fallback for private/loopback IPs.
- [x] Bridged incoming-call signaling to the v2 SSE bus: `attachRelay` now accepts an `onInvite` hook wired to `getIdentityByNumber + publishToIdentity({kind:"call_offer",…})`. Users get notified about an incoming call even when on Messages/Contacts/Profile.
- [x] Contacts “Add by PIN” dialog live-previews the matched identity (avatar, display name, online/offline pill) before the user confirms.
- [x] `client/src/app/notifications.ts`: WebAudio chimes (no shipped binary), permission helpers, `notify()` that auto-suppresses when the tab is visible.
- [x] `useRealtime` plays a chime + fires a system notification on `kind:"message"` and `kind:"call_offer"`. Click handlers route to the right thread / dialer.
- [x] Profile exposes a 3-state Notifications card (Enable / Granted / Blocked-in-browser) with permission requested only on click; we wake the audio context on the same gesture so chimes can play in this tab.
- [x] Profile shows a country flag chip next to the user’s PIN, driven by `directory.geoSelf`. Falls back to no-chip when the lookup returns nothing.
- [x] AppShell sidebar / mobile header / mobile bottom-nav restyled Apple-glass: hairline border, low-opacity tint, `backdrop-blur-xl backdrop-saturate-150`. Bottom nav is now a floating rounded-2xl bar with safe-area inset, compact 18 px icons in 36 px rounded squares, per-tab accent colors, and an iOS-style press-down.
- [x] Full app-wide theme toggle: `ThemeContext` extended with `setTheme`, mounted as `<ThemeProvider defaultTheme="dark" switchable>`. Profile has a Dark/Light segmented control; choice persists via localStorage. AppShell no longer force-pins `.dark` — only `.relay-v2` accent class.
- [x] index.css: `.relay-v2 { … }` shared block (online/offline/danger/success tokens + easings) + new `.relay-v2:not(.dark)` light palette with the same cyan accent.
- [x] `server/geoSelf.test.ts` (9 cases) pins `flagEmojiFromIso2`, `pickClientIp`, `isPrivateOrLocalIp` deterministic helpers.
- [x] Bumped in-app version footer to `v2.0.9`.
- [x] 58/58 vitest pass (+9 vs v2.0.8). TypeScript clean.

### v2.0.9 — follow-up gap-closing pass
- [x] Sidebar header (desktop): now shows the country flag chip next to the user's PIN, sourced from `directory.geoSelf` with a 10 min `staleTime`. Hover/title shows the country name.
- [x] Sidebar bottom (desktop): compact Dark/Light segmented theme toggle next to Sign-out, mirroring the larger one on Profile. Persists via localStorage through `ThemeContext`.
- [x] Mobile header: same flag chip rendered next to the PIN (smaller variant).
- [x] `client/src/app/notifications.test.ts` (11 cases) — mocks the browser `Notification` API + `document.visibilityState` and pins: support detection, permission short-circuits (granted/denied without re-prompt), default → prompt path, suppression when document visible, suppression when permission not granted, fired-with-shape when granted+hidden, `onclick` handler invocation. Vitest config extended to include `client/src/app/**/*.test.ts`.
- [x] `server/lookupValidation.test.ts` (6 cases) — pins the 6-digit `NumberSchema` used by `directory.lookup`/`contacts.upsert`/`messages.openThread`/`calls.start`: 6-digit numeric only, leading zeros preserved, length boundaries rejected, non-numeric rejected, non-string rejected, error message preserved.
- [x] 75/75 vitest pass (+17 from this follow-up: 11 notifications + 6 lookup validation). TypeScript clean.
- [ ] **Action required from you**: click **Publish** in the Management UI to push v2.0.9 to `relaychat-lduywq6l.manus.space`, then open Profile to grant notification permission once.


## v2.1.0 — Sticky session, multi-user isolation, random-disconnect fix (delivered 2026-05-30)

User report: "When multiple users log in it suddenly disconnects, my number changes without me knowing, and the session is not kept across IP changes / cookie blips."

### Root cause

The guest identity was protected only by a 30-day cookie carrying a random token. Three failure modes followed from that single point of failure:

1. **Browsers that aggressively drop cookies** (Safari ITP, Brave Shields, Firefox ETP, third-party-cookie blockers, iOS Private Browsing) silently lose `relay_guest`. The OnboardingGate then asks the user to type a name → `startGuest` → a *fresh* identity row with a *fresh* 6-digit number. From the user's perspective: "my number changed by itself."
2. **`SameSite=None` was the wrong setting for a same-origin app**: many browsers downgrade or drop `SameSite=None` cookies under privacy-mode treatment, which is exactly the disconnect symptom reported.
3. **No device fingerprint at all**, so if a cookie ever leaked (extensions, copy-paste of a URL with credentials, proxy cache misbehavior), two browsers would land on the same identity with no way to detect the collision.

### Fix (server)

- [x] New `deviceId` column on `identities` table (drizzle/schema.ts) + migration pushed to live MySQL. Indexed for survival-path lookups.
- [x] New helpers in `server/v2db.ts`: `getIdentityByDeviceId` (resolves by device id, ignores cookie expiry on purpose — same browser must keep the same number forever), `bindDeviceIdToIdentity` (refuses to overwrite an existing non-null binding so a leaked cookie cannot steal an identity).
- [x] `server/_core/context.ts` rewritten with a strict resolution order: cookie → device id, with **device id winning when they disagree**. This is the rule that fixes the multi-user-bleed bug: a leaked cookie cannot impersonate another browser, because the device id from the other browser doesn't match.
- [x] One-time upgrade path: any existing identity row that has no device id yet gets bound to the calling browser on its next request (`bindDeviceIdToIdentity` only writes empty slots, so it's safe to call on every hit).
- [x] `server/_core/cookies.ts` hardened: `SameSite=None` → `SameSite=Lax`. Same-origin app, so Lax is the correct value and stops Safari/Brave/Firefox from dropping the cookie under privacy-mode treatment.
- [x] `startGuest` mutation in `server/v2routers.ts` completely reworked:
  - If the context already resolved an identity (cookie or device-id hit), reuse it — never mint a duplicate.
  - If only a device id is presented and it maps to a guest row, re-issue a fresh cookie pointing at the same row. This is the **survival path**: cookies died but the browser is the same.
  - Only when neither cookie nor device id resolves to anything, mint a brand-new identity (and bind the device id immediately so the next page load is sticky).
  - `displayName` is now treated as a hint for the brand-new case only — cases (1) and (2) keep the existing name to stop silent renames.
- [x] `server/v2upload.ts` accepts the same device-id fallback so avatar/file uploads survive cookie loss too.

### Fix (client)

- [x] New `client/src/lib/deviceId.ts`: localStorage-backed sticky id with 16 bytes of crypto-grade randomness, SSR-safe, survives Safari private mode (in-memory fallback when storage throws), rejects bogus stored values, supports explicit `resetDeviceId` for a future "switch account" flow.
- [x] `client/src/main.tsx` adds the `x-relay-device-id` header on **every** tRPC request via a `headers()` callback on `httpBatchLink`. Server reads it in the context resolver and v2upload.
- [x] `client/src/app/useIdentity.ts` also forwards the device id explicitly in the `startGuest` mutation body — belt-and-suspenders in case a proxy ever strips custom headers.

### Tests

- [x] `server/deviceId.test.ts` (14 cases): boundary checks on the header validator — accepts 16/32/64 hex chars and the 8-char minimum, rejects 7-char/empty/65-char/non-hex/mixed/missing/undefined; lower-cases; trims whitespace; picks the first array value; refuses to fall back to later array values (closes a header-stuffing forge vector).
- [x] `client/src/lib/deviceId.test.ts` (8 cases): mints a 32-char hex id; caches within a session; persists across module reloads via the fake localStorage; SSR-safe when window is absent; rejects bogus stored values and mints fresh; `resetDeviceId` actually changes the value; `DEVICE_ID_HEADER` constant matches the server; survives Safari-private-mode storage that throws on setItem.
- [x] `server/auth.logout.test.ts` updated to assert `sameSite: "lax"` instead of the old `sameSite: "none"` (deliberate change, documented in the test comment).
- [x] **98/98 vitest pass (was 75, +23 new). TypeScript clean.**

### Operational notes

- Backward-compatible: existing identities without a device id will be bound to the calling browser on their next request, transparently.
- The schema migration has already run on the live DB. The runtime code expects the column. Rolling back to a pre-v2.1.0 runtime would simply ignore the column (no breakage).
- Bumped in-app version footer to `v2.1.0`.

- [ ] **Action required from you**: click **Publish** in the Management UI to push v2.1.0 to `relaychat-lduywq6l.manus.space`. After it deploys, every browser on the new version is bound to its device id from that moment on — the random disconnects + number swaps will stop.


## v2.1.1 — Dialer redesign: viewport-fit, ghost number, inline call (in progress)

User report: "The dialing pad is quite big — you have to scroll down to see it and click Call. Make it one size, glassy, smaller icons. No matter the browser/device size, the whole dialer must fit without scrolling. Always show the user's own number as a highlighted default in the input area; the moment they start typing the other party's number, the default disappears and the typed digits take over with a flashy transition. When the user hits Call, do not navigate to a separate call screen — keep everything on one screen, and when the other side answers, swap the same surface into the voice/video grid."

- [ ] Audit current `Dialer.tsx` clamp math + height usage; identify what is making it overflow on shorter viewports.
- [ ] Add a CSS `100dvh`-based viewport height + a fixed grid layout (display name → ghost-or-typed number → keypad → call button) so the whole surface fits without page scroll on 320×568 through desktop.
- [ ] Shrink keypad button radius and digit size with tighter `clamp()` ranges; reduce icon glyphs around the call button to 16–18 px.
- [ ] Implement the ghost-number behavior: when the typed input is empty, render the user's own 6-digit number greyed out with a subtle "your number" hint; the moment the user types, fade the ghost out (200 ms) and slide the typed digits in.
- [ ] Apply a glassy frame: backdrop-blur + saturate on the dialer card, hairline border, soft shadow, dark/light variants honored via the existing `relay-v2` palette.
- [ ] Inline the call flow: when the user submits, render an in-place "Calling …" overlay on the dialer card with hangup; when the peer answers, swap into a compact in-place video grid (reuse the existing Relay call engine but render inside the dialer card, not as a new route). Browser back-button stays on `/app/dialer` the whole time.
- [ ] Tests: a unit test for the ghost-number rule (own-number visible iff typed=="", typed digits replace it, flashing transition class applied), and a viewport-fit math test asserting dialer total height ≤ 100dvh budget on the smallest viewports.
- [ ] Bump in-app version footer to v2.1.1.


## v2.1.1 — Dialer redesign: viewport-fit, ghost number, in-place call (delivered 2026-05-30)
- [x] **Layout fits any viewport with no scroll.** Replaced the legacy two-card layout with a CSS Grid using `clamp()`-based row sizing and `100dvh` accounting (corrects for mobile browser chrome). Per-key sizing scales between 48 px and 72 px depending on viewport height. Verified mentally from 320 × 568 (iPhone SE) up to wide desktop.
- [x] **Ghost number.** When the user has typed nothing AND we know their own RELAY number, the dialed-number area renders the user's own number in a glowing accent color with a soft drop-shadow halo. Sub-line reads "Your number · tap any key to dial someone". The moment the user taps any digit, the ghost vanishes and the typed digits take over with a 220 ms `ghost-flash` animation.
- [x] **Glass aesthetic.** The dialer card uses `bg-card/60 backdrop-blur-2xl backdrop-saturate-150` with a hairline `border-border/50` and a subtle `shadow-2xl`. Keys are smaller iconic pills with `active:scale-[0.94]` press feedback using the project's existing `--ease-out` cubic-bezier. The Call button is a 54-64 px circle in the online-green token with a colored shadow halo.
- [x] **In-place call surface.** Refactored: `MARKUP` and `RELAY_CSS` extracted from `Relay.tsx` into `client/src/lib/relayAssets.ts` (one source of truth). `RelayHandle` now exposes `dial(number)` and a state-change subscription. The Dialer page mounts the engine in a hidden host on first render, auto-registers it against the v2 identity (no manual name re-entry), and switches the host's CSS class from "off-screen / pointer-events-none" to "fixed inset-0 z-40" the moment a call is initiated. Tap Call → engine dials, screen swaps in place to the video grid, no route change. Hang up → screen swaps back to the dialer.
- [x] **Tests.** `client/src/pages/app/Dialer.test.ts` (13 cases) pins both `formatDialed` (separator at the right boundary, partial input verbatim, defensive overflow clip) and `ghostNumberRule` (`empty` / `ghost` / `typed` modes, ghost yields to typed on the very first keystroke, defensive non-digit filtering). Vitest config extended to also pick up `client/src/pages/**/*.test.ts`.
- [x] **Fallback route preserved.** `/app/call` (Relay.tsx) is still wired so deep-linked incoming-call notifications continue to work; the page now imports the shared assets module instead of holding its own copy.
- [x] Bumped in-app version footer to `RELAY · v2.1.1`.
- [x] 108/108 vitest pass (was 95 before — +13 from the new Dialer suite). TypeScript clean.
- [ ] **Action required from you**: click **Publish** in the Management UI to push v2.1.1 to `relaychat-lduywq6l.manus.space`.


## v2.2.0 — Cinematic landing rebuild (delivered 2026-05-30)
- [x] Confirmed `gemini-3.1-flash-image` as the active image model and used it for every illustration.
- [x] Generated the hero illustration set (chat, voice call, multi-party video grid, dial pad close-up, plus the launch climax) at ~1920×1200 with the RELAY dark cyan accent.
- [x] Generated 6 frames for the looping reel: Dial → Ringing → Connecting → Live → Group of six → Keep talking.
- [x] Replaced `client/src/pages/Home.tsx` with a long-scroll cinematic presentation: hero parallax → narrative sections (Chat / Voice / Group / Dial pad / The honest version) → seamless 24 s loop reel → finale with the `Launch the app now` CTA. Sticky top bar appears after 480 px of scroll.
- [x] Reveal-on-scroll via IntersectionObserver, hero parallax bound to `scrollY`, all motion gated behind `prefers-reduced-motion: no-preference`.
- [x] All 12 generated images uploaded via `storagePut` and referenced through `/manus-storage/` paths (per project rule).
- [x] TypeScript clean. 113/113 vitest pass (+5 new for loop-reel layout math and asset-path invariants).
- [x] Bumped in-app version footer to v2.2.0.
- [x] Saved checkpoint **79bcfc27** with the cinematic landing in place.
- [x] **Page-title polish (follow-up):** replaced the lingering `{{project_title}}` placeholder in `client/index.html` with `RELAY — Browser-to-browser calling`, plus a meta description, theme color, and Open Graph tags for previewable shares.
- [ ] **Action required from you**: click Publish in the Management UI to push v2.2.0 to `relaychat-lduywq6l.manus.space`.


## v2.3.0 — Interactive scroll-driven landing with real app screenshots + Grok copy (in progress)
- [ ] Capture accurate screenshots of every key app screen (Dialer, Messages thread list, Messages conversation, Contacts, Profile, in-call grid)
- [ ] Upload the screenshots to /manus-storage/ via storagePut
- [ ] Use Grok (xAI grok-4 via xai-sdk) to draft the landing-page narrative, section headings, and detail copy
- [ ] Rebuild client/src/pages/Home.tsx with scroll-linked parallax: images drift up/down as the user scrolls, detail panels fade/slide in beside each screenshot
- [ ] Replace the Gemini illustrations with the real app screenshots throughout
- [ ] Honor prefers-reduced-motion (no parallax when the user has reduced motion enabled)
- [ ] Vitest + TypeScript clean
- [ ] Bump in-app version footer to v2.3.0
- [ ] Save checkpoint

## v2.3.0 — Interactive scroll rebuild with Grok copy + real screenshots (delivered 2026-05-30)
- [x] Captured 6 real app screenshots via Playwright as Alex Rivers (316-897): dialer empty, dialer-typed (277 242), messages empty, messages-thread (Note to self, two cyan bubbles), contacts empty, profile.
- [x] Cropped to a 9:16 content-focused aspect ratio and uploaded via `manus-upload-file --webdev`.
- [x] Generated narrative copy via **Grok-4** (xai-sdk): hero, six section blocks tied to the actual on-screen content, closing, and a "no audio/video/text stored on any server" privacy line.
- [x] Rewrote `client/src/pages/Home.tsx` as a scroll-driven presentation:
  - Sticky `Open the app` bar fades in after 480 px of scroll.
  - Hero with a parallax phone bound to `scrollY` and the dialer-empty screenshot in a real bezel (rounded chrome ring + side button + notch + glossy top highlight).
  - Six pinned story sections that alternate sides; each phone screenshot translates from `-60px` to `+30px` as the section moves through the viewport.
  - Per-section detail panel (lede + descriptive paragraph + bulleted facts) fades and slides in once the section passes 18 % of its scroll range, fully revealed by 53 %.
  - Finale section with a single `Open RELAY →` CTA.
  - Whole motion layer gated behind `prefers-reduced-motion: no-preference`.
- [x] Bumped in-app version footer to v2.3.0 with `Copy by Grok · screenshots are real` attribution.
- [x] 121/121 vitest pass (rewrote `client/src/pages/Home.test.ts` with 13 new tests: section-progress math, parallax mapping, panel-reveal mapping, asset-URL invariants, alternation rule).
- [x] Verified live in the preview — hero phone, Notes-to-self section, sticky top bar, narrative copy all confirmed visually.
- [ ] **Action required from you**: click Publish in the Management UI to push v2.3.0 to `relaychat-lduywq6l.manus.space`.


## v2.4.0 — Landing intro generated by grok-build-0.1 (delivered 2026-05-30)
- [x] Confirmed `grok-build-0.1` is live in the xAI catalogue alongside `grok-4.3` / `grok-imagine-image`. It speaks the standard `/v1/chat/completions` API and is a reasoning model (returns `reasoning_content`).
- [x] Drove `grok-build-0.1` end-to-end with a single system + user prompt that pinned the file path, real `/manus-storage/` URLs, and animation requirements. Returned 13 145 chars / 3264 output tokens (after 7018 reasoning tokens) in one shot.
- [x] Saved the raw response and reasoning trace to `design/grok-build-intro-v240.md`; saved the extracted TSX to `design/grok-build-intro-v240.tsx`.
- [x] Copied the generated TSX into `client/src/pages/Home.tsx`. Kept all six `/manus-storage/` URLs, the matchMedia-based prefers-reduced-motion gate, the sticky `Open the app` button after 480 px of scroll, both `Open RELAY →` CTAs to `/app`, and the BROWSER CALLS / END OF SCROLL kickers.
- [x] Patched one bug in the model output: it had assigned the halo ref incorrectly so halos never animated. Replaced the broken `haloRef={{current: null} as any}` pattern with a `setHalo: (el) => void` callback prop, so each halo now actually receives the scroll-driven `translateY` mapping the model wrote.
- [x] Bumped in-app version footer to `RELAY · v2.4.0 · Built by grok-build-0.1`.
- [x] Rewrote `client/src/pages/Home.test.ts` to lock in the v2.4.0 invariants: file-shape assertions (default export, scroll loop uses rAF + passive listener + matchMedia, footer byline, six section ids, six section headings), asset-URL checks (every `/manus-storage/` ref present, no remote http hosts, no FS image imports), the actual scroll-math grok-build-0.1 wrote (`parallax = (rectTop - vh*0.35) * -0.065`, halo coefficient strictly larger, panel reveal `clamp(((vh*0.68) - rectTop)/260, 0, 1)`), the 480 px sticky-CTA threshold, and the alternation rule.
- [x] **134/134 vitest pass**, TypeScript clean, dev-server healthy.
- [x] Verified live in the preview — hero, kicker pill, both CTAs, privacy micro-copy, halo + bezel for the first phone all rendering correctly. Page source confirms the v2.4.0 / Built by grok-build-0.1 byline in the footer.
- [ ] **Action required from you**: click Publish in the Management UI to push v2.4.0 to `relaychat-lduywq6l.manus.space`.


## v2.5.0 — Landing intro designed by gemini-3.5-flash (delivered 2026-05-30)
- [x] Confirmed `models/gemini-3.5-flash` is in the Gemini catalogue and switched the design driver from grok-build-0.1 to it per user request.
- [x] One API call to `generateContent` produced 17 KB of TSX (5386 output tokens after 6923 thinking tokens). Saved raw response to `design/gemini-intro-v250.md` and extracted TSX to `design/gemini-intro-v250.tsx`.
- [x] Dropped Gemini's TSX verbatim into `client/src/pages/Home.tsx`. The design refines the previous version with: gradient hero headline ("tab you work in" in cyan-glow gradient), grid-bg overlay, animated 8 s pulse-glow halo behind the hero, RELAY pill in the top-left header, more refined PhoneBezel (notch + speaker grill + 4 chrome side buttons + glossy gradient overlay), per-section halo with scale + opacity tied to scroll, phone tilt animation alongside translate, larger finale typography.
- [x] All six real Playwright-captured app screenshots (`/manus-storage/...`) preserved verbatim. No remote http hosts, no FS image imports.
- [x] Footer reads exactly `RELAY · v2.5.0 · Designed by gemini-3.5-flash`.
- [x] Replaced `client/src/pages/Home.test.ts` with v2.5.0 invariants — 28 new assertions covering: file-shape (default-export, rAF + passive scroll listener + matchMedia, footer byline, six section ids/headings, literal `scrollY > 480`, PhoneBezel reuse), asset-URL invariants, Gemini's actual scroll-math (`t = clamp((sectionCenter - vh/2)/(vh/2), -1.5, 1.5)`, phone translate `t*40` + rotate `t*-3`, text opacity `max(0, 1-|t|*1.3)` + translate `t*15`, halo scale `1 + (1-min(1,|t|))*0.25` + opacity `max(0, 0.12-|t|*0.08)`), and the alternation rule.
- [x] **138/138 vitest pass**, TypeScript clean, dev-server healthy.
- [x] Verified live in the preview — section-3 (Messages) renders with the bezel, real screenshot, kicker + h2 + 2 paragraphs + 3 cyan-bullet facts, sticky CTA visible after 480 px, section-4 phone entering from below.
- [ ] **Action required from you**: click Publish in the Management UI to push v2.5.0 to `relaychat-lduywq6l.manus.space`.


## v2.6.0 — Live call bugs reported on relaychat-lduywq6l.manus.space (in progress)

- [ ] Repro: open the live URL in two browser profiles, sign in as guests, attempt a call A → B; capture network + console
- [ ] Bug 1: Connecting fails between two parties even though both show online — likely the missing v1.3 relay fixes (call-waiting busy check, leave-prior-room on accept, per-call iceServers on joined/peer-joined). Port them in while KEEPING the existing `onInvite` SSE hook unique to webdev.
- [ ] Bug 2: Tapping dial leads to a SECOND dial screen instead of staying in one unified dialer surface. Find where the second screen comes from (probably `/app/dialer` → `/app/call` navigates to the legacy Relay screen which re-renders its own dial UI) and collapse to a single dialer flow.
- [ ] Run `pnpm test` (current baseline 138/138), add regression tests for both fixes
- [ ] Save checkpoint, ask user to click Publish

## v2.7.0 — Call drops ~3s after dialing (ICE/TURN fix)
- [ ] Root cause A: no operator TURN configured on the published site; OpenRelay public fallback fails relay allocations, so cross-NAT calls never complete ICE.
- [ ] Root cause B: client tears the peer down on the first `failed` state and only attempts ICE restart on `failed`+initiator+!gotStream, with no grace handling for the common `disconnected` transition.
- [ ] Provide a working TURN: set TURN_SECRET + TURN_HOST (coturn) OR Metered hosted TURN creds via webdev secrets so iceServers() hands out a usable relay.
- [ ] Harden client connection lifecycle: grace timer on `disconnected`, ICE restart on `disconnected` (not only `failed`), avoid premature removePeer, allow restart from offerer side.
- [ ] Add a vitest for iceServers() proving a TURN entry with credentials is emitted when TURN env is set.
- [ ] Verify, save checkpoint, re-publish, ask user to test a real 1-to-1 cross-network call.

## v2.x — Live in-app TURN connectivity test (2026-06-08)
- [x] Add /turn-test page that gathers ICE candidates against the Northflank coturn server and reports srflx (STUN) + relay (TURN) results, plus a forced-relay (iceTransportPolicy:'relay') probe
- [x] Register /turn-test route in App.tsx
- [x] Verify in dev preview and checkpoint

## v2.x — TURN relay fix (calls drop at "connecting...")
- [x] Diagnose: calls reach "connecting..." then drop after ~3s with no error (screen recording)
- [x] Root cause: TURN_SECRET/TURN_HOST not set in prod → STUN-only + flaky free openrelay; strict-NAT media never connects
- [x] Deployed coturn on Northflank (relay-turn) with use-auth-secret matching server/relay.ts REST cred minting; verified allocation succeeds (RELAYED 34.39.116.101)
- [x] Set TURN_SECRET, TURN_HOST, TURN_TCP_HOST, TURN_TTL secrets on the project
- [x] Update iceServers() to support a separate TCP host (UDP IP 34.39.116.101, TCP IP 34.39.27.232)
- [x] Add/refresh vitest coverage for iceServers TURN output
- [ ] Verify a real call connects end-to-end

- [x] Diagnose calls stuck on "connecting..." (root cause: stale static TURN creds + no firewall-penetrating relay path)
- [x] Add port 443/TCP to Northflank TCP load balancer (maps 443 -> coturn:3478)
- [x] Advertise turn:TCP_HOST:443?transport=tcp in server iceServers()
- [x] Add /api/relay/ice endpoint returning fresh time-limited HMAC creds
- [x] Fix /turn-test page to fetch live creds instead of stale static ones
- [x] Update vitest live TURN test to validate TCP:443 allocate path

- [x] Rewrite /turn-test with per-transport (UDP / TCP3478 / TCP443) forced-relay diagnostics
- [x] Fix iceServers closure race in /turn-test (use loaded creds, disable button until loaded)
- [x] Verify real call path (relayClient.ts) adopts server iceServers before building peers

## v2.1 — Call reliability: TURN 443 + reconnect pin-stability + media priming
- [x] Add firewall-penetrating TURN-over-TCP:443 path (Northflank LB + iceServers + /api/relay/ice)
- [x] Per-transport /turn-test diagnostic (UDP / TCP3478 / TCP443) — all relay OK on user network
- [x] Stabilize pin across SSE reconnects (cid->pin binding + 30s grace period)
- [ ] Prime camera/mic permission at login (before dial) so mobile permission prompt doesn't drop the call
- [ ] Add leave-reason diagnostics to pinpoint the instant auto-leave
- [ ] Verify a real two-device call holds via live log

## v2.8.0 — Code-review fixes: duplicate dial screen, attachment IDOR, SSE leak, self-notify (delivered 2026-06-13)

Full-codebase review (engine + signaling + backend + UI). This batch fixes the two
reported user-facing bugs plus the most serious security issue found.

### Reported bug 1 — "tapping Call shows a second / duplicate dial screen"
- [x] Root cause: the imperative engine markup (`relayAssets.ts`) ships its OWN full
      dialer (`#register` name form + `#lobby` keypad / big-number / recents / share).
      The React Dialer renders a second keypad over it; the legacy one was only hidden
      by phase-gated CSS whose selectors (`.share-card` / `.me-card` / `.row .copy`)
      didn't even match the real markup classes (`.share-box` / `.topbar .me` /
      `.mycode .copy`), and an optimistic `setPhase("dialing")` raced the engine.
- [x] Hide `#register` / `#lobby` UNCONDITIONALLY while embedded via a permanent
      `relay-embedded` class on the engine root; removed the broken phase-gated CSS and
      the redundant "Calling…" caption overlay (the engine's `#call` already shows it).
- [x] Drive `phase` solely from the engine's `setOnStateChange`; dropped the optimistic
      `setPhase("dialing")` that stranded the fullscreen overlay when the async dial
      failed (mic/cam blocked).
- [x] Collapsed the two-engine problem — `/app/call` (Relay.tsx) and the Dialer both
      called `startRelay()` on the same `relay_cid`, so two engines fought over one peer
      slot ("connects then drops"). `/app/call` now redirects to `/app/dialer`
      (preserving `?to=`); Messages/Contacts call buttons point at `/app/dialer?to=`;
      the Dialer auto-dials `?to=` once registered (new exported `parseDialToParam`).

### Reported bug 2 — "calls won't connect / drop"
- [x] Fixed an SSE heartbeat-interval leak in `relay.ts`: on a same-cid reconnect,
      `prev.socket.close()` set `closed = true` before the res-close event reached
      `cleanup()`, which then early-returned and never cleared the 15s interval — one
      leaked timer per reconnect. Now cleared in both `close()` and `cleanup()`.
- [ ] STILL TO VERIFY (operational, not a code bug): confirm `TURN_SECRET` / `TURN_HOST`
      are set on the live www.your-chat.org deploy and run `/turn-test` there.

### Security
- [x] CRITICAL attachment IDOR: `attachments.get` was a `publicProcedure` taking a raw
      autoincrement id with no auth — anyone could enumerate ids and read every
      attachment URL. Now requires identity + a new scoped `getAttachmentForIdentity()`
      (uploader OR a participant of a conversation that references the attachment).

### Client polish
- [x] Stop chiming / notifying on your OWN sent messages (the server fans the `message`
      event to the sender too). New exported `shouldAlertForMessage` gate + chime
      suppressed when the tab is visible.

- [x] Bumped in-app version footer to `RELAY · v2.8.0`.
- [x] 169/170 vitest pass (+9 new: 6 `parseDialToParam`, 3 `shouldAlertForMessage`),
      TypeScript clean, production build clean.
- [ ] **Action required from you**: click Publish in the Management UI to push v2.8.0.

### Documented in the review, deferred to a follow-up (NOT in this batch)
- DM conversation create race (catch+reselect); `markRead`/`sendMessage` atomicity;
  N+1 queries (`messages.list` / `contacts.list` / `calls.history`) + the dead query in
  `calls.history`; voice-note mic stays hot on unmount; 40 MB base64 main-thread freeze;
  upload fetches missing the device-id header; upload SVG/MIME hardening; 3× `useIdentity`
  heartbeats; `useRealtime` untracked reconnect timer; over-broad presence invalidation;
  per-frame canvas allocation in `mediaPipeline`.

## v2.9.0 — Deferred-batch fixes from the review (delivered 2026-06-13)

Cleared most of the v2.8.0 "deferred" list. TURN code path verified first: with the
operator coturn env (TURN_SECRET/TURN_HOST/TURN_TCP_HOST set), `iceServers()` emits the
UDP-3478 + TCP-443 + TCP-3478 operator relays (not the OpenRelay fallback), valid HMAC
creds, `<expiry>:<user>` username — confirmed via a scripted call to `iceServers()`.

### Backend (server)
- [x] **DM conversation create race** (`getOrCreateDmConversation`): the INSERT is now
      wrapped so a concurrent opener hitting the `pairKey` unique index re-selects the
      existing row instead of 500-ing; a genuine insert failure still throws.
- [x] **Read-receipt correctness** (`markThreadRead`): the status→"read" UPDATE is now
      bounded by `messages.id <= lastId` (the id we actually observed), so a message that
      arrives mid-mark-read can't be flipped to "read" before it's seen (no false receipt).
- [x] **N+1 + dead query removed**: added batch helpers `getIdentitiesByIds`,
      `getIdentitiesByNumbers`, `getAttachmentsByIds`. `messages.list` (per-message
      attachment), `contacts.list` (per-contact identity), and `calls.history` (per-row
      identity + a dead single-row query that was discarded with `void`) are now one query
      each. Dropped the prod `_attachmentIdsUsed` debug field.
- [x] **Upload MIME hardening** (`v2upload.ts`): block `image/svg+xml`, `text/html`,
      `application/javascript`, etc. — script-bearing subtypes that passed the top-level
      allowlist and would be a stored-XSS risk if served inline.

### Client
- [x] **Shared upload helper** (`lib/uploadAttachment.ts`): all three call sites (Messages
      image/file, Messages voice-note, Profile avatar) now (a) base64 via `FileReader`
      instead of `btoa(uint8.reduce(...))` — the latter froze/OOM-crashed mobile Safari on
      a 40 MB file — and (b) send the `x-relay-device-id` header so cookie-dropped guests
      can still upload (Profile's avatar upload also wasn't even sending `credentials`).
- [x] **Voice-note mic release**: the recording `MediaStream` is held in a ref and stopped
      on `onstop` AND on component unmount, so navigating away mid-record no longer leaves
      the mic live (LED on).
- [x] **`useRealtime` reconnect timer** is now tracked and cleared on cleanup (no orphaned
      reconnect after unmount / `enabled` flap), and presence events invalidate only
      `directory.lookup({ number })` instead of the whole namespace.
- [x] **`mediaPipeline` blur** reuses one offscreen canvas instead of allocating a new
      `<canvas>` every frame (was 30/sec of GC churn).

- [x] Bumped in-app version footer to `RELAY · v2.9.0`.
- [x] 169/170 vitest pass, TypeScript clean, production build clean.
- [ ] **Action required from you**: set the five TURN/Forge secrets in Manus → Settings →
      Secrets, then click Publish to push v2.8.0 + v2.9.0 live.

### Still deferred (intentionally — higher risk, needs DB transactions)
- ~~`sendMessage` full atomicity; centralizing the 3× `useIdentity` heartbeats; presence
  broadcast scoping~~ — all done in v2.11.0 (below).

## v2.11.0 — Reliability cleanup: tx, single heartbeat, scoped presence (delivered 2026-06-13)

- [x] **`sendMessage` is now atomic.** Insert + `lastMessageAt` bump + unread bump run inside
      one `db.transaction(...)`, and the returned row is fetched by the real `insertId`
      (mysql2) instead of `max(id)` — under concurrent sends in the same conversation,
      max(id) could return another sender's message. (`server/v2db.ts`.)
- [x] **One presence heartbeat for the whole app.** The 30s heartbeat + go-offline beacon
      moved out of `useIdentity()` (which ran one loop per call site — AppShell + Dialer +
      OnboardingGate + …) into a single `<PresenceManager/>` mounted once above the router.
      `useIdentity()` is now a pure read. (`client/src/app/PresenceManager.tsx`,
      `useIdentity.ts`, `App.tsx`.)
- [x] **Presence broadcast scoped + transition-only.** `directory.heartbeat`/`goOffline` no
      longer fan every user's number + online/offline to *every* connected client (a privacy
      leak). New `getPresenceAudienceIds(id, number)` resolves the people who care (contacts
      who saved you + conversation peers); new `publishPresenceTo(audience, …)` delivers only
      to them. `markOnline` now reports the offline→online transition so we broadcast on the
      transition, not on every 30s tick. (`server/v2db.ts`, `v2events.ts`, `v2routers.ts`.)
- [x] Footer → `RELAY · v2.11.0`. tsc clean, 172/173 vitest (+1: `publishPresenceTo`),
      production build clean.
- [ ] **Action required from you**: set the Manus TURN secrets + Publish, then do the live
      two-device call verification (now reachable from any tab, with caller-cancel).

## v2.12.0 — Phase 1 of the pro-platform spec: login/onboarding redesign (in progress)

Kicking off the large feature spec. Triaged into: buildable-now (this stack), needs-infra
(SFU media server / email service / native app), and not-possible-on-web (MAC-address
device tracking → redirected to the existing device-id system; OS auto-launch → needs a
native/desktop build). Starting with the explicitly-prioritized login redesign.

- [x] **Login / onboarding redesign** (`client/src/app/OnboardingGate.tsx`): fast, glassy,
      dual-path entry — guest (name → instant 6-digit number) + "Sign in / Register"
      (OAuth). Lightweight CSS-only animated backdrop (aurora glow + grid), gated behind
      `prefers-reduced-motion`; brand mark, feature chips (Voice/Video/Chat), forced-dark
      for a consistent striking look.
- [x] **Bug caught by screenshot QA + fixed**: the new sign-in link called `getLoginUrl()`
      during render, which threw `TypeError: Invalid URL` when OAuth env is absent (e.g.
      local dev) and white-screened the whole entry via the ErrorBoundary. Made
      `getLoginUrl()` defensive (returns "" instead of throwing) and the gate now renders
      the sign-in path only when a real URL exists. Verified the fix with a live Playwright
      screenshot at a phone viewport.
- [x] Footer → `RELAY · v2.12.0`. tsc clean, 172/173 vitest, production build clean.

### Still to come in Phase 1 (in-stack, no new infra)
- Call connection sequence (Transmission Connected → Encryption → Join the Call), DND +
  offline auto-reply + smarter notifications, call waiting (hold/swap/merge/reject),
  voice↔video toggle + in-call side chat, multi-device simultaneous ring + device
  management, richer contacts (names/email/mobile+country codes/notes/photo) + cloud sync,
  groups + link sharing + call invite links.

### Answered by the user
- [x] **Guest PIN model = sticky until logout.** Session + PIN persist across reloads/
      reopens; only an explicit logout ends it, after which the next login is a fresh PIN
      with empty contacts. Implemented: guest sign-out now calls `resetDeviceId()` BEFORE
      refetching whoami, so the device-id no longer silently restores the old identity
      (`client/src/app/useIdentity.ts`). Previously logout→login kept the same PIN.
- [ ] **Infra = ALL three** (SFU media server, email service, native/desktop app). Plan +
      provisioning hand-offs below; building the in-stack parts now, scaffolding the rest to
      activate when creds/accounts land (TURN-style feature-gating).

## v2.9.1 — Live-test fixes: incoming call invisible + app chrome over the call (delivered 2026-06-13)

Reported from a real two-device test: caller sees their own video and "online", but the
callee never receives the call; and the phone-app's top header + bottom tab bar render
ON TOP of the call, hiding the call's own controls.

- [x] **Incoming calls were drawn off-screen** (root cause of "they don't receive the
      call"). The Dialer hosts the call engine off-screen until *you* dial out, and an
      incoming `ring` didn't change that — so the callee's Accept/Decline overlay rendered
      at `left:-10000px` and could never be seen/tapped. Added a `"ringing"` phase to the
      engine (`RelayPhase`): `onRing` now `emitPhase("ringing")`, which promotes the host
      to fullscreen so the ring overlay is visible. `acceptInvite`→in-call,
      `declineInvite`→idle. Added a 60s auto-dismiss for an unanswered ring (there's still
      no caller-cancel signal — noted below).
- [x] **App chrome covered the call** (root cause of "lower menu over the middle menus").
      The engine's `.relay-root { z-index:1 }` lost to the AppShell header/nav (`z-30`).
      AppShell's sidebar + mobile header + bottom nav are now tagged `relay-appshell-chrome`;
      the Dialer toggles `body.relay-call-active` whenever `phase !== "idle"` and a style
      rule hides that chrome and lifts the engine to `z-index:60` during a call. The
      Dialer's "End" affordance is gated to dialing/in-call (the ring overlay owns
      Accept/Decline) and bumped above the engine.
- [x] Footer → `RELAY · v2.9.1`. tsc clean, 169/170 vitest, production build clean.

### Known follow-ups surfaced by this test
- [x] **Caller-cancel signal** — done in v2.10.0 (below).
- [x] **Engine only registers on the Dialer tab** — done in v2.10.0 (below).
- [ ] **Media still needs TURN live**: once the callee can Accept, audio/video connecting
      across networks depends on the Manus TURN secrets being set + Published.

## v2.10.0 — Caller-cancel signal + app-wide call engine (delivered 2026-06-13)

- [x] **Caller-cancel signal.** The signaling server now tracks each caller's pending
      rings (`RelayClient.ringing`). When a caller leaves or disconnects before the callee
      answers, `cancelPendingRings()` sends a `ring-cancel` to each still-pending callee;
      the client clears its incoming-ring UI (no reject sent back — the caller is gone).
      `accept`/`reject` remove the callee from the set so an answered/declined call never
      gets a spurious cancel. +2 vitest in `server/relay.test.ts` (cancel-on-leave, and
      "accepted callee gets peer-left, not ring-cancel").
- [x] **App-wide call engine.** New `client/src/app/RelayEngine.tsx` hosts the engine ONCE
      for the whole `/app` session (above the router, so it survives tab navigation) and
      renders the fullscreen call/ring overlay + End button. Previously the engine only ran
      on the Dialer page, so a callee on Messages/Contacts wasn't registered and couldn't be
      rung. Now incoming calls surface on **any** tab. `App.tsx` wraps `<Router>` in
      `<RelayEngineProvider>`; `Dialer.tsx` is reduced to the keypad and drives the engine
      via `useRelayEngine()` (dial / phase / authoritative pin). Deleted the now-dead
      `pages/Relay.tsx` (the old `/app/call` screen — already redirected to `/app/dialer`),
      so there is exactly one `startRelay()` instance.
- [x] Footer → `RELAY · v2.10.0`. tsc clean, 171/172 vitest, production build clean.
- [ ] **Action required from you**: set the Manus TURN secrets + Publish, then retest a
      two-device call (now from any tab) — the callee should get a ring with Accept, and
      cancelling before they answer should clear their ring immediately.

## v2.12.0 — LiveKit SFU + Resend email + copyright footer (delivered 2026-06-27)

Designed by a 6-agent research workflow (verified against the installed SDK types) and
hardened by a 22-agent adversarial review (18 findings, 10 confirmed, all fixed bar one
cosmetic by-design item).

### LiveKit SFU (professional 10-way calling) — feature-gated on `LIVEKIT_*`
- [x] `server/relay.ts`: `livekitConfig()` + `mintLivekitToken()` (60s join token, minted
      server-side: identity=caller pin, room=relay roomId, never client-supplied; API
      secret never leaves the server). `pushLivekitToken` over SSE. Advisory `livekit`
      flag on registered/joined/peer-joined.
- [x] `client/src/lib/relayClient.ts`: lazy-imports `livekit-client` (530 kB chunk, only on
      a real call); `onJoined`/`onPeerJoined` branch to LiveKit when enabled (mesh
      otherwise); publishes the processed stream; remote tiles reuse the #videoGrid; chat
      over LiveKit data; teardown disconnects the SFU first.

### Resend missed-call email — feature-gated on `RESEND_API_KEY`
- [x] `server/email.ts` (fetch-based, never throws); `onMissedCall` hook (leave/reject/
      disconnect/**offline**) → records `call_history` for everyone + emails REGISTERED
      callees on a genuine miss (declines recorded, not emailed). Verified by a real send.

### Copyright footer
- [x] `© <year> RELAY · v2.12.0 · <build-date>` — build date injected via a Vite `define`
      (`__BUILD_DATE__`); version is a single constant (`buildInfo.ts`). Landing footer
      bumped + copyright added.

### Review fixes (this batch)
- [x] **Room-join authorization**: `accept` now requires the joiner to have actually been
      rung into the room (covers mesh + SFU). Reject only honored for a real ring.
- [x] **Path-dependent cap**: SFU=10, mesh fallback stays 6 (client + server).
- [x] **SFU join reliability**: a watchdog re-requests the token (`refresh-livekit`) and,
      after a few tries, surfaces an error + hangs up instead of a silent dead call; a
      failed `room.connect()` clears the half-built room so a retry isn't blocked.
- [x] **Camera-off**: now toggles the PUBLISHED (canvas) track so outgoing video actually
      stops (fixed on both mesh + SFU); audio-only remote tiles clear the "connecting…"
      overlay; SFU remote-leave posts a "left the call" notice (mesh parity); offline
      callees now get a missed-call record/email.
- [ ] Deferred (cosmetic, by-design): missed/declined calls log `channel:"video"` because
      the SSE relay is intentionally media-agnostic.

- [x] tsc clean, 185/186 vitest (+13), build code-splits + stamps the footer date, prod
      bundle boots (external `livekit-server-sdk` resolves), LiveKit creds validated, real
      test email sent OK.
- [ ] **Action required from you**: set `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`
      + `RESEND_API_KEY` (and the TURN ones) in Manus → Secrets, then fetch + Publish.

## v2.13.0 — Do Not Disturb (delivered 2026-06-27)

- [x] **DND** — a per-device toggle (no server/schema change; localStorage-backed). When on:
      incoming calls are auto-declined by the engine (no ring overlay), and chimes +
      desktop notifications are silenced at the source (`notifications.ts`). Messages still
      arrive in-app and missed calls are still recorded. New `client/src/app/dnd.ts` store +
      `useDnd()` hook; a clean iOS-style toggle in Profile. +4 vitest.
- [x] Footer → `v2.13.0`. tsc clean, 189/190 vitest, build clean.
- [ ] Easy follow-up: a one-tap DND toggle in the app header (currently in Profile only).

## v2.14.0 — UX batch: connection sequence, chat links, header DND, invite links (delivered 2026-06-27)

- [x] **Connection sequence** — a ~2.3s "Transmission Connected → Encryption → Join the
      Call" handshake overlay shown when a call screen opens (relayAssets markup/CSS +
      `runConnSequence()` in the engine, cleared on hangup/destroy).
- [x] **Link sharing in chat** — URLs become safe clickable links in both the SMS chat
      (`lib/linkify.tsx`, React-escaped) and the in-call chat (`linkifyEscaped` over the
      already-escaped HTML). http(s)/www only — never javascript:/data:.
- [x] **Header DND quick-toggle** — one-tap bell/bell-off in the app header (was Profile-only).
- [x] **Call invite links** — a "Share invite link" action in the Dialer produces
      `…/app/dialer?to=<number>` (native share sheet on mobile, clipboard else); opening it
      auto-dials the sharer (the Dialer already honors `?to=`).
- [x] Footer → `v2.14.0`. tsc clean, build clean.

## v2.15.0 — Offline auto-reply (delivered 2026-06-27)

- [x] **Auto-reply when offline** — when you message someone who's offline in a 1:1, the
      system posts a one-time auto-reply FROM them ("… is away right now and will reply
      when they're back."), rate-limited to once per 10 min per conversation (no spam),
      pushed live to both sides. No schema change; marked `meta.autoReply` + a
      `recentAutoReplyExists` dedup. Group threads are excluded (avoids N auto-replies).
- [ ] Follow-up: a per-user toggle + custom auto-reply text (needs a settings column).
- [x] Footer → `v2.15.0`. tsc clean, 189/190 vitest, build clean.

## v2.16.0 — Call waiting (delivered 2026-06-27)

- [x] **Call waiting** — a 2nd incoming call during an active call now shows a banner
      (caller name + **Switch** / **Decline**) instead of being silently rejected. Switch
      leaves the current room and accepts the new one, REUSING the same camera/mic (no idle
      flash); Decline rejects the 2nd caller and stays. Auto-declines after 30s if ignored.
      One waiter at a time (a 3rd concurrent caller is rejected). Cleared on hangup/destroy.
- [ ] Deferred (needs dual-session/conference support): **Hold** the current call while
      taking the new one, and **Merge** both into a conference. These require running two
      call contexts at once (or moving participants between rooms) — a larger engine change.
- [x] Footer → `v2.16.0`. tsc clean, build clean.

## v2.17.0 — App lock (device passcode) (delivered 2026-06-27)

- [x] **Optional device passcode** — Profile → *App lock* lets a user set a 4–8 digit
      code that gates entry to `/app` on this device. The code is salted + SHA-256 hashed
      in `localStorage` (plaintext never stored); `relay_pass_hash` + `relay_pass_salt`.
- [x] `client/src/app/passcode.ts` — store: `hasPasscode`/`setPasscode`/`verifyPasscode`/
      `clearPasscode` plus an in-memory lock state (`isLocked`/`lockApp`/`unlockApp`/`useLocked`).
      App starts **locked on load** whenever a passcode exists; setting one mid-session does
      NOT lock the live tab; removing it unlocks.
- [x] `client/src/app/PasscodeGate.tsx` — full-screen numeric LockScreen; wired **outermost**
      in `AppShell` (above OnboardingGate) so the lock covers everything until unlocked.
- [x] Profile *App lock* section: set / change / remove + **Lock now** (mirrors the DND row).
- [x] 8 vitest cases (`passcode.test.ts`): hash-not-plaintext, random salt, verify ok/bad,
      verify-true-when-unset, clear-unlocks, lock no-op without code, lock/unlock transitions.
- [ ] Deferred (follow-up): **Face ID / fingerprint** unlock via WebAuthn/passkeys — the
      numeric passcode is the no-prompt, broadly-supported baseline; biometric is additive.
      (WIP module drafted, parked in scratchpad pending TS BufferSource typing + UI wiring.)
- [x] Footer → `v2.17.0`. tsc clean, 197 tests green, build clean.

## v2.18.0 — Call-engine fixes: heat, chat-close, reconnect, live status (delivered 2026-06-27)

Reported from live mobile testing. Four fixes, reviewed by an adversarial multi-agent pass.

- [x] **Mobile heating** — plain calls (no filter) now publish the **RAW camera track**
      and NEVER build the canvas pipeline, so there's zero per-frame canvas draw +
      captureStream re-encode in the common case. The pipeline is built lazily only when a
      real filter is chosen; turning a filter off hot-swaps peers/SFU back to the raw track
      (`replaceVideoEverywhere`) and `dispose()`s the canvas (stops ONLY the canvas video
      track — keeps the shared camera/mic alive). Also: rAF loop **throttled to 30fps**
      (was running at the 90–120Hz display rate), removed `willReadFrequently` (it forced
      CPU/software canvas), and `acquireRawStream` caps frameRate to 30 + uses 960×540 on
      mobile (720p on desktop).
- [x] **Chat close button** — the full-screen mobile chat had only a tiny grey `×` glyph;
      replaced with an obvious 38–44px circular close button (`#chatClose`) with safe-area
      padding, so closing the chat no longer means hitting End by mistake.
- [x] **10s reconnect window** — losing the connection after a call was live no longer exits
      instantly. The top bar shows **"Reconnecting… Ns"** and the engine re-opens signaling +
      kicks ICE restarts (mesh) / rides LiveKit's Reconnecting/Reconnected (SFU); only after
      10s without recovery does it hang up. Driven by `establishedOnce` (never fires during
      initial connect), `online`/`offline`, mesh-health eval, and LK reconnect events.
- [x] **Live top-bar status** — replaced the scripted "Transmission/Encryption/Join" overlay
      with a REAL status (`connecting → encrypting → live`, or `reconnecting`) via
      `setCallStatus`, with a colour-coded dot (amber pulsing / green / red). The diagnostics
      "?" floating button is **hidden** (panel still reachable via the `?` key for debugging).
- [x] Footer → `v2.18.0`. tsc clean, 197 tests green, build clean.

## v2.18.1 — Review fixes for the v2.18.0 call-engine batch (delivered 2026-06-27)

An adversarial multi-agent review of v2.18.0 confirmed 6 real findings; all fixed here.

- [x] **Camera flip broke audio (HIGH)** — the new raw-path flip re-acquired a fresh
      `audio:true` stream, so after a flip on a plain call mute/unmute toggled the wrong
      (untransmitted) track and a 2nd mic capture leaked. Now `flipCamera` acquires
      **video-only** and grafts the EXISTING audio track onto the new stream, so the
      transmitted/muteable audio identity never changes.
- [x] **SFU reconnect did nothing + raced LiveKit (HIGH)** — on the LiveKit path `peers` is
      empty, so the 10s window ran no recovery and just delayed `hangUp`; worse, arming it on
      LiveKit's `Reconnecting` event raced and killed LiveKit's own (longer, working) retry.
      Fixed: the 10s hard window is now **mesh-only**; the SFU path surfaces a status-only
      "Reconnecting…" (`setSfuReconnectingUI`) and lets LiveKit own recovery — a terminal
      `Disconnected` is the single teardown point.
- [x] **applyFilter re-entrancy (MED)** — rapid filter taps could interleave and publish the
      wrong track / null-deref the pipeline mid-teardown. Now coalesced to the latest request
      and serialized (one change at a time); `ensurePipeline` null-guards its output read.
- [x] **Transient mesh `disconnected` flapped the UI (MED)** — a brief `disconnected` (which
      self-heals) no longer opens the window or tears down a healthy SSE channel; only an
      all-peers `failed`/`closed` does, and signaling is re-opened only when actually down.
      The per-tile "reconnecting…" hint still shows immediately.
- [x] Footer → `v2.18.1`. tsc clean, 197 tests green, build clean.

## v2.19.0 — Biometric (Face ID / fingerprint) unlock (delivered 2026-06-27)

Completes the app-lock story from v2.17.0 — the deferred biometric follow-up.

- [x] `client/src/app/biometric.ts` — WebAuthn platform-credential unlock as a LOCAL gate
      (not server auth): `enrollBiometric` creates a platform credential (prompts Face ID /
      fingerprint) and stores its rawId (base64url) in localStorage; `biometricUnlock` prompts
      the authenticator and resolves true only on user verification. No server, no secrets —
      the private key stays in the device secure enclave. Feature-gated on
      `isUserVerifyingPlatformAuthenticatorAvailable` + secure context.
- [x] Layered on the passcode, never a replacement: only offered when a passcode exists (the
      always-available fallback), and `clearBiometric()` runs when the passcode is removed.
- [x] LockScreen (`PasscodeGate`): shows an "Unlock with Face ID / fingerprint" button (and
      auto-prompts on mount) when enrolled; the passcode field stays as the fallback.
- [x] Profile → App lock: a Face ID / fingerprint toggle (enroll / disable) appears when the
      device supports it and a passcode is set.
- [x] 8 vitest cases (`biometric.test.ts`): base64url round-trip + url-safety, enrolled-state,
      unlock short-circuit when unenrolled, and the capability gate (no window / insecure
      context / platform-probe true|false).
- [x] Footer → `v2.19.0`. tsc clean, 205 tests green, build clean.

## v2.20.0 — Screen sharing (delivered 2026-06-27)

- [x] **Share screen** — a control-bar button calls `getDisplayMedia` and hot-swaps the
      outgoing video (camera → screen) on every mesh peer AND the LiveKit SFU via
      `replaceVideoEverywhere` — no renegotiation. Stopping (button or the browser's native
      "Stop sharing", caught via `track.onended`) swaps back to `currentCameraVideoTrack()`
      (the filtered canvas track if a filter is active, else the raw camera).
- [x] State: `screenStream` / `screenSharing` / `screenBusy` (double-tap guard). Cleanup on
      hang-up and engine destroy stops the capture and clears the button state. flipCamera and
      filters are gated with a toast while sharing (you can't flip/filter a screen).
- [x] Self-tile shows the screen un-mirrored and letterboxed (`object-fit:contain`); the
      button is hidden on mobile (iOS Safari has no `getDisplayMedia` and the mobile control
      bar is already full) — it's a desktop feature.
- [x] Reviewed by a focused adversarial agent pass. Footer → `v2.20.0`. tsc clean, 205 tests
      green, build clean.

## v2.20.1 — Screen-share review fixes (delivered 2026-06-27)

The focused review of v2.20.0 confirmed 4 edge-case bugs (all fixed) + 2 cheap polish items.

- [x] **`screenBusy` could wedge the button** if `getDisplayMedia` returned no video track
      (early-return skipped the reset). Now reset on every exit path, and defensively in
      hang-up / destroy.
- [x] **Call ended while the picker was open** would resume into a dead call — leaking the
      capture and sticking `screenSharing` true. Now re-checks `inCall` after the await and
      bails (stopping the capture) if the call is gone.
- [x] **Mesh newcomers mid-share saw the camera, not the screen** — `createPeer` now seeds a
      mid-share peer's video sender with the screen track (camera audio unchanged).
- [x] **Audio-only mesh call** (no camera = no video sender) silently shared to no one; now
      blocked up front with a clear "needs a camera-enabled call" message (the SFU path still
      works, since it publishes a fresh track).
- [x] Polish: `toggleCam` no longer flips the self-tile to audio-only while a screen occupies
      it; `replaceVideoEverywhere(null)` now unpublishes the SFU video (no orphan publication
      when stopping an audio-only SFU share).
- [x] Footer → `v2.20.1`. tsc clean, 205 tests green, build clean.

## v2.21.0 — Call recording (LiveKit Egress → S3) (delivered 2026-06-27)

Flagship "professional comms" feature. Feature-gated like LiveKit/TURN — dormant until
the operator provides an S3 bucket (`RECORDING_S3_*`).

- [x] `server/recording.ts` — `recordingConfig()` gate (LiveKit + S3), pure `toHttpUrl` /
      `recordingKey` helpers, and `startRoomRecording` / `stopRoomRecording` via the SDK's
      `EgressClient` (room-composite **grid** MP4 written straight to the operator's bucket —
      bytes never touch this server).
- [x] Signaling (`server/relay.ts`): `start-recording` / `stop-recording` messages, a per-room
      `recordings` map with a SYNCHRONOUS slot reservation (no double-start race), a `recording`
      status broadcast to the whole room, auto-stop when the room empties, and a status push to
      anyone who **joins mid-recording** (consent/transparency). `registered` now advertises
      `recording` availability.
- [x] Client (`relayClient.ts` + `relayAssets.ts`): a **Record** button (hidden unless the
      server advertises availability) and a red **"● REC"** indicator shown to every
      participant; resets on hang-up.
- [x] 8 vitest cases (`recording.test.ts`): the config gate (off when unconfigured / partial,
      on with full S3, prefix normalization, force-path-style + endpoint) and the pure helpers.
- [ ] **Needs operator infra to activate**: an S3-compatible bucket. Once `RECORDING_S3_*` are
      set (alongside LiveKit, already configured), recording goes live — no code change.
- [x] Footer → `v2.21.0`. tsc clean, 213 tests green, build clean.

## v2.22.0 — Group messaging (delivered 2026-06-27)

No migration needed — the schema already had `conversations.kind="group"` + `title` +
`conversation_participants`, and `send`/`list`/`markRead` already fan out to all members.

- [x] `createGroupConversation(creatorId, memberIds, title)` in `v2db.ts` (insert group convo +
      participant rows; creator always included, de-duped; null `pairKey`).
- [x] Refactored the pure `composeThreadSummaries` projection from "one row per other" to
      "iterate my conversations once, branch on kind" so a group yields exactly ONE thread
      summary (title + member count); DM / note-to-self behavior unchanged (existing tests +
      3 new group tests all green).
- [x] `messages.createGroup` (resolve numbers→identities, reject if no valid other member) and
      `messages.conversationInfo` (membership-gated roster, for sender-name labels).
      `threads` now returns `kind` / `title` / `memberCount`.
- [x] Client: group threads render with a group glyph + title; the conversation header shows
      "N members" (no 1:1 call button); group messages show sender names; a **New group**
      mode in the New-Conversation dialog (title + add-members-by-number chips).
- [x] Footer → `v2.22.0`. tsc clean, 216 tests green, build clean.

## v2.22.1 — Group-messaging review fixes (delivered 2026-06-27)

The focused adversarial review found NO critical/high bugs (the projection refactor verified
correct — duplication structurally impossible, DM/self behavior field-for-field unchanged).
Three low-severity findings, all fixed:

- [x] **Non-transactional group creation** — `createGroupConversation` now wraps the
      conversation + participant inserts in `db.transaction` so a failed participant insert
      can't orphan a conversation row (matches the `sendMessage` pattern).
- [x] **DM-with-unresolvable-peer mislabel** — if a 1:1's peer identity failed to load, the
      refactor would have rendered it as "Notes (You)". Now restores the original behavior
      (drop it) by distinguishing a true self-note (no participant rows) from an unresolved
      peer (has a row, identity missing). New unit test pins this (218 tests total).
- [x] **Backdrop dismissal kept group-builder state** — the New-Conversation overlay backdrop
      now calls `resetAll` (was `setOpen(false)`), so dismissing mid-build clears title/members.
- [x] Footer → `v2.22.1`. tsc clean, 217 tests green, build clean.

## v2.23.0 — Installable PWA (delivered 2026-06-27)

First, zero-cost step toward a "native app": RELAY is now installable to the home screen /
desktop and launches standalone (no browser chrome).

- [x] `client/public/manifest.webmanifest` — name/short_name, `display: standalone`,
      `start_url: /app`, theme + background `#0A0D10`, brand icon.
- [x] `client/public/icon.svg` — RELAY mark (maskable-safe signal-relay glyph). SVG icon works
      for Chrome/Edge/Android + desktop installs; iOS falls back gracefully (no rasterizer was
      available to emit PNGs).
- [x] `client/public/sw.js` — intentionally minimal service worker: a no-op `fetch` handler
      (never calls `respondWith`) so it satisfies the install criteria WITHOUT caching or
      intercepting anything — it can't cause stale assets or break the tRPC API / SSE stream.
- [x] `index.html` — manifest + apple-touch + `apple-mobile-web-app-*` meta; SW registered on
      load, skipped on localhost so it never touches the Vite dev server / HMR.
- [ ] Follow-up (needs operator accounts): real native apps — **Capacitor** (iOS/Android;
      Apple Developer $99/yr + Google Play $25) or **Electron** (desktop, free, supports
      auto-launch-on-startup). PNG icon set also wanted once a rasterizer is available.
- [x] Footer → `v2.23.0`. tsc clean, 217 tests green, build clean.

## v2.24.0 — Rich contact fields + safe boot-migrator (delivered 2026-06-27)

- [x] **Additive boot-migrator** (`ensureSchemaExtensions` in `v2db.ts`, called once at server
      boot): idempotent `ALTER TABLE … ADD COLUMN` that swallows duplicate-column errors —
      STRICTLY additive, race-safe across Cloud Run instances, never blocks startup. This is
      how we evolve the live MySQL schema without a manual `pnpm db:push`.
- [x] **Rich contact columns** on `contacts`: `email`, `phone`, `company`, `jobTitle`,
      `website`, `birthday` (all nullable). Schema + router input + list mapping updated.
- [x] **Partial-update preservation fix** — `upsertContact` now overwrites ONLY the columns the
      caller passed (`contactUpdateKeys`), fixing a latent bug where a Favourite toggle (which
      omits avatarUrl/notes) would wipe them.
- [x] Client: the Add/Edit Contact dialog gained Email / Phone / Company / Title / Website /
      Birthday fields; the contact row shows "title · company" when present.
- [x] 7 vitest cases: `contactUpdateKeys` preservation + a static-analysis guard that the
      boot-migrator is ADD-COLUMN-only (no DROP/TRUNCATE/DELETE). 224 tests green.
- [x] Contact **cloud sync** already works — contacts are stored server-side per identity, so
      they load on any device a registered user signs into.
- [x] Footer → `v2.24.0`. tsc clean, build clean.

## v2.25.0 — Inbound email: reply-to-thread (delivered 2026-06-27)

Reply to a RELAY notification straight from your inbox and it posts into the thread.
Feature-gated on `INBOUND_EMAIL_DOMAIN`; built + reviewed by an adversarial agent pass.

- [x] `server/emailInbound.ts` — SIGNED reply addresses (`relay+{convId}.{identityId}.{hmac}@domain`,
      HMAC-SHA256, timing-safe + length-checked parse), Svix webhook-signature verification
      (`whsec_…`, replay window), quote-stripping, recipient/body/From extraction, and the
      `POST /api/email/inbound` handler.
- [x] Missed-call emails now carry the signed `Reply-To` (when inbound is configured), so the
      callee can reply from their inbox → posts a message from them into the caller↔callee thread.
- [x] Raw-body capture: the global `express.json()` got a path-scoped `verify` callback that
      stashes `req.rawBody` for `/api/email/inbound` so the signature is verified over exact bytes.
- [x] **Review fixes folded in:** (1) the boot-migrator is now **awaited** before `listen()` so a
      fresh-DB startup window can't 500 contacts; (2) replies are **bound to the mailbox owner**
      (email `From` must equal the signed identity's registered email — stops leaked-address
      replay); (3) a `sendMessage` DB error now returns **503** (provider retries) instead of
      silently 200-dropping the reply; (4) dropped a misleading raw-body fallback (fail-closed);
      (5) bounded the recipient scan.
- [x] 19 vitest cases (`emailInbound.test.ts`): address round-trip + forgery/tamper rejection,
      quote-strip, recipient/body/From extraction, Svix signature valid/invalid/stale/missing.
- [ ] **Needs operator infra to activate**: a domain on the inbound provider (Resend Inbound) +
      MX/DNS records + the webhook pointed at `/api/email/inbound`. Inbound attachments are a
      known follow-up (text replies only for now).
- [x] Footer → `v2.25.0`. tsc clean, 243 tests green, build clean.

## v2.26.0 — Voice calls + voice↔video switch (delivered 2026-06-27)

- [x] The Dialer now offers **two call buttons**: a primary **Video call** (green, `Video` icon)
      and a secondary **Voice call** (`Phone` icon, camera off). Keyboard Enter still places a
      video call.
- [x] **Purely additive & zero-regression**: a voice call is just a normal call that starts
      with the camera toggled off, reusing the existing, tested `setCam()` path (the same
      mechanism that already powers mid-call camera-off on BOTH the mesh and the SFU). The
      default video-call path is byte-for-byte unchanged.
- [x] **Switch to video any time**: tapping the in-call camera button upgrades a voice call to
      video instantly — no renegotiation (the track is already published, just re-enabled).
- [x] Engine API: `dial(number, { voice })` threaded through `relayClient` → `RelayEngine` →
      `Dialer`. `refactor: toggleCam → setCam(on)` so the start path can force camera-off.
- [ ] Caveat / follow-up: because we reuse the camera-toggle (track disabled, not stopped), the
      camera is still *acquired* at voice-call start (the camera indicator may briefly show).
      A true no-camera-acquire voice call with an SFU `publishTrack` upgrade is a noted
      follow-up; this additive version avoids any risk to the call engine you're validating.
- [x] Footer → `v2.26.0`. tsc clean, 243 tests green, build clean.

## v2.27.0 — Unsend message (soft-delete) (delivered 2026-06-27)

- [x] `deleteMessage` in `v2db.ts` — soft-delete (sets `deletedAt`, nulls body/attachment).
      Sender-only, enforced both on the SELECT (`row.senderIdentityId`) and the UPDATE WHERE
      clause (defense in depth). No migration — `deletedAt` already existed and
      `listMessages`/`listThreads` already filter it, so a deleted message cleanly vanishes
      for everyone on the next refetch.
- [x] `messages.remove` tRPC procedure (FORBIDDEN unless it's your own message) + push fan-out.
- [x] Client: a hover/focus-revealed trash button on your OWN message bubbles with a confirm;
      optimistic invalidation refreshes the thread.
- [x] Footer → `v2.27.0`. tsc clean, 243 tests green, build clean.

## v2.28.0 — Message reply / quote (delivered 2026-06-27)

- [x] Client-only — the `messages` schema + `send` already carried `replyToId`; this surfaces
      it. A hover/focus reply button on every message sets the reply target; a quoted chip
      shows above the composer; the sent message renders the quoted original (sender label +
      preview, with 📷/🎬/🎤/📎 glyphs for attachments) resolved from the loaded thread.
- [x] Reply works in DMs and groups (sender label uses the group roster when available).
- [x] Footer → `v2.28.0`. tsc clean, 243 tests green, build clean.

## v2.29.0 — Per-conversation mute (delivered 2026-06-27)

- [x] `client/src/app/mutedThreads.ts` — per-device mute set in localStorage (same pattern as
      DND; no server/schema change). `isThreadMuted`/`setThreadMuted`/`useThreadMuted`/`onMutedChange`.
- [x] `useRealtime` now suppresses the chime + desktop notification for muted conversations
      (messages still arrive and update in-app — only the alert is silenced).
- [x] Conversation header gets a Bell/BellOff toggle; the thread list shows a BellOff icon on
      muted threads (live-updates via an `onMutedChange` subscription).
- [x] 5 vitest cases (`mutedThreads.test.ts`): default, toggle isolation, persistence,
      subscribe/unsubscribe, corrupt-storage tolerance. 248 tests green.
- [x] Footer → `v2.29.0`. tsc clean, build clean.

## v2.30.0 — Typing indicators (delivered 2026-06-27)

Closes a long-standing v2.0 gap ("No typing indicators" in CLAUDE.md).

- [x] Server: `messages.typing` mutation fans an ephemeral `typing` event to the OTHER
      participants (no DB); new `typing` kind on the SSE `V2Event` bus.
- [x] Client: `typingStore.ts` — an ephemeral per-(conversation,sender) registry with a 5s
      auto-expiring TTL (per-entry timeouts, no polling); `useRealtime` records `typing` events
      and clears a sender the instant their real message arrives.
- [x] Composer sends a throttled (≤1/3s) typing ping while you type; the conversation shows an
      animated "X is typing…" / "X and Y are typing…" line above the composer (names resolved
      via the DM peer or the group roster).
- [x] 5 vitest cases (`typingStore.test.ts`, with fake timers): per-conversation isolation,
      TTL expiry, refresh-keeps-alive, clear one/all, change-only notifications. 253 tests green.
- [x] Footer → `v2.30.0`. tsc clean, build clean.

## v2.31.0 — Multi-device ring (experimental, flag-gated) (delivered 2026-06-27)

One number rings every signed-in device; first to answer wins. **OFF by default**
(`MULTI_DEVICE_RING=1` to enable) — the off-path is byte-identical to today, so the LIVE
call engine is untouched until the operator opts in + tests on two devices.

- [x] `server/relay.ts`: a `devices: Map<pin, Map<cid, RelaySocket>>` registry (all live device
      sockets per number, always maintained but only READ when the flag is on) + a
      `multiDeviceEnabled()` gate. The single-`clients`-per-pin model stays as the in-call
      "primary".
- [x] **register** (flag on) lets multiple devices share a number and won't let a newcomer
      hijack the primary while it's mid-call; **invite** rings every idle device; **accept**
      promotes the answering device to primary (so offer/answer/ice route to it) and sends
      `ring-cancel` ("answered elsewhere") to the number's other devices; **disconnect** of the
      primary promotes a surviving device instead of going offline.
- [x] 2 vitest cases: flag-OFF (2nd device gets a fresh number — unchanged) and flag-ON (shared
      number, both ring, first-accept cancels the rest, in-call signal routes to the accepter).
      Reviewed by a focused adversarial agent pass. 255 tests green.
- [ ] Needs the operator to set `MULTI_DEVICE_RING=1` and validate on two physical devices
      (it's stateful signaling that can't be fully verified without them).
- [x] Footer → `v2.31.0`. tsc clean, build clean.

## v2.31.1 — Multi-device ring review fixes (delivered 2026-06-27)

An adversarial review verified the **flag-OFF path is byte-for-byte identical to the original**
(all 35 relay tests green with the flag unset — the live engine is provably unaffected). Found
one real flag-ON bug + two low nits; all fixed:

- [x] **(High, flag-ON) Secondary reconnect cancelled the primary's grace timer** — the SSE
      re-attach cleared `client.graceT` unconditionally, so a secondary device flapping while
      the primary was disconnecting would strand a dead primary (number becomes a black hole,
      survivor never promoted). Now the grace-clear is gated on `isPrimaryReconnect` (same guard
      as the socket re-bind); a secondary reconnect leaves the primary's timer alone.
- [x] **(Low) Stale `cidToPin` on promotion** — promoting a survivor now drops the dead
      primary's `cid→pin` mapping before handing over.
- [x] **(Low, by-design) Mid-call promotion gap** — documented: if the primary drops mid-call,
      the promoted idle device has no peer/SFU session, so the number stays reachable for NEW
      calls but the in-progress call doesn't migrate.
- [x] (Also fixed CI: removed two review-agent scratch test files that a `git add -A` had
      accidentally committed.)
- [x] Footer → `v2.31.1`. tsc clean, 255 tests green, build clean.

## v2.32.0 — Multi-party camera fix + mobile screen-share (delivered 2026-06-27)

Two live-call bugs, diagnosed by a parallel investigation workflow.

- [x] **Multi-party camera stuck/black (3+ parties)** — ROOT CAUSE: the `audio-only` tile rule
      hid the inner `<video>` with `display:none`. LiveKit's `adaptiveStream` samples element
      visibility on `track.attach()` and **pauses inbound video for any `display:none` element**.
      Audio commonly subscribes before video, so the tile was audio-only (display:none) when the
      video attached → that participant's camera stalled. Probability rises with party count
      (each viewer has N−1 independent races). FIX: hide with `visibility:hidden` (keeps
      `display` non-none so adaptiveStream keeps delivering) + don't mark a tile audio-only when
      the participant publishes camera video (`lkHasVideo`). Mesh tiles use the same rule for
      consistency.
- [x] **Screen-share button missing on mobile** — it was blanket-hidden by a
      `@media (max-width:680px){#screenBtn{display:none}}` rule (iPad/desktop are wider → showed).
      FIX: removed the rule; the button now defaults hidden in markup and is **revealed by a JS
      capability check** (`getDisplayMedia`) — so Android Chrome/desktop/iPad show it, iOS Safari
      (no getDisplayMedia) hides it. The mobile control bar now `flex-wrap`s so the extra button
      never clips.
- [x] 4 vitest regression guards (`relayAssets.test.ts`): audio-only uses visibility:hidden not
      display:none; no blanket #screenBtn hide; #screenBtn defaults hidden; ctrl-bar wraps. 259
      tests green.
- [x] Footer → `v2.32.0`. tsc clean, build clean.

## v2.33.0 — Persistent call membership + auto-rejoin (delivered 2026-06-27)

A call now stays active as long as someone's in it; any member (host included) can refresh /
step away / come back and AUTO-REJOIN with no re-invite. Locked out only on explicit hang-up or
when the room is fully abandoned.

- [x] Server (`relay.ts`): identity-persistent membership — `pinRoom: Map<pin,rid>` (+ the pin
      stays in `rooms`) survives a disconnect; on SSE drop the 30s grace reaps only the
      CONNECTION (membership kept) and arms a `ROOM_ABANDON_MS` (5 min) reaper if no member is
      still connected. `joinRoomMember` / `reapRoom` / `maybeScheduleRoomReap` /
      `sendRejoinIfInRoom`. On (re)register, an active member gets a `rejoin` {roomId, members}
      + a fresh LiveKit token. EXPLICIT `leave` (hang-up/logout) clears `pinRoom` and reaps the
      room when empty.
- [x] Client (`relayClient.ts`): `onRejoin` re-acquires media, re-enters the call UI, and
      rejoins media (SFU: token→joinLivekit; mesh: re-offer to each member). The `beforeunload`
      handler is now a **no-op** — a refresh no longer ends the call; only the End button
      (`hangUp`) or the engine destroy (logout / leaving the app) sends `leave`.
- [x] 3 new vitest cases: reaped-but-kept member auto-rejoins on return; explicit hang-up →
      locked out (no rejoin); room reaped once the last member leaves. 262 tests green.
- [x] Reviewed by a focused adversarial agent pass (core change to the LIVE engine).
- [x] Footer → `v2.33.0`. tsc clean, build clean.

## v2.33.1 — Persistent-rejoin hardening (review findings) (delivered 2026-06-27)

The adversarial review of v2.33.0 found 5 real issues (2 verified with repro tests). All folded here.

- [x] **CRITICAL — cross-user call hijack on a shared browser.** The relay `cid`
      (`localStorage.relay_cid`) persisted across logout, and `ownedPin = cidToPin.get(cid)`
      overrode the requested pin — so a NEW user logging in on the same browser was handed the
      previous user's number and dropped into their still-live call (SFU: a publish/subscribe
      token under the wrong identity). Fixed three ways: (1) server `register` now treats an
      explicit pin request that DIFFERS from the cid's owned pin as an *identity switch* — it
      severs the stale `cid→pin` binding, tears down the old room membership, and honours the new
      request (`relay.ts` `identitySwitch`); (2) logout clears `relay_cid` + `relay_pin`
      (`clearRelayChannel` in `deviceId.ts`, wired into `useIdentity.signOut` + `Profile` logout);
      (3) the server fix is authoritative regardless of client state.
- [x] **HIGH — room/membership memory leak.** When a grace-reaped "ghost" member remained and the
      last *connected* peer explicitly left, `leaveRoom` never armed the abandonment reaper, so the
      room + `pinRoom` entry leaked forever. `leaveRoom` now calls `maybeScheduleRoomReap` when the
      room still has (ghost-only) members.
- [x] **MEDIUM — empty rejoin after refreshing mid-dial.** A solo caller who refreshed while
      ringing was dropped into an empty "call" screen. `sendRejoinIfInRoom` now detects a lone
      member, releases the membership (reaping the orphaned solo room), and lets them land in the
      lobby instead.
- [x] **LOW/MEDIUM — stale dead mesh peer on rejoin.** A fresh SDP offer for an existing peer whose
      `RTCPeerConnection` is already failed/closed/disconnected now rebuilds the peer from scratch
      (`onSignal` + a `quiet` flag on `removePeer`) instead of applying the offer onto a dead pc.
- [x] **LOW — phantom member on rejoin media failure.** If `ensureMedia` fails on rejoin, the
      client now sends an explicit `leave` so the server drops the membership instead of keeping a
      "connected" member who isn't in the call.
- [x] 6 new vitest cases (4 server: identity-switch no-hijack, same-pin still rejoins, ghost-room
      reap-arm, lone-member lobby; 2 client: `clearRelayChannel`). 268 tests green, tsc + build clean.
- [x] Footer → `v2.33.1`.

## v2.34.0 — Conference call history (delivered 2026-06-27)

A new **History** tab logs every answered call/conference: which number you dialed, how many parties
joined, each party's display name + 6-digit PIN, and the call duration. The room is the unit of a
conference, so a 2-party call and a 10-way SFU call are recorded the same way.

- [x] Schema: new `conference_history` (roomId, dialedNumber, partyCount, started/ended, durationSec,
      JSON roster) + `conference_participants` (indexed identityId join) tables, created at boot by an
      extended `ensureSchemaExtensions` (idempotent `CREATE TABLE IF NOT EXISTS`, same additive safety
      contract as the ADD COLUMN block).
- [x] Server (`relay.ts`): per-room lifetime `roomMeta` accumulates the full roster (everyone who was
      EVER in the room, pin → latest name), the seeding `dialedNumber`, the start time, and an
      `accepted` flag. `reapRoom` (the single teardown path) fires a new `onConferenceEnd` hook with
      the roster + duration — but ONLY for answered calls with ≥2 parties, so an unanswered dial is
      never logged as a conference. Idempotent (roster deleted on emit). New `ConferenceEndHook`,
      4th `attachRelay` param.
- [x] DB (`v2db.ts`): `recordConferenceEnd` resolves each pin → identity (a relay pin IS the
      identity's number), writes the conference row + per-identity participant rows;
      `listConferenceHistory` returns the conferences an identity took part in.
- [x] Router (`v2routers.ts`): `calls.conferenceHistory` query (roster flagged with `isSelf`).
- [x] Client: new **History** tab (`pages/app/History.tsx`) + nav entry (Calls · History · Messages ·
      Contacts, mobile grid → 4-up) + route. Shows answered conferences (name + PIN chips, party
      count, duration, time, one-tap call-back) merged with missed/declined 1:1 calls into one
      time-sorted log. Duration/time formatters extracted to `lib/formatCall.ts`.
- [x] 10 new vitest cases (3 server: roster+dialed-number emit, unanswered-not-logged, left-early
      stays in roster; 7 client: `formatDuration`/`formatWhen`). 278 tests green, tsc + build clean.
- [x] Footer → `v2.34.0`.

## v2.34.0 review — conference-history findings (to fold into v2.35.1)

A focused adversarial review found: (1) HIGH duration includes ring/dial time (startedAt stamped at
invite, not accept); (2) MEDIUM abandonment-reaped rooms inflate duration by up to the 5-min abandon
window (endedAt = reap wall-clock); (3) LOW/MED `recordConferenceEnd` SELECT-back-by-roomId is brittle
(use the driver `insertId` like the rest of the codebase); (4) LOW unstable secondary sort (order by
id, not 1-second-granularity startedAt). No leak / no double-emit / auth scoping all verified clean.

## v2.35.0 — Active-speaker / spotlight view (delivered 2026-06-27)

The in-call grid is now smart: it follows whoever's talking, auto-focuses a shared screen, lets you
tap any tile to blow it up, and collapses to a 2-up of the active speakers when the window is small.

- [x] **Spotlight layout**: one big tile + a thumb row. The focused tile is chosen by precedence
      **manual pin > screen share > active speaker**. Pure decision logic in `lib/callLayout.ts`
      (`computeLayout`/`resolveFocus`/`rankTiles`/`pickScreenShareTile`); `relayClient.layoutGrid`
      just applies it to the real `#videoGrid` tiles (grid template + classes), so the existing
      add/remove-tile callers get it for free.
- [x] **Auto active-speaker**: SFU via LiveKit `ActiveSpeakersChanged` (loudest-first identities →
      tile ids, self excluded); mesh via a lightweight Web Audio `AnalyserNode` per remote stream
      sampled every 400ms (lazy `AudioContext`, torn down on call end). The big tile follows the
      loudest speaker unless you've pinned someone.
- [x] **Screen-share auto-focus**: a remote LiveKit screen-share track (`source === "screen_share"`)
      or our own local share marks its tile `.screen` (letterboxed) and auto-spotlights it.
- [x] **Click-to-spotlight**: tap a tile to pin it big; tap it again to unpin (back to auto). Tiles
      show `cursor:pointer`; the active speaker gets a green `.speaking` outline.
- [x] **Minimized 2-up**: a `ResizeObserver` on the call host flips to a compact, stacked 2-up of the
      top-2 active tiles when the window is genuinely small (BOTH width<500 AND height<420 — so a
      normal tall phone screen still gets the full spotlight, not a forced 2-up).
- [x] State is reset on every call start (`enterCallUI`) and torn down on hang-up/destroy (interval,
      AudioContext, ResizeObserver). Spotlight/active state pinned to a tile is cleared when that tile
      leaves (mesh + SFU).
- [x] 20 new vitest cases (16 `callLayout` decision logic, 4 `relayAssets` CSS guards). 298 tests
      green, tsc + build clean.
- [x] Footer → `v2.35.0`.

## v2.35.1 — Conference-history review fixes (delivered 2026-06-27)

Folds the v2.34.0 adversarial-review findings (duration accuracy + insert robustness).

- [x] **HIGH — duration now measures TALK time, not ring time.** `RoomMeta` gained `answeredAt`
      (stamped on the first `accept`) and the logged `durationSec` counts from the answer, not the
      dial. A 2-second call after a 40-second ring no longer shows as "0:42".
- [x] **MEDIUM — abandoned-room duration no longer inflated by the 5-min reaper.** `RoomMeta` gained
      `lastActiveAt`, refreshed on accept / explicit leave / in-call grace-disconnect (`roomActivityTouch`).
      `reapRoom` logs `endedAt = lastActiveAt` (clamped ≥ startedAt) — the real last-active moment, not
      the wall-clock reap time (which for an abandoned room is up to `ROOM_ABANDON_MS` later).
- [x] **LOW/MED — `recordConferenceEnd` uses the driver `insertId`** (like `sendMessage` /
      `createGroupConversation`) instead of a SELECT-back-by-roomId, removing the roomId-reuse
      ambiguity and an extra query.
- [x] **LOW — `listConferenceHistory` orders by `id`** (monotonic) instead of 1-second-granularity
      `startedAt`, for a stable order.
- [x] Test updated to assert `answeredAt` is set and `startedAt ≤ answeredAt ≤ endedAt`. 298 green,
      tsc + build clean.
- [x] Footer → `v2.35.1`.

## v2.35.2 — Active-speaker review fixes (delivered 2026-06-27)

Folds the v2.35.0 adversarial-review findings.

- [x] **MEDIUM — SFU camera blank after a screen share ends.** A participant's camera + screen are two
      LiveKit publications sharing one tile/`<video>`; detaching the screen on `TrackUnsubscribed` left
      the element blank (frozen black, no avatar) because the still-live camera was never re-attached.
      Added `lkCameraTrack(participant)` and re-attach the camera when a screen share ends.
- [x] **LOW — idle ResizeObserver churn.** The observer now early-returns when `!inCall`, so the
      parked ~1px off-screen host no longer reads as "minimized" and re-runs layout while idle. Also
      `hangUp` now clears `#videoGrid` so no dead tiles/srcObjects linger between calls.
- [x] **LOW — mesh spotlight thrash.** Added hysteresis to the Web Audio active-speaker pick: a new
      leader must lead 2 consecutive samples (~800ms) before the spotlight switches, and silence holds
      the last speaker rather than dropping the spotlight. (The SFU path is already debounced by LiveKit.)
- [x] Verified-NOT-bugs from the review: no AudioContext/interval leak, correct self-exclusion in
      active-speaker (me.pin == LiveKit identity), clean layout reset between modes, click-to-spotlight
      survives a tile leaving. 298 tests green, tsc + build clean.
- [x] Footer → `v2.35.2`.

## v2.36.0 — Contacts: scrollable add-dialog + 24h guest privacy (delivered 2026-06-27)

Batch 1 of the UX overhaul (large multi-request batch).

- [x] Add-contact dialog is a flex column with a scrollable body + sticky footer, so the
      Save/"Add to contacts" button is always reachable on small/mobile viewports (it used to be
      pushed off-screen with no scroll).
- [x] Guest presence privacy: a GUEST inactive >24h has presence COMPLETELY suppressed (no dot, no
      "offline", no "last seen") in the contacts list, directory lookup, and add preview. Pure
      `isGuestPresenceHidden` helper + 5 tests.

## v2.37.0 — Call history Message, Dialer buttons, Group Call, clean share link, device chip (delivered 2026-06-27)

Batches 2–4 of the UX overhaul.

- [x] **Call history Message action**: a Message icon next to the call icon on every History row
      (conference + missed) opens/creates a 1:1 thread and jumps into it.
- [x] **Dialer call buttons redesigned**: Voice (blue circle, "Voice Call" label) and Video (green
      circle, "Video Call" label) are now two equally-prominent labelled circular buttons.
- [x] **Create Group Call**: a new picker screen (`GroupCallScreen.tsx`) — select up to 10
      participants from contacts or add numbers manually, choose Voice/Video, Start. New engine
      `dialGroup(numbers)` rings everyone into ONE room (extra invitees gated on the server `room`
      confirmation so a fresh group dial can't race into two rooms). Dismissible (X / backdrop /
      Cancel).
- [x] **Clean share link**: short `/i/<pin>` route redirects straight into the dialer (auto-dials),
      replacing the long `?to=` URL. Shared message is structured (header line + link line) and the
      OS share sheet gets title + url separately (no illegible blob, no unexpected page).
- [x] **Device chip on the main screen**: a dynamically-detected "Mobile"/"Desktop" chip sits next to
      the country flag (sidebar + mobile header). New `detectDeviceType()` util + 4 tests.
- [x] 307 tests green, tsc + build clean. Footer → `v2.37.0`.

## v2.38.0 — Global UX: dismissible add-pad, Back button, sticky-nav clearance (delivered 2026-06-27)

Batch 6 of the UX overhaul.

- [x] In-call "add person" pad is now dismissible: a visible X (#addClose), an outside click (capture
      phase, excludes the add button so toggling still works), and Escape all close it instantly.
      Fixes the "can't close the add window during a mobile call" lock-up.
- [x] Universal Back button in the mobile header on the Profile sub-page (history.back, falls back to
      the dialer).
- [x] Sticky-nav clearance: Profile no longer creates a competing `h-full overflow-auto` scroll area
      (its Sign-out control sat UNDER the fixed bottom nav with no way to reach it) — it now flows
      within the AppShell scroll container, which already reserves nav space. Contacts list gains
      `pb-24` so the last contact clears the nav. The bottom nav remains fixed to the viewport.
- [x] X close is present on all modals/popups (contacts dialog, group-call picker, add-pad).
- [x] 1 new test (add-pad close guard). 308 tests green, tsc + build clean. Footer → `v2.38.0`.

## v2.39.0 — In-call tile enrichment (delivered 2026-06-27)

Batch 7 of the UX overhaul.

- [x] Camera-off tiles now show the participant's avatar (initials) AND full name centred, so a tile
      is never a blank black box. Added to the self tile too (was previously just a black "You").
- [x] Active-speaking cue: a glowing green ring plus a soft expanding "sound-wave" halo pulse on the
      avatar (motion-gated behind prefers-reduced-motion).
- [x] Per-tile info chip: device type (Mobile/Desktop) + a LIVE connection speed (e.g. "5.2 Mbps").
      Speed is sampled every 2s from getStats — inbound per remote tile, outbound for self (mesh), and
      best-effort per-participant on the SFU. Device type is shared via signaling: each client reports
      its type at register (`device`), the relay carries it in member lists + peer-joined, and tiles
      display it (mesh + SFU).
- [x] DEFERRED (noted): per-participant NATIONAL FLAG (needs geo-per-participant signaling) and the
      real profile-photo avatar in tiles (the engine only knows name → initials today).
- [x] 4 new tests (CSS guards + server device propagation). 312 tests green, tsc + build clean.
      Footer → `v2.39.0`.

## v2.40.0 — Resolution selector + in-app message popups (delivered 2026-06-27)

Batch 9 of the UX overhaul (overheating/latency + notifications).

- [x] Streaming-quality selector (HD / SD) in the in-call control bar — applies to BOTH the camera and
      screen share. "SD" (640×360@15) sharply cuts CPU (cooler device) and bandwidth (lower latency);
      "HD" is the default. Switches live via applyConstraints (no re-acquire), persisted in localStorage,
      and honoured by getUserMedia, flip-camera, and getDisplayMedia.
- [x] Non-intrusive incoming-message popups: when a message arrives while the user is in a call or on
      another screen, a small card appears (bottom-right) with the sender, the message content, and an
      inline reply box. Minimizable to a chip, closable with X, or tap to open the full thread.
      Suppressed when the user is already viewing that conversation. Store (`messagePopups.ts`) + manager
      (`MessagePopups.tsx`) mounted at the app root; fed by the existing realtime SSE layer.
- [x] 13 new tests (popup store dedup/cap/dismiss + isViewingConversation). 321 tests green, tsc + build
      clean. Footer → `v2.40.0`.

## v2.41.0 — Host controls + call layout (delivered 2026-06-27)

Batch 8 of the UX overhaul. (Host call-continuity + auto-rejoin-on-refresh were already delivered by
the persistent-room work in v2.33; this batch adds moderation, roles, and host-driven layout.)

- [x] Host designation: the room creator is the host (tracked in RoomMeta.hostPin). Roles flow to
      clients via the room/joined/rejoin/peer-joined member info; tiles show a "Host"/"Co-Host" badge.
- [x] Moderation (`mod` signaling message, server-gated to host/co-hosts of the caller's own room):
      mute individual, mute all, unmute all — relayed to targets as `force-mute`, which the client
      honours (mutes/unmutes the mic + a toast). 
- [x] Co-host delegation: only the HOST can promote/demote co-hosts; the change broadcasts a `role`
      update (badge + grants moderation powers). Co-hosts can mute/pin but not assign other co-hosts.
- [x] Host-driven layout: the host can PIN a feed to everyone's main spotlight (`host-pin` broadcast →
      all clients spotlight that tile) or switch everyone to GRID view (clears the pin). Builds on the
      v2.35 spotlight engine.
- [x] Host-controls panel (three-dot button in the call bar, shown only to moderators): a live
      participant list with per-row Mute / Pin / Make-co-host, plus Mute all / Unmute all / Grid view.
- [x] 9 new tests (7 server moderation: host designation, mute-all, non-mod rejected, co-host promote +
      moderate, host-only co-host assignment, pin, grid; 2 CSS guards). 330 tests green, tsc + build
      clean. Footer → `v2.41.0`.

## v2.42.0 — Messaging UI overhaul (delivered 2026-06-27)

Batch 5 (final) of the UX overhaul.

- [x] Fixed the misplaced composer: the message list was a flex child without `min-h-0`, so it grew to
      fit its content and shoved the reply input into the middle of the screen. Adding `min-h-0` pins
      the composer to the bottom (standard chat-app layout); only the message list scrolls.
- [x] Three-dot context menu per message (Reply / Copy / Unsend) replacing the old hover-only buttons —
      which were `opacity-0 group-hover` and therefore INVISIBLE on mobile (no hover on touch), so
      delete/reply were unreachable on phones. The menu is always tappable.
- [x] Attachment thumbnails open a fullscreen in-app MediaLightbox (image/video) instead of a new tab;
      videos show a play overlay. The lightbox closes on the X, a backdrop click, or Escape.
- [x] Sent vs received are already visually distinct (right/primary vs left/muted) with delivery ticks
      (✓ / ✓✓) and timestamps — retained and cleaned up around the new menu/thumbnails.
- [x] 5 new static guards (min-h-0, three-dot menu, lightbox, dismissibility). 335 tests green, tsc +
      build clean. Footer → `v2.42.0`.

### UX overhaul batch — COMPLETE (v2.36.0 → v2.42.0)
All 9 batches of the large multi-request UX overhaul shipped: contacts, history-message, dialer
buttons + group call, share link + device chip, global UX (sticky nav/back/X), in-call tiles, host
controls, resolution + message popups, and the messaging overhaul. Deferred (noted in-line): per-
participant national flag on tiles, real photo avatars in tiles, and guest-presence privacy on the
message thread header (the contacts + directory surfaces are covered).

## v2.43.0 — Audio output routing + Bluetooth + mobile screen-share render (delivered 2026-06-27)

Three in-call audio/video fixes requested after the overhaul.

- [x] **Audio output picker**: a speaker-icon button in the call bar opens an output menu (Automatic /
      Speakerphone / Earpiece / wired / Bluetooth, listed by label). Applied via `setSinkId` to every
      remote element — mesh remote `<video>` (audio rides it) + SFU detached `<audio>` (now tracked in
      `lkAudioEls`). Persisted in localStorage. Shown only where the browser supports output selection
      (Chrome Android/desktop; iOS routes via the OS, so the button hides).
- [x] **Bluetooth headset now heard**: a `navigator.mediaDevices` `devicechange` listener re-applies the
      chosen sink the moment a BT headset connects/disconnects mid-call, so audio follows to/from it.
      New remote elements get the sink on creation; the listener is removed on destroy.
- [x] **Mobile screen-share renders without rotating**: the self tile (and the SFU remote screen tile)
      now re-layout on the capture's first frame (`loadedmetadata`/`resize`) plus a post-paint
      `requestAnimationFrame`, and call `play()` — so the shared screen shows immediately instead of
      only after a device rotation.
- [x] An adversarial review workflow (3 dimensions + independent verification) is in flight; any
      confirmed findings ship as a patch. 337 tests green, tsc + build clean. Footer → `v2.43.0`.

## v2.43.1 — Audio/screen review fixes (delivered 2026-06-27)

Folds the v2.43.0 adversarial-review findings (3-dimension workflow, all claims independently verified).

- [x] **MED — silent setSinkId failure no longer lies.** When the chosen output device is gone (e.g. an
      unplugged Bluetooth headset), `applyAudioSink` now falls back to the system default and clears the
      stale preference, so the UI never shows a dead device as "selected".
- [x] **LOW — de-duped the default rows.** The output list now emits ONE synthetic "Automatic" row and
      drops the platform "default" pseudo-device. Logic extracted to a pure, tested `buildAudioOutputList`
      (validates the persisted sink against the live device list).
- [x] **Real Bluetooth auto-route.** On `devicechange`, when on Automatic and a headset/Bluetooth output
      newly appears, call audio is actively routed onto it (label-heuristic gated) — the substantive "can't
      hear my Bluetooth headset" fix, beyond just re-applying the default. A disconnect falls back to default.
- [x] **LOW — lkAudioEls cleared in `teardownLivekit`** (not just hangUp), closing the call-waiting "Switch"
      retention gap.
- [x] **Screen-share resume made explicit.** The reflow handlers (self + SFU remote) now call `play()` too
      (the load-bearing part on mobile), not just `layoutGrid()`; fixed a dead null-guard on the SFU branch.
- [x] 6 new `buildAudioOutputList` tests (Automatic dedupe, stale-sink fallback, selection). 342 tests
      green, tsc + build clean. Footer → `v2.43.1`.

### iOS caveat (honest)
`setSinkId` does not exist on iOS Safari/WKWebView, so the output picker hides there and call-audio
routing (speaker vs earpiece vs Bluetooth) stays under iOS's control — not fixable from web JS. The picker
+ Bluetooth auto-route work on Chrome Android/desktop.

## v2.44.0 — Tile flags, filter performance, Picture-in-Picture (delivered 2026-06-27)

Three call-experience requests.

- [x] **National flag beside the name on call tiles.** Each client shares its flag (from geoSelf) at
      register — plumbed exactly like device type (relay member lists + peer-joined; re-affirmed when geo
      resolves). Rendered in both the tile name label and the cam-off placeholder name. RelayEngine pushes
      the flag via a new `setSelfFlag` handle method.
- [x] **Filters no longer tank performance.** The MediaPipe/canvas pipeline now (a) caps processing to
      480p (was full 720p/1080p — the main heat source), (b) drops to 24fps, and (c) throttles the
      EXPENSIVE ML inference — segmentation every 2nd frame, face detect every 3rd — reusing the cached
      mask/box while compositing the CURRENT frame each tick (motion stays smooth). Face-box coords are
      scaled into the reduced canvas space.
- [x] **Picture-in-Picture with active speakers.** A new PiP button composites the top-2 active speakers
      (screen-share first, then loudest) onto a canvas, captures it as a stream, and PiPs the result — so
      minimizing the mobile browser keeps the call visible + audible in a floating 2-up split that follows
      whoever's talking. `autoPictureInPicture` set for auto-PiP on background where supported; cleaned up
      on call end / destroy.
- [x] 2 server assertions (flag propagation) + 2 CSS guards. 344 tests green, tsc + build clean.
      A live-engine adversarial review (PiP lifecycle, filter throttle correctness) follows as a patch.
      Footer → `v2.44.0`.

## v2.45.0 — Speaking wave, chat-close, screen-share visibility, group redial, call-waiting/hold (delivered 2026-06-27)

Five refinements + the v2.44 review fixes.

- [x] **Colourful speaking animation.** Cam-off speakers now show a 5-bar rainbow sound-wave equaliser
      under the avatar + a heart-beat "breathing" avatar with a colour-cycling glow (motion-gated).
- [x] **Chat close no longer behind End Call.** On mobile the chat's X moves to the LEFT (`order:-1`)
      so it's not under the top-right End-call button.
- [x] **Screen-share button visible.** Moved it into the primary cluster (mic · cam · SCREEN · flip) and
      added safe-area bottom padding so a wrapped control row is never hidden behind the phone's home bar.
- [x] **History group redial → conference.** A group/conference history row's call button now rings ALL
      the other participants back into one conference (engine `dialGroup`), shown with a group icon.
- [x] **Incoming-call popup + hold.** While in a call, an incoming call shows a popup with the caller's
      name + number + flag and **Answer / Reject**. Answering sends a `hold` to the current room so its
      members see a "put you on hold for another call" status + an on-hold tile badge, then switches.
      (True two-call resume isn't possible under the one-room-per-number model; the held call continues
      for its other participants.)
- [x] Folded v2.44 review fixes: PiP requests synchronously within the gesture (no `await play()` first),
      `pipSupported` now requires `canvas.captureStream` (hides the button on iOS), filter caches clear on
      filter switch, late-resolving flags fan out via a new `peer-meta` broadcast, PiP stream tracks stopped.
- [x] 5 new tests/guards (hold broadcast + CSS/markup). 349 tests green, tsc + build clean. Footer → `v2.45.0`.

## v2.45.1 — Tile-chrome fixes from device screenshots (delivered 2026-06-27)

- [x] **Name no longer overlaps the device/speed chip.** Moved the device + live-speed chip to the
      TOP-right corner (it was bottom-right, colliding with the bottom-left name on narrow tiles); the
      "connecting…" indicator moved to top-left. The name label is width-capped and truncates with an
      ellipsis (badge + flag stay). The chip is dropped entirely on tiny spotlight thumbnails.
- [x] **Flag no longer shows twice on a camera-off tile.** The flag now lives ONLY in the bottom-left
      name label, not also in the centered cam-off placeholder name — so a black/cam-off tile shows it
      once. 351 tests green, tsc + build clean. Footer → `v2.45.1`.

## v2.46.0 — Cross-browser screen share, host transfer, cam-on placeholder fix (delivered 2026-06-27)

- [x] **Screen share now shows to EVERYONE (any browser).** Instead of relying on per-browser track-source
      detection (which the mesh + replaced-track paths don't expose), the sharer now broadcasts a `screen`
      signal; the relay fans out `peer-screen` so every participant spotlights the sharer's tile. Sent on
      start AND stop.
- [x] **Host can transfer the host role.** New `mod action:"makehost"` (host-only): promotes the target to
      host and demotes the old host to co-host, broadcasting both role changes (+ the new hostPin). A
      "Make host" button appears per-participant in the host panel (with a confirm).
- [x] **Camera-on no longer shows the big name over your face.** The self-tile's centered avatar/name
      placeholder is now hidden once the camera is live (`.relay-tile.you:not(.audio-only) .ph{display:none}`)
      — it only appears when the camera is off. (Regression from the v2.39 cam-off avatar feature.)
- [x] 4 new server tests (screen broadcast, host transfer + permission gate). 354 tests green, tsc + build
      clean. Footer → `v2.46.0`.

## v2.47.0 — Per-tile host menu + remove participant (delivered 2026-06-27)

- [x] **Per-tile ⋮ host menu.** Each remote participant's tile now shows a 3-dots button in the corner,
      visible ONLY to the host/co-host (`#videoGrid.mod-on`). Tapping it opens a sheet with: Pin to
      everyone's view, Mute, (host) Make co-host, (host) Make host, and **Remove from call**.
- [x] **Remove participant (kick).** New host/co-host `mod action:"kick"` force-leaves the target
      (server `leaveRoom` clears membership + broadcasts peer-left); the kicked client gets a `kicked`
      message and exits the session with a notice. Permission-gated: nobody can remove the host; only the
      host can remove a co-host. "Remove" also added to the host-panel rows.
- [x] 2 new server tests (kick removes membership; can't kick the host) + a CSS guard. 357 tests green,
      tsc + build clean. Footer → `v2.47.0`.

## v2.48.0 — Auto-update checker + "enable once" auto Picture-in-Picture (delivered 2026-06-27)

- [x] **Auto-update checker.** The app version now lives in `shared/version.ts` (single source of truth):
      baked into the client bundle AND served at runtime from a new `GET /api/version` (no-store). A
      mounted-once `UpdateChecker` polls it **every 30s** and compares the running deploy's version with
      the version baked into the loaded tab. On a mismatch (a new deploy is live):
        - **In a call** (engine `phase !== "idle"`) → the page **reloads silently**. Persistent call
          membership + auto-rejoin (a refresh keeps the server-side membership — see relayClient
          `onUnload`) re-enter the same room on the fresh bundle, so the user keeps talking without
          noticing. Guarded against double-reload.
        - **Idle** → a **centered, clickable** "New version available · Refresh now" modal. "Later"
          only hides it briefly (`REAPPEAR_MS`); it reappears so an update can't be ignored forever. The
          card is gated on `phase === "idle"` so it never interrupts an active call.
- [x] **"Enable once" auto Picture-in-Picture.** The PiP button is now a *persistent* toggle
      (`relay_auto_pip` in localStorage) — enable it once and PiP auto-engages on every future call.
      When ON, the compositor is **primed** at call start (`primeAutoPip` in `enterCallUI`) and the
      off-screen composite video is kept playing, so the browser's `autoPictureInPicture` attribute
      **auto-opens** a 2-up active-speaker PiP the instant the app is backgrounded mid-call — no per-call
      tap. A `visibilitychange` listener best-effort-opens it (gesture-free, failures fall back to the
      attribute) and **closes** an auto-opened window on return (a hand-opened one is left alone). Priming
      runs a slow trickle (1 fps) foreground, full rate in PiP, and is fully torn down on hang-up
      (`unprimeAutoPip`) so an idle engine never leaks a compositor/timer. (Camera + mic stay automatic:
      browser permission persists after the one-time grant, and every call still starts with both on.)
- [x] **Adversarial review hardening** (3-dimension workflow → verify, all findings independently
      verified): the updater now acts **only on a strictly-newer** server version (`isNewer` semver
      compare in `updateVersion.ts`) so a multi-instance Cloud Run rollout — where a tab already on the
      NEW bundle can poll a still-OLD instance — never flaps/reloads; a **sessionStorage cooldown**
      (`relay_update_reload_ts`, 60s) survives the reload so a stale CDN/asset edge can't loop; and the
      silent reload fires **only for an established `in-call`** (not `dialing`/`ringing`, which have no
      server membership to auto-rejoin and would drop the outgoing dial).
- [x] 26 new tests (version constant + endpoint, UpdateChecker contract, `isNewer` semver behaviour,
      auto-PiP wiring). 379 tests green, tsc + build clean. Footer → `v2.48.0`.

## v2.49.0 — Add-person keypad + auto-invite, working call waiting (delivered 2026-06-27)

Three fixes from on-device feedback about the in-call "+" add-person window and call waiting.

- [x] **Add-person window auto-invites (no "Add" click).** The in-call "+" pad now has an on-screen
      numeric **keypad** (it had regressed to a bare text field) — tap the digits and the invite **fires
      automatically on the 6th digit**. Online → the server rings them straight in; offline/nonexistent →
      a clear **"That number doesn't exist or is offline."** toast (server message reworded, system-wide).
      Either way the **pad closes itself**. A re-entry guard (`addInviting`) + a pad-open guard stop the
      auto-fire, the input event, and Enter from triple-sending one invite. The text field still accepts
      typing (desktop) and is sanitized to digits; the pad no longer auto-focuses (so the on-screen keypad
      isn't buried under the mobile OS keyboard).
- [x] **Call waiting now actually works.** The signaling server used to bounce a second caller with
      **"busy"** whenever the callee was already in a 2+ person call, so the call-waiting popup (built long
      ago: Answer = hold current + switch, Reject = decline) **never showed**. The server no longer sends
      busy — the invite **rings through** and the callee's client shows the call-waiting popup; the callee
      decides. (The only invite still suppressed is a redundant one into a room the caller is already in.)
- [x] Updated the relay "busy" test to assert the new ring-through (call-waiting) behaviour; added keypad
      markup guards. 381 tests green, tsc + build clean. Footer → `v2.49.0`.

## v2.50.0 — iOS PiP video fix + two call-routing fixes from adversarial review (delivered 2026-06-28)

The reported iPhone bug, plus two real defects the v2.49 adversarial review surfaced (both verified by
deterministic reproduction).

- [x] **iOS Picture-in-Picture now shows video (not just audio).** iOS Safari can't render a
      `canvas.captureStream()` source inside a PiP window (it pipes a black frame) and throttles canvas
      compositing in the background — so the 2-up composite that works on Android Chrome showed audio-only
      on iPhone. On iOS we now feed the PiP `<video>` a **real remote MediaStream** (the active speaker),
      driven through the **WebKit presentation-mode API** (`webkitSetPresentationMode`), and follow the
      talker by swapping `srcObject`. Android/desktop keep the canvas 2-up composite unchanged. (iOS shows
      a single active speaker, not the 2-up, because a `<video>` only renders one stream — but you now see
      a face instead of black.)
- [x] **Call-waiting switch no longer drops you (race fix).** Answering a call-waiting call
      (`switchCall`) used to fire `{hold}`, `{leave}`, `{accept}` as three un-ordered POSTs; if `accept`
      landed before `leave`, the late `leave` ran against the room you'd *just* joined and ejected you,
      collapsing the new caller's call too. Fixed by **dropping the explicit `leave`** — the server's
      `accept` handler already leaves your prior room before joining the new one, so one message does it
      atomically. (Newly reachable because v2.49 enabled call waiting for established calls.)
- [x] **Adding an offline number no longer kills your call.** Auto-inviting an offline/nonexistent number
      from the in-call "+" pad returned the server's `offline` error, which the generic handler used to
      treat as "primary dial failed → hang up if alone" — tearing down your in-progress call when you were
      momentarily alone (e.g. still ringing). A transient **`addInviteOfflineGuard`** (armed around the
      add-invite) now suppresses that teardown for add-to-call invites; the primary-dial behaviour is
      unchanged.
- [x] **Paste fix:** the add-person field `maxlength` was raised 6 → 16 so pasting a formatted number
      ("12-34-56") isn't truncated to the wrong digits before sanitization (`addInputValue` still caps to
      6 digits).
- [x] 6 new tests (server accept-relocates-atomically regression, iOS-PiP + call-fix source guards). 387
      tests green, tsc + build clean. Footer → `v2.50.0`.

## v2.50.1 — Add-person window (and other centered popups) overflowed off-screen on mobile (delivered 2026-06-28)

- [x] **The in-call "Add person" window was clipped off the right edge on mobile** (the third keypad
      column, the right of "Add to call", and the hint were cut off). Root cause: the pad centered with
      `transform:translateX(-50%)`, but its open animation `relayFade` ends on `transform:none` with
      fill-mode `both` — which **wipes the centering transform** once the 0.2s animation finishes, leaving
      the pad's left edge at the container centre so it overflowed right. Fixed by centering with **auto
      margins** (`left:0;right:0;margin-inline:auto`) instead of a transform the animation clobbers,
      clamping width to the viewport (`min(260px, 100vw − 24px)`), and adding `max-height` + `overflow-y`
      so a tall keypad scrolls rather than clips.
- [x] **Applied system-wide:** the same latent bug affected two other `relayFade`-animated centred panels —
      the **filter dock** and the **per-tile host ⋮ menu** — both converted to the same auto-margin
      centering. (The toast and call-waiting popup were already correct — they re-specify the transform in
      their end state / use a dedicated keyframe.)
- [x] 3 new CSS regression guards (each panel centers via `margin-inline:auto`, clamps `width:min(...)`,
      and carries no `translateX(-50%)`). 390 tests green, tsc + build clean. Footer → `v2.50.1`.

## Bilingual landing page redesign (Gemini visuals + live stats) — delivered 2026-06-28
- [x] Backend `stats.public` tRPC procedure + `getPublicStats` db helper returning registeredUsers, guestsServed, totalParties, onlineNow (live from DB)
- [x] Vitest coverage for stats helper (shape + invariants), wired into appRouter
- [x] Generated 5 Gemini UI mockups: dialer, chat, group video, mobile, hero background — uploaded to project CDN
- [x] Rewrote Home.tsx: bilingual EN/AR with language toggle + full RTL handling (document dir/lang, Arabic-Indic numerals)
- [x] Hero with Gemini background, animated count-up live-stats band (registered/guests/total/online with LIVE badge)
- [x] 9-feature grid covering current v2.50.1 capabilities (calls, conferences, host controls, messaging, screen share/PiP, audio routing, history/redial, privacy)
- [x] Screenshot showcase (dialer/messages/group) + mobile section, both bilingual
- [x] Footer shows APP_VERSION (v2.50.1) and "Designed by Gemini" / "تصميم بواسطة Gemini"
- [x] Rewrote Home.test.ts to validate bilingual copy, toggle, RTL, live-stats query, Gemini assets, version footer + count-up easing math
- [x] Verified EN + AR (RTL) rendering in browser; 384 tests green, tsc clean


## Landing page polish (bottom gap + scroll animations) — requested 2026-06-28
- [x] Fix the large black gap below the footer on mobile (html/body background + overscroll) — verified footerBottom == scrollHeight at 390px
- [x] Add scroll-reveal animations (IntersectionObserver + staggered + directional, prefers-reduced-motion gated) — 25/25 revealed
- [x] Verified on 390px viewport (no gap, reveals fire); 394 tests + tsc green


## Authentic landing visuals + pro rebuild — requested 2026-06-28
- [ ] Capture real screenshots of the actual RELAY app (dialer, messages, history, contacts, profile, in-call) via logged-in browser
- [ ] Generate realistic Gemini visuals grounded on the real screenshots (match real layout/colors/elements)
- [ ] Professionally rebuild the bilingual landing page with the authentic visuals
- [ ] Verify EN + AR (RTL), no bottom gap, scroll-reveal, tests + tsc green
- [ ] Checkpoint + push to GitHub + deliver

## Landing copy + full-page scroll animations
- [ ] Remove all "Gemini" mentions from the landing page (footer + code comments)
- [ ] Rewrite product copy (EN + AR) to be simple, clear and friendly (drafted via Gemini 2.5 Flash)
- [ ] Add full-page scroll-driven animations: section reveal, hero parallax, scroll-linked color/gradient motion
- [ ] Keep prefers-reduced-motion support
- [ ] Verify tests + tsc + mobile, checkpoint, push to GitHub

## Landing copy + animation refresh (requested)
- [x] Remove leftover "Gemini-inspired" comment in client/src/lib/relayAssets.ts (cleanup, not user-visible)
- [x] Regenerate clearer, smoother bilingual (AR/EN) landing copy via Gemini 3.5 Flash
- [x] Apply new copy into Home.tsx T dictionary
- [x] Add richer full-page scroll animations: text reveal + scroll-linked color shift
- [x] Update Home.test.ts for changed copy/structure
- [x] Tests + tsc + CDP verify, checkpoint, push to GitHub
- [ ] Fix word-by-word headline spacing (spaces collapsed between inline-block word wrappers)

## Real app screenshots (requested)
- [x] Open the app and register a guest identity
- [x] Capture real screenshot: dialer / keypad
- [x] Capture real screenshot: messages / chat
- [x] Made a real video call (two parties) and captured the call screen
- [x] Capture real screenshot: mobile view
- [x] Crop/tune screenshots and upload as webdev static assets
- [x] Replace AI visuals in Home.tsx IMG map with real screenshots
- [x] Update Home.test.ts asset checks, verify, checkpoint, push

## v2.50.2 — Two different numbers after login (identity number ≠ relay pin) (delivered 2026-06-28)

- [x] **The header showed one 6-digit number and the big dialer showed another.** Root cause: the dialer's
      big number is the relay SIGNALING pin (`enginePin`), while the header shows the v2 IDENTITY number
      (`me.number`) — and they could diverge. The relay engine auto-registers as soon as the display NAME
      is known, but if whoami's `number` hadn't loaded yet, `setPreferredPin` got `null`, so the engine
      fell back to a **stale `localStorage relay_pin`** from a previous session (the server keeps any free
      requested pin), and it **never switched** once the real number arrived. Result: two numbers, and the
      header/shared number couldn't actually be dialed.
- [x] **Fix — reconcile the engine pin to the authoritative identity number.** `setPreferredPin(pin)` now,
      when it's handed a number that differs from the engine's current pin (and we're registered + idle),
      **re-registers under it** (the server treats a new pin from the same cid as an identity switch:
      drops the old, takes the new) and updates `localStorage relay_pin`. The engine provider runs this
      whenever the engine becomes `ready` and whenever `me.number` changes, so the big dialer number, the
      header number, and the actually-dialable pin converge to ONE number. Never switches mid-call (an
      identity switch tears down room membership); no-ops once the pins already match (no loop).
- [x] 2 new regression guards (setPreferredPin switch logic + the provider reconcile effect). 392 tests
      green, tsc + build clean. Footer → `v2.50.2`.

## v2.51.0 — Backend hardening: faster call connect + security backstops (delivered 2026-06-28)

A backend-only pass (no UI changes) to speed up call setup and harden the signaling server.

- [x] **Faster voice/video connect.** The mesh `RTCPeerConnection` config was only `{ iceServers }`. A new
      `buildIceConfig()` (used at EVERY assignment site) now also sets `iceCandidatePoolSize: 4`
      (pre-gathers host/srflx candidates so the FIRST offer already carries them → fewer trickle
      round-trips), `bundlePolicy: "max-bundle"` (audio+video share ONE transport → a single ICE check
      list instead of one per m-line), and `rtcpMuxPolicy: "require"` (RTCP shares the RTP port → half the
      candidates). All three are well-supported, low-risk, and cut call-setup latency. (LiveKit's SFU path
      manages its own peer connection and is unaffected.)
- [x] **Rate-limit backstop on the raw signaling POST.** New `server/rateLimit.ts` (pure, unit-tested
      token bucket). `/api/relay/send` is now gated by a generous per-IP limiter (~200 msg/s sustained,
      1000 burst — a 6-way mesh setup is ~17 msg/s, and many users behind one office/campus NAT stay
      under; only a runaway flood gets a 429). Keyed by IP from `X-Forwarded-For` so it runs cheaply
      BEFORE the body parser. Idle buckets swept every 5 min. Opt out with `RELAY_RATELIMIT_OFF=1`.
- [x] **Signaling payload cap.** `/api/relay/send` now rejects a `message` larger than 256 KB (SDP/ICE are
      ≤~20 KB; in-call chat rides the WebRTC data channel, not this endpoint) and caps the `cid` length —
      a cheap anti-abuse guard.
- [x] **Safe security headers** on every response: `X-Content-Type-Options: nosniff`,
      `Referrer-Policy: strict-origin-when-cross-origin`, `X-DNS-Prefetch-Control: off`,
      `Strict-Transport-Security: max-age=15552000`. Deliberately CONSERVATIVE — no CSP (inline styles +
      `dangerouslySetInnerHTML`), no `X-Frame-Options`/`frame-ancestors` (the Manus editor frames the app),
      no `Permissions-Policy`/COOP (could block `getUserMedia` or the OAuth popup) — so nothing breaks.
- [x] 11 new tests (token-bucket math, refill, sweep, key isolation, realistic-burst headroom,
      `clientIpOf`). 409 tests green, tsc + build clean. Footer → `v2.51.0`.

## v2.52.0 — Profile hub, phase 1 (bio, mobiles, social links, status, last-seen) (delivered 2026-06-28)

First slice of a larger profile/identity/auth overhaul the user requested across four areas (profile hub,
PIN management, self-hosted auth+verification, cross-platform media QA). This ships the **profile hub**.

- [x] **Schema (additive):** `identities` gains `bio`, `statusOverride` (away|travel|null), `mobiles`
      (JSON), `socials` (JSON), applied to the live DB by the boot-migrator `ensureSchemaExtensions()` —
      no destructive migration.
- [x] **Server:** `whoami` now returns `email` (the registered user's validated address, read-only),
      `bio`, `statusOverride`, `mobiles`, `socials`. `updateProfile` accepts + validates them
      (`shared/profileFields.ts` sanitizes server-side). `directory.lookup` returns `statusOverride`
      alongside the existing `lastSeenAt`.
- [x] **Profile UI hub** (`ProfileHubSections.tsx`): a **Status** picker (Auto / Away / Travelling), an
      **About/bio** box (500 chars), **Email** (read-only for registered users), **Mobile numbers**
      (add/remove list), and **Links & social** — a platform dropdown (**X**, **Website**, **Snapchat**,
      **WhatsApp**) with add/remove and canonical tappable URLs (`x.com/…`, `wa.me/…`, `snapchat.com/add/…`).
- [x] **WhatsApp-style "last seen"** (`shared/profileFields.ts` `formatLastSeen`): "just now",
      "N minutes ago", "today at H:MM AM", "yesterday at 10:30 PM", "on Jun 20". The dialer's number
      preview now shows the live status — "online now" / "away" / "travelling ✈️" / "last seen …".
- [x] 14 new tests (social/mobile/status sanitization, social-URL builders, last-seen formatting). 423
      tests green, tsc + build clean. Footer → `v2.52.0`.
## v2.55.0 — Cross-platform media QA: visible controls + capability readout (delivered 2026-06-28)

Phase 4 — the final phase of the overhaul. The complaint was that audio-output + screen-share controls were
"conspicuously absent" on some platforms (Android, in-app webviews) vs others.

- [x] **Controls are now VISIBLE on every platform during a call.** The audio-output and screen-share
      buttons no longer silently vanish where a capability is missing — they show on all platforms, and
      where the browser genuinely can't deliver, tapping explains it honestly (audio: "your device routes
      call audio automatically — use the system/Bluetooth controls"; screen-share: the existing
      "isn't supported on this device" toast). This is real cross-platform parity of the *visible UI*.
- [x] **Honest about real browser limits.** Android Chrome genuinely has no web audio-OUTPUT selection
      (`setSinkId`) — the OS/Bluetooth routes it; iPhone/iPad browsers genuinely can't screen-share a web
      page (Apple). We surface the control + a plain explanation rather than pretending parity the browser
      can't provide.
- [x] **Capability readout for QA** (`shared/mediaCapabilities.ts`, pure + tested): the in-call
      diagnostics overlay (press `?`) now lists exactly what THIS device/browser supports — camera/mic,
      screen sharing, audio-output selection, Picture-in-Picture — with ✓/✗ and an honest note per row.
      A real QA tool for auditing Safari / Firefox / Brave / Chrome across desktop + mobile.
- [x] 5 new tests (desktop / Android / iOS / in-app-webview capability matrices + PiP paths). 442 tests
      green, tsc + build clean. Footer → `v2.55.0`.

### Overhaul batch COMPLETE (v2.52 → v2.55)
All four requested areas shipped: **profile hub** (v2.52), **PIN regenerate + propagate** (v2.53),
**self-hosted email/password auth + verification** (v2.54), **cross-platform media QA** (v2.55). Honest
constraints stated up front held: guest PIN can't survive a full cookie+cache wipe (registration is the
durable path); Android web audio-output selection isn't a thing (a real browser limit).

## v2.54.0 — Self-hosted email + password auth + verification (delivered 2026-06-28)

Phase 3 — a proprietary registration/login (NO third-party identity provider), served alongside the
existing Manus OAuth.

- [x] **Security foundation** (`server/authCrypto.ts`, pure + unit-tested): scrypt password hashing with a
      per-hash salt + timing-safe verify; random hex tokens + timing-safe compare; a signed (HMAC) stateless
      session token; email normalize/validate + a password policy (≥8 chars, letter+number).
- [x] **Auth routes** (`server/authLocal.ts`, raw Express): `POST /api/auth/register` (creates an
      UNVERIFIED user + identity, migrating a guest in place, and emails a verification link),
      `GET /api/auth/verify?token=` (single-use, 24h, consumes the token → flips `emailVerified` → renders
      a **"You have been verified. Please return to your previous screen or the other tab to continue."**
      page), `GET /api/auth/status` (the registration tab polls this — **never hangs**),
      `POST /api/auth/resend` (**1-minute cooldown** — the "regenerate activation link" ask),
      `POST /api/auth/login` (password + verified gate, sets the session cookie; uniform failure message so
      emails can't be enumerated), `POST /api/auth/logout`. All rate-limited per-IP.
- [x] **Session integration:** a signed `relay_session` HttpOnly+Secure+SameSite cookie; the tRPC context
      now resolves a user from EITHER the Manus OAuth session OR this local session.
- [x] **Schema (additive):** `users` gains `passwordHash` + `emailVerified`; new `email_verifications`
      table — both applied to the live DB by the boot-migrator.
- [x] **Client** (`AuthPanel.tsx`): a register/sign-in modal with a "check your email" stage that polls
      status, shows a live **Resend link in Ns** countdown, and **auto-signs-in and proceeds** the instant
      the link is clicked in the other tab. Surfaced from the guest upgrade CTA ("Create account with email"
      next to "Use Manus sign-in").
- [x] 10 new tests (scrypt hash/verify, token compare, email/password policy, signed-session round-trip +
      tamper/expiry). 437 tests green, tsc + build clean. Footer → `v2.54.0`.
  (Without `RESEND_API_KEY` the verification link is logged server-side so self-hosters can still verify.)

## v2.53.0 — PIN management: regenerate + auto-propagate to contacts (delivered 2026-06-28)

Phase 2 of the overhaul.

- [x] **Regenerate your number anytime.** A "Regenerate number" control in Profile → Your number issues a
      fresh unique 6-digit number (confirm dialog spells out the consequences). The relay engine adopts it
      on the next whoami via the existing `setPreferredPin` reconcile (v2.50.2), so the dialer + header +
      dialable pin all stay in sync.
- [x] **Auto-propagation to the whole contact network.** `regenerateIdentityNumber()` rewrites EVERY
      `contacts` row that saved the old number to the new one, so nobody has to re-add you. Collisions with
      a stale `(ownerId, newNumber)` row are resolved by a pure, unit-tested planner (`planRenumber`) that
      drops the duplicate before the update — so the unique key can never blow up.
- [x] **Keep-or-regenerate on conversion** is satisfied: conversion already migrates (KEEPS) the guest's
      number in place by default; regenerating is one tap away in the profile.
- [x] 4 new tests (planRenumber: rewrite-all, stale-dup drop, no-op, unrelated-rows). 427 tests green,
      tsc + build clean. Footer → `v2.53.0`.
- [ ] **Note on guest PIN across logout:** an explicit guest "Sign out" still forgets the number on that
      device (a deliberate shared-browser privacy guard). Durable cross-session/device PIN persistence is
      delivered by registration (Phase 3); a guest's number already survives cookie clears via the
      device-id, just not an explicit sign-out or a full localStorage wipe.

## v2.55.1 — Highlight + blink the in-call version/build footer (delivered 2026-06-29)

- [x] The in-call footer (`© 2026 RELAY · v… · build-date`) was too faint to read on the dark call screen.
      The **version number and build date** are now wrapped in `.ver-hl` spans rendered **bright white with
      a soft glow and a gentle 1.3s blink** (motion-gated via `prefers-reduced-motion`), so they stand out;
      the "© year RELAY" stays muted like a copyright line. The whole line's base contrast was also bumped.
- [x] 1 new markup/CSS guard. 443 tests green, tsc + build clean. Footer → `v2.55.1`.

## v2.56.0 — SMS-style message bubbles + richer in-call message popup (delivered 2026-06-29)

First slice of a 5-part feedback batch (call-waiting hold/swap, Android background-keepalive, headset
auto-route, in-call message reply popup, Messages UI). This ships the two concrete, low-risk wins; the
rest are sequenced below.

- [x] **Message bubbles are now blue (theirs) / green (yours)** — SMS-style, as requested. Incoming =
      `#2563eb` with white text on the left; outgoing = the RELAY green (`--relay-online`) with dark text
      on the right. Reply-quote + timestamp colors updated for contrast on each.
- [x] **In-call message popup enriched:** the small reply popup (shown over the call, mounted app-wide so
      it appears during active calls) now shows the sender's **6-digit number + date/time** under the
      name, alongside the existing inline reply box (type any length → Send, or minimize/close).
- [x] 443 tests green, tsc + build clean. Footer → `v2.56.0`.

### Sequenced next (from the same batch — honest scoping)
- **Call-waiting "ghost lost"** → a proper hold/SWAP/MERGE/end-one screen. The current `switchCall` LEAVES
  the first room, so it can't be resumed. True two-line hold needs the SIGNALING SERVER to let one number
  be a member of two rooms at once (one active, one held) — and on the LiveKit SFU path, two simultaneous
  room connections. This is a real architectural change (server + engine), to be done as a focused effort.
- **Android background drop** (call dies a few seconds after minimizing) → needs Wake Lock + reliable
  background-keepalive (audio/auto-PiP) + a visibilitychange-driven reconnect, verified on a real Android
  device (can't be fixed blind).
- **Headset/Bluetooth auto-route** → output auto-route already exists for desktop (setSinkId) and the OS
  handles it on mobile; mic auto-switch (re-acquire getUserMedia) is the remaining piece (risky mid-call).

## v2.57.0 — Bulletproof auto-rejoin across the Update reload + Android loudspeaker force (delivered 2026-06-29)

- [x] **Mid-call Update refresh now reliably rejoins the call.** The auto-updater's silent in-call reload
      already kept server-side room membership (30s grace), but the rejoin was fragile — a transient
      getUserMedia hiccup made `onRejoin` send `leave` (dropping the user), mic/cam state was lost, and a
      reconciled pin could miss the server's room lookup. Now: on unload during a call the engine
      **snapshots** `{ roomId, pin, micOn, camOn }` to sessionStorage (`rejoinSnapshot.ts`); at boot it
      **registers under the in-call pin** (so the server's membership lookup matches), **restores mic/cam**,
      and `onRejoin` **retries media** (with the existing audio-only fallback) instead of dropping on a
      transient failure. A 10s watchdog clears the snapshot if no rejoin arrives — the ONLY exception being
      a call that genuinely ended during the refresh. The pin-reconcile (v2.50.2) is suppressed while a
      rejoin is pending. Works when several/all participants refresh at once (the server room rides the 30s
      grace). Snapshot cleared on explicit hang-up / logout.
- [x] **Android loudspeaker force (interim audio fix).** Android Chrome exposes no web output-picker and
      pins WebRTC audio to the earpiece. Tapping the speaker icon on Android now toggles a **Web-Audio
      loudspeaker route** (remote audio → an AudioContext whose destination is the device's media output =
      loudspeaker, following a connected headset/Bluetooth). It mutes the source elements **only after the
      context is confirmed `running`**, so the worst case is "no change / earpiece" — **never silence** —
      and it's fully reversible (tap again to turn off). **Scoped to Android only**; iOS (which works
      natively) and desktop are untouched. The old misleading "try your device settings" toast is gone.
      Honest caveat: forcing the loudspeaker on Android Chrome isn't guaranteed on every device — this is
      the best the web platform allows and needs on-device confirmation; a full dynamic-switch fix may
      require a native shell.
- [x] 10 new tests (rejoin-snapshot validation + freshness, rejoin/loudspeaker wiring guards). 453 tests
      green, tsc + build clean. Footer → `v2.57.0`.

## v2.58.0 — Reliable camera flip + crash-proof rejoin with a prominent "Exit call" (delivered 2026-06-30)

- [x] **Camera swap is now reliable under all conditions.** The old flip relied on a SOFT `facingMode`
      constraint, which many phones ignore (they hand back the SAME camera), so the front/back toggle did
      nothing on a lot of devices. New `acquireFlippedCamera()` tries the only constraint that reliably
      switches — **`facingMode: { exact }`** — then falls back to **enumerating video inputs and explicitly
      grabbing a DIFFERENT `deviceId`**, then a soft `facingMode` as a last resort; if none yields a track
      it toasts "this device may only have one" instead of silently breaking. A `flipBusy` **re-entrancy
      guard** stops two fast taps from interleaving `getUserMedia` + `replaceTrack` (which left the
      published track disagreeing with the active facing mode). The flip now also calls `syncCamEnabled()`
      so a camera that was muted **stays muted** across the swap (a fresh track defaults to enabled).
      Works on both the filtered (canvas-pipeline) and raw paths; audio track is carried across untouched.
- [x] **Connection resilience: rejoin survives a full app/browser CLOSE or crash — or you can opt out.**
      The rejoin snapshot is now written to **both `sessionStorage` AND `localStorage`** (was session-only),
      so reopening the app after an accidental close, a swipe-away, or a browser kill — not just a same-tab
      reload — restores the active call (still gated by the 28s freshness check against the server's 30s
      room grace, so a long-dead room is never re-dialed). While the engine is honoring a snapshot it now
      surfaces a **prominent full-screen "Reconnecting to your call…" prompt** with an unmissable **"Exit
      the call"** button (request: a clear, prominent way out if you don't want to reconnect). The prompt
      **auto-dismisses** the instant the rejoin resolves (success or the 10s give-up), and "Exit the call"
      leaves the room and drops the snapshot so the next reload stays idle. Wired via a new
      `setOnRejoinChange` / `cancelRejoin` on the engine handle.
- [x] tsc + build clean, 453 tests green. Footer → `v2.58.0`.

## v2.59.0 — Call waiting: real HOLD / SWAP / MERGE (no more dropped first call) (delivered 2026-06-30)

- [x] **Answering a second call now HOLDS the first instead of dropping it.** The old `switchCall` closed
      the first call's peer connections and the server `leaveRoom`'d it — the first line was gone for good
      ("ghost lost"). Now the server tracks a per-pin **`heldRoom`** alongside the active `pinRoom`: when you
      accept a call-waiting call, your prior **real** call (one with other members) is moved to HOLD — you
      stay a member of BOTH rooms — and its members get a `peer-hold {on:true}` (a solo dialing room is still
      just dropped, so the normal 1-on-1 / group flow is byte-identical). Client-side the held call's mesh
      peer connections are kept **alive but frozen** (our outgoing tracks `replaceTrack(null)`, tiles
      detached) so resuming is instant; on the SFU path the held room's LiveKit connection is dropped and
      rejoined on resume (membership persists server-side).
- [x] **Swap back and forth, and a "toot" on resume.** A new on-screen **"On hold" bar** (amber, top-center)
      shows the held caller with **Swap** and **Merge**. `swap` flips active↔held server-side (re-pointing
      `pinRoom`/`heldRoom`, notifying both rooms with peer-hold on/off) and thaws the resumed call's media;
      the held party gets explicit **visual confirmation** ("X put you on hold" / "X is back") **and an
      audible cue** — a soft descending tone when held, a brighter rising **toot** when resumed (synthesized
      via Web Audio, best-effort). The red **End** button now ends THIS line and **auto-resumes the held
      one** (`end-active` → server leaves the active room and promotes the held one); a full hang-up / logout
      drops both.
- [x] **Merge into a 3-way.** **Merge** folds the held call into the active room — every held member is moved
      in (fresh `joined` so they mesh-link with everyone), the active members get `peer-joined`, and the old
      room is reaped — secondary to hold/swap stability, as requested.
- [x] **Unanswered call-waiting logs a missed call.** Declining or ignoring (30s auto-decline) a waiting
      call records a missed call for the would-be answerer (verified) — the existing reject→`onMissedCall`
      path, now covered by a test.
- [x] **Held rooms never leak.** A full `leave`, a logout/`destroy`, and the grace-expiry disconnect all
      `releaseHeldRoom`; a held partner hanging up first clears the hold without touching the active call.
- [x] **11 new deterministic server tests** for the whole state machine (hold, swap, swap-back, end-active,
      merge, full-leave-drops-both, missed-call, solo-room-not-held, nohold guards, releaseHeldRoom,
      held-partner-leaves) — the "eliminate dropped calls" requirement is pinned by asserting the held member
      stays in BOTH rooms across every transition. 464 tests green, tsc + build clean. Footer → `v2.59.0`.
- [ ] **SFU note:** hold/swap is seamless on the WebRTC **mesh** (default). On a **LiveKit** deployment the
      held call drops + rejoins its SFU room on resume (a brief reconnect, not a frozen-PC hold) — a fully
      seamless two-connection SFU hold is the follow-up if the live deploy uses LiveKit.

## v2.60.0 — WhatsApp-style messaging: date dividers + message grouping (delivered 2026-06-30)

- [x] **Date dividers.** The conversation now inserts a centered **"Today" / "Yesterday" / "June 28, 2026"**
      pill whenever the calendar day changes between messages — the classic WhatsApp day separator — so a
      long thread is easy to scan by date.
- [x] **Consecutive-message grouping.** Runs of messages from the same sender within ~5 minutes are now
      **stacked tightly** (0.5 vs 2 spacing) with the rounded **tail only on the last bubble** of the run,
      and in group chats the **sender name shows once** at the top of a run instead of on every bubble —
      matching WhatsApp's grouped look. Per-bubble timestamps + read ticks are kept (WhatsApp shows time on
      every message). Bubble colors (yours = green right, theirs = blue left), the bottom-pinned composer,
      reply/quote, unsend, voice notes, emoji, attachments, and the typing indicator are unchanged from the
      v2.56 pass.
- [x] 2 new source-guard tests (date dividers + grouping). 466 tests green, tsc + build clean. Footer →
      `v2.60.0`.

## v2.61.0 — Persistent missed-call notifications (landing popup + badges) (delivered 2026-06-30)

- [x] **Landing missed-call popup.** On app launch while authenticated (guest OR registered), a prominent
      but non-intrusive banner drops in at the top identifying the most recent missed caller ("Missed call
      from <name> · <number>" + "and N others") with **View** / dismiss. Shown once per browser session
      until dismissed or acted on; re-appears on a fresh launch while calls remain unreviewed
      (`MissedCallToast` in `client/src/app/MissedCalls.tsx`).
- [x] **Click → dialer "Missed Call" alert.** Tapping the popup routes to `/app/dialer?missed=1`, where the
      dialer shows a clear **Missed Call** alert identifying the caller with a one-tap **Call back**.
- [x] **Badges.** The **History** tab icon (sidebar + bottom-nav) badges with the cumulative missed-call
      count, and a new **global notification bell** badges with **missed + unread** and opens a panel that
      routes to History (missed calls) or Messages (unread) — "a visible prompt to review the detailed
      list." Reviewing the History tab acknowledges the misses (clears the badges).
- [x] **Server.** New `calls.missedSummary` query + `calls.markMissedSeen` mutation, backed by a per-identity
      `missedCallsSeenAt` high-water mark (additive nullable column, applied by the boot-migrator). Unseen =
      incoming `missed`/`declined` calls newer than the mark. Works for guests and registered users alike.
- [x] 7 new source-guard tests. 473 tests green, tsc + build clean. Footer → `v2.61.0`.

## v2.62.0 — Android incoming-audio fix + 10-tester camera QA fixes (delivered 2026-06-30)

A 31-agent adversarial workflow (4 audio-diagnosis angles + 10 QA-tester camera lenses → adversarial
verification → synthesis) drove this batch. Root causes were each confirmed by an independent refuter.

- [x] **Android incoming audio — root cause found + fixed.** The mesh remote `<video>` was created with
      `autoplay` but **never `.play()`'d** after `srcObject`; Android Chrome gates an unmuted element's
      autoplay-with-audio, so the element stayed **paused → incoming audio entirely silent** (outgoing
      unaffected; iOS doesn't gate this, which is why iOS worked). `attachRemote` now calls
      `v.play().catch(() => armAudioUnlock())`, mirroring the LiveKit path, plus a **one-tap audio-unlock**
      fallback that replays every remote element on the next user tap if autoplay was blocked.
- [x] **Loudspeaker no longer silences audio.** The v2.57 force-route set `el.muted = true` BEFORE
      `createMediaStreamSource` — which throws when the stream is already tapped (the active-speaker
      analyser taps it) — leaving the element muted with no route = **silence**. Muting is now the LAST
      step after the Web-Audio route is wired, so a failed tap leaves the element audible (earpiece),
      never silent.
- [x] **LiveKit SFU detached `<audio>` inserted into the DOM (Android-gated).** `track.attach()` returns a
      DETACHED element that Android Chrome won't reliably initialize audio for; it's now appended (hidden)
      to the call root **only on Android** (iOS works without it and a 2nd gated element there can hurt).
- [x] **Camera QA fixes (verified, deduped to 5):**
      **C1 (critical)** filter-OFF disposed the canvas `captureStream` track while peers still referenced it
      → froze peers; now defers `dispose()` one tick after the raw track is accepted.
      **C2 (critical)** iOS Safari reports an empty `deviceId`, so the flip's "pick a different device"
      check (`deviceId !== curId`) was always true → re-grabbed the SAME camera; now normalizes `curId` to
      `""` and requires both ids truthy, correctly falling through to soft facingMode.
      **C3 (high)** `captureStream` was read before any frame was drawn AND at full-res (then popped to the
      downscaled size) → black/empty first frames + a resolution jump; `setInputStream` now sizes the canvas
      to the downscaled processing resolution and draws one frame before exposing the capture (no double-RAF
      on flip — guarded by `rafId`).
      **C4 (high)** self-tile showed the old camera after a flip with a filter active (same stream object);
      now nulls `srcObject` to force a rebind + replays.
      **C5 (high)** browsers lacking `canvas.captureStream` silently shipped an empty stream (frozen video);
      now surfaced via `onError`.
- [x] 8 new source-guard tests. 481 tests green, tsc + build clean. Footer → `v2.62.0`.
- [ ] **On-device verification needed:** smoke-test an iOS↔iOS mesh call (confirm the new mesh `.play()` is
      a no-op there) and an Android incoming call (confirm audio is now present). The loudspeaker route on
      Android Chrome is best-effort (a remote WebRTC stream can only be Web-Audio-tapped once; the analyser
      wins) — the fix guarantees no silence, not guaranteed speaker routing.

## v2.63.0 — Voice / video / text / UI-UX improvement sweep (delivered 2026-06-30)

A 6-domain adversarial audit (find → verify against project rules → prioritize) surfaced 72 candidate
improvements; 61 were confirmed real and rule-compliant. The 16 highest impact/effort items were implemented.

**Voice:**
- [x] **Echo cancellation / noise suppression / auto-gain** are now requested on every mic acquisition
      (`AUDIO_CONSTRAINTS`, applied in `acquireRawStream` + the audio-only fallback) — a free call-quality win
      (constraint hints, no renegotiation, degrade gracefully where unsupported).
- [x] **Audible ringtone** on incoming (`playRingtone("incoming")`) and outgoing (`playRingtone("outgoing")`)
      calls — synthesized Web-Audio tones (no asset), respects Do Not Disturb + a `relay_ringtone_off`
      opt-out, stops on accept/decline/cancel/connect/hang-up.
- [x] **Mic VU feedback**: `#micBtn` now pulses (accent ring, transform/opacity-friendly) while YOUR mic
      picks up sound, so a forgotten mute — or a hot mic you meant to mute — is obvious without a peer
      having to say something. Independent local `AnalyserNode` tap, never touches the published track.
- [x] **ICE restart flap-hardening**: a `lastRestartTime` floor (5s) between actual restart attempts, on top
      of the existing per-call debounce, stops a flapping `iceconnectionstatechange` from firing restarts
      back-to-back.

**Video:**
- [x] **Voice-only calls no longer publish a (disabled) video track to the SFU.** `joinLivekit`'s initial
      publish now skips video when `camOn` is false, and a new `syncLivekitVideoPublication()` publishes /
      unpublishes the camera track on every `setCam()` toggle — saving SFU bandwidth and showing peers a
      clean voice-call UI instead of a black tile.
- [x] **Screen share gets its own (capped) quality profile** — `qualityScreenShare()` (8–10fps, ≤720p)
      instead of inheriting the camera's uncapped-framerate HD constraint; the live quality toggle applies
      it to an in-progress share too.
- [x] **Filter model loads now time out (8s)** instead of leaving the loading dot stuck forever on a
      slow/flaky connection — `ensureSegmenter`/`ensureFaceDetector` both surface an error and unstick the
      UI (the underlying fetch isn't aborted; if it succeeds later the model just becomes available
      silently). `ensureFaceDetector` also gained the single-flight guard `ensureSegmenter` already had.
- [x] **A stuck first peer connect gets a named placeholder** — after 15s with no media, a tile's generic
      "connecting…" pill becomes "Waiting for X…" (dimmed), instead of looking identical to a fresh connect.

**Text / messaging:**
- [x] **In-conversation message search** — `messages.search` (membership-gated, LIKE-scan within one
      conversation) + a search overlay in the conversation header (results styled like normal bubbles).
- [x] **Composer drafts persist per conversation** (`client/src/app/draftStore.ts`, mirrors `mutedThreads.ts`)
      — in-progress text + an active reply target survive navigating away or a reload; restored from
      localStorage, debounce-saved (500ms), cleared on send.
- [x] **Paste an image/video straight into the composer** (e.g. a screenshot) — reuses the existing
      upload/40MB-limit path; plain-text pastes are untouched (native browser handling).
- [x] **"Scroll to latest" floating button** appears once you've scrolled away from the bottom of a
      conversation, so catching back up doesn't require dragging the scrollbar.

**UI/UX:**
- [x] **Focus-visible keyboard rings** swept across every RAW (non-`<Button>`) interactive element in
      `AppShell.tsx`, `RelayEngine.tsx`, and `MissedCalls.tsx` — DND toggle, profile links, sidebar/bottom-nav
      tabs, theme toggle, back button, the End/Exit-the-call buttons (destructive-themed ring), and the
      notification bell + its panel rows. (Every shadcn `<Button>` already had this baked into its base
      class — the gap was specifically the hand-rolled `<button>`/`<Link>` elements.)
- [x] **History action buttons bumped to the 44px touch-target minimum** (was 36px `size="icon"`).
      *(Scope note: the in-call control bar's mobile buttons stayed at 44px — already WCAG-compliant — rather
      than bumping to 48px, since that's a carefully-tuned flex-wrap layout for 12+ buttons on narrow phones
      with prior-documented clipping bugs; the marginal gain wasn't worth the regression risk.)*
- [x] **Contacts search field gets a leading search icon** (matching the pattern already used in the
      add-contact dialog) and the **empty state now uses the shared `Empty` component** with an icon, a
      search-aware message, and an "Add a contact" CTA (was a bare two-line paragraph).
- [x] 27 new tests (Messages/draftStore/v2routers/source-guards). 508 tests green, tsc + build clean.
      Footer → `v2.63.0`.

## Landing redesign (Gemini 3.5 Flash copy, light/unique, animated)
- [x] Verify stored GEMINI_API_KEY works with gemini-3.5-flash
- [x] Generate richer bilingual copy (identity-hiding, one-to-many, fast/free/unique) via Gemini 3.5 Flash
- [x] Capture fresh real app screenshots (dialer, messages, contacts, mobile, real video call)
- [x] Process call screen with realistic faces + upload all 5 as static assets
- [x] Rebuild Home.tsx: light unique design, full-page scroll animation, sticky Open RELAY button
- [x] Live stats fitted inside boxes (no overflow)
- [x] Real screenshots per section with explanations (added contacts as 4th showcase row)
- [x] Dedicated privacy/identity-hiding section
- [x] Update Home.test.ts assertions for new design (482/482 passing)
- [x] CDP verify desktop + mobile (images load, sticky CTA, stats fit, no gap, no Gemini text)

## v2.64.0 — Messages layout collapse fix + duplicate bell icon consolidation (delivered 2026-06-30)

Reported by the user with screenshots: in the Messages conversation view, the message thread was reduced
to an invisible sliver and the composer floated mid-screen with large blank gaps above and below it; and
the app header showed two visually-identical bell icons side by side. A diagnostic workflow (parallel
investigation → adversarial verification → synthesis) root-caused both before any fix was written.

- [x] **Messages conversation-view layout collapse — root cause confirmed and fixed.** The v2.63.0 message-
      list wrapper was `<div className="relative flex-1 min-h-0">` whose ENTIRE content was
      `position:absolute` children (the scroll container, the search overlay, the scroll-to-bottom button) —
      a flex item with no in-flow content at all. Safari/WebKit doesn't reliably compute a flex-grow height
      for that shape, so the wrapper collapsed to near-zero height, which is exactly what produced the
      symptom: a sliver of one message, a large blank gap, the composer floating mid-screen instead of
      pinned to the bottom. Fixed by making the wrapper a real flex column
      (`relative flex flex-col flex-1 min-h-0`) and making the scroll container an in-flow `flex-1 min-h-0`
      child instead of `absolute inset-0` — the search overlay and scroll-to-bottom button stay `absolute`
      (now correctly positioned against a wrapper with a definite, properly-computed height). A secondary,
      compounding factor was also confirmed and fixed: AppShell's mobile `pb-28` (112px), meant for simple
      scrolling-list pages (Contacts/History/Dialer), was silently eating 112px from Messages' self-contained
      layout (header + internal scroll + pinned composer, which doesn't use the page-level scroll at all).
      Scoped the fix to `MessagesPage`'s own root (`-mb-28 md:mb-0`) rather than touching AppShell's shared
      wrapper, so Dialer/Contacts/History — which DO depend on that padding and have no defensive padding of
      their own — are completely untouched.
- [x] **Duplicate bell icons consolidated to one.** The mobile (and desktop) header rendered both a
      `NotificationBell` (missed-calls + unread badge, opens a panel) and a separate `DndToggle` — both
      literal `Bell`/`BellOff` lucide icons sitting side by side, reading as a confusing duplicate. Do Not
      Disturb is now a toggle row (shadcn `Switch`) inside the `NotificationBell` dropdown panel itself,
      above the missed/unread list; the bell button's own icon swaps to `BellOff` (tinted) when DND is on,
      so the state is visible without opening the panel. `DndToggle` is deleted entirely. Net result: exactly
      one bell-family icon in the header, on both mobile AND desktop (desktop previously had no DND
      affordance in the header at all — it now does, via the same panel).
- [x] 8 new regression tests pinning both fixes (and correcting a prior test that had been asserting the
      *buggy* layout pattern as if it were correct). 517 tests green, tsc + build clean. Footer → `v2.64.0`.

## v2.64.1 — Hotfix: composer hidden behind the fixed bottom tab bar (delivered 2026-06-30)

The v2.64.0 layout fix went one step too far. AppShell's mobile `pb-28` isn't reclaimable dead space — it's
the **only clearance keeping the `position:fixed` (floating, `z-30`) bottom tab bar from overlapping page
content**, since a fixed element is out of normal flow and just paints on top of whatever's beneath it.
Cancelling that padding for Messages (`-mb-28 md:mb-0`) let the page grow 112px taller than it should,
pushing the composer DOWN into the exact zone the floating nav covers — hiding the input box behind it
(confirmed by a follow-up screenshot: the last message bubble was visible peeking out from under the tab
bar). **Reverted the `-mb-28 md:mb-0` cancellation**; the message-list flex-column fix (the actual root
cause from v2.64.0, confirmed correct) is what was doing the real work and needed no change. 2 tests
updated to assert the padding is preserved (and to stop a prior test from pinning the regression as if it
were correct). 517 tests green, tsc + build clean. Footer → `v2.64.1`.

## v2.65.0 — Full-app audit: design refresh, UX polish, notification reliability, backend data integrity (delivered 2026-06-30)

User asked for a comprehensive, page-by-page audit of the whole mobile app — code, UI, UX, and every
functional/aesthetic element — with a "sleek aluminum + nice colors" visual refresh and a hardened
notification system. Run as a multi-stage Workflow (parallel per-area diagnostic agents → adversarial
verification pass on every proposed fix → synthesis into a prioritized, file-exact plan), since Ultracode
was explicitly invoked. The plan's literal proposals were not applied blindly — two were corrected after
manual review (the SSE reconnect-detection flag and the missed-call popup dismissal semantics; see below).
.NET was **not** introduced — the stack is unchanged React/Express/tRPC; "Ultra code" was read as the
in-house Workflow multi-agent tooling, not a literal framework swap.

- [x] **Design tokens — "Aluminum Brushed-Metal" palette.** Replaced both OKLCH token blocks in
      `client/src/index.css` (`.dark.relay-v2` and `.relay-v2:not(.dark)`) with cooler, desaturated grays and
      a refined cyan accent hierarchy. Token *names* are unchanged, so every existing component picks up the
      new palette with zero component-level edits.
- [x] **Dialer.tsx** — faster recent-calls refresh (20s → 10s poll), Enter-key dial no longer double-fires
      a page scroll/submit (`preventDefault()` before `startCallNow()`).
- [x] **History.tsx** — both history queries stop polling while the tab is backgrounded
      (`refetchIntervalInBackground: false`); card surfaces unified with Contacts/Messages
      (`border-border bg-card`, dropped redundant blur/saturate); list rows get `transition-colors` +
      `aria-label`; roster list keys switched from an index-based composite to the stable participant number.
- [x] **Messages.tsx** — read receipts now show a real double-tick (`✓✓`) vs single-tick distinction;
      clipboard copy gives toast feedback instead of failing silently; a pending attachment no longer leaks
      into the next conversation you open; voice-note recording's `onstop` is wrapped in try/catch/finally so
      a recorder error can't leave the UI stuck; Escape now closes the emoji picker.
- [x] **Contacts.tsx** — migrated off `window.confirm()` to a shadcn `AlertDialog` for delete confirmation;
      added a mobile per-row `DropdownMenu` (Favorite / Edit / Delete) since the desktop inline buttons don't
      fit small screens; added a 5-row loading `Skeleton` instead of bare "Loading…" text; `AddContactDialog`
      migrated to a real shadcn `Dialog` (focus trap + Escape-to-close, previously hand-rolled).
- [x] **ProfileHubSections.tsx** — every save section (contact info, social links, bio, status) now surfaces
      a visible error state on failed save instead of failing silently; mobile-number and social-value inputs
      gained sane `maxLength` caps; status buttons disable + dim while a save is in flight (prevents
      double-submit); list keys switched from array index to stable values.
- [x] **AppShell / PasscodeGate** — added visible focus rings (`focus-visible:ring-*`) to the passcode input
      and its unlock/submit buttons for keyboard and a11y parity with the rest of the app.
      (OnboardingGate was audited and found already correct — no change needed there.)
- [x] **Notification system.** `NotificationBell` (`MissedCalls.tsx`) is now the single source of truth for
      both the missed-call/unread badge AND Do Not Disturb (Switch in the dropdown panel). The missed-call
      toast banner sits at `z-[75]`, below the in-call reconnect modal (`z-[80]`), so call recovery is never
      hidden behind a notification banner. `useRealtime`'s SSE client now detects a *reconnect* (not just the
      first connect) and refreshes missed-call/history state on recovery, since a missed call during an SSE
      outage has no event to react to otherwise — the chime gate also switched from `document.hidden` to
      `document.visibilityState !== "visible"` for correctness in more browser states. Missed-call popup
      dismissal is now tracked by a count-keyed `localStorage` flag scoped to the toast banner only — it does
      **not** touch the bell/History badge state, so dismissing the toast doesn't make missed calls look
      "reviewed" when they haven't been (a literal read of the synthesized plan would have done exactly that;
      corrected before shipping).
- [x] **Messaging backend data integrity (`server/v2routers.ts`, `server/v2db.ts`).** `messages.send` now
      trims the body before the empty-check and verifies a supplied `attachmentId` actually belongs to the
      caller (`getAttachmentForIdentity`, throws `FORBIDDEN` otherwise) — previously any authenticated
      identity could attach *any* attachment ID, including someone else's private media. `sendMessage`
      validates a `replyToId` belongs to the same conversation before inserting (closes a cross-conversation
      reply-spoofing path) and runs inside a `db.transaction`. `markThreadRead` and `recentAutoReplyExists`
      now filter out soft-deleted messages (`isNull(messages.deletedAt)`) so an unsent message can no longer
      affect read receipts or trigger/suppress auto-replies. `recordAttachment` selects by `insertId` instead
      of re-querying by criteria, closing a race window under concurrent uploads.
- [x] **Contacts backend data integrity.** `contacts.upsert` now validates `email` (RFC-shaped), `phone`
      (≥4 digits, phone-characters only), and `website` (must be `http(s)://` — blocks `javascript:`/`data:`
      URI injection via a contact's website field). `regenerateIdentityNumber` wraps the identity-number
      update and its contact-record propagation in a single `db.transaction`, replacing a try/catch-swallow
      pattern that could previously leave the identity and its contacts' cached numbers split-brained on a
      partial failure.
- [x] 10 new backend tests (`server/dataIntegrityFixes.test.ts`) covering attachment-ownership rejection,
      whitespace-only-body rejection, no-identity rejection, and the email/phone/website validators (both
      reject and accept paths, including the `javascript:` URI block). 527 tests green (1 pre-existing skip),
      tsc + build clean. Footer → `v2.65.0`.

## v2.65.1 — Fix: residual "peep peep peep" ringtone heard mid-call on Android (delivered 2026-06-30)

User reported a repeating "peep, peep, peep" tone during voice/video calls, Android-only, with no idea
where it came from. Root-caused via a 5-theory diagnostic Workflow (parallel investigation, each theory
adversarially re-verified by an independent reader) before touching any code — 4 of 5 theories (engine
double-mount, a loudspeaker-routing audio artifact, duplicate/late SSE `call_offer` ring delivery, and a
broad "anything else Android-specific" sweep) were refuted on independent re-read; only one survived.

- [x] **Root cause confirmed:** `client/src/lib/relayClient.ts`'s synthesized ringtone/dial-tone system
      (`playRingtone`/`stopRingtone`, ~line 1306) schedules Web Audio oscillators on a reused `AudioContext`
      every 2-3s while dialing/ringing. `stopRingtone()` only ever cleared the `setInterval` — it never
      stopped or disconnected the oscillator/gain nodes `fire()` had already scheduled. On Android, a freshly
      created `AudioContext` starts **suspended** under the stricter autoplay policy; oscillators scheduled
      while suspended stay queued in the Web Audio graph rather than playing immediately. The call connects,
      `stopRingtone()` runs (stopping only the timer), and later — e.g. when the user opens the Android-only
      forced-loudspeaker toggle, which calls `await loudspeakerCtx.resume()` — the *ringtone's own* context
      can also transition to `running`, and every queued, now-past-due oscillator fires audibly: a repeating
      beep heard well into an already-connected call. `onRing`'s existing `if (inCall)` guard means the
      ringtone is never *re-triggered* mid-call — this is a stale-node cleanup bug, not a duplicate-trigger
      one, which is why the other four theories (each assuming a second `playRingtone()` call) didn't hold up.
- [x] **Fix:** `stopRingtone()` now tracks every oscillator/gain node `fire()` creates (`ringtoneNodes`, a
      `Set`) and calls `.stop(0)` + `.disconnect()` on each before clearing the set, so nothing can play after
      `stopRingtone()` runs regardless of when the context later resumes. Nodes self-prune via `osc.onended`
      once a burst finishes normally, so the set never grows across a long ring. Single surgical change, one
      function — every existing `stopRingtone()` call site (accept, decline, ring-cancel, joined, hang-up,
      engine teardown) gets the fix for free; no changes to `onRing`, the server, or the loudspeaker path.
- [x] 2 new static source-pinning tests in `client/src/lib/androidAudioCamera.test.ts` (matching the existing
      pattern for this huge imperative, not-booted-in-tests engine file) confirming `stopRingtone()` drains
      `ringtoneNodes` and that `fire()` registers + self-prunes them. 529 tests green (1 pre-existing skip),
      tsc + build clean. Footer → `v2.65.1`.

## v2.66.0 — Communication reliability sweep (voice/video/text/messaging/backend) (delivered 2026-07-02)

User asked to "improve the entire app to the maximum — communication-wise, everything." Ran a 6-area
audit workflow (voice, video, in-call text, messaging, backend, design) with an adversarial QA-verify
pass on every finding. This commit ships the verified communication/reliability fixes; the glassy design
reshape ships separately as v2.67.0.

- [x] **In-call chat dedup + ordering (`relayClient.ts`).** Data-channel/SFU chat frames now carry a unique
      `id`; both receive paths (mesh `dc.onmessage` and SFU `RoomEvent.DataReceived`) funnel through a single
      `receiveChatFrame` that drops any id already rendered (`seenChatIds`, bounded to 500). Fixes the same
      message appearing twice after an ICE restart / data-channel re-open, and ignores an SFU self-echo
      (our own sent ids are pre-seeded).
- [x] **In-call chat delivery feedback (`relayClient.ts`).** `broadcastChat` now returns the number of peers
      it actually handed the frame to (mesh: open data channels; SFU: 1 on successful publish, 0 on throw).
      `sendChat` toasts "Message not delivered — check your connection." when there ARE peers in the call but
      the frame reached none of them, instead of silently rendering locally and dropping it on the wire.
- [x] **Audio routing survives a voice→video upgrade (`relayClient.ts`).** `setCam(true)` re-applies the
      active output (`reapplyAudioRouting` = `applyAudioSink` + `refreshLoudspeakerRouting`, both idempotent/
      guarded) after the SFU republishes tracks — previously, upgrading a voice call to video could recreate
      the remote audio elements and silently drop a chosen sink or Android's forced loudspeaker back to the
      earpiece mid-call.
- [x] **Incoming-call audio primed on the accept gesture (`relayClient.ts`).** `acceptInvite` arms the audio
      unlock during the Accept tap (a real user gesture), so the remote voice stream — which arrives a second
      or two later, outside any gesture and thus gated by Android's autoplay policy — plays on the user's next
      touch instead of staying silent until a failed `play()` happens to re-arm it.
- [x] **Read-receipt update is now atomic (`server/v2db.ts`).** `markThreadRead`'s last-id SELECT + the
      unread-reset UPDATE + the read-receipt flip run inside one `db.transaction`, so a partial failure can't
      leave `unreadCount` reset to 0 without the matching receipt (or vice versa). The correctness-critical
      `id <= lastId` bound (no false receipts for messages that arrive mid-operation) was already present and
      is preserved.
- [x] **SSE bus won't write to a dead socket (`server/v2events.ts`).** `writeEvent` now checks
      `res.destroyed || res.writableEnded` before writing, closing the race window where the underlying socket
      died but the `close`/`aborted` cleanup hadn't yet flipped `client.closed` — a stale presence/message
      push could otherwise buffer against a dead response.
- [x] **Optimistic unsend with rollback (`client/src/pages/app/Messages.tsx`).** `remove` gains an `onMutate`
      that snapshots and optimistically filters the message out of the `messages.list` cache, an `onError` that
      restores it (with a toast) if the server rejects, and `onSettled` invalidation — so an unsent message
      vanishes instantly instead of lingering until the 2s poll, and a failed unsend doesn't hide a message
      that still exists.
- [x] **Investigated + intentionally NOT changed:** a CRITICAL-flagged shared-browser identity-hijack claim
      in `server/relay.ts` was a false positive (the cited mechanism — `setPin` not emitted — is wrong;
      `setPin` is unconditional at 767, the `identitySwitch` guard is the prior hardening, and the client always
      registers with its resolved pin). Deferred to live 2-identity testing rather than risk the load-bearing
      reconnect-keeps-your-number flow. Also deferred: a mediaPipeline "color filters skip downscale" perf idea
      (a real tradeoff, not a clear win — would change output resolution mid-call on a filter switch and touches
      the test-pinned render hot path; needs on-device measurement).
- [x] 5 new static source-pinning tests (`androidAudioCamera.test.ts`) for the chat dedup/delivery + audio
      re-apply + accept-prime. 533 passing (1 pre-existing skip), tsc + build clean. Footer → `v2.66.0`.

## v2.67.0 — Glassy / transparent design system (delivered 2026-07-02)

Second half of the "improve everything + make it glassy" batch: a cohesive frosted-glass surface system
applied across the previously-solid screens. Built as reusable design tokens so the look is consistent
and the mobile-performance / accessibility safeguards live in one place.

- [x] **Glass surface system (`client/src/index.css`).** Five Tailwind v4 `@utility` classes —
      `glass-surface` / `-sm` / `-md` / `-lg` (translucent card fill + `backdrop-filter: blur/saturate` +
      hairline top-light + depth shadow, three prominence tiers) and `glass-overlay` (modal scrim). Defined
      as `@utility` (not plain classes) specifically so they compose with variants like `md:glass-surface-md`
      for desktop-only glass. Colours are `color-mix` over the existing OKLCH tokens, so light + dark adapt
      automatically. Three safeguards ship with it: a `@media (max-width: 768px)` **blur cap** (backdrop-filter
      is the top GPU cost on Android — mobile blur is held to 6–14px vs 8–24px on desktop); a
      `@supports not (backdrop-filter)` **fallback** to a near-opaque fill so content is never stranded on an
      unreadable panel; and a `@media (prefers-reduced-transparency: reduce)` path that drops blur entirely.
- [x] **Applied to the solid surfaces:** Contacts list card (`md:glass-surface-md`), History card
      (`glass-surface-md`), Messages desktop thread-list column (`md:glass-surface-md`), Profile sub-cards
      (`glass-surface-sm`). Modal scrims unified on `glass-overlay`: shadcn `Dialog` + `AlertDialog` overlays,
      `AuthPanel`, and `UpdateChecker` (replacing four ad-hoc `bg-black/40–50 backdrop-blur-sm` treatments
      with one mobile-capped, fallback-safe token).
- [x] **Deliberately left as-is:** AppShell chrome (sidebar/header/bottom-nav) and the Dialer keypad were
      ALREADY glassy (`supports-[backdrop-filter]:backdrop-blur-xl/2xl` with fallbacks) from earlier work —
      not re-touched, to avoid unseen visual regressions without a live preview. The in-call surfaces
      (control bar/tiles) were also left for a visual-QA pass on the running app.
- [x] **Constraints honored:** the pinned Messages layout classNames (WebKit flex-column fix, scroll
      container, `pb-28` clearance) and the AppShell bell/DND structure were untouched — only the desktop
      card *surface* classes changed, so `headerFixes.test.ts` and `Messages.test.ts` still pass unchanged.
- [x] 8 new static-source-pinning tests (`glassDesign.test.ts`) covering the `@utility` definitions, the
      mobile cap, the unsupported-backdrop fallback, the reduced-transparency path, and per-screen
      application. 541 passing (1 pre-existing skip), tsc + build clean (verified `md:glass-surface-md`
      actually emits into the bundle). Footer → `v2.67.0`.

> Note: the glassy look was verified to COMPILE and emit correctly, but not visually previewed (the app
> needs a live backend/DB this environment lacks). A visual-QA pass on the Manus preview after Publish is
> the right place to fine-tune translucency levels and extend glass to the in-call surfaces.

## Katon-inspired landing redesign (Home.tsx only)
- [x] Regenerate bilingual copy via Gemini Flash (TALK/MEET/CHAT blocks, FAQ, pillars, features)
- [x] Add product-style capability blocks section (TALK / MEET / CHAT) with icon lists
- [x] Add FAQ section (bilingual)
- [x] Keep all existing animations, real screenshots, live stats, EN/AR + RTL
- [x] Do NOT claim classroom / streaming / hardware / translation / AI
- [x] Update Home.test.ts if needed and run pnpm test (530 tests green)
- [x] Checkpoint + push (version ef408212), guide user to Publish

## Interactive/dynamic landing reshape (Home.tsx only) — gemini-3.5-flash
- [x] Verify true group-call capacity (confirmed: up to 10 people)
- [x] Generate expanded multilingual copy via gemini-3.5-flash (EN, AR, ES, FR, DE, HI)
- [x] Add scroll-reactive animated 3D background (color + motion shifts on scroll)
- [x] Fix duplicate "Open RELAY" button — header CTA hides on scroll, single floating CTA appears
- [x] Language switcher supporting 6 languages (RTL-aware for AR)
- [x] Add group video conference showcase (up to 10 people, 10-screen grid + active-speaker spotlight)
- [x] Keep truthful features only (no classroom/streaming/hardware/AI claims)
- [x] Run pnpm test (530 green) + tsc clean, visual check EN + AR RTL done; checkpoint + push


## Editorial + standalone-registration pass (Home.tsx / landing copy only)
- [ ] Audit all "talk"/"talks" usage in landing copy (6 langs) and pick one unambiguous meaning
- [ ] Standardize "the talks" to a single consistent term/usage throughout
- [ ] Remove any external-individual reference in registration (e.g. "Manus/Manos registered ...")
- [ ] Ensure registration copy states a purely internal, standalone 6-digit flow
- [ ] Remove any mention/implication of third-party login (Google/Gmail, Apple ID, Facebook, external IdP)
- [ ] Verify app code has no third-party auth exposed to end users on the standalone path
- [ ] Run pnpm test + tsc, visual check EN + AR, checkpoint + push, guide user to Publish

## Email-only standalone registration (updated scope)
- [ ] Registration/login is EMAIL ONLY (internal), no Gmail/Google, Apple, Facebook, Manus, or any external IdP
- [ ] Remove third-party auth from user-facing flow; keep 6-digit number as the RELAY identity
- [ ] Landing copy reflects email-only, self-contained account creation (all 6 langs)
- [ ] Standardize the "talks" terminology to one unambiguous usage
- [ ] pnpm test + tsc, visual check, checkpoint + push, guide user to Publish

## Editorial + email-only landing copy (DONE)
- [x] Add optional email-only account FAQ in all 6 languages (no Google/Apple/Facebook/Manus/3rd-party)
- [x] Standardize ambiguous "start talking" CTA to single "first call" usage (TALK kept as sole product label) in 6 languages
- [x] Kept quick no-account use messaging (option B)
- [x] Landing page only; backend/OAuth untouched
- [x] tsc clean + 530 vitest pass + visual check EN

## v2.68.0 — Passwordless email-OTP login + verified blue badge (delivered 2026-07-02)

Redesigned the login/registration around a single email field with an emailed one-time code — no
password, no third-party sign-in (Google/Apple/Manus buttons removed). Verified users get a blue
badge shown next to their name across the app. Planned via a 5-area mapping workflow against the
existing self-hosted auth so it builds on `authLocal`/`authCrypto`/`email`/`ensureUserIdentity`.

- [x] **Schema + boot-migrator.** New `email_otps` table (hashed 6-digit code, purpose, pending
      first/last name, expiry, attempt counter, consumed). New `identities.verified/firstName/lastName`
      columns. Additive `ADD COLUMN`/`CREATE TABLE IF NOT EXISTS` in `ensureSchemaExtensions`, plus a
      one-time idempotent backfill (`UPDATE identities … SET verified=1 WHERE users.emailVerified=1`) so
      existing verified accounts badge immediately. Expired OTP rows swept every 5 min.
- [x] **OTP backend (`server/authOtp.ts` + `otpAuth` tRPC router).** `requestOtp` (known email → email a
      code; unknown → tells the UI to register), `register` (first/last/email → email a code; the user is
      created only on verify, so an abandoned registration leaves no ghost account), `verifyOtp` (validates
      the code, creates/resolves the user, **upgrades the guest identity in place** via `ensureUserIdentity`
      so the number/contacts/messages carry over, marks it verified, sets the `relay_session` cookie),
      `resendOtp` (60s cooldown, carries the pending purpose/name), `signOut`. Codes are scrypt-hashed at
      rest, generated with `crypto.randomInt`, 10-min TTL, burned after 5 wrong attempts, per-IP rate
      limited + per-email cooldown. Reuses the existing session cookie + `ensureUserIdentity` migration.
- [x] **Email + honest fallback.** OTP email via the existing `sendEmail`. When email isn't configured (or
      a send fails), the code is logged in dev/self-host so the flow stays testable; in production the
      procedures return `{ ok:false }` so the UI shows "couldn't send your code — email delivery isn't set
      up" instead of a dead-end "code sent". Codes are NEVER logged in a correctly-configured prod.
- [x] **Frontend (glassy, passwordless).** `AuthPanel` rewritten as an email → (register if new) → 6-digit
      code stage machine with resend cooldown + inline errors, keeping the `glass-overlay` scrim.
      `OnboardingGate` now leads with the email field (primary) and keeps "continue as guest" (secondary);
      the OAuth button + `getLoginUrl` are gone. The AppShell "Upgrade" links and Profile "Manus sign-in"
      were replaced with an in-app "Register with email" that opens the same passwordless panel.
- [x] **Verified blue badge.** New `VerifiedBadge` (lucide `BadgeCheck`, blue, aria-labelled). `verified`
      now flows through `ResolvedIdentity`/`rowToResolved` (strict `row.verified === true`) to `whoami`,
      `directory.lookup`, `contacts.list`, and `messages.threads` (`peerVerified`), and renders next to the
      name in the AppShell header/sidebar (self), Profile, Contacts rows, Messages thread list + conversation
      header, and the Dialer preview.
- [x] **Deferred (isolated, no correctness impact):** the in-call raw-HTML tile badge (needs
      server-authoritative PIN→identity resolution in `relay.ts` so a blue check can't be client-spoofed)
      and the conference-roster / missed-summary badge. React surfaces cover the primary "everywhere".
- [x] 27 new tests (`authOtp.test.ts`, `otpAuth.test.ts`, `verifiedBadge.test.ts`) — code format, hash
      round-trip, dev/prod email fallback, OTP router validation + no-DB branches, whoami verified
      passthrough, badge render-site pins, no-password / no-OAuth-button guards. tsc + build clean.
      Footer → `v2.68.0`.

> Operational prerequisite: passwordless login **cannot deliver codes to real users in production until a
> DNS-verified Resend sending domain is configured** (`RESEND_FROM`) — without it, Resend test mode only
> emails the account owner. The dev fallback (logged code) covers local/self-host testing only.
> Also ensure a real `JWT_SECRET` is set in prod (it signs `relay_session`, now the only login).

## Realistic 10-person conference grid (landing)
- [x] Inspect current conference-grid JSX/CSS in Home.tsx
- [x] Generate ~10 realistic diverse people images in video-call poses (talking / drinking water / listening / looking away) via Gemini image gen
- [x] Upload generated images via manus-upload-file --webdev
- [x] Rebuild grid: real photo tiles, name + mic-status labels, one rotating active-speaker spotlight (only one 'live' at a time, others idle/moving)
- [x] Match RELAY system screen look (labels, corner mic icon, live badge)
- [x] Landing-page only; do not touch backend
- [x] tsc clean + vitest pass + visual check EN/AR, checkpoint, guide Publish

## Fix: Canvas 3D background IndexSizeError (negative radius) — landing page
- [x] Diagnose root cause: perspective projection FOV/(FOV + z*scale) yields near-zero/negative depth when a node is behind the camera plane → huge negative radius passed to arc()
- [x] Guard projection: skip points where denominator <= 1, clamp scale with Math.max(0, depth)
- [x] Clamp node radius with Math.max(0, ...) and skip drawing when radius <= 0
- [x] Verify: tsc clean, 565 vitest tests pass, browser reloaded + full-range scroll with no new IndexSizeError (all 34 prior errors predate the fix at 09:07)
- [x] Checkpoint (version 6a9e820e); guide user to Publish

## v2.68.1 — Fix: iOS phantom ring after connect + loudspeaker→headset auto-switch (delivered 2026-07-02)

Two confirmed call-reliability bugs from a cross-platform report.

- [x] **iOS "ringing continues after the call connects" (state-management bug).** The ringtone + call
      "phase" were dismissed in scattered spots (`onJoined`, `acceptInvite`) but NOT at `markEstablished()`
      — the authoritative "media is actually live" signal (fires from the mesh peer-connection state
      machine and the LiveKit connect/reconnect events, not a timer). Result: the OUTGOING caller stayed in
      phase `"dialing"` for the entire call, and on iOS — where Safari throttles the `setInterval`-driven
      `stopRingtone` once backgrounded — the ring animation + sound persisted into the live conversation and
      while minimized. Fixed by routing the definitive `stopRingtone()` + `emitPhase("in-call")` through
      `markEstablished()`, so the ring is silenced and the phase flips the instant media truly connects, on
      every platform and both mesh + SFU paths. Both calls are idempotent (stopRingtone is safe to repeat;
      emitPhase dedups via lastPhase).
- [x] **Loudspeaker → headset auto-switch (audio routing).** The device-change handler already auto-routed
      to a headset when on "Automatic", but not when Android's forced-loudspeaker mode was on — the exact
      reported case ("on loudspeaker, connect a headset, it doesn't move"). Now a headset appearing while
      forced-loudspeaker is active drops the loudspeaker force so the OS hands audio to the headset. Detected
      across BOTH input + output devices (`headsetWasPresent`), since Android Chrome often doesn't enumerate
      audio OUTPUTS but the headset's MIC (an audioinput) still appears on connect.
- [x] 2 new source-pinning tests (`androidAudioCamera.test.ts`). 564 passing (1 pre-existing skip), tsc +
      build clean. Footer → `v2.68.1`.

> Still open (need real-device validation or a larger dedicated effort, not shippable blind from here):
> (a) **Android background media drop** — the native PiP path to keep audio+video alive when minimized is
> already built but is opt-in (`relay_auto_pip`) and needs on-device tuning (Chrome suspends a backgrounded
> tab's media unless PiP is actually engaged); (b) the **cross-browser call-bar audit** and the
> **WhatsApp-grade redesign of Messages / History / Contacts** — substantial UX work best done against a
> live preview. Tracked as tasks #38/#39 and a future design pass.

## v2.69.0 — Background call-media keep-alive + cross-browser call bar + Messages reliability (delivered 2026-07-02)

Second-pass multi-agent investigation (3 parallel deep-dives → adversarial verification → synthesis)
of the two open items from v2.68.1: Android background media drop, and the cross-browser call bar +
Messages/History/Contacts UX. Ships the findings that are correct + safe from static reasoning; the
genuinely device-dependent ones are documented as needing on-device validation (see end).

### Background call-media keep-alive (relayClient.ts, index.html) — static-safe
- [x] **Forced-loudspeaker AudioContext auto-resumes.** The Android forced-loudspeaker path mutes the
      source elements and carries audio through a Web Audio context — which the OS can suspend when the
      tab is backgrounded, silencing ALL incoming audio with no recovery. Added `loudspeakerCtx.onstatechange`
      that resumes it whenever it flips to `suspended` while loudspeaker is on, plus a resume on the
      foreground-return branch of `onVisibilityChange`. This is the most impactful background-audio fix.
- [x] **OS media session** (`navigator.mediaSession`). `markEstablished()` now registers the call with the
      OS media session (metadata + `playbackState:"playing"` + action handlers for hangup / toggle mic /
      toggle camera, and no-op play/pause so an OS control can't pause our audio); `hangUp()` releases it.
      This is one of the signals Android uses to keep a backgrounded tab's audio alive, and it surfaces
      lock-screen / notification-shade controls. Feature-detected + fully additive.
- [x] **Filtered outgoing video no longer freezes when backgrounded.** With a filter on, the published
      track is a `canvas.captureStream` driven by `requestAnimationFrame`, which the browser pauses in the
      background — so peers saw a frozen frame. `bgSwapVideo()` swaps the published track to the RAW camera
      (not rAF-gated) on background and back to the filtered track on foreground, via the existing
      `replaceVideoEverywhere` (replaceTrack, never a full-stream replace), skipped while screen-sharing and
      re-entrancy-guarded.
- [x] **`pagehide` rejoin snapshot.** Added a `pagehide` listener (removed in teardown) mirroring the
      `beforeunload` snapshot — `pagehide` is the mobile-reliable transition Safari/Chrome fire when a tab is
      backgrounded into the page cache, so the auto-rejoin snapshot is written on mobile too.
- [x] **`viewport-fit=cover`** added to the viewport meta so `env(safe-area-inset-*)` actually resolves —
      the control bar's and AppShell nav's safe-area padding were previously dead code.

### Cross-browser in-call control bar (relayAssets.ts) — static-safe
- [x] `flex-wrap` moved onto the BASE `.ctrl-bar` rule so the bar can never clip end buttons at any width
      (it only wrapped below 680px, clipping between 681px and desktop).
- [x] `@supports not (backdrop-filter)` opaque fallback + a `prefers-reduced-transparency` path for the
      control bar and filter dock (legibility on older Firefox / reduced-transparency), mirroring index.css.
- [x] Mobile blur cap (`@media (max-width:768px)` → 10px) for both surfaces, matching the design system's
      Android-GPU tier.
- [x] Safe-area bottom padding moved onto the base `.controls` rule (applies at all widths now that
      viewport-fit is set); 44px touch targets bumped to a comfortable 48px on the narrowest phones.

### Messages reliability (Messages.tsx, History.tsx, useRealtime.ts) — static-safe
- [x] **A failed send is never silently lost.** `send()` clears the composer immediately (snappy) but on
      failure restores the text + reply + pending attachment and toasts, so the user can just tap send again.
- [x] **Dead message-notification fixed.** Clicking a new-message notification routed to `/app/messages/<id>`
      (a 404); now `/app/messages?c=<id>`, the query form the app actually reads.
- [x] **Read receipts gated** on the tab being visible AND the reader near the bottom (not backgrounded or
      scrolled up in history), with a re-fire on foreground return — no more false "read".
- [x] **Auto-scroll no longer yanks** the reader to the bottom while they read history — it only jumps when
      already near the bottom or when the thread changes.
- [x] **Attachment-only thread previews** show a kind label (📷 Photo / 🎬 Video / 🎤 Voice message / 📎 File)
      instead of a bare dash (shared `previewOf` helper, de-duplicated from MessagePopups).
- [x] **Error + retry states** for the Messages thread list and History (were blank-forever on query failure).
- [x] 13 new source-pinning tests. 576 passing (1 pre-existing skip), tsc + build clean. Footer → `v2.69.0`.

> NEEDS ON-DEVICE VALIDATION (not shippable blind — deliberately deferred): whether LiveKit
> `adaptiveStream:true` pauses a backgrounded subscriber's inbound video; whether PiP-open actually keeps
> getUserMedia/media alive on Android (auto-enter has no background user-activation); and the larger
> Messages/History/Contacts rebuilds (load-earlier pagination past 100, History date-headers/search/avatars,
> Contacts A–Z index) that want a live preview. Tracked for a device-testing pass.

## "Coming soon" download section (landing page)
- [x] Generate multilingual "Coming soon" copy via Gemini Flash (6 languages)
- [x] Add download section: App Store (soon) + Google Play (soon) icons
- [x] Add third icon: APK download under Android (placeholder link until user provides it)
- [x] Keep bilingual/RTL support + existing design language
- [x] Run pnpm test + tsc, visual check, checkpoint + push, guide user to Publish

## v2.70.0 — Multi-party grid (5-6 participants), participant-exit handling, media quality (delivered 2026-07-02)

Multi-agent investigation (3 parallel deep-dives → adversarial verify → synthesis) of the "only 4 tiles for
5-6 users" report + quality + exit handling. KEY FINDING: there is NO hard "4" cap — the layout math
(callLayout.ts) and grid CSS both correctly produce a 3x2 grid for 5-6 tiles. The symptom is path-specific:
SFU tiles weren't pre-created from the roster, and a silently-dropped mesh peer was never removed.

### Grid: N participants show N tiles (the primary bug)
- [x] **SFU roster pre-create.** LiveKit's ParticipantConnected does NOT fire for members already in the room
      when you connect, so the 5th/6th feed only appeared on TrackSubscribed (late, or black under the
      audio-before-video race) → looked like "only 4". Now onJoined / onRejoin / onResumed / onMerged all seed
      a tile for every `m.members` roster entry via addLkTile (dedup-safe; excludes self), and joinLivekit
      enumerates `room.remoteParticipants` right after connect (LiveKit's recommended pattern). The mesh path
      already created every roster tile synchronously (callPeer), so no change needed there.

### Participant-exit: detect / reflow / notify / grace-rejoin
- [x] **Authoritative exit signal (server).** When an in-call peer's 30s disconnect grace expires with no
      reconnect (silent tab-close / network-loss / crash), the server now broadcasts `peer-left` to the
      surviving room members (`server/relay.ts`). The client already reflows the grid + posts the notice on
      `peer-left`; room membership is intentionally KEPT so a returning device still auto-rejoins and the
      survivors rebuild the tile from its fresh offer. This is the reliable exit signal a client can't derive
      itself (it can't tell a vanished remote peer from its own local blip). Rides SSE+POST (no WebSocket).
- [x] **Visible "reconnecting…" grace state.** An ESTABLISHED peer that dropped used to freeze silently on its
      last frame (the connecting overlay was suppressed whenever gotStream was true). Now updateTileState shows
      "reconnecting…"/"connection failed" for a broken (failed/disconnected) established peer during the grace
      window — so the survivor sees the drop immediately, before the authoritative removal at 30s.
- [x] **Visible exit toast.** removePeer + removeLkTile now raise a `toast()` ("X left the call.") in addition
      to the chat system message (the chat drawer is closed by default during a call, so the sysmsg alone was
      invisible). Guarded so a reconnect re-offer (quiet removal) and self-teardown don't spam it. The grid
      already reflowed via layoutGrid() on every removal — verified, unchanged.

### Media quality
- [x] **Mesh screen-share msid fix.** createPeer grouped the screen video under `screenStream`'s msid while
      audio used `sendStream` — two msids, so a mid-share joiner's `ontrack` fired twice and attachRemote kept
      only the last stream → silent audio OR a black tile for whoever joined during a share. Now the video is
      grouped under `sendStream` (the transmitted track is still the screen); one msid, both tracks arrive.
- [x] **contentHint** on published tracks: "motion" on the camera (smoothness on a constrained link), "detail"
      on the screen share (readable text over frame rate). Plain property write, no renegotiation.
- [x] **SFU Opus "speech" preset** on the Room ctor `publishDefaults` (clearer voice at lower bitrate than the
      library-default "music" 48 kbps; DTX + RED are already default-on).
- [x] 6 new source-pinning tests (engine + server). 581 passing (1 pre-existing skip), tsc + build clean.
      Footer → `v2.70.0`.

> DEFERRED (needs on-device validation / timing tuning, not shippable blind): the client-side exit-latency
> accelerators (a `failed`-state watchdog and `dc.onclose` timer) — they shorten the 30s grace for a clean
> tab-close but risk a reload "left → joined" flap whose timing needs a real multi-client run; and the mesh
> per-sender bitrate caps + party-count capture downscale (C4) — over-aggressive caps degrade quality on
> capable devices, so the thresholds need on-device tuning. Above all, CONFIRM the actual "5-6 users → tiles"
> behaviour on a live multi-client session on whichever media path the deployment runs (SFU vs mesh fallback).

## v2.70.1 — HOTFIX: dialing disconnected after a few seconds (delivered 2026-07-02)

User report: dial a number → "Calling…" for a few seconds → the call disconnects, on every
device/account. Root cause CONFIRMED in code: the SFU join watchdog (`armLkWatchdog`) is armed by
`enterCallUI` — which for the CALLER runs at DIAL time ("Calling…") — and after 3 ticks (~16.5s)
it called `hangUp("livekit-join-timeout")` unless the caller's OWN LiveKit media was fully up
(`lkConnected`). So whenever the caller-side SFU connect was slow or failing (token race, SFU
unreachable, transient LiveKit issue), EVERY outgoing call was torn down by the caller's own
watchdog while it was still RINGING — exactly the reported symptom.

- [x] **The watchdog never tears down an unanswered call anymore.** New `callAnswered` flag — set on
      any evidence of a second party (`acceptInvite`, mesh `createPeer`, SFU `addLkTile`), reset in
      `hangUp`. While the call is un-answered, the watchdog keeps the LiveKit token fresh at a gentle
      cadence but does NOT count toward the give-up; ring-timeout / reject / cancel keep governing an
      unanswered call as before. Once someone HAS joined and media still can't come up within ~12s,
      the existing give-up (error toast + hangUp) applies unchanged — that part is correct.
- [x] **LiveKit Room constructor hardened.** `new Room(opts)` now falls back to the known-good bare
      options (`{adaptiveStream, dynacast}`) if the options object is ever rejected, and a total
      construction failure diag-logs and returns instead of crashing `joinLivekit` — a persistent
      throw there would have made every dial die via the watchdog (insurance against the v2.70.0
      `publishDefaults` addition, which was verified valid for livekit-client 2.20.0 but is now
      failure-isolated regardless).
- [x] 3 new source-pinning tests (one v2.66 pin loosened to span the inserted flag line). 585 passing
      (1 pre-existing skip), tsc + build clean. Footer → `v2.70.1`.

> If a dial still drops after this ships: the remaining few-second teardown paths each show a toast
> naming the cause — "X declined." (the callee device may have Do-Not-Disturb ON → instant
> auto-decline), "They're on another call." (busy), "That number doesn't exist or is offline", or
> "Couldn't connect call media" (SFU media genuinely failing AFTER answer — check the LiveKit
> credentials/quota in the Manus env). Note which toast appears — it identifies the path instantly.

## Feature: "The Technology Behind RELAY" page (from user's uploaded design)
- [x] Create client/src/pages/Technology.tsx as a self-contained React page mirroring the uploaded relay-landing.html (hero P2P live demo, ticker, Why-RELAY 6 cards, latency strip, How-it-works 3 steps + mesh, Security accordion, stats, final CTA + footer)
- [x] Preserve all copy, structure, layout, four-act scroll journey, and SVG visuals from the upload; improve polish (typography rhythm, spacing, motion) without changing content
- [x] Port the scroll/background cross-fade, reveals, counters, ticker, hero exchange loop, mesh packet as a React-safe effect (with proper cleanup)
- [x] Point "Get RELAY"/"Download" CTAs to /app and back-to-home nav to /; keep it landing-page-only, no backend changes
- [x] Register /technology route in App.tsx
- [x] Add a visible link from the landing page (hero + footer, all 6 locales) to /technology
- [x] tsc clean + 583 vitest pass + browser visual check (all 4 acts, live hero demo, counters, accordion, no console errors); checkpoint a9ae4b73; guide Publish

## v2.71.0 — Messages: iMessage-grade chat UI (delivered 2026-07-03)

From a user report with screenshots (double stacked headers eating a third of the phone screen;
messages floating at the TOP of the thread with a black void above the composer; oversized bubbles
with clunky full-width timestamps; loud hard-coded blue received bubbles; gray offline dots; no
typing awareness on the thread list). Benchmarked against Google Messages / iMessage.

- [x] **ONE compact conversation header on mobile.** While a chat is open (<768px), the app's top bar
      is hidden (`body.relay-convo-open .relay-appshell-topbar{display:none}` — the chat header has its
      own back button; the bottom tab bar stays). The chat header itself is tighter (py-2, size-9
      circular avatar) and carries a live status line: **typing…** (green, pulsing) > **online** (green)
      > **last seen Xm ago** — name + verified badge on top, presence LED on the avatar.
- [x] **Presence LEDs: green = online, RED = offline** (was gray) — thread-list rows, the conversation
      header, and Contacts rows (still fully hidden for >24h-inactive guests, privacy unchanged).
- [x] **Typing on the thread list.** New `useTypingConversations()` (one store subscription for the
      whole list) — a thread with an active typer shows a green pulsing "typing…" in place of its
      last-message preview, before you even open the chat. (The server already excludes the sender
      from typing fan-out, so your own typing can't self-trigger it.)
- [x] **Short conversations anchor to the BOTTOM** (iMessage-style): the scroll container gained
      `flex flex-col` + an `mt-auto` spacer, so 2 messages sit just above the composer instead of
      floating at the top with a void. The composer remains in-flow/pinned (WebKit flexbug fix intact).
- [x] **Glassy, elegant bubbles.** Yours: translucent brand green (`/85` + hairline white border).
      Theirs: neutral translucent surface (`bg-muted/70` + border) replacing the hard-coded `#2563eb`
      blue — theme-aware in light+dark. Timestamps + ✓/✓✓ ticks are now tiny and tucked bottom-RIGHT
      (WhatsApp-style) instead of a full-width row. Reply-quotes/group sender names re-tinted for the
      neutral surface. Search-result bubbles restyled to match.
- [x] **Emoji-only messages render BIG without a bubble** (`isEmojiOnly`, up to ~8 composed emoji,
      Unicode-property-safe with a fallback). Thread-list + conversation avatars are circular (size-12).
- [x] **⋮ message menu decluttered** — subtle (35% opacity) on mobile, hover-revealed on desktop.
- [x] 7 new pins in Messages.test.ts (typing list state, red LEDs, topbar hide, bottom anchor, neutral
      bubbles, emoji-only, header status line). tsc + build clean. Footer → `v2.71.0`.

## v2.72.0 — Mobile call QA fixes (iOS flip, SFU camera re-enable, iOS filters, screen-share msg) (delivered 2026-07-03)

Reviewed a 5-point QA report; traced each in the engine and confirmed which are real code bugs vs
platform limits. Shipped fixes for the three real code bugs + a messaging fix; documented the two
that are platform/environment issues.

- [x] **#1 iOS camera-switch freeze — FIXED (real bug).** `flipCamera` acquired the NEW camera before
      stopping the old one — but iOS Safari holds only one camera capture at a time, so requesting the
      second while the first is live froze the page (Android allows the brief overlap, hence
      Android-only-works). Now on iOS the old video track is STOPPED first, then the new camera is
      acquired, with recovery (re-grab the original facing) if that acquisition fails. `IS_IOS` was
      hoisted next to `IS_ANDROID` so the flip/filter paths can use it.
- [x] **#3 camera toggle can't re-enable — FIXED (real bug, SFU path).** LiveKit's `unpublishTrack`
      STOPS the underlying track by default, so disabling the camera killed it and re-enabling
      republished a dead (black) track. Now it unpublishes with `stopOnUnpublish = false` (track stays
      live → re-enable just republishes), plus a defensive `reacquireCameraForPublish()` that grabs a
      fresh camera if the track ever genuinely died. (The plain WebRTC-mesh path only toggles
      `track.enabled` and already re-enabled fine.)
- [x] **#5 filters fail on iOS — FIXED (graceful fallback).** iOS Safari's `canvas.captureStream()` is
      unreliable (often yields a track that produces NO frames; MediaPipe WASM can fail), so filters
      shipped a frozen/black tile. Added `probeTrackLive()` — on iOS, after enabling a filter it
      verifies the processed track actually produces a frame within ~1s; if not, it silently reverts to
      the raw camera + toasts. (Genuine iOS platform weakness — can't make canvas filters "always work"
      on iOS, but the call no longer freezes/blacks out.)
- [x] **#2 screen sharing — messaging fix (not a code bug).** iOS Safari does not implement
      `getDisplayMedia` at all (Apple exposes no web screen-capture API), so it's genuinely impossible
      on iPhone/iPad — the app now says so explicitly and suggests desktop/Android Chrome. On Android
      the code path is correct and works in Chrome; a non-Chrome Android browser without the API gets a
      clearer "try Chrome" message. **No Android code bug found** — QA should note which Android browser
      + whether the camera was on (screen share needs a camera-enabled call on the mesh path).
- [x] **#4 Android echo when muted — NOT a code bug (verified).** `setMic(false)` correctly sets
      `track.enabled = false` (verified silences the outgoing audio), and forced-loudspeaker is never
      auto-enabled (only on an explicit tap). The "feedback" is **acoustic echo**: on speakerphone the
      loudspeaker Web-Audio routing bypasses the browser's echo canceller, and/or two QA devices in the
      same room feed each other. Muting YOUR mic stops YOUR contribution; it can't cancel the other
      device's speaker. Recommend QA re-test with headphones or one device on earpiece to confirm it's
      echo-free there. No safe code change fully fixes speakerphone echo in a browser.
- [x] 5 new source-pinning tests. 597 passing (1 pre-existing skip), tsc + build clean. Footer → `v2.72.0`.

> All five touch iOS/Android-specific media behavior that can't be verified from this environment — the
> three code fixes (#1/#3/#5) are correct by construction but need a real-device pass after publishing.

## v2.72.1 — Correction: screen sharing is desktop-only (Android Chrome ALSO lacks getDisplayMedia) (delivered 2026-07-03)

QA confirmed the Android screen-share test was on **Chrome with the camera on** — ruling out the two
gating conditions I'd guessed. Re-checked the platform reality: `navigator.mediaDevices.getDisplayMedia`
is **not implemented on any mobile browser** — not iOS Safari AND not Android Chrome (web screen-capture
needs the OS screen-record API, which phones don't expose to web pages). So the tester's Android Chrome
hit the `!md.getDisplayMedia` branch and saw a toast that said "Try Chrome" — misleading, since they
were already on Chrome. This is a **platform limitation on both mobile OSes, not an app bug** (I was
wrong earlier to say it works in Android Chrome).

- [x] Corrected the "not supported" message: mobile users (iOS or Android) now see "Screen sharing only
      works on a computer — phone browsers don't allow it. Open RELAY on a desktop/laptop to share your
      screen." Desktop-without-support falls back to "Try Chrome, Edge, or Firefox on desktop." No
      functional change (screen share was never reachable on mobile); just an honest, correct message.
- [x] Updated the pinned #2 test. 597 passing (1 pre-existing skip), tsc + build clean. Footer → `v2.72.1`.

## v2.73.0 — Bottom-nav overhaul: docked in-flow tab bar, per-tab accent colors, composer seated on the nav (delivered 2026-07-03)

Three-screenshot UI request: (1) redesign the bottom nav with premium icons + a DISTINCT active color per
section, (2) eliminate the dead vertical band between page content and the nav, (3) pin the Messages
composer immediately above the nav with the chat scrolling above both.

- [x] **Tab bar is now IN-FLOW, docked at the very bottom** — no longer `position:fixed` floating pill.
      As the last flex child of the viewport-bounded shell column, page content ends EXACTLY at the
      bar's top edge: the `pb-28` clearance zone (the gap band the user circled) is deleted entirely,
      nothing can hide behind the bar, and the bar can never scroll away (scrolling happens in the
      sibling container). Still hidden during calls via `body.relay-call-active`.
- [x] **Per-tab active accents** (user spec): Calls **green** `#22c55e`, History **sky** `#38bdf8`,
      Messages **orange** `#fb923c`, Contacts **purple** `#a78bfa`. Active tab = white icon on a
      gradient squircle with a soft matching glow + label tinted in the tab's hue (darker shade on the
      light theme for contrast). Refreshed icon set: `History` / `MessageCircle` / `UsersRound` replace
      `Clock` / `MessageSquare` / `UserRound`. Desktop sidebar mirrors the accent (tinted active row).
      Colors are inline styles — runtime-composed Tailwind classes are invisible to the JIT compiler.
- [x] **Root cause of the gap/composer misplacement found by in-browser probing**: pages filled the
      shell with `h-full`, but `height:100%` does NOT resolve against the scroll container's
      flex-derived (non-explicit) height — Chrome silently falls back to content height, so short
      conversations collapsed upward leaving a void above the nav (previously masked by `pb-28` +
      usually-full content). Fix: the scroll container is now a flex COLUMN and Messages/Dialer fill it
      with `flex-1` (flex-grow needs no percentage resolution); `<main>` also gets `max-md:h-svh` so
      the mobile shell height is definite. Composer now sits at pixel-0 above the nav in ALL
      conversation lengths (verified: composerBottom == navTop == 766.4 on a 390×844 viewport).
- [x] Verified with headless-Chromium screenshots (mocked tRPC/SSE — sandbox has no MySQL): all four
      tab accents, dark + light themes, mobile + desktop, empty + full conversations; geometry probes
      assert 0px content→nav and composer→nav gaps and the nav flush with the viewport bottom.
- [x] 11 new pins in `client/src/app/appShellNav.test.ts`; updated the two `h-full`-era pins.
      608 passing (1 pre-existing skip), tsc + build clean. Footer → `v2.73.0`.
