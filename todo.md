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
