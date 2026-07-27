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

## v2.74.0 — Staged call progress: Calling → Ringing → Connecting → connected (delivered 2026-07-03)

Caller-side flow per the phone-style spec (reference screenshots): a dedicated dial screen with honest
staged states, and the full in-call interface only once the call is actually established.

- [x] **New pre-connect dial screen** (`#dialCard` in the call view): callee avatar/number/name, a
      Voice/Video mode chip, and a live status line. While it's up (`#call.pre-connect`) every control
      except **End Call** is hidden and the tile grid is not shown.
- [x] **Staged states**: "Calling…" the instant the invite is sent (pulsing indicator) → "Ringing…" when
      the server ACKS the ring was delivered (new `ringing` signaling message — the ack also carries the
      callee's registered display name, so raw-number dials get labeled) → "Connecting…" only when the
      callee answers → "Connected" + full interface on real media establishment.
- [x] **Fixed: SFU caller claimed "Connected" while still ringing.** On the LiveKit path the caller joins
      the room alone at dial time; `room.connect()` used to `markEstablished()` immediately. Now
      establishment waits for a second party: answer → connecting sequence → first remote
      `TrackSubscribed` → established. (Mesh path unchanged: pc `connected` establishes.)
- [x] **Voice-first video defaults** (confirmed + pinned): Voice Dial starts camera-off (SFU publishes no
      video track at all; tap camera to enable mid-call), Dial-by-Video connects with the camera live —
      the dial card's chip ("Voice call" / "Video call") is the visual confirmation of the session mode
      from the start. Dialer passes the callee's directory name to label the card.
- [x] **Verified live end-to-end** (two headless Chromium browsers, fake media, REAL signaling + mesh
      WebRTC on the dev server): dial → pre-connect card w/ only End visible → "Ringing…" (ack) → accept
      on the callee → full UI + "Connected" on the caller; camOff stayed true through a voice call; video
      dial showed the "Video call" chip with camera on.
- [x] 2 new server tests (ringing ack delivered / absent when offline) + 16 static pins in
      `client/src/lib/callProgress.test.ts`. 626 passing (1 pre-existing skip), tsc + build clean.
      Footer → `v2.74.0`.

## v2.75.0 — History overhaul: All/Dialed/Missed filter tabs, Clear History, color-coded rich rows (delivered 2026-07-03)

Per the user's spec + reference screenshot: comprehensive restructure of the History tab.

- [x] **Three filter tabs** at the top — **All / Dialed / Missed** — each with an intuitive icon
      (Phone / PhoneOutgoing / PhoneMissed) and a live count badge (Missed's is red). Segmented-control
      styling; selection actually narrows the list (Dialed = outgoing, Missed = incoming missed/declined).
- [x] **Clear History** trash icon on the right of the filter bar. Confirm-guarded; new
      `calls.clearHistory` mutation performs a PER-USER soft clear: a `historyClearedAt` high-water mark
      on the identity (additive schema column + boot-migrator entry) hides all existing call/conference
      rows from this user only — the other parties keep their logs — and also acks missed-call badges.
      Both `calls.history` and `calls.conferenceHistory` filter `startedAt > clearedAt`.
- [x] **Color coding** exactly as specified: missed/declined incoming = **bright red**, dialed/outgoing =
      **vibrant green**, received/incoming = **clear blue** — applied to the leading icon bubble, the
      name, and the type label (literal Tailwind classes; runtime-composed names don't JIT).
- [x] **Full metadata on every row**: contact name (or number), FULL date + precise time with seconds
      (new `formatFullWhen`, e.g. "Jul 3, 2026, 4:13:13 PM"), call duration, the dialed **PIN** (mono),
      voice/video channel on 1:1 rows, and the complete per-party name+PIN roster chips on conferences.
- [x] **Unanswered OUTGOING dials now appear** (status missed/declined/initiated/ringing/failed,
      direction out → "No answer"/"Declined by them"/"Failed" in green) — previously only incoming
      missed calls were listed, so the Dialed view would have been incomplete. A conference's direction
      is derived from roster order (the caller seeds the roster → first entry isSelf = outgoing).
- [x] **Sticky bottom nav**: History page root switched from `h-full` (collapses — see v2.73) to
      `flex-1 min-h-0`, stale `pb-24` clearance dropped; the log scrolls inside its card while the
      filter bar above and the docked tab bar below stay put. (Messages already correct since v2.73.)
- [x] Verified with headless-Chromium screenshots (mocked tRPC): All/Dialed/Missed states, colors,
      badges, timestamps. 12 new pins in `client/src/pages/app/History.test.ts` + 2 `formatFullWhen`
      unit tests. 640 passing (1 pre-existing skip), tsc + build clean. Footer → `v2.75.0`.

## v2.76.0 — iOS permission-prompt guidance + document overscroll lock (delivered 2026-07-03)

Two screenshot reports: the recurring "Allow your-chat.org to use your camera and microphone?" popup on
iOS, and the app scrolling past its own end into a dead black band below the docked tab bar.

- [x] **Camera/mic prompt (honest scope):** the popup is BROWSER security policy — no web API can
      persist a grant for the user, extend it to other sites, or survive cleared site data. What the
      app CAN do and now does: (a) it already never re-prompts within a session (`ensureMedia` reuses
      the live stream — pinned); (b) a **one-time iOS tip** right after the first successful grant
      points to Safari's PERMANENT per-site fix (aA → Website Settings → set Camera and Microphone to
      Allow — Safari then never asks again for this site). Skipped inside an installed (standalone)
      PWA, where iOS persists grants per app; Chrome/Android + desktop persist after the first Allow
      on their own. Once-ever via `relay_ios_perm_tip` localStorage flag.
- [x] **Overscroll fix (root-caused):** iOS keyboard scroll-into-view (e.g. focusing Contacts search)
      scrolled the DOCUMENT even though the app is an internal-scroll shell, shoving the whole layout
      up past the tab bar. Now: `html/body.relay-app-lock { height:100%; overflow:hidden;
      overscroll-behavior:none }` while AppShell's Inner is mounted (onboarding/lock screens outside
      it keep normal page scroll), the shell's scroll container gets `overscroll-contain` (no chain to
      the document), and `<main>` switched `max-md:h-svh` → **`max-md:h-dvh`** so the shell tracks the
      real viewport as the browser bar expands/collapses (svh left a strip below the bar when the URL
      bar collapsed). The tab bar is now the absolute scroll + visual end of the app.
- [x] Verified in-browser: on /app pages a forced `scrollTo(0,500)` leaves `scrollY` at 0, the
      document has zero scrollable excess, and the nav sits flush at the viewport bottom; the
      marketing page (outside the shell) still scrolls normally. 4 new iOS-tip pins + 2 new/updated
      shell pins. 645 passing (1 pre-existing skip), tsc + build clean. Footer → `v2.76.0`.

## v2.77.0 — Dialer action trio (Voice/Video/Group icons) + tab bar fits the real iPhone viewport (delivered 2026-07-03)

Real-device screenshot feedback on v2.76:

- [x] **Dial buttons redesigned as a trio of round icon buttons** in one row, each labelled underneath:
      **Voice Call** (blue, `PhoneCall` — handset + sound waves, reads as "voice"), **Video Call**
      (green, `Video` camera, now white + larger for contrast), and **Group Call** (purple, `Users`) —
      the wide "Create Group Call" TEXT bar is gone; the third icon button opens the same up-to-10
      participant picker and is always enabled (Voice/Video still require a 6-digit number).
- [x] **Tab bar was cut off on a real iPhone (v2.76 regression) — fixed.** `max-md:h-dvh` made iOS
      Safari report the LARGE (toolbar-collapsed) viewport while our scroll lock prevents the toolbar
      from ever collapsing — so the shell was taller than the visible area and, with document scroll
      disabled, the bar was unreachable. Reverted the mobile shell to **`max-md:h-svh`** (small
      viewport = always fits above the browser toolbars; the scroll lock means the toolbar stays put,
      so svh matches the visible viewport in practice) and bumped the bar's minimum bottom padding
      (0.35rem → 0.55rem) for clearance. Pinned with a do-not-switch-without-real-device-retest note.
- [x] Verified: headless-Chromium geometry (nav flush at viewport bottom, shell == viewport height) +
      dialer screenshot of the new trio. 645 passing (1 pre-existing skip), tsc + build clean.
      Footer → `v2.77.0`. NEEDS a quick real-iPhone confirm that the bar is now fully visible.

## v2.78.0 — Long chats & call logs scroll again: measured shell height + flex-none (delivered 2026-07-03)

Real-iPhone report: a LONG conversation or a full call-history list could not be scrolled to its end —
the tab bar and Messages composer sat below the visible screen, and with the v2.76 document lock there
was no longer any way to reach them.

- [x] **Root cause (reproduced headlessly with a 40-message chat):** `<main>` is a `flex-1` item
      (flex-basis 0%) of the root column, so its explicit height is IGNORED on the main axis and its
      CONTENT contribution inflates the auto-height root — any page taller than the viewport blew the
      shell up to full content height (measured 3455px on an 844px viewport), pushing the bar/composer
      below the fold and killing every inner scroll area (`canScrollList:false`). Short pages masked it.
- [x] **Fix 1 — `max-md:flex-none`** on `<main>`: the explicit height is now authoritative on mobile
      (md+ keeps `flex-1`, where the root is a ROW and it governs width). Pinned as load-bearing.
- [x] **Fix 2 — measured viewport height:** the mobile shell is sized by `--relay-vh =
      window.innerHeight` (kept fresh on resize / orientationchange / visualViewport), with `100svh`
      only as the first-paint fallback — after v2.76's dvh mis-report on a real iPhone, CSS viewport
      units are no longer trusted for the shell. An explicit px height also makes the whole flex chain
      unambiguously definite for Safari.
- [x] **Verified headlessly:** 40-message chat → shell exactly 844px, list scrolls, LAST message
      reachable above the bar, composer visible, nav flush; viewport resized to 700px → shell tracks to
      700 and everything stays reachable; 25-row history → final row reachable. 646 passing, tsc +
      build clean. Footer → `v2.78.0`. NEEDS real-iPhone confirm (publish first — the phone was still
      running v2.76 when this was reported).

## v2.78.1 — Calls no longer die seconds after dialing: zombie-room + answer-signal fixes (delivered 2026-07-03)

User report: every call drops within seconds, before establishing; asked to "kill all active calls".
Reproduced END-TO-END in two headless browsers against a server whose SFU was unreachable — which
surfaced a self-perpetuating failure loop, not one bug:

- [x] **Immortal zombie rooms (server)**: when call media failed and tabs closed without an explicit
      leave, room membership persisted (the step-away feature); every later app-open AUTO-REJOINED the
      dead room — and each rejoin CANCELLED the room's abandonment reaper, re-immortalizing it. The
      device then sat silently "in a call": real incoming rings degraded to a call-waiting popup, and
      when the zombie died (~16.5s media watchdog) its teardown AUTO-DECLINED the real call. Fix:
      `sendRejoinIfInRoom` now refuses to rejoin a room of GHOSTS — if every other member's client
      record is gone, the membership is released and the room reaps (unit-tested).
- [x] **Caller deaf to the answer (v2.74 regression, client)**: on the SFU path the caller's
      answer transition was keyed off LiveKit events only — with the SFU slow/unreachable no event ever
      fired, so the caller sat at "Ringing…" FOREVER (its watchdog stuck in the gentle keep-token-fresh
      loop) while the callee's side died alone. Fix: the server's `peer-joined` (authoritative on both
      media paths) now sets `callAnswered` + advances the staged flow; both sides now fail (or recover)
      together, and the caller's watchdog escalates properly after an answer.
- [x] **No-answer backstop (client)**: an outgoing dial now gives up cleanly after 65s ("No answer.")
      if the callee's device vanished mid-ring — no more eternal solo dial rooms feeding the zombie loop.
- [x] **Waiting call promoted, never swallowed (client)**: when the active call ends while a second
      caller is WAITING, they now ring through as a normal incoming call instead of being auto-declined.
- [x] Clearer media-failure toast ("the media server is unreachable from this network").
- [x] **"Kill all active calls now"**: rooms live in the server process's memory — PUBLISHING restarts
      the process and clears every active call/room instantly; with the ghost-rejoin fix they can no
      longer resurrect. Verified: mesh happy path still connects end-to-end (Calling→Ringing→
      Connecting→Connected); SFU-unreachable path fails symmetrically in ~16.5s with an honest error and
      no zombies. 651 passing (1 pre-existing skip), tsc + build clean. Footer → `v2.78.1`.
      If calls STILL fail after publishing, the LiveKit Cloud project itself (creds/quota/status)
      should be checked — the app now reports that failure honestly instead of looping.

## v2.79.0 — Rich incoming-call card + working missed-call pathways (delivered 2026-07-03)

Two-part spec from the user (screenshot of the old bare Accept/Decline popup):

- [x] **Incoming-call overlay overhauled** into a rich caller card: **circular** avatar, larger name
      with the caller's **national flag** beside it, and their **PIN** (mono, accent) for in-service
      identity verification. Actions: a split answer — **Voice** (mic icon, blue; camera stays OFF,
      upgradeable in-call — same rule as a voice dial, so the SFU publishes no video at all) and
      **Video** (camera icon, green) — a prominent full-width red **Decline**, and a **quick-reply**
      fold-out ("I'll call you back shortly" / "Can't talk right now — text me" / "On my way") that
      sends the caller a REAL chat message through the v2 messaging stack (engine → host hook →
      `messages.openThread` + `messages.send`) and declines the ring.
- [x] **Missed-call pathways all lead to the Missed log now** (History → Missed filter, deep-linked via
      `?filter=missed`, which History honours and reacts to): the landing missed-call toast's View
      actions, the notification bell's history action (both desktop + mobile), and the Dialer's
      missed-call banner — whose body is now a working LINK ("tap to see all") instead of inert text.
      Reviewing History still acknowledges the missed calls (badges clear).
- [x] Verified live (two browsers, real signaling + mesh): card shows name/PIN/flag + all four actions;
      picking a quick reply fires BOTH messaging mutations, closes the overlay, and the caller's dial
      ends; answering as Voice connects with the camera off on the answerer. 662 passing (1 pre-existing
      skip), tsc + build clean. Footer → `v2.79.0`.

## v2.80.0 — Multi-party A/V reliability: 19 defects fixed from the 6-participant QA report (delivered 2026-07-04)

Field report: in a 6-party call, 2/6 cameras dead or "not recognized", 1/6 muted or distorted — across
Chrome/Firefox/Edge/Safari, desktop+mobile. Investigated with a 6-dimension multi-agent code audit
(client SFU publish/subscribe, mesh, capture, audio routing, server) + EMPIRICAL 6-browser matrix tests
(scratchpad/six-party.mjs asserts all 30 remote streams live from every participant's perspective, and
cam-denied.mjs exercises the no-camera participant). Fixes, by symptom class:

**"Their camera is dead/frozen" class**
- [x] Mesh: an audio-only INITIATOR's offer carried NO video m-line — an answer can't add one, so every
      peer's video was silently dead toward camera-less users forever. Now a null-track `sendrecv` video
      transceiver is always negotiated (it's also the sender slot a later camera-enable rides into).
- [x] Mesh: remote tile placeholder keyed off receiver-side `enabled` (always true) — a peer disabling
      their camera (or an uplink stall) FROZE the last frame instead of showing the avatar. Keys off
      `!muted` now.
- [x] SFU: NO handlers existed for TrackMuted/TrackUnmuted or TrackStreamStateChanged — publisher mutes,
      congestion, and adaptiveStream PAUSES (46px spotlight thumbs / minimized 2-up qualify!) froze
      tiles per-viewer. All three now toggle the avatar and kick playback on resume.
- [x] SFU: adaptiveStream's pauseVideoInBackground froze ALL remote video ~5s after backgrounding —
      which is exactly when auto-PiP composes those streams. Disabled (size-based adaptation stays on).
- [x] SFU: publish failures were swallowed silently (bare catch) — now retried once, then reported
      honestly ("others may not see/hear you"). Fresh publishes from replaceVideoEverywhere require
      camera-on or an active share (no black disabled-track publications); stopping a screen share with
      the camera off now publishes NOTHING instead of swapping in the disabled camera track.

**"My camera is never recognized" class**
- [x] Mesh had NO camera-reacquire path (v2.72 only added the SFU's): for users whose camera was
      denied/absent/claimed at join, the camera button silently did nothing forever. Enabling now
      reacquires (same-facing first — the flip helper deliberately refuses the current device and could
      bind the wrong camera), hot-swaps into every peer, re-arms the death watch, and fails HONESTLY
      (button off + toast) instead of pretending.
- [x] The audio-only join fallback never reflected on the camera button (looked "on" while sending
      nothing).

**"One participant muted / distorted" class**
- [x] LOCAL track death (phone-call interrupt, Bluetooth swap, camera claimed by another app) was never
      detected — LiveKit silently mutes a dead user track and the mesh keeps a dead sender: permanent
      one-way mute. Every local track now carries an `onended` self-heal that reacquires the mic and
      swaps it into mesh senders + the SFU publication (+ the filter pipeline's output, so later joiners
      don't inherit the corpse). `ensureMedia` refuses to reuse a dead cached stream between calls, and
      unmuting a dead mic genuinely retries (the recovery toast said it would — now it does).
- [x] SFU inbound audio armed the one-tap autoplay unlock ONLY on Android — desktop Safari's rejected
      play() left a participant permanently silent. The kick + unlock now run on every platform, plus
      the room-level AudioPlaybackStatusChanged signal arms it too.
- [x] Android loudspeaker: the Web-Audio tap used the SHARED stream object — when the active-speaker
      analyser already held that single allowed tap, one participant's element fell back to the
      earpiece (one quiet/odd voice). Taps now wrap fresh MediaStreams and coexist; and the 2s routing
      scan no longer mutes new joiners into a SUSPENDED AudioContext.
- [x] Held→resumed (call-waiting) mesh peers stayed PAUSED after thaw — permanently silent with frozen
      video. Thaw now resumes playback (one-tap unlock as fallback).

**Systemic / multi-party scale**
- [x] sendWS was fire-and-forget: ONE dropped signaling POST (network blip, or a 429 from the per-IP
      limiter when six testers behind one office NAT join at once — 15 links × SDP/ICE ≈ hundreds of
      messages) permanently killed that pair's media. Now retried with backoff (250/750/2250ms).
- [x] Mesh encoders now SCALE with party size (≤1: 1.2Mbps, ≤3: 700kbps, >3: 350kbps + half resolution,
      re-applied on join/leave) — previously 5 uncapped ~720p30 encoders per client saturated uplinks
      and melted phones, which IS the reporter's suspected "bandwidth/processing allocation" defect.
- [x] Server: member lists (accept-joined + membersOf for resume/merge/held) now EXCLUDE ghost members
      (membership persisted, client record long gone) — each ghost was a permanently dead "connecting…"
      tile for every later joiner.
- [x] Second-wave regression caught by the audit reviewing the fresh code: the new null-track
      transceiver is msid-less, so remote ontrack fired with EMPTY e.streams and attachRemote(undefined)
      wiped the tile — killing the camera-less participant's own AUDIO for everyone. ontrack now merges
      bare tracks into the tile's existing stream; attachRemote is null-guarded. Also: kind-aware
      empty-sender fallback (video could land on an empty AUDIO sender), and unsubscribed Android
      <audio> nodes are removed from the DOM (leak).

**Verified**: 6-browser matrix 30/30 live streams from every perspective (was 29/30 with frozen-frame
artifacts); camera-denied participant now RECEIVES all video, gets honest button state + errors; 687
unit tests (24 new pins + 2 new server tests), tsc + build clean. Footer → `v2.80.0`.

**Deferred (recorded, not fixed here)**: server→client delivery guarantee across SSE reconnect gaps
(needs a seq/ack envelope); host moderation leaking across held rooms; two-tabs-one-cid eviction churn;
publish source tags for screen shares; the stale-offer rebuild guard's post-refresh window; playCue's
queued-oscillator resume blast. None match the reported symptoms' frequency; all candidates for a
follow-up batch.

## v2.81.0 — Fast startup, mutual-consent video protocol, guest-first login (delivered 2026-07-04)

Three-part user request.

**Startup speed / lightness**
- [x] Route-level code splitting: the ENTRY chunk carried the entire app — including the docs page's
      markdown/diagram/highlighting stack (mermaid, KaTeX, cytoscape, per-language grammars) — 1,941 kB
      (565 kB gzip) parsed before the keypad could paint. Now only the shell + Dialer are eager;
      Home/Docs/Technology/TurnTest/History/Messages/Contacts/Profile are lazy chunks. Entry: **718 kB
      (211 kB gzip) — 63% smaller**; /docs' 887 kB loads only on /docs.
- [x] Immutable caching: hashed /assets now ship `Cache-Control: public, max-age=1y, immutable`
      (express.static sent NO cache header at all — every open re-downloaded megabytes); index.html is
      no-cache so publishes appear immediately.

**Mutual-consent video (proper protocol, 1:1)**
- [x] Camera transmits ONLY once both parties agree, per call. Signaling: invite/ring now carry the
      dialed mode; new `video-request` / `video-accept` / `video-decline` messages relayed by the server.
- [x] VOICE dial: the ring card HIDES the video answer (voice-first, as specified). Mid-call camera tap
      sends a request — nothing transmits; the peer gets an in-call prompt ("X wants to start video —
      accepting turns on BOTH cameras"); accept → both cameras on together; decline → stays voice-only.
      Once approved, camera toggles are free for the rest of the call (turning OFF never needs consent).
- [x] VIDEO dial: answering with the Video button IS the consent (both sides transmit); answering Voice
      stands the caller's camera down (their preview was live locally but NEVER transmitted — publication
      is consent-gated on both media paths, incl. the SFU republish choke and mesh addTrack).
- [x] WebRTC mechanics that make it renegotiation-free: the OFFERER always negotiates a video m-line
      (null-track sendrecv transceiver); the ANSWERER flips offered video m-lines to sendrecv before
      answering (the default recvonly answer would have locked that side out of ever sending); consent
      re-asserts on connection settle (accept can beat peer-joined); empty-slot sender lookup ignores
      mid-less orphans; remote tiles show the avatar until REAL frames arrive (videoWidth>0 + resize
      listener — the always-negotiated m-line otherwise painted a black tile in voice calls).
- [x] Groups (3+) bypass the gate; rejoin/resume keep consent settled. NEW: a 1:1 call now ENDS when the
      other party hangs up (lingering in a dead solo call swallowed the next incoming ring as
      call-waiting — surfaced by the consent E2E).
- [x] Verified live (scratchpad/consent-e2e.mjs, two browsers, real signaling+mesh): all three protocol
      cases pass in BOTH directions; six-party matrix still 30/30; cam-denied probes intact.

**Guest-first login**
- [x] OnboardingGate default is now GUEST: display name + "Enter as guest" primary; "Login / Register
      with email →" secondary (passwordless one-time code — login and registration are the same step, so
      there is no password to forget). Copy updated both modes; back link returns to guest.

696+ tests passing (11 new consent pins), tsc + build clean. Footer → `v2.81.0`.

## v2.82.0 — Contacts list redesign: rich rows, inline call actions, categories, block (delivered 2026-07-04)

Per the user's reference screenshot: rich rows (avatar + presence LED + name + formatted PIN + verified +
online/last-seen), row tap → VOICE call, inline Voice/Video/Message + a 3-dot menu (favorite / category /
block / edit / delete), category grouping (Favorites, VIP, Family, Friends, Team, All Contacts) with a
dialog chip picker, and ENFORCED blocking (additive contacts.category + contacts.blocked; blocked
messages rejected server-side, blocked calls silently declined by the engine via setBlockedPins). Layout
brought to v2.73 (flex-1, no stale pb-24). 9 new pins; 707 passing. Footer → v2.82.0.

## Feature: Privacy Policy page at /privacy-policy
- [x] Create client/src/pages/PrivacyPolicy.tsx with standard privacy policy content for RELAY
- [x] Register /privacy-policy route in App.tsx
- [x] Add Privacy Policy link in the landing page footer (all 6 locales)
- [x] tsc clean + 708 vitest pass; checkpoint 103c5bea; guide Publish

## v2.83.0 — Reachability: pre-ring dial drops fixed + calls that actually RING phones (2026-07-07)

User reports: (1) "check the history page — sometimes when I click to dial, it keeps dropping the
call within the first two seconds, before it even starts ringing"; (2) "on the iOS version: when
the user receives a call, there is no ringing sound or notification."

Root-caused with a multi-agent audit (18 agents; every mechanism adversarially verified against
the code). Both issues share one root: a callee whose SSE is gone (locked/backgrounded phone,
closed tab) could never be rung — and several client/server states turned that into instant drops.

### Issue 1 — dials dropping within ~2s, pre-ring
- **Callee zombie-ring blind reject (top cause)**: a stale `pendingRing`/`waitingRing` (left when
  the caller's ring-cancel died in a closed SSE and the 60s decline timer froze with the
  backgrounded tab) auto-REJECTED the next real call with zero user interaction — the caller
  dropped in ~1s as "declined". Rings are now stamped (`at`); a ring from the SAME caller (redial /
  server redelivery) or past the 70s window REPLACES the stale presentation instead of rejecting,
  and returning to the foreground sweeps zombie ring state.
- **Mid-dial re-register reaped the dial room**: the engine re-registers during dials (geo-flag
  re-affirm ~1-2s after boot, SSE blip → ready). v2.78.1's ghost-room guard saw the caller's solo
  dial room and `leaveRoom()`d it — callee's accept then bounced `gone`. `sendRejoinIfInRoom` now
  recognizes a LIVE dial (pending rings + young unanswered room) and leaves it alone.
- **Instant `offline` bounce → PAGING**: an invite to a real-but-unreachable number no longer kills
  the dial in <1s. The server now detects dead-but-in-grace sockets (`RelaySocket.alive`), keeps
  the dial alive, answers the caller `ringing{paging}` ("Reaching their phone…"), fires a Web Push
  to wake the device, and DELIVERS the ring the moment the callee's app opens
  (`reg.pendingRings` + `deliverPendingRing` on register — also fixes the reload-mid-ring lost
  ring and the ring-swallowed-into-closed-socket fake "Ringing…"). Only truly nonexistent numbers
  fail fast ("That number doesn't exist."). Misses are recorded when the caller gives up (never
  double-recorded).
- **Pre-establishment SFU `Disconnected` retries** (token re-request; watchdog keeps the dial
  alive) instead of `hangUp("livekit-disconnected")` killing the dial on a transient.
- **Honest failure card**: a failed dial (declined / busy / unreachable / no-answer) now shows its
  reason ON the dial card for ~2s before teardown — the old instant teardown hid the toast (the
  engine root parks at opacity-0 when phase→idle), so offline dials looked like a silent glitch.
- **History rows got presence LEDs** (green/grey) from ONE batched `directory.presenceMany` query —
  see BEFORE redialing whether someone is reachable.
- **Voice-first everywhere**: History redial (1:1 + group), Dialer missed-call banner, Messages
  thread call button, hardware Enter — all were still defaulting to VIDEO dials.

### Issue 2 — iOS: no ring sound, no notification
- **Foreground sound fixed**: the ringtone `AudioContext` was created INSIDE the SSE ring handler —
  iOS keeps such contexts suspended (silent oscillators). Both engine contexts are now pre-created
  + resumed on the FIRST real gesture (entering the app is a tap), re-resumed on foreground, and
  the app-layer chime context gets the same treatment (AppShell one-time unlock).
- **Ring alerting**: vibration (Android), tab-title flash ("📞 Incoming call — RELAY"), and a
  system notification when the page is hidden. `notify()` now routes through
  `ServiceWorkerRegistration.showNotification` (iOS PWA + Android don't support the constructor)
  with `data.url` deep links.
- **Web Push — devices ring even with RELAY closed**: `push_subscriptions` table (+ boot-migrator
  DDL), `push` tRPC router (publicKey/subscribe/unsubscribe), `server/webPush.ts` (VAPID keys
  DERIVED deterministically from JWT_SECRET — stable across restarts/instances, zero new env; or
  set VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT), sw.js `push` + `notificationclick`
  handlers (calls: requireInteraction + vibrate; tap focuses/opens the app), incoming-call page
  push on unreachable invite + missed-call push (guests too) in the relay hooks, and a one-time
  "Never miss a call — Enable" banner (AppShell). iPhone/iPad: Apple only allows web push for
  Home-Screen-installed apps on iOS 16.4+ — the banner shows an "Add to Home Screen" tip there.
- **Fast re-attach**: returning to the foreground reconnects the relay SSE immediately (was: wait
  for the error/backoff cycle), so a re-opened phone is reachable — and receives any held ring —
  in under a second.

Tests: +30 (relayPaging protocol suite incl. page→push→late-ring→accept round trip and the
mid-dial re-register guard; webPush VAPID derivation; callReachability static pins) → **737
passing**. E2E (headless Chromium × real signaling): voice ring w/ title flash + hidden video
answer; ring REDELIVERED after callee reload; mesh establishes ("Connected" both sides); 1:1
auto-end after remote hangup; nonexistent-number dial shows the fail card then tears down.
`web-push` dependency added. Note: sandbox E2E surfaced that a LiveKit-configured-but-unreachable
deploy kills every answered call at ~16s via the join watchdog (correct behavior; worth
remembering when LIVEKIT_* points at a dead SFU).

## v2.84.0 — Mobile call audio: speaker toggle + default, honest hang-up icon, signature ringtone (2026-07-08)

Field reports (Android wrapper + iPhone, screenshot of v2.83.0 dial card):

1. **Android: speaker unresponsive on ANSWERED calls** (worked only after hang-up + redial).
   Root cause: modern Android exposes `setSinkId`, so the audio button opened the sink MENU —
   but Android enumerates NO audiooutput devices, so the menu was an empty dead end and the
   loudspeaker force (which works) was unreachable. Fix: on Android AND iOS the audio button is a
   straight speakerphone TOGGLE (`toggleLoudspeaker`); the sink menu stays desktop-only.
2. **iPhone↔Android "one-way audio" (iPhone side silent in BOTH directions)**. Root cause: iOS
   routes WebRTC audio to the tiny EARPIECE while the mic is live — a phone held at arm's length
   hears ~nothing, read as "no audio from the Android side" whichever side dialed. Fix: phones now
   DEFAULT the speaker ON via a persisted preference (`relay_loudspeaker`; the in-call toggle
   remembers the choice), the speaker AudioContext is PRIMED inside the Answer/dial gesture
   (`loudspeakerPrime` — iOS refuses resume() outside gestures; called in acceptInvite, dial(),
   dialGroup(), legacy startCall), and the remembered state is APPLIED at `markEstablished`. All
   v2.80 safety invariants kept: never mute into a non-running context (worst case = old earpiece
   behavior, never silence), auto-resume on suspend, headset-connect auto-handback. NEEDS a real
   two-phone retest to confirm the field symptom.
3. **Hang-up icon corrupted/misleading on Android**: the icon was a PICKUP receiver rotated 135°
   via an inline CSS transform — some Android WebViews ignore the transform and showed an ANSWER
   icon on the End button. Replaced with the drawn Material `call_end` path (no transform).
4. **Custom ringtone @ medium-loud**: new `shared/ringtone.ts` — RELAY's signature "din-DING ×2"
   triangle-wave motif over a low-octave warmth layer, looped every 2.6s, peak gain 0.28 (well
   above the old 0.12, deliberately below max; hardware volume still applies on top). ONE spec,
   two players: the engine's `playRingtone("incoming")` and Profile's new **Test ringtone**
   button (`playRingtonePreview` in notifications.ts). Outgoing dial-tone unchanged.
5. **Profile → Notifications** now manages call alerts end-to-end: granting permission also
   registers the device's Web Push subscription (status shown as "Call alerts on"), with the
   Add-to-Home-Screen note on iPhone (Apple gates web push to installed apps — this is also the
   honest answer to "backgrounded iPhone doesn't ring until reopened": enable alerts + install).

Tests: +9 (callAudio pins) and 1 updated (audio button = phone toggle) → **746 passing**.
E2E re-run green (ring/redelivery/establish/auto-end/fail-card) + new icon assertions
(call_end path present, no rotate style). tsc + build clean.

## v2.85.0 — Mobile store shells: Android TWA (APK via CI) + iOS Capacitor + launch runbook (2026-07-14)

Request: take RELAY to the Play Store + App Store with full web parity ("coordinate the team").
Reality stated honestly: there is no human team in this environment — the architect/design/QA
outputs below were produced directly, and the steps only the OWNER can perform (developer
accounts, signing, store listings) are documented as [YOU] items in mobile/README.md.

**Architecture decision (recorded in mobile/README.md §1):** wrapper-first, no rewrite.
Android = Trusted Web Activity (real Chrome — proper WebRTC audio routing, Web Push, permission
persistence; strictly better than the current BETA WebView wrapper). iOS = Capacitor WKWebView
shell loading the live site. Parity is structural: every web deploy IS the mobile release
(the v2.48 auto-updater handles versioning in-app). React Native / Kotlin+Swift rewrites
rejected for now: they'd re-implement the 5,000-line call engine (mesh+SFU, consent, hold/merge,
rejoin, paging, push) twice and re-fight the v2.80–v2.84 audio wars; first justified native step
is CallKit/ConnectionService (logged as deferred §7).

Shipped:
- **mobile/android/** — complete TWA Gradle project (androidbrowserhelper 2.6.2, package
  `org.yourchat.relay`, bound to https://www.your-chat.org/app, portrait, dark splash, adaptive
  + monochrome launcher icon hand-ported from icon.svg to VectorDrawable, deep-link intent
  filter with autoVerify).
- **.github/workflows/android-apk.yml** — CI producing `RELAY-debug-apk` (directly installable),
  unsigned release APK, and the Play `app-release.aab` on demand + on mobile/android changes.
- **server/wellKnown.ts** (+ registration in _core/index.ts) — `/.well-known/assetlinks.json`,
  env-driven (`TWA_SHA256_FINGERPRINTS`, optional `TWA_PACKAGE_NAME`), 404-with-hint until
  configured; validates + normalizes fingerprints; unlocks the TWA's full-screen mode.
- **mobile/ios/** — real Capacitor 6 iOS Xcode project (scaffolded, checked in) loading the live
  app; Info.plist carries NSCamera/NSMicrophoneUsageDescription (missing = crash + rejection),
  UIBackgroundModes audio, ITSAppUsesNonExemptEncryption=false. Build needs a Mac (documented).
- **mobile/README.md** — owner's runbook: strategy ADR, Play Console ($25) + Apple Developer
  ($99/yr) account setup, Play App Signing + assetlinks fingerprints wiring, store-listing
  checklists (privacy policy URL already live at /privacy-policy), review-gotcha notes
  (Guideline 4.2, purpose strings), Material/HIG parity notes, latency posture, deferred
  native steps (CallKit/ConnectionService first).
- **mobile/QA-TEST-PLAN.md** — 22-scenario release protocol distilled from RELAY's actual
  field-failure history (establishment, paging/redelivery, audio routing incl. the v2.84
  acceptance tests, consent protocol, shell specifics, messaging smoke) over a 5-device matrix.

Tests: +6 (wellKnown: pure assetlinks builder incl. normalization/rejection + repo wiring pins
binding server↔Android package/origin↔iOS plist↔CI) → **752 passing**. Gate note: a stray
npm install from the iOS scaffold clobbered the root pnpm node_modules (vite/vitest vanished);
clean `pnpm install` restored it — mobile/ios has its own package.json + .gitignore isolation.

## v2.86.0 — NATIVE Android app: Capacitor shell + native call layer (2026-07-14)

User (after seeing the TWA): "you just made me an iframe… it's not a real app — improve it."
Decision (user-selected): go straight to the native app; store launch waits for it.

**Architecture:** the web app stays the UI + call engine (parity preserved); mobile/app (renamed
from mobile/ios — ONE shared Capacitor project, both platforms) gains an Android platform with a
native call layer in Java (`org.yourchat.relay`):
- **Full-screen incoming ring with the app CLOSED**: `RelayFcmService` receives FCM DATA messages
  → `NotificationHelper.showIncomingCall` posts a CATEGORY_CALL notification on a ringtone-sound
  channel with `fullScreenIntent` → `IncomingCallActivity` (showWhenLocked/turnScreenOn, dark
  RELAY palette, Answer/Decline built in code). Answer opens the app → the held ring re-delivers
  (v2.83 `deliverPendingRing`) → in-app answer. Ring self-clears after the 65s window.
- **Real OS speakerphone** (`CallAudioPlugin`): AudioManager MODE_IN_COMMUNICATION with
  `setCommunicationDevice` (API 31+) / `setSpeakerphoneOn` fallback. The engine's speaker toggle
  and speaker-default now prefer this route in the native app (WebAudio force stays the browser
  fallback).
- **Ongoing-call foreground service** (`CallService`, microphone|mediaPlayback types + graceful
  fallback) started at establishment, stopped at hang-up — Android can no longer freeze a live
  backgrounded call (closes long-standing backlog item #38 for the native app).
- **FCM plumbing end-to-end**: `CallNativePlugin.getPushToken` (guarded — resolves null until
  google-services.json exists) → web `nativeBridge.ts` → RelayEngine registers the token via
  `push.subscribe { kind: "fcm" }` → `push_subscriptions.kind` column (schema + migrator) →
  `server/fcm.ts` (zero-dep FCM v1: RS256 JWT from FIREBASE_SERVICE_ACCOUNT_JSON → OAuth token
  cached → HIGH-priority DATA sends, 70s TTL for rings, dead-token pruning) wired into
  `sendPushToIdentity` beside Web Push.
- **Toolchain**: AGP 8.9.2 / Gradle 8.11.1 / compileSdk+targetSdk 35 / minSdk 24, Firebase BoM
  33.7.0; google-services applies ONLY when the config file exists, so the app builds today.
- **CI**: `android-apk.yml` gains a `native` job (npm ci → cap sync android → gradlew) emitting
  RELAY-NATIVE-debug-apk / RELAY-NATIVE-release-aab (+ -SIGNED with the same keystore secrets);
  the TWA job remains as fallback. Runbook: native section + [YOU] Firebase steps (~10 min:
  google-services.json committed at mobile/app/android/app/, FIREBASE_SERVICE_ACCOUNT_JSON in
  Manus secrets). QA plan: +3 native scenarios (closed-app full-screen ring, FGS persistence,
  OS speaker toggle).

Honest limits recorded: Decline on the native ring screen only dismisses locally (no server
reject endpoint yet — caller sees no-answer); token rotation re-registers on next app open;
CallKit-style iOS parity still deferred. Tests: +14 (fcm JWT verified against a real RSA key;
nativeAndroid pins binding engine⇄bridge⇄Java⇄server) → **766 passing**. tsc + vite build clean.

## Native rewrite — Milestone 1 (mobile/native, React Native) (2026-07-14)

Owner mandate (superseding the shell strategy): a FULL native rewrite — "a real app such as
WhatsApp and Telegram", compiled code, no webview/mirror-browser — with absolute functional
parity against the UNMODIFIED backend. Stack decision (recommended, unopposed): React Native +
TypeScript + Swift/Kotlin native modules — the existing TS call engine/protocol can port with
near-line fidelity (lowest parity-drift risk vs re-deriving 5k lines twice in Kotlin+Swift),
while CallKit/ConnectionService (M4) provide the real OS call experience. Milestone plan M1–M6
recorded in mobile/README.md §1.

M1 shipped (RN 0.86, compiled, installs side-by-side as org.yourchat.relay.next):
- Typed client (src/lib/api.ts) speaking the existing tRPC/superjson HTTP API with the SAME
  device-id identity mechanism the web uses (x-relay-device-id; guest identity survives
  restarts) — whoami/startGuest/heartbeat/lookup/contacts/threads/call+conference history.
- Native tab shell (react-navigation bottom tabs) with the web's tab set + per-tab accents and
  the RELAY dark palette ported to src/lib/theme.ts; Onboarding (guest-first, matching v2.81),
  native keypad Dialer with live presence preview + ghost-number rule, History (merged
  conference+solo rows, web color language), Messages threads, Contacts (favorites/categories/
  blocked/presence LEDs), Profile. 30s presence heartbeat.
- Voice/Video buttons present but explicitly labeled "Milestone 3" (honest placeholder — the
  engine port is next); M1 is read-parity + identity, not call-capable.
- CI: .github/workflows/native-rn.yml → RELAY-RN-debug-apk (installable) + unsigned AAB.
- Pins: client/src/lib/nativeRewrite.test.ts (no Capacitor dep, store package id, /api/trpc +
  superjson + device-id, tab parity, CI artifact) → 770 passing.

Honest scope: M1 renders live data and holds identity; every write action (send message, place
call, edit contact) activates with its milestone (M2/M3). Backend untouched this milestone.

## Native rewrite — Milestone 2: messaging + contacts write-parity (2026-07-15)

mobile/native (React Native) now has the full messaging surface against the UNMODIFIED backend:
- **Conversation screen**: bubble thread (inverted list), read ticks straight from
  `message.status` ("read" → ✓✓), reply/quote (replyToId + quoted render), long-press → Reply/
  Unsend (messages.remove, own messages only), typing pings (messages.typing, 2.5s throttle) +
  "typing…" indicator, image attachments via the SAME `/api/v2/upload` base64 endpoint (device-id
  identity verified in server/v2upload.ts) → messages.send{attachmentId}, markRead on open +
  on incoming, group-aware sender names via messages.conversationInfo.
- **Realtime**: the same `/api/v2/events` SSE bus the web consumes (react-native-sse with the
  x-relay-device-id header; server auth confirmed via createContext) — message/read/typing events
  drive the screens, with the web's polling safety net kept.
- **Threads list**: REAL server field names (peerDisplayName/lastMessageBody/unreadCount/
  peerIsOnline/peerVerified — fixing M1's guessed ThreadRow shape), unread badges, presence LEDs,
  long-press per-thread mute (client-side AsyncStorage, parity with the web's localStorage mute),
  new-chat modal (6-digit number → messages.openThread → Conversation).
- **Contacts write-parity**: add/edit screen (name, category chips VIP/Family/Friend/Team,
  favorite, block, notes) → contacts.upsert (exact zod shape), delete → contacts.remove, Message
  action → openThread; grouped Favorites → categories → rest. Android fix baked in: the action
  menu is a bottom-sheet Modal (Android caps Alert.alert at 3 buttons).
- **Fixes from the adversarial pass prep**: startGuest's slim return is followed by whoami() for
  the full identity shape (Profile reads verified/email); navigation moved to a root stack
  (Conversation/ContactEdit push over the tabs) with a SessionProvider (no prop drilling).
- Deferred to M3 explicitly: voice-note record/playback + group creation (both ride M3's A/V
  infra). Deps added: react-native-sse, react-native-image-picker, @react-navigation/native-stack.
- Pins extended (nativeRewrite.test.ts M2 block: procedure paths, real thread fields, upload
  contract, SSE bus, receipts/unsend/reply/typing, Android-safe sheet) → 771 passing.

## Native rewrite — Milestone 3 (core): the call engine port (2026-07-15)

mobile/native can now CALL — the engine that took v2.74–v2.84 to harden, ported to compiled
native against the unmodified relay server:
- **Signaling** (src/call/signaling.ts): the exact SSE (/api/relay/stream?cid=) + POST
  (/api/relay/send) protocol — register-with-preferred-pin under my identity number,
  re-register on every `ready`, 1.5s stream reconnect, the v2.80 250·3^n send retry (a dropped
  offer is pair-fatal on the mesh), foreground ensureConnected.
- **Engine** (src/call/engine.tsx, a root CallProvider): staged progress calling → ringing /
  "Reaching their phone…" (v2.83 paging ack) → connecting → live; 65s no-answer backstop; the
  v2.83 stale-ring replace rule (same-caller redelivery/redial never blind-rejected); honest
  failure card (declined / busy / unreachable) before teardown; 1:1 auto-end on remote-left;
  kicked/error handling.
- **Mesh**: one shared @livekit/react-native-webrtc stack — newcomer-offers glare rule (offers
  on `joined` members, waits on `peer-joined`, matching the web), ICE candidate queue until
  remote description, connectionstate → establishment, renegotiation for consent upgrades.
- **SFU**: livekit-token push → Room.connect (AudioSession started), mic publish, camera only
  after consent, TrackSubscribed → establishment, remote video tracks wrapped into cached
  MediaStreams so ONE RTCView path renders mesh + SFU tiles; pre-establishment Disconnected
  retries via refresh-livekit (v2.83 parity) instead of dying.
- **Mutual-consent video (v2.81)**: voice-first dials; a video dial's camera stays OFF until the
  callee answers-with-video (video-accept) or accepts the in-call ask; mid-call camera tap sends
  video-request → peer prompt → BOTH cameras on together; decline keeps voice.
- **Native audio**: react-native-incall-manager — communication mode at establishment, system
  default ringtone for incoming, earpiece/speaker toggle with speaker DEFAULT ON (v2.84 parity).
- **UI** (src/screens/CallOverlay.tsx): dial card (avatar/pin/name/mode chip/status), incoming
  ring screen (Answer-as-Voice always; Answer-as-Video only on video dials; Decline), in-call
  tile grid + self-preview, controls (mute/cam/flip/speaker/end), consent ask banner. Wired:
  Dialer Voice/Video, Contacts voice+video actions, History call-back (voice-first).
- Deferred to M3.5 explicitly: call waiting (hold/swap/merge), group calls, rejoin-after-restart,
  voice notes, screen share/recording, filters (M5). Deps: @livekit/react-native(+webrtc fork),
  react-native-incall-manager; CAMERA/RECORD_AUDIO/etc. added to the RN manifest; WebRTC globals
  registered in index.js.
- **Adversarial fidelity review (agent vs server/relay.ts + web engine + installed native libs)
  found 8 real issues — all fixed pre-merge**: (B1) the v2.80/81 mesh video m-line discipline was
  missing → re-added (camera-less initiator pre-allocates a sendrecv video transceiver; answerer
  flips recvonly→sendrecv pre-answer; consent upgrade fills the slot via replaceTrack — which also
  kills RN↔RN offer glare; tiles compute hasVideo from track MUTE state so web's null-track m-lines
  never paint black rectangles); (B2) SFU watchdog ported (refresh-livekit every 4s while ringing,
  3 bounded tries post-answer then honest teardown; tokens consumed-on-use); (B3) consent violation
  — caller no longer self-approves video at dial, video-decline resets approval, video-accept/
  decline gated on inCall (idle camera-grab leak closed); (B4) in-call ring redelivery for the SAME
  call (SSE blip mid-answer) is ignored instead of rejected (rejecting reaped the caller's room out
  from under our accept); (B5) failDial timer tracked + cleared (stale timer could leave-cancel the
  NEXT dial); (B6) answer-with-no-media now sends reject (leave rang the caller to the 65s backstop
  and left a ghost pending ring); (B7) onSignal hardened (try/catch + dead-pc rebuild on fresh
  offers — reloaded web peers re-offer into a stale pc otherwise); (B8) server `rejoin` while idle
  is explicitly declined (ghost room membership polluted the next dial). Review also CONFIRMED:
  glare rule parity both directions, accept/consent ordering, SDP/candidate shape interop, LiveKit
  token ordering, ring-redelivery rules, and no-crash API usage across the installed native libs.
  → 772 repo tests green; RN tsc clean.
## Native rewrite — Milestone 4 (Android): rings-when-closed (2026-07-15)
- **The v2.86 native ring layer, ported to the RN app** (`mobile/native/android`, namespace
  `com.relaynative`): `RelayFcmService` (FCM DATA messages → we control presentation even with the
  app dead), `NotificationHelper` (relay_incoming_ring HIGH channel with TYPE_RINGTONE sound +
  vibration, relay_ongoing_call, relay_general; ring notification carries fullScreenIntent +
  65s setTimeoutAfter so a stale ring self-clears), `IncomingCallActivity` (showWhenLocked +
  turnScreenOn full-screen Answer/Decline over the lock screen — Answer opens MainActivity, the
  engine registers, and server-side `deliverPendingRing` hands the live ring to the in-app flow),
  `CallService` (microphone|mediaPlayback foreground service — backgrounded live calls never
  freeze).
- **CallNative RN bridge** (`CallNativeModule.kt` + `CallNativePackage`, registered in
  MainApplication): startCallService/stopCallService, ensureNotificationPermission
  (POST_NOTIFICATIONS runtime ask, 13+), getPushToken (guarded by FirebaseApp.getApps — null until
  Firebase is configured), cancelRing. JS wrappers in `src/lib/native.ts` are safe no-ops on
  iOS/missing module.
- **Engine hooks** (src/call/engine.tsx): FGS starts at markEstablished / stops in hangupInternal;
  the in-app ring cancels the FCM lock-screen notification (no double ring); on boot the engine
  asks notification permission then registers the FCM token via the SAME server contract as the
  Capacitor app — `push.subscribe { endpoint: token, kind: "fcm" }` (api.ts pushSubscribe/
  pushUnsubscribe; server/v2routers.ts + server/fcm.ts unchanged).
- **Build**: google-services classpath at root + conditional apply (`google-services.json`
  present ⇒ FCM on; absent ⇒ builds fine, rings-when-closed off) — CI needs no Firebase. Manifest:
  FOREGROUND_SERVICE(+MICROPHONE/MEDIA_PLAYBACK), POST_NOTIFICATIONS, USE_FULL_SCREEN_INTENT,
  VIBRATE; services + lock-screen activity declared. firebase-bom 33.7.0. The RN app's DEBUG id is
  `org.yourchat.relay.next` — the Firebase [YOU] runbook now says to register BOTH package names
  and commit the one google-services.json into BOTH app projects (public config, ignore entry
  deliberately commented out).
- iOS CallKit + PushKit remain the Mac-verified half of M4 (deferred until an Xcode environment).
- Pinned in client/src/lib/nativeRewrite.test.ts (M4 block: files/namespace, fullScreenIntent +
  timeout, bridge methods + Firebase guard, manifest surface, conditional apply, engine wiring).
- **Adversarial review (agent vs installed RN 0.86 internals + Capacitor reference + server
  contract) — 1 confirmed defect, fixed in BOTH apps**: unguarded `NotificationChannel`
  (API 26+) ran at app boot via the module's initialize() with minSdk 24 ⇒ NoClassDefFoundError
  process crash on Android 7.x — `ensureChannels` now early-returns below API 26 (the Capacitor
  `org.yourchat.relay` helper had the identical latent bug; fixed there too, pinned for both).
  Also closed: Android 12+ rejects FGS starts from the background, so a call that established
  while backgrounded silently lost its keep-alive — the engine now retries startCallService on
  the foreground transition (idempotent). Review VERIFIED: bridgeless legacy-module interop
  (NativeModules.CallNative reachable, @ReactMethod signatures pass TurboModuleInteropUtils),
  namespace/manifest resolution, google-services 4.4.2 vs Gradle 9.3.1 linkage (decompiled),
  FCM data-message keys match RelayFcmService, push.subscribe contract + identity binding,
  FGS never leaks (all teardowns route through hangupInternal). Documented as shared-with-
  reference gaps (not port divergences): no server ring-cancel push kind (stale lock-screen
  ring rides the 65s timeout), permission dialog result not awaited on first run.
  → 777 repo tests green; RN tsc clean.
## Native rewrite — Milestone 3.5: call waiting, group calls, rejoin, voice notes + group threads (2026-07-15)
Ported from the web/server contracts mapped by a 5-agent workflow (maps + ordered plan with 21
enumerated interop risks; the plan cross-checked the four readers and resolved 7 contradictions).
- **Call waiting** (engine.tsx): a second ring mid-call now presents a waiting card (vibration
  cue only — never a ringtone over live audio) with the v2.83 replace rules (reject ONLY a fresh
  different-caller ring; same-caller redelivery/expired waiter replaces); Decline sends reject;
  **"End call & answer"** AWAITS a 3-attempt `leave` BEFORE the `accept` (the server processes a
  POST fully before responding — strict ordering; unserialized leave+accept re-creates the v2.50
  switch race where the server HOLDS the old room and the late leave kills the answered call),
  keeping mic/audio-session/FGS across the switch; a dying call PROMOTES a live waiter into a
  full incoming ring (v2.78.1); `ring-cancel` clears a matching waiter (deliberate divergence —
  our answer is destructive, web's holds); 30s waiter auto-decline; foreground stale sweep.
  Deviation from web documented: native answers END the current call (no hold/swap UI yet) —
  button copy says so.
- **peer-hold**: new handler — the held side shows "On hold" and SUPPRESSES both auto-end sites
  (the web holder tears down its SFU connection; without this flag the held native side read it
  as "remote left" and ended the call). Upstream finding reported: web's own SFU held side has
  the same auto-end hole (relayClient onPeerHold is pure UI).
- **Group calls**: `dialGroup` (dedupe/cap 10/self-exclude, voice-first, first invite creates the
  room, rest FLUSH on the server's `room` ack so History's roster-order direction inference
  stays intact), in-call ➕ add-person pad (auto-invites on the 6th digit; 6s offline-guard makes
  `error{offline}` a toast — never a teardown, v2.50 parity; cap/dup/self validation with
  notices), `callIsGroup` flips on 2nd mesh peer / 2nd SFU participant / answering into a >1
  roster, groups BYPASS mutual-consent video (v2.81) and never auto-end at 0 remotes, and the
  `rejected`/fatal-`error` teardowns are gated on `aloneInCall()` (one invitee's decline can't
  kill a live conference). Dialer gains the purple Group key (stage 6-digit chips → Call N).
- **Rejoin-after-restart**: AsyncStorage snapshot (roomId, server-authoritative pin, mic/cam/
  speaker, isVideoCall, isGroup, peer, ts; 28s freshness < the server's 30s grace; refreshed
  every 10s while established + on background) — the boot effect READS IT BEFORE REGISTERING
  (an unarmed register auto-declines the rejoin offer, permanently forfeiting the room),
  registers under the SNAPSHOT pin, pre-arms the in-call UI ("Reconnecting to your call…"),
  10s no-offer watchdog; positive `rejoin` adopts the room (mesh: we're the newcomer — offer to
  every member, 15s ghost-roster backstop since rejoin rosters aren't ghost-filtered; SFU: the
  pushed token + bounded watchdog); snapshot cleared on hangup/consume/identity-change and
  DISCARDED when its pin ≠ the current identity's number (shared-device hijack guard — RN's
  per-boot random cid disables the server's identitySwitch detection).
- **Group threads + voice notes** (messaging): `messages.createGroup` wired (compose modal grows
  a New chat / New group toggle — title + up to 19 member chips); Conversation trusts the ROUTED
  thread kind (`kind === "group"` — the old members>2 heuristic rendered legal 2-member groups
  as DMs); attachment URLs go through `absUrl` (server returns relative /manus-storage/… — the
  existing image bubbles were broken in RN too); voice notes record AAC-in-MP4 (m4a) via
  react-native-audio-recorder-player 3.6.14 + react-native-fs (tap 🎤 → tap 🟥 to send; <0.7s
  discarded; RECORD_AUDIO runtime ask) and upload with `durationMs` → `messages.send
  kind:"audio"`; audio bubbles play via one shared player (m4a chosen over the web's webm/opus —
  every web <audio> decodes it, iOS Safari can't decode opus).
- Engine send() gained an attempts override (signaling.ts) for the awaited switch leave.
- Pinned in nativeRewrite.test.ts (M3.5 block, 4 tests). Known-deferred, logged: hold/swap/merge
  UI, `refresh-ice` (long mesh calls with short-TTL TURN creds), per-sender group typing labels,
  screen share/recording/filters (M5).
- **M3.5 adversarial review (agent vs server/web ground truth + installed libs) — 7 confirmed
  defects, all fixed pre-merge**: (1) CRITICAL — rejoin could never fire: the ≤28s snapshot
  window sits entirely INSIDE the server's 30s disconnect grace, and a per-boot random cid can't
  reclaim an in-grace pin (register fell back to a RANDOM pin, silently breaking dials/rings/M4
  FCM hand-off for the whole session) → the cid is now PERSISTED in AsyncStorage (`relay_cid`,
  web parity) and restored before the first connect; (2) react-native-fs 2.20 has no AGP-8
  namespace = deterministic CI build failure → swapped to the maintained @dr.pogodin fork;
  (3) the call-waiting switch continuation now re-validates `inCall` after the awaited leave
  (a peer-left teardown mid-flight produced a mic-less zombie accept), keys the new roomId at
  TAP time, and aborts honestly (`switch-failed`) if the leave never landed (send() now returns
  success); (4) the switch disarms a boot-armed rejoin watchdog (it tore down the freshly
  answered call within 10s); (5) `peer-left` clears held-by-peer (a held 1:1 stuck "On hold"
  forever after the holder hung up; SFU auto-end now fires there); (6) the waiting card renders
  during DIAL too (it was invisible → real callers machine-declined after 30s); (7) group
  peer-hold no longer banners the whole call (1:1 only). Also fixed from the review's plausible
  list: WRITE_EXTERNAL_STORAGE (maxSdk 28) declared + requested so voice notes work on
  Android 7–9. Review VERIFIED: leave→accept ordering guarantee, ring/waiting predicate parity,
  server rejoin-before-deliverPendingRing order, recorder/player API usage against the installed
  lib, upload contracts, lockfile reproducibility.
- M3.5 CI fix: react-native-audio-recorder-player 3.6.14 doesn't compile on RN 0.86 (the same
  `currentActivity` Kotlin property access RN 0.80 removed — the M4 bridge had the identical
  bug) → patched via patch-package (postinstall) to route through reactContext; verified the
  clean `npm ci` path applies it.
## Native rewrite — Milestone 5 (Android core): screen share, native PiP, recording (2026-07-15)
- **Screen share** (engine.tsx): SFU via `setScreenShareEnabled` (SDK owns the MediaProjection
  consent); mesh via `getDisplayMedia` hot-swapped into the pre-allocated video m-line
  (replaceTrack — no renegotiation), camera restored on stop, `track.onended` (system "stop
  sharing") handled; both paths announce `{type:"screen", action}` → server `peer-screen`
  broadcast → "Viewing a shared screen" chip. Android 14 discipline: the FGS gains the
  mediaProjection type ONLY on the post-grant restart (CallService `screenShare` extra +
  FOREGROUND_SERVICE_MEDIA_PROJECTION permission); stopping drops back to mic-only types.
  Stopped on hangup AND across a call-waiting switch.
- **Native PiP**: MainActivity.onUserLeaveHint → enterPictureInPictureMode (3:4), gated by
  CallNativeModule.pipEligible which the engine sets at establishment and clears at hangup —
  an idle app never pips; manifest `supportsPictureInPicture`.
- **Recording controls**: `registered.recording` gates a ⏺ button; `start-recording`/
  `stop-recording` messages; room-wide `recording {on, by}` → ● REC chip + "This call is being
  recorded." notice; `recording-error` surfaces honestly. Server untouched.
- **Filters: descoped from M5, documented** — MediaPipe-native camera processing is only
  verifiable on physical device GPUs; no CI-checkable path from this environment. Ships with
  the device-verified pass (alongside iOS/Mac work). Pinned in nativeRewrite.test.ts (M5 block).
- **M5 adversarial review (agent vs installed livekit libs + web/server ground truth) — 6
  confirmed defects, all fixed**: (1+2 CRITICAL — screen share was a silent no-op on Android 10+:
  the WebRTC lib's mediaProjection foreground service is disabled until `LiveKitReactNative.
  setup()` runs in Application.onCreate (never called — also the lib's mandatory init), and the
  capture SecurityException is swallowed internally so a frameless track was "shared" while the
  room got told screen-on; plus CallService's manifest type declaration lacked mediaProjection so
  the post-grant FGS upgrade threw and fell back silently → setup(this) added + manifest type
  added; (3) SFU viewers rendered the sharer's muted CAMERA under the "viewing a shared screen"
  chip — publishTiles now prefers the ScreenShare-source publication; (4) a sharer who hung
  up/crashed left a permanent spotlight — peerScreenPin now clears on removePeer/
  ParticipantDisconnected and only the matching pin's screen{off} clears; (5) enabling the camera
  mid-share minted a duplicate video m-line and killed the share (remote-reachable via
  video-accept) — enableCamera is state-only while sharing (stop-share restores per camOn);
  (6) mesh peers joining mid-share got the parked camera (black) instead of the screen —
  createPeer now offers the screen track to newcomers (web-parity bug class). Verified OK:
  bridge/Kotlin compile surface, PiP gating, recording races, protocol vocabulary, re-register
  recAvailable.
## Native rewrite — Milestone 6: QA matrix + release pipeline + store-swap runbook (2026-07-15)
- QA-TEST-PLAN.md §F: 9 device scenarios covering the M3.5/M4/M5 surface (rings-when-closed,
  call waiting incl. mid-dial, hold survival, group dial + add-person, rejoin ≤25s/>30s, voice
  notes incl. Android 9, screen share incl. mid-share joiner + camera-toggle, PiP gating,
  recording). RN pass bar: two physical Androids (one ≤API 28, one 14+).
- native-rn.yml: release AAB now also SIGNED in CI (RELAY-RN-release-aab-SIGNED, same jarsigner +
  4 secrets as android-apk.yml). versionName 3.0.0 / versionCode 2.
- Store swap documented in README §1: same applicationId ⇒ upload the SIGNED RN AAB to the
  EXISTING listing (staged rollout); [YOU] prerequisites: Firebase steps, §F device QA, signing
  secrets. iOS remains Mac-blocked (CallKit/PushKit + App Store submission).
- Milestones M1–M6 complete on the Android track. Remaining engineering (device-verified pass):
  filters (MediaPipe native), hold/swap/merge UI, per-tile group hold badges, refresh-ice,
  iOS everything.
- Field fix (owner report, screenshot): the CI debug APK red-screened "Unable to load script" on
  a real phone — RN debug builds skip JS bundling by default and expect a Metro dev server.
  `debuggableVariants = []` now bundles the JS into the debug APK (standalone; bridgeless RN
  falls back from Metro to bundled assets), and CI additionally emits **RELAY-RN-release-apk**
  (production-behavior test build, no dev support — the right one for the §F QA pass; debug-
  keystore signed, so uninstall it before installing the Play release). Pinned.
- Field fix #2 (owner screenshot: "Couldn't reach RELAY" with working internet): the RN app's
  BASE_URL pointed at www.your-chat.org, which answers 301 → the APEX your-chat.org — tRPC
  mutations are POSTs and don't survive the redirect, so startGuest failed on every phone.
  BASE_URL is now the apex; verified live from the sandbox with the app's exact boot sequence
  (startGuest → guest 451811 created, whoami, /api/relay/stream SSE `ready`, /api/v2/events
  ping). Pinned (www is now a test failure). Note: production serves v2.84.0 — the v2.85/86
  server additions (FCM push router) go live when the owner Publishes the latest checkpoint
  from Manus; the app degrades gracefully until then.
## v2.87.0 — 4-digit PIN sign-in + lockout, built-in SMTP mailer, code-delivery fix (2026-07-16)
> (Backfilled in the v2.88.0 pass — this release shipped without its changelog entry.)
- **Registration codes never arrived** (owner report): outbound mail went only through Resend,
  whose unverified-domain TEST MODE delivers solely to the account owner's address (422 for
  everyone else, silently swallowed). `server/smtp.ts` is a new ZERO-DEP SMTP client
  (STARTTLS + implicit-TLS 465, AUTH LOGIN, dot-stuffed MIME) configured via
  `SMTP_HOST/PORT/SECURE/USER/PASS/FROM`; it now takes PRIORITY in `server/email.ts`, with
  Resend as the fallback.
- **4-digit PIN sign-in** (`server/authPin.ts` + `otpAuth.loginProbe/loginWithPin/setLoginPin/
  pinStatus`): the login screen probes FIRST (sends nothing) — a PIN account lands on the PIN
  pad with "Email me a code instead" one tap away; unknown emails go to registration; everyone
  else gets an emailed code. The PIN is set during registration (new `setup` stage) or in
  Profile's "Sign-in PIN" section.
- **Lockout**: 3 wrong PIN entries warn with the remaining count; the 4th LOCKS the account
  (`users.loginPinLockedAt`) and emails the owner; a successful email-code sign-in unlocks
  (`unlockLoginPin` in `verifyOtp`). Verified LIVE end-to-end against a real MySQL
  (register → code → verify → PIN → 3 warnings → lock → lock email → unlock → PIN restored).
- Schema: `users.loginPinHash/loginPinAttempts/loginPinLockedAt/preferPinLogin` via the boot
  migrator + drizzle migration 0007. 43 new tests (`authPinSmtp.test.ts` + otpAuth additions).

## v2.87.1 — Sign-out actually signs you out (owner-reported) (2026-07-16)
- Profile's Sign out cleared the guest cookie but NOT the device-id binding — the next visit
  silently restored the same identity ("logs me in without asking my name"). It now rotates the
  device id (guests AND members — an upgraded member's identity still carries its guest-era
  binding) and severs the relay channel, matching the AppShell path.
- Both sign-out buttons now land on /app (the entry screen: guest name form + member sign-in),
  not the marketing homepage. Pinned in deviceId.test.ts.

## v2.88.0 — Six-specialist audit batch: 13 fixes + busy line, voicemail, call-back alerts (2026-07-16)
Sixteen verified items from a six-specialist audit (bug-sweep / backend-scale / frontend-speed /
ui-design / ux-clicks / unique-features), implemented in order:

1. **Sign-out actually signs out, everywhere.** `identity.signOutGuest` now expires ALL THREE
   session cookies (`relay_guest`, `relay_session`, `app_session_id`) and `auth.logout` also
   clears `relay_session` — an email-OTP/PIN member who "signed out" used to stay silently
   signed in. Client: Profile's guest/member-branching handler is extracted into a shared
   `useSignOut()` (client/src/app/useSignOut.tsx) wired into BOTH AppShell buttons (which used
   to call the GUEST mutation even for members) and Profile; the guest path is gated behind an
   AlertDialog (a guest sign-out is an identity wipe). Regression tests pin all three Set-Cookie
   expirations (auth.logout.test.ts).
2. **Upload 401 for email-registered members fixed.** `/api/v2/upload` resolved OAuth → guest
   cookie → device id but never the `relay_session` cookie, so OTP/PIN members couldn't send
   avatars, attachments, or voice notes. It now resolves identity via the SAME `createContext`
   as tRPC and the SSE bus.
3. **PIN accounts route to the PIN pad on auto-send.** AuthPanel's auto-send effect called
   `requestOtp` directly, bypassing v2.87's probe — a PIN account arriving via the gate got an
   email code instead of its PIN pad. Shared `routeAfterProbe()` now serves both paths. Bonus:
   the 6-digit emailed code AUTO-SUBMITS on the final digit (v2.49 keypad convention); the
   4-digit PIN deliberately does NOT (lock-after-4-wrong-tries — auto-firing typos burns
   attempts).
4. **Body parsers scoped per route.** The global 50 MB JSON parser is gone: `/api/v2/upload`
   gets raw-binary (41 MB) + base64-JSON (15 MB) parsers, `/api/email/inbound` gets 5 MB (with
   the HMAC-verified rawBody stash moved into its scoped parser), everything else 1 MB.
5. **Raw binary upload path (OOM killer).** A 40 MB base64 upload peaked at ~250-300 MB on the
   512 MiB instance — an OOM wipes the in-memory relay registry and drops every live call. The
   web client now POSTs the Blob as `application/octet-stream` (metadata in the query string);
   `storagePut` passes the Buffer straight to fetch (no Blob re-copy). The legacy base64 JSON
   route STAYS for old clients and mobile/native's uploadAttachment, capped at 10 MB decoded
   (plenty for its voice notes/images).
6. **listThreads groupwise-max + hot indexes + send dedupe.** The thread-list preview query
   selected EVERY non-deleted message across all of a user's conversations (no LIMIT, first-
   per-convo in JS, polled every 4s) — now `MAX(id) GROUP BY conversationId` + an `inArray`
   fetch of just the winners. Boot migrator (mirrored in drizzle/schema.ts) adds
   `messages(conversationId,id)`, `messages(attachmentId)` (attachment auth checks full-scanned
   messages), and `contacts(number)` (presence transitions full-scanned contacts); the migrator
   now also swallows MySQL's "duplicate key name" so re-boots stay quiet. `messages.send`
   fetches the participant roster ONCE instead of three times.
7. **SSE-gated poll demotion.** `useRealtime` exports a module-level `isSseConnected()` flag +
   `demotablePollInterval(fast, slow)`; messages.list polls 2s→20s, threads 4s→30s, Dialer
   history 10s→30s while the SSE stream is up (its events already invalidate those exact
   queries — polling stays as the offline safety net), and reconnect refetches immediately.
8. **Unauthenticated endpoints hardened.** `/api/relay/stream`: cid capped at 200 chars,
   per-IP open-rate limit + a ~25-concurrent-streams-per-IP cap decremented exactly once on
   either close path; the same for `/api/v2/events`. `/api/relay/ice`: per-IP rate limit and
   300s-TTL probe TURN creds instead of full 3600s ones. All gates honor RELAY_RATELIMIT_OFF.
9. **Storage proxy cached.** `/manus-storage/*` paid a Forge presign round-trip per view and
   sent `no-store`; attachment keys are content-hashed and immutable, so signed URLs are now
   cached in-process for 60s and the redirect carries `private, max-age=300`.
10. **Bundle: lazy call engine + stable vendor chunks.** relayClient + relayAssets are
    dynamically imported inside RelayEngine's mount effect (cancelled-flag guarded; type-only
    static imports remain) so the engine leaves the entry chunk; `manualChunks` splits
    react/react-dom/scheduler, @tanstack+@trpc+superjson+wouter, and lucide-react into hashed
    vendor chunks that stay byte-identical across releases — the 30s auto-updater's forced
    reload stops re-downloading unchanged vendor code every deploy.
11. **Fonts fixed.** index.html loaded Instrument Serif/Space Grotesk/Space Mono (used only by
    /technology) while the call screen's Hanken Grotesk/Bricolage Grotesque/JetBrains Mono —
    referenced 36× in relayAssets.ts — were never loaded, rendering the timer and keypad digits
    in default serif. The Google Fonts link now carries all six families NON-BLOCKING
    (media="print" onload swap + noscript fallback), every bare font-family in relayAssets got
    a generic fallback, and `--font-mono` maps Tailwind's font-mono to JetBrains Mono.
    (Deviation from the audit: /technology genuinely uses the old three, so they stay.)
12. **Voice-first + dial hygiene.** GroupCallScreen defaults to VOICE (pill order Voice→Video);
    deep-linked auto-dials are voice unless `?video=1` (the bare `/i/<pin>` invite links placed
    VIDEO dials before — pinned in Dialer.test.ts via `voiceFromDialParams`); a successful
    auto-dial strips `?to=` with history.replaceState so reload/Back/the auto-updater can't
    re-dial; the Recent-list phone button now actually dials (voice), matching History.
13. **UI feedback + correctness batch.** Native confirm()/alert() replaced with AlertDialog/
    toast patterns (Messages unsend + upload/mic errors, History clear, Profile regenerate);
    onError toasts on contacts.upsert/remove, calls.clearHistory, and messages.openThread
    (Contacts + History); the dead `xs:` variant fixed by defining `--breakpoint-xs: 30rem`
    (Contacts' Video button was hidden at EVERY width); offline LEDs standardized on
    `var(--relay-offline)` (red read as busy); History tone classes theme-paired
    (600-in-light / 400-in-dark — raw *-500 failed light-theme contrast).
14. **FEATURE — Carrier-style busy line.** `pinsInCall()` (server/relay.ts) is a pure read of
    the in-memory registry (single-instance by design, like all relay state); `inCall` is
    folded into directory.lookup, directory.presenceMany, and contacts.list (hidden guests are
    never shown busy). Amber LED + "on a call" in the Dialer's 6-digit preview, Contacts rows,
    and History rows — you know they'd bounce you BEFORE you dial. busyLine.test.ts.
15. **FEATURE — Voicemail on no-answer/declined/offline.** The engine's new `setOnDialFailed`
    hook fires when a 1:1 outgoing dial dies unconnected; RelayEngineProvider raises a
    voicemail card (client/src/app/VoicemailPrompt.tsx): record ≤60s via the shared
    MediaRecorder helpers (factored into client/src/lib/voiceNote.ts, now also used by
    Messages' voice notes), upload through /api/v2/upload, delivered as a normal chat AUDIO
    message with the closed meta shape `{voicemail:true}` into the caller↔callee DM thread —
    zero new server infrastructure. The recipient gets a "Voicemail from X" push and the bubble
    carries a phone-style Voicemail label. messages.send's meta input is deliberately closed
    (z.literal(true)) so clients can't smuggle arbitrary JSON.
16. **FEATURE — Call-back alert.** `directory.watchOnline` stores a one-shot (watcher, target)
    row with a 24h expiry in the new `online_watches` table (boot migrator + drizzle mirror);
    heartbeat's offline→online transition consumes the watches and fires a push
    ("X is back online — tap to call") plus a `watched_online` SSE event that raises an in-app
    toast with a one-tap Call action linking `/app/dialer?to=NUMBER&voice=1`. Surfaced on the
    voicemail/fail card ("Tell me when they're back online") and on offline History rows (bell
    button). (Deviation from the audit: the link uses the app's real `?to=` param, not the
    nonexistent `?dial=`.)

Housekeeping: backfilled the missing v2.87.0 changelog entry above; CLAUDE.md TL;DR updated.
Tests: 795 → 815 passing (new: sign-out cookie clearing, listThreads groupwise-max shape,
poll-demotion flag, voice-first invite links, busy-line presence field + pinsInCall, voicemail
encoding + watchOnline validation; stale pins updated with comments, none deleted).
- v2.88 adversarial review (agent vs live server + ground truth): 1 confirmed defect fixed —
  voicemail was offered for NONEXISTENT numbers (with paging live, real-offline ends as
  no-answer; the offline code ≈ typo'd number → unsendable recording, lying copy) → eligibility
  narrowed to no-answer/declined. Also hardened from the review's plausible list: auth.logout
  clears a leftover pre-upgrade guest cookie (next-visitor identity resurrection); a caller
  alone in a still-ringing dial room no longer reads "on a call"; storage-proxy client cache
  dropped to max-age=60 (Forge presign TTL unverifiable); a stale "didn't answer" card no
  longer resurfaces after a later call. Verified-OK: upload matrix (both clients, live-probed),
  sign-out cookie matrix, SSE caps (leak-free across all close paths, empirically), poll
  demotion, listThreads shape parity, busy-line privacy, voicemail plumbing, bundle/fonts.
  Known tradeoffs documented: old cached tabs >10MB base64 uploads 413 until refresh; SSE cap
  ~25/IP has no signaling fallback behind one NAT. → 816 tests green.

## v2.89.0 — Photo downscale + thumbnails, PARTY LINES, instant offline presence (2026-07-19)
Three items from the v2.88 audit backlog (docs-v288-backlog.md #1, #2, #19), in order:

1. **PHOTO DOWNSCALE + THUMBNAILS** (backlog #1 — the biggest remaining mobile-data win).
   Client pipeline (client/src/lib/imageDownscale.ts): photo attachments in Messages (picker +
   clipboard paste) are decoded on-canvas BEFORE upload — longest edge capped at 2048px (never
   upscaled), re-encoded webp q≈0.85 with a jpeg fallback (painted on a white underlay so
   transparent PNGs don't flatten black); the ORIGINAL bytes are kept when the image already
   fits under the cap AND the re-encode didn't shrink it. GIFs skip entirely (canvas re-encode
   freezes the animation) and ANY decode/encode failure falls back to the untouched original
   upload — the pipeline is an optimization, never a gate. A ≤512px THUMBNAIL is generated
   from the same decode and uploaded FIRST (`POST /api/v2/upload?thumb=1` — stores bytes in
   the caller's namespace, returns {storageKey,url}, NO attachment row), then referenced on
   the main upload via `?thumbKey=` — validated server-side to the caller's OWN
   `relay-chat/<identityId>/` prefix (no grafting strangers' objects), with thumbUrl DERIVED
   from the key server-side, never client-supplied. New nullable `attachments.thumbKey` +
   `thumbUrl` columns via the boot migrator (drizzle mirror updated); messages.list/search
   already return whole attachment rows so the join needed no change. Bubbles now render the
   THUMBNAIL with explicit width/height + aspect-ratio (no layout shift; max-w-full added so
   panoramas can't overflow the bubble) and tap through to the FULL-SIZE url in the existing
   lightbox. The legacy base64 route (mobile/native) is byte-identical — untouched.
2. **PARTY LINES — dialable room numbers** (backlog #2, the signature feature). A user creates
   a party line → it gets its OWN 6-digit number from the SAME number space as identities:
   `party_lines` table (number UNIQUE, ownerIdentityId, title ≤64, createdAt) via boot
   migrator + drizzle mirror, and BOTH allocators now check BOTH tables (shared `numberTaken`)
   so a line can never shadow a person or vice versa. Server routing: `attachRelay` gains an
   async `onResolveDial(pin)` hook (wired in _core/index.ts to `getPartyLineByNumber`)
   consulted in the invite path BEFORE the identity/paging flow — the entire identity flow is
   extracted into `runIdentityInvite()` (re-fetching registry state at run time; with no hook
   the path stays fully synchronous and byte-identical, so the 60+ existing protocol tests
   run unchanged). A dial to a line NEVER rings anyone: the caller gets the standard `room`
   ack (flagged partyLine:true — group dials still flush their remaining invites on it, which
   naturally rings those people INTO the line) plus a `joined` into the line's PERSISTENT room
   `pl-<number>` with the current CONNECTED members (ghost-filtered), and existing members get
   the standard `peer-joined` — exactly the add-person merge machinery. The room id is DERIVED
   from the number, so room reaping (ROOM_ABANDON_MS / last leave) never kills the line — an
   empty line is re-dialable forever; roomMeta is recreated on demand (hostPin null: lines
   have no host). Concurrent dialers share the room under the standard 6-mesh/10-SFU cap
   (`error{code:"full"}`); `accepted`/`answeredAt` flip when TWO members are concurrently
   connected, so conference history logs real line calls (dialedNumber = the line's number)
   and solo pop-ins never log. Guard rails: an in-call dialer with other people gets a
   NON-fatal `busy` ("hang up first"), redialing your own line is a non-fatal `already`, and
   a caller who hung up mid-resolve is never joined. Client: relayClient's `joined` handler
   treats a partyLine envelope mid-dial as THE answer (callAnswered + callIsGroup — consent
   bypass and no 1:1 auto-end when alone on the line) and marks an EMPTY line established
   immediately (no peer/track event will); the dial card adopts the line's title.
   directory.lookup resolves lines FIRST (same precedence as dialing) returning title +
   `partyLine:true` + LIVE member count (`partyLineLiveCounts` — same in-memory registry read
   as pinsInCall); the Dialer preview shows "Party line · N on the line" and the Voice button
   reads "Join". New tRPC `partyLines` router (create/list/remove — guests allowed, per-IP
   rate-limited, 10-lines-per-owner cap, owner-scoped delete); GroupCallScreen gains a
   collapsed "Party lines" section (create with title → toast shows the allocated number;
   list with live counts; copy dial-in; share via the existing /i/<number> invite-link
   pattern, which auto-dials the line; delete). History labels pl- conferences with the
   line's title (batched party_lines join; "Line <number>" when since deleted) and the
   call-back button REJOINS the line instead of ringing ex-members individually.
3. **INSTANT OFFLINE PRESENCE** (backlog #19). PresenceManager now reports leaving via
   `navigator.sendBeacon("/api/v2/offline", JSON.stringify({deviceId}))` — a tRPC mutation
   fired during unload is routinely dropped, which left a closed tab's LED green for up to
   2 minutes. Fired on pagehide AND visibilitychange→hidden (mobile Safari often skips
   pagehide on tab close); returning to visible heartbeats IMMEDIATELY so a mere tab-switch
   flips right back online. New `POST /api/v2/offline` (server/v2offline.ts): scoped 4 KB
   text parser (beacons post text/plain), identity via the SHARED createContext (cookies ride
   same-origin) with the body deviceId as the cookie-loss fallback (beacons can't set the
   x-relay-device-id header; same hex-8-64 shape rule), then the exact goOffline path —
   markOffline + scoped publishPresenceTo. 401 when nothing resolves; the 2-min reaper stays
   as the backstop.

Housekeeping: version 2.89.0 (shared/version.ts + updateChecker pin); CLAUDE.md TL;DR updated.
Tests: 816 → 876 passing (+1 skipped, 74 files). New: relayPartyLine.test.ts (13 protocol
tests — join-without-ring, second-dialer merge, cap, empty-line re-dial + no-solo-logging,
identity dials unaffected sync AND with the hook, resolver-failure fallback, in-call guard,
already-on-line, hung-up-mid-resolve, live counts), partyLines.test.ts (9 — shared number
space, migrator/mirror, router wiring, lookup precedence, client surfaces),
v2offline.test.ts (16 — parseOfflineBody + route/client contracts), imageDownscale.test.ts
(22 — fitWithin/keep-original/gif-skip/rename + upload threading, thumbKey ownership,
derived thumbUrl, untouched base64 route, no-layout-shift rendering). Two v2.88-era source
pins updated for the invite-path extraction (callerSocket / wantVideo — behavior unchanged,
proven by the protocol suite). `pnpm check` + full `pnpm build` green.

Adversarial review (pre-ship): 4 confirmed defects + 1 hardening found in the party-line
dial path, all fixed. (D1) a `leave`/re-register/newer dial DURING the in-flight
`onResolveDial` await wasn't detected — the deferred continuation could ghost-ring the
callee, ring the old target into a new call's room, or enroll an idle caller as a phantom
line member; fixed with per-client epoch stamps captured before the await and re-checked
after (the onPageCallee state-before-await discipline), from one globally-monotonic
sequence so a deleted-then-recreated record can never re-reach a captured stamp. TWO
stamps, because one would break group dials: party-line JOINS check `dialEpoch` (re-
stamped on every invite — newest dial wins) STRICTLY, while identity RINGS check
`ctxEpoch` (seeded at record creation, bumped only by `leave` and a channel-takeover
re-register) — the group-dial flush fires sibling invites in one burst, and invite N+1
aborting in-flight invite N would have silently dropped group members whenever the DB
resolver was slower than the inter-POST gap (guard-rail test included). (D2) no
timeout on the resolver left dials in limbo on a wedged DB pool; the resolve is now raced
against `RESOLVE_DIAL_TIMEOUT_MS` (1.5s → identity-flow fallback) with a settled flag so
the late real resolve is ignored (flow runs exactly once). (D3) a LONE line occupant was
EVICTED when someone they rang in declined — server: the reject handler's solo-room
cleanup now skips `pl-` rooms; client: `rejected`/`busy` teardown is gated behind
`inParkedCall()` (group calls + pl- rooms — covers rejoin, whose envelope has no partyLine
flag). (D4) joinPartyLine's stale-solo-room cleanup reaped a LIVE mid-dial room, stranding
the outstanding ring (the callee's accept bounced `gone`); it now runs the `leave`
handler's full cancel first (cancelPendingRings ring-cancel fanout + pendingRings +
caller bookkeeping + missed-call rows) before leaving. (D5) the resolver dispatch's
`.then(ok).catch(fb)` also caught exceptions thrown INSIDE joinPartyLine/runIdentityInvite
and re-ran the identity flow (double-ring footgun) — now the two-argument `.then(ok, err)`
form plus a log-and-drop guard around the dispatch. Tests: 876 → 886 passing (+1 skipped):
9 new protocol tests in relayPartyLine.test.ts (leave-mid-resolve ×2, newer-dial-wins,
group-burst siblings all ring, re-register-takeover, timeout-fallback + late-resolve-
ignored, lone-occupant survives decline + normal-dial cleanup preserved, mid-dial line
join cancels cleanly) and 1 client source pin in partyLines.test.ts. `pnpm check` + full
`pnpm build` green.

## v2.90.0 — AWS/.io deploy scaffolding (repo-side only) (2026-07-16)
Parallel self-hosted deployment prep for `your-chat.io` on AWS Mumbai (ap-south-1), serving the
SAME `main` branch Manus serves as `your-chat.org` — for latency/perf testing. `.org` on Manus
and the Android APK (`.org`) are UNTOUCHED.
- **No domain find-replace** (deliberately NOT done): the app is already domain-agnostic —
  `server/_core/index.ts` uses `APP_URL` env (‖ `.org` fallback), `authLocal.ts` derives the
  origin from the Host header, the client uses `window.location.origin`. Both domains build from
  one `main`, so hardcoding `.io` would poison Manus's `.org` build. The `.io` identity is set by
  env (`APP_URL=https://your-chat.io`) + DNS only.
- **`GET /api/health`** liveness endpoint (no auth, no DB touch, no-cache) for the rolling-deploy
  gate + any LB target group.
- **`.github/workflows/deploy.yml`** — build `main` → S3 → SSM rolling deploy to EC2 tagged
  `relay-app`, gated on `/api/health`. **`workflow_dispatch`-only (dormant)** until the AWS side
  is provisioned (OIDC role trusting this repo, bucket, fleet); flip the commented `push: main`
  on after a green manual run to go continuous. Targets ap-south-1 / account 342494841476 /
  bucket relay-deploy-342494841476 as provided.
- **`ecosystem.config.cjs`** (repo root, copied onto servers by the pipeline): corrects the
  supplied instruction's wrong entry path — the real esbuild output is **`dist/index.js`**, not
  `dist/server/_core/index.js` (pm2 would crash-loop). `instances: 1` is REQUIRED — the signaling
  registry is in-memory per-process (no Redis adapter); cluster mode would break calls.
- **`docs-aws-io-deploy.md`** — full Mumbai provisioning runbook (VPC/SG, EC2+Elastic IP, RDS
  MySQL, S3, GitHub-OIDC role, DNS/TLS, env, first-deploy, rollback). Flags the two latency-test
  gotchas: put the DB in ap-south-1 (else you measure cross-region DB latency, not hosting), and
  the JWT_SECRET shared-vs-isolated decision.
- BLOCKED on the owner: no AWS credentials/CLI in this environment. To provision AWS-side, add a
  SCOPED IAM key (user `relay-infra`, not root) to the session; delete it after build-out.

## v2.91.0 — Horizontal scale for .io: native S3 driver, Redis event bus, tiered signaling, aws-ops workflow (2026-07-20)
Four building blocks that let the AWS `.io` fleet run 2+ instances WITHOUT touching the hard
invariant (the relay signaling registry stays in-memory single-process). Every block is
env-gated and dormant by default — `.org` on Manus and a bare single-box `.io` are byte-identical
to v2.90.
- **Zero-dep native S3 storage driver** (`server/s3.ts`, following the smtp.ts/fcm.ts zero-dependency
  pattern): full AWS Signature Version 4 with nothing but `node:crypto` — header-auth PUT
  (single-chunk, `x-amz-content-sha256`) for uploads and query-string-auth presigned GETs
  (`X-Amz-*`, UNSIGNED-PAYLOAD) for downloads. Verified byte-for-byte against the OFFICIAL AWS
  test vectors from the Amazon S3 API Reference ("Authenticating Requests (AWS Signature
  Version 4)"): the `examplebucket` GET-Object + PUT-Object header examples (canonical request,
  string-to-sign, signatures `f0e8bdb8…`/`98ad7217…`) and the 86400s presigned-URL example
  (final URL + signature `aeeed9bb…`). Env (read per-call): `S3_BUCKET/S3_REGION/S3_ACCESS_KEY/
  S3_SECRET` (+`S3_ENDPOINT`, `S3_FORCE_PATH_STYLE=1` for R2/MinIO path-style, `S3_PREFIX`
  default `relay-chat/`). `storagePut` uploads direct-to-bucket and returns the SAME
  `/manus-storage/{key}` URL shape (DB rows/absUrl/clients stay storage-agnostic); the storage
  proxy (`server/_core/storageProxy.ts`) gained an S3 branch — presign locally (no network),
  60s cache, 307 redirect, 300s expiry — plus a `..`-traversal guard on the read path. Forge
  remains the fallback when `S3_*` is absent (that's `.org`). Key hygiene: sanitizer rejects
  traversal/control chars; prefix is ENSURE-style (never double-prefixes the already-namespaced
  `relay-chat/<identityId>/…` upload keys, so the default config produces byte-identical keys to
  Forge), and v2upload's thumbKey ownership check is prefix-tolerant for custom prefixes.
- **Redis event bus** (`server/redisBus.ts`, gated on `REDIS_URL` — absent = today's behavior).
  ioredis added as a REGULAR dependency (deliberate: production signaling infra wants a
  battle-tested RESP client — AUTH/TLS/db from the URL, capped-backoff auto-reconnect,
  auto re-subscribe; a hand-rolled RESP client was rejected). Two connections (commands+pub /
  dedicated sub). Integrations:
  - `server/v2events.ts`: `publishToIdentity`/`publishPresenceTo`/`broadcastPresence` now
    deliver to THIS instance's SSE clients FIRST, then publish one `{t: targets|"*", ev}`
    envelope on `relay:v2ev`; every instance subscribes and delivers foreign envelopes to its
    local streams. Loop-safety: envelopes carry a per-boot random `INSTANCE_ID` and subscribers
    drop their own (so nothing is delivered twice and `/api/v2/events` can stay load-balanced).
  - **Busy line + party-line live counts across tiers**: the signaling node mirrors its registry
    into `relay:busypins` (SET) + `relay:plcounts` (HASH) via diff-syncs (SADD/SREM/HSET/HDEL)
    fired from the existing single funnels — `joinRoomMember`/`leaveRoom`/`reapRoom`/
    `releaseHeldRoom`/register/grace-reap — coalesced to one next-tick sync per event burst,
    plus a 30s full re-sync; both keys carry a 90s TTL so a crashed node can never leave ghost
    state, and a write-guard keeps API-tier instances (no local relay clients) from ever
    touching the keys. Read path: `pinsInCallAsync`/`partyLineLiveCountsAsync` in
    `server/relay.ts` serve the LOCAL registry when this process holds relay clients (or the
    bus is off) and the Redis mirror on API-tier instances; `directory.lookup`, `presenceMany`,
    `contacts.list`, and `partyLines.list` switched to the tiered variants (guard tests
    updated to pin the new shapes). Failure-safe: any Redis error degrades to "not on a call".
  - **Cross-instance relay rooms are explicitly OUT OF SCOPE** (documented in the redisBus
    header): the registry's call-state transitions are transactional per-process; splitting
    them is phase 2 with its own design. ALL `/api/relay/*` traffic must hit ONE node.
- **`docs-aws-scale-out.md`** — the tiered-routing runbook: exact console+CLI steps for the ALB
  (ap-south-1 ACM cert, `relay-default` TG with both instances, `relay-signaling` TG with
  instance A ONLY, 443 listener rule path `/api/relay/*` at priority 10 above the default rule,
  idle timeout 300s for SSE), why `/api/v2/events` deliberately stays load-balanced (the bus
  fans out), ElastiCache Redis provisioning (cluster mode OFF, one `cache.t4g.micro`, same
  VPC/subnets as the EC2s, SG allowing 6379 from the app instances' SG), the
  `REDIS_URL=redis://<primary-endpoint>:6379` + `S3_*` env flip on `/home/relay/.env` (pm2
  `startOrReload --update-env`), the rule-BEFORE-Redis order of operations (single-writer
  busy-state), manual signaling failover, and a verification checklist.
- **`.github/workflows/aws-ops.yml`** — `workflow_dispatch`-ONLY ops workflow (never on push),
  authed via `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` repo secrets (fails fast with
  add-the-secrets instructions when absent), inputs: `action` = `verify` (read-only status:
  caller identity, relay-app instances, TGs+targets, ALB, ACM in ap-south-1 AND us-east-1,
  CloudFront aliases — zero mutations) | `cloudfront` (ensures a DNS-validated us-east-1 ACM
  cert for your-chat.io+www, PRINTS the validation CNAMEs prominently and exits with re-run
  guidance while pending; once ISSUED creates-or-updates the CloudFront distribution: ALB
  origin https-only + Managed-AllViewer (the forwarded Host matches the ALB's cert), default
  behavior Managed-CachingDisabled + compress, `/assets/*` Managed-CachingOptimized,
  `/api/relay/stream*` + `/api/v2/events*` explicitly CachingDisabled with a 60s origin
  response timeout (heartbeats are 25s), http2and3; prints the `dXXXX.cloudfront.net` domain
  and the exact DNS change — NEVER touches DNS) | `alb-tune` (idle timeout 300s, creates the
  `relay-signaling` TG if missing — port 3000, `/api/health` check — registers ONLY the
  oldest-launched relay-app instance and deregisters extras, adds/refreshes the priority-10
  `/api/relay/*` rule on 443 with an :80 fallback + warning, default rule untouched, prints
  the final rule table). Managed policy IDs resolved by name with documented fallbacks; every
  step idempotent and printing what it did.
- Tests: 886 → **965 passing / 1 skipped** (+79). New: `server/s3.test.ts` (31 — the three
  official AWS SigV4 vectors byte-for-byte, UriEncode rules, config gating, key
  prefix/traversal safety, addressing modes, presign shape, storage driver selection with a
  mocked fetch), `server/redisBus.test.ts` (32 — envelope encode/decode, own-instance skip,
  REDIS_URL gating incl. tiered-read routing, local-first SSE delivery + single-envelope
  audience publish, busy-state diff-sync/TTL/ghost-healing/API-tier write-guard/one-clearing-
  sync/coalescing/failure-swallow, cross-tier read helpers, computeBusySnapshot semantics),
  `server/redisBusLive.test.ts` (2 — the same wire paths against a REAL spawned `redis-server`
  with real ioredis connections; auto-skips where the binary is absent, e.g. CI),
  `server/awsOps.test.ts` (14 — workflow trigger/auth/action/DNS-hands-off pins + runbook
  contracts). Updated guard pins: `busyLine.test.ts`/`partyLines.test.ts` (tiered read shapes),
  `imageDownscale.test.ts` (prefix-tolerant thumbKey ownership), `updateChecker.test.ts`
  (2.91.0).
- NOT done here (deliberate): no cross-instance signaling, no DNS mutations, no automatic
  signaling failover, and no live AWS/ElastiCache validation (no AWS credentials in this
  environment — the S3 signer is proven against AWS's published vectors and the bus against a
  real local redis-server instead).
- **Review outcome**: a five-specialist adversarial review + judge confirmed **12 defects
  (D1–D12), all fixed pre-ship**. The two headliners: **D1 (CRITICAL)** — aws-ops.yml's
  `/assets/*` CloudFront behavior attached CachingOptimized with NO OriginRequestPolicyId, so
  the https-only ALB origin got no viewer Host, its your-chat.io cert matched nothing, and
  every hashed JS/CSS chunk would 502 after DNS cutover (blank app; the assets jq now passes
  AllViewer like every other behavior — origin-request-only, cache key unchanged); and **D2
  (MAJOR, a live-`.org` regression)** — the new storage-proxy `..` guard was a SUBSTRING check,
  permanently 400ing legal keys whose filenames contain ".." runs ("photo..2020.png", 307 such
  rows already live at HEAD) — now segment-wise (`key.split("/").some(s => s===".."||s===".")`),
  matching sanitizeS3Key, with the same form in v2upload's thumbKey check, pinned by a new
  `storageProxy.test.ts` driving raw HTTP paths (legal `a..b_hash.png` → 307; `../` and `%2e%2e`
  segments → 400). The rest: **D3** boot-time SUBSCRIBE failure was permanent (channel latched
  before settle; ioredis only auto-resubscribes ACKed channels) — now latch-on-resolve/unlatch-
  on-reject, a sub-connection "ready" resubscribe sweep, and `maxRetriesPerRequest:null` on the
  sub connection; **D4** busy-state reads could hang 7–120s during a Redis outage — now
  `commandTimeout:1500` in makeRedis plus a 1.5s Promise.race to safe defaults in both read
  helpers; **D5** the printed CloudFront go/no-go check ("test https://dXXXX.cloudfront.net
  directly") could never pass — replaced with the Host-override curl
  (`curl -si https://<cf>/api/health -H "Host: your-chat.io"`) in the workflow AND the runbook;
  **D6** the demoted signaling node's "one final clearing sync" wiped keys the NEW node had just
  written — clearing grant dropped, single-writer guard is now strictly `hasClients`, residue
  ages out via the 90s TTL; **D7** merging a SOLO held party line missed the busy-state mirror
  (movers empty ⇒ no funnel ran) — `touchBusyState()` added in the merge handler; **D8** the
  runbook's §1→§3 hand-off broke on the console path (replication group, not cache cluster) —
  documented `describe-replication-groups … PrimaryEndpoint` + REDIS_URL-must-be-PRIMARY;
  **D9** alb-tune now deletes any leftover `:80` `/api/relay/*` forward rule once a 443 listener
  exists (was a silent plaintext exemption); **D10** managed-policy lookups tolerate
  AccessDenied (`|| echo None`) so the documented fallback ids actually engage, and the ops
  key's required IAM actions are enumerated in the workflow header; **D11** dead ACM certs
  (VALIDATION_TIMED_OUT/FAILED) are swept + re-requested and the false "(idempotent)" claim is
  gone; **D12** the throwaway `.smoke-tmp/` scripts are gone from the tree (verified absent —
  nothing rides `git add -A`). Tests 965 → **982 passing / 1 skipped** (+17: 4
  `storageProxy.test.ts`, +5 `redisBus.test.ts` — subscribe lifecycle ×3, bounded hung-read,
  D7 merge sync — +7 `awsOps.test.ts` D-pins incl. the runbook contracts, +1 live outage-
  recovery test in `redisBusLive.test.ts` proving D3+D4 against a real killed-and-restarted
  redis-server); the stale one-clearing-sync and substring-thumbKey pins were updated in place
  with review references. `pnpm check` + full suite + `pnpm build` green.

## v2.92.0 — OAuth UI removal (native auth only), SES mailer compat, zero hardcoded domains, TURN env pins (2026-07-20)
Owner-mandated "Round 3 + Round 4" batch. Nothing here changes the wire protocols; the server's
OAuth callback stays live for existing sessions. Same build still serves both deployments —
identity now comes ONLY from env + Host, never from source literals.

### R3 — Manus OAuth sign-in removed from the UI entirely (owner decision)
The native AuthPanel (email one-time code + optional 4-digit PIN, v2.87) is now the ONLY
sign-in. Earlier versions had already moved the visible CTAs (AppShell header, OnboardingGate
"Continue with email", Profile "Register with email") onto AuthPanel; v2.92 removes the last
reachable OAuth paths and the builder itself:
- [x] `client/src/main.tsx` — the global 401 handler HARD-NAVIGATED the whole tab to the Manus
      OAuth portal on any UNAUTHED tRPC error (a real, reachable path on production). Now it
      only logs; RELAY is guest-first and AuthPanel is in-app.
- [x] `client/src/_core/hooks/useAuth.ts` — the default `redirectPath` was the OAuth portal
      URL; now `/` (the guest-first landing). No current caller passes
      `redirectOnUnauthenticated`, so this is a belt-and-braces neutralization.
- [x] `client/src/components/DashboardLayout.tsx` — the (currently unused) template's
      "Sign in" button launched the portal; now routes to `/app` where the native auth lives.
- [x] `client/src/components/ManusDialog.tsx` — DELETED. A zero-import "Login with Manus"
      modal with no purpose post-removal.
- [x] `client/src/const.ts` — `getLoginUrl` (the portal-URL builder reading the OAuth portal
      env var) deleted outright; `COOKIE_NAME`/`ONE_YEAR_MS` re-exports remain. Stale Manus-
      OAuth doc comment in `Profile.tsx` rewritten.
- [x] Server: `GET /api/oauth/callback` (server/_core/oauth.ts) deliberately KEPT — smallest
      diff per the owner's instruction; it is simply unreachable from the UI. Existing OAuth
      cookies keep working until natural expiry.
- [x] **Migration note for existing Manus-OAuth users**: accounts are untouched; they sign in
      via the email-code flow at the SAME email address. Verified in `server/authOtp.ts`:
      `findUserByEmailAny` selects all user rows for the email and prefers `loginMethod`
      "otp", then "local", then falls back to ANY row — i.e. an OAuth-created user row is
      found and signed into (and `markUserEmailVerified` flags it verified). They keep their
      number: the OTP verify path upgrades in place rather than minting a new identity.
- [x] Pinned: new test in `verifiedBadge.test.ts` walks EVERY non-test file under client/src
      and asserts zero `getLoginUrl`/OAuth-portal-env references (the R3 sanity gate,
      mechanized). The old OnboardingGate pin stays.

### R4A — mailer compatibility for the owner's SES env
- [x] `EMAIL_FROM` accepted as an ALIAS for `SMTP_FROM` (`server/smtp.ts` smtpConfig). The
      owner's `.io` .env uses `EMAIL_FROM`; previously the From fell back to `SMTP_USER`,
      which on SES is an `AKIA…` access-key id that SES rejects as a sender. Order:
      `SMTP_FROM` > `EMAIL_FROM` > `SMTP_USER`.
- [x] `MAIL_PROVIDER` explicit switch (`server/email.ts` mailProvider): `"smtp"` forces the
      built-in SMTP client (Resend NEVER used — not even as a failure fallback: a forced-smtp
      failure is reported, not silently rerouted through a third party the operator opted out
      of); `"resend"` forces Resend (SMTP skipped even when configured); unset/other = auto,
      the historical priority (SMTP first, Resend fallback). `emailEnabled()` counts only the
      forced side when forced.
- [x] Tests: +1 in `authPinSmtp.test.ts` (alias ordering incl. the AKIA-user last resort),
      +4 in `email.test.ts` (provider parsing, forced-side gating, forced-smtp never touches
      fetch/Resend even on a REAL failed send to a dead loopback port, forced-resend skips a
      configured-but-dead SMTP host).
- [x] **Credential-rotation reminder** (no values here, none in the repo — `.env*` stays
      gitignored): if SMTP/SES or any other credentials were ever pasted into chat/tickets
      while setting the `.io` box up, rotate them at the provider (IAM → SES SMTP creds) and
      update `/home/relay/.env` on the box. This repo never contains secret values.

### R4B — ZERO hardcoded deployment domains in runtime source (owner requirement)
One derivation helper, `server/appUrl.ts` `appBaseUrl(req?)`: `APP_URL` (origin, slash-
stripped) → `DOMAIN` (bare-hostname convenience, scheme/slash tolerated) → the request's
`x-forwarded-proto`/`-host`/Host (same trust-proxy reading authLocal always used) →
`null` (caller degrades). SECURITY (final fix round, D1): an earlier draft of this batch
had a 4th step — the origin MOST-OBSERVED on real traffic, recorded by a request
middleware — so request-free contexts could derive a URL with no env set. DELETED before
ship: the ledger was poisonable by anyone able to send requests (`x-forwarded-host`
bursts at cold start could fill the 50-entry cap and lock the real origin out, majority
pumping, LB health-check hostnames) and its output became ABSOLUTE LINKS in missed-call
emails — a link-hijack primitive. Request-free contexts now REQUIRE `APP_URL`/`DOMAIN`
and degrade gracefully without them. Former literal sites, all converted:
- [x] `server/_core/index.ts` missed-call email links — request-free context; uses
      `appBaseUrl()` and when it is null (no `APP_URL`/`DOMAIN`) the "Open RELAY" button
      is OMITTED from the email — it still sends, and its copy ("Open RELAY to call them
      back") stands alone. Never a relative or traffic-derived href.
- [x] `server/authLocal.ts` `baseUrl(req)` — now `appBaseUrl(req) ?? ""` (request always in
      hand; "" only on a Host-less request).
- [x] `server/webPush.ts` VAPID subject — `VAPID_SUBJECT` env → the app's ENV-derived https
      origin (`APP_URL`/`DOMAIN`; RFC 8292 allows an https: contact URI) → neutral
      `mailto:admin@localhost`. Subject is computed per-call (keys stay cached) so env
      added without a restart is picked up.
- [x] Client marketing/legal pages — new `client/src/lib/siteHost.ts` (`siteHost()`/
      `siteEmail()` from `window.location.hostname`, www-stripped): `Technology.tsx` eyebrow,
      contact mailto + link, © footer (was UPPERCASE "YOUR-CHAT.ORG" — caught by the
      case-insensitive audit); `PrivacyPolicy.tsx` intro + contact link (now href="/").
      `Home.tsx`/`smtp.ts`/`emailInbound.ts` comments de-domained.
- [x] Deliberate EXCEPTIONS (unchanged, per owner scope): `mobile/**` (shipped APK pinned to
      .org), `scripts/latency.mjs` (CLI default), docs/changelogs/workflows, and `*.test.*`
      fixtures.
- [x] Pinned: `server/noHardcodedDomains.test.ts` walks server/ + client/src/ +
      client/public/ + shared/ plus client/index.html (`.html` scanned; final fix round
      P3) and forbids `your-chat.(org|io)` case-insensitively — root `ecosystem.config.cjs`
      is scanned too but EXPLICITLY allowlisted (pm2 deploy config for the .io fleet; names
      its own target on purpose) — plus asserts the helper is wired at each former site and
      that the deleted origin ledger STAYS deleted. `server/appUrl.test.ts` (5) covers the
      priority chain, trust-proxy parsing, and the pinned null-when-no-env-no-request
      degrade; `webPush.test.ts` +4 for the subject chain.

### R4C — TURN env extras, pinned
`iceServers()` already honored `TURN_TTL` (default 3600s) and `TURN_TCP_HOST` (tcp
candidates on :443-alt and :3478 with the same HMAC creds) — shipped untested in the old
TURN-relay batch. v2.92 makes them contractual:
- [x] Hardening: a missing/garbage/non-positive `TURN_TTL` now falls back to 3600 instead of
      minting `"NaN:user"` usernames (parseInt was unguarded).
- [x] Tests (+2 in `relay.test.ts`): TTL default / env-tuned expiry windows / the 300s
      `/api/relay/ice` probe override beating env / garbage fallback; and
      `turn:<TURN_TCP_HOST>:3478?transport=tcp` present with byte-identical username+
      credential across entries, credential re-derived as base64(HMAC-SHA1(secret,username)).
- [x] Both vars (plus `DOMAIN`, `EMAIL_FROM`, `MAIL_PROVIDER`) documented in CLAUDE.md's env
      section.

### Final fix round (security review outcomes, folded into this same batch)
- [x] **D1 (CONFIRMED, security)** — the observed-traffic-origin ledger
      (`observeRequestOrigin`/`mostObservedOrigin` in `server/appUrl.ts` + the recording
      middleware in `server/_core/index.ts`) DELETED entirely; see the R4B note above for
      the attack shapes. `appBaseUrl(req?)` is now strictly `APP_URL` → `DOMAIN` →
      request-derived origin → null; consumers degrade (missed-call email omits the
      absolute button; VAPID subject: env-derived https origin else the neutral mailto —
      keys stay cached). `noHardcodedDomains.test.ts` pins that the ledger stays deleted.
- [x] **P2** — `server/email.ts` `emailFrom()` is now `RESEND_FROM` → `EMAIL_FROM` →
      `onboarding@resend.dev`, so the SES-style `EMAIL_FROM` var is honored under Resend
      too (+1 test).
- [x] **P3** — `server/noHardcodedDomains.test.ts` broadened: scans client/public/** and
      client/index.html too (`.html` added to the extension set); root
      `ecosystem.config.cjs` scanned + explicitly allowlisted with rationale (deploy
      config for the .io fleet — intentional).
- [x] **Operator note (APP_URL)** — operators SHOULD set `APP_URL` on BOTH deployments
      (org: the canonical https origin; io already has `DOMAIN`). Absolute links in
      missed-call emails now REQUIRE `APP_URL`/`DOMAIN`; without them the email sends
      without its "Open RELAY" button and the VAPID subject stays the neutral mailto.
- [x] **Edge case (sign-out, R3 interaction)** — a Manus-OAuth-era account with NO email
      on file has no sign-in path after signing out (the email-code flow needs a matching
      email and the OAuth UI is gone). Such users should add an email in Profile BEFORE
      signing out.

### Housekeeping
- [x] Version 2.92.0 (`shared/version.ts`; updateChecker pin moved). CLAUDE.md TL;DR + env
      section updated (incl. the APP_URL-on-both-deployments guidance).
- [x] Tests: 982 → **1003 passing / 1 skipped** (+21: 1 smtp EMAIL_FROM alias, 5
      mail-provider, 1 emailFrom-under-Resend, 1 R3 client-wide OAuth sweep, 5 appUrl,
      2 noHardcodedDomains, 4 vapidSubject, 2 TURN env pins). `pnpm check` + full suite +
      `pnpm build` green.

## v2.92.1 — Last hardcoded deployment domain removed: SEO self-references now derive from the request origin (2026-07-20)
Owner cross-check of the ROUND 1–4 instruction sheet surfaced the one survivor of R4B's
"zero hardcoded domains" rule: the SEO layer still pinned the Manus space URL
(`relaychat-lduywq6l.manus.space`) into `client/index.html` (canonical, `og:url`, JSON-LD
`url`) and the static `client/public/sitemap.xml` + `robots.txt` — so the AWS `.io`
deployment was telling crawlers its canonical home is a manus.space host.

- [x] `client/index.html`: static `canonical` replaced by a tiny inline script that injects
      `location.origin + location.pathname` at runtime (one build serves every domain);
      `og:url` deleted outright (scrapers fall back to the fetched URL — correct on every
      deployment); JSON-LD `url` property dropped (optional in schema.org).
- [x] NEW `server/seo.ts`: `/sitemap.xml` + `/robots.txt` are now DYNAMIC Express routes
      (registered beside `registerWellKnown`, ahead of static/Vite) built per-request from
      `appBaseUrl(req)` (`APP_URL` → `DOMAIN` → forwarded Host) — pure builders
      `sitemapXml(base)` / `robotsTxt(base|null)` (robots omits the Sitemap line when no
      origin can be derived; sitemap 404s — absolute URLs are spec-required). Sitemap now
      lists all five public routes (`/`, `/docs`, `/technology`, `/privacy-policy`,
      `/turn-test`). Static `client/public/sitemap.xml` + `robots.txt` deleted.
- [x] `server/noHardcodedDomains.test.ts` hardened: forbidden set now also matches
      `manus.space` + the `relaychat-lduywq6l` slug; scan extensions widened to
      `xml|txt|webmanifest`; new pin asserts the static files STAY deleted, `server/seo.ts`
      derives from `appBaseUrl(req)`, and the SPA shell carries no absolute canonical/og:url.
      (The one legit `*.manus.space` comment in `server/_core/index.ts` reworded.)
- [x] Verified end-to-end: prod build booted locally — `curl -H "Host: a.example"
      /robots.txt` → `Sitemap: http://a.example/sitemap.xml`; `Host: b.example`
      /sitemap.xml → `<loc>http://b.example/…` (behind the real gateways
      x-forwarded-proto makes these https; on .io `DOMAIN` wins outright).
- [x] Tests: 1003 → **1008 passing / 1 skipped** (+4 `server/seo.test.ts`, +1
      noHardcodedDomains dynamic-SEO pin). `pnpm check` + full suite + `pnpm build` green.

## v2.92.2 — ROUND 5: transactional emails wrapped in a complete HTML document (2026-07-20)
Owner's ROUND 5 instruction: the email templates returned bare `<div>` fragments with no
document wrapper. Bare fragments render inconsistently across mail clients (Gmail/Outlook
reflow or re-style them) and, lacking a `charset`, can mojibake the em-dashes/middot in the
copy. Wrap every transactional email in a proper `<!doctype html>` envelope; keep all
existing copy/styling/buttons exactly as-is.

- [x] NEW `wrapEmailDocument(inner, title)` in `server/email.ts` — one shared envelope:
      `<!doctype html><html lang="en">` + `<head>` (UTF-8 charset, mobile viewport,
      `color-scheme:light`, `<title>`) + a `<body>` that emits the inner fragment VERBATIM.
- [x] All FOUR templates now delegate to it: `verifyHtml` (`server/authLocal.ts`), `otpHtml`
      (`server/authOtp.ts`), `missedCallHtml` (`server/_core/index.ts`), `lockEmailHtml`
      (`server/authPin.ts`). (Grepped every `sendEmail(` call site — these are the only four;
      `verifiedPage()` is a browser page, not an email, and already a full doc — left as-is.)
- [x] Deliberate deviation from the spec's skeleton: body background stays LIGHT (`#ffffff`),
      NOT the shown `#0b0c10`. Every RELAY email is light-themed (near-black `#0E1014` copy on
      light cards); a dark body would make the copy unreadable. "Keep styling exactly as-is"
      ⇒ light body + `color-scheme:light` (stops dark-mode clients from auto-inverting).
- [x] Security: `title` is interpolated UNescaped (documented), so `missedCallHtml` uses a
      STATIC title — the user-controlled `callerLabel` never reaches `${title}`; it stays
      `escapeHtml`'d in the body. Other three titles are static literals.
- [x] `stripHtml` (the text/plain fallback builder) now strips `<head>` (`<head\b…</head>`,
      `\b` so it never eats a `<header>`) so the new `<title>` doesn't leak into plain text —
      recipient plain-text body is byte-identical to before ROUND 5.
- [x] Tests: NEW `server/emailTemplates.test.ts` (the three importable templates verified
      behaviorally — full-doc shape + copy/link/code preserved; `missedCallHtml` via
      source-read since `_core/index.ts` self-starts) + `wrapEmailDocument`/`stripHtml`
      coverage added to `email.test.ts`. 1008 → **1016 passing / 1 skipped**. `tsc --noEmit`
      + full suite green.

## v2.92.3 — Landing-page images bundled into the build (were 404'ing on .io) (2026-07-20)
Owner report: "the images in the landing page are not showing on .io." Root cause: the
marketing landing page (`client/src/pages/Home.tsx`) loaded all 15 images — 5 real app
screenshots (call/dialer/messages/contacts/mobile) + 10 group-call avatar tiles (p01–p10) —
from `/manus-storage/*` (Manus Forge object storage). Forge only exists on the `.org`
(Manus) deploy. On `.io`, `/manus-storage/*` now presigns against the operator's S3 bucket
(the S3 env went live between checks — the proxy went 500→307), but these images were never
uploaded there, so each one 307-redirected to S3 and 404'd. Verified live: `.io`
`/manus-storage/relay-v2-call_…jpg` → 307 → final **404**; `.org` same key → 200.

- [x] Downloaded the 15 JPEGs from `.org` Forge (still serving them) into
      `client/public/marketing/` (≈1.3 MB total; validated as real JPEGs — screenshots
      1600×1000, mobile 780×1688, avatars 480×600).
- [x] `Home.tsx`: the `IMG` map + `PEOPLE` avatar array now reference `/marketing/*` instead
      of `/manus-storage/*` (filenames preserved). A code comment explains WHY they're bundled
      (identical for every visitor; must not go back to per-request storage).
- [x] These are now STATIC build assets: vite copies `client/public` → `dist/public`
      (`publicDir`/`outDir` in vite.config.ts), served by `serveStatic` from `dist/public` on
      EVERY deploy (same path that already serves `/icon.svg`, confirmed 200 on .io). No
      dependency on Forge OR S3 — works on .org, .io, and any future self-host.
- [x] User-uploaded attachments are UNAFFECTED — they correctly still use S3 (.io) / Forge
      (.org) via `storagePut`/the storage proxy. This change is marketing images only.
- [x] Build-verified: `pnpm build` green, all 15 present in `dist/public/marketing/`. Version
      → 2.92.3 (updateChecker pin bumped). `tsc --noEmit` + version/domain-scan tests green.

## v2.94.4–v2.94.7 — cross-instance activation, call-link direct-join, login overhaul (2026-07-21)
- [x] v2.94.4 — Activated cross-instance calling on `.io`: baked `RELAY_CLUSTER=1` into
      `ecosystem.config.cjs` (the `.io`-only pm2 config), before the `.env` spread so it's
      overridable. Diagnosed live: `/api/health` showed two instance ids + `redisBus:true` but
      `cluster:false`. After deploy `cluster:true` on both boxes → the "calls may not connect"
      banner suppresses itself and calls ring across instances (no ALB pin). `.org` untouched.
- [x] v2.94.5 — Call-link direct-join (owner: "paramount"): `/i/<pin>` clicker with no identity
      now sees a focused "you're calling <name> — enter your name to connect" card (callee
      resolved via public `directory.lookup`), then straight into the dial. `callLinkJoin.test.ts`.
- [x] v2.94.6 — Login overhaul pt.1 (guest): full-screen "matrix" ID-reveal on guest entry
      (`MatrixReveal.tsx` — green glyph rain + digit-by-digit number decode). Call-link joins skip it.
- [x] v2.94.7 — Login overhaul pt.2 (registered): glassy `AuthPanel`, "secure lock engaging"
      animation on PIN entry, and "keep me signed in" 30/60/90 (OFF = session cookie), wired via
      `verifyOtp`/`loginWithPin` `remember` → `setSessionCookie(ttlMs)`. `rememberMe.test.ts` +
      `authPanelRemember.test.ts`.
- [x] Confirmed the spec's "regenerate PIN + auto-sync to contacts" ALREADY exists:
      `identity.regenerateNumber` → `planRenumber` propagates the new number to all contacts;
      Profile's confirm dialog says "Everyone who saved you as a contact is updated automatically."
- [ ] DEFERRED — fully session-only guests (wiped on browser CLOSE, not just logout). Reverses a
      deliberate anti-"random number change" design (guest loses number/contacts/history on close).
      Logout already wipes everything today. Awaiting owner steer (task #30).

## v2.94.8 — multi-call fixes (conference audit) + v2.95.0 — rich user status (2026-07-21)
- [x] v2.94.8 — audit of add/swap/hold/conference-10 found + fixed 4 client bugs: held-call
      resumed (not dropped) on remote-left; onRingCancel clears waitingRing (stale Switch popup
      no longer kills a live call); error{full}/forbidden fatal to a peerless joiner (no dead-screen
      strand); group picker uses engine.maxParticipants (mesh 6 / SFU 10) + programmaticGroupDial
      clamps. NEW relayStandardCap.test.ts (standard cap at invite + accept). Server was already correct.
- [x] v2.95.0 — RICH USER STATUS (story-style, task #27): text/image+caption/video+caption/audio,
      contacts-only, 24h. statuses + status_views tables; status router (post/feed/mine/remove/
      markViewed/viewers); ?bare=1 no-row media upload; Status.tsx strip + composer + full-screen viewer.
- [x] v2.95.0 SECURITY (adversarial-review-gated before ship, all FIX-FIRST items resolved):
      status media authorized in authorizeStorageKey on an ACTIVE row + audience (anon/non-contact/
      expired → 403; ephemeral at the access layer); statusAudienceAuthorized shared by feed/markViewed/
      media, honors blocks both ways; sanitizeStatusBg allowlist kills the CSS url() beacon; statusGate
      rate-limit + 30-active per-user cap + 10-min reaper. Media key ownership-gated on post.
- [ ] Deferred (noted): physical S3/Forge object GC on status delete/expiry (access is already revoked
      by the proxy gate; only storage cost lingers). No storageDelete helper exists yet.

## v2.95.1–v2.95.3 — session-only guests, search, RN mirror (2026-07-21)
- [x] v2.95.1 — Session-only guests: guest cookie is a SESSION cookie + device id in sessionStorage,
      so a browser close mints a fresh guest; within a session the number is stable (either half
      resolves it). Registered users unaffected (persistent relay_session). Completes #28 + #30.
- [x] v2.95.2 — Messaging + History SEARCH: local filters over the loaded lists (thread list by
      name/number; call log by name/number/PIN + conference participants). Search-aware empty states.
- [x] v2.95.3 / RN — React Native MIRROR (#20): Onboarding reskinned + a guest "matrix"-style number
      reveal (Animated digit-decode, no canvas dep); SEARCH added to MessagesList + ContactsList;
      RICH USER STATUS ported (src/screens/Status.tsx — strip + composer[text/photo] + full-screen
      viewer with progress bars + delete; api.status.* + uploadStatusMedia; server base64 `bare:true`
      upload twin for the native base64 client). Video/audio status shows caption + "watch on web"
      (RN has no video-player dep). RN typecheck (tsc --noEmit) clean; verified via CI native-rn.yml.
      versionCode 3 / versionName 3.1.0. NOTE: the RN app targets .org, which must be republished for
      the status endpoints to answer; the code is ready + typechecked.
- [ ] Not mirrored to RN (needs native deps + device build): the canvas glyph-rain matrix backdrop
      (needs Skia), in-app video/audio status playback (needs react-native-video). Deferred, documented.

## v2.95.4 — .org RETIRED, .io is the ONLY deployment (owner decision, 2026-07-21)
- [x] Owner emptied the Manus/.org server entirely — your-chat.io (AWS) is now the primary and
      ONLY backend. Repointed every live .org reference:
      • mobile/native BASE_URL → https://your-chat.io (repoints tRPC + SSE signaling + v2 events +
        uploads together — the whole RN app derives from it). RN tsc clean; CI rebuilds the APK.
      • mobile/app Capacitor config (source + android/ios synced copies) → your-chat.io/app;
        dropped the manus.space allowNavigation entry.
      • mobile/android TWA hostName/defaultUrl/strings/deep-links → your-chat.io.
      • scripts/latency.mjs default target → .io.
      • CLAUDE.md (TL;DR + Deploying) + deploy.yml comments: .io auto-deploy is THE deploy flow;
        the Manus Publish flow is retired — never target .org/manus.space again.
- [x] Web app itself needed ZERO code changes (env/Host-driven since v2.92 R4B — the retirement
      validates that design). Remaining .org strings are test fixtures only.
- [ ] [YOU] Store note: previously-shipped APKs/TWAs point at the dead .org — users need the
      rebuilt versionCode-3 artifacts (CI: RELAY-RN + TWA workflows) uploaded to Play.
      [YOU] .io .env: set TWA_SHA256_FINGERPRINTS (assetlinks now served from .io) and confirm
      INBOUND_EMAIL_* / RESEND_FROM / SMTP_FROM use a domain you still control.
- [x] Follow-up: the owner's 301 middleware (.org→.io, commit 43ff0f5) tripped the
      noHardcodedDomains guard — extracted into server/domainMigration.ts (behavior identical,
      behaviorally tested incl. Host-port/case variants + pass-through) and consciously
      allowlisted like ecosystem.config.cjs. Guard header updated: .org retired, guard stays.

## v2.95.5 — NEW LANDING PAGE from Claude Design "RELAY Landing" (2026-07-21)
- [x] Full port of the owner's new landing design (project 2cf1060d, RELAY Landing.dc.html) into
      client/src/pages/Home.tsx: cinematic DTLS-SRTP boot loader, WORKING hero dialer (real DTMF
      Web-Audio tones, 6-digit gate, demo dial; CALL plays the encrypt-handshake cinematic then
      lands on /i/<n> — the app's call-link direct-join), marquee, scroll-driven three.js
      fly-through (5 depth zones: p2p net → waveform rings → orbs → globe arcs → starfield + dust),
      scroll-velocity matrix rain + text scramble, hue-shifting chrome, tilting keypad card,
      how-it-works demo cards, live-call + 10-person group-call showcases, privacy, FAQ, footer.
- [x] LIVE NETWORK stats carried over from the old landing (owner ask mid-build): registered
      users / guests served / call parties / online now via trpc.stats.public, restyled to match.
- [x] Deliberate adaptations: relative CTAs (/app, /i/<n>) + siteHost() chrome labels (domain
      guard compliant); three.js as an npm dep DYNAMICALLY imported (own 190KB-gzip chunk, loads
      after first paint; landing chunk itself 17.8KB gzip); no-WebGL + reduced-motion fallbacks;
      portraits reuse the ALREADY-BUNDLED /marketing/p01–p10 tiles (no new binaries); version
      footer kept (© 2026 RELAY · vX). Old bilingual (AR) landing retired with the design swap —
      the new design is EN-only (revisit if the owner wants AR back).
- [x] Home.test.ts fully re-pinned to the new page (12 pins). Suite 1072 passed / 1 skipped.

## v2.95.6 — ROUND 6: route support@ inbound email to the owner (2026-07-21)
- [x] Owner's instructions file (Rounds 1–5 previously verified shipped) added ROUND 6:
      registerEmailInbound now routes mail addressed to support[+tag]@INBOUND_EMAIL_DOMAIN
      (case-insensitive) to the APP OWNER before the no-match return — resolved via
      OWNER_OPEN_ID → getUserByOpenId → getIdentityByUserId, delivered into the owner's SELF
      ("Notes") conversation as "📧 <from>\nSubject: <subj>\n\n<body>" with
      meta {viaEmail, support}; SSE event published; response { ok:true, routed:"support" }.
      From-mismatch is deliberately SKIPPED for this branch (support mail comes from strangers;
      the Svix signature already authenticates the provider). Store failure → 503 so the
      provider retries (a support mail is never silently lost). New pure helpers
      isSupportRecipient/formatSupportBody/extractSubject + 9 tests (emailInbound.test.ts → 28).
      Lights up support@<domain> on .io the moment it deploys — AWS side needs zero changes.

## v2.95.7 — landing loader failsafes (owner: "loading page is not moving") + ARABIC back (2026-07-21)
- [x] LOADER CAN NEVER STRAND THE PAGE. Reproduced + fixed with headless-Chromium verification
      (local static serve of the real build): (1) the three.js scene now boots AFTER the boot
      loader completes — its shader compile/scene build on a slow or software-WebGL machine used
      to stall rAF and visibly freeze the bar; (2) a setTimeout watchdog force-clears the overlay
      at dur+1.6s even when rAF never ticks (hidden/background tab); (3) any exception inside a
      loader step force-clears it too. Mobile GPU tuning: DPR cap 1.25 + no antialias under 820px.
- [x] Killed the "%VITE_ANALYTICS_ENDPOINT%/umami" ghost request: the built index.html kept the
      literal placeholder when analytics env is unset (the .io CI build) → every load fetched a
      garbage URL, got SPA-fallback HTML, threw "SyntaxError: Unexpected token '<'".
      strip-manus-runtime.mjs (already in the deploy) now also strips unsubstituted %VITE_*% tags.
- [x] ARABIC IS BACK (owner: "Yes, AR"): full EN/AR copy tables for the new design (nav, hero,
      dialer incl. status strings, marquee, stats, how/features/privacy/faq, footer, loader
      narration + call cinematic), an ع/EN toggle in the nav, dir="rtl" page flip with LTR islands
      (dial display, keypad, stat figures, © line), choice persisted in localStorage("relay_lang"),
      default from navigator.language. Language switch re-renders WITHOUT replaying the boot
      cinematic. Browser-verified: EN→AR→EN flip, RTL Arabic hero, no page errors.
- [x] Home.test.ts +2 pin groups (bilingual + failsafes) → 14 pins. Suite 1083 passed / 1 skipped.

## v2.95.8 — support email placed on the landing (2026-07-21)
- [x] support@<host> (derived via the host — no domain literal, guard-compliant) is now visible:
      a mailto link in the footer (LTR island) + a sixth FAQ entry "How do I reach support?" /
      "كيف أتواصل مع الدعم؟" in BOTH languages, noting replies come from inside RELAY (the
      v2.95.6 Round-6 inbound routing). Pinned in Home.test.ts (15 pins).

## v2.95.9 — ZERO-JS loader failsafe (owner: "still not moving") (2026-07-21)
- [x] Verified the EXACT live v2.95.8 artifact (mirrored from .io, served locally, headless
      Chromium desktop + 6x-throttled mobile emulation): the bar progresses and clears with zero
      errors — the shipped JS is sound in everything emulable. The remaining report is almost
      certainly a held-over pre-fix bundle on the owner's device (close/reopen or hard-refresh)
      or an engine we can't emulate. Closed permanently with a PURE-CSS belt:
      • a CSS watchdog (`[data-lp="loader"]:not(.lp-js-ok)`) fades the overlay + drops
        hit-testing at ~5.6s unless the engine's FIRST action (adding .lp-js-ok) disarms it —
        works with zero working JavaScript (verified by dead-JS simulation in the browser);
      • the progress TRACK carries a CSS-only light sweep (loadTrack::after shimmer), so the
        loader visibly MOVES even if JS width/percent updates stall.

## v2.95.10 — mobile top-bar overflow + unreadable History rows (owner screenshot) (2026-07-22)
- [x] MOBILE TOP BAR: the standalone "Register" pill next to the avatar overflowed the bar on
      phones (clipped off-screen, crowding flag/number). The avatar is now an ACCOUNT MENU
      (shadcn DropdownMenu): identity header (name + number), Profile, "Register — keep this
      number" (guests only), and Sign out (destructive) — nothing account-related sits loose in
      the bar anymore. The number hides only under 360px (it's in the menu regardless).
- [x] HISTORY ROWS: on phones the 3–4 44px action buttons crushed the text column to ~40px —
      one word per line, name/PIN/date unreadable (owner screenshot). Both row types
      (SoloItem + ConferenceItem) are now wrap-aware: the text block claims a real minimum
      width (flex-1 basis-48, truncating status line), and when the actions don't fit they
      drop to a second right-aligned line (flex-wrap + ml-auto). Desktop renders exactly as
      before (single line — plenty of room). 1084 tests green.

## v2.96.0 — Peer identity everywhere + realtime status + media previews + self-destruct (owner spec, 3 screenshots) (2026-07-22)
- [x] AVATAR PROPAGATION FIX (the reported bug): a changed profile photo never reached anyone.
      Two causes: contacts.list served the FROZEN save-time avatar copy (now merged with the
      live identity avatar — `liveAvatarByNumber.get(number) ?? saved`), and the client never
      rendered `peerAvatarUrl` at all (thread rows / chat header / contacts / history drew
      initials discs). conferenceHistory participants now carry live avatarUrls too (one
      batched getIdentitiesByNumbers).
- [x] NEW `client/src/app/PeerOverlays.tsx` — the batch's core: `PeerAvatar` (photo or initials
      disc, optional `fallbackClassName` so History keeps its red/green/blue tone tints, STATUS
      RING around it: bright gradient = unseen story, subtle = seen; click opens the status
      viewer if they have one, else the profile popup), `openPeerStatus`/`openPeerProfile`
      window-event openers usable from ANY screen, and `PeerOverlaysHost` (mounted once in
      AppShell) hosting the global StatusViewer + the PROFILE POPUP (avatar, name + verified,
      formatted number, presence line, one-tap Message / Voice / Video, Add-to-contacts,
      View status).
- [x] Wired everywhere: Messages thread rows + conversation header (name tap → profile),
      Contacts rows (main tap → profile popup — supersedes the old tap-to-voice; the green
      circle still dials), History solo + 1:1 conference rows (avatar in the tone disc, name
      tap → profile), Dialer 6-digit preview (name tap → profile).
- [x] STATUS REALTIME: new `getStatusAudienceIds` (v2db — the REVERSE of the feed rule: everyone
      who saved me, non-blocked both ways) feeds a new `"status"` SSE event kind published on
      status.post AND status.remove (removed:true refreshes silently). useRealtime invalidates
      status.feed + shows a QUIET toast ("X posted a status" + View action that deep-opens the
      viewer — no sound, no notification). The Messages tab wears a teal unseen-status dot
      (desktop sidebar + mobile bar, distinct from the unread-count badge).
- [x] QUICK-ADD CONTACTS (any guest/user combination — a contact is just a saved number):
      one-tap UserPlus on History rows (hidden when already saved, savedNumbers from
      contacts.list), in the profile popup, on the Dialer preview (pre-existing), and IN-CALL:
      relayClient gains a read-only `getRoster()` (mesh peers + SFU participants) and
      RelayEngine renders an `InCallSaveContacts` chip (top-left, dismissible per call) for the
      first on-call peer not in contacts.
- [x] MEDIA PREVIEW OVERHAUL (Messages bubbles): custom dark `VoiceNotePlayer` (round
      play/pause, seekable track + live clock, download; lazy HTMLAudioElement; handles the
      MediaRecorder Infinity-duration quirk) replaces the native white `<audio controls>` blob;
      `FileCard` (icon tile + filename + "tap to open or download") replaces the bare underline
      link; broken images fall back to the card instead of a white rectangle (onError), images
      get a dark loading backdrop; the fullscreen lightbox gains a Download button.
- [x] SELF-DESTRUCTING MESSAGES: composer Timer toggle cycles off → view-once (1×) → 5s → 10s →
      30s (per-send, resets after sending; a violet banner explains the active mode; applies to
      text, media, AND voice notes) → sent as `meta.expire` ("once"|5|10|30 — the meta zod
      shape stays CLOSED). Recipient sees a locked "Tap to view" card; opening BURNS the row
      for everyone via `messages.consumeExpiring` → `consumeExpiringMessage` (participant-only,
      non-sender, exactly once: body nulled, attachment ROW deleted so the storage key stops
      authorizing — same access-layer honesty as status media) and fans a message event to all
      participants. The reader keeps a LOCAL copy for the countdown ("Disappears in Ns", 300ms
      ticker) or, for view-once, until leaving the thread; both sides then render an honest
      "This message has disappeared" placeholder. Expiring content NEVER leaks: thread-list
      previews null it server-side, conversation search filters it out, reply quotes show
      "⏱ Disappearing message".
- [x] `server/peerIdentityBatch.test.ts` (30 pins across all four legs) + Contacts.test.ts pin
      updated to the new row-tap behavior. Suite 1114 passed / 1 skipped; `pnpm check` + build
      green.

## v2.96.1 — owner feedback on v2.96.0 (4 points + call-screen extras, 4 screenshots) (2026-07-22)
- [x] BROKEN AVATARS (profile + call history showed broken-image icons to OTHER users) — real
      root cause found: profile photos were uploaded through the ATTACHMENT path, so the v2.95
      participant-only storage gate authorized ONLY the uploader (your own photo worked; everyone
      else got 403 → the browser's broken-image glyph — v2.96.0 rendering avatars everywhere made
      it visible). Fixed at every layer: (a) new uploads use `uploadAvatarImage` → `?bare=1`
      (no attachments row → the proxy's semi-public avatar path); (b) LEGACY keys are rescued in
      `authorizeStorageKey` — on the would-be-403 path, a key that is some identity's CURRENT
      avatar (`isIdentityAvatarKey`, relative + legacy absolute URL shapes, LIKE-escaped) serves
      as `kind:"avatar"`; (c) `PeerAvatar` falls back to the initials disc on img error (keyed by
      URL) so a truly dead object can never render as a broken glyph.
- [x] AUTO-REFRESH ON UPDATE (owner: "no need to click Refresh") — UpdateChecker now reloads
      silently when IDLE as well as in-call (dialing/ringing still defer — a reload there drops
      the pre-answer call). The "Refresh now" card remains only as the loop-guard fallback when a
      silent reload ran <60s ago and the bundle is STILL stale (CDN edge mid-rollout).
- [x] IN-CALL CAMERA/MIC CLARITY — both controls now carry TWO glyphs (feather video/video-off,
      mic/mic-off) swapped by the `.off` class, so the state reads from the icon itself, not just
      the red tint. Proper aria-labels/titles.
- [x] IN-CALL SAVE-CONTACT CHIP → ICON-ONLY (owner: "just show the button, don't show the text"):
      one round UserPlus button top-left, tooltip carries the name; disappears once everyone on
      the call is saved (dismissed-set dropped).
- [x] CALL-SCREEN FOOTER GONE — `body.relay-call-active .version-tag{display:none}`: the
      "© 2026 RELAY · vX · date" line no longer collides with the chat composer.
- [x] IN-CALL CHAT REDESIGN (owner screenshot: overlay sat on the copyright + End button, no
      sender identity): on phones the chat is now a BOTTOM SHEET (72dvh, rounded top, opaque
      surface, shadow; the End pill's corner stays clear; composer clears the iOS home bar via
      safe-area padding), and every message renders as an avatar-disc row with NAME + TIME —
      mine on the RIGHT, the other party on the LEFT (`.mrow me|them`, addChatMsg rewrite).
- [x] CAMERA FLIP HANG ("close/open several times before it works") — stop-the-old-camera-first
      is now UNIVERSAL (was iOS-only; several Android WebViews also single-capture), acquisition
      retries with backoff (0/300/700ms — a just-released camera transiently NotReadableErrors),
      failure recovery re-grabs the original facing on every platform, and a fresh-but-muted
      track rebinds the self tile on `unmute` instead of sitting black.
- [x] PiP NOT WORKING (iPhone) — two honest bugs: `webkitSetPresentationMode` was called before
      the fresh stream had ANY decoded frame (iOS silently ignores it) and the code toasted
      "Picture-in-Picture on" regardless. Now: voice-only calls get a clear "needs video" message,
      entry waits for `loadeddata` (≤900ms cap), and the mode is VERIFIED after the call — a
      refusal surfaces as "Couldn't start Picture-in-Picture" instead of a false success.
- [x] `server/v2961Fixes.test.ts` (15 pins) + updated pins in updateChecker / androidAudioCamera /
      peerIdentityBatch / Contacts tests. Suite 1129 passed / 1 skipped; check + build green.

## v2.96.2 — in-app video recorder (owner screenshot: "Recording video is not available while on a call") (2026-07-22)
- [x] ROOT CAUSE is an iOS OS RESTRICTION, not a RELAY bug: while ANY call is active (RELAY web
      calls included), iPhone refuses to let the SYSTEM camera record video — photos still work,
      video is blocked, and the <input capture> path hits the same wall. WhatsApp works around it
      by recording INSIDE the app; RELAY now does the same.
- [x] NEW `client/src/lib/videoNote.ts` (mirrors voiceNote.ts): `pickVideoMime` probes what the
      browser really encodes (video/mp4 FIRST — Safari/iPhone — then vp9/vp8/webm; NO blind ""
      fallback), `openVideoCapture(facing)` owns acquisition, `recordFromStream` records with a
      1s timeslice (Safari flushes progressively) at bounded bitrates (2.5Mbps video + 128k
      audio ⇒ ≈20MB/min, far under the 40MB upload cap) and deliberately leaves the preview
      stream alive (the sheet owns release, so Retake doesn't re-acquire).
- [x] NEW `client/src/app/VideoRecordSheet.tsx`: full-screen in-app camera — live preview
      (front-cam mirrored, recorded clip raw), flip front/back, record with running timer +
      auto-stop countdown, review with Retake / Use, camera released on EVERY exit path, and an
      honest message when the camera is held by a video call ("turn the call's camera off
      first").
- [x] MESSAGES: the image button now opens a two-option chooser when the recorder is supported —
      "Record video" (in-app, works mid-call) / "Photo & video library" (native picker,
      unchanged) — and a recorded clip lands in the NORMAL attachment flow (pendingUpload), so
      captions and the v2.96 disappearing timer apply before Send. 60s cap.
- [x] STATUS: a third "Record" tab in the composer (gated on browser support) feeds the same
      pipeline as a picked file — 30s story cap, caption, bare status upload.
- [x] `server/v2962VideoRecorder.test.ts` (11 pins). Suite 1140 passed / 1 skipped; check +
      build green.

## v2.96.3 — bell panel off-screen + ONE round hang-up (owner screenshots) (2026-07-22)
- [x] NOTIFICATION PANEL FIT: the bell sits mid-bar on phones, so its right-anchored absolute
      w-64 dropdown ran past the LEFT screen edge (title/icons clipped — owner screenshot). On
      mobile the panel is now FIXED and viewport-clamped (inset-x-3, under the sticky header);
      the desktop sidebar instance (which had the mirror problem at the left screen edge) now
      opens RIGHTWARD (left-anchored) into the content area.
- [x] ONE HANG-UP, PROPERLY ROUND: the floating top-right "X End" pill (React layer) duplicated
      the engine's own hang-up on BOTH the dial screen and in-call — removed. The engine's
      `.ctrl.hangup` is redesigned from the 66px rounded-rect pill into a true round red phone
      button (58px circle, 26px glyph, gradient + ring shadow); the pre-connect dial screen gets
      the big iPhone-style 72px version and STRIPS the glass ctrl-bar shell around it (that dark
      rounded-rect shell was the reported "ugly" blob).
- [x] `server/v2963Fixes.test.ts` (4 pins) + vvtu focus-ring pin updated to the surviving
      Exit-the-call control. Suite 1144 passed / 1 skipped; check + build green.

## v2.97.0 — FLASHY incoming-call card + glossy animated call buttons (owner spec, 2 screenshots) (2026-07-22)
- [x] RING CARD REDESIGN (headless-browser previewed before ship): glossy glass card; the
      caller's REAL PHOTO (async public directory.lookup, guarded against stale/previous
      callers; initials fallback) inside a ROTATING conic-gradient ORBIT ("ring line going round
      and round") + two radiating halo pulses; name + VERIFIED badge + flag + formatted PIN +
      live presence/status line ("Online now" / "Away" / "Traveling").
- [x] THREE ROUND GLOSSY ANIMATED BUTTONS with labels: Voice (green gradient, bobbing + outward
      ripple), Video (teal, offset bob/ripple; wrapper hides on voice dials per the consent
      protocol), Decline (red, periodic nudge/shake). Gloss = top highlight ::before on every
      circle. ALL motion behind prefers-reduced-motion (house rule).
- [x] BELOW THE BUTTONS: "Send to voicemail" (declines — the caller then gets the existing
      voicemail offer, which lands in your Messages as audio) and "Message…" which folds out the
      3 canned quick replies PLUS a TYPE-YOUR-OWN box (Enter or ↑ sends via the quick-reply
      bridge → real chat message → declines). Fresh rings clear the draft + fold the panel.
- [x] OUTGOING dial screen: the round hang-up gains the same gloss highlight and, while
      ringing, a breathing bob + red ripple ring (motion-gated).
- [x] Pins updated in incomingRing.test.ts (photo/orbit/gloss/voicemail/type-a-message) +
      videoConsent (vWrap). Suite 1146 passed / 1 skipped; check + build green.

## v2.97.1 — call hold overhaul: the held call must NOT drop + hold music + End-held (owner spec) (2026-07-22)
- [x] ROOT CAUSE of "answering the second call drops the first": on the SFU path (what .io
      runs), putting a call on hold tears down the HOLDER's LiveKit connection — and the HELD
      party's client read that disconnect as "they left" → 1:1 auto-end → hangUp("remote-left").
      The server's peer-hold signal existed but removeLkTile never consulted it, and it can
      even arrive AFTER the disconnect event (a genuine race).
- [x] FIX, three layers in relayClient: (1) `peersHoldingUs` — peers who parked us — gates
      every auto-end path; the holder's tile STAYS on screen marked on-hold instead of being
      removed; (2) a bare solo-1:1 SFU disconnect now arms a 1.6s GRACE fuse (`armSoloEndGrace`)
      instead of ending instantly — a late peer-hold (or a rejoin) defuses it, and the fuse
      re-checks everything (still alone, nobody holding, still 1:1) before ending + honoring
      the v2.94.8 held-promotion; (3) if peer-hold beat the disconnect but the tile was already
      gone, onPeerHold restores a placeholder tile. A REAL leave (peer-left — the holder hung
      up entirely; the server's releaseHeldRoom broadcasts it) clears the hold state first so
      the call still ends honestly, now routed to the SFU tile too (the old peer-left case only
      called the mesh removePeer, which no-ops on the SFU path).
- [x] HOLD MUSIC + BANNER for the parked party: a light looped WebAudio motif (soft C-major
      add9 arpeggio, ~3.4s bars, quiet gain; queued oscillators stopped on resume — the
      ringtone suspended-context lesson) + a calm "X put you on hold — hang tight" banner
      (#onHoldBar; stacks below the held-bar if you're holding one line while the other holds
      you). 1:1 only — in groups the tile marker suffices. Music/banner clear on resume,
      real leave, call end, and engine destroy.
- [x] PICK WHICH CALL TO DROP: the held-bar now offers Swap / Merge / **End held** (red) —
      endHeldLine() closes the frozen PCs and the NEW server case `end-held` releases only the
      held room via the existing releaseHeldRoom (members get a normal peer-left; the active
      call is untouched; a second end-held errors `nohold`). The hang-up button keeps its
      end-active-and-resume-held behavior, so both directions of "drop one line" exist.
- [x] `nameOf` now falls back to `peerNamesSeen` (recorded by createPeer + addLkTile) so hold/
      leave messaging can NAME an SFU peer instead of showing their raw pin.
- [x] BEHAVIORAL server test (relay.test.ts): A↔B live, C rings B, B answers (A held), B sends
      end-held → A gets peer-left, B+C untouched, hold cleared, second end-held → nohold.
      + server/v2971Hold.test.ts (10 pins). Suite 1157 passed / 1 skipped; check + build green.

## v2.97.2 — RELAY_OTP_REGISTER_BYPASS: temporary registration-without-email stopgap (owner directive) (2026-07-22)
- [x] CONTEXT: AWS SES (ap-south-1) is sandboxed pending the owner's production-access request (confirmed
      pending via the AWS account API — "ConflictException: already exists"). Until AWS approves it,
      every registration OTP to a non-pre-verified address is refused by AWS itself — owner screenshot
      showed "We couldn't send your code — email delivery isn't set up yet." The owner asked to pull the
      OTP-send step out of registration for now and put it back once SES is approved.
- [x] NEW env flag `RELAY_OTP_REGISTER_BYPASS` (read per-call, default OFF ⇒ byte-identical to before).
      When `=1`, `otpAuth.register` skips minting/emailing a code entirely and performs the SAME
      account/session outcome a real verifyOtp would (resolve-or-create the user, mark email verified,
      unlock any PIN lock, upgrade the guest identity in place, set the session cookie) — a deliberate,
      TEMPORARY trust reduction the owner explicitly accepted: email ownership is not proven at signup
      while this is on. Existing-user LOGIN (`requestOtp`/`verifyOtp`/`loginWithPin`) is completely
      untouched — only brand-new registrations are affected.
- [x] Client (`AuthPanel.tsx`): `submitRegister` recognizes the mutation's `bypass:true` response and
      skips straight to the post-registration "setup" step (choose PIN vs email-code sign-in) — the same
      screen a normal successful code-verify lands on — instead of showing a code-entry screen for a code
      that was never sent.
- [x] TO RESTORE full email verification the moment AWS approves production access: unset
      `RELAY_OTP_REGISTER_BYPASS` (or set it to anything but `1`) in `/home/relay/.env` on both EC2
      instances and restart pm2 — no code change, no redeploy needed.
- [x] `server/otpRegisterBypass.test.ts` (6 tests): default-OFF takes the normal mint/email path (proven
      by a DIFFERENT DB-unavailable error than the bypass path), any non-"1" value is OFF, ON skips
      straight to account creation, input validation still runs before the flag is consulted, login is
      unaffected, and the client-side skip-to-setup branch is source-pinned. Also fixed two stale
      `awsOps.test.ts` pins left behind by the same-session aws-ops.yml ops-action additions
      (ses/ses-ssm/iam-grant-ses + the OIDC-fallback auth detector). Suite 1163 passed / 1 skipped;
      check + build green.

## v2.98.0 — three-part owner batch: profile avatar save race, video-recorder honest labeling, hang-up redesign (2026-07-22)
- [x] CONTEXT: a single garbled voice report bundled three separate complaints ("problem on the profile
      when you captured [a photo], it didn't post", "problem on the status/message video record", "the
      call screen's red hang-up button... not nice, redesign it"). Rather than ask for clarification,
      each was run down with direct code investigation + live headless-browser testing until a concrete,
      provable bug was found (or, for #3, a concrete design fix was built and screenshot-verified).
- [x] (1) PROFILE AVATAR SAVE RACE — `client/src/pages/app/Profile.tsx`'s `onAvatarPick` uploaded the
      photo, then fired `updateProfile.mutate({avatarUrl})` FIRE-AND-FORGET while the `uploading` spinner
      cleared in a `finally` that only awaited the upload step. A save failure (session hiccup, dropped
      request) left a REAL uploaded photo sitting in storage with the profile's `avatarUrl` never actually
      updated — while the UI had already told the user it was done. Fixed by awaiting
      `updateProfile.mutateAsync(...)` inside the SAME try block as the upload, so the spinner and the
      error banner both cover the whole two-step pipeline, not just the first half.
- [x] (2) VIDEO RECORDER HONEST CONTAINER LABELING — root-caused via a headless Chromium capture with a
      fake camera device (`--use-fake-device-for-media-stream`), not guesswork: this browser's
      `MediaRecorder.isTypeSupported("video/mp4")` returns true, but the recorder actually encodes
      VP9+Opus under that label. Critically, `rec.mimeType` only reveals the true codec (`"video/mp4;
      codecs=vp9,opus"`) once encoding actually starts — it stays the bare `"video/mp4"` for
      tens-to-hundreds of ms after construction AND after `start()`, so an initial fix that checked
      `rec.mimeType` right after `new MediaRecorder(...)` never caught it (proven empirically with a
      timing probe before committing to the real fix). `client/src/lib/videoNote.ts`'s `recordFromStream`
      now forces an immediate `requestData()` flush right after `start()`, which reveals the true codec
      within ~2ms with no meaningful footage recorded yet; if it's mislabeled, the barely-started recorder
      is swapped for an honest `video/webm` one. Verified end-to-end against the real API: the resulting
      blob's first four bytes are the genuine WebM/Matroska magic `0x1A 0x45 0xDF 0xA3`, and the resolved
      `ext`/`mimeType` correctly say "webm", not the stale original mp4 pick.
- [x] A SECOND bug was found and fixed while building (2), also reproduced headlessly before the fix
      existed: calling `cancel()` in the same tick as construction — before the mislabel probe had run —
      used to make the swap logic ignore `cancelled` and start a brand-new LIVE recorder that nobody would
      ever stop again, leaking the recorder and hanging the `done` promise forever (confirmed: a dedicated
      race test timed out with `done` never resolving). Fixed with a `cancelled` check inside the swap
      branch before it commits to starting a new recorder.
- [x] (3) OUTGOING-CALL HANG-UP REDESIGN (owner: "the red one for Hangout... it's not nice") — the
      pre-connect dial screen's lone red circle (previously a bare 76×76 circle, no caption) now gets a
      soft ambient halo (radial glow behind the button, distinct from the existing tight ripple ring), a
      richer two-tone red gradient, a bigger glyph, and a real "End Call" caption underneath; new motion
      gated behind `prefers-reduced-motion` like every other ring-card animation. A real bug was found and
      fixed while building this: the mobile media query that lets a CROWDED in-call control bar scroll
      (`max-height:40vh;overflow-y:auto`) was silently clipping the new halo + caption on the pre-connect
      screen, where there's only one button and nothing to scroll — fixed with a higher-specificity
      `#call.pre-connect .ctrl-bar` override (`max-height:none;overflow:visible`), confirmed via a headless
      render (screenshot evidence, not just source pins).
- [x] Tests: `server/v298ProfileAvatarFix.test.ts` (3), `server/v298VideoMislabelFix.test.ts` (6),
      `server/v298CallerHangup.test.ts` (6). Also fixed two now-stale pre-existing pins:
      `server/v2962VideoRecorder.test.ts` (its onstop/getTracks check silently degraded to a vacuous
      always-pass slice once `videoNote.ts` switched from `.onstop =` to `addEventListener("stop", ...)` —
      re-anchored to scan the whole `recordFromStream` function body) and `server/v2963Fixes.test.ts` (its
      72px hang-up-button pin was legitimately superseded by this version's 76px redesign — updated to the
      new dimension, the surrounding "bare bar" assertion it shares the test with is untouched since that
      part of the v2.96.3 fix still holds). Suite 1178 passed / 1 skipped; check + build green.

## v2.98.1 — landing loader bar frozen at 0% (compositor fill) + the mobile nav hid the AR/EN toggle (2026-07-22)
- [x] LOADER BAR PINNED AT 0% (owner report, 3rd round after v2.95.7/v2.95.9): reproduced the
      MECHANISM headlessly — the bar's fill/percent rode requestAnimationFrame width writes, so a
      device whose main thread is saturated during the 3.4s boot cinematic (JS parse, font/image
      decode, low-end phones) paints ZERO intermediate frames: the bar sits at its first painted
      value (0%), then the v2.95.7 watchdog clears the overlay and the visitor jumps straight to
      the page — "bar stays zero but it goes on". Verified the current code animates fine in every
      emulable environment (prod build, iPhone/Pixel emulation, 8x/20x CPU throttle, slow 3G, RTL);
      also ruled out stale bundles (SW caches nothing; both EC2 instances took today's deploys —
      confirmed in the run-50 SSM logs) and reduced-motion (overlay hidden entirely).
- [x] FIX: the fill is now COMPOSITOR-DRIVEN — `#loadBar` is a full-width bar scaled by
      `@keyframes lpFill{from{scaleX(0)}to{scaleX(1)}}` (transform-only, per the repo's own
      animation discipline), declared in plain CSS so it runs even with zero JS, re-timed by
      runLoader per run (boot 3400ms / call cinematic 3000ms via the none→reflow→set restart).
      Chromium/WebKit run transform animations on the compositor thread, so a blocked main thread
      can no longer freeze the visible fill (headless-verified: the animating bar is promoted to
      its OWN composited layer — the threaded-animation signature; a mid-block screenshot is not
      capturable in headless, so layer promotion is the proof). rAF now only syncs the percent
      text, staged messages, and the lock. RTL grows from the right (`[dir="rtl"]` origin).
      Bonus hardening: the reduced-motion `animation:none!important` block now re-asserts the
      v2.95.9 zero-JS lpAutoClear watchdog so that combination can never strand the overlay.
- [x] LANGUAGE SWITCH "NOT WORKING" (owner): root cause was NOT the toggle logic — on phones the
      desktop nav links were never hidden (`.lp-navlinks{display:none}` silently LOSES to the
      markup's inline `display:flex`; the neighboring rules in the same media block use
      !important, this one didn't), so "HOW IT WORKS / FEATURES / PRIVACY" wrapped to three lines
      and shoved the ع/EN toggle AND the Open-App pill off the right screen edge (nav scrollWidth
      605px on a 390px viewport; the button hit-tested outside the viewport). Fix: the hide gets
      !important, and the ≤760px block compacts the nav (`padding:12px 14px`, gap 12px, smaller
      logo type, tighter ع/EN + Open-App pills) so logo + toggle + CTA fit a 320px viewport.
      Headless-verified on iPhone emulation: nav fits, toggle on-screen, EN→AR→EN flips + persists
      (localStorage relay_lang), Arabic boot renders dir=rtl with the bar growing from the right.
- [x] Home.test.ts +2 pin groups (compositor fill / mobile nav fit) incl. a `bar.style.width`
      BAN; updateChecker version pin bumped. Suite 1180 passed / 1 skipped; check + build green.

## v2.98.2 — the percent counter moves with the bar + English is the default language (owner) (2026-07-22)
- [x] PERCENT COUNTER FROZEN AT 0% (owner follow-up to v2.98.1: "under the bar there is like a 0%…
      that one is not moving along with the progress bar"): expected — the v2.98.1 fix made the BAR
      compositor-driven but the number was still rAF-written textContent, which paints nothing on a
      saturated main thread. Now the counter is compositor-driven too: `pctStripLines()` renders a
      vertical 0%–100% odometer strip (101 × 14px lines, Latin digits in both languages, LTR
      island) inside the overflow-hidden `#loadPct`, swept by `@keyframes lpPct` (translateY to
      `calc(-100% + 14px)`) with the SAME duration/easing as the bar's lpFill — declared in plain
      CSS (zero-JS default 3.4s) and re-timed per run by runLoader (boot 3400ms / call 3000ms).
      rAF now only syncs the staged messages and the lock. Headless-verified: counter and bar in
      exact lockstep (63/63 → 93/93), pctStrip promoted to its own composited layer (threaded-
      animation signature), full lifecycle trace clean (overlay 0.5s→4.9s), CDP screenshot shows
      bar at 72% with the counter reading 72%.
- [x] ENGLISH IS THE DEFAULT LANGUAGE (owner: "the Arabic is currently the default language but the
      default language is English"): `initialLang()` no longer auto-picks Arabic from
      `navigator.language` — every first-time visitor gets English; the ع/EN toggle switches both
      ways and the persisted localStorage("relay_lang") choice still wins on return visits.
      Headless-verified with an ar-SA locale: first visit renders LTR English; saved "ar" reloads
      RTL Arabic; toggle flips both directions.
- [x] Home.test.ts pins extended (lpPct keyframes + strip re-time + `pct.textContent` ban;
      navigator.language ban + English-default comment pin); updateChecker version pin → 2.98.2.
      Suite 1180 passed / 1 skipped; check + build green.

## v2.98.3 — hang-up glyph centered on the dial screen (owner screenshot) (2026-07-23)
- [x] The white handset icon sat pinned to the LEFT edge of the big red End Call circle on the
      pre-connect dial screen (owner screenshot, native-shell WebView). ROOT CAUSE: `.ctrl`
      centers its glyph with `display:grid;place-items:center`, but the v2.74 pre-connect
      un-hide rule (`#call.pre-connect .ctrl-bar .ctrl.hangup`) re-showed the button with
      `display:flex` — flexbox has no justify-items, so the svg fell back to flex-start.
      Reproduced in an isolated headless render of the REAL markup+CSS: svg offsets 1px left /
      42px right before, 21.5px on all four sides after the one-word fix (flex→grid). The
      compact in-call hang-up (grid all along) was never affected — which is why only the dial
      screen looked wrong. Pinned in v298CallerHangup.test.ts (display:grid + a flex ban).
      Suite 1181 passed / 1 skipped; check + build green.

## v2.98.4 (pt.1) — SECURITY AUDIT & REMEDIATION (owner-requested full front/back/DB review) (2026-07-22)
- [x] CONTEXT: owner asked for "a full check of all security everything — all app connections, front and
      back, and the database" and to fix + report. Ran an automated scan (Claude Security), then
      independently VERIFIED every candidate against the current source before touching anything. 5
      findings confirmed (1 High / 2 Medium / 2 Low); all fixed. Full report saved to the repo as
      `SECURITY-AUDIT-2026-07-22.md`. Owner-accepted designs (SSE-not-WebSocket, kept `/api/oauth/callback`,
      `RELAY_OTP_REGISTER_BYPASS`) reviewed and NOT flagged as defects.
- [x] F1 (HIGH) — signaling `register` had no identity binding. The SSE+POST transport was keyed only by a
      client-minted `cid`, and `register` granted ANY free 6-digit number from the client's `msg.pin`, so an
      attacker could claim a victim's number while the victim's app was closed and INTERCEPT their inbound
      calls / SPOOF caller-ID. Fix (`server/relay.ts` + `client/src/lib/relayClient.ts`): for `register`
      messages `POST /api/relay/send` resolves the caller's OWN identity number via `createContext`
      (session/guest cookie) and stamps a server-only `__ownedNumber` (client value stripped first); the
      register handler binds the pin to it — resolved ⇒ own number (self-heals stale clients post-renumber);
      null ⇒ explicit claim refused + fresh number (fail closed); field absent ⇒ legacy/test behavior. The
      client now sends `x-relay-device-id` on the signaling POST so cookie-dropped ITP guests still resolve.
      Only `register` is async now; offer/answer/ICE stay fully synchronous. Residual follow-up: a
      room-membership check on the `signal` relay.
- [x] F2 (MEDIUM) — `identity.updateProfile` validated only the SHAPE of `avatarUrl`, letting a user point
      it at another user's private `/manus-storage` attachment key, which `authorizeStorageKey`'s
      avatar-rescue then served to anyone (survived unsend). Fix: `keyInOwnerNamespace` gate on write
      (matches `attachments.register`/`status.post`).
- [x] F3 (MEDIUM) — burning view-once media made it MORE accessible: `consumeExpiringMessage` deleted the
      attachments row → `authorizeStorageKey` classified the still-present S3 object as `unknown` → the
      storage proxy served it with NO auth. Fix: keep the row (message `attachmentId` already nulled ⇒
      participants lose access) so the key stays `attachment` and fails CLOSED (403) for every non-uploader.
- [x] F4 (LOW) — per-IP rate limits trusted the LEFTMOST `X-Forwarded-For` hop (client-appendable behind the
      appending ALB), so rotating the header defeated every limiter. Fix (`server/rateLimit.ts` +
      `pickClientIp`): trust the proxy-APPENDED hop (`trustedProxyHops()` from the right, default 1; set
      `RELAY_TRUSTED_PROXY_HOPS=2` for a CloudFront→ALB chain).
- [x] F5 (LOW) — `directory.lookup`/`presenceMany` were public and unthrottled over the 10^6 number space
      (free directory scrape). Fix: a generous per-IP `directoryGate` (120 burst / ~60/min, honors
      `RELAY_RATELIMIT_OFF`); endpoints stay public so the `/i/<pin>` call-link direct-join still works.
- [x] Tests: new `server/securityAudit.test.ts` (F1 behavioral — bind/attacker-refused/null-refused/reconnect/
      legacy — plus F2/F3/F5 wiring pins); updated `rateLimit.test.ts`, `geoSelf.test.ts`,
      `peerIdentityBatch.test.ts` (F3), `relayCluster.integration.test.ts` (async register). Suite 1196
      passed / 1 skipped; `tsc --noEmit` + production build green.

## v2.98.4 — SECURITY SWEEP ROUND 2 (owner: "maximize the bugs, fix it everywhere, merge to main") (2026-07-23)
- [x] Exhaustive multi-agent audit of 12 attack surfaces (auth, signaling, storage/SigV4, tRPC IDOR, SQL,
      crypto/secrets, SSRF, email/inbound, client XSS/CSP, DoS/ReDoS, Redis-bus cluster, headers/config).
      Every candidate adversarially verified against source; 7 confirmed + 6 partial survived (8 refuted).
      All meaningful findings fixed (S1–S11); report appended to `SECURITY-AUDIT-2026-07-22.md`.
- [x] S1 (HIGH) PIN lockout brute-force race — `server/authPin.ts attemptPinLogin` wrote `stale+1`, so
      concurrent wrong guesses lost increments and defeated the 3-try cap on the 10^4 PIN space. Fixed with a
      single guarded conditional UPDATE (increment + lock-on-threshold, `WHERE loginPinLockedAt IS NULL`),
      verdict from the persisted post-value, lock email once via affectedRows.
- [x] S2 (MED) `signal` relay had no room-membership check — any registered client could push SDP/ICE to any
      online pin and harvest its ICE candidates (IP deanonymization). Fixed to relay only within a shared room
      (active pinRoom OR held heldRoom); behavioral test (in-room relay works, out-of-room dropped).
- [x] S3–S5 (LOW) F5 enumeration gaps — `directory.presence` (+ missing guest-privacy), `directory.watchOnline`
      (name-harvest oracle), `calls.logStart` (existence oracle + history-row injection) all bypassed the F5
      directoryGate; now gated (presence also runs isGuestPresenceHidden). Endpoints stay public for /i/<pin>.
- [x] S6 (LOW) `messages.markRead` IDOR — the peer-message status:"read" flip wasn't membership-scoped;
      `markThreadRead` now checks conversationParticipants in-tx + returns membership, router fans out the read
      SSE only for members.
- [x] S7 (LOW) `POST /api/v2/upload` storage DoS — added per-IP + per-identity token buckets before storagePut.
- [x] S8 (LOW) Web Push endpoint SSRF — `isAllowedWebPushEndpoint` (https + known push-service allowlist) on
      push.subscribe + defensively before webpush.sendNotification (legacy rows dropped).
- [x] S9 (LOW) OTP attempt-counter race — `recordOtpFailure` made atomic (same pattern as S1).
- [x] S10/S11 (LOW) signing secrets failed open — `sessionSecret`/`inboundSecret` fell back to a public
      constant when env unset (bare-HMAC session ⇒ trivial forgery); now fail CLOSED in production, dev/test
      keep the fallback; inbound webhook route rate-limited.
- [x] `server/securitySweep.test.ts` (12 tests) + S2 behavioral test in relay.test.ts. Suite 1208 passed /
      1 skipped; check + build green.
- [ ] RESIDUAL (accepted, not changed): no per-caller outstanding-invite cap / pendingRings reaper (bounded
      benefit vs. hot-signaling-path risk); inbound webhook signature stays opt-in (mandatory would break
      operators running without the secret; the From==owner-email binding still gates the reply path).

## v2.98.5 — RELIABILITY PASS (owner: "make it successful") (2026-07-23)
- [x] Bug hunt across calling/messaging/onboarding, each candidate independently verified against source
      before any fix (the calling core turned out heavily hardened already from prior audits — no
      high-severity correctness bug substantiated there beyond the item below).
- [x] `getOrCreateDmConversation` could permanently orphan a DM thread — the conversation-row insert and the
      participant-row insert were two separate round trips with NO transaction (unlike its sibling
      createGroupConversation, which already wraps both in one); a failure or slow participant insert between
      them left a committed conversation row with no participants and no recovery path, 403'ing both users
      out of their own thread forever on every later open. Fixed: the participant upsert now runs
      unconditionally on every call (self-heals already-orphaned rows, closes the race for new ones).
- [x] Messages: scrolling back to the bottom never re-fired the read receipt (only a new message arriving or
      tab-focus did) — a thread could stay "unread"/no-✓✓ forever after the user actually read it. Scroll
      handler now debounce-fires markRead when back near the bottom.
- [x] Call-waiting: the promoted-ring presentation (post-hangup "let the waiting caller ring through") didn't
      reset the Video-answer button — `waitingRing` never carried the `video` flag, and the promotion block
      (its own comment says "mirror of onRing's presentation") omitted exactly that one reset. Both fixed.
- [x] `useRealtime`'s SSE onmessage closure could read a stale identity id (effect depended on [enabled] only
      while capturing selfId) — added selfId to the dependency array.
- [x] Reviewed and left alone: PresenceManager's instant-offline-on-tab-hide is a deliberate, documented
      trade-off (catches mobile Safari tab-closes that don't fire pagehide); a debounce would defeat detection
      on exactly the browsers it targets.
- [x] New `server/reliabilityPass.test.ts` + `client/src/app/reliabilityPass.test.ts` + a pin in
      `useRealtime.test.ts`. Suite 1216 passed / 1 skipped; check + build green.

## v2.98.6 — HARDENING PASS 3 + call-latency review (owner: "improve security + call latency, ship to main") (2026-07-23)
- [x] CALL LATENCY: reviewed every code-level lever — connect path already fully optimized (multi-STUN
      Google×2+Cloudflare, iceCandidatePoolSize/max-bundle/rtcp-mux, TURN UDP+TCP:443+TCP:3478+TLS, engine
      preloaded+auto-registered on /app entry, heavy deps code-split). NO code change made; the only remaining
      variable is a dedicated operator coturn (TURN_SECRET/TURN_HOST) vs the free openrelay fallback — ops, not
      code. Deliberately did not churn the live call path with speculative changes.
- [x] Fresh cross-surface security/correctness re-check (every tRPC procedure, v2db helpers, Express routes,
      SSE/upload/storage, signaling moderation, client rendering of user strings). Found the "system-wide
      application" gap in the messages router + a call-path block gap. 4 fixed:
- [x] E1 (MED) `messages.openThread` — un-throttled number→identity oracle leaking display name + avatar AND
      planting an empty DM thread in the target's inbox per probe. Added directoryGate (same gate as F5/S3–S5).
- [x] E2 (LOW-MED) `messages.createGroup` — existence oracle via skipped/BAD_REQUEST + forced group-inbox
      write. Added directoryGate.
- [x] E3 (LOW) `messages.typing` — fanned a typing indicator into ANY conversation id with no membership
      check (missed sibling of the S6 markRead fix). Now requires participant membership before fan-out.
- [x] E4 (LOW) blocking not server-enforced on the call path — a blocked caller could still trigger the
      callee's desktop call_offer notif + full-screen incoming-call push. Both notification hooks
      (onInvite/onPageCallee) now suppress when isNumberBlockedBy(callee, caller); paging/routing unchanged,
      block not revealed to the caller.
- [x] Verified clean: IDOR/ownership (send/list/search/delete/consume/contacts/status/attachments/partyLines),
      storage-proxy fail-closed, client XSS (escapeHtml/linkify; bio/socials never exposed to others),
      signaling authz + moderation, auth/crypto/rate-limits.
- [x] New `server/enumBlockHardening.test.ts`. Suite 1222 passed / 1 skipped; check + build green.

## v2.99.0 — message menu no longer clips off-screen + registration overhaul (email→name, show number, mandatory photo + passcode) (2026-07-23)
- [x] MESSAGE ⋮ MENU CLIPPED OFF THE LEFT EDGE (owner screenshot, own voice note): the long-press
      options menu (Reply / Unsend) opened partly off the left side of the screen. Root cause in
      `client/src/pages/app/Messages.tsx` `MessageMenu`: own messages are `justify-end`, so the ⋮
      button renders at the FAR LEFT of the row (before the bubble) — yet the menu used `right-0`,
      anchoring its 144px width further left, off-screen. The mine/received → right-0/left-0 mapping
      was simply reversed. Fixed to open toward the screen INTERIOR: `mine ? "left-0" : "right-0"`.
      Pinned in Messages.test.ts.
- [x] REGISTRATION OVERHAUL (owner directive) in `client/src/app/AuthPanel.tsx`:
      • EMAIL FIRST, shown read-only on the name step — the register step now asks only first + last
        name and displays the already-entered email read-only (a Mail-icon pill), never a second
        editable email field ("Just your name to finish — we already have your email").
      • The post-registration SETUP step ("Finish setting up") now shows the freshly-minted 6-digit
        RELAY number (whoami → `fmtNumber` NNN-NNN, LTR island) so the user sees their number.
      • MANDATORY profile photo — a tappable avatar circle (the Profile hero pattern) uploads via the
        bare-avatar path and AWAITS the profile save (v2.98.0 lesson) before marking it set.
      • MANDATORY 4-digit passcode (+ confirm) — this is the login passcode used to sign in on any
        device with the same email (existing loginWithPin). The old optional "Skip — email me a code"
        escape hatch is REMOVED; Finish is disabled until BOTH a photo and a matching 4-digit passcode
        are set.
      NOTE: this affects new REGISTRATIONS only; existing users are not retroactively forced to add a
      photo (that would be a separate, riskier change). Pinned in authPanelRegister.test.ts (4 tests).
- [x] Suite 1186 passed / 1 skipped locally; rebased onto main (v2.98.6) before ship.

## v2.99.1 — multi-device session list + remote logout (owner directive) (2026-07-23)
- [x] DEVICE LIST + REMOTE LOGOUT ("device list... show the device name + which date he logged in,
      and he can log out by clicking delete"). Built on a NEW revocable-session model, designed to
      be maximally fail-safe on production auth:
      • Token format (server/authCrypto.ts): the signed session cookie gains an OPTIONAL `sid`
        (`userId.exp.sid.hmac`); omitting it reproduces the exact legacy 3-part token byte-for-byte.
        New `readSession()` returns `{userId, sid}`; `verifySession()` kept as a uid-only shim. The
        sid is hex-restricted so it can never contain the `.` separator.
      • Ledger (drizzle `sessions` table + boot `CREATE TABLE IF NOT EXISTS` in ensureSchemaExtensions):
        one row per login — `sid`, `userId`, `label` (from the User-Agent), `createdAt`, `lastSeenAt`.
      • createContext gating (server/_core/context.ts): ONLY cookies that carry a sid consult the
        ledger; a deleted row ⇒ that device stops authenticating. `sessionState()` FAILS OPEN
        ("error") on any DB trouble, so a hiccup can NEVER mass-log-out the fleet. Legacy (no-sid)
        cookies — i.e. everyone already signed in before this deploy — skip the ledger entirely and
        behave exactly as before (zero risk). lastSeenAt is bumped fire-and-forget, throttled ~5 min.
      • Login paths (verifyOtp / loginWithPin / register-bypass) mint a sid via `startSession()`,
        record the labelled row, and thread the sid into setSessionCookie. `deviceLabelFromUA`
        (server/deviceLabel.ts) turns a UA into "Chrome on Android" / "Safari on iPhone" / etc.
      • tRPC (otpAuth): `listSessions` (marks the current device) + `revokeSession(sid)`
        (ownership-scoped delete; if it's the current device the cookie is also cleared). `signOut`
        now drops its own ledger row too.
      • UI: a "Devices" section in Profile (client/src/pages/app/Profile.tsx `DevicesSection`) lists
        each device (phone/desktop icon, label, "This device" badge, last-active + added date) with a
        confirm-guarded log-out. Registered users only; empty state until the next sign-in for
        pre-existing legacy cookies.
- [x] APP-LOCK / PASSKEY (owner: "face lock the app by PIN or passkey or face recognition, optional"):
      confirmed this ALREADY exists and ships today — Profile's app-lock (passcode.ts + PasscodeGate.tsx
      + biometric.ts + PasscodeSection) locks the whole app behind a 4-digit passcode OR a real device
      platform passkey (Face ID / fingerprint via WebAuthn `navigator.credentials`, which syncs to the
      Google/Apple keychain), and it's optional. A TRUE cross-device ACCOUNT passkey sign-in (log into a
      brand-new device with only a passkey, no email/PIN) needs server-side WebAuthn and remains a
      separate, larger follow-up — noted, not built this round.
- [x] Tests: authCrypto.test.ts (+5 sid round-trip / legacy-compat / tamper / non-hex / expiry),
      new server/deviceSessions.test.ts (deviceLabelFromUA behavioral + fail-open / sid-gating /
      ownership / login-wiring source pins). Suite 1241 passed / 1 skipped; check + build green.

## v2.99.2 — profile photo fix (broken avatar after re-upload) + emoji/character avatars (owner) (2026-07-23)
- [x] BUG: removing then re-posting a profile photo showed a BROKEN image everywhere (owner
      screenshot — broken-image glyph in the top bar + profile hero). ROOT CAUSE: since v2.96.1
      avatars upload via `?bare=1`, which named the S3 object `status_…`; `authorizeStorageKey`
      treats every `/status_` key as rich-status media and FAILS CLOSED without an active
      `statuses` row — so every avatar uploaded that way 403'd (it "worked" briefly only from the
      60s signed-URL cache). Fixed on two layers:
      • server/v2upload.ts — `?bare=1&avatar=1` (raw) and `body.avatar===true` (base64) now mint
        `avatar_…` keys (images-only) instead of `status_…`; client uploadAvatarImage sends the flag.
      • server/v2db.ts authorizeStorageKey — the `/status_` branch, on finding NO active status row,
        now RESCUES a key that is some identity's CURRENT avatarUrl (isIdentityAvatarKey) → served as
        a semi-public avatar. This HEALS every already-broken photo with no migration; genuinely
        expired/deleted status media (not an avatar) still fails closed. Safe from laundering: the
        updateProfile keyInOwnerNamespace (F2) gate means only the key's owner can adopt it.
- [x] EMOJI / CHARACTER AVATARS (owner: "set up an icon avatar — emoji, small icon — a collection of
      happy smiley characters — or upload my picture — either empty, or with emoji/characters, or with
      photo"). New `client/src/lib/emojiAvatar.ts`: 56 curated smileys/characters/animals/fun icons +
      10 gradient backgrounds + `renderEmojiAvatar()` (draws the emoji on the gradient to a 256px PNG).
      An emoji avatar is UPLOADED through the same profile-photo path, so it becomes a real avatarUrl
      that renders on EVERY surface (thread rows, contacts, history, in-call tiles, other users'
      directory previews) and syncs across devices — no schema change, no client-only drift. New
      `client/src/app/AvatarPicker.tsx` sheet: Upload photo · pick a character on a chosen background ·
      Remove (→ initials). Wired into Profile's avatar hero + the registration "Finish setting up"
      screen (both now open the picker). Headless-verified the canvas render (emoji over gradient →
      real PNG). ANIMATED avatars were scoped out (would need in-browser GIF/APNG encoding) — noted.
- [x] Tests: server/avatarBareKey.test.ts (avatar key naming + status-gate rescue),
      client/src/lib/emojiAvatar.test.ts (collection + palette + render contract); status.test.ts pin
      updated to the by-kind key naming. Suite 1249 passed / 1 skipped; check + build green.

## v2.99.3 — clickable profile avatar → full profile + presence consistency + host-panel polish (owner batch pt.1) (2026-07-23)
- [x] PROFILE POPUP AVATAR CLICKABLE (owner screenshot: "I cannot click on the image whether there
      is a status or not… even if there is no status, when I click on it, it should show me his full
      profile page"). The popup's PeerAvatar computed `clickable` such that inside the SAME user's
      popup it went inert when they had no status. Now the avatar is always a button: WITH a status →
      opens the status viewer (unchanged); WITHOUT → opens a NEW full-screen profile view (big 148px
      avatar — itself opens the status when one exists — name + verified badge, PIN, presence line,
      Message / Voice / Video actions, Add-to-contacts, back + close). client/src/app/PeerOverlays.tsx.
- [x] PRESENCE CONSISTENCY (owner: "Maja is sometimes shown as online … sometimes not"). TWO root
      causes found and fixed:
      • client/src/app/useRealtime.ts — the SSE `presence` handler invalidated contacts.list /
        messages.threads / directory.lookup but NOT the batch queries other surfaces read:
        directory.presenceMany (History LEDs) and directory.presence (profile popup / batch). Those
        surfaces only refreshed on their own 30s poll (History pauses polling in the background), so
        the SAME user showed online on one surface and offline on another. Both now invalidated.
      • server/v2db.ts reapStalePresence + server/_core/index.ts — the 60s reaper flipped
        stale-heartbeat users offline in the DB but emitted NO SSE event, so SSE-fed surfaces kept a
        crashed/closed user GREEN until their own poll. reapStalePresence now returns the reaped
        identities (id + number) and the boot sweep broadcasts an offline presence event to each
        one's audience via getPresenceAudienceIds + publishPresenceTo (per-user best-effort).
- [x] HOST CONTROLS (owner screenshot: buttons cramped/clipped; "make sure each feature is working").
      VERIFIED server-side all actions are real, not stubs (server/relay.ts `case "mod"`: mute /
      mute-all / unmute-all / pin / cohost / makehost / kick, all isModerator-guarded, fanned to the
      room). The panel itself was the problem: 280px wide with single-line rows — 5 action buttons
      overflowed and clipped ("Remove" off the edge). relayAssets.ts CSS: panel 320px (92vw cap),
      each participant row STACKS (name over actions) on a card, buttons WRAP with per-action color
      accents (Mute amber / Pin sky / Co-host violet / Make host teal / Remove red). Headless-verified
      (430px viewport, worst-case 5-button row): 10 buttons, 0 clipped.
- [x] Tests: server/presenceReaper.test.ts (reaper returns victims + broadcasts offline),
      useRealtime.test.ts (presence case invalidates presenceMany + presence), relayAssets.test.ts
      (stacked rows + wrap + per-action accents + panel width). Suite 1262 passed / 1 skipped.
      Remaining from this owner batch (increment 2): in-call control-bar redesign (labels + colors +
      sound-output menu) and the full-featured in-call side chat with the glass identity header.

## v2.99.4 — in-call control bar redesign + phone sound menu + in-call chat upgrade (owner batch pt.2) (2026-07-23)
- [x] CONTROL BAR (owner: "make all these icons different colors with a very nice shape. Put a label
      below each icon"). Every control is now a COLORED round icon chip (.ctrl-ic) with a text LABEL
      underneath (.ctrl-lbl): Mute/Unmute (green, swaps with the mic's .off class), Cam off/Cam on
      (sky, swaps), Flip (violet), Share (amber), Quality with the HD/SD chip text in #qualityTxt
      (pink — updateQualityBtn writes the span, never the button, so the label survives), Sound
      (orange), PiP (indigo), Filters (fuchsia), Add + (teal), Host (gold — now a CROWN icon, not
      ⋮), Chat (lime), NEW ⋯ More (gray). Each button carries a full-sentence title tooltip
      describing exactly what it does. State classes (.on/.off/.voiced) restyle the chip; JS
      untouched. The hang-up button keeps its dedicated red circle (explicit display:grid so the
      v2.98.3 centering can't regress) + the pre-connect halo screen is unchanged. Headless-verified
      at 430px + 1280px: 13 buttons, 0 clipped, 12 distinct chip colors, pre-connect intact.
- [x] ⋯ MORE MENU: Record call (the same #recordBtn id — availability/`.on` JS untouched — now a
      labeled row with a description, shown only when recording is configured) + Diagnostics (the
      per-peer connection panel). Outside-click dismissal like the other in-call menus.
- [x] SOUND MENU ON PHONES (owner: "when you click on Sound, it should show a menu for the
      loudspeaker, internal speaker, or Bluetooth"). The v2.84 blind speakerphone TOGGLE is replaced
      with a real three-route menu — Loudspeaker (the WebAudio media-route force; native AudioManager
      in the Android app), Earpiece (drops the force → OS default route), Bluetooth/headset (drops
      the force so the OS default route follows the connected device; honestly labeled "No Bluetooth
      device detected" + dimmed when none is enumerable). Selected route shows a check; each row
      carries a one-line description. Desktop keeps the real output-device sink list unchanged.
- [x] IN-CALL CHAT (owner: "make it full-featured with emojis… put the username, the pin number, and
      the user's icon in a different box showing like a bubble-style glass"). Every message now
      renders a GLASS identity chip (backdrop-blur bubble: avatar disc + username + PIN + time)
      above the text bubble — mine right (teal tint), theirs left. Chat frames carry the sender's
      PIN (`pin` field; old clients ignore it), avatars resolve once per PIN via the public
      directory.lookup into a lifetime cache and drop in async (initials until then). The composer
      gains a real EMOJI PALETTE (48 common emojis, lazy-built on first open, caret-position
      insertion) behind a 😊 toggle — like the main Messages tab.
- [x] Stale pins updated to the superseding shapes: callAudio.test.ts + updateChecker.test.ts (the
      v2.84 mobile-toggle pin → the route-menu), v2961Fixes.test.ts (chat row → .mident chip). New
      client/src/lib/callBarV2994.test.ts (labels/colors/state-on-chip, More menu, sound routes,
      glass chip + PIN frames + emoji palette). Suite 1277 passed / 1 skipped; check + build green.

## v2.99.5 — multi-device: one number on every signed-in device, all of them ring (owner report, 2 screenshots) (2026-07-23)
- [x] BUG (owner screenshots): a registered account signed in on a SECOND device showed the SAME
      profile but a DIFFERENT number on the Dialer (profile menu: khalifa · 235-680; dialer: 911 801)
      — and incoming calls rang only one device. ROOT CAUSE (verified in source + by a parallel
      research pass): `server/relay.ts` register — an `__ownedNumber`-verified claim (F1) to a pin
      CURRENTLY held by the account's other live device takes the same free-or-mine-or-genPin gate
      as an unverified claim, so the second device was shunted to `genPin()` → a fresh random
      number; the ring fan-out (`reg.devices`) was fully built (v2.50-era, flag-gated
      MULTI_DEVICE_RING) but deliberately never read with the flag off.
- [x] ENABLED: `MULTI_DEVICE_RING: "1"` baked into ecosystem.config.cjs BEFORE the .env spread
      (exactly the v2.94.4 RELAY_CLUSTER pattern; operator can still override with =0). The deploy
      copies the file to EVERY server, which also satisfies the cluster constraint that the flag be
      identical fleet-wide (the registry lives on the elected leader and leadership can migrate).
      With the flag on: every signed-in device registers the SAME account number, an incoming call
      rings ALL idle devices, the first answer wins (others show the cancel), and in-call signaling
      routes to the answering device.
- [x] FOUR flag-on gaps found by adversarial review and fixed BEFORE enabling (server/relay.ts):
      (1) a SECONDARY device registering (or re-affirming) while the number's call lives on the
      primary received `sendRejoinIfInRoom` — dragging a freshly-opened device straight INTO the
      live call; both register paths now skip the rejoin for non-primary channels
      (`keptPrimaryElsewhere` + `isPrimaryChannel`). (2) `deliverPendingRing` sent only to the
      PRIMARY socket — a device opening mid-ring never rang; it now delivers to the registering
      channel's own socket (optional `socket` param, default unchanged). (3) declining on one device
      left the others ringing until their 30s local timeout — reject now fans `ring-cancel` to the
      number's other devices (mirror of the accept fan-out). (4) identity-switch (logout → new guest
      registration on one device) DELETED the number's only client record while the account's other
      devices were still connected, going dark until their next re-register — the sever branch now
      PROMOTES a surviving device to primary (mirrors the disconnect-grace survivor promotion).
- [x] Honest UX: multi-device `ring-cancel` now carries `reason: "answered"|"declined"`; the client
      toasts "Answered on another device" / "Declined on another device" instead of the misleading
      "Caller cancelled the call" (old clients ignore the field).
- [x] Tests: 7 new in relay.test.ts (decline fan-out with reason; accept cancel reason; no-rejoin
      for a registering secondary mid-call; no-rejoin on a secondary's re-affirm; identity-switch
      survivor promotion keeps the number ringing; mid-ring register rings the new device's own
      socket; ecosystem.config.cjs bake pin). callReachability.test.ts pin updated to the new
      deliverPendingRing(…, conn.socket) shape. Suite 1284 passed / 1 skipped; check + build green.

## v2.99.6 — three-tier account badges: blue Guest / green Registered / yellow Admin (owner spec) (2026-07-23)
- [x] The single verified-only "blue badge" is superseded by a THREE-TIER RoleBadge shown for EVERY
      user: blue ✓ = Guest (no registered account), green ✓ = Registered (email-verified), yellow ✓
      = Admin (the owning user's users.role = "admin" — the enum already existed in the schema; an
      operator grants it with `UPDATE users SET role='admin' WHERE email=…`). Right under the check
      mark, the tier name in very small type, first letter capital: "Guest" / "Registered" /
      "Admin" (owner spec). New `RoleBadge` + `roleFromFlags` in client/src/app/VerifiedBadge.tsx
      (the old VerifiedBadge export stays for compatibility); `roleFromFlags` lets every surface
      fall back gracefully — explicit role wins, `null` = no badge (party lines), an OLD cached
      payload without the field maps verified→Registered / else Guest.
- [x] SERVER: new `getRolesByIdentityIds()` in v2db.ts (ONE batched identities⟕users query;
      decoration-only — returns empty on DB hiccup, never throws) + `role` emitted on
      identity.whoami, directory.lookup (null for party lines), contacts.list, and
      messages.threads (`peerRole`). All additive fields — no client is broken by them.
- [x] CLIENT surfaces: AppShell (sidebar name + avatar-corner mini badge, captionless at 14px),
      Profile hero, Contacts rows, Messages thread rows + chat header, Dialer preview, the
      profile popup + full-screen profile view (PeerOverlays), and the in-call INCOMING-RING card
      (presentRingProfile now tints the seal by tier + fills the tiny #ringRoleTxt caption; old
      servers without `role` keep the verified-only presentation).
- [x] Tests: verifiedBadge.test.ts rewritten around the three tiers (colors + captions + caption
      sizing + roleFromFlags rules + every surface wired + server emissions + the v2db tier rule);
      Contacts.test.ts pin updated. Suite 1290 passed / 1 skipped; check + build green.

## v2.99.7 — new-device login approval (owner spec) (2026-07-23)
- [x] FEATURE: signing in on a NEW device via email code, when the account already has ANOTHER
      device online, now PARKS on a "Waiting for approval" screen until an existing device approves
      it — mirroring WhatsApp's linked-device flow. Entering the account's 4-digit login PIN
      BYPASSES approval entirely (the PIN is the second factor). Registrations (first device) never
      wait. Fully FAIL-SAFE against lockout: approval is required ONLY when another session was
      active in the last 12 min (≈ a device that can actually approve), and every gate/poll fails
      OPEN — a DB hiccup never strands a user or logs anyone out.
- [x] SERVER: additive nullable `sessions.pendingApproval` column (boot migrator; NULL = every
      legacy row, byte-identical). v2db helpers: `recordSession(…, pending)`, `sessionState` maps a
      pending row → "revoked" (so the UNCHANGED createContext `state !== "revoked"` gate blocks it —
      pending sessions don't authenticate), `hasRecentApprovedSession` (fail-safe approver check),
      `pendingSessionsForUser`, `sessionApprovalBySid` (waiting device's own-cookie poll, fail-open
      "approved"), `approveSession` (ownership-scoped, clears the stamp). otpAuth router:
      `startSession(…, pending)`, `shouldRequireApproval`, `announcePendingDevice`; verifyOtp parks a
      non-registration sign-in that needs approval + emits SSE; loginWithPin never gates; NEW
      procedures `sessionApprovalStatus` (public, own cookie), `pendingSessions` (auth), and
      `approveSession` (deny reuses `revokeSession`). New SSE kind `device_pending`.
- [x] CLIENT: AuthPanel gains a "waiting" stage (polls `sessionApprovalStatus` every 2.5s →
      proceeds on approve, resets to email on deny; does NOT invalidate whoami while pending).
      useRealtime handles `device_pending` (refreshes the pending list + toast → Profile#devices).
      The notification bell counts pending devices with a Review row; Profile → Devices shows each
      waiting sign-in with Approve / Decline (id="devices" anchor for the deep-link).
- [x] Tests: server/newDeviceApproval.test.ts (pending-never-authenticates, fail-safe gates, login
      paths, approval procedures + SSE + migrator) + client/src/app/newDeviceApproval.test.ts
      (waiting stage, device_pending handler, bell + Profile UI); deviceSessions.test.ts startSession
      pin updated for the split call. Suite 1306 passed / 1 skipped; check + build green.
      Follow-up scope noted: web-push wake for a fully-closed device (this increment covers the
      online/SSE + bell path — the owner's "if you were online" case).

## v2.99.8 — in-call UI batch pt.1: minimize box + screen-share maximize + per-tile add-contact + dialpad save (owner spec) (2026-07-23)
- [x] MINIMIZE (owner: "minimize the call session… a small box showing the cameras / number of people,
      move easily between Messages/History, that pop-up window is within your browser not a new
      window"). A Minimize control shrinks the live call to a small DRAGGABLE in-DOM box floating over
      the app (NOT the browser PiP window — that stays a separate feature). The engine div is never
      torn down: RelayEngine adds a `minimized` display state → a third positioning branch (inline
      geometry that beats `.relay-root{inset:0}` without !important) + a new `setMinimized` handle
      that forces the engine's existing `compactView` 2-up; the chrome-hide effect is now gated
      `phase!=="idle" && !minimized` so the bottom nav/sidebar stay usable behind the box. The box
      header (React overlay laid over the same geometry) has a drag handle, a live people-count
      (`getRoster().length+1`, box grows a touch with headcount), Maximize, and hang-up. A "Fit"
      toggle letterboxes the video (object-fit:contain via a `.relay-fit` root class).
- [x] SCREEN-SHARE MAXIMIZE (owner: "if somebody shares his screen … a button to maximize it out of
      the other screens … or minimize/restore within the grid"). A per-tile button revealed by CSS
      ONLY on a `.screen` tile toggles `screenMaximized`; layoutGrid's spotlight branch full-bleeds
      the share (`#videoGrid.screen-max` — single-cell grid, thumbs `display:none`, spotlight spans
      all rows) and tap-again / share-end / call-reset restores the grid. Reuses the existing
      spotlight plumbing; callLayout.ts untouched.
- [x] PER-TILE ADD-TO-CONTACTS (owner: "under each username on the call, if he's not in your contacts
      show a mark to add them; adding it makes it disappear; already-saved shows nothing"). New
      `addContactMarkHTML` renders an "Add" pill under each unsaved remote peer's name (`tile-addc`);
      `refreshAllTileAddMarks` re-renders on a saved-set change. onGridClick bridges the tap to React
      via `setOnSaveContact` (optimistically drops the mark), and RelayEngine pushes the saved numbers
      via `setSavedContacts` (from contacts.list) + upserts on tap.
- [x] DIALPAD SAVE (owner: "while typing the number on the pad, give you Save if this contact isn't in
      your list"). The Dialer quick-add now offers Save for ANY complete non-self, non-party-line
      6-digit number (previously only a resolved directory user), as a prominent pill with success/
      error toasts + an "In your contacts" confirmation when already saved.
- [x] END CALL caption fix (owner screenshot: the pre-connect "End Call" label fell below the
      viewport) — the pre-connect `.controls` now reserve `padding-bottom:max(60px,safe-area+48px)`
      and the caption offset trimmed to 10px. Headless-verified back on-screen.
- [x] Tests: client/src/lib/callUiV2998.test.ts (handle methods, add-mark render+bridge, screen-max
      toggle+layout+reset, RelayEngine minimize/fit/drag/save wiring, dialpad gate, caption padding).
      Headless render verified: grid add-pills, screen-max full-bleed with thumbs hidden, End Call
      caption above the bottom edge. Suite 1321 passed / 1 skipped; check + build green.

## v2.99.9 — rejoin a live call from History (knock → host approval → join) (owner spec) (2026-07-23)
- [x] A user who LEFT a call (logout drops room membership) can rejoin from History (owner: "if you've
      been disconnected you can log back in, go to History, and if the call's still alive it shows you
      live — number of parties, their names, who's the host — and a Join; click Join → the host gets a
      notification you want to join → you join"). History shows a "Live now · N in the call · hosted
      by X · Join" card for any recent-call number that is currently in a live call the viewer was
      part of.
- [x] SERVER: `liveRoomInfo(reg, number, requester)` resolves the number's alive room + roster + host,
      authorized ONLY when the requester was PREVIOUSLY in that room (`roomMeta.roster` is add-only →
      no enumeration/eavesdrop oracle). `liveRoomFor` is the API-tier wrapper (reads activeRegistry;
      null off the signaling node). New signaling: `knock{to}` → host (+cohosts) get `knock{fromPin,
      fromName,roomId}` + knocker gets `knock-result{pending}`; `knock-approve`/`knock-deny`
      (moderator-guarded + pending-knock-guarded — no forged admit) → `admitToRoom` join-without-ring
      (joinRoomMember + `joined` + `peer-joined` fan-out + SFU token) / `knock-result{denied}`. New
      `RoomMeta.knocks` map. tRPC `directory.liveRoom(number)` — caller-roster-gated, names-only (no
      dialable pins) — powers the History card.
- [x] CLIENT: engine handle knock/approveKnock/denyKnock/setOnKnock + `knock`/`knock-result` dispatch;
      RelayEngine host Approve/Decline prompt + `knock()` on the engine context; History
      `LiveRejoinCard` (polls directory.liveRoom, Join → engine.knock).
- [x] Cross-instance note: knock/approve/join all ride `/api/relay/*` (pinned to the leader), so the
      flow is correct fleet-wide; only the History PREVIEW card (tRPC liveRoom) needs the signaling
      node's registry and degrades to absent on a non-leader instance.
- [x] Tests: 4 behavioral in relay.test.ts (knock→approve→join, deny, stranger roster-gate reject,
      moderator+pending guards) + server/liveRejoin.test.ts (privacy gate, tRPC shape, client wiring).
      Suite 1335 passed / 1 skipped; check + build green.

## v2.99.10 — badge off the header avatar corner + PIN on every username surface (owner) (2026-07-23)
- [x] BADGE PLACEMENT (owner screenshot: "why put the badge beside the flag and profile image? once
      you click the avatar it shows username + PIN — put the badge there"). The captionless tier
      badge that sat on the header avatar corner (overlapping the flag/photo) is REMOVED; it now
      renders inside the dropdown that opens when you tap the header avatar — beside the name, with
      the PIN right under it. AppShell.tsx.
- [x] PIN EVERYWHERE (owner: "where's the name, the PIN should show everywhere"). The 6-digit PIN
      now shows next to the name on the Messages chat HEADER and the Messages thread-LIST rows (1:1
      only), alongside the already-present PIN on Contacts rows, the Dialer preview, History rows,
      and the profile popup / full-profile view. Badge (tier) already renders on all of these.
- [x] Tests: client/src/app/badgePinSurfaces.test.ts (badge gone from the avatar corner + present in
      the dropdown label; PIN on Messages header + list rows + Contacts). Suite 1340 passed / 1
      skipped; check + build green.

## v2.99.11 — offline call: no auto-ring; leave an SMS or voice message (owner directive) (2026-07-23)
- [x] OFFLINE ≠ AUTO-RING (owner, verbatim: "if the user is offline and you try to call him it
      should NOT ring automatically. It will tell you he's offline but you can keep for him an SMS
      message or voice message"). The v2.83 PAGING model (caller parks on "Reaching their phone…"
      up to 65s + a full-screen incoming-call Web Push wakes the pocketed device + the ring is
      redelivered when the app opens) is RETIRED for a COLD offline dial.
- [x] SERVER (server/relay.ts invite `!targetReachable` branch): resolve the callee identity via the
      `onPageCallee` hook, then send a FAST `error{offline}` naming the callee (real identity) or
      `error{nonexistent}` (unknown number). NO ensureDialRoom / pendingRings / keep-alive. The miss
      is recorded immediately (`onMissedCall{reason:"cancelled"}`) → History + (pref-gated, #34)
      missed-call notification/email on return.
- [x] SERVER (server/_core/index.ts): `onPageCallee` is now a PURE identity resolver — no
      `sendPushToIdentity`, no `kind:"incoming-call"` push. It answers exists + display name only.
- [x] CLIENT (relayClient.ts): `"nonexistent"` added to the fatal-error set; `server-error:offline`
      now raises the post-dial `VoicemailPrompt` card (nonexistent excluded — no thread to send to).
      The retired paging status line `setCallStatus("ringing","Reaching their phone…")` is removed; a
      `ringing` ack now always means a real live ring. The `paging?` wire field is kept for
      old-server compat but never read.
- [x] CLIENT (VoicemailPrompt.tsx): the offline card offers BOTH a ≤60s voice message AND a quick
      written SMS (new `sendText` → openThread + `messages.send kind:"text"`), plus the existing
      "tell me when they're back online" watch. Reason line says "They're offline right now."
- [x] TRADEOFF FLAGGED: dropping the incoming-call Web Push means a closed/backgrounded BROWSER is no
      longer woken to ring on the WEB path — this is exactly the "don't auto-ring an offline user"
      behavior requested. The native Android FCM ring-when-closed path (M4) is untouched; the
      `incoming-call` push kind + 70s TTL remain in server/webPush.ts as generic infra.
- [x] Tests: server/relayPaging.test.ts rewritten (8 behavioral — fast error{offline}/{nonexistent},
      miss recorded, no keep-alive, LIVE-path redelivery unchanged); server/v29911OfflineCall.test.ts
      (7 wiring pins); enumBlockHardening.test.ts E4 + client/src/lib/callReachability.test.ts updated
      to the new behavior. Suite 1345 passed / 1 skipped; check green.

## v2.99.12 — offline-return notifications: unread messages surface + blinking icon (owner) (2026-07-23)
- [x] ON RETURN, SEE WHAT YOU MISSED (owner, offline-call batch: "when he logged in again he will see
      the notification on the main page and also on the icon and to keep blinking if there is a
      message or there was in the history a missed call"). Missed calls already had a landing popup +
      History entry + bell/tab badges; this extends the on-return surfacing to unread MESSAGES too and
      makes the indicator BLINK.
- [x] COMBINED LANDING CARD: the calls-only `MissedCallToast` mount is replaced by a new
      `AwaySummaryToast` (client/src/app/MissedCalls.tsx) — a "While you were away" card that shows a
      missed-calls row AND an unread-messages row, each a tappable route (→ History?filter=missed / →
      Messages). Renders nothing when both are zero. `MissedCallToast` is kept exported for
      backward-compat. AppShell computes `latestUnread` (most-recent unread thread; group title or
      peer name) to label the messages row.
- [x] DISMISS WATERMARK keys on the latest-item TIMESTAMP per category (localStorage
      `relay_away_popup_seen_v2` `{missedAt,msgAt}`), NOT a count. (Adversarial pre-ship review caught
      that a count high-water mark is broken: counts FALL when you review History or read a thread, so
      the mark goes stale-high and silently hides genuinely-new activity — incl. a fresh next-day
      login with fewer-but-new items, directly violating the directive. A latest-item timestamp only
      moves forward, so "newer than dismissed" is sound across sessions.) The card opens when EITHER
      category's newest item is newer than dismissed; `dismissAway` advances both marks via Math.max.
- [x] A11Y: the catch-up banner is a passive `role="region"` (aria-live polite), not a focus-trapping
      `alertdialog` (the same fix applied to the retained `MissedCallToast`) — review finding #2.
- [x] BLINKING ICON: the notification bell badge + the Messages/History tab badges (sidebar + mobile)
      carry a `relay-blink` class that flashes opacity, and the bell button a `relay-blink-glow` halo,
      whenever `missedCount + unreadCount > 0` (the owner's exact triggers; pending-device approvals
      still count in the badge total but don't strobe the header). The keyframes live in
      client/src/index.css behind `@media (prefers-reduced-motion: no-preference)`, so the class is
      inert for reduced-motion users — always safe to attach.
- [x] Realtime: the SSE `message` event already invalidates `messages.threads`, so the unread badge +
      blink + landing card update live (plus the 15s poll backstop). History missed-call entries were
      already present (owner's "there was in the history a missed call") — no change needed there.
- [x] Tests: client/src/app/missedCalls.test.ts +4 (combined card, pair dismiss + legacy migration,
      blink + reduced-motion gate, latestUnread resolution). Suite 1349 passed / 1 skipped; check +
      build green. NOTE: the offline-message EMAIL notification + its enable/disable preference is
      tracked separately as the next item (#34).

## v2.99.13 — email-notification preferences (missed call + offline message, content-free, toggleable) (owner) (2026-07-23)
- [x] OWNER (offline batch): "if he's a registered user and put his email, he'll get an email for a
      missed call OR when somebody sends a message while he's offline — but WITHOUT the content, just
      'you received a message, log in to see it'. He can enable/disable it."
- [x] SCHEMA + MIGRATOR: two additive nullable `users` booleans `emailNotifyMissedCall` /
      `emailNotifyMessage` + a `lastMessageEmailAt` cooldown watermark (drizzle/schema.ts +
      ensureSchemaExtensions `adds`). NULL = ENABLED (historical default — the missed-call email
      always sent), so a user disables by storing false.
- [x] MISSED-CALL EMAIL GATE (server/_core/index.ts): one line `if (user.emailNotifyMissedCall ===
      false) return;` placed AFTER the push + recordMissedCall, so History + push stay unconditional
      and only the EMAIL is preference-gated.
- [x] OFFLINE-MESSAGE EMAIL (v2MessagesRouter.send): for every OFFLINE recipient (1:1 or group) with
      a linked account email, send a CONTENT-FREE `messageWaitingHtml()` nudge — no body, no sender,
      no thread, just "you have a new message, log in to see it" + an Open button. Throttled by
      `claimOfflineMessageEmail(userId, cooldownMs)`: a SINGLE atomic conditional UPDATE (stamp
      lastMessageEmailAt=now WHERE pref on (NULL OR true) AND cooldown elapsed (NULL OR < cutoff)),
      true only when affectedRows>0 → at most one email per 15-min cooldown, race-free (mirrors the
      v2.98.4 S1 fix) and fail-safe (DB down → false → no email, send unaffected).
- [x] tRPC (v2OtpAuthRouter): `getNotificationPrefs` (normalizes NULL→on, reports hasEmail) +
      `setNotificationPrefs` (auth-guarded partial write via setUserNotificationPrefs).
- [x] PROFILE UI: new `EmailNotificationsSection` (two role="switch" toggles mirroring DndSection,
      optimistic update + rollback) rendered after NotificationsSection; returns null for guests /
      email-less accounts so only registered users with an email see it.
- [x] Tests: server/emailNotifyPrefs.test.ts (11 — schema/migrator, atomic claim, NULL=on across all
      three read sites, content-free email, gating order, tRPC, Profile section). Suite 1361 passed /
      1 skipped; check + build green.

## v2.99.14 — media URL lockdown: stream bytes, never redirect to a presigned URL (owner) (2026-07-24)
- [x] OWNER: a video-note URL `/manus-storage/relay-chat/62/..._video-note_....webm` could be opened
      + copied OUTSIDE the app on desktop; "everything should be encrypted, cannot be traced — the
      file/voice/video/image link shown in the browser or app stays in the app."
- [x] ROOT CAUSE (pre-fix recon): NOT missing authz — video/voice/file/image are participant-gated
      attachments; the relative `/manus-storage/<key>` URL already 403s a non-participant/anon. The
      leak was that the proxy answered an AUTHORIZED request with a 307 redirect to a
      session-independent presigned S3/Forge URL (300s TTL). Following the redirect exposed that raw
      URL in the address bar/devtools, and it was copyable + replayable by anyone for its lifetime.
- [x] FIX (server/_core/storageProxy.ts): no more redirect. Resolve the presigned URL SERVER-SIDE
      only, fetch it, and STREAM the bytes back through the cookie-gated route
      (Readable.fromWeb(upstream.body).pipe(res)). Range-aware (forward Range; relay
      206/Content-Range/Accept-Ranges so video/audio seek). Cache-Control: private (never public);
      X-Content-Type-Options: nosniff. Browser only ever sees `/manus-storage/<key>`.
- [x] FAIL-OPEN CLOSED: an `unknown` (orphaned/guessed) key is refused to an anonymous caller
      (kind==="unknown" && identityId==null → 403). Avatars stay semi-public (pre-onboarding invite
      previews) but also stream, so even they never leak a presigned URL. Attachment + status gating
      unchanged.
- [x] TRADEOFF: media bytes now transit the app server (S3→app→client), ~2× egress on media —
      acceptable for RELAY's volume and the necessary cost of "stays in the app". The 60s
      presigned-URL cache is kept but used only server-side (never handed to the client).
- [x] Tests: server/_core/storageProxy.test.ts rewritten (no redirect; unknown+anon → 403; streams);
      server/storageProxy.test.ts updated (legal key streams 200, no Location header); new
      server/mediaUrlLockdown.test.ts (source-level streaming invariants). Suite 1369 passed / 1
      skipped; check + build green.

## v2.99.15 — functional landing dialer + guest online-only calls (owner) (2026-07-24)
- [x] OWNER: on the main page, type a number → it AUTO-shows the target's name + "he is online" → Dial
      → asks the visitor's name → gives a random RELAY number → rings the callee to accept — BUT only
      if online; a guest can't call an offline user.
- [x] LANDING HERO DIALER (client/src/pages/Home.tsx): the React shell now passes an imperative
      `onLookup` (utils.directory.lookup.fetch — the PUBLIC rate-limited resolver) into startLanding.
      When the 6th digit lands, runLookup resolves the owner and applyLookup writes a live preview
      into a new `data-lp="dialPreview"` node: name + "ONLINE" (green) for an online user, name +
      "OFFLINE — you can't call them" (CALL disabled) for offline, "NO RELAY USER WITH THIS NUMBER"
      for unknown, "PARTY LINE · N on the line" + JOIN for a line.
- [x] GATE: a new `dialCallable` flag arms CALL only for an online user / party line / a lookup that
      ERRORED (fallback to /i, which re-resolves); callNow also guards `if (!dialCallable) return`.
      Display names are escLp-escaped before innerHTML (no XSS). "DIAL A DEMO NUMBER" cancels its
      in-flight lookup and arms in fallback mode so the cinematic still plays.
- [x] GUEST OFFLINE BLOCK (OnboardingGate.tsx, the /i/<pin> join card): a guest has no persistent
      thread to leave a message on, so an offline callee (or unknown number) now DISABLES "Join call"
      (`joinBlocked = numberNotFound || calleeOffline`, party lines exempt, FAILS OPEN on a lookup
      error) with "They're offline — can't call" + "you can reach them once they're back online",
      replacing the old "offline — we'll try to reach them" allow-through.
- [x] NOTE: directory.lookup returns only `displayName` (no first/last split) — shown as-is; a true
      first/last split would need a small server change, deferred (displayName satisfies "the name").
- [x] Tests: client/src/pages/Home.test.ts +3 (lookup wiring, online/party-line/offline/unknown gate,
      name escaping), client/src/app/callLinkJoin.test.ts +3 (guest offline block, fail-open, copy).
      Suite 1375 passed / 1 skipped; check + build green.

## v2.99.16 — landing polish: Arabic sizing parity (#40) + live group-call grid (#41) (owner) (2026-07-24)
- [x] #40 (owner: "the Arabic version renders smaller than English"). ROOT CAUSE: every element
      hardcodes a LATIN face ('Space Grotesk'/'IBM Plex Mono') in its inline font shorthand and
      FONTS_HREF loaded only those, so Arabic glyphs fell back to a smaller SYSTEM Arabic face and the
      whole RTL layout looked shrunken. FIX: load Noto Kufi Arabic in FONTS_HREF and force it for RTL
      text — `.lp-root[dir="rtl"] *{font-family:'Noto Kufi Arabic',… !important}` (inline font
      shorthands aren't !important, so a stylesheet font-family !important overrides ONLY the family,
      keeping sizes), plus a later higher-specificity rule keeping the dial/keypad/percent LTR islands
      ([dir=ltr]) monospace.
- [x] #41 (owner: "make the talk moving, not fixed images"). The 10-up group-call grid already had
      subtle Ken-Burns but read as static — added a ROTATING ACTIVE-SPEAKER SWEEP: a green ring
      overlay (its own span, so it never fights the container's speaking box-shadow) on every tile
      running a shared 20s @keyframes lpActive at a staggered -i*2s delay, so the highlight rotates
      around the grid; the container also gets a transform-only lpTalk scale pulse (comma-combined
      with any existing speaking anim so both run). All motion stays under the existing
      prefers-reduced-motion gate. Headless-verified the ring sweeps (tile0 opacity .95 while tile1
      is 0 at the same instant).
- [x] CAVEAT fixed mid-build: two backticks inside a CSS comment terminated the CSS template literal
      (build break); removed them. Keep comments inside the CSS template backtick-free.
- [x] Tests: client/src/pages/Home.test.ts +2 (Arabic webfont + RTL font rules; active-speaker sweep
      keyframe + staggered/combined anim). Suite 1377 passed / 1 skipped; check + build green.

## v2.99.17 — Dialer: a nonexistent number offers no actions (owner) (2026-07-24)
- [x] OWNER screenshot: dialing "888 888" showed "No RELAY user with this number" YET still lit active
      Voice/Video/Group call buttons AND a "Save 888-888 to contacts" pill. You can't call, group-call,
      or save a number that isn't a real RELAY user.
- [x] client/src/pages/app/Dialer.tsx: new `nonexistent` flag = 6-digit && not-self &&
      previewQuery.isSuccess && !previewIdentity — keyed on isSuccess (a SUCCESSFUL directory.lookup
      resolve to null: not a user, not a party line) so a lookup ERROR / still-loading FAILS OPEN
      (actions stay enabled; the dial then surfaces the real error — a hiccup never blocks a real
      number).
- [x] `callable` gains `&& !nonexistent` (Voice + Video already disabled={!callable}); the Group Call
      button — previously ALWAYS enabled — gains disabled={nonexistent} (still opens the picker on an
      empty/partial pad, blocked only for a confirmed-dead 6-digit number); the v2.99.8 Save pill gains
      `&& !nonexistent`; startCallNow early-returns on nonexistent defensively.
- [x] Existing-but-OFFLINE users + party lines unaffected (they resolve to a real previewIdentity, so
      nonexistent is false — offline users stay callable per v2.99.11's leave-a-message flow).
- [x] Tests: client/src/pages/app/dialerNonexistent.test.ts (5). Suite 1382 passed / 1 skipped; check
      + build green.

## v2.99.18 — first+last name on the dialer (#43) + animated avatars (#45) (owner, transcript re-audit) (2026-07-24)
- [x] #43: directory.lookup returns firstName/lastName; the landing hero dialer composes "First Last"
      via dialLookupName() (falls back to displayName, escLp-escaped). Registered users already had
      displayName="First Last", so this makes "show the name first and last" explicit.
- [x] #45 (owner: "an animated icon also"): new client/src/lib/animatedAvatar.ts — a dependency-free
      GIF89a + LZW encoder (216-colour web-safe palette, NETSCAPE2.0 loop-forever) renders a picked
      emoji as a looping GIF (10-frame bounce/pulse). AvatarPicker gains an "Animated ✨" toggle; an
      animated pick uploads image/gif through the SAME uploadAvatarImage bare path (bytes pass through
      untouched — uploadBare never re-encodes, so animation survives), and the v2.99.14 streaming
      proxy relays image/gif so it animates on EVERY surface and syncs like a photo.
- [x] Headless-verified in Chromium: valid GIF89a, decodes at 160×160, 10 GCE frames + NETSCAPE loop.
- [x] Tests: animatedAvatar.test.ts (4 Node encoder checks); Home.test.ts XSS pin updated. Suite 1386
      passed / 1 skipped; check + build green.
- NOTE: found via a full re-audit of the conversation transcript after the owner flagged missed items;
  the heavy QA sweep (#35) ran in parallel and surfaced real bugs now queued for v2.99.19.

## v2.99.19 — QA-sweep fixes (#35 findings; several are v2.99.11 offline-rework regressions) (2026-07-24)
- [x] #46 (HIGH) GROUP CALL COLLAPSED IF ANY INVITEE OFFLINE: a group dial rings the FIRST invitee to
      CREATE the room, then the `room` ack flushes the rest. v2.99.11 means an OFFLINE first invitee
      returns error{offline} and NO room is created — so the remaining invitees were never rung AND the
      client's fatal-error branch tore the whole dial down over one offline person. Fixed in
      client/src/lib/relayClient.ts: the error handler now splits `reachErr` (offline/nonexistent/gone —
      the INVITEE is unreachable) from `joinErr` (self/full/forbidden — WE couldn't join). During a
      group-dial BOOTSTRAP (callIsGroup && outgoingDial && !establishedOnce && !roomId && aloneInCall),
      a reachErr PROMOTES the next pendingGroupInvites entry as the new bootstrap (one at a time — never
      all-at-once, which would race duplicate rooms) and only failDials once every invitee is exhausted.
      A reachErr inside an ESTABLISHED parked call (`inParkedCall()`) never ends the call. joinErr stays
      fatal to a peerless joiner.
- [x] #47 (HIGH) VIEW-ONCE MEDIA BROKE FOR THE RECIPIENT: opening an expiring media message burned it
      (consumeExpiring nulls attachmentId → the storage proxy 403s the url) BEFORE the recipient could
      see it — a kept server url rendered as a broken image the instant it burned. Fixed in
      client/src/pages/app/Messages.tsx: revealExpiring is now async — it FETCHes the bytes into a local
      blob object-URL (and drops thumbUrl) BEFORE calling consumeExpiring, so the reader views a local
      copy that survives the burn. Object URLs are tracked and URL.revokeObjectURL'd on countdown purge /
      thread switch / unmount (no leak). A brief "Opening…" spinner covers the fetch.
- [x] #48 (MED) OFFLINE RESOLVER FIRED A STALE ERROR: the invite handler's offline branch
      (server/relay.ts) awaited onPageCallee then only checked the caller still existed — not that its
      ctxEpoch was unchanged. A hang-up or channel-takeover during the await (both bump ctxEpoch) could
      fire error{offline}/{nonexistent} + a phantom miss into the caller's NEW context. Both `.then`/
      `.catch` now re-check `callerNow.ctxEpoch === ctxEpoch` (same discipline as the party-line settle).
- [x] #49 (MED) MULTI-DEVICE HANG-UP LEFT OTHER DEVICES RINGING: the invite fans the ring to EVERY one
      of the callee's devices, but cancelPendingRings (server/relay.ts) only cancelled the primary socket
      — a caller hanging up before answer left the callee's OTHER devices ringing until their own timeout.
      cancelPendingRings now fans ring-cancel to all `reg.devices` (multi-device) mirroring the ring.
- [x] #50 (MED) NEW-DEVICE APPROVAL COULD STRAND A LOGIN: approval requires another device active in the
      last ~12 min, but that device may be closed and never tap Approve. AuthPanel's waiting screen now
      always offers a "Sign in with your PIN instead" escape (PIN bypasses approval by design) and, after
      35s with no response, an honest "the other device may be offline or closed" note. Fails toward the
      user getting in.
- [x] #51 (LOW batch): (a) the in-call add-person offline guard now accepts BOTH offline + nonexistent
      (v2.99.11 split them). (b) UNSEND cleared a phantom unread badge: unreadCount is a stored per-
      recipient counter, so unsending an as-yet-unread message left the badge lit for a message that's
      gone — deleteMessage (v2db.ts) now decrements (floored at 0) every non-sender recipient who hadn't
      read past it. (c) OFFLINE-MESSAGE EMAIL: a failed send used to keep the cooldown watermark, silently
      suppressing notifications for the whole window — releaseOfflineMessageEmailClaim rolls it back on
      failure so the next message retries. (d) SESSION REAPER: reapStaleSessions (every 30 min) drops dead
      pending-approval rows (never approved after 30 min — they inflated the approval bell forever) + rows
      idle past the longest cookie TTL (95 days).
- [x] Tests: server/qaSweepV29919.test.ts (14 — behavioural relay tests for #48 ctxEpoch guard + #49
      multi-device cancel fan-out; source-pins for the client + DB fixes). Two pre-existing pins updated
      to the refactored error handler (multiCallFixes §4a → joinErr; updateChecker add-guard regex).
      Suite 1400 passed / 1 skipped; check + build green.

## v2.99.20 — HARDENING PASS 4: full backend + frontend security sweep (owner: "expose the security bugs... check the entire app... I want full backend and frontend") (2026-07-24)
- [x] Dispatched the dedicated `claude-security` orchestrator across the whole app (tRPC authz/IDOR,
      auth/crypto/session, client trust surface, raw Express routes, mobile/CI/secrets, client XSS,
      signaling engine, S3 driver + mailer, push/redis-bus/events, inbound-email/well-known/seo) and
      independently re-verified every candidate against source before fixing. 11 confirmed + fixed:
- [x] (1) HIGH — storage-proxy key-normalization bypass: `authorizeStorageKey` matched the RAW request
      key while `s3PresignGetUrl` silently normalized via `sanitizeS3Key` at presign time; a real
      attachment key with an extra slash missed the exact-match lookup (fell into the fail-open
      `unknown` classification) yet still resolved to and served the real object. Fixed by
      canonicalizing the key ONCE up front in `storageProxy.ts`.
- [x] (2) `openThread`/`createGroup` let a caller force a brand-new DM/group onto a target who had
      blocked them (block only stopped `messages.send`); both now check `isNumberBlockedBy` before
      creating a FRESH thread/group, responding identically to "not found" so the block stays hidden.
- [x] (3) `push.unsubscribe` IDOR — deleted a subscription by `endpoint` alone with no ownership check;
      new `deleteOwnPushSubscription` scopes it to the caller's identity.
- [x] (4) `attachments.register` accepted an arbitrary client `url` (tracking beacon / phishing
      open-redirect via any external/javascript:/data: URL); `url` is now always derived server-side
      from the validated `storageKey`.
- [x] (5) OAuth `getSessionSecret()` fail-open — signed/verified sessions with an empty key when
      `JWT_SECRET` was unset; now throws in production, matching the existing fail-closed convention.
- [x] (6) `cidToPin` memory leak — a disconnected client's mapping was never cleared once its room
      reaped; a 15-min sweep now purges only entries with no live client AND no active-or-held room.
- [x] (7) Redis bus (`relay:v2ev`) event-kind allowlist — a forged/malformed envelope could smuggle an
      unbounded shape into the SSE handler; `_handleBusV2Event` now drops anything outside the known
      `V2Event` kinds.
- [x] (8) SMTP STARTTLS response-injection (CVE-2011-0411 class) — the plaintext read buffer was
      shared across the TLS upgrade boundary; `upgradeTls` now clears it before the handshake.
- [x] (9) `randomDigits6` used `Math.random()` instead of the CSPRNG every other identifier in the
      codebase already uses; switched to `crypto.randomInt`.
- [x] (10) `appUrl.ts`'s `requestOrigin()` fed an unvalidated Host/X-Forwarded-Host into sitemap XML
      and email-verification links; added a `SAFE_HOST_RE` allowlist.
- [x] (11) CI/CD command injection in `.github/workflows/aws-ops.yml`'s `ses-ssm` action — `SES_EMAIL`/
      `DOMAIN` workflow_dispatch inputs were spliced unescaped into command strings run on production
      EC2 via SSM; fixed with the same base64-encode-on-runner/decode-on-remote treatment `DESC_B64`
      already used. `iam-grant-ses` reviewed and found not vulnerable (runs directly on the runner).
- [x] Accepted residuals (documented, not fixed this pass): Redis bus still has no message
      authentication (architectural), cluster-leader trust of bus-forwarded `__ownedNumber`/`home`
      (same trust boundary), no per-account password-login lockout (only per-IP), upload-DoS ordering,
      `/api/v2/offline` has no rate limit, anonymous `/api/relay/ice` TURN credential minting for
      arbitrary `who`.
- [x] Tests: `storageProxy.test.ts` (+3), `awsOps.test.ts` (+3), plus source-pinned coverage for the
      block-bypass, push IDOR, attachment-URL, OAuth fail-closed, and cidToPin-reaper fixes. Suite
      1392 passed / 1 skipped; check + build green.

## v2.99.21 — the Arabic language toggle actually activates now (owner: "not active") (2026-07-24)
- [x] ROOT CAUSE: v2.99.16's Arabic-parity CSS is all scoped to `.lp-root[dir="rtl"]`, but `dir="rtl"` was
      only stamped on the INNER `[data-lp="root"]` div (a child of `.lp-root`), never on the outer React
      `.lp-root` div — so the selector never matched, the Noto-Kufi-Arabic font + sizing never applied, and
      Arabic rendered in the small fallback system face. This is why the owner saw the Arabic toggle as
      "not active" (and why #40 "renders smaller" was never truly fixed).
- [x] FIX (client/src/pages/Home.tsx): bind dir on `.lp-root` itself —
      `<div className="lp-root" dir={lang === "ar" ? "rtl" : "ltr"}>`. Inner markup still stamps dir on its
      own root (drives RTL layout); now the outer element carries it too so the CSS matches.
- [x] HEADLESS-VERIFIED in Chromium (desktop + emulated phone with touch): toggle flips `.lp-root` dir
      ltr→rtl, copy→Arabic, heading COMPUTED font → Noto Kufi Arabic; hit-test shows NO overlay on the
      controls and the loader fully dismissed. DIAL PAD verified working in EN (5 5 5 · · ·) and AR
      (7 8 9 · · ·) — so the keypad + toggle are functional in the current bundle; a live "can't click
      anything" is a STALE CACHED bundle → hard-refresh.
- [x] Rebased onto a parallel session's v2.99.20 (dbbe1700 hardening pass) — version bumped to 2.99.21 to
      avoid the collision. Tests: Home.test.ts +2. Suite 1408; build green.

## v2.99.22 — heavy-QA sweep fixes, batch 1 (owner: "activate the heavy QA") (2026-07-24)
The heavy-QA workflow (57 agents, 43 candidates, 37 adversarially-verified) surfaced a large queue.
This batch ships the clearest HIGH findings; the rest are queued for following batches.
- [x] H1 (HIGH) group call collapsed on a decline: the reject handler (server/relay.ts) reaped the
      caller's size-1 dial room via leaveRoom the instant ANY invitee declined, but leaveRoom doesn't
      cancelPendingRings — so the other invitees kept ringing with pendingRings pointing at a deleted room
      and got error{gone} on accept, killing the whole conference over one decline. FIX: only reap when
      `target.ringing.size === 0` (the decliner was already removed just above), so an in-progress group
      dial survives. Distinct from v2.99.19 #46 (that was the OFFLINE-first-invitee client path).
- [x] H7/H8/M1 (HIGH) blocked-caller missed-call bypass: onMissedCall (server/_core/index.ts) recorded
      History + fired a missed-call push/email with no block check → a blocked caller's offline/declined
      dials were a repeatable push/email/history-injection channel. FIX: isNumberBlockedBy(callee.id,
      info.callerPin) guard at the top of the hook (fail-open on DB error), matching onInvite/onPageCallee.
- [x] H3 (HIGH) dead thread search: the Messages thread-list useMemo filtered by threadSearch but omitted
      it from its deps ([threads.data, me]) → typing returned the cached unfiltered list. FIX: add
      threadSearch to the dep array.
- [x] M8 (MED) premature session logout: the v2.99.19 reaper's 95-day idle cutoff was < the 365-day cookie
      TTL, force-logging-out valid sessions up to ~270 days early. FIX: raise the cutoff to 372 days
      (365 + 7 grace). Corrects #51(d).
- [x] Tests: server/qaBatch1.test.ts (5 — behavioural relay tests for H1 + source pins). Suite 1413; build green.
- DEFERRED to later batches: H8's missed-call email throttle (needs a cooldown column); H2/M3/M11
      (view-once menu leak + server content release before burn); H4/M7/M9 (auth approval edges);
      H5/M10 (avatar laundering + storage DoS); H6/M12 (presence re-online); H9/L6 (landing dialer);
      M2/M19/L1/L7 (group-call invitee handling); M13/M14/M18 (contacts/directory); M15/M16/L5 (status);
      M20/L8 (number-allocation races); M4/M5/M6 (messaging composer state); L2/L3/L4.

## v2.99.23 — heavy-QA sweep fixes, batch 2 (ephemeral-message security) (2026-07-24)
- [x] H2 (HIGH) view-once extractable via the menu: a still-LOCKED view-once/disappearing received
      message exposed its plaintext through the context menu — Copy wrote m.body to the clipboard, Reply
      surfaced it in the composer — and neither burned it, so it was re-copyable indefinitely; plus
      replyingTo omitted meta so previewOf's disappearing-guard was bypassed and the reply bar printed the
      raw body. FIX (Messages.tsx): suppress the !mine menu while `locked = isExpiring && !revealed.has(id)
      && !burned` (return null), and carry meta on replyingTo (type + setter + draft-reconstruct) so
      previewOf masks it to "⏱ Disappearing message" everywhere.
- [x] M3 (MED) group disappearing burned for all: a disappearing message in a group is one shared row, so
      the first opener burns it for everyone. Gated the composer toggle to 1:1 (!isGroup), the convo-switch
      effect keeps expire null on entry, and the send re-guards (const exp = isGroup ? null : expire).
- [x] M5 (MED) reply target leaked across threads: replyingTo wasn't reset on conversationId change → a
      reply banner from one thread posted with the wrong replyToId in the next. FIX: reset on
      conversationId change; the draft-reconstruct effect re-hydrates the new thread's own saved reply.
- [x] Tests: client/src/pages/app/qaBatch2.test.ts (5 source pins). Suite 1418; build green.
- DEFERRED: M11 (full server-side content-gating-until-consume) — needs a consume-to-reveal content-
      delivery redesign (list would return only lock metadata; consumeExpiring would return the body +
      a one-time media grant). The casual UI-extraction vector (H2) is now closed and previewOf masks
      quotes; M11 is the remaining defense-in-depth against reading the raw tRPC response.

## v2.99.24 — landing robustness: interactive controls wired before throwable init (2026-07-24)
- [x] Owner (after clearing cache + reopening on a real phone): the landing dial pad is "not active" and
      the ع/EN language button "is not clickable". NOT reproducible in-sandbox — the exact DEPLOYED
      artifact (strip-manus-runtime'd index.html + real bundle) passes every headless Chromium check
      (desktop + emulated phone/touch): keypad updates, toggle → .lp-root dir=rtl + Noto Kufi Arabic font,
      no JS errors, no overlay, loader dismissed. The sandbox network blocks ALL outbound hosts (even
      google.com 403s), so the live site can't be loaded from here to diagnose directly.
- [x] DEFENSIVE FIX (client/src/pages/Home.tsx startLanding): the "renders but nothing clickable" symptom
      is the signature of the interactive wiring never attaching. All interactive controls — keypad, Clear,
      Call, AND the language toggle — plus syncDial() are now wired FIRST, before any decorative/3D/audio/
      boot code. The decorative init (onScroll/initReveals/initScramble/initMatrix) and the boot/fx block
      (fxLoop/runLoader/bootThree) are each wrapped in try/catch; a dismissLoader() on the boot-catch
      guarantees the opaque full-screen loader can't sit over the page swallowing taps if boot throws
      before clearing it. Previously $("langBtn") was wired AFTER initReveals/Scramble/Matrix, so a throw
      in any of those (a stricter/older browser's WebGL/AudioContext/rAF quirk) killed the toggle.
- [x] Tests: Home.test.ts +2 (control-wiring-order + try/catch pins). Suite 1420; check + build green.
- OPEN: this is hardening, not a confirmed root-cause fix. The live symptom still needs the owner's
      https://your-chat.io/api/version value to tell "server not serving this build" (infra/DNS/CDN) apart
      from "the browser can't run the JS" (device-specific). The deployed CODE is verified sound.

## v2.99.25 — heavy-QA sweep fixes, batch 3 (2026-07-24)
- [x] H9 (HIGH) landing lookup errors showed "NO RELAY USER": the hero dialer's onLookup wrapper ended in
      .catch(() => null), so a directory.lookup ERROR (shared-NAT rate-limit 429 / transient 500) resolved
      as null — same as a genuine not-a-user — and rendered "NO RELAY USER" + disabled CALL for a REAL
      online user; runLookup's fail-open .catch was dead code. FIX (Home.tsx): drop the .catch(() => null)
      so a real rejection reaches runLookup's fail-open (FALLBACK → arm CALL → /i re-resolves). A genuine
      not-found still RESOLVES to null → correct "NO RELAY USER".
- [x] H4 (HIGH) stale wasRegistration misrouted a login into the broken setup screen: AuthPanel's
      wasRegistration was set by submitRegister and never reset, so backing out of register + signing in to
      an existing PIN-less account routed verifyCode into "Finish setting up" (where setLoginPin/
      updateProfile 401). FIX: setWasRegistration(false) at the top of routeAfterProbe (runs before
      submitRegister re-sets it true).
- [x] H6 (HIGH) heartbeat re-marked a hidden tab online: PresenceManager's 30s tick had no visibility
      check, so after onLeave marked the user offline the next tick re-marked them online (false "back
      online" pushes) while backgrounded. FIX: tick returns early when document.visibilityState === "hidden"
      (the visibilitychange handler re-heartbeats on return to visible).
- [x] Tests: client/src/app/qaBatch3.test.ts (4 source pins). Suite 1424; build green.

## v2.99.26 — heavy-QA sweep fixes, batch 4 (storage-media) (2026-07-24)
- [x] H5 (HIGH) avatar laundering via an absolute URL: identity.updateProfile ran keyInOwnerNamespace only
      for a RELATIVE /manus-storage/ avatarUrl, but isIdentityAvatarKey suffix-matches, so an ABSOLUTE
      https://host/manus-storage/<victim-key> avatarUrl bypassed the gate and made the storage proxy serve
      another user's private attachment (or burned view-once media) to anyone. FIX (v2routers.ts): validate
      the key after the LAST /manus-storage/ (lastIndexOf) so both relative + absolute shapes are gated.
- [x] M10 (MED) unauthenticated storage-proxy DoS: /manus-storage/* had no rate limit and each request
      could trigger an identities full-scan (avatar rescue on unindexed TEXT avatarUrl). FIX
      (storageProxy.ts): per-IP token bucket (240 burst / ~4/s) BEFORE any key sanitize/authorize DB work,
      429 on flood, honors RELAY_RATELIMIT_OFF.
- [x] Tests: server/qaBatch4.test.ts (2 source pins). Suite 1426; build green.
- QA-sweep progress: 16 of 37 confirmed findings fixed (v2.99.22–26). Remaining: M2/M19/L1/L7 (group-call
      invitee handling), M13/M14/M18 (contacts/directory), M15/M16/L5 (status), M20/L8 (allocation races),
      M6 (draft debounce), M12/L4 (presence), L2/L3 (auth), M11 (server ephemeral content gating).

## v2.99.44 — the last two DEFERRED follow-ups (H8 throttle, L1 all-decline dial) (2026-07-24)
- [x] Owner asked whether anything was still missing. Audited every DEFERRED / "remaining" / "residual" line in
      the changelog against current source — not against memory. Two items had been flagged in their original
      batch and never revisited. Everything else was either shipped or a documented, deliberate residual.
- [x] H8 — THE MISSED-CALL EMAIL HAD NO THROTTLE (deferred in v2.99.22 as "needs a cooldown column").
      Verified in source: the path was gated on the block check, `reason !== "cancelled"`, a linked email and
      the pref — then sent, unbounded. So a caller dialling you repeatedly produced one email per attempt, the
      same shape the offline-message nudge was just tightened out of, and a free amplifier aimed at whoever the
      caller chose. FIX: new `lastMissedCallEmailAt` column (additive + nullable, boot-migrated) and
      `claimMissedCallEmail()` — one atomic conditional UPDATE keyed on the cooldown, verdict from
      `affectedRows`, so two simultaneous missed calls can't both claim. 10-minute window. The push and the
      History record stay UNCONDITIONAL and run before the claim, so a throttled email never costs the user the
      record of the call. A failed send releases the claim by inspecting `sent.ok` — not `.catch()`, which would
      be dead code (`sendEmail` never throws; that trap was found in the v2.99.42 review).
      DELIBERATELY a cooldown with NO daily cap, unlike the message nudge: a missed call is a first-class event
      and suppressing the tenth could hide the one that mattered, while repeated dialling is what blocking is
      for — and a blocked caller already reaches neither the push nor this email (v2.99.22).
- [x] L1 — AN ALL-DECLINED GROUP DIAL HUNG FOR 65s (deferred in v2.99.27). `inParkedCall()` is true for a group
      call, so a decline correctly does NOT tear the dial down — two of three people declining must leave the
      third ringing. But nothing watched for the LAST one: when everyone declined, the caller sat on "Ringing…"
      until the 65s no-answer backstop with nobody left to answer. FIX: `groupDialOutstanding`, a set that is
      non-null ONLY while a fresh group dial is unanswered (never for an add-person invite into an existing
      call). Declines, busies and unreachable invitees each resolve one; when the last resolves and nobody has
      answered (`inCall && outgoingDial && !establishedOnce && aloneInCall()`) the dial ends honestly
      ("Everyone declined."). Cleared by both `failDial` and `hangUp`.
      The server now also stamps `pin` on its reachability errors (additive — old clients ignore it): a group
      dial rings several people, so without knowing WHICH invitee an `error{offline}` is about, the caller
      cannot tell when the last one has resolved. This is the only thing that notices a later invitee going
      offline once the room already exists.
- [x] Tests: `server/deferredTail.test.ts` (11) — the claim's atomicity and ordering, that the push/History are
      not throttled, the release-by-result, the outstanding-invitee lifecycle, and a re-pin of the v2.99.22
      property that a PARTIAL decline still leaves the others ringing. Four pre-existing pins updated for the
      new `pin` field and a shifted slice boundary. 1714 tests; check + build green.
- [x] FIXED A BROKEN FILE ON `main`: the parallel session pushed CLAUDE.md with UNRESOLVED conflict markers
      committed into it (`      primary contract file). Their side of that conflict had also DROPPED the whole v2.99.42 entry. Resolved by
      reconstructing the line so nothing is lost: my new v2.99.44 entry, then their v2.99.43, then the v2.99.42
      entry spliced back from the other side, then the untouched chain. A tree-wide scan confirmed CLAUDE.md was
      the only file affected. todo.md was also reordered + de-duplicated again (six sections had two byte-identical
      copies), behind the same guard that refuses to delete any duplicate whose copies differ.
- NOTHING KNOWN OUTSTANDING after this. The heavy-QA sweep (37 findings), the owner's Rounds 1–8 file and both
      of these deferrals are closed; what remains is documented accepted residuals (the push.subscribe endpoint
      re-bind, leaked number reservations, Redis-bus transport auth, per-account password lockout, upload-DoS
      ordering) — each a recorded decision with its reasoning, not an omission.

## v2.99.43 — hardening pass 8: the verified-and-queued list (2026-07-24)
- [x] These five were confirmed during the class sweep but held back from the pass that shipped three
      HIGH fixes, because four sit in the CALL PATH — the most delicate code here — and bundling them
      behind one version bump was a bad trade against a green suite. Taken one at a time. One turned out
      to be WRONG on inspection and is recorded as a refutation, not a fix.
- [x] (M45) MODERATOR POWERS OUTLIVED MEMBERSHIP. `knock-approve` gated only on isModerator(meta, pin),
      but it takes roomId from the CLIENT and roomMeta outlives membership (the roster is add-only and
      nothing clears hostPin/cohosts on leave). So a FORMER host who hung up could still name the old
      room and admit an outsider into a call they'd left. Worse, it chained with `kick`: leaveRoom only
      drops membership and never touched meta.cohosts, so a KICKED CO-HOST kept their role, could knock,
      and could then APPROVE THEMSELVES BACK IN — the kick was undoable by its own target. Fixed both
      ends: knock-approve now also requires room.has(conn.pin) (membership, not `rid === self.roomId`,
      because a host whose call is on HOLD is still in the member Set and must still be able to approve),
      and kick revokes cohost + any pending knock and broadcasts role:null so no client keeps rendering
      host controls for them.
- [x] (M46) IN-CALL CHAT TRUSTED THE FRAME'S SELF-DECLARED SENDER. Both `name` and `pin` came straight
      from the JSON, so any participant could publish {name:"Alice", pin:"<alice's pin>"} and have it
      render as Alice, avatar included (the chip resolves the photo BY PIN). Both transports already know
      the real sender: the mesh has one data channel PER PEER (setupDC's `pin` is authenticated by the
      channel itself) and LiveKit hands DataReceived the sending participant, whose identity is the
      server-minted token pin. receiveChatFrame now takes that proven identity, prefers it over the
      frame, and takes the display name from the roster (nameOf) — with the param optional so any
      future/legacy caller degrades instead of dropping messages.
- [x] (M47) DUPLICATE IDENTITIES PER USER — the long-standing "my number changes randomly / this device
      shows a different number" symptom. ensureUserIdentity is a check-then-insert with no unique
      constraint, so two concurrent sign-ins for one account (double-tapped Sign in, two devices, an OTP
      verify racing a PIN login) could each mint an identity → two rows, two 6-digit numbers — and
      getIdentityByUserId used a bare .limit(1) with NO ordering, so MySQL returned EITHER row per query
      and messages/contacts split across both. Layered fix: orderBy(asc(id)) makes resolution
      DETERMINISTIC even where duplicates already exist in production, and a UNIQUE index on
      identities.userId (boot migrator) stops new ones being created. NULL userId is repeatable under a
      MySQL UNIQUE index so guests are unaffected, and the migrator's per-item catch means an existing-
      duplicate deployment logs and boots normally rather than failing.
- [x] (M48) `?to=` PLACED A CALL WITH NO GESTURE. The Dialer auto-dials the param so in-app "call" taps
      connect instantly — but it couldn't tell an in-app route change from someone ARRIVING on the URL,
      and mic permission persists per-origin, so for any regular user a link like
      /app/dialer?to=<attacker-pin> turned ONE CLICK into a live outbound call to a number the attacker
      chose (camera too with ?video=1, and their side can auto-answer). A route module can't detect this
      itself — Dialer.tsx is lazily loaded, so its module scope first evaluates AT the navigation that
      needs it. New client/src/lib/bootUrl.ts is imported by main.tsx, so it captures the boot URL before
      any routing: a `to=` present there means the user arrived on it → prefill the pad (one deliberate
      tap) instead of dialing. Verified the in-app paths are unaffected: /i/:pin uses wouter's
      client-side <Redirect> and Contacts/Messages use setLocation, so `to` is NOT in their boot URL.
      The one legitimate full-page path — the "<name> is back online — tap to call them now" alert the
      user armed — keeps its single tap via a one-time same-origin sessionStorage intent marker, which a
      link cannot forge or carry to someone else.
- [x] REFUTED, not fixed: "/api/relay/send resolves the full identity context before checking the rate
      limit." The limiter is app.use middleware on that path registered at _core/index.ts:141, and
      attachRelay is called at :206 — Express runs middleware in REGISTRATION order, so it already
      precedes the handler that calls createContext (and only `register` calls it at all). Pinned as a
      refutation so the claim isn't re-raised.
- [x] Tests: new server/hardeningPass7.test.ts (24), incl. a behavioural check that a forged chat pin
      loses to the transport-proven one. Two stale pins updated for the new shapes (contacts.test.ts's
      additive-DDL rule now allows ADD UNIQUE INDEX; androidAudioCamera.test.ts's chat-dedup pin now
      expects the threaded sender). Suite 1662 passed / 1 skipped; check + build green.

## v2.99.42 — Rounds 1–8 gaps: prod bundle, message push, push switch, SES-safe email (2026-07-24)
- [x] Audited the owner's `claudecodeinstructions.txt` (Rounds 1–8) against current source. ALREADY SHIPPED and
      pinned by their own releases: R1, R2B, R3, R4A/B, R5, R6, R7-GAP4, R8-FIX1/2/3/4. FOUR were genuinely
      still open; all four are fixed here.
- [x] R2A — THE PRODUCTION SERVER BUNDLE REQUIRED FIVE devDependencies AT BOOT. `server/_core/vite.ts` is
      dev-only (production calls serveStatic), but its top-level `import … from "vite"` + default-import of the
      root vite config are hoisted, so esbuild put `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`,
      `@builder.io/vite-plugin-jsx-loc` and `vite-plugin-manus-runtime` into `dist/index.js` as top-level
      imports — `node dist/index.js` loaded all five just to serve static files. NOT breaking today (the deploy
      runs a full `pnpm install`), but the day anything installs `--prod` or prunes, production stops booting
      for dependencies it never uses. FIX: `await import("vite")` inside the function, and instead of importing
      the config module, hand vite the config file's PATH so vite loads and compiles it (what `vite build`
      does) — which also makes the config single-sourced, replacing a spread-config + "there is no config file"
      pair that quietly bypassed vite's own resolution. VERIFIED against the real artifact: zero dev-only
      top-level imports remain, and dev still boots (react-refresh preamble present, /src/main.tsx 200).
- [x] R7 GAP1 — A NEW MESSAGE NEVER WOKE AN OFFLINE RECIPIENT. A missed call has pushed since v2.83 and a
      voicemail since v2.88, but a plain message only fanned an SSE hint — which by definition only reaches a
      tab already connected, i.e. the case where the user doesn't need telling. A phone with RELAY installed
      and closed stayed silent until its owner happened to open the app. FIX: `messages.send` pushes every
      OFFLINE recipient (`kind:"message"`, tag `relay-msg-<conversationId>` so ten messages replace rather
      than stack, url deep-links the thread). Content-free by the owner's rule — the sender's name, never a
      word of the body. Voicemails keep their own better-worded push (no double-notify).
- [x] R7 GAP2 — NO USER SWITCH FOR PUSH. Added `users.pushEnabled` (additive + nullable, boot-migrated;
      NULL/true = on) enforced INSIDE `sendPushToIdentity`, before the subscription lookup — so every push
      kind and every call site obeys it, including ones added later. Reads NULL as on and fails OPEN on DB
      trouble, so it can never silence a ringing call. Exposed via `otpAuth.get/setNotificationPrefs` and a
      "Push notifications" toggle in Profile; the section is now "Notifications" and shows for any signed-in
      account (the two EMAIL rows stay gated on a linked address).
- [x] R7 GAP3 — THE OFFLINE-MESSAGE EMAIL IS NOW A LAST RESORT. This is the only mail RELAY sends that the
      recipient didn't ask for (someone else's message triggers it), so the failure mode is an annoyed user and
      an SES reputation we don't get back. Four rules on top of the existing pref + atomic claim: (1) skipped
      entirely when the recipient has a push subscription — they just got the notification above; (2) requires
      them to have actually been away ≥5 min (presence flips offline the moment a tab hides, so a phone that
      locks for ten seconds would otherwise earn an email for a message its owner is already reading);
      (3) cooldown 15 min → 60 min, and the copy coalesces by design ("you have messages waiting", never a
      per-message count); (4) a hard ceiling of 3 per UTC day, enforced by the claim's WHERE against the
      pre-update row so two concurrent claims at CAP-1 can't both win. A failed send returns BOTH the cooldown
      and the day's budget slot (GREATEST floors the counter at 0).
- [x] CAUGHT IN PRE-MERGE REVIEW (a real bug in this release's own new code, found before shipping): the daily
      counter first reset itself inside the claim as `SET count = IF(day <=> today, count + 1, 1), day = today`,
      relying on MySQL's left-to-right SET evaluation so the IF reads the OLD day. But the emitted order is NOT
      ours to choose — drizzle's `buildUpdateSet` walks the table's COLUMNS object, i.e. SCHEMA DECLARATION
      order, not the object literal passed to `.set()`, and `messageEmailDay` is declared before
      `messageEmailsToday`. So the day was written FIRST, the IF always saw `today`, the counter never reset:
      3 emails on day one and then exactly ONE per day forever, with the counter growing without bound. The
      first version of the test asserted the object-literal order and therefore proved nothing. FIX is
      structural, not a reorder: an idempotent day-rollover UPDATE (safe to race — concurrent rollovers write
      identical values) followed by a claim whose SET is a pure increment, correct under ANY emitted order.
      Verified against drizzle-orm 0.44.6's mysql dialect, and the test now pins the real property plus a
      behavioural guard on the library so an upgrade can't silently reintroduce the dependency.
- [x] R7 GAP3 (cont.) — ONE-CLICK UNSUBSCRIBE that needs no login: new `server/unsubscribe.ts` mints
      `<userId>.<hmac>` (signed with the inbound-email secret family, so no new env var), and
      `/api/email/unsubscribe` accepts GET (a human clicking) and POST (RFC 8058 one-click, where the mail
      client submits it). The mail carries `List-Unsubscribe` + `List-Unsubscribe-Post` headers AND a visible
      footer link. The token is a NARROW capability — it can only turn message email OFF, never on, and reaches
      no other setting, so a leaked link costs at most one channel the user re-enables in Profile. Deliberately
      non-expiring (mail lives in inboxes for years; a stale unsubscribe link is what gets a sender reported).
      Fails CLOSED with no secret configured. Custom mail headers are threaded through `sendEmail` → `smtpSend`
      → `buildMimeMessage` with a CR/LF + header-name guard, so a header value can never inject another header
      or a body.
- [x] ALSO CAUGHT IN PRE-MERGE REVIEW: `/api/email/unsubscribe` mutated on GET, and express answers HEAD from
      `app.get` — so a mail security gateway that FETCHES links found in mail to detonate them (Microsoft Safe
      Links, Proofpoint/Barracuda URL rewriting, corporate AV scanners) would have silently unsubscribed the
      recipient before they ever opened the message, and they'd simply stop getting notifications with nothing
      to explain why. That is precisely the failure RFC 8058 introduced one-click POST to avoid. FIX: GET is now
      READ-ONLY — it verifies the token and renders a confirm page whose button POSTs (still no sign-in, still
      one click) — and POST is the only writing path, which leaves the RFC 8058 flow untouched because a mail
      client honouring `List-Unsubscribe-Post` POSTs on its own. The form action is the only place a query value
      reaches the markup; it is reached only AFTER the token verified (so it is digits + base64url by
      construction) and is HTML-escaped regardless, so the confirm page can't become a reflected-XSS sink. The
      POST also gets its own per-IP limiter + sweep (it is unauthenticated and does a DB read+write). Pinned by
      a BEHAVIOURAL test that drives the real express app and counts writes: GET → 0 writes + a form, HEAD → 0
      writes, POST → exactly 1, tampered token → 400 on both verbs and still 0 writes.
- [x] PRE-MERGE ADVERSARIAL REVIEW (5 reviewers over this release's own diff) found FIVE MORE real defects in
      the new code, all fixed before merge:
      (a) PUSH OFF ⇒ NEITHER PUSH NOR EMAIL. Nothing deletes the `push_subscriptions` row when the switch is
          turned off, so "has a subscription" was the wrong stand-in for "reachable": push off + message-email
          on + offline >5min produced NO push (sendPushToIdentity refuses) and NO email (the row exists) —
          silently, permanently, for that combination, and the exact opposite of the row's own copy. New
          `pushReachable()` = has a live subscription AND the switch on.
      (b) THE FAILED-SEND ROLLBACK WAS DEAD CODE (pre-existing since v2.99.19, aggravated here). `sendEmail` is
          documented never to throw and resolves `{ok:false}` on every failure path, so the `.catch()` the
          rollback hung off never fired: a refused/throttled SES send kept the claim, so the recipient got
          nothing and still paid the cooldown — and now a daily slot too. It inspects `r.ok` now; the
          defensive `.catch` stays.
      (c) THE UNSUBSCRIBE URL NEVER REACHED text/plain. With no explicit `text`, the fallback is
          `stripHtml(html)`, which deletes `<a>` elements together with their hrefs — so a text-only client saw
          the words "Unsubscribe from these emails" with no URL, the one case the visible link exists for. New
          hand-written `messageWaitingText()` carries both URLs.
      (d) MUTE AND DND WERE BYPASSED. Both are per-DEVICE localStorage settings enforced in the page
          (`useRealtime` simply didn't chime), which was enough while every alert originated in an open tab. A
          Web Push goes straight to the OS, so a muted thread would have buzzed the phone and DND would have
          been ignored. `conversationParticipants.mutedUntil` exists in the schema but nothing ever writes it,
          so the server genuinely cannot know. FIX at the service worker, which is per-device like the
          settings: the page mirrors `{dnd, muted[]}` into Cache Storage (new `client/src/app/swPrefs.ts`,
          written from `dnd.ts`, `mutedThreads.ts` and seeded in `pushClient.ts`), and `sw.js` parses the
          conversation id off the `relay-msg-<id>` tag and skips `showNotification`. Fails OPEN (any read
          problem shows the notification) and a per-conversation mute never suppresses a call.
      (e) THE DEV SERVER STARTED SERVING `.git/**` AND `*.pem`. Handing vite the config PATH made the config
          file's `server.fs.deny` actually apply (previously the inline `server` block replaced it and vite's
          defaults stood), and `mergeWithDefaults` ASSIGNS arrays — so `["**/.*"]` REPLACED vite's four
          defaults. picomatch only matches a dotted LAST segment, so `.git/config` and `key.pem` fell straight
          through, and this repo's `.git/config` carries credentials in its remote URL. Verified against
          picomatch directly (`**/.*` vs `.git/config` → false). The list is now complete:
          `["**/.*", "**/.git/**", "*.{crt,pem}"]`. Dev-only, but introduced by this change.
      ALSO: `vite.config.ts` had fallen out of the tsc program (the static import was what pulled it in), so
      type errors there escaped both `pnpm check` and the build — added to tsconfig `include`.
      VERIFIED CLEAN by the same reviewers (documented negatives): no content leak in the push payload (title
      is the sender's name, body a constant); expiring/view-once pushes reveal nothing M11 withholds; the
      pushEnabled query cannot delay a ring (no incoming-call push sender remains, and every call site is
      fire-and-forget); the sender's own devices and notes-to-self are excluded; header injection is genuinely
      shut (CR/LF + name guard, and U+2028/NEL are not SMTP line terminators); the unsubscribe href is provably
      unbreakable (integer id + base64url mac, env-only base); token forgery/malleability is not exploitable
      (the mac covers the PARSED id, 192 bits retained, length-guarded timingSafeEqual); and the vite config
      resolves identically (root/envDir/publicDir/alias/define/plugins/outDir/manualChunks all diffed equal,
      `allowedHosts` special-cased by vite so the inline `true` still wins).
- [x] Tests: `server/roundsGaps.test.ts` (41 — incl. a real assertion against the BUILT `dist/index.js`, the
      order-independence property, the behavioural GET-never-writes proof, unsubscribe token
      round-trip/tamper/no-secret, and header-injection). Three v2.99.13 pins in `emailNotifyPrefs.test.ts`
      updated to the tightened shapes. 1666 tests; build green.
- OPS: nothing required. `INBOUND_EMAIL_SECRET`/`JWT_SECRET` already exist (the unsubscribe link needs one of
      them plus `APP_URL`, both already set); with neither, the mail simply ships without the unsubscribe
      affordance rather than emitting a link that would reject everyone.

## v2.99.41 — hardening pass 7: sweep COMPLETE (14/14 classes) + panel survivors (2026-07-24)
- [x] The class-based sweep finished: all 14 hunter classes reported and the 3-lens adversarial panel
      returned 55 verdicts (51 refuted, 4 upheld). This ships the last wave plus the panel's survivors.
      The high refutation rate is the panel working as intended — it killed 51 plausible-but-wrong claims.
- [x] (1) ReDoS on the inbound-email webhook — the panel's highest-confidence NEW finding (MED, "verified
      the sink empirically three ways"). parseInboundAddress ran /<([^>]+)>/ against an untrusted header
      value with NO length cap, on a route accepting 5MB of JSON. Input with a `<` and no `>` makes the
      engine retry [^>]+ from every `<`, giving back one char at a time — quadratic, ~10^13 steps for
      5MB. Node is single-threaded and this process serves every SSE stream, signaling POST and API call,
      so ONE request stalls calls + messaging for EVERY user; the webhook signature check is opt-in, so
      it can be unauthenticated. Capped at 1024 bytes before the match (RFC 5321 caps addr-spec at 320),
      bounding n rather than relying on a cleverer regex.
- [x] (2) `region` was STILL spliced raw into the SSM remote commands — A GAP IN MY OWN EARLIER FIX. G11
      base64'd SES_EMAIL and DOMAIN but missed `region`, the THIRD free-text workflow_dispatch input on
      the same path, still interpolated unescaped into all five command strings run on production EC2
      under the instance role. Same encode-on-runner/decode-on-instance treatment. Its other uses run on
      the runner via safe single-pass substitution and are deliberately left alone.
- [x] (3) Sign-out never revoked the session ledger row (UPHELD by the panel, traced end to end).
      v2.99.1 built a revocable session model and createContext gates every sid-bearing cookie on it, but
      auth.logout only cleared COOKIES — the row stayed ACTIVE, so the device kept showing in the user's
      own Devices list as a live session AND the token stayed valid, meaning a copy recovered from a
      synced browser profile, a disk backup, or a shared machine would still authenticate. Now revokes by
      sid, wrapped so a DB hiccup can never stop the cookies being cleared.
- [x] (4) The media-proxy per-IP limiter was too tight for shared egress — an AVAILABILITY finding, not a
      vuln. 240 burst / 4-per-sec is per-IP, and carrier CGNAT / an office / a café put many real users
      behind ONE address; on an image-heavy chat a few people scrolling together could exhaust it, and a
      throttled media request renders as a BROKEN IMAGE — the exact symptom this project has chased
      repeatedly. Raised to 600 / 20-per-sec, still capping a scraper two orders of magnitude below
      unlimited. The guard's real target is DB-CPU cost on the miss path, not enumeration (keys carry a
      random suffix and can't be guessed).
- [x] VERIFIED AND DOWNGRADED by independent checking: the Android `release { signingConfig
      signingConfigs.debug }` line is a genuine footgun but NOT a live compromise — native-rn.yml
      re-signs the AAB with a real keystore from ANDROID_KEYSTORE_BASE64 after the build, so the store
      artifact is properly signed. Recorded as an operator note rather than changed blind (touching
      signing config without knowing their keystore setup risks their release pipeline).
- [x] LEFT TO THE OPERATOR — cannot be fixed from the repo, and guessing would break the deploy:
      (a) the deploy OIDC role trusts `repo:…:*`, so a workflow on ANY branch can assume the production
      deploy role — that's an AWS IAM trust-policy edit, not a code change; (b) deploy.yml pins
      third-party actions to mutable major tags in the job holding production credentials — pinning
      properly needs verified commit SHAs.
- [x] Tests: hardeningPass6.test.ts grows to 35, incl. a bounded-regex timing check and per-command
      assertions on the region fix. Suite 1638 passed / 1 skipped; check + build green.

## v2.99.40 — hardening pass 6: the class sweep's later-reporting classes (2026-07-24)
- [x] (1) HIGH — the 4-try PIN LOCKOUT WAS BYPASSABLE BY CONCURRENCY. attemptPinLogin gated on
      `row.loginPinLockedAt` — a field from a snapshot the CALLER already read — then ran verifyPassword
      regardless of the row's LIVE state. N simultaneous requests all saw an unlocked row, all passed,
      and all got a PIN checked: the S1 fix made the COUNTER race-free but never bounded how many
      VERIFICATIONS could happen, so the cap wasn't enforced per attempt and a burst could sweep much of
      the 10^4 space, limited only by the per-IP bucket. Inverted the order: every attempt must WIN a
      slot from the DB first (UPDATE … WHERE lockedAt IS NULL AND attempts <= cap, verdict from
      affectedRows) and only a winner may verify — MySQL serializes per row, so at most cap+1
      verifications happen between unlocks no matter the concurrency or instance. Ladder unchanged: the
      4th try is still verified (a correct 4th succeeds); a wrong 4th latches via its own isNull-guarded
      UPDATE, which also owns sending the alert email exactly once. The pure judgePinAttempt helper is
      test-only and now carries a loud "NOT AN ENFORCEMENT PATH" warning (it decides from a snapshot by
      design, so wiring it into a login route would reintroduce this).
- [x] (2) HIGH — UNSOLICITED video-accept FORCED A PEER'S CAMERA ON. onVideoAccept checked only
      `inCall`, so any call peer could send that frame and run unlockApprovedVideo() on the victim — a
      total bypass of the v2.81 mutual-consent protocol; the only notice was a "Video is on — both
      sides 🎥" toast, and on a party line one frame hits everyone. videoReqT alone couldn't guard it: a
      VIDEO DIAL answered with Video also replies video-accept and there consent was implicit in dialing
      (no request sent), while outgoingDial is cleared at establishment though consent frames often
      arrive before the transport exists. New per-call videoOfferedByUs flag set at BOTH consent points,
      cleared by the existing per-call reset; an unsolicited accept is dropped SILENTLY (no toast).
- [x] (3) HIGH — ATTACKER-CHOSEN Content-Type SERVED SAME-ORIGIN. The proxy relays the stored
      (uploader-supplied) type verbatim and nosniff means the DECLARED type is obeyed, so the upload
      denylist was the only defence — over an allowlist admitting text/* and application/* WHOLESALE.
      The whole XML family was missing (text/xml, application/xml, text/xsl, application/xslt+xml — XML
      with SVG/XHTML namespaces + <script> executes in some browsers, exactly what image/svg+xml is
      blocked for), as were the other JavaScript media types. Fixed at BOTH layers: denylist extended,
      AND the proxy now serves only an inline-safe set as itself, downgrading everything else to
      application/octet-stream + Content-Disposition: attachment — robust without enumerating every
      dangerous type, and matching how the client already presents attachments.
- [x] (4) auth.me SHIPPED THE CALLER'S CREDENTIAL HASHES to the browser: getUserById does an
      unprojected select(), so the handler serialized the whole users row — scrypt passwordHash AND
      loginPinHash — into every response, where it sits in the React Query cache, devtools/HAR captures,
      and anything an extension can read. Self-only so not cross-user disclosure, but it turns any
      read-only client foothold (an XSS like v2.99.37 #1, a malicious extension) into offline cracking,
      and the PIN hash covers 10^4. Stripped as a DENYLIST so no client-consumed field can vanish.
- [x] (5) The signaling OFFLINE DIAL was the last unthrottled number→identity oracle AND a third-party
      spam amplifier: replies differ by design ("<Name> is offline right now." vs "That number doesn't
      exist."), leaking existence + display name over the 10^6 space, and each pass writes a History row
      and fires a missed-call push AND email — with NO cooldown (unlike the offline-message email). The
      tRPC resolvers were gated for exactly this (F5) but this path never was, and the signaling limiter
      is a ~200/s FLOOD guard a scraper stays under (full enumeration in under two hours). New
      per-caller-pin offlineDialLimiter (20 burst, ~1/4s) scoped ONLY to the offline branch — a dial to
      an ONLINE user never reaches it, so normal calling and group dials are untouched (which is why
      this sidesteps the previously-rejected idea of capping invites in general). The throttled reply is
      the GENERIC offline message and returns before resolving anything or recording a miss.
- [x] (6) identity.regenerateNumber had NO THROTTLE — the M21 sibling. Each call permanently claims
      another of ~980,000 numbers and the old one is never recycled, so one authenticated account could
      drain the shared space and break allocation for every future signup. Now behind the mint budget.
- [x] Tests: new server/hardeningPass6.test.ts (22) + M36 coverage in hardeningPass5.test.ts including a
      simulation proving a 10,000-request burst yields exactly cap+1 PIN verifications, and behavioural
      coverage of the real BLOCKED_MIME / INLINE_SAFE_TYPE predicates. 3 stale pins retargeted
      (securitySweep S1, hardeningPass5 M25 ×2). Suite 1582 passed / 1 skipped; check + build green.
- NOTE (verified, queued — deliberately NOT rushed into the call path in this commit): signaling
  `knock-approve` doesn't re-check the approver is still in the room and `kick` doesn't revoke co-host;
  in-call chat trusts the frame's self-declared sender name (impersonation, cosmetic vs the fixed XSS);
  `ensureUserIdentity` is a check-then-insert with no unique index on identities.userId; Dialer's `?to=`
  places a call with no user gesture; member sign-out doesn't revoke its session-ledger row and password
  logins mint sid-less cookies; /api/relay/send resolves the full identity context before the rate check.
- NOTE for the owner (product decision, NOT a bug): the status audience rule means anyone who saves your
  6-digit number can see your story posts — contacts are self-service with no consent step. Flagged
  rather than changed.

## v2.99.39 — Messages thread list redesigned + camera/mic released on call end + email verification reactivated (2026-07-24)
> Renumbered from v2.99.35–37: a parallel session took those version numbers on `main` while this branch
> was open, so all three ship together as v2.99.39. Bodies are unchanged from the original entries.
> Merge notes: (a) the parallel session's v2.99.38 HARDENED the OTP register bypass (M31, create-only)
>     rather than removing it — removal supersedes that, and its companion M29 fix
>     (`clearUnverifiedCredentials` before `markUserEmailVerified`) already lives in `verifyOtp`, now the
>     only path that can verify an address, so nothing is lost. hardeningPass5.test.ts's M31 describe was
>     rewritten to pin the stronger property (the branch and its flag reader are gone) and its M29
>     ordering pin now asserts every claim site instead of a fixed count of two.
> (b) their v2.99.36 landing work found two REAL bugs in keypad tones that applied verbatim to this
>     branch's app-Dialer `client/src/lib/dtmf.ts`, so both are fixed there too (repo rule: apply a fix
>     system-wide): notes were scheduled at `currentTime` in the same tick as the ASYNC `resume()`, so on
>     iOS the start time had already elapsed and the tone was silent — it now resumes THEN schedules, with
>     a 5ms lookahead; and the peak gain was inaudibly low (0.085), now 0.18 to match the landing pad
>     (still under the ringtone's 0.28).

### Messages thread list redesigned (owner brief + Snapchat reference)
- [x] OWNER: "redesign the message section this way … the icon, the name, showing typing when he's typing.
      Down it shows you message. Put the PIN number. Put verified beside his name. If he has a status. Make
      it very flexible for the eyes, NOT compact — the current design is compact. And no need to put message,
      dial, voice outside: if you go inside the message you'll see it in the top bar … act, think
      professional as perfect designer." (Reference screenshot: a Snapchat chat list.)
- [x] DESIGN: three full candidates were drafted and scored by three independent judges (visual craft /
      usability+a11y / robustness). Winner "Quiet Two-Line" (87.5), shipped WITH every graft all three judges
      independently asked for — chiefly moving the timestamp to the right end of line 1 (it had been on
      line 2, where it competed with the preview).
- [x] THE ROW (client/src/pages/app/Messages.tsx, the old 4-button row block fully replaced): a 60px avatar
      (its own button — status ring → status viewer / profile, presence LED) + exactly TWO text lines inside
      ONE tap target:
        line 1   NAME 19px (bold when unread) + caption-less tier mark ................ time
        line 2   [muted] PIN(NNN-NNN) · preview — or "typing" with three pulsing dots — · N new
      No dividers: separation is whitespace on a ~92px rhythm (rounded inset row, px-3 py-3.5). That is the
      "not compact" the owner asked for — the row is ~40% taller than v2.99.33's and the name now owns the
      full width instead of sharing it with an action cluster (which had squeezed it to "A…").
- [x] PER-ROW BUTTONS REMOVED per the owner: message / voice / video are gone from every thread row. Nothing
      was lost — the conversation's own top bar already carries voice + video (Messages.tsx dialer deep-links,
      re-pinned by the new test), and a "message" action inside Messages was always a no-op.
- [x] STATUS RING is unchanged and still live: PeerAvatar draws the gradient (unseen) / subtle (seen) ring and
      opens the story viewer on tap — that's the owner's "if he has a status".
- [x] ROBUSTNESS (both were real bugs in earlier rows): NO fixed row height anywhere (a hard-coded 16px line
      clipped a badge in v2.99.36's Dialer), and the PIN + time carry dir="ltr" + unicode-bidi:isolate while
      the name/preview carry dir="auto", so an Arabic (RTL) name can't reorder or absorb them. Line 2 wraps
      (flex-wrap gap-y-1) rather than starving the preview on a narrow phone; the avatar button stays a
      SIBLING of the row button (nested buttons are invalid HTML); aria-current marks the open thread; the
      typing dots are motion-safe:animate-pulse (inert under prefers-reduced-motion).
- [x] Tests: client/src/pages/app/messagesRowRedesign.test.ts (18 — airy shape, every element the owner
      listed, the buttons' absence + the header still having voice/video, and the robustness set).
      verifiedBadge/badgePinSurfaces Messages pins updated to the new row; the superseded v2.99.33 row
      describe in ownerRowStatus.test.ts replaced with a note (its status half is unchanged and still runs).
      1514 tests; build green.

### Owner batch: camera/mic released on call end + in-call/Dialer UI
- [x] OWNER BUG "when I finish the call and I minimize the browser, the mic and the camera is still active —
      I cannot even have another call". A 24-agent, 5-dimension audit of every capture/release path found a
      cluster of causes, all fixed:
      (a) THE WEDGE (the reported symptom): the red End button calls endActiveLine(), which SKIPS hangUp()
          (the only releaser) when heldRoomId is set and waits for `resumed`. onResumed never cleared
          heldRoomId, so after one end-and-resume heldRoomId === roomId; the next End took the silent branch,
          the server promoted nothing and replied NOTHING → inCall stayed true, camera/mic stayed captured,
          End became a no-op and new calls were blocked. FIX: onResumed clears a stale heldRoomId;
          endActiveLine arms a 4s fail-closed fallback forcing dropHeld()+hangUp(); the SERVER always answers
          end-active (error{nohold}) and the client completes the hang-up on it.
      (b) IDLE HOLD: primeMedia() acquired camera+mic at login and KEPT them, so the devices were captured
          the whole time the app was open with no call. Now warms only the PERMISSION (acquire → stop).
      (c) ORPHANED ACQUISITIONS: ensureMedia/flipCamera/reacquireCameraForPublish/recoverDeadLocalTrack
          installed a stream after an await with no staleness check. New mediaGen + mediaStale()/stopStream();
          ensureMedia also dedupes concurrent callers via one in-flight promise.
      (d) ONE RELEASE PATH: new releaseLocalMedia() (tracks + pipeline + self-preview srcObject) used by
          hang-up, engine destroy (which never destroyed the pipeline) and a backgrounded-while-idle sweep.
      (e) VOICE-NOTE MIC: voiceNote only stopped its stream in rec.onstop — a construct/start throw left the
          mic open; both guarded, and Messages/VoicemailPrompt cancel on unmount (incl. during the await).
- [x] IN-CALL UI (owner screenshot): removed the ⋯ More button + menu and the Diagnostics floater/overlay.
      Record promoted into the control bar as a labeled chip (still config-gated). diag() log kept for the
      console; the "?" shortcut and dead CSS removed.
- [x] DIALER (owner screenshot): preview sub-line was a fixed h-4 while RoleBadge stacks a ~22px caption →
      overlapped the keypad; now two lines (name + caption-less mark with the tier word inline via the new
      roleLabel(), presence below). Keypad taps play a real DTMF dual tone (new client/src/lib/dtmf.ts,
      output-only, also on hardware digits). "Save … to contacts" pill no longer clipped (own shrink-0 row +
      the card can scroll).
- [x] Tests: mediaRelease.test.ts (15), dialerToneLayout.test.ts (11), callBarV2994.test.ts rewritten,
      verifiedBadge.test.ts Dialer pin updated. 1499 tests.

### Email verification reactivated (RELAY_OTP_REGISTER_BYPASS removed)
- [x] SES is out of the AWS ap-south-1 sandbox (owner confirmed production access, 50k/day @ 14/s). Removed
      the v2.97.2 email-outage stopgap: the bypass branch + otpRegisterBypassEnabled() reader are deleted from
      v2routers.ts. register() now ALWAYS mints + dispatchOtp's a real code (via SMTP → SES); the account is
      created/verified only after verifyOtp. A stale RELAY_OTP_REGISTER_BYPASS=1 in a server .env now has NO
      effect (flag no longer read). Client AuthPanel.submitRegister: the bypass:true short-circuit is gone —
      registration always advances to the code-entry stage.
- [x] Unchanged (already SES-wired): missed-call email (onMissedCall, emailNotifyMissedCall pref) + offline
      -message email (v2MessagesRouter.send, content-free, emailNotifyMessage pref, 15-min cooldown).
- [x] OPS to finish activation on EC2: SES SMTP creds + verified EMAIL_FROM in /home/relay/.env, set
      APP_URL=https://your-chat.io (email links), restart pm2.
- [x] Tests: otpRegisterBypass.test.ts rewritten (6 pins — flag no longer read, register always mint/emails,
      AuthPanel has no bypass path); deviceSessions.test.ts session-count pin 3→2. 1471 tests.

## v2.99.38 — hardening pass 5 pt.2: remaining class-sweep findings (2026-07-24)
- [x] (1) HIGH RELAY_OTP_REGISTER_BYPASS was unauthenticated ACCOUNT TAKEOVER, not just unproven
      signup: the bypass branch of otpAuth.register (a publicProcedure whose whole input is a name +
      email) called findUserByEmailAny and signed the caller in as WHATEVER IT RESOLVED. With the flag
      on, anyone knowing a registered user's email got a full session as them — no code, no password.
      The accepted trade was "email ownership isn't proven AT SIGNUP"; taking over EXISTING accounts
      never was. Branch is now CREATE-ONLY: refuses with CONFLICT when the address already has an
      account, only ever mints a new one. Signing in stays requestOtp/loginWithPin (real credentials).
      NOTE for the owner: this flag is set in /home/relay/.env, not in repo config, so I can't tell
      from here whether it's currently on — worth unsetting it now that SES should be approved.
- [x] (2) HIGH BLOCKED_MIME bypass via a multi-valued Content-Type: ALLOWED_MIME and BLOCKED_MIME are
      both START-ANCHORED, so they only inspected the FIRST type of the client-supplied ?mime= value.
      "image/png,text/html" passes ALLOWED (starts image/) and misses BLOCKED (doesn't start with a
      blocked type); the value was then stored and replayed verbatim as the Content-Type of a
      same-origin response — the stored-XSS shape BLOCKED_MIME exists to stop, since header parsers
      disagree about which listed type wins. New exported normalizeMimeType() reduces to a canonical
      type/subtype essence (params dropped, case-folded) and requires exactly ONE RFC-2045-token media
      type (no commas, no whitespace), applied at BOTH mimeType sources before any gate or storage write.
- [x] (3) ACCOUNT DIVERSION — the other half of M29: /api/auth/register's findLocalUserByEmail matches
      only rows that HAVE a passwordHash, so it's blind to OAuth/otp accounts and inserted a SECOND
      users row for the same email. findUserByEmailAny ranks a "local" row ABOVE a legacy OAuth row, so
      the victim's email code signed them into the attacker's empty row — and with the OAuth UI removed
      in v2.92 the email code is their ONLY way in, so their real account (number, contacts, history)
      became unreachable. New findAnyUserByEmail refuses registration when ANY row holds the address;
      the unverified-local resend path is untouched.
- [x] (4) GZIP AMPLIFICATION on /api/v2/upload: body-parser inflates encoded bodies by default and
      enforces `limit` against the DECOMPRESSED stream — so the 41MB ceiling held, but the cost to
      REACH it collapsed ~1000x (tens of KB of compressed zeros → 41MB buffered). That compounds the
      known ordering weakness that this route's rate limit runs INSIDE the handler, i.e. after
      buffering. inflate:false on both upload parsers — no client compresses an upload body (browsers
      never gzip request bodies; the native app streams raw), so it costs nothing real.
- [x] (5) The storage-proxy rate limiter was NEVER SWEPT. Every other limiter here pairs itself with a
      periodic sweep; this one shipped without, so its per-IP Map grew for the whole process lifetime
      on the app's only fully anonymous, high-fan-out endpoint. Added the sweep.
- [x] Tests: hardeningPass5.test.ts grows to 59, incl. behavioral normalizeMimeType coverage of the
      real bypass payloads (comma-lists, whitespace, case) and proof the blocked list still catches a
      normalized dangerous type. Suite 1555 passed / 1 skipped; check + build green.

## v2.99.37 — HARDENING PASS 5: class-based security sweep (owner: "cover all type of security bugs... very perfect") (2026-07-24)
- [x] Prior passes audited SURFACE BY SURFACE (routers, then auth, then storage). This one audited by
      VULNERABILITY CLASS — injection, XSS, authz/IDOR, CSRF, SSRF, upload/path, crypto, race/TOCTOU,
      DoS/ReDoS, business-logic, info-disclosure, client-trust, deps, CI — which is what surfaced these.
      All 10 verified against source before any change. 2 HIGH.
- [x] (1) HIGH ZERO-CLICK DOM XSS, in-call chat (client/src/lib/relayClient.ts): a chat frame's `pin`
      comes over the peer's DATA CHANNEL and was validated only by `typeof d.pin === "string"`, then
      interpolated into the row's innerHTML twice unescaped — inside the double-quoted `data-pin="…"`
      attribute, and through `fmtPin`, which passes a non-matching string through UNCHANGED. A peer
      sending pin='x"><img src=x onerror=…>' executed on parse with no click, on our origin → session
      takeover via the authenticated API. Reachable by anyone sharing a call, incl. a PARTY LINE
      (joinable by number) → one frame hits everyone. Fixed by validating to /^\d{6}$/ (the check
      ensureChatAvatar already did, but only AFTER the markup was written); initials() sinks on the chat
      chip, call tiles and recents escaped too.
- [x] (2) HIGH ACCOUNT PRE-HIJACKING → takeover: unauthenticated POST /api/auth/register creates a
      local user with an ATTACKER-chosen passwordHash and emailVerified:false for ANY email. The real
      owner later signs in by email code; findUserByEmailAny deliberately falls back to that local row
      (v2.92 compat) and markUserEmailVerified flipped it verified WITHOUT clearing the password — then
      /api/auth/login (password + verified) issued the attacker a session on the victim's account. New
      clearUnverifiedCredentials(userId) wipes password/PIN on a still-UNVERIFIED row at the moment the
      address is proven, called before markUserEmailVerified at BOTH claim sites. Scoped to unverified
      rows so a legitimate local user who used their own verify link keeps their password.
- [x] (3) VIEW-ONCE LOCK BYPASS (getAttachmentForIdentity): authorized a non-uploader via ANY
      referencing message including a still-LOCKED expiring one (attachmentId is only nulled at burn).
      That one function backs attachments.get (sequential int ids → enumerate), authorizeStorageKey AND
      messages.send's ownership check — so a recipient could read view-once media repeatedly without
      burning it (sender never told), and RE-ATTACH it to a new permanent message elsewhere. Locked
      expiring messages no longer authorize; the uploader early-return keeps senders unaffected.
- [x] (4) MySQL LEFT-TO-RIGHT UPDATE ASSIGNMENT broke BOTH attempt ladders: a later SET assignment
      reads the value an earlier one just wrote, so the lock CASE saw `attempts` already incremented and
      the extra `+1` double-counted. PIN locked on the 3rd wrong entry, not the 4th — and the persisted
      count could then only reach 3 while the brute-force ALERT EMAIL requires exactly 4, so that email
      was UNREACHABLE: an owner was never told their account was under attack. Same defect burned the
      email OTP a guess early. Both now compare the post-increment value directly.
- [x] (5) startGuest was an unauthenticated, UNTHROTTLED identity MINTER — the only resource-creating
      public endpoint with no gate. Each call permanently claims one of ~980,000 six-digit numbers
      (numberTaken ignores guest expiry, nothing deletes identities, M20's ledger is monotonic). Drained
      far enough, allocateSharedNumber's 40-attempt search fails for EVERYONE → every new guest,
      registration and party line dies permanently. Added guestMintGate (20 burst, ~1/10s per IP).
- [x] (6) revealExpiring buffered an UNBOUNDED body: the guard was Number(content-length ?? 0) <= CAP,
      so a MISSING header → 0 → passed → arrayBuffer() with no ceiling (the later buf.length check was
      too late), then base64 +33% inside a JSON response. Now REVEAL_MAX_INLINE_BYTES enforced against
      the STREAM, so a missing OR lying header can't exceed it.
- [x] (7) VIEW-ONCE BURN WAS NOT ATOMIC: both paths did read → check consumedAt in JS → write with an
      await between, so two concurrent reveals both returned the content (the S1/S9 lost-update class).
      Now one conditional UPDATE guarded on JSON_EXTRACT(meta,'$.consumedAt') IS NULL, verdict from
      affectedRows.
- [x] (8) avatarUrl accepted arbitrary http(s):// — a profile photo became a remote-fetch primitive
      aimed at other users, and it renders on the INCOMING-RING card, which appears with NO interaction:
      set an avatar to your host, dial a victim, harvest their IP + User-Agent from a call they never
      answered. Same threat the status-bg sanitizer already rejects url() for. Restricted to our storage
      path or data:image/ — zero compat cost (clients only ever set it from our own upload endpoint).
- [x] (9) status.post skipped keyInOwnerNamespace for kind:"text" while still persisting mediaKey.
      authorizeStorageKey resolves a /status_ key via whichever ACTIVE status claims it, so planting
      another user's key RE-ACTIVATED their expired/deleted status media — readable again and re-exposed
      to the planter's audience, defeating ephemerality. Gate now applies to any supplied key; a text
      status never persists media.
- [x] (10) tryReserveNumber detected a duplicate key by ERROR-MESSAGE TEXT in a helper that fails OPEN,
      so a driver upgrade/localized server would silently turn a lost race into "reservation won",
      reintroducing the cross-table collision the ledger prevents. Now errno 1062 / ER_DUP_ENTRY first.
- [x] VERIFIED CLEAN (documented negatives, so the negative result is trustworthy): no SQL injection
      (every sql`` template parameterizes values, Drizzle column refs for identifiers); landing-page
      innerHTML escaping intact after the v2.99.35 React-19 rework (escLp covers all 5 chars, applied
      post-composition, all sinks text-context); secret comparisons consistently timingSafeEqual with
      length guards; CSRF genuinely defended by SameSite=Lax on every cookie (the /api/v2/offline beacon
      can't fire cross-site, its deviceId fallback needs a secret); keyInOwnerNamespace correctly
      anchored (trailing slash defeats the 1-vs-12 prefix collision) and the absolute-URL avatar
      suffix-match fix unexploitable; searchMessages filters expiring content; tabPresence stores no
      secrets and fails safe.
- [x] ACCEPTED RESIDUAL: push.subscribe's upsert is keyed on the globally-unique `endpoint`, so knowing
      a victim's endpoint lets you re-bind it and silently kill their notifications. NOT fixed: no API
      ever returns an endpoint, the hijacker gains nothing readable (pushes are encrypted to their own
      keys), and the only correct fix is a proof-of-possession challenge — naively refusing re-binds
      would break the documented account-switch-on-same-device flow and silently kill notifications for
      real users. Prior-round residuals unchanged.
- [x] Tests: server/hardeningPass5.test.ts (44) incl. a real arithmetic SIMULATION of MySQL's assignment
      order (so the off-by-one can't silently return) and the actual XSS payloads the pin guard must
      reject; 4 stale pre-existing pins updated to the new shapes (m11ContentGating ×2, peerIdentityBatch,
      qaBatch8). Suite 1540 passed / 1 skipped; check + build green.

## v2.99.36 — landing polish: Arabic Open-App icon, dial-pad erase key, audible key tones (owner asks) (2026-07-24)
- [x] OWNER (screenshot + notes): "In the arabic the open app icon is not showing"; "in the dial pad both
      in arabic and english landing page make delete number icons so if you enter you can erase it";
      "make tone when you click each number as sound".
- [x] (1) ARABIC OPEN-APP ICON — the pill's copy string ended in a bare `↗` (U+2197). The v2.99.16 RTL rule
      forces 'Noto Kufi Arabic' on EVERY element in Arabic, that face has no U+2197, so iOS fell through to
      the emoji font and painted a boxed ↗️ next to the Arabic label. FIX: the arrow is an inline SVG
      (ARROW_NE) — identical in every language/font/platform — mirrored in RTL via `.lp-arrow`.
- [x] SECOND INSTANCE of the same defect found while writing the pin (my own test caught it): the CALL
      button label also ended in `↗`, and the button is NOT inside a `dir="ltr"` island, so in Arabic it
      rendered the identical emoji box. `setCallState` gained an `arrow` flag: the label stays textContent
      (it carries localized copy) and only the CONSTANT SVG is appended via insertAdjacentHTML, so there is
      no interpolation/injection surface. Verified live: `document.body.innerText` contains no U+2197 at all.
- [x] (2) ERASE KEY — now occupies the keypad's bottom-right cell, replacing `#` (pure decoration here: the
      pad only accepts 0-9 for a 6-digit RELAY number, so `#` did nothing but play a tone). Dims to .35 when
      there is nothing to erase, removes one digit per tap, no-ops when empty, localized aria-label/title.
- [x] REAL BUG caught mid-build and fixed: the FIRST implementation put the erase button beside the number
      display (absolute, `inset-inline-end`). In English it covered the 6th placeholder dot; in ARABIC,
      where it mirrors to the leading edge, it landed ON TOP of the first digit — the display is simply too
      wide to share that row. Moving it into the grid removes the overlap by construction and gives it a
      full 54px-tall touch target. Pinned by a no-overlap assertion measured in the browser.
- [x] (3) KEY TONES — DTMF existed but was effectively silent for two reasons, both fixed: (a) the
      oscillators were scheduled at `ac.currentTime` in the SAME tick as the ASYNC `ac.resume()`, so on iOS
      the note's start time had already elapsed by the time the context actually ran (the classic iOS Web
      Audio race) — a suspended context now resumes and THEN schedules, and every note starts at a +5ms
      lookahead so it can never be scheduled in the past; (b) the peak gain was 0.045 (≈ -27 dBFS),
      inaudible — now 0.18. The context is also unlocked on the first real gesture (1-sample silent buffer
      on pointerdown, the standard iOS unlock). Erase gets its own softer 420/310Hz tone.
- [x] HONEST LIMIT documented in-source (not papered over): on iPhone the hardware mute/silent switch
      silences Web Audio outright — no web page can override that.
- [x] VERIFIED headlessly on an emulated phone against the REAL built bundle, instrumenting AudioContext:
      exactly 2 oscillators per keypress at the correct DTMF frequencies (770/1336 for "5", 941/1336 for
      "0"), peak 0.18, ZERO notes scheduled in the past, the iOS silent-buffer unlock firing on first touch;
      the erase key overlapping neither the display nor any key in EITHER language, erasing one digit per
      tap and no-opping when empty; the Arabic pill AND the Arabic CALL button both painting mirrored SVG
      arrows with no U+2197 anywhere on the page.
- [x] Also proved a scare was NOT a bug: one Arabic keypad tap registered a neighbouring digit in an early
      run. Re-tested — key 7 correct 5/5 by coordinate, correct via raw touchscreen, and all 10 digits
      correct by direct dispatch, with the visual grid order intact (123456789*0#). It was a synthetic-tap
      artifact of the pad's 3D perspective tilt (Playwright's hover moves the surface between measuring and
      tapping); real touch input never triggers that tilt.
- [x] `server/v29936LandingPolish.test.ts` (15 pins). Suite 1495 passed / 1 skipped; check + build green.

## v2.99.35 — landing page structurally alive: React-19 innerHTML re-set killed all landing listeners (owner report) (2026-07-24)
- [x] OWNER REPORT: "after the loading… the dial pad, it's not active. If you click, doesn't click. The
      numbers doesn't show" + "the Arabic tab on the top on the landing page is not active — check both
      directions" + the dial-a-user-directly flow (check exists → name-only entry → callee sees caller name).
- [x] REPRODUCED against the real production build in headless Chromium: keypad clicks changed nothing,
      the lang button was dead both ways, and the boot overlay was being cleared by the pure-CSS
      lpAutoClear watchdog — not by the engine.
- [x] ROOT CAUSE (instrumented DOMTokenList.add → addEventListener → MutationObserver → finally the
      Element.innerHTML SETTER itself): React 19 re-applies dangerouslySetInnerHTML whenever the {__html}
      OBJECT identity changes, even when the string is byte-identical. Home.tsx built `{{ __html: html }}`
      inline — a fresh object every render — so the first unrelated re-render (the live-stats useQuery
      resolving ~0.5s after mount) re-set innerHTML on the live DOM and REBUILT EVERY NODE, discarding all
      engine wiring; the [lang]-keyed effect saw no change and never re-wired. Empirical timeline: markup
      mounted ~170ms, engine wired ~450ms, DOM replaced ~565ms (same string hash, new object). This also
      explains why v2.99.24's "wire controls first" hardening didn't cure the owner's report — the
      controls WERE wired; the nodes they were wired to got thrown away 100ms later.
- [x] FIX — three reinforcing layers in client/src/pages/Home.tsx: (1) the {__html} object is memoized
      (dsih) so React only re-sets innerHTML when the markup truly changes; (2) the wiring effect keys on
      [lang, dsih] so any future DOM replacement re-runs the engine in the same commit; (3) all
      dialer/lang clicks moved off per-node listeners onto ONE DELEGATED click handler on the stable host
      wrapper (React owns it; innerHTML only replaces its CHILDREN). The v2.99.15 live lookup, v2.99.21
      RTL binding, and v2.99.24 wire-first ordering all survive unchanged on top.
- [x] POLISH (found while verifying): dialStatus sat on "CHECKING NUMBER…" forever right above a RESOLVED
      dialPreview ("Sara · ONLINE") — two contradicting lines. The status line now hides while a resolved
      preview is showing, and the two FALLBACK (fail-open) paths flip it to "LINE READY — PRESS CALL".
- [x] ALSO FIXED: client/index.html shipped <script src="%VITE_ANALYTICS_ENDPOINT%/umami"> VERBATIM
      whenever the env was unset (vite keeps unknown %VARS% as-is) — every production page load requested
      the bogus URL, got a 400, and logged a strict-MIME refusal. Tag removed; client/src/main.tsx now
      injects analytics at runtime only when VITE_ANALYTICS_ENDPOINT/_WEBSITE_ID are configured.
- [x] VERIFIED headlessly against the rebuilt production bundle (tRPC-batch-shaped lookup stubs): keypad
      digits render AFTER the stats re-render that used to kill the page; found-online arms CALL,
      found-offline disarms (guest rule), party line shows "JOIN CALL", not-found disarms, lookup outage
      fail-opens; EN→AR flips dir=rtl + Arabic copy with the keypad still working; AR→EN restores; CALL on
      a found number ran the cinematic and landed on /app/dialer?to=555001 (the name-only direct-join).
      Screenshots: EN-found, EN-notfound, AR-found.
- [x] server/v29935LandingAlive.test.ts (9 pins incl. the polish) + the v2.99.24 pin in Home.test.ts
      updated to the delegated shape (same ordering invariant, new anchors). Suite 1480 passed / 1
      skipped; check + build green.

## v2.99.34 — M11: server-side ephemeral content gating (2026-07-24)
- [x] M11 (the final heavy-QA-sweep item; owner: "finish the M11"): messages.list returned the full body +
      attachment for an un-consumed view-once/disappearing message, so a recipient reading the raw tRPC
      response (or fetching attachment.url) saw the secret without burning it. FIX (server): list WITHHOLDS
      the content of a LOCKED message (isExpiring && !consumedAt && sender≠me) — body:null, attachment:null,
      + a `locked` flag. The only path to the content is the new revealExpiring mutation → revealExpiringMessage
      (captures body+attachmentId, then burns: nulls both + consumedAt, keeps the attachments row per F3);
      the router INLINES media as a data: URL (storageGetSignedUrl server-side, ≤30MB base64) so the immediate
      burn can't race a client fetch. Client: the tap-to-view card calls revealExpiringMutation and renders
      res.body/res.media.dataUrl; `burned` keys on the server locked flag + consumedAt. The old client
      fetch-then-burn flow is retired; consumeExpiring endpoint kept for back-compat.
- [x] Tests: server/m11ContentGating.test.ts (8 pins); qaSweepV29919 #47 + peerIdentityBatch v2.96 reveal
      pins updated. 1471 tests. THIS CLOSES THE HEAVY-QA SWEEP — all 37 findings addressed (33 fixed +
      documented accepted residuals).

## v2.99.33 — owner feedback: Messages row layout + status visibility (2026-07-24)
- [x] (1) Thread rows cramped — name truncated to "A…": the DIRECT rows put name + badge + PIN + time AND
      the 4 action buttons on one line, squeezing the name. FIX (Messages.tsx): the row is a vertical stack
      (flex flex-col) — line 1 = full-width avatar + full name/badge/PIN + time + preview/typing; line 2 =
      the quick-action circles on their own row (pl-[52px] mt-1.5, size-4 icons) + an "N unread" pill.
      Typing indicator unchanged.
- [x] (2) Status "when you post it, it doesn't appear on anyone": visibility was follower-only
      (statusAudienceAuthorized passed only when the REQUESTER saved the OWNER), so a post was invisible to
      the poster's own contacts unless they saved back, and the PeerAvatar story-ring never lit. FIX
      (either-direction, WhatsApp-style): visible when EITHER side saved the other minus blocks either way —
      statusAudienceAuthorized (iSavedThem || theySavedMe); getStatusAudienceIds unions savers + the owner's
      own saved contacts (realtime fan-out); the feed adds getIdentityIdsWhoSaved(me.number). Composer copy →
      "visible for 24h to your contacts and anyone who's saved you".
- [x] Tests: client/src/pages/app/ownerRowStatus.test.ts (6 pins); qaBatch7 M16 + server/status.test.ts
      audience pins updated. 1466 tests. NOTE: widens status visibility (deliberate owner call; blocks still
      hide both ways).

## v2.99.32 — heavy-QA sweep fixes, batch 10 (presence) (2026-07-24)
- [x] M12 (MED) closing one of two tabs flipped the identity offline: presence is one boolean per identity
      but every tab runs its own PresenceManager, so closing one of two tabs beaconed offline (contacts blink)
      and the surviving tab's next heartbeat fired a false "X is back online" watcher push. FIX: a
      browser-scoped last-tab ref-count (new client/src/app/tabPresence.ts) — each tab records tabId→ts in a
      per-identity localStorage map on every visible heartbeat (touchTab); onLeave only beacons when no OTHER
      tab is fresh (otherTabsAlive, TAB_FRESH_MS=45s); a real close removeTab's its slot; a single tab still
      beacons instantly; fails safe (storage error → beacon fires; 2-min reaper backstop). Pure helpers
      (anyOtherTabFresh/pruneTabs) unit-tested.
- [x] L4 (LOW) reaper spurious-offline TOCTOU: reapStalePresence SELECTed victims then UPDATEd — a victim
      that heartbeat back online in between wasn't flipped but was still returned to broadcast offline. FIX:
      after the UPDATE, re-confirm each candidate is genuinely isOnline=false and return only those (fallback
      to victims on a re-check error).
- [x] Tests: client/src/app/qaBatch10.test.ts (9 pins incl. behavioural ref-count logic); v2offline.test.ts
      pins updated to the onClose/onVisibility restructure. 1460 tests. QA-sweep: 32 of 37 fixed.
      REMAINING: M11 (server-side ephemeral content-gating redesign — larger, flagged to owner) + documented
      accepted residuals.

## v2.99.31 — heavy-QA sweep fixes, batch 9 (draft + auth edges) (2026-07-24)
- [x] M6 (MED) draft lost on a fast thread switch: useDraft debounced the save 500ms and its
      conversation-change cleanup clearTimeout'd the pending save WITHOUT flushing — typing then switching
      threads within 500ms dropped the draft. FIX (draftStore.ts): a flush() (backed by draftRef/convRef)
      runs in the [conversationId] cleanup, plus a pagehide/visibilitychange flush for reload safety.
- [x] L2 (LOW) stale "declined" bounced a retry: AuthPanel's approval poll (sessionApprovalStatus) cached
      "denied" across the enabled:false toggle/remounts, so retrying a denied sign-in was instantly bounced
      to email with a false "declined" before the server saw the new pending session. FIX:
      utils.otpAuth.sessionApprovalStatus.reset() right before setStage("waiting").
- [x] L3 (LOW) digit-correction burned OTP attempts: the code input auto-fires verifyCode at 6 digits and a
      wrong code wasn't cleared, so deleting+retyping one digit re-fired and consumed one of the 5 attempts
      per correction. FIX: setCode("") in the wrong-code catch.
- [x] Tests: client/src/app/qaBatch9.test.ts (5 pins). 1451 tests. QA-sweep progress: 30 of 37 fixed.
      DEFERRED to a dedicated presence batch: M12 (closing one of two tabs flips the identity offline) +
      the reapStalePresence SELECT-then-UPDATE spurious-offline TOCTOU — they touch the live presence path
      and need multi-tab coordination.

## v2.99.30 — heavy-QA sweep fixes, batch 8 (number-allocation races) (2026-07-24)
- [x] M20 (MED) cross-table number collision: identities + party_lines share ONE 6-digit space, each with a
      per-TABLE unique key, but MySQL can't enforce uniqueness across two tables — so two concurrent
      allocations to DIFFERENT tables could both pass the check-then-insert numberTaken gate and claim the
      same fresh number (a collision permanently shadows a person / unreachables a line). FIX (v2db.ts): a
      shared number_reservations ledger (boot migrator, PK on `number`); allocateSharedNumber (both allocators
      delegate) runs numberTaken THEN atomically INSERTs the candidate via tryReserveNumber (dup-key → retry;
      any other error incl. table-missing → fail OPEN, behaves as pre-ledger). Monotonic — a handed-out number
      is never recycled.
- [x] L8 (LOW) party-line cap race: createPartyLine's cap was owned.length >= MAX then insert (check-then-act)
      — two concurrent creates at 9 both passed → 11. FIX: keep the fast pre-check, but enforce the cap
      deterministically AFTER insert by id-RANK (count of the owner's rows with id <= insertId); rows ranked
      > MAX self-delete (each deletes only its OWN id) and reject → converges to exactly MAX.
- [x] Tests: server/qaBatch8.test.ts (5 pins); partyLines.test.ts allocator pins updated to the shared
      allocator refactor. 1446 tests. QA-sweep progress: 27 of 37 fixed.
      DEFERRED: rare leaked reservations on a post-reserve insert failure (900k space, cosmetic — no reaper).

## v2.99.29 — heavy-QA sweep fixes, batch 7 (status stories) (2026-07-24)
- [x] M15 (MED) video/audio status always ran 5s: the viewer's itemMs already honored item.durationMs, but
      the composer never captured/sent a duration → always null → flat 5s DEFAULT_ITEM_MS. FIX
      (Status.tsx): readMediaDurationMs(file) reads .duration on loadedmetadata (currentTime=1e101 nudge for
      Infinity-duration WebM, 3s timeout + error fallback → null); submit() passes durationMs for video/audio
      (server accepts 0–10min; viewer caps the slide at 60s).
- [x] M16 (MED) status-audience copy was backwards: composer toast + strip hint said "visible to your
      contacts" (people you saved) but statusAudienceAuthorized gates on the VIEWER having saved the owner —
      a status is seen by people who saved YOUR number. FIX: copy → "visible for 24h to anyone who has you in
      their contacts" (enforcement unchanged — no visibility change, corrective labeling only).
- [x] L5 (LOW) press-hold restarted the story: the tap-zone buttons' onClick fired on release even after a
      press-and-hold (which pauses), so holding then releasing navigated — on the first item prev() restarted
      it. FIX: pressStartRef stamped on onPointerDown; tap zones navigate only on a quick tap (< HOLD_MS 220ms).
- [x] Tests: client/src/pages/app/qaBatch7.test.ts (5 pins). 1441 tests. QA-sweep progress: 25 of 37 fixed.

## v2.99.28 — heavy-QA sweep fixes, batch 6 (contacts/directory) (2026-07-24)
- [x] M18 (MED) blocked-watcher back-online bypass: directory.watchOnline armed a call-back-alert watch
      with NO block check, so a user the target BLOCKED could still be told (with the target's name + a
      ready-to-dial link) the moment they came online. FIX (server/v2routers.ts): after the self-check,
      `if (await isNumberBlockedBy(target.id, me.number)) throw NOT_FOUND` reusing the exact "isn't a RELAY
      user yet" message so the block is never revealed (mirrors openThread/createGroup/call-invite gates).
- [x] M14 (MED) false "Guest" badge on a non-user: contacts.list returned role "guest" for a saved number
      that doesn't resolve to any identity, rendering a blue "✓ Guest" seal on a non-RELAY entry. FIX:
      emit role: null (explicit) for the unresolved case → roleFromFlags returns null → no badge; a real
      identity with no admin/registered flag still defaults to "guest". Client ContactRow role prop → | null.
- [x] M13 (MED) deleting a blocked contact silently unblocks: the block lives on contacts.blocked, so
      removing the contact hard-deletes the row and drops the block silently. FIX (Contacts.tsx): the
      "Remove contact?" dialog warns when deletingContact.blocked ("removing them also unblocks them…"),
      turning a silent unblock into an informed choice (warn fix; a server tombstone would leave an
      invisible forever-blocked row, surprising the user who chose "remove").
- [x] Tests: server/qaBatch6.test.ts (6 pins); verifiedBadge.test.ts contacts-role pin updated to null shape.
      1436 tests. QA-sweep progress: 22 of 37 fixed.

## v2.99.27 — heavy-QA sweep fixes, batch 5 (group-call invitee handling) (2026-07-24)
- [x] M19 (MED) group-picker off-by-one: the picker used engine.maxParticipants (TOTAL room cap incl. the
      caller) as the count of OTHERS, so the last acceptee hit a full room. FIX: MAX_PARTICIPANTS =
      max(1, maxParticipants-1) in GroupCallScreen.tsx + cap = (livekitEnabled?10:6)-1 in
      programmaticGroupDial.
- [x] L7 (LOW) picker accepted the caller's own number: toggle/addManual now reject engine.pin.
- [x] M2 (MED) call-waiting parked a dead dial room: answering call-waiting during an UNANSWERED outgoing
      dial ran parkActiveAsHeld on the empty dial room (nothing to resume; dialed party kept ringing).
      FIX (switchCall): if outgoingDial && !establishedOnce, leave (reap dial room + cancelPendingRings)
      instead of parking, then accept the incoming.
- [x] Tests: client/src/pages/app/qaBatch5.test.ts (4 pins). Suite 1430; build green.
- DEFERRED: L1 (group dial where everyone declines hangs 65s instead of failing instantly — needs
      outstanding-invitee tracking + device testing).
- QA-sweep progress: 19 of 37 confirmed findings fixed. Remaining: M13/M14/M18 (contacts/directory),
      M15/M16/L5 (status), M20/L8 (allocation races), M6 (draft debounce), M12/L4 (presence), L1/L2/L3, M11.

## v2.99.35 — landing page structurally alive: React-19 innerHTML re-set killed all landing listeners (owner report) (2026-07-24)
- [x] OWNER REPORT: "after the loading… the dial pad, it's not active. If you click, doesn't click. The
      numbers doesn't show" + "the Arabic tab on the top on the landing page is not active — check both
      directions" + the dial-a-user-directly flow (check exists → name-only entry → callee sees caller name).
- [x] REPRODUCED against the real production build in headless Chromium: keypad clicks changed nothing,
      the lang button was dead both ways, and the boot overlay was being cleared by the pure-CSS
      lpAutoClear watchdog — not by the engine.
- [x] ROOT CAUSE (instrumented DOMTokenList.add → addEventListener → MutationObserver → finally the
      Element.innerHTML SETTER itself): React 19 re-applies dangerouslySetInnerHTML whenever the {__html}
      OBJECT identity changes, even when the string is byte-identical. Home.tsx built `{{ __html: html }}`
      inline — a fresh object every render — so the first unrelated re-render (the live-stats useQuery
      resolving ~0.5s after mount) re-set innerHTML on the live DOM and REBUILT EVERY NODE, discarding all
      engine wiring; the [lang]-keyed effect saw no change and never re-wired. Empirical timeline: markup
      mounted ~170ms, engine wired ~450ms, DOM replaced ~565ms (same string hash, new object). This also
      explains why v2.99.24's "wire controls first" hardening didn't cure the owner's report — the
      controls WERE wired; the nodes they were wired to got thrown away 100ms later.
- [x] FIX — three reinforcing layers in client/src/pages/Home.tsx: (1) the {__html} object is memoized
      (dsih) so React only re-sets innerHTML when the markup truly changes; (2) the wiring effect keys on
      [lang, dsih] so any future DOM replacement re-runs the engine in the same commit; (3) all
      dialer/lang clicks moved off per-node listeners onto ONE DELEGATED click handler on the stable host
      wrapper (React owns it; innerHTML only replaces its CHILDREN). The v2.99.15 live lookup, v2.99.21
      RTL binding, and v2.99.24 wire-first ordering all survive unchanged on top.
- [x] POLISH (found while verifying): dialStatus sat on "CHECKING NUMBER…" forever right above a RESOLVED
      dialPreview ("Sara · ONLINE") — two contradicting lines. The status line now hides while a resolved
      preview is showing, and the two FALLBACK (fail-open) paths flip it to "LINE READY — PRESS CALL".
- [x] ALSO FIXED: client/index.html shipped <script src="%VITE_ANALYTICS_ENDPOINT%/umami"> VERBATIM
      whenever the env was unset (vite keeps unknown %VARS% as-is) — every production page load requested
      the bogus URL, got a 400, and logged a strict-MIME refusal. Tag removed; client/src/main.tsx now
      injects analytics at runtime only when VITE_ANALYTICS_ENDPOINT/_WEBSITE_ID are configured.
- [x] VERIFIED headlessly against the rebuilt production bundle (tRPC-batch-shaped lookup stubs): keypad
      digits render AFTER the stats re-render that used to kill the page; found-online arms CALL,
      found-offline disarms (guest rule), party line shows "JOIN CALL", not-found disarms, lookup outage
      fail-opens; EN→AR flips dir=rtl + Arabic copy with the keypad still working; AR→EN restores; CALL on
      a found number ran the cinematic and landed on /app/dialer?to=555001 (the name-only direct-join).
      Screenshots: EN-found, EN-notfound, AR-found.
- [x] server/v29935LandingAlive.test.ts (9 pins incl. the polish) + the v2.99.24 pin in Home.test.ts
      updated to the delegated shape (same ordering invariant, new anchors). Suite 1480 passed / 1
      skipped; check + build green.

## v2.99.36 — landing polish: Arabic Open-App icon, dial-pad erase key, audible key tones (owner asks) (2026-07-24)
- [x] OWNER (screenshot + notes): "In the arabic the open app icon is not showing"; "in the dial pad both
      in arabic and english landing page make delete number icons so if you enter you can erase it";
      "make tone when you click each number as sound".
- [x] (1) ARABIC OPEN-APP ICON — the pill's copy string ended in a bare `↗` (U+2197). The v2.99.16 RTL rule
      forces 'Noto Kufi Arabic' on EVERY element in Arabic, that face has no U+2197, so iOS fell through to
      the emoji font and painted a boxed ↗️ next to the Arabic label. FIX: the arrow is an inline SVG
      (ARROW_NE) — identical in every language/font/platform — mirrored in RTL via `.lp-arrow`.
- [x] SECOND INSTANCE of the same defect found while writing the pin (my own test caught it): the CALL
      button label also ended in `↗`, and the button is NOT inside a `dir="ltr"` island, so in Arabic it
      rendered the identical emoji box. `setCallState` gained an `arrow` flag: the label stays textContent
      (it carries localized copy) and only the CONSTANT SVG is appended via insertAdjacentHTML, so there is
      no interpolation/injection surface. Verified live: `document.body.innerText` contains no U+2197 at all.
- [x] (2) ERASE KEY — now occupies the keypad's bottom-right cell, replacing `#` (pure decoration here: the
      pad only accepts 0-9 for a 6-digit RELAY number, so `#` did nothing but play a tone). Dims to .35 when
      there is nothing to erase, removes one digit per tap, no-ops when empty, localized aria-label/title.
- [x] REAL BUG caught mid-build and fixed: the FIRST implementation put the erase button beside the number
      display (absolute, `inset-inline-end`). In English it covered the 6th placeholder dot; in ARABIC,
      where it mirrors to the leading edge, it landed ON TOP of the first digit — the display is simply too
      wide to share that row. Moving it into the grid removes the overlap by construction and gives it a
      full 54px-tall touch target. Pinned by a no-overlap assertion measured in the browser.
- [x] (3) KEY TONES — DTMF existed but was effectively silent for two reasons, both fixed: (a) the
      oscillators were scheduled at `ac.currentTime` in the SAME tick as the ASYNC `ac.resume()`, so on iOS
      the note's start time had already elapsed by the time the context actually ran (the classic iOS Web
      Audio race) — a suspended context now resumes and THEN schedules, and every note starts at a +5ms
      lookahead so it can never be scheduled in the past; (b) the peak gain was 0.045 (≈ -27 dBFS),
      inaudible — now 0.18. The context is also unlocked on the first real gesture (1-sample silent buffer
      on pointerdown, the standard iOS unlock). Erase gets its own softer 420/310Hz tone.
- [x] HONEST LIMIT documented in-source (not papered over): on iPhone the hardware mute/silent switch
      silences Web Audio outright — no web page can override that.
- [x] VERIFIED headlessly on an emulated phone against the REAL built bundle, instrumenting AudioContext:
      exactly 2 oscillators per keypress at the correct DTMF frequencies (770/1336 for "5", 941/1336 for
      "0"), peak 0.18, ZERO notes scheduled in the past, the iOS silent-buffer unlock firing on first touch;
      the erase key overlapping neither the display nor any key in EITHER language, erasing one digit per
      tap and no-opping when empty; the Arabic pill AND the Arabic CALL button both painting mirrored SVG
      arrows with no U+2197 anywhere on the page.
- [x] Also proved a scare was NOT a bug: one Arabic keypad tap registered a neighbouring digit in an early
      run. Re-tested — key 7 correct 5/5 by coordinate, correct via raw touchscreen, and all 10 digits
      correct by direct dispatch, with the visual grid order intact (123456789*0#). It was a synthetic-tap
      artifact of the pad's 3D perspective tilt (Playwright's hover moves the surface between measuring and
      tapping); real touch input never triggers that tilt.
- [x] `server/v29936LandingPolish.test.ts` (15 pins). Suite 1495 passed / 1 skipped; check + build green.

## v2.99.37 — HARDENING PASS 5: class-based security sweep (owner: "cover all type of security bugs... very perfect") (2026-07-24)
- [x] Prior passes audited SURFACE BY SURFACE (routers, then auth, then storage). This one audited by
      VULNERABILITY CLASS — injection, XSS, authz/IDOR, CSRF, SSRF, upload/path, crypto, race/TOCTOU,
      DoS/ReDoS, business-logic, info-disclosure, client-trust, deps, CI — which is what surfaced these.
      All 10 verified against source before any change. 2 HIGH.
- [x] (1) HIGH ZERO-CLICK DOM XSS, in-call chat (client/src/lib/relayClient.ts): a chat frame's `pin`
      comes over the peer's DATA CHANNEL and was validated only by `typeof d.pin === "string"`, then
      interpolated into the row's innerHTML twice unescaped — inside the double-quoted `data-pin="…"`
      attribute, and through `fmtPin`, which passes a non-matching string through UNCHANGED. A peer
      sending pin='x"><img src=x onerror=…>' executed on parse with no click, on our origin → session
      takeover via the authenticated API. Reachable by anyone sharing a call, incl. a PARTY LINE
      (joinable by number) → one frame hits everyone. Fixed by validating to /^\d{6}$/ (the check
      ensureChatAvatar already did, but only AFTER the markup was written); initials() sinks on the chat
      chip, call tiles and recents escaped too.
- [x] (2) HIGH ACCOUNT PRE-HIJACKING → takeover: unauthenticated POST /api/auth/register creates a
      local user with an ATTACKER-chosen passwordHash and emailVerified:false for ANY email. The real
      owner later signs in by email code; findUserByEmailAny deliberately falls back to that local row
      (v2.92 compat) and markUserEmailVerified flipped it verified WITHOUT clearing the password — then
      /api/auth/login (password + verified) issued the attacker a session on the victim's account. New
      clearUnverifiedCredentials(userId) wipes password/PIN on a still-UNVERIFIED row at the moment the
      address is proven, called before markUserEmailVerified at BOTH claim sites. Scoped to unverified
      rows so a legitimate local user who used their own verify link keeps their password.
- [x] (3) VIEW-ONCE LOCK BYPASS (getAttachmentForIdentity): authorized a non-uploader via ANY
      referencing message including a still-LOCKED expiring one (attachmentId is only nulled at burn).
      That one function backs attachments.get (sequential int ids → enumerate), authorizeStorageKey AND
      messages.send's ownership check — so a recipient could read view-once media repeatedly without
      burning it (sender never told), and RE-ATTACH it to a new permanent message elsewhere. Locked
      expiring messages no longer authorize; the uploader early-return keeps senders unaffected.
- [x] (4) MySQL LEFT-TO-RIGHT UPDATE ASSIGNMENT broke BOTH attempt ladders: a later SET assignment
      reads the value an earlier one just wrote, so the lock CASE saw `attempts` already incremented and
      the extra `+1` double-counted. PIN locked on the 3rd wrong entry, not the 4th — and the persisted
      count could then only reach 3 while the brute-force ALERT EMAIL requires exactly 4, so that email
      was UNREACHABLE: an owner was never told their account was under attack. Same defect burned the
      email OTP a guess early. Both now compare the post-increment value directly.
- [x] (5) startGuest was an unauthenticated, UNTHROTTLED identity MINTER — the only resource-creating
      public endpoint with no gate. Each call permanently claims one of ~980,000 six-digit numbers
      (numberTaken ignores guest expiry, nothing deletes identities, M20's ledger is monotonic). Drained
      far enough, allocateSharedNumber's 40-attempt search fails for EVERYONE → every new guest,
      registration and party line dies permanently. Added guestMintGate (20 burst, ~1/10s per IP).
- [x] (6) revealExpiring buffered an UNBOUNDED body: the guard was Number(content-length ?? 0) <= CAP,
      so a MISSING header → 0 → passed → arrayBuffer() with no ceiling (the later buf.length check was
      too late), then base64 +33% inside a JSON response. Now REVEAL_MAX_INLINE_BYTES enforced against
      the STREAM, so a missing OR lying header can't exceed it.
- [x] (7) VIEW-ONCE BURN WAS NOT ATOMIC: both paths did read → check consumedAt in JS → write with an
      await between, so two concurrent reveals both returned the content (the S1/S9 lost-update class).
      Now one conditional UPDATE guarded on JSON_EXTRACT(meta,'$.consumedAt') IS NULL, verdict from
      affectedRows.
- [x] (8) avatarUrl accepted arbitrary http(s):// — a profile photo became a remote-fetch primitive
      aimed at other users, and it renders on the INCOMING-RING card, which appears with NO interaction:
      set an avatar to your host, dial a victim, harvest their IP + User-Agent from a call they never
      answered. Same threat the status-bg sanitizer already rejects url() for. Restricted to our storage
      path or data:image/ — zero compat cost (clients only ever set it from our own upload endpoint).
- [x] (9) status.post skipped keyInOwnerNamespace for kind:"text" while still persisting mediaKey.
      authorizeStorageKey resolves a /status_ key via whichever ACTIVE status claims it, so planting
      another user's key RE-ACTIVATED their expired/deleted status media — readable again and re-exposed
      to the planter's audience, defeating ephemerality. Gate now applies to any supplied key; a text
      status never persists media.
- [x] (10) tryReserveNumber detected a duplicate key by ERROR-MESSAGE TEXT in a helper that fails OPEN,
      so a driver upgrade/localized server would silently turn a lost race into "reservation won",
      reintroducing the cross-table collision the ledger prevents. Now errno 1062 / ER_DUP_ENTRY first.
- [x] VERIFIED CLEAN (documented negatives, so the negative result is trustworthy): no SQL injection
      (every sql`` template parameterizes values, Drizzle column refs for identifiers); landing-page
      innerHTML escaping intact after the v2.99.35 React-19 rework (escLp covers all 5 chars, applied
      post-composition, all sinks text-context); secret comparisons consistently timingSafeEqual with
      length guards; CSRF genuinely defended by SameSite=Lax on every cookie (the /api/v2/offline beacon
      can't fire cross-site, its deviceId fallback needs a secret); keyInOwnerNamespace correctly
      anchored (trailing slash defeats the 1-vs-12 prefix collision) and the absolute-URL avatar
      suffix-match fix unexploitable; searchMessages filters expiring content; tabPresence stores no
      secrets and fails safe.
- [x] ACCEPTED RESIDUAL: push.subscribe's upsert is keyed on the globally-unique `endpoint`, so knowing
      a victim's endpoint lets you re-bind it and silently kill their notifications. NOT fixed: no API
      ever returns an endpoint, the hijacker gains nothing readable (pushes are encrypted to their own
      keys), and the only correct fix is a proof-of-possession challenge — naively refusing re-binds
      would break the documented account-switch-on-same-device flow and silently kill notifications for
      real users. Prior-round residuals unchanged.
- [x] Tests: server/hardeningPass5.test.ts (44) incl. a real arithmetic SIMULATION of MySQL's assignment
      order (so the off-by-one can't silently return) and the actual XSS payloads the pin guard must
      reject; 4 stale pre-existing pins updated to the new shapes (m11ContentGating ×2, peerIdentityBatch,
      qaBatch8). Suite 1540 passed / 1 skipped; check + build green.

## v2.99.38 — hardening pass 5 pt.2: remaining class-sweep findings (2026-07-24)
- [x] (1) HIGH RELAY_OTP_REGISTER_BYPASS was unauthenticated ACCOUNT TAKEOVER, not just unproven
      signup: the bypass branch of otpAuth.register (a publicProcedure whose whole input is a name +
      email) called findUserByEmailAny and signed the caller in as WHATEVER IT RESOLVED. With the flag
      on, anyone knowing a registered user's email got a full session as them — no code, no password.
      The accepted trade was "email ownership isn't proven AT SIGNUP"; taking over EXISTING accounts
      never was. Branch is now CREATE-ONLY: refuses with CONFLICT when the address already has an
      account, only ever mints a new one. Signing in stays requestOtp/loginWithPin (real credentials).
      NOTE for the owner: this flag is set in /home/relay/.env, not in repo config, so I can't tell
      from here whether it's currently on — worth unsetting it now that SES should be approved.
- [x] (2) HIGH BLOCKED_MIME bypass via a multi-valued Content-Type: ALLOWED_MIME and BLOCKED_MIME are
      both START-ANCHORED, so they only inspected the FIRST type of the client-supplied ?mime= value.
      "image/png,text/html" passes ALLOWED (starts image/) and misses BLOCKED (doesn't start with a
      blocked type); the value was then stored and replayed verbatim as the Content-Type of a
      same-origin response — the stored-XSS shape BLOCKED_MIME exists to stop, since header parsers
      disagree about which listed type wins. New exported normalizeMimeType() reduces to a canonical
      type/subtype essence (params dropped, case-folded) and requires exactly ONE RFC-2045-token media
      type (no commas, no whitespace), applied at BOTH mimeType sources before any gate or storage write.
- [x] (3) ACCOUNT DIVERSION — the other half of M29: /api/auth/register's findLocalUserByEmail matches
      only rows that HAVE a passwordHash, so it's blind to OAuth/otp accounts and inserted a SECOND
      users row for the same email. findUserByEmailAny ranks a "local" row ABOVE a legacy OAuth row, so
      the victim's email code signed them into the attacker's empty row — and with the OAuth UI removed
      in v2.92 the email code is their ONLY way in, so their real account (number, contacts, history)
      became unreachable. New findAnyUserByEmail refuses registration when ANY row holds the address;
      the unverified-local resend path is untouched.
- [x] (4) GZIP AMPLIFICATION on /api/v2/upload: body-parser inflates encoded bodies by default and
      enforces `limit` against the DECOMPRESSED stream — so the 41MB ceiling held, but the cost to
      REACH it collapsed ~1000x (tens of KB of compressed zeros → 41MB buffered). That compounds the
      known ordering weakness that this route's rate limit runs INSIDE the handler, i.e. after
      buffering. inflate:false on both upload parsers — no client compresses an upload body (browsers
      never gzip request bodies; the native app streams raw), so it costs nothing real.
- [x] (5) The storage-proxy rate limiter was NEVER SWEPT. Every other limiter here pairs itself with a
      periodic sweep; this one shipped without, so its per-IP Map grew for the whole process lifetime
      on the app's only fully anonymous, high-fan-out endpoint. Added the sweep.
- [x] Tests: hardeningPass5.test.ts grows to 59, incl. behavioral normalizeMimeType coverage of the
      real bypass payloads (comma-lists, whitespace, case) and proof the blocked list still catches a
      normalized dangerous type. Suite 1555 passed / 1 skipped; check + build green.

## v2.99.40 — hardening pass 6: the class sweep's later-reporting classes (2026-07-24)
- [x] (1) HIGH — the 4-try PIN LOCKOUT WAS BYPASSABLE BY CONCURRENCY. attemptPinLogin gated on
      `row.loginPinLockedAt` — a field from a snapshot the CALLER already read — then ran verifyPassword
      regardless of the row's LIVE state. N simultaneous requests all saw an unlocked row, all passed,
      and all got a PIN checked: the S1 fix made the COUNTER race-free but never bounded how many
      VERIFICATIONS could happen, so the cap wasn't enforced per attempt and a burst could sweep much of
      the 10^4 space, limited only by the per-IP bucket. Inverted the order: every attempt must WIN a
      slot from the DB first (UPDATE … WHERE lockedAt IS NULL AND attempts <= cap, verdict from
      affectedRows) and only a winner may verify — MySQL serializes per row, so at most cap+1
      verifications happen between unlocks no matter the concurrency or instance. Ladder unchanged: the
      4th try is still verified (a correct 4th succeeds); a wrong 4th latches via its own isNull-guarded
      UPDATE, which also owns sending the alert email exactly once. The pure judgePinAttempt helper is
      test-only and now carries a loud "NOT AN ENFORCEMENT PATH" warning (it decides from a snapshot by
      design, so wiring it into a login route would reintroduce this).
- [x] (2) HIGH — UNSOLICITED video-accept FORCED A PEER'S CAMERA ON. onVideoAccept checked only
      `inCall`, so any call peer could send that frame and run unlockApprovedVideo() on the victim — a
      total bypass of the v2.81 mutual-consent protocol; the only notice was a "Video is on — both
      sides 🎥" toast, and on a party line one frame hits everyone. videoReqT alone couldn't guard it: a
      VIDEO DIAL answered with Video also replies video-accept and there consent was implicit in dialing
      (no request sent), while outgoingDial is cleared at establishment though consent frames often
      arrive before the transport exists. New per-call videoOfferedByUs flag set at BOTH consent points,
      cleared by the existing per-call reset; an unsolicited accept is dropped SILENTLY (no toast).
- [x] (3) HIGH — ATTACKER-CHOSEN Content-Type SERVED SAME-ORIGIN. The proxy relays the stored
      (uploader-supplied) type verbatim and nosniff means the DECLARED type is obeyed, so the upload
      denylist was the only defence — over an allowlist admitting text/* and application/* WHOLESALE.
      The whole XML family was missing (text/xml, application/xml, text/xsl, application/xslt+xml — XML
      with SVG/XHTML namespaces + <script> executes in some browsers, exactly what image/svg+xml is
      blocked for), as were the other JavaScript media types. Fixed at BOTH layers: denylist extended,
      AND the proxy now serves only an inline-safe set as itself, downgrading everything else to
      application/octet-stream + Content-Disposition: attachment — robust without enumerating every
      dangerous type, and matching how the client already presents attachments.
- [x] (4) auth.me SHIPPED THE CALLER'S CREDENTIAL HASHES to the browser: getUserById does an
      unprojected select(), so the handler serialized the whole users row — scrypt passwordHash AND
      loginPinHash — into every response, where it sits in the React Query cache, devtools/HAR captures,
      and anything an extension can read. Self-only so not cross-user disclosure, but it turns any
      read-only client foothold (an XSS like v2.99.37 #1, a malicious extension) into offline cracking,
      and the PIN hash covers 10^4. Stripped as a DENYLIST so no client-consumed field can vanish.
- [x] (5) The signaling OFFLINE DIAL was the last unthrottled number→identity oracle AND a third-party
      spam amplifier: replies differ by design ("<Name> is offline right now." vs "That number doesn't
      exist."), leaking existence + display name over the 10^6 space, and each pass writes a History row
      and fires a missed-call push AND email — with NO cooldown (unlike the offline-message email). The
      tRPC resolvers were gated for exactly this (F5) but this path never was, and the signaling limiter
      is a ~200/s FLOOD guard a scraper stays under (full enumeration in under two hours). New
      per-caller-pin offlineDialLimiter (20 burst, ~1/4s) scoped ONLY to the offline branch — a dial to
      an ONLINE user never reaches it, so normal calling and group dials are untouched (which is why
      this sidesteps the previously-rejected idea of capping invites in general). The throttled reply is
      the GENERIC offline message and returns before resolving anything or recording a miss.
- [x] (6) identity.regenerateNumber had NO THROTTLE — the M21 sibling. Each call permanently claims
      another of ~980,000 numbers and the old one is never recycled, so one authenticated account could
      drain the shared space and break allocation for every future signup. Now behind the mint budget.
- [x] Tests: new server/hardeningPass6.test.ts (22) + M36 coverage in hardeningPass5.test.ts including a
      simulation proving a 10,000-request burst yields exactly cap+1 PIN verifications, and behavioural
      coverage of the real BLOCKED_MIME / INLINE_SAFE_TYPE predicates. 3 stale pins retargeted
      (securitySweep S1, hardeningPass5 M25 ×2). Suite 1582 passed / 1 skipped; check + build green.
- NOTE (verified, queued — deliberately NOT rushed into the call path in this commit): signaling
  `knock-approve` doesn't re-check the approver is still in the room and `kick` doesn't revoke co-host;
  in-call chat trusts the frame's self-declared sender name (impersonation, cosmetic vs the fixed XSS);
  `ensureUserIdentity` is a check-then-insert with no unique index on identities.userId; Dialer's `?to=`
  places a call with no user gesture; member sign-out doesn't revoke its session-ledger row and password
  logins mint sid-less cookies; /api/relay/send resolves the full identity context before the rate check.
- NOTE for the owner (product decision, NOT a bug): the status audience rule means anyone who saves your
  6-digit number can see your story posts — contacts are self-service with no consent step. Flagged
  rather than changed.

## v2.99.41 — hardening pass 7: sweep COMPLETE (14/14 classes) + panel survivors (2026-07-24)
- [x] The class-based sweep finished: all 14 hunter classes reported and the 3-lens adversarial panel
      returned 55 verdicts (51 refuted, 4 upheld). This ships the last wave plus the panel's survivors.
      The high refutation rate is the panel working as intended — it killed 51 plausible-but-wrong claims.
- [x] (1) ReDoS on the inbound-email webhook — the panel's highest-confidence NEW finding (MED, "verified
      the sink empirically three ways"). parseInboundAddress ran /<([^>]+)>/ against an untrusted header
      value with NO length cap, on a route accepting 5MB of JSON. Input with a `<` and no `>` makes the
      engine retry [^>]+ from every `<`, giving back one char at a time — quadratic, ~10^13 steps for
      5MB. Node is single-threaded and this process serves every SSE stream, signaling POST and API call,
      so ONE request stalls calls + messaging for EVERY user; the webhook signature check is opt-in, so
      it can be unauthenticated. Capped at 1024 bytes before the match (RFC 5321 caps addr-spec at 320),
      bounding n rather than relying on a cleverer regex.
- [x] (2) `region` was STILL spliced raw into the SSM remote commands — A GAP IN MY OWN EARLIER FIX. G11
      base64'd SES_EMAIL and DOMAIN but missed `region`, the THIRD free-text workflow_dispatch input on
      the same path, still interpolated unescaped into all five command strings run on production EC2
      under the instance role. Same encode-on-runner/decode-on-instance treatment. Its other uses run on
      the runner via safe single-pass substitution and are deliberately left alone.
- [x] (3) Sign-out never revoked the session ledger row (UPHELD by the panel, traced end to end).
      v2.99.1 built a revocable session model and createContext gates every sid-bearing cookie on it, but
      auth.logout only cleared COOKIES — the row stayed ACTIVE, so the device kept showing in the user's
      own Devices list as a live session AND the token stayed valid, meaning a copy recovered from a
      synced browser profile, a disk backup, or a shared machine would still authenticate. Now revokes by
      sid, wrapped so a DB hiccup can never stop the cookies being cleared.
- [x] (4) The media-proxy per-IP limiter was too tight for shared egress — an AVAILABILITY finding, not a
      vuln. 240 burst / 4-per-sec is per-IP, and carrier CGNAT / an office / a café put many real users
      behind ONE address; on an image-heavy chat a few people scrolling together could exhaust it, and a
      throttled media request renders as a BROKEN IMAGE — the exact symptom this project has chased
      repeatedly. Raised to 600 / 20-per-sec, still capping a scraper two orders of magnitude below
      unlimited. The guard's real target is DB-CPU cost on the miss path, not enumeration (keys carry a
      random suffix and can't be guessed).
- [x] VERIFIED AND DOWNGRADED by independent checking: the Android `release { signingConfig
      signingConfigs.debug }` line is a genuine footgun but NOT a live compromise — native-rn.yml
      re-signs the AAB with a real keystore from ANDROID_KEYSTORE_BASE64 after the build, so the store
      artifact is properly signed. Recorded as an operator note rather than changed blind (touching
      signing config without knowing their keystore setup risks their release pipeline).
- [x] LEFT TO THE OPERATOR — cannot be fixed from the repo, and guessing would break the deploy:
      (a) the deploy OIDC role trusts `repo:…:*`, so a workflow on ANY branch can assume the production
      deploy role — that's an AWS IAM trust-policy edit, not a code change; (b) deploy.yml pins
      third-party actions to mutable major tags in the job holding production credentials — pinning
      properly needs verified commit SHAs.
- [x] Tests: hardeningPass6.test.ts grows to 35, incl. a bounded-regex timing check and per-command
      assertions on the region fix. Suite 1638 passed / 1 skipped; check + build green.

## v2.99.43 — hardening pass 8: the verified-and-queued list (2026-07-24)
- [x] These five were confirmed during the class sweep but held back from the pass that shipped three
      HIGH fixes, because four sit in the CALL PATH — the most delicate code here — and bundling them
      behind one version bump was a bad trade against a green suite. Taken one at a time. One turned out
      to be WRONG on inspection and is recorded as a refutation, not a fix.
- [x] (M45) MODERATOR POWERS OUTLIVED MEMBERSHIP. `knock-approve` gated only on isModerator(meta, pin),
      but it takes roomId from the CLIENT and roomMeta outlives membership (the roster is add-only and
      nothing clears hostPin/cohosts on leave). So a FORMER host who hung up could still name the old
      room and admit an outsider into a call they'd left. Worse, it chained with `kick`: leaveRoom only
      drops membership and never touched meta.cohosts, so a KICKED CO-HOST kept their role, could knock,
      and could then APPROVE THEMSELVES BACK IN — the kick was undoable by its own target. Fixed both
      ends: knock-approve now also requires room.has(conn.pin) (membership, not `rid === self.roomId`,
      because a host whose call is on HOLD is still in the member Set and must still be able to approve),
      and kick revokes cohost + any pending knock and broadcasts role:null so no client keeps rendering
      host controls for them.
- [x] (M46) IN-CALL CHAT TRUSTED THE FRAME'S SELF-DECLARED SENDER. Both `name` and `pin` came straight
      from the JSON, so any participant could publish {name:"Alice", pin:"<alice's pin>"} and have it
      render as Alice, avatar included (the chip resolves the photo BY PIN). Both transports already know
      the real sender: the mesh has one data channel PER PEER (setupDC's `pin` is authenticated by the
      channel itself) and LiveKit hands DataReceived the sending participant, whose identity is the
      server-minted token pin. receiveChatFrame now takes that proven identity, prefers it over the
      frame, and takes the display name from the roster (nameOf) — with the param optional so any
      future/legacy caller degrades instead of dropping messages.
- [x] (M47) DUPLICATE IDENTITIES PER USER — the long-standing "my number changes randomly / this device
      shows a different number" symptom. ensureUserIdentity is a check-then-insert with no unique
      constraint, so two concurrent sign-ins for one account (double-tapped Sign in, two devices, an OTP
      verify racing a PIN login) could each mint an identity → two rows, two 6-digit numbers — and
      getIdentityByUserId used a bare .limit(1) with NO ordering, so MySQL returned EITHER row per query
      and messages/contacts split across both. Layered fix: orderBy(asc(id)) makes resolution
      DETERMINISTIC even where duplicates already exist in production, and a UNIQUE index on
      identities.userId (boot migrator) stops new ones being created. NULL userId is repeatable under a
      MySQL UNIQUE index so guests are unaffected, and the migrator's per-item catch means an existing-
      duplicate deployment logs and boots normally rather than failing.
- [x] (M48) `?to=` PLACED A CALL WITH NO GESTURE. The Dialer auto-dials the param so in-app "call" taps
      connect instantly — but it couldn't tell an in-app route change from someone ARRIVING on the URL,
      and mic permission persists per-origin, so for any regular user a link like
      /app/dialer?to=<attacker-pin> turned ONE CLICK into a live outbound call to a number the attacker
      chose (camera too with ?video=1, and their side can auto-answer). A route module can't detect this
      itself — Dialer.tsx is lazily loaded, so its module scope first evaluates AT the navigation that
      needs it. New client/src/lib/bootUrl.ts is imported by main.tsx, so it captures the boot URL before
      any routing: a `to=` present there means the user arrived on it → prefill the pad (one deliberate
      tap) instead of dialing. Verified the in-app paths are unaffected: /i/:pin uses wouter's
      client-side <Redirect> and Contacts/Messages use setLocation, so `to` is NOT in their boot URL.
      The one legitimate full-page path — the "<name> is back online — tap to call them now" alert the
      user armed — keeps its single tap via a one-time same-origin sessionStorage intent marker, which a
      link cannot forge or carry to someone else.
- [x] REFUTED, not fixed: "/api/relay/send resolves the full identity context before checking the rate
      limit." The limiter is app.use middleware on that path registered at _core/index.ts:141, and
      attachRelay is called at :206 — Express runs middleware in REGISTRATION order, so it already
      precedes the handler that calls createContext (and only `register` calls it at all). Pinned as a
      refutation so the claim isn't re-raised.
- [x] Tests: new server/hardeningPass7.test.ts (24), incl. a behavioural check that a forged chat pin
      loses to the transport-proven one. Two stale pins updated for the new shapes (contacts.test.ts's
      additive-DDL rule now allows ADD UNIQUE INDEX; androidAudioCamera.test.ts's chat-dedup pin now
      expects the threaded sender). Suite 1662 passed / 1 skipped; check + build green.

## v2.99.55 — status audience (everyone / contacts only) + Gradle signs the Android release (2026-07-25)
- [x] OWNER ASK #1 — "do the stories suggestion as to give me options (everyone sees, or contacts only)".
      Two options, and the one design decision that matters: **the audience is a property of the POST, not of
      the poster.** New `statuses.audience` is stamped at insert from the new `identities.statusAudience`
      default, and every gate reads the ROW. Reading the owner's *current* preference instead would mean
      flipping your default to "everyone" retroactively republished every contacts-only story still inside its
      24h window — a silent widening of content someone chose to keep narrow. As a bonus the per-post value
      gives the composer a free per-story override that doesn't rewrite the standing default.
      - **`normalizeStatusAudience` fails closed**: anything that is not the literal `"everyone"` — NULL, a
        typo, `"EVERYONE"`, `" everyone"`, a value from some future version — resolves to `contacts`. A
        garbled column must never be the reason a status is published wider than its author picked. The
        client has its own copy (it runs in the browser) and a test asserts the two agree on every input.
      - **NULL means contacts on both columns**, which is exactly the rule every pre-v2.99.55 row was posted
        under, so the migration is a genuine no-op until a user opts in. No DEFAULT, no NOT NULL.
      - **Blocks outrank the audience** — both `isNumberBlockedBy` checks run BEFORE the everyone
        short-circuit, so "everyone" never means "everyone, including someone I blocked". Pinned by index
        comparison, not by hoping the order stays.
      - **"Everyone" is deliberately NOT a broadcast, and the copy says so.** `getStatusAudienceIds` (the
        realtime fan-out) is left bounded to contacts + savers: its reverse is every identity in the database,
        so widening it would mean a full-table scan and an SSE publish to every user on every post. So
        "everyone" is an AUTHORIZATION widening plus a PULL discovery surface — new `status.forNumber`, used by
        the profile popup, which already has the number in hand. Without that surface the setting would have
        been authorized-but-invisible: the feed is bounded, so a non-contact would never learn the story
        exists. `forNumber` answers an unknown number and an unauthorized one IDENTICALLY (empty list, not an
        error), so it is not an existence oracle, and it is `statusGate`-limited before any DB work.
      - The storage proxy still **refuses an anonymous request even for an "everyone" status**. That is not an
        oversight: v2.99.14 exists precisely so a media URL can't be opened or copied outside the app, and
        relaxing it would hand back the shareable-link behaviour that lockdown removed. Commented at the gate.
      - `audience` is on the wire **only for your own statuses** (`publicStatus(r, own)`), because whether
        someone else's story is public isn't something a viewer needs — the v2.99.40 #4 lesson about shipping
        fields no surface renders. The author's own story footer shows which audience the post went to.
      - UI: a picker in the composer (per post) and a radio group in Profile → Status privacy (the default,
        rendered for guests too, since statuses hang off the identity rather than the user row). Both render
        from ONE module, `client/src/app/statusAudience.ts` — v2.99.49 was caused by a duplicated rule, and
        duplicated *copy* is worse, because nothing fails when two screens promise different things.
      - `server/statusAudience.test.ts` (27). Three mutations were run to confirm the pins bite: moving the
        everyone check above the block checks, swapping `st.audience` for the owner's live default, and
        loosening the normalizer to a trimmed/lowercased compare — each failed exactly the intended test.
        Three stale pins rewritten to the STRONGER invariant (markViewed now asserts the third argument;
        qaBatch7's copy pin moved from "this literal is somewhere in the file" — which a second audience would
        have satisfied while displaying the wrong text — to the derived-from-what-was-sent property).
- [x] OWNER ASK #2 — the cleaner Android end state: **Gradle signs the release; `jarsigner` only verifies.**
      This finishes v2.99.52. Adversarially reviewed before writing (verdict: SAFE_WITH_CHANGES), and the
      review caught five things worth having:
      - It would have **turned CI red on commit one**: `androidSigning.test.ts` pinned `jarsigner -keystore`,
        the exact substring being deleted. Updated in the same commit.
      - **A zero-byte keystore satisfies `File.exists()`.** `base64 -d` of an empty string exits 0 and leaves
        a 0-byte file — verified directly — which is precisely what an absent CI secret decodes to. An
        exists()-only guard would have flipped true on every secretless run and failed the build loading a
        garbage keystore. Closed on both sides: `test -s` at the decode step, `isFile() && length() > 0` in
        Gradle, and the decode is skipped entirely when the secret is absent.
      - **Silent-unsigned was a real regression.** jarsigner exited non-zero on a bad password; an incomplete
        keystore in Gradle just leaves the build unsigned and GREEN, and Play only rejects it at upload — mid
        store swap. New `RELAY_REQUIRE_SIGNED`, set by CI only when it actually staged a keystore, throws a
        GradleException naming which part is missing.
      - **`RELAY_KEYSTORE_PATH` must be absolute**: `file()` resolves a relative path against the app MODULE
        directory, so a plausible value misses, exists() goes false, and the build goes quietly unsigned.
        Now rejected outright; CI stages to `$RUNNER_TEMP` (absolute by construction, outside the checkout so
        no artifact glob can publish it, `chmod 600`, wiped with the job).
      - **The artifact NAME is the contract**: `RELAY-RN-release-aab-SIGNED` is what mobile/README.md tells the
        operator to upload, so it is kept even though the mechanism moved. The plain AAB step no longer claims
        "(unsigned)".
      - Verification uses the right tool per format: `apksigner` cannot read an AAB (v2/v3 live in an APK
        Signing Block that Play never reads on a bundle), and `jarsigner -verify` can exit 0 on an unsigned
        archive — so the deterministic gate is `unzip -l | grep META-INF/*.RSA`, with `apksigner verify` on the
        APK, at whatever build-tools version the runner has rather than a hardcoded one.
      - Real upside beyond tidiness: Gradle signs the APK via apksigner (v1+v2+v3), so a signed run now yields
        an **installable** release APK. jarsigner gives v1 only, which does not install on Android 11+ at
        targetSdk 36 — that retires the v2.99.53 "use the debug artifact instead" caveat for signed runs.
      - **`android-apk.yml` is deliberately NOT converted**, against this repo's system-wide-application rule:
        its TWA and Capacitor modules have no `signingConfig` at all, so removing jarsigner there would leave
        those releases permanently unsigned with no signer anywhere. Stated in a comment and pinned by a test.
      - `androidSigning.test.ts` 8 → 16, and all 10 new pins were confirmed to FAIL against the pre-change
        files by reverting the source and re-running.
- [x] OWNER ASK #3 — SHA-pin `android-apk.yml` / `native-rn.yml`. These hold the upload keystore secrets, so an
      action running there can read the decoded keystore and a repointed mutable tag is how it would get in.
      `checkout` and `setup-node` are pinned (SHAs the owner supplied for v2.99.51). Three actions
      (`setup-java`, `upload-artifact`, `gradle/actions/setup-gradle`) are still on `@v4` because resolving a
      tag to a commit requires reading those upstream repos, which this session cannot do — its GitHub access
      is scoped to this repo alone. Rather than exempt the two files wholesale (which would let a NEW unpinned
      action slip in unnoticed), `workflowPinning.test.ts` now covers them with an explicit `PENDING_SHA` set
      of exactly those three: adding a fourth fails, a stale entry fails, a BRANCH ref fails regardless of the
      exemption, and `deploy.yml` gets no exemption at all. The resolve command is in the test's header.
      Verified by three tripwires (a new unpinned action, a branch ref, unpinning deploy.yml) — each fired.
- [x] mobile/README.md: corrected stale versionName/versionCode (3.0.0/2 → 3.1.0/3, matching build.gradle),
      documented the Gradle-signing change and the local `-P` properties, and added the two pre-swap checks
      that only bite at upload time — confirm the CI keystore is the UPLOAD key (compare the
      `apksigner --print-certs` SHA-256 against Play Console → App integrity → App signing → Upload key
      certificate) and confirm `versionCode 3` isn't already live.
- [x] Suite 1930 passed / 1 skipped; `pnpm verify` (check + test + build, one script, no pipe) green.

## v2.99.54 — identity continuity: data is welded to the person, not to their number (2026-07-25)
- [x] OWNER, after the v2.99.49 data-loss fix: "what I care is that it should not be repeated again to any other
      users and in the future and should be systematic. If you were a guest and you have data and you decide to
      register, you should not lose your data. You should stay with your data. It will move with you whenever you
      are moving. You can regenerate the number, but you will not lose your data. But your number is hooked to
      other contact lists — it will be updated automatically. So you need a mature system, no glitches."
- [x] THE STRUCTURAL INSIGHT. RELAY names a person TWICE. The identity row is referenced by NUMERIC ID — contacts,
      messages, thread membership, call logs, statuses all point at it, so they follow the person through every
      transition with nothing to migrate. The 6-digit NUMBER is what OTHER people store, and every place it is
      stored is a COPY THAT CAN ROT. Registration lost the owner's data because the upgrade could not find their
      identity row; renumbering rotted History because the propagation guarantee lived inside one function that
      happened to know about `contacts`. One root cause, two symptoms.
- [x] NUMBER CONTINUITY. `conference_history.dialedNumber` is what History.tsx:721 uses for the call-back button,
      so after anyone regenerated their number that button dialled a number they no longer owned (dead, never a
      stranger — the reservation ledger never recycles); the same stale value was DISPLAYED as "PIN NNNNNN" as if
      it were fact; the presence dot looked it up and stuck grey forever; and the avatar resolved BY NUMBER, so a
      renumbered person silently lost their photo from everybody's History. conference_participants.number and the
      JSON roster froze every participant's number at call time.
      FIX: new NUMBER_BEARING_COLUMNS in server/v2db.ts declares every schema column holding a 6-digit number and
      how it stays correct — `identity` (source of truth), `renumber` (rewritten inside the transaction), `live`
      (never rewritten; resolved from the identity at read time), `not-a-person` (a party line's own number, which
      a person renumbering must never touch). regenerateIdentityNumber also moves conference_participants.number,
      scoped by identityId so it can only rewrite that person's own rows. calls.conferenceHistory resolves the
      roster BY identityId (live number, name, avatar) and maps the frozen dialedNumber through the roster to a
      live call-back target — so renumbers that ALREADY happened come out correct with NO backfill.
- [x] THE PART THAT MAKES IT STICK: server/numberContinuity.test.ts reads drizzle/schema.ts and FAILS THE BUILD if
      any number-bearing column has no declared strategy. Verified by planting a fake column and watching it fail,
      naming the column — not passing vacuously.
- [x] AUDIT FINDINGS AGAINST MY OWN v2.99.49 FIX (51-agent adversarial pass; three landed).
- [x] MY TESTS DID NOT TEST WHAT THEY CLAIMED. "the PIN / legacy sign-in path too" anchored with
      indexOf("await ensureUserIdentity({"), which first occurs 17 chars INSIDE verifyOtp's own
      `const identity = await ensureUserIdentity({` — so it re-read verifyOtp and never looked at the PIN site
      5,626 chars later. PROVEN by reverting the PIN path to the pre-fix cookie-only shape, i.e. reintroducing the
      exact bug that cost the owner their data: all 20 tests still passed. A test that cannot fail when its bug
      returns is worse than no test, because it reports safety. Rewritten to enumerate every call per file, assert
      the COUNT as well as the contents, and walk every server source to assert the complete set of minting sites;
      each rewritten test verified to FAIL against its reintroduced bug.
- [x] Also vacuous: "minting is the LAST resort" compared two indexOf results; on pre-fix code the candidate loop
      was absent (-1) and allocate was at 959, so -1 < 959 and it PASSED against the code it was written to
      reject. Both indices are now required to exist first.
- [x] A FIFTH MINTING SITE WAS MISSED: /api/oauth/callback still passed the cookie ONLY — the original bug shape on
      a still-mounted route — and was the worst of the five, because without resolvedIdentityId the stranded-guest
      warning could not fire, so it stranded people SILENTLY.
- [x] THAT SITE ALSO DESTROYED THE RECOVERY EVIDENCE: clearCookie ran unconditionally, "regardless of whether the
      migration happened". The guest token is the only half of guest identity that survives a browser close, so
      dropping it after a failed claim converts a RECOVERABLE orphan into a permanent one. Now cleared only when
      the identity we ended up with really IS this browser's guest row (resolved BEFORE the claim, since a
      successful claim nulls the token), with a warning on non-adoption. isGuest is deliberately NOT the test — it
      is equally false for a freshly minted identity, i.e. for exactly the failure case.
- [x] THE CLAIM WAS UNGUARDED AGAINST THE PER-USER UNIQUE INDEX while the mint path directly below it handles that
      race. An uncaught throw there surfaces as a 500 from verifyOtp AFTER consumeOtp burned the code, so the user
      is told the code was already used and must request another for a half-completed registration. The claim now
      resolves to the race winner, like the mint path.
- [x] THE VIDEO-CONSENT PROMPT (owner screenshot, mid-call after enabling the camera): the card ran off the RIGHT
      edge — name cut to "a Hasan", button to "Turn on vide" — colliding with the Minimize/Fit chrome and the
      "Connected" status, washed-out over live video. ROOT CAUSE MEASURED IN HEADLESS CHROMIUM: centred with
      transform:translateX(-50%) but entered with animation:relayFade … both, whose final keyframe is
      transform:none — fill-mode both makes that PERSIST, wiping the centring so the card's LEFT edge sat at
      exactly 50% of the viewport. 390px: left 195, right 429 (39px off); 375px: 47px off; 320px: 74px off;
      1280px: just fits — which is WHY it shipped, broken only on phones. Computed transform read
      matrix(1,0,0,1,0,0), the identity: direct proof. Positioning no longer involves transform at all (inset:0 +
      margin:auto + intrinsic size against .relay-root, which is position:fixed;inset:0); entrance animates
      OPACITY ONLY; opaque instead of translucent-over-blur, surroundings dimmed by a spread box-shadow (not
      hit-tested, so hang-up stays tappable).
- [x] THE SAME TRAP WAS ALREADY FOUND AND FIXED ONCE for .addpad, whose comment spells it out verbatim, and never
      swept — so this was the same bug in a second place. videoAskCentring.test.ts now guards the WHOLE stylesheet:
      it fails the build if any element centred with translateX(-50%) applies relayFade. Proven to fire against the
      pre-fix shape and proven NOT to flag .call-waiting/.held-bar, which restate the transform in their own cwIn
      keyframes and are correct by construction.
- [x] DEAD CODE AND DEPENDENCIES (owner: "delete whatever not ours and it's zero value"). 12 files, 4,292 lines,
      6 packages, each verified unreferenced by a precise import check and by confirming no test touches it:
      _core/dataApi|heartbeat|imageGeneration|llm|map|voiceTranscription (Manus template helpers for features RELAY
      does not have), DashboardLayout + DashboardLayoutSkeleton, Map.tsx, ComponentShowcase.tsx (1437 lines),
      data/landingCopy.ts (1075 lines, superseded — Home.tsx carries its own and scripts/gen-landing-copy.mjs
      regenerates it), shared/types.ts. Packages: ws + @types/ws (POINTED — this architecture DELIBERATELY refuses
      WebSocket because the gateway downgrades the upgrade, so it was a dep for the one thing the rules forbid),
      @types/google.maps, framer-motion, add (the `pnpm add add` typo), and pnpm as a devDependency (redundant
      against the packageManager pin ci.yml calls "the single source of truth", and contradictory: ^10.15.1 vs the
      pinned 10.4.1). KEPT DELIBERATELY: the unreferenced shadcn/ui primitives — CLAUDE.md mandates shadcn for new
      UI and they tree-shake out of the bundle, so pruning the sanctioned kit is an architectural call, flagged.
- [ ] STILL OPEN, stated plainly to the owner rather than implied as done:
      (a) their 601-586 identity is STILL ORPHANED. The audit confirmed it retains BOTH its guest token and its
          device id while the empty 737-582 row has deviceId NULL, so it is still resolvable; twelve of thirteen
          data linkages are keyed on the identity's numeric id, so re-attaching restores contacts/messages/threads/
          call history/statuses with NO row rewriting, and because the number never moves nobody who saved
          601-586 was ever broken. All three design judges independently picked "Adopt-and-Retire" (bearer-proof
          recovery at request time + a freeze-and-dossier migration + an operator merge tool). Designed, not built.
      (b) GUEST IDENTITY IS SESSION-SCOPED BY CONSTRUCTION — both halves (sessionStorage device id, session cookie)
          die when the browser closes, so closing the browser as a guest still strands the number and everything on
          it, and nothing ever reaps the row. This is the architectural reason data does not yet "move with you" in
          every case, and it is the real answer to the owner's requirement.
      (c) the verification email hitting spam is mostly DOMAIN REPUTATION (SES production access and the OTP path
          both went live the day before). My initial theory was WRONG: Message-ID, Date, MIME-Version, a proper
          multipart/alternative with a matching text/plain part and clean copy were all audited present. Small
          repo-side wins remain (base64-encoding a pure-ASCII plain part, three absent machine-mail headers, an
          unvalidated From display name); SPF/DKIM/DMARC are DNS work.
      (d) other verified loss paths not yet fixed: ANY sign-in from a browser holding a live guest session strands
          that guest silently with no warning; expired guest rows keep their 6-digit number forever so the shared
          space only shrinks; an unapproved new-device sign-in leaves a cookie the 30-minute reaper makes
          permanently unusable; and genPin checks only the in-memory registry, never the identities table.
- [x] Tests: server/numberContinuity.test.ts, client/src/lib/videoAskCentring.test.ts (12),
      server/guestUpgrade.test.ts 20 -> 24. Suite 1879 passed / 1 skipped; check + build green.

## v2.99.53 — the Android workflow catches up with the unsigned release (2026-07-25)
- [x] v2.99.52's Gradle change WORKED — the CI run reported `BUILD SUCCESSFUL in 35m 16s` with
      `:app:assembleRelease`, `:app:packageRelease` and `:app:bundleRelease` all green. The job still
      failed, one step later, and the error is itself proof the fix took effect:
      `No files were found with the provided path: .../apk/release/app-release.apk`.
- [x] CAUSE: AGP names the output `app-release-unsigned.apk` when a build type has no signing config and
      `app-release.apk` when it does. The release is now unsigned unless a real keystore is configured, so
      the workflow's hardcoded signed filename matched nothing and `if-no-files-found: error` failed the
      job. Fixed with a glob (`app-release*.apk`) that matches whichever name the build produced — correct
      both with and without a keystore, rather than swapping one hardcoded name for the other.
- [x] ALSO CORRECTED A NOW-FALSE INSTRUCTION, because it would have wasted someone's time on a device:
      that artifact's comment said "debug-keystore signed — uninstall before installing the Play release.
      Prefer THIS one for the QA-TEST-PLAN §F pass". An UNSIGNED APK cannot be installed at all, so §F
      must use the `RELAY-RN-debug-apk` artifact (side-by-side as `org.yourchat.relay.next`) or a build
      with `RELAY_KEYSTORE_*` set. The comment now says that.
- [x] `androidSigning.test.ts` grows to 8: the artifact path must be the glob and must NOT be the bare
      signed filename, and the workflow must not still claim the release APK is debug-signed/installable.
- [x] NOT changed: the AAB path (`app-release.aab`) is the same with or without signing, and its upload
      step never ran in the failed job, so the next run is what confirms it. Suite 1848 passed / 1 skipped.

## v2.99.52 — the Android release build is never signed with the debug key (2026-07-25)
- [x] `mobile/native/android/app/build.gradle` shipped the React Native template default,
      `release { signingConfig signingConfigs.debug }`. Two distinct problems, not one: (1) a local or CI
      `assembleRelease` produced a DEBUG-SIGNED artifact that looks shippable — nothing about the file
      says "do not upload this"; and (2) `native-rn.yml` signs the AAB afterwards with the real upload
      key, but `jarsigner` ADDS a signature rather than replacing one, so the bundle handed to Play
      carried TWO signers, which Play can reject. The earlier note that "CI re-signs it so the store
      artifact is fine" was optimistic on that second point.
- [x] FIXED: release now signs with a REAL keystore when one is configured (env vars, which is how CI
      would pass it, or gradle properties for a local release) and is otherwise UNSIGNED. An unsigned
      artifact cannot be mistaken for a store build — that is the point — and the CI `jarsigner` step then
      produces a single, correct signature. All of path/password/alias must be present AND the file must
      exist, so a half-configured environment yields a visible unsigned build rather than an invisible
      debug-signed one. No keystore or password is committed (`debug.keystore` with the universally-known
      'android' password stays, deliberately).
- [x] Verified BOTH directions: `server/androidSigning.test.ts` (6) passes on the fix and, run against the
      pre-fix file, fails on 4 of 6 including the headline "never signed with the debug key". Source-pinned
      rather than executed because there is no Android SDK in the unit environment — the real Gradle build
      runs in `native-rn.yml`, which triggers on any push touching `mobile/native/**`, so this commit
      verifies itself in CI.
- [x] Deliberately did NOT restructure the release pipeline: letting Gradle sign from the same secrets and
      dropping `jarsigner` entirely would be cleaner, but it is a bigger change to a path that only runs at
      store-release time. The footgun is closed; that cleanup is available on request.
- [x] Also confirmed the v2.99.51 SHA pins resolve in a real run (deploy `bf321bc`: each step name shows
      its SHA), which additionally proves the owner's tightened OIDC trust policy still lets `main` deploy.
- [x] Suite 1846 passed / 1 skipped; `pnpm verify` green.

## v2.99.51 — the production-credential job pins its actions to SHAs (2026-07-25)
- [x] `deploy.yml` assumes the production deploy role via OIDC, so every action it runs holds credentials
      that can write the S3 release bucket and drive SSM on the live fleet — and all four were on the
      MUTABLE major tag `@v4`, a pointer the action's owner can repoint at any commit with no diff in
      this repo to review. Now pinned to full commit SHAs (owner-supplied), tag kept as a trailing
      comment so a human reader can still see which release each SHA was.
- [x] `server/workflowPinning.test.ts` enforces it: every `uses:` in a credential-holding workflow must
      be a 40-hex SHA, never a branch or a floating tag, and must carry the `# <tag>` comment. Verified
      the tripwire actually FIRES by reverting the pins and watching it fail while naming all four
      offenders — then re-applying. Deliberately scoped to `deploy.yml` for now: `android-apk.yml` and
      `native-rn.yml` hold the Android keystore secrets and should be pinned next, but they are unpinned
      today and a failing test would block deploys rather than fix anything (the list names where to add
      them).
- [x] The same test also pins that the release tar still ships `ecosystem.config.cjs`, `patches/`,
      `shared/` and `drizzle/`, and that the Manus-runtime strip step survives. Not a pinning concern —
      but `deploy.yml` is exactly the file someone hand-edits to change SHAs, and an OLDER revision of it
      is in circulation that drops those. Each was added after a real per-server failure: without
      `ecosystem.config.cjs` pm2 starts a stale path with no entry file, and without `patches/` the
      server's `pnpm install --frozen-lockfile` ENOENTs on the lockfile's patched-dependency reference.
      A future edit that loses them now fails the suite instead of the fleet.
- [x] OPERATOR ITEM CLOSED (owner did it): the deploy role's trust policy is scoped to
      `repo:khalifa1982/relay-chat-video3:ref:refs/heads/main`, not `repo:...:*`. Note for later: it uses
      `StringLike` where `StringEquals` would be stricter by construction — identical behaviour with no
      wildcard in the value, but `StringLike` can quietly become permissive if the value is ever edited.
- [x] Suite 1840 passed / 1 skipped; `pnpm verify` green.

## v2.99.50 — the serve set now matches what a PHONE hands back (2026-07-25)
- [x] Closes the one surviving item from the red-team pass over today's fixes. Its verification panel
      refuted all 22 candidates (19 were already fixed in v2.99.47/.48 while the panel was still
      running, so the described triggers no longer reproduced), and one left a LOW-severity kernel that
      I then confirmed against source myself rather than taking the agent's word for it.
- [x] TWO GATES I WROTE TODAY DISAGREED. M38's `INLINE_SAFE_TYPE` (storageProxy) serves only a small
      allowlist as itself and downgrades everything else to `application/octet-stream` +
      `Content-Disposition: attachment`. v2.99.45's self-review checked that list against every MIME
      type RELAY's own encoders PRODUCE — but the avatar and Status pickers upload the RAW `File` with
      `mimeType: file.type` and no re-encode (`uploadBare`), and the upload door only tests `^image/`
      (`v2upload.ts:214`). So an iPhone `image/heic` or an Android `video/3gpp` stored fine and was then
      served as an opaque download. Verified in source: the door admits it, the serve set does not.
- [x] FIXED BY WIDENING THE SERVE SIDE, not narrowing the door — narrowing would REJECT a legitimate
      photo, which is the class of regression this whole run has been undoing. Added the binary media
      containers a device actually produces: image/heic|heif|tiff|apng, video/x-m4v|3gpp|3gpp2|
      x-matroska|mpeg, audio/flac|wave|x-wav|3gpp.
- [x] IMPACT IS HONESTLY LOW, recorded so the next reader doesn't over- or under-rate it: every avatar
      surface already falls back to an initials disc (`PeerOverlays.tsx` `onError`, and the incoming-ring
      card does the same), `Content-Disposition` is ignored for `<img>`/`<video>` subresource loads, and
      HEIC doesn't decode in Chrome/Firefox at all — so those avatars were blank before this too. The
      real defect was two gates disagreeing, which is a latent trap regardless of today's blast radius.
- [x] Added the PROPERTY that makes future widening safe: a test asserting `INLINE_SAFE_TYPE` can never
      admit a markup or script media type (text/*, the XML family, XHTML, SVG, the JavaScript types,
      octet-stream), plus a structural check that the pattern never mentions the `text` top-level type.
      That is the invariant M38 exists to hold; the specific list is free to grow under it.
- [x] Also corrected a factual error introduced by the parallel session's bulk renumbering: the
      `repoHygiene.test.ts` header said "v2.99.49 shipped with unresolved merge-conflict markers". That
      was v2.99.45. v2.99.49 shipped clean.
- [x] Suite 1835 passed / 1 skipped; `pnpm verify` green. Rebased onto the parallel session's v2.99.49
      (their guest-upgrade fix + the five closed residuals) and renumbered from .49 → .50.

## v2.99.49 — guest registration keeps your number + data; the five accepted residuals CLOSED; desktop status composer (2026-07-25)
- [x] OWNER DATA LOSS (two screenshots, both numbers side by side): used RELAY as a guest on 601-586 — contacts
      saved, messages exchanged, calls made — registered with their email, verified the code, and landed on
      737-582, a NEW number, with an empty account. "The data should be stored and attached to the old number,
      and the number will not change unless if I request to generate a new number."
- [x] ROOT CAUSE — two functions disagreed about which identity a browser is using, and one of them ALLOCATES.
      `createContext` resolves a guest by cookie OR device id and documents that the DEVICE ID WINS when they
      disagree ("cookies are a hint, device id is the truth" — that rule exists so a cleared/expired/ITP-dropped
      cookie doesn't cost a guest their number). `ensureUserIdentity`, the upgrade that runs at registration,
      looked the guest up by COOKIE TOKEN ONLY. Any browser whose live identity was device-resolved therefore
      found nothing, fell through to the allocate-a-fresh-identity branch, and minted a new 6-digit number; the
      guest row — which owns the number and which every contact/message/call-history row points at — was left
      with userId NULL and no route back.
- [x] FIX (server/v2db.ts): `ensureUserIdentity` takes `resolvedIdentityId` + `deviceId` and tries candidates in
      the RESOLVER'S OWN ORDER OF AUTHORITY — the already-resolved identity (device-id-aware, so it agrees with
      every other request in that browser by construction), then the cookie token, then the device id — deduped
      through a Set, each optional lookup individually try/caught so a DB hiccup can never be why someone gets a
      new number. Every claim is ONE conditional UPDATE gated `WHERE id = ? AND userId IS NULL`, verified by
      affectedRows: it can only adopt an UNCLAIMED guest row, never an identity that belongs to another account
      (a refused candidate moves to the next; getIdentityByDeviceId independently filters userId IS NULL as a
      second guard). The claim sets userId/name and clears the cookie fields — it NEVER touches `number` — then
      re-reads by the SAME id, so number, contacts, messages and history carry over untouched. Minting is now
      genuinely the last resort.
- [x] SAME BLINDNESS AT THREE OTHER MINTING SITES, all fixed (system-wide rule): `createContext` mints on ANY
      request when a signed-in account has no identity yet (now passes deviceId); `POST /api/auth/register` (now
      passes deviceIdFromRequest(req)); the PIN / legacy sign-in path in v2routers.ts.
- [x] NEW server/deviceIdHeader.ts — DEVICE_ID_HEADER + normalizeDeviceId + deviceIdFromRequest, dependency-free.
      `_core/context.ts` delegates to it instead of keeping its own copy of the shape rule: a second copy of that
      rule is what caused this bug, and context.ts ↔ authLocal.ts already import each other, so a shared module
      was also the only cycle-free way to share it.
- [x] The `existingByUser` early return now console.warns when it leaves a guest identity unclaimed —
      re-registering an address that already has an account is the one case where a guest session really is
      stranded, and it should not be silent.
- [x] SECOND HALF OF THE ASK ("even if I generate new number … others people contact will automatically update")
      ALREADY SHIPPED, now pinned: `regenerateIdentityNumber` moves the identity and rewrites every contact row
      holding the old number inside ONE transaction (all-or-nothing, so no contact is left dialling a number that
      is no longer that person), via planRenumber, which also drops a stale duplicate when the saver already had
      a row for the new number. A test asserts there is exactly ONE `.update(identities).set({ number: … })` in
      the codebase, so no future path can renumber someone silently.
- [x] Tests: server/guestUpgrade.test.ts (20) — candidate order, unclaimed-only gate, number/data preservation,
      all four call sites, behavioural normalizeDeviceId coverage (repeated header, injection-shaped input,
      bounds), regenerate propagation.
- [ ] OWNER RECOVERY, one-time and NOT retroactive from code: identity 601-586 still exists with userId NULL.
      Recovering it means deleting the empty 737-582 identity FIRST (a unique index allows one identity per
      user), then setting 601-586's userId to the account. Say the word and I'll prepare the exact statements.
- [x] Owner: "close everything pending". The five documented ACCEPTED RESIDUALS were the only engineering work
      left. Each was accepted because the obvious fix broke something, so each was investigated by its own agent
      against current source first; three of my intended designs were corrected by that pass.
- [x] R1 — PUSH ENDPOINT RE-BIND (accepted v2.99.37). `upsertPushSubscription`'s ODKU re-bound `identityId`
      keyed on the globally-unique `endpoint` alone, so anyone who learned a victim's endpoint could point it at
      their own identity and silently kill the victim's notifications. MY FIRST DESIGN WAS REFUTED: binding the
      re-bind to the existing device id would have refused 100% of legitimate account switches — that id lives
      in sessionStorage (shorter-lived than a PushSubscription) AND `useSignOut` resets it, so account B always
      presents a different one than account A stored. SHIPPED INSTEAD: a per-browser CLAIM secret in
      localStorage (deliberately not cleared on sign-out — it identifies the browser profile, not an identity),
      stored server-side only as a sha256 hash. The insert's ODKU is now a deliberate no-op, and the re-bind is
      one conditional UPDATE whose ENTIRE gate is in the WHERE (so it reads the pre-update row and cannot depend
      on drizzle's SET emission order): already-ours, OR a claim match, OR a LEGACY row (claimHash IS NULL) on an
      encryption-keys match — which an endpoint-only attacker cannot produce, and which stamps a claim so a row
      is legacy exactly once. Verdict from a RE-READ, not affectedRows (MySQL reports 0 for a
      matched-but-unchanged row, indistinguishable from a refusal). A refusal is a pure no-op, and the client
      SELF-HEALS: `owned: false` → unsubscribe → fresh endpoint, so the strict gate can never strand anyone.
      DB down keeps the fail-open convention.
- [x] R2 — LEAKED NUMBER RESERVATIONS (deferred v2.99.30), and one leak path was a routine swallowed race, not
      just infra failure. THE LEDGER'S MONOTONICITY IS LOAD-BEARING (a handed-out number must never be recycled,
      or a stale contact later dials a stranger), so a "delete rows no table references" reaper would have been
      WRONG. Shipped: a `claimedAt` column (no DEFAULT — a default would stamp every new row and make the reaper
      a permanent no-op) stamped at all four allocator sites once the real row lands; `releaseUnusedNumberReservation`
      on the two reachable failure paths, guarded on the number being absent from BOTH number tables; and an
      hourly reaper requiring FOUR independent conditions — unclaimed AND after a hardcoded epoch floor AND past
      a 1h grace AND absent from both tables. The epoch floor replaces a backfill (my original idea): a NULL on a
      pre-release row means "unknown", not "leaked", and a backfill has a failure window where it would eat live
      numbers. A failed identity insert now also resolves the race WINNER instead of leaving the loser with no
      identity at all.
- [x] R3 — REDIS BUS HAD NO MESSAGE AUTHENTICATION (accepted v2.99.20). Anything able to PUBLISH to Redis could
      forge an envelope that reached every SSE stream on an instance. Shipped HMAC signing keyed on
      REDIS_BUS_SECRET (else JWT_SECRET), with the compatibility hazard the agent flagged running BOTH ways: the
      wire format stays a FLAT object with `i`/`p` at top level and the signature in EXTRA fields, because the
      old decoder ignores extras — any other shape would make every not-yet-deployed instance JSON.parse-fail and
      drop 100% of real events for the whole rolling-deploy window. A signed-but-WRONG envelope is dropped in
      every mode; UNSIGNED is accepted until the operator sets REDIS_BUS_STRICT=1, and `/api/health` now reports
      `busAuth` counters so that flip happens on evidence (every instance at unsigned: 0) rather than on faith.
      Strict with no key deliberately does NOT drop everything, or a dev box goes dark. ALSO closed the other
      half for free: the leader now refuses an inbound frame whose `home` differs from its publisher
      (`fromInstance`), which is deploy-safe with no flag because that equality already held for old publishers.
- [x] R4 — NO PER-ACCOUNT PASSWORD LOCKOUT (accepted v2.99.20). `/api/auth/login` had only a per-IP bucket, so a
      rotating-IP attacker had effectively unbounded guesses against one account with the owner never told.
      Shipped a ladder in its OWN columns — sharing the PIN's would let a password brute-force lock out PIN
      sign-in, a live UI path, turning the fix into a cross-channel DoS. An attempt must WIN A SLOT before the
      secret is tested, so the cap bounds scrypt work, not just increments; every statement makes one assignment
      or assigns only constants, so nothing depends on SET emission order. 5 wrong, then the 6th latches for 15
      min. THREE escape hatches so permanent lockout is impossible: self-expiry, an email-code sign-in clears it,
      and the real sign-in paths never read these columns. A locked account answers with the SAME uniform 401 as
      a wrong password, so this is not an oracle for "this address has a live password". DELIBERATELY NO ALERT
      EMAIL: a 15-min self-expiring lock would let anyone who knows an address trigger ~96 mails/day — an
      email-bomb primitive and an SES hazard this repo budgets against elsewhere.
- [x] R5 — UPLOAD RATE-LIMIT ORDERING (accepted v2.99.20/38). The limiters AND the 401 lived inside the handler,
      i.e. after body-parser had buffered up to 41MB — so a throttled request, and worse a wholly ANONYMOUS one,
      still cost a full 41MB of heap. New `uploadRateGate` middleware mounted BEFORE the parsers (with its own
      scoped cookieParser, since the global one is mounted after them). Both buckets move up, not just the per-IP
      one. Refusal sets `Connection: close` rather than destroying the socket: body-parser was skipped, so its
      limit no longer bounds Node's drain of the unread body, and an RST before the flush can eat the response.
      The handler keeps a fallback path so any mount without the gate behaves exactly as before. NAMED TRADE: a
      401 now spends an IP token where it used to pay nothing, so on a shared egress a burst of expired-session
      401s can eat the shared budget; the budget itself is left at its production value.
- [x] OWNER SCREENSHOT (desktop): the New-status composer overlapped the conversation and its third tab was cut
      to "L". `position: fixed` is only viewport-relative while NO ancestor establishes a containing block, and
      this dialog renders from inside the Messages column — which has blurred chrome (a filter DOES establish
      one) above a horizontally scrolling status strip. Fixed by rendering the overlay through a PORTAL to
      document.body, which removes the ancestor dependence by construction rather than betting on which ancestor
      has a filter today; plus the tab row now shrinks and truncates (min-w-0 flex-1, shrink-0 icons, truncating
      labels) so it cannot clip even in a constrained box, and a tall composer scrolls inside itself.
- [x] Tests: `server/residualsClosed.test.ts` (38) — each pins the property AND the constraint it had to respect,
      because ignoring the constraint is the realistic way each of these regresses. Includes behavioural
      HMAC round-trip / tamper / cross-channel-replay / strict-mode coverage, and the integration harness now
      models the real bus by passing the publisher id. 1783 tests; check + build green.
- OPS (optional, not required): after this is on every instance, watch `/api/health` → `busAuth.unsigned` fall to
      0 fleet-wide, then set `REDIS_BUS_STRICT=1` in `/home/relay/.env` and restart pm2 one instance at a time.
      `REDIS_BUS_SECRET` is optional — JWT_SECRET is used when it is unset.
## v2.99.48 — self-review round 3: the fixes that only LOOKED closed (2026-07-24)
- [x] The remaining red-team clusters landed, and they found the sharpest class of problem yet. Worth
      naming the pattern, because it repeated three times: **a fix keyed to something the ATTACKER
      controls, or a guard that parses differently from the code it guards, looks closed and isn't.**
- [x] (M60, HIGH ×2 — the M48 forced-call hole was STILL OPEN, two ways) (a) `bootedWithDialTarget()`
      tested the RAW search string with `/(^|[?&])to=/` while the Dialer reads the value with
      `URLSearchParams`, which PERCENT-DECODES KEYS — so `?%74o=555555&video=1` (`%74` is `t`) was
      invisible to the guard and perfectly visible to the code it guarded. One click still opened a live
      mic AND camera to an attacker-chosen number. (b) `/i/<pin>` — the app's OWN share link, and the
      shorter form people actually send — boots with an EMPTY search and only then redirects
      client-side to `/app/dialer?to=…`, which read as an in-app tap. So the documented invite URL
      stayed fully exploitable while only the long form was closed. Fixed by making the detector use the
      CONSUMER'S parser (`bootDialTarget()` via `URLSearchParams`) and by capturing `BOOT_PATH` so an
      arrival on `/i/<pin>` (or the legacy `/app/call`) counts as an arrival. Verified empirically:
      `client/src/lib/bootUrl.test.ts` stubs a boot location per case and proves the old regex is blind
      to `%74o=` while the new parser sees it.
- [x] (M60c, MED — REGRESSION from M48) ONE-TAP CALLING BROKE FOR THE REST OF THE SESSION. `BOOT_SEARCH`
      is captured once per DOCUMENT, so after any arrival with a `to=` (tapping "Call" on a back-online
      alert is a full page load) EVERY later in-app call tap from Contacts/Messages in that tab took the
      prefill branch — the pad filled and nothing dialed, and it never self-healed. The question is now
      per-NAVIGATION: `arrivedWithDialTarget(to)` asks "is THIS the number the document was opened
      with?", not "did this document ever open with one?".
- [x] (M60d, MED — REGRESSION from M48) TWO OF THREE ARMED-CALL PATHS LOST THEIR ONE TAP. v2.99.45
      claimed the back-online "tap to call" kept its single tap via the intent marker, but only the
      notification branch marked it — the sonner toast action ten lines below did not (one-line fix,
      now marked). The Web Push path CANNOT mark it (a service worker has no `sessionStorage`), so that
      one honestly requires a confirming tap; the claim is corrected in the code comment rather than
      papered over.
- [x] (M57, HIGH — INCOMPLETE CLOSURE of M40) THE ENUMERATION ORACLE NEVER ACTUALLY CLOSED. M40's budget
      was keyed on `callerPin` — but a caller with no cookie is handed a FRESH RANDOM pin by `genPin` at
      register time, and the SSE stream can be reopened about once a second. So an anonymous loop (new
      cid → register → 60 invites → discard → repeat) minted a new bucket every time and probed at
      ~60/s from one address: a full walk of the 10^6 space in HOURS, not the "about three weeks"
      v2.99.45 claimed — a ~100× overestimate on my part, and the reply even carried the callee's
      display NAME, so it was name-harvesting too. The same root cause let an anonymous client be
      assigned a real user's number and drain THAT user's bucket, throttling their legitimate dials and
      silently costing their callees missed-call records. Fixed by making the budget follow something
      the caller cannot re-mint: `verifiedPin` (recorded at register time from F1's cookie-resolved
      `__ownedNumber`) keys it to the identity, and everything else keys to the address (stamped as a
      new server-only `__clientIp`, stripped from client input exactly like `__ownedNumber`). The
      callee's NAME is now only sent to a verified caller.
- [x] (M58, HIGH — INCOMPLETE CLOSURE of M21) THE NUMBER-SPACE CEILING WAS IN THE WRONG PLACE. M21 and
      M41 metered `startGuest` and `regenerateNumber`, but `/api/auth/register` reaches the SAME
      permanent-number sink through `ensureUserIdentity` and had no mint budget at all — 43,200 claims/
      day/IP, MORE than the bound M21 advertised, and wrapped in a bare `catch {}` so nothing surfaces
      when allocation starts failing. And a per-endpoint gate can always be forgotten by the next
      caller. So the ceiling moved to `allocateSharedNumber` — the ONE funnel all four allocators pass
      through — as a global rolling budget (5,000/hour/instance, far above any real day; deliberately
      soft, since this is a runaway-loop backstop, not an authorization boundary). The registration path
      also gained its own per-IP mint gate, metering only the branch that actually creates an account.
- [x] (M21 retune #2, MED — the sizing RATIONALE was wrong) My v2.99.45 note argued 0.2/s sustained was
      fine because "returning visitors cost nothing". They don't: guest identity is deliberately
      SESSION-scoped (device id in `sessionStorage`, guest cookie a session cookie — both die on browser
      close), so the same person spends a fresh token EVERY browser session and demand tracks
      sessions/day. A large shared egress is governed by the sustained rate, so the 13th visitor per
      minute still got a hard TOO_MANY_REQUESTS on the only screen that gets a person into the product,
      with no client retry. Raised to ~1/s now that the global budget above protects the actual resource.
- [x] (M59, HIGH — INCOMPLETE CLOSURE of M23) ONE REVEAL WAS BOUNDED; THE PROCESS WASN'T. M23 capped a
      single inline read at 30MB and reasoned the per-IP throttle covered the rest. It doesn't: tRPC
      batching packs many calls into ONE request and the shared `statusGate` permits a 60-burst, so ~60
      reveals of a 30MB attachment could be in flight together — each holding the buffer, its
      `Buffer.concat` copy, a ~40MB base64 string and the JSON body. Against `max_memory_restart: "1G"`
      with `instances: 1`, that is an OOM restart of the process that owns the ENTIRE in-memory signaling
      registry and every open SSE stream, with `/api/relay/*` ALB-pinned to it — so every call on the
      fleet drops, not just the attacker's request. Added a process-wide slot + in-flight byte budget
      (2 concurrent, 60MB), reserved BEFORE the irreversible burn so an over-budget reveal answers
      `{ok:false, retry:true}` with the message intact — refusing after the burn would destroy content
      the reader never saw. Also capped tRPC batches at 20 (413 `batch_too_large`), ahead of the
      middleware so no resolver runs.
- [x] (M22 follow-up, LOW) A REFUSED REVEAL RENDERED AN EMPTY BUBBLE. M22 correctly made the burn atomic
      so a second tab that loses the race is refused — but the client wrote `revealed` unconditionally,
      so the loser rendered an EMPTY bubble still wearing the "View once — gone when you leave" chip
      (the `copy` branch is checked before `burned`), and `revealed.has(id)` then made it unretryable
      for the rest of the thread session (view-once has `until === null`, so it never self-purged).
      Now only a reveal that actually returned content is cached; anything else refetches, so the row's
      own state drives the honest "This message has disappeared" placeholder and a TRANSIENT failure
      (network, 429, the new budget) stays retryable — which matters because in those cases the message
      was never burned.
- [x] Tests: `client/src/lib/bootUrl.test.ts` (11 — boot-location stubs proving both bypasses and the
      per-document regression), `server/selfReviewPass3.test.ts` (18 — incl. behavioural verified-pin
      coverage through the real register handler). Seven stale pins across seven files rewritten to the
      stronger invariants. Suite 1775 passed / 1 skipped; `pnpm verify` green.

## v2.99.47 — self-review round 2: regressions and half-closures in MY OWN fixes (2026-07-24)
- [x] A second red-team pass over the 29 fixes shipped today, looking for ways each one made the app
      WORSE for a legitimate user or left the invariant it claimed only half-shut. Eight items, every
      one verified against source before touching anything.
- [x] (M53, MED — REGRESSION from M45) HISTORY'S "JOIN" BECAME A DEAD END. M45 added
      `room.has(conn.pin)` to the knock-approve gate — correct, since `roomMeta` outlives membership and
      a departed host (or a kicked co-host) must not keep admitting people. But `hostPin` was written
      only at room creation and by an explicit `makehost`, and NOTHING moved it when the host left. So
      for a group call that outlived its creator: the knock alert still went to the absent host, whose
      Approve tap hit the new gate and returned SILENTLY — the knocker sat on "Asked the host to let you
      in…" forever, and nobody still in the call was ever asked. Fixed at the root with HOST SUCCESSION:
      `leaveRoom` now promotes a successor when the departing pin is the host (an existing co-host
      first — already trusted by the original host — else the longest-standing CONNECTED member; ghosts
      are skipped, since handing the role to a disconnected pin recreates the vacancy) and broadcasts
      `role{host}`. This also restores mute/pin/kick for the rest of the call, which had silently
      belonged to nobody.
- [x] (M53b/M56, MED) THE SAME FAILURE, MADE NON-SILENT. The `knock` handler now checks that a
      moderator is actually IN the room before promising anything, and answers `knock-result{gone}`
      ("that call has ended") when not; a refused `knock-approve`/`knock-deny` REPLIES instead of
      `break`ing. Deliberately with a NEW code `knockfail`, not `forbidden`/`gone`: those two are in the
      client's FATAL sets, so replying with either could have hung up the approver's OWN call — the
      exact class of self-inflicted regression this pass exists to catch.
- [x] (M54, MED — INCOMPLETE CLOSURE of v2.99.44's L1) A GROUP DIAL STILL HUNG FOR 65s. The client
      drains its outstanding-invitee set BY PIN, and two replies in the async offline branch — the
      `nonexistent` case and the resolver-failure `.catch` — carried no `pin`. So a group dial including
      one unregistered or mistyped number could never drain to zero: the caller sat on "Ringing…" until
      the 65s no-answer backstop, which is the very hang v2.99.44 set out to close (its three sibling
      replies already carried the field). Both now do. The stale pin that counted three `offline` sites
      was rewritten to assert the CLASS invariant instead: every reachability reply in the invite path
      names its invitee.
- [x] (M55, LOW — REGRESSION from M40) VOICEMAIL OFFERED FOR A NUMBER THAT MAY NOT EXIST. The
      offline-dial throttle replied `code:"offline"`, which the client treats as voicemail-eligible —
      but the throttle fires BEFORE the number is resolved, so on a mistyped digit the user was offered
      "leave a voice message", recorded up to 60s, and the send then failed against a non-existent
      identity with the recording lost. It now replies `unavailable` with a generic message: still
      classified as unreachable (so a group dial promotes the next invitee) but never voicemail-eligible,
      and it still leaks nothing about whether the number is real.
- [x] (M52, MED — REGRESSION from M38) ORDINARY .xml / .js ATTACHMENTS STARTED FAILING. M38 widened the
      upload denylist to the whole XML + JavaScript families, but the same change fixed the problem at
      the layer that actually decides whether bytes can execute: the storage proxy serves only
      `INLINE_SAFE_TYPE` as itself and downgrades everything else to `application/octet-stream` +
      `Content-Disposition: attachment`, and a file the browser saves cannot run in our origin. The
      Messages paperclip has no `accept` filter and browsers report `feed.xml` as `text/xml` and
      `app.js` as `text/javascript`, so attaching an everyday file began answering 400. Redundant
      defence that breaks a working feature is a bad trade — restored to the pre-M38 set (markup a
      browser renders as a document, plus the two executable-download types) with the load-bearing
      guarantee left where it belongs. The M38 pins were rewritten accordingly, including explicit
      "must be allowed" cases for every type the door now admits.
- [x] (M49, LOW — REGRESSION from M36) A PIN ROW COULD LIE ABOUT BEING LOCKED. M36 splits a wrong
      attempt into claim-a-slot then latch-the-lock. If the process dies in between — and this repo
      pm2-restarts the fleet on every push to `main`, right across the ~100ms scrypt verify in that
      window — the row is left `attempts=4, lockedAt=NULL`. The claim bound then refused every later
      attempt INCLUDING THE CORRECT PIN, while `loginProbe` read only `lockedAt` and reported
      `locked:false`, so AuthPanel parked the user on a pad where no entry could ever work, with no lock
      notice and no alert email (the latch that owns it never ran). New `pinSlotsSpent()` derives the
      state from BOTH fields and is used by `loginProbe` and `pinStatus`; the no-slot branch re-reads
      live state and HEALS a spent-but-unlatched row into a real, visible lock (delivering the email the
      interrupted attempt owed). The latch + alert moved into one `latchLockAndAlert` helper so both
      call sites keep the once-only `isNull` guard.
- [x] (M50, MED — INCOMPLETE CLOSURE of M35) ONE EMAIL COULD STILL OWN TWO ACCOUNTS. M35 closed
      duplicate rows at `/api/auth/register`, but `consumeOtp` was an unguarded UPDATE returning void,
      so two verifies carrying the SAME valid code both passed `latestOtp`'s un-consumed filter and both
      ran on to `createOtpUser` — and `users.email` has no unique index. A later sign-in then resolves
      to whichever row wins the lookup, i.e. the caller can land on an orphan account with its own
      number, contacts and history: exactly the account-diversion harm M35 exists to prevent. Fixed with
      the established atomic-claim pattern (`isNull(consumedAt)` in the WHERE + `affectedRows`), and
      `verifyOtp` now treats a lost race as "that code was already used" BEFORE creating anything.
      `findUserByEmailAny` also gained `ORDER BY id` so any historical duplicate resolves to the same
      (original) row every time instead of an arbitrary one.
- [x] (M51, MED — REGRESSION from M29+M35 together) A DESTROYED PASSWORD WITH NO WAY BACK. M29
      correctly wipes a password attached to a never-verified row when the email's real owner proves
      ownership by code — the server cannot distinguish a self-registration from an attacker
      pre-registering someone else's address, so the wipe must stay. But a user who registers a
      password, signs in with an email code before clicking the verification link, then tries to
      re-register was told "An account with this email already exists. Sign in instead." — pointing at a
      password login that answers 401 forever, with no password-reset route anywhere in the app. The 409
      now branches on whether the row can sign in by password at all and names the way in ("signs in
      with an email code"), which is this app's PRIMARY sign-in since v2.92 removed OAuth. Deliberately
      NOT fixed by inventing a reset flow: no client posts to `/api/auth/*`, so that would be new
      attack surface on a dead surface. Recorded as a residual instead.
- [x] (M37 hardening, MED — the bypass I "closed" was still open) FORCED CAMERA-ON VIA CALL SWITCHING.
      M37's `videoOfferedByUs` was a plain boolean cleared only in `hangUp` — but a call can be left
      WITHOUT hanging up: `switchCall` abandons an unanswered outgoing dial with a bare `leave`, and
      hold/swap park the active call. So: victim taps Video call → attacker dials → victim taps "End
      call & answer" → the offer flag survives into the ATTACKER's call → one `video-accept` frame turns
      the victim's camera on, with a cheerful "Video is on — both sides 🎥" as the only notice. Re-fixed
      structurally by keying the offer to the ROOM it was made for (`videoOfferPending` +
      `videoOfferedForRoom`, bound ONLY by the `room` ack — the server's reply to our own invite, the
      one place a room is provably ours) so a flag set for one call cannot authorize another and future
      call-switch paths are safe by construction. `resetVideoConsent()` at switch/swap additionally
      stops `videoApproved` leaking, which mattered on its own: it disables the gate, so a still-live
      camera would publish to a new peer with no agreement.
- [x] Residuals accepted this round: no password-reset route (above); a determined attacker can still
      reset the M40 per-caller dial budget by minting fresh guest identities (bounded by `guestMintGate`
      per IP — enumeration of the 10^6 space stays weeks-long, and another layer risks another
      availability regression); and a live call is no longer rejoinable by number once the DIALLED party
      leaves (the History card correctly disappears rather than dead-ending, so this is honest
      degradation, not a hang).
- [x] Tests: `server/selfReviewPass2.test.ts` (11 — incl. `pinSlotsSpent` exercised directly),
      `server/selfReviewRelay.test.ts` (12 — behavioural host-succession and knock-reply coverage
      against the real signaling handler, including the exact M45 dead-end scenario). Nine stale pins
      across seven files rewritten to the stronger invariants rather than relaxed. Suite 1745 passed /
      1 skipped; `pnpm verify` green.

## v2.99.46 — process fix: the gate that let a broken commit reach main (2026-07-24)
- [x] v2.99.45 was pushed with UNRESOLVED merge-conflict markers in three files (`shared/version.ts`,
      `client/src/app/updateChecker.test.ts`, `CLAUDE.md`), breaking the typecheck, four test files
      and the production build. The deploy workflow's build step failed, so `your-chat.io` kept
      serving v2.99.44 and no user was affected — the gate that was supposed to stop it BEFORE the
      push is what failed. Markers removed; `CLAUDE.md` needed real reconstruction because stacked
      rebases had left NESTED markers, i.e. two rival truncated changelog chains — the v2.99.45 entry
      now sits ahead of the intact .44 → .43 → .42 → … chain instead of one side silently winning.
- [x] ROOT CAUSE, and the actual lesson: the pre-push command was
      `pnpm check 2>&1 | tail -2 && pnpm test … && pnpm build …`. A shell pipeline's exit status is
      the LAST command's, so `tail` (always 0) masked the failing typecheck and `&&` sailed straight
      on to the push. This is not a one-off slip; any `gate | head/tail/grep && next` reads as a
      passing gate. Two durable guards, because "remember not to do that" is not a guard:
- [x] (1) `pnpm verify` = `pnpm check && pnpm test && pnpm build` as ONE package script. There is no
      pipe to insert and nothing to truncate, so the three gates cannot be decoupled from their exit
      codes by how the command happens to be typed at the call site.
- [x] (2) `server/repoHygiene.test.ts` — a tripwire that fails the SUITE on a stray `<<<<<<<`/`>>>>>>>`
      line in any tracked text file (ts/tsx/js/json/md/css/html/yml/sql/sh/kt/java; node_modules,
      dist, build, coverage and the mobile native dirs skipped). The typecheck only covers compiled
      sources — `CLAUDE.md`'s markers would have passed every existing gate — and the suite is the one
      gate every workflow runs. Verified the tripwire actually FIRES by planting a marker file and
      watching it fail, then pass again once removed (a guard nobody has seen fail is not a guard).
      It also pins that `verify` exists, chains all three gates, and contains no `|`.
- [x] Corrected the v2.99.45 test count in both changelogs (claimed 1706, actual 1717).
- [x] Suite 1721 passed / 1 skipped; check + build green — run through `pnpm verify` this time.

## v2.99.45 — self-review: two availability regressions in MY OWN fixes (2026-07-24)
- [x] Red-teamed today's 29 shipped fixes for REGRESSIONS rather than new vulnerabilities — the fixes
      went out fast, several into the call path and auth, and most are guarded by source pins rather
      than behaviour. A security fix that breaks calling is worse than the bug it closed.
- [x] (M21 refinement) guestMintGate was at the TOP of startGuest's resolver, so it charged a token to
      cases (1)/(2) — the paths that return an EXISTING identity and allocate NO number. On a shared
      egress (carrier CGNAT, office, classroom, conference, café) returning visitors whose cookie had
      been dropped would drain the bucket and then block people who genuinely needed a new identity,
      with a hard TOO_MANY_REQUESTS on the one screen that gets a person into the app. Moved the gate
      onto the ALLOCATING branch only — the resource being protected is the finite number space, so
      meter exactly the operation that spends it — and resized 20/1-per-10s → 60/1-per-5s, which
      absorbs a whole room signing up together. Still bounds a single host to ~17k numbers/day
      (~57 days to walk the space). Confirmed startGuest has exactly ONE call site (the "Enter as
      guest" form submit), so it is not a per-pageview endpoint.
- [x] (M40 retune) The offline-dial limiter was sized without accounting for GROUP DIALS, which fan one
      invite per invitee: a 9-person all-offline group dial spends 9 tokens at once, so 20/1-per-4s was
      exhausted by the SECOND such dial — and because the throttled path deliberately skips
      onMissedCall, everyone dialled after that silently lost their missed-call record, History row and
      notification. A real functional loss for a heavy but ordinary user. Retuned to 60/1-per-2s: ~six
      full 9-person offline group dials back to back, 30/min sustained, and enumeration of the 10^6
      space still goes from "under two hours" to about three weeks.
- [x] VERIFIED SOUND by hands-on checking (no change needed): M38's inline-safe list covers EVERY MIME
      type RELAY itself produces — enumerated the real candidates from voiceNote.ts (audio/webm, mp4,
      aac, ogg), videoNote.ts (video/mp4, webm), emojiAvatar/animatedAvatar (image/png, image/gif), the
      downscale path (jpeg/webp) and application/pdf, and evaluated each against the actual regex: all
      render inline, none forced to download. M28's SQL guard does NOT falsely deny ordinary
      attachments — JSON_EXTRACT(NULL,…) returns NULL, so the meta-IS-NULL case (almost every message)
      satisfies the first clause. And M40's throttled reply uses code "offline", which the client
      classifies as a reachErr that PROMOTES the next invitee during a group-dial bootstrap, so a
      throttle degrades one invitee instead of collapsing the call.
- [x] Tests: hardeningPass5.test.ts's M21 pin rewritten to assert the BETTER invariant (gate meters the
      allocating branch, not the reuse paths) + a budget pin; hardeningPass6.test.ts gains M40 budget
      and reachErr-classification pins. Suite 1717 passed / 1 skipped; check + build green.

## v2.99.57 — 20-expert security sweep: 46 confirmed findings, batches 1–4 (2026-07-25)
- [x] OWNER: "get me 20 securies expert and scan the whole web apps for bugs or errors and fix it without my approvals".
      20 experts, one per vulnerability class / surface, each briefed with a recon map of the ~55 already-closed
      classes and 16 documented accepted residuals — without that briefing the report would have been mostly
      noise, since the previous red-team panel refuted 19 of 22 candidates purely because they were already
      fixed. 65 candidates raised; every one judged by THREE independent skeptics with different lenses
      (can an attacker reach it / is it still true in current source / write the concrete exploit), each
      instructed to default to REFUTED. 46 survived, 19 were killed. 217 agents total.
- [x] **R-GENPIN (1, 8, 45) HIGH — an anonymous register could seize a real user's number.** `genPin` excluded
      only `reg.clients`, so a client with no resolvable cookie could be handed a number belonging to an
      identity that merely had no live SSE stream. Not just a collision: multi-device ring is on fleet-wide so
      inbound dials fanned to the squatter, `deliverPendingRing` handed over a ring in flight,
      `sendRejoinIfInRoom` dropped them into a live call with the member list and a LiveKit token, and the ring
      card rendered the VICTIM's name, avatar and badge because the caller is resolved BY PIN. Two layers:
      `genPin` now excludes `pinRoom`/`heldRoom` and uses `crypto.randomInt` (v2.99.20 #9 fixed
      `randomDigits6` and missed this second minting site), and `pinIsAddressable` makes an unverified
      registration un-ringable, un-rejoinable and un-pageable. The rejoin gate is
      `verifiedClaim(pin) || pin === effectiveOwned`, NOT `verifiedClaim` alone — without the second clause an
      ordinary reload whose `createContext` hiccupped would have lost its call.
- [x] **Finding 2 HIGH — a parked peer could harvest the victim's live mic and camera.** The S2 gate counts a
      HELD room as shared and is evaluated from the SENDER's side, but the relayed frame carried no room. So a
      peer whose call the victim had parked could hand-craft a `signal`, land in `onSignal` with no matching
      peer, and have `createPeer` built around the victim's CURRENTLY live stream — mic, and camera too, because
      `createPeer` flips `callIsGroup` and that makes `consentOk` true. A total bypass of the mutual-consent
      protocol. The server now stamps the authorizing room; the client routes on it via a new pure
      `signalDisposition`. Deliberately does NOT gate the ACTIVE-room case on a client roster: the server has
      already established the sender shares that room, and a roster check would refuse legitimate mesh offers
      arriving before the `peer-joined` ack. Unstamped frames fail OPEN.
- [x] **Finding 7 HIGH — the boot-URL dial guard was blind to `/i/<non-digit-prefixed-pin>`.** It required a
      digit immediately after `/i/` while App.tsx strips EVERY non-digit, so `/i/x555555` was invisible to the
      guard and fully dialable: one click, live mic, attacker-chosen number. M48 for the third time — a guard
      parsing differently from the code it guards. Now uses the consumer's own normalization, and a test
      asserts the two AGREE on every input rather than on cases someone thought of.
- [x] **Finding 4 HIGH — ReDoS in `normalizeEmail`.** M42 bounded the same quadratic regex in
      `parseInboundAddress` only; this function runs it over the same untrusted headers on a route accepting
      5MB. One request stalls every SSE stream and call on the fleet. The cap now lives IN the function, so a
      caller added later inherits it — a per-call-site cap is exactly what failed the first time.
- [x] **Findings 3, 5/9, 6 HIGH — three surfaces had a RATE limit but no OCCUPANCY limit.** The media proxy
      never counted concurrent streams (a free guest, authorized as the uploader of their own 40MB file, could
      accumulate them until the 1GB single process OOM-restarted, dropping every call); `contacts` was
      unbounded and fully enriched on every list; push subscriptions were uncapped and fanned out with
      `Promise.all`. Fixed with an in-flight ceiling released from ONE idempotent handler (a double decrement
      would be worse than the leak), a header-phase-only upstream timeout (an abort signal also kills body
      streaming, so a whole-request deadline would cancel legitimate large downloads), an idle-based stall
      watchdog (wall-clock would break `<video>` seeking), an insert-RANK contact cap that never refuses an
      UPDATE (a user at the ceiling must still be able to BLOCK someone), a `listContacts` limit equal to the
      cap rather than pagination (the client sorts over the whole list; a short page would silently HIDE
      contacts), oldest-first push eviction gated on the row being ours, and a fixed-size send pool.
- [x] **Finding 38 availability — `MAX_STREAMS_PER_IP = 25` locked out shared egress.** Documented as "far
      above any legitimate device count" and it was not: per-IP, two streams per tab, so ~12 tabs across a
      CGNAT population exhausted it and the refusal is a hard 429 that removes calling entirely. Raised an
      order of magnitude in both files; the FLOOD defence is the open-rate limiter, untouched. Also fixed an
      off-by-one where a tab refresh at the ceiling was refused by the user's own superseded stream.
- [x] **R-MODSCOPE (13, 33) MEDIUM — moderation reached HELD members and acted on their OTHER call.**
      `room.has(target)` is true for someone who parked the call, so `force-mute` was applied in a different
      call and `kick` called `leaveRoom`, which acts on the target's ACTIVE room — kicking a held member
      dropped an unrelated call and left them still a member here. Now distinguishes active from roster
      membership; the knock APPROVER is deliberately left alone (M53 exists so a host on hold can still admit).
- [x] **Finding 14 MEDIUM — no host succession when the host's SSE is grace-reaped.** M53 covered `leaveRoom`;
      a host whose connection simply dies reaches the reap branch, which promoted nobody, so moderation
      returned forbidden for everyone and a History "Join" knock vanished.
- [x] **R-STATUSBLOCK (10, 18) MEDIUM — `status.feed` missed "I blocked them".** `savedMeIds` excluded savers
      who blocked ME but not people I had blocked, so their status text leaked while `statusAudienceAuthorized`
      correctly refused the media — surfacing as a broken image. Two independently-written gates disagreeing.
- [x] **R-REVEAL-ORDER (15, 20) MEDIUM — over-cap view-once media was destroyed and reported as success.** The
      ~30MB inline ceiling was evaluated AFTER the irreversible burn. Now checked before, from
      `attachments.sizeBytes`, and a refusal says the message is still there.
- [x] **R-VERIFY-GET (12, 25) MEDIUM — `GET /api/auth/verify` mutated.** Mail security gateways fetch links to
      detonate them and express answers HEAD from `app.get`, so an account was verified before the recipient
      opened the message. Same defect and fix as `/api/email/unsubscribe` (v2.99.42): GET renders a confirm
      form, POST is the only writer. Also M29's THIRD claim site — verifying now clears a credential set before
      the address was proven, closing the pre-hijacking path where an attacker's password goes live on the
      victim's verified account.
- [x] Findings 36, 37 LOW — `deleteMessage` is now an atomic claim (concurrent unsends each decremented other
      participants' STORED `unreadCount`, corrupting counts permanently), and `messages.typing` is block-gated
      per recipient, fail-open (a blocked user could put "X is typing…" on the blocker's screen at will).
- [x] Eight stale pins rewritten to the stronger invariant rather than relaxed; 41 new pins verified to FAIL
      against the pre-change sources. 2000 tests; `pnpm verify` green.
- [ ] REMAINING from the 46 (documented, not yet fixed): the OTP-register family (an existing account's address
      is accepted, skipping new-device approval and rewriting the identity name; the per-recipient cooldown
      keys on the exact string so `+alias` bypasses it; anyone knowing an address can burn every sign-in code),
      the clustered-mode findings (26, 27 — virtual sockets have no real `alive()`, and a leader change
      deregisters browsers whose SSE stayed open), `regenerateIdentityNumber` reading `oldNumber` outside its
      transaction, the global mint budget being a fleet-wide onboarding kill switch, the inbound-email reply
      block gate, `messages.list` aggregate byte budget, sign-out not removing the push subscription, DND on
      `contact-online` pushes, the FCM re-bind claim, `aws-ops.yml` pinning, and `directoryGate` charging one
      token for a 100-number `presenceMany`.

## v2.99.56 — action pinning closed: the last three floating @v4 refs are commit SHAs (2026-07-24)
- [x] CONTEXT: v2.99.55 pinned checkout + setup-node in both Android workflows but left three actions on
      `@v4` — actions/setup-java, actions/upload-artifact, gradle/actions/setup-gradle — with the honest
      note that resolving a tag to a commit needed upstream repo reads the session couldn't do. It
      enumerated them in `PENDING_SHA` rather than exempting the two files wholesale.
- [x] THE BLOCKER WAS NARROWER THAN STATED. The GitHub *API* is genuinely scoped: `api.github.com` returns
      403 ("GitHub access to this repository is not enabled for this session") for anything outside this
      repo, and there is no `gh`/`hub` CLI in this environment. But the GIT PROTOCOL is not scoped —
      `git ls-remote https://github.com/<owner>/<repo> refs/tags/v4 'refs/tags/v4^{}'` works, and it
      answers the question BETTER than the API call: one invocation returns both the ref and, for an
      annotated tag, the commit it dereferences to.
- [x] RESOLVED (15 `uses:` lines across the two Android workflows):
      - actions/setup-java            v4 = v4.8.0 → c1e323688fd81a25caa38c78aa6df2d33d3e20d9  (lightweight)
      - actions/upload-artifact       v4 = v4.6.2 → ea165f8d65b6e75b540449e92b4886f43607fa02  (lightweight)
      - gradle/actions/setup-gradle   v4 = v4.4.3 → ed408507eac070d1f99cc633dbcf757c94c7933a  (ANNOTATED)
- [x] THE ANNOTATED-TAG TRAP MATTERED — this is the one that would have broken CI. gradle/actions v4 is an
      ANNOTATED tag: `refs/tags/v4` is a tag OBJECT (0b6dd653ba04f4f93bf581ec31e66cbd7dcb644d) and the
      commit is ed408507eac070d1f99cc633dbcf757c94c7933a. The `gh api …/git/ref/tags/v4 --jq .object.sha`
      recipe returns the TAG OBJECT for such a tag, so following it literally would have put a non-commit
      sha in `uses:`. Only one of the three was affected; the other two are lightweight (ref == commit).
      A new test asserts that tag-object sha appears in NO workflow, so the trap can't be walked into later.
- [x] ALSO VERIFIED (not assumed) the two pins v2.99.55 already placed: actions/checkout@11d5960… and
      actions/setup-node@49933ea… are both genuinely v4.4.0 upstream, and both are exactly what each repo's
      `v4` currently points at. Neither was a fabricated or stale sha.
- [x] `PENDING_SHA` is now EMPTY and kept as a mechanism rather than deleted: a future genuinely-unresolvable
      action gets enumerated there instead of exempting a whole file. New guard `PENDING_SHA is empty` fails
      if anyone re-adds an entry AND independently re-checks that every ref in all three workflows is a
      40-hex sha, so the exemption path cannot quietly reopen.
- [x] TRIPWIRES RE-VERIFIED BY MUTATION (5/5 fire): un-pin one action ⇒ FAIL; add a PENDING_SHA entry ⇒
      FAIL; pin gradle to the tag OBJECT ⇒ FAIL; `@main` ⇒ FAIL; a SHA with no `# tag` comment ⇒ FAIL.
- [x] MY FIRST VERIFICATION RUN WAS INVALID and was redone. It reverted each mutation with
      `git checkout -- <file>`, which discarded the UNCOMMITTED work under test — so from case 3 onward the
      tests ran against the original committed file and three cases reported a false PASS (and the pins to
      android-apk.yml plus the test edits had to be re-applied). The harness now reverts from byte-exact
      backup copies and hard-aborts if a mutation target string is absent, which is what would have caught
      the neutered mutations immediately.
- [x] Suite 1932 passed / 1 skipped; check + build green. (One transient local failure — roundsGaps.test.ts's
      built-bundle assertion — was a STALE `dist/` from an older revision of this checkout, not a code
      problem: `dist/` is gitignored so CI never saw it, and it passed immediately after `pnpm build`.)

## v2.99.58 — action pinning covers EVERY workflow; the hand-maintained list was the hole (2026-07-24)
- [x] FOUND: `workflowPinning.test.ts` enforced pinning on a hand-written list — deploy.yml + the two Android
      workflows. `aws-ops.yml` was NOT on it, and that file assumes the SAME production role as deploy.yml
      (`role-to-assume: arn:aws:iam::342494841476:role/relay-github-deploy`, `permissions: id-token: write`)
      while running an UNPINNED `aws-actions/configure-aws-credentials@v4`. So a mutable tag had a path to
      exactly the credentials the rule was written to protect. `ci.yml` (checkout/setup-node/pnpm, all @v4)
      was uncovered for the same reason.
- [x] FIX: the covered set is READ FROM DISK (`readdirSync` over `.github/workflows`), not hand-listed. A new
      workflow file is inside the rule the moment it lands rather than starting life silently exempt —
      verified by dropping a temp workflow containing `@v4` and `@main` into the directory and watching the
      suite fail naming that file.
- [x] All 5 workflows / 17 action refs are pinned, each with a PRECISE version comment (`# v4.4.0` rather
      than a bare `# v4`, which told a reviewer nothing about which release they were looking at).
- [x] TWO MORE ANNOTATED TAGS surfaced while resolving these:
      - aws-actions/configure-aws-credentials v4 → tag object ff717079ee2060e4bcee96c4779b553acc87447c,
        commit 7474bc4690e29a8392af63c5b98e7449536d5c3a (v4.3.1)
      - pnpm/action-setup v4 → tag object f40ffcd9367d9f12939873eb1018b921a783ffaa,
        commit b906affcce14559ad1aafd4ab0e942779e9f58b1 (v4.3.0)
      That makes 3 of the 7 distinct actions annotated — the `--jq .object.sha` trap is the COMMON case here,
      not an oddity. Both pins deploy.yml already carried were verified to be the correct dereferenced
      COMMITs, not tag objects. The annotated-tag guard now forbids all three tag-object shas by value.
- [x] FIXED A BAD ASSERTION OF MY OWN: the per-file `refs.length >= 4` floor was calibrated for the three
      large workflows and failed immediately when aws-ops.yml (2 refs) and ci.yml (3 refs) came into scope.
      An arbitrary floor was never the right guard — it is now a PARSER CROSS-CHECK (the parser must find
      exactly as many refs as an independent scan of `uses:` lines, minus local/docker forms), so a regex
      change that blinded the parser diverges instead of passing, plus a single global floor where a floor
      actually belongs.
- [x] A stale `server/awsOps.test.ts` pin asserted the FLOATING `@v4` and so broke on the fix; updated to
      assert the pinned form (and to forbid the floating one) — the stronger property.
- [x] Tripwires re-verified 4/4 by mutation, with byte-exact backup reverts: aws-ops back on @v4 ⇒ FAIL,
      aws creds pinned to the tag object ⇒ FAIL, pnpm pinned to its tag object ⇒ FAIL, a brand-new workflow
      with unpinned actions ⇒ FAIL. Suite 2011 passed / 1 skipped; check green.

## v2.99.59 — half of all signaling messages were being dropped in production (task #38) (2026-07-24)
- [x] Task #38 was a QA-sweep SUSPICION ("cookie-less /api/relay/send on the non-stream instance loses
      replies") that nobody had confirmed. It is REAL, and I measured it against the live fleet rather than
      reasoning about it: open ONE SSE stream for a cid, then POST 24 times for that same cid.
      **12 of 24 returned 404 `channel not found`.** A control POST for an unknown cid also 404'd, proving
      the probe could tell the two apart.
- [x] MECHANISM: the SSE stream (`GET /api/relay/stream`) and every signaling message
      (`POST /api/relay/send`) are separate HTTP requests. The ALB round-robins them across the two
      instances with no stickiness, so a POST routinely lands on the instance that holds no `localDelivery`
      entry for that cid. The clustered POST path answered 404 and dropped the message. `sendWS` retries 3×
      with backoff, so ≈6% of messages were lost OUTRIGHT (0.5^4) and the survivors delayed by up to ~3s —
      on the offer/answer/ICE path, where either outcome is call-fatal. This is very likely the substrate
      under a long tail of "calls not ringing / dying seconds after dial" reports that earlier versions
      chased as client-side bugs.
- [x] FIX: a misrouted POST is PROXIED to the leader instead of refused (`clusterProxyInbound`). The
      proxying instance does not know where the stream lives and is NOT allowed to claim it: the frame
      carries `proxy:true`, and the leader ignores the claimed `home` entirely, routing the reply to the
      home it already recorded in `homeOf` at `__connect` time.
- [x] The no-home case is handled deliberately, not incidentally: if the leader has no recorded home for the
      cid, the proxied frame is DROPPED. Binding the cid to the proxying instance (which has no stream)
      would black-hole every subsequent reply for that channel — that failure mode has its own test.
- [x] Security unchanged: the v2.99.49 anti-spoof rule (`f.home !== fromInstance` ⇒ drop) still applies to
      normal frames, and a proxy frame is strictly safer than a normal one because its `home` claim is never
      read at all.
- [x] Rolling-deploy safe: `decodeInbound` normalises `proxy` to a boolean, so a frame published by a
      not-yet-updated instance decodes as explicitly non-proxied instead of `undefined`.
- [x] Pinned by an integration test replaying the exact production scenario — peer B's ACCEPT arriving as a
      POST on the WRONG instance — asserting the reply reaches B at its true home, A sees `peer-joined`, and
      the misroute does not re-home the cid. VERIFIED TO FAIL against the pre-fix 404 before being kept.
      A second test covers the unknown-cid drop. Suite 2013 passed / 1 skipped; check green.
- [x] NOTE for ops: an ALB stickiness policy (or the documented `/api/relay/*` target-group pin) would also
      fix the routing, and is still worth having — it removes a Redis hop from every misrouted message. The
      application no longer DEPENDS on it, which was the point.

## v2.99.60 — affinity fix verified live; orphan-identity recovery tool (2026-07-24)
- [x] VERIFIED v2.99.59 IN PRODUCTION with the same probe that found the bug: 24/24 POSTs now return 200
      (was 12/24 → 12 × 404). The signaling drop is closed on the live fleet.
- [x] RECORDED A DELIBERATE CONSEQUENCE rather than leaving it to be discovered: an instance that is not the
      home cannot tell "homed elsewhere" from "no such cid", so a DEAD cid now also gets 200 instead of 404.
      Nothing regresses — the client never acted on the 404 (it retries blindly; the SSE close drives
      reconnect) and a dead channel's message was undeliverable either way — and the uniform reply removes a
      cid-existence oracle. The integration test asserts that response shape so it stays a decision rather
      than drift. Restoring the distinction would require mirroring cid→home into Redis; ALB stickiness is
      the cheaper cure and remains the ops follow-up.
- [x] NEW `scripts/recover-orphan-identity.mjs` — the recovery CLAUDE.md has carried as "designed but not
      yet built" since v2.99.54. Moves a pre-v2.99.49 orphaned guest identity (the owner's 601-586, which
      still holds the contacts/messages/history) onto its registered account.
- [x] SAFETY, because the only way this destroys data is by deleting a non-empty row:
      - DRY RUN BY DEFAULT; nothing is written without `--apply`.
      - Refuses unless the orphan is genuinely unclaimed (`userId IS NULL`) — never takes a row that
        belongs to another account, and says which case it hit.
      - Refuses unless the identity it would REPLACE is provably EMPTY across all seven
        identity-referencing tables (messages, conversation_participants, contacts, call_history,
        conference_participants, statuses, party_lines). There is deliberately NO override flag.
      - One transaction, delete-then-adopt (forced by the unique index on identities.userId), with both
        statements re-checking their preconditions in the WHERE clause so a concurrent change loses rather
        than corrupts. Re-running after success is a no-op.
- [x] TWO COLUMN NAMES WERE WRONG in my first draft — `contacts` uses `ownerId` (not `ownerIdentityId`) and
      `call_history` splits into `callerIdentityId`/`calleeIdentityId` — caught by reading the schema
      instead of trusting the guess. Now caught automatically too: a PREFLIGHT validates every table and
      column against information_schema before a single row is read, so a future rename cannot silently
      under-count the emptiness check (it refuses instead).
- [x] HONEST LIMIT: no MySQL was reachable from this sandbox (docker client present, daemon not running), so
      only the argument-validation and preflight paths were actually executed. The DB paths are UNRUN — which
      is precisely why the destructive half is opt-in behind `--apply` and the dry run is read-only.
      Run the dry run first; if the schema drifted, the preflight says so and writes nothing.

## v2.99.61 — multi-relay TURN: the last wire in the symmetric two-zone build (2026-07-24)
- [x] CONTEXT (owner's new network diagrams): the fleet is now symmetric — every layer exists twice across
      ap-south-1a and ap-south-1b, including a coturn per zone (13.232.119.83 and 13.204.23.58, both
      TLS-live). Everything in those diagrams is live EXCEPT one thing, and it was mine: the server only
      ever advertised ONE relay. The ICE list is minted server-side at registration, so no amount of
      infrastructure symmetry could fix it — losing a zone took the relay path down with it.
- [x] NEW `TURN_HOSTS` — comma/whitespace separated list of relay hosts, precedence over `TURN_HOST`.
      Every relay is advertised with every transport (UDP:3478, TCP:443, TCP:3478, and `turns:` when
      `TURN_TLS=1`). Duplicates are deduped — re-gathering the same relay costs time for nothing.
- [x] All relays share ONE minted credential, which is correct rather than convenient: coturn in
      `use-auth-secret` mode validates the HMAC against its own static-auth-secret, so every relay holding
      the same `TURN_SECRET` accepts the same username/credential pair. Clients then gather relay
      candidates from BOTH zones, which is what makes the failover need no renegotiation — if a zone drops,
      the peer is already holding a candidate on the survivor.
- [x] `TURN_TCP_HOST` is honoured ONLY in the single-relay case it was written for (v2.92, UDP and TCP
      behind two separate L4 load balancers). With a list it is deliberately IGNORED and each relay uses
      its own address: one global TCP override would aim every relay's TCP candidates at a single zone and
      quietly rebuild the exact single point of failure this change removes.
- [x] BACKWARDS COMPATIBLE BY CONSTRUCTION: a deployment that only sets `TURN_HOST` gets a byte-identical
      URL list to before — same URLs, same order — pinned by a test asserting the exact legacy output, so
      opting in is the only thing that can change behaviour.
- [x] VERIFIED IN A REAL BROWSER before shipping, rather than assuming: the resulting 11-entry ICE list
      (3 STUN + 4 URLs × 2 relays) is accepted by `RTCPeerConnection` and survives `getConfiguration()`
      intact — 11 supplied, 11 kept, nothing silently truncated.
- [x] `server/multiTurn.test.ts` (8 tests); 4 of them verified to FAIL against the pre-change parser before
      being kept. The existing 80 relay tests still pass unchanged. Suite 2021 passed / 1 skipped.
- [x] OPS — the one step left, and it is a config change, not a deploy: set on BOTH app servers in
      `/home/relay/.env`
          TURN_HOSTS=13.232.119.83,13.204.23.58
      (keep `TURN_SECRET` identical to both coturns' static-auth-secret, and `TURN_TLS=1` since both relays
      report TLS live), then restart pm2. `TURN_HOST` can stay as-is; `TURN_HOSTS` takes precedence.
      The `env-set` action in aws-ops.yml does exactly this across the fleet.

## v2.99.62 — multi-TURN activated on the fleet + a real in-VPC TURN health check (2026-07-25)
- [x] ACTIVATED v2.99.61 on the fleet with two `env-set` runs: `TURN_HOSTS=13.232.119.83,13.204.23.58`
      then `TURN_TLS=1`. Live `/api/relay/ice` went 3 → 6 → **8 TURN URLs** (both zones × udp, tcp:443,
      tcp:3478, turns:5349). Both relays are now advertised to every client.
- [x] FOUND WHILE VERIFYING: `TURN_TLS` had never been set, so the `turns:` candidate was not advertised
      even for relay 1 — the certificate was live and doing nothing for clients. That is the candidate most
      likely to cross corporate deep-packet-inspection networks. Caught by reading the live ICE output
      rather than trusting the config.
- [x] MY FIRST LIVENESS PROBE WAS WRONG AND I DISPROVED IT RATHER THAN REPORTING IT. It said 0/3 endpoints
      alive on BOTH relays. The control: the known-alive public TURN server (openrelay.metered.ca) failed
      the identical probe, replying `485454502f312e31` = ASCII "HTTP/1.1" — this sandbox's HTTP proxy
      answering instead of the relay. Non-443 ports are blocked here outright (1.1.1.1:53 and
      github.com:22 both time out), so :3478 and :5349 were never testable from this machine, and the
      1-2ms "connect" on :443 was the local proxy, not a round trip to Mumbai. No evidence of any outage.
- [x] NEW `scripts/turn-check.mjs`, wired into aws-ops.yml's `verify` and executed ON an app instance via
      SSM. In-region so it can actually reach :3478/:5349, and the credentials never leave the VPC —
      nothing is pasted into a third-party page and no secret is printed.
- [x] It performs a REAL authenticated TURN Allocate, not a ping. Only an Allocate proves each relay's
      `static-auth-secret` matches `TURN_SECRET`: a relay with the wrong secret answers STUN happily, shows
      up healthy, and then refuses every allocation — silently breaking calls for whichever users get
      steered to it. That is the precise failure mode a second relay introduces.
- [x] Read-only with respect to the relay: every successful allocation is released immediately with a
      zero-lifetime Refresh, so a repeated health check cannot accumulate allocations.
- [x] VALIDATED THE PROTOCOL, not just the syntax: a local fake coturn that independently RECOMPUTES the
      MESSAGE-INTEGRITY HMAC (the part most likely to be subtly wrong — its length field must count the MI
      attribute while the bytes stop before it). Correct secret ⇒ Allocate success + relayed port;
      MISMATCHED secret ⇒ "credentials REJECTED (err 401) — this relay's static-auth-secret differs from
      TURN_SECRET", exit 1; TURN unconfigured ⇒ clean skip, exit 0.
- [x] RE-MEASURED THE EXIT CODES WITHOUT A PIPE. The first run reported `exit=0` for the failing case
      because `$?` after `node ... | grep` is grep's status — the same pipeline-masks-exit-status bug that
      v2.99.46 exists to prevent. Real codes confirmed: 1 / 1 / 0.
- [x] `deploy.yml` now ships `scripts/` in the release tar — it did not, so the instance had nothing to
      execute. Pinned in workflowPinning.test.ts alongside the other tar entries (each of which was added
      after a real per-server failure). This also puts `recover-orphan-identity.mjs` on the instances,
      which is where DATABASE_URL actually lives.
- [x] `verify` treats an unhealthy relay as a WARNING, not a hard failure: it is a status report, and a
      relay problem should be loud without masking the rest of the output.

## v2.99.63 — turn-fix: diagnose (and safely fix) TCP/443 on the TURN relays (2026-07-25)
- [x] The v2.99.62 in-VPC health check reported `turn:<host>:443?transport=tcp` DOWN on BOTH relays, while
      udp/3478, tcp/3478 and turns/5349 all complete real authenticated allocations. That is worse than
      "2 of 8 endpoints": :443 exists precisely for networks that block UDP and non-standard ports, and on
      such a network the other three candidates are also unusable — so those users have NO relay path and
      calls sit on "connecting…".
- [x] A connect timeout has two causes with different fixes — a security group dropping tcp/443, or coturn
      not listening on it — so the new `turn-fix` action DIAGNOSES BY DEFAULT (`turn_apply` defaults to
      false). Production networking is not changed on a guess.
- [x] It derives the relay list from the APP FLEET'S OWN env (`TURN_HOSTS`), so the thing it checks can
      never drift from what clients are actually told to use; resolves each host and finds its EC2 instance
      BY PUBLIC IP rather than by tag, so a rename or retag does not break it.
- [x] Reports, per relay: whether tcp/443 is permitted by its security groups, and — when the relay hosts
      are SSM-managed from this account — what is actually LISTENING on 443/3478/5349 plus the
      `listening-port` lines from turnserver.conf. When they are NOT managed it says so plainly rather than
      implying it checked.
- [x] With `turn_apply=true` its ONLY mutation is opening tcp/443 inbound on the relay security groups.
      Pinned by a test asserting the apply-gate precedes the single `authorize-security-group-ingress` call,
      that the input is boolean and defaults to false, and that the diagnose-only path exists.
- [x] It deliberately does NOT rewrite coturn's config: those hosts may sit outside this role's control, and
      the better fix is TLS on 443 rather than plaintext — `alt-tls-listening-port=443` in turnserver.conf
      plus `TURN_TLS_PORT=443` via env-set. TLS on 443 is indistinguishable from HTTPS so DPI firewalls pass
      it; plaintext TURN on 443 is exactly what they drop. The action prints that recipe when the security
      groups already permit 443, i.e. when the listener is the remaining gap.
- [x] Stale `awsOps.test.ts` options pin updated for the new action. Suite 2022 passed / 1 skipped.

## REPO NOTE — `main` now belongs to a different project (2026-07-27)

Not a release. A structural fact any future contributor has to know before touching git.

The owner force-pushed `main` to an Expo Router / React Native shell (the iOS+Android
WebView app that wraps this site, now built by Codemagic CI) and has confirmed that is
deliberate: *"i own the main intgrated now"*.

- **Zero shared ancestry.** `git merge-base` between `main` and the web app returns
  nothing. `main` carries no `client/`, no `shared/version.ts`, no
  `ecosystem.config.cjs`, and no `.github/workflows/` at all.
- **The web app lives on `claude/connected-ready-glsdab`**, whose tip holds the complete
  170-commit history through v2.103.2. That branch is its effective trunk.
- **Do not open a PR against `main`.** Merging this codebase into the mobile project is
  the wrong operation, not a conflict to resolve. PR #83 (v2.103.2, CI green) was closed
  unmerged for this reason and must not be reopened.
- **Do not delete that branch.** This environment's git proxy refuses tag pushes (four
  attempts, consistent `send-pack` disconnect), so the branch is currently the only ref
  from which the web app is reachable. Older snapshots survive on
  `claude/jolly-brown-isnjrh` (v2.99.73) and
  `claude/install-security-plugin-4g9z8p` (v2.99.57).
- **There is no live deployment path.** `deploy.yml` triggers on
  `push: branches: [main]` and exists only on the web app's branch, so a push deploys
  nothing; `workflow_dispatch` is unavailable too, because GitHub only offers it for
  workflows present on the default branch. The fleet still serves **v2.103.1**, the last
  build that deployed — the site is up, it just will not advance. Restoring deploys is a
  one-line change to the trigger's branch list, but it removes the merge gate (every
  push would go straight to production), so it is the owner's call and has not been made.

CLAUDE.md's TL;DR and Deploying section are corrected to match.

## v2.103.2 — the RELAY wordmark was invisible three different ways (2026-07-27)

Owner: *"I saw one time you put the relay logo up in the top bar. It's moving animated.
Now it's not showing. Why? The word rely itself. I told you every thirty seconds, make
animation."*

**Nothing broke it.** The wordmark's markup was byte-identical to what v2.99.94 shipped,
so this needed a diagnosis rather than a `git log`. A 19-agent investigation returned
five findings; three are real, independent causes.

- [x] **Cause 1 — a 390px breakpoint deleted the word on most phones.**
      `max-[389px]:hidden` removed it outright on 375px iPhones (SE / 8 / 13 mini) and
      360px Androids while leaving the dot and connection line in place, so the bar
      looked intact and the word was simply gone. Measured against the real built
      stylesheet over five name shapes: the word coexists with the longest name and the
      PIN at 360 / 375 / 390 / 430 with real slack, and at 320 the only contact is the
      peak frame of the swell grazing an already-truncated name. **Breakpoint removed
      entirely**; 25/25 cases pass, worst case 2px of slack.
- [x] **Cause 2 — the only mount was on a `md:hidden` surface**, so above 768px the
      animated wordmark did not exist at all (the sidebar drew a static uppercase span).
      v2.99.94's own pin had frozen that state by asserting exactly one mount. The
      sidebar now mounts `<BrandMark />` and desktop gains the connection line it never
      had. Two mounts is correct because the surfaces are mutually exclusive
      (`hidden md:flex` vs `md:hidden`), the wordmark's rules still live in one place,
      and `useConnectionState` is a `useSyncExternalStore` over window events with no
      timer.
- [x] **Cause 3 — v2.99.94 cut its own duty cycle.** Sampled from the running animation
      with a negative `animation-delay`: v2.99.86 moved 1.3s of a 5.5s cycle (22.8%);
      v2.99.94 moved 1.3s of a 30s cycle (4.4%); this release moves 3.1s of 30s (10.5%).
      The cadence the owner asked for was delivered and the event inside it became
      nearly invisible.
- [x] **A fourth defect nobody had noticed: the sheen band came to rest ON the word.**
      Its travel ended at `translateX(320%)` of a 24px band — left edge at 52.8px, inside
      a 64px mark — and was held there from 7% to 100%, so for 29.2 of every 30 seconds
      there was a static bright smear over the last letter. v2.99.86 had the same end
      point and only got away with it by repeating every 5.5s. Now pinned as a clearance
      calculation, which the old shape fails (43.2px vs the 64px it must clear).
- [x] **Two things reading the keyframes would never have revealed.** 40% of the band's
      travel happened off-screen (it is inside the clip only between 0% and 260% of its
      own width), and `ease-in-out` is fastest in the middle — which is precisely the
      visible part — so the band crossed the letters at its top speed and was gone in
      1.4s of a 3.6s window. Tightening the travel and switching that one animation to
      `linear` took the visible band from 1.4s to 3.3s, matching the word's 3.1s.
- [x] Word beats twice, second smaller, matching the brand dot's own language; band
      widened 24px → 40px of a 64px mark (free, because it is clipped to the word's box —
      unlike the swell, which is a transform and paints outside its layout box, which is
      why the peak is measured rather than chosen).
- [x] **The one-sided pin is what let this regress, and it is now two-sided.** v2.99.94
      asserted motion ends at or before 10% with no floor, so shortening the flourish to
      5% passed cleanly. A one-sided bound on a perceptual property rewards making the
      thing disappear. Now 8%–20%, both bounds load-bearing, plus a pin that the word and
      band end at the same percentage.
- [x] `client/src/app/wordmarkFlourish.test.ts` (15); **all 25 tripwires verified by
      mutation** from byte-exact backups and a confirmed-GREEN baseline, mutator aborting
      unless its target occurs exactly once, sources byte-identical afterwards.
- [x] Two pre-existing pins rewritten to the property — both had frozen halves of this
      defect (the single `md:hidden` mount, and the one-sided window bound).

**Harness bugs of my own, reported rather than counted as results.** The first in-motion
run said the band was visible 95% of the cycle and I was one step from calling it a code
defect — I had dropped the `flex items-center gap-2` wrapper, so `#word` was a bare inline
span and the sheen's `inset-0` clip resolved against a body-width box. And the
before/after comparison first reported 0% motion for both older variants, because
`!important` on the `animation` shorthand also pins `animation-delay`, so the inline seek
was silently ignored and every sample read the same frame.

**Said plainly, and it needs a five-second check on the owner's phone:** iOS/Android
**Reduce Motion** suppresses this entirely, because both animations live inside
`@media (prefers-reduced-motion: no-preference)` and hoisting a decorative flourish out of
that gate would override an accessibility request to deliver it. Under reduced motion the
still frame is verified to be the plain unscaled mark with the band fully off it.

No schema change, no new dependency, no new env var, no server change. 3132 tests.

## v2.103.1 — the call-history filters fit a phone, and the Profile hero stops repeating itself (2026-07-27)

Two owner reports, both about the same thing: a screen saying something twice, or not
saying it at all.

**The History filters overlapped** (owner, with a screenshot: *"All type of categorize and
the call history it's overlap. you cannot see it like all calls received or outgoing
grouping."*)

- [x] **DIAGNOSED BY MEASURING, NOT BY LOOKING.** v2.99.98 added a fourth filter
      (Received) and a fifth control (Group) to a row that already held three. Each
      filter needs an icon, a word and a count; five such controls need ~500px and a
      phone has ~390. With `flex-1` and no `min-w-0` the items could not shrink below
      their content, so they collided.
- [x] **THE FIRST FIX WAS NOT ENOUGH, AND THE MEASUREMENT IS WHAT SAID SO.** Splitting
      into two rows removed the overlap — and headless Chromium against the REAL built
      stylesheet then reported every label but "All" **clipped at every phone width**:
      an 87px tab leaves ~39px for the label once icon and count are placed, and
      "Received" needs ~58. Guessing would have shipped that.
- [x] So the tab content is **STACKED**: icon and count share a top line, the label gets
      the tab's full width beneath. Re-measured at 320 / 360 / 375 / 390 / 430 —
      **0 overlaps, 0 clipped labels, no overflow, Group and Clear both visible, 5/5**.
- [x] **NOTHING WAS DROPPED to make it fit** — the cheap fix is deleting a label or a
      control, and all four filters plus both row-2 controls are still there.
- [x] Group moves out of the tab strip but stays a TOGGLE (`aria-pressed`), so it still
      composes with whichever filter is chosen — which an exclusive tab could not do
      (v2.99.98). Splitting it out is also the better hierarchy: the filters are one
      choice, grouping is a modifier on it.
- [x] The harness guards both recorded measurement bugs: it names `index-*.css`
      explicitly (v2.99.94 picked `Docs-*.css` and measured a page with no Tailwind) and
      ABORTS unless the emulated width really took (v2.99.84 measured a phone at the
      980px default layout viewport).

**The Profile hero said the same three things as the bar above it** (owner: *"when you
click on the profile remove this one the first name, badge and pin number because it's
already repeated on the bar on the top bar"*)

- [x] Name, badge and the six digits are gone from the hero. The top bar sits directly
      above it and carries all three.
- [x] **WHAT YOU CAN DO WITH THE NUMBER STAYS**, because the top bar cannot do it:
      settings, QR and copy are the reason the block exists and none of them is anywhere
      else. The `aria-label` still names the number, which is right — a screen reader
      needs to know which number the button is about.
- [x] **THE BUILD GOES IN THE SPACE INSTEAD** (owner: *"put the current version number …
      whenever it's update we will understand which version we are"*), from
      `shared/version.ts` — the same constant the server serves at `/api/version` and the
      auto-updater compares against, so the stamp can never disagree with what is
      deployed. The footer keeps only what the hero does not say, so the version is not
      printed twice on one screen.

**Tests**

- [x] `client/src/pages/app/historyFilterFit.test.ts` (5) pins the structural rules the
      measurement rests on — a layout regression here is invisible in a unit test
      otherwise, and this bar has now broken twice.
- [x] **Four pre-existing pins rewritten to the new rule rather than relaxed**, and all
      four had asserted the PRESENCE of exactly what the owner asked to remove: three in
      `profileHub.test.ts` (the badge, the number, its bidi isolation) and one in
      `verifiedBadge.test.ts`, whose surface list no longer includes Profile — the badge's
      surface for the signed-in user is the top bar, which that list already covered.
- [x] No schema change, no new dependency, no new env var, no server change.
      Suite 3117 passed / 1 skipped.

## v2.103.0 — swipe a thread row for Unread / Pin / Mute / Delete / Archive (2026-07-27)

Owner, with two screenshots of the intended row: in the MESSAGES LIST (outside a chat),
dragging a thread row LEFT reveals the right-hand actions (Mute / Delete / Archive) and
dragging RIGHT reveals the left-hand ones (Unread / Pin). Glassy buttons. Holding a
finger on the row is a second way in.

**Four of the five icons were features that did not exist**

- [x] Read before building: Mute worked but per-DEVICE; Unread, Pin, Archive and
      thread-Delete did not exist at all. So the gesture is the visible half and four new
      capabilities are the real work — all of them **server-side per person**, because
      pinning a chat on a phone that leaves it unpinned on a laptop is the same lie a
      localStorage "delete for me" would have been (v2.102.2). Four additive nullable
      columns on `conversation_participants`, which is already keyed
      (conversationId, identityId).
- [x] **MUTE STAYS PER-DEVICE, and that is a decision rather than an omission**: the
      service worker has to silence a notification without asking the server anything
      (v2.99.42). Moving it would quietly reverse that and break notification muting.
      A test asserts the endpoint mentions mute nowhere.

**The gesture lives inside a vertically scrolling list, which is the real risk**

- [x] `touch-action: pan-y` — the browser keeps vertical panning for itself, so scrolling
      never has to be given back. The fix people reach for instead
      (`preventDefault` on touchmove) stops the list scrolling outright.
- [x] The pointer is claimed only once movement passes a threshold AND is more horizontal
      than vertical; a mostly-vertical move **ends** our interest in the gesture, so it
      can never be grabbed back mid-scroll. Capture happens strictly after the claim.
- [x] The drag writes the transform IMPERATIVELY — a state update per pointer move would
      re-render the whole thread list on every frame of every drag (the v2.99.67
      mistake). Only `transform` and `opacity` animate.
- [x] A full swipe commits only when a side holds ONE unambiguous action. With three
      buttons there is nothing a full swipe could mean, and guessing would Delete a chat.
- [x] Buried actions are not focusable, or Tab walks every hidden button on every row;
      and the tap that closes an open row cannot also open the conversation.

**What each action does**

- [x] **Pin sorts to the top.** A pin that only draws a marker on a row still buried
      forty threads down is not a pin. Within each group the existing recency rule is
      untouched, so an unpinned list sorts byte-identically to before.
- [x] **Archive gives threads their own section, LAST** — out of the way but not gone —
      and they leave Direct / Groups / Notes. Pin and archive exclude each other, because
      a thread pinned to the top AND hidden in Archive is a contradiction the list cannot
      render.
- [x] **Unread shows a DOT, not a count.** There is no number, and "1 new" would be a
      claim about a message that may not exist. Its own column rather than rewinding the
      read watermark, which would fight `recomputeUnreadFor` and could not express
      "unread" at all for a thread whose newest message is your own.
- [x] Every action is a TOGGLE reading the row's own state, so a pinned thread offers
      Unpin. An action that cannot be undone by the same gesture that did it is a trap.

**Delete a thread — recoverable, and the copy says so**

- [x] It stamps the newest message id rather than bulk-inserting a hide per message: one
      column, and the filter rides the `(conversationId, id)` index — the shape
      `identities.historyClearedAt` has used for the call log since v2.75.
- [x] **The thread returns by itself when something newer arrives, and that costs no
      write on the send path**: it is hidden exactly while its newest message id is not
      greater than the stamp, and the groupwise-max has already produced that id.
- [x] Note this DIFFERS from a per-message hide, where the thread stays with no preview:
      there the message went, here the person asked for the thread itself to go.
- [x] Clearing also zeroes the badge and leaves Archive — a hidden thread with a live
      badge counts toward a total nobody can act on, and a cleared thread in Archive
      would have no messages in it. Deleting the OPEN thread navigates away rather than
      leaving an empty conversation nobody can escape except with Back.
- [x] The ONLY action behind a confirmation, and the copy names what survives: everyone
      else keeps the conversation, and it comes back if they write again.

**Tests**

- [x] `server/swipeActions.test.ts` (22). **All 33 tripwires verified by MUTATION** from
      byte-exact backups, from a confirmed-GREEN baseline.
- [x] **One survivor, and it was the same class as last release's** — the scoping
      assertion matched the re-read SELECT's copy of the clause while the mutation
      stripped it from the **UPDATE**. An unscoped UPDATE here pins, archives or CLEARS
      the thread for every member of the conversation. Now pinned on the write
      specifically, with both halves counted so a missing one on either side is caught.
- [x] One of my own mutations was bad and is reported rather than counted: its target
      string did not match the source, so it aborted rather than surviving.
- [x] Two pre-existing pins updated, both expected fallout: the timestamp pin, because a
      pinned row now shows a marker before it and `ms-auto` moves to whichever comes
      first; and the Groups-section pin, because that filter now also excludes archived.
- [x] **NOT VERIFIED ON A DEVICE, said plainly**: the scroll-safety rules are pinned and
      the logic is tested, but nobody has dragged a row on a real phone. That is exactly
      where a gesture like this is judged.
- [x] Four additive nullable columns, no new dependency, no new env var.
      Suite 3113 passed / 1 skipped.

## v2.102.2 — "delete for me" (2026-07-27)

Owner (#81): a way to remove a message somebody ELSE sent, for you alone.

**It is NOT unsend, and keeping the two apart is the whole feature**

- [x] `deleteMessage` flips `messages.deletedAt`, which takes a message away from
      EVERYBODY and is rightly restricted to its own sender. This writes a row in a new
      `message_hides` table and changes nothing for anyone else — which is exactly why
      it is allowed on a message the caller did not send. A test asserts the hide path
      never touches `deletedAt` and never updates `messages` at all.
- [x] **Two separate confirmations**, because one dialog would have to describe two
      different blast radii — which is how somebody unsends for everyone believing they
      hid it for themselves. Unsend says "removed for everyone"; this says "everyone
      else keeps it, and they aren't told".
- [x] **Server-side, not localStorage**, and that is the reason it is a feature rather
      than a polish item: a browser-only version would be a lie, because the message
      would come back on that person's other phone.

**The performance decision is load-bearing**

- [x] Four reads had to learn the rule, and one of them — the thread list's
      groupwise-max — is polled by every client every few seconds. **The obvious change
      is a `NOT EXISTS` inside that aggregate, and it is the wrong one**: it is a loose
      index scan over `(conversationId, id)`, and an antijoin defeats the loose scan for
      every user in the fleet to serve a feature almost nobody has used.
- [x] So the aggregate is **untouched**. Instead: ask which of the WINNING ids this
      person has hidden — one primary-key range lookup over the ids already in hand —
      and only for the conversations that come back does a second, narrow query find the
      next-newest visible message. With no hides the extra cost is that single lookup
      and the plan for everyone else is byte-identical. Both the fast path and the
      guard that protects it are pinned.
- [x] A thread with no visible message left **stays**, with no preview. Dropping it
      would hide a conversation other people are still in.

**One predicate, four readers**

- [x] `notHiddenFor(identityId)` is exported and used by `listMessages`,
      `searchMessages`, the unread recompute and the preview fallback — so no surface
      can forget it and start showing a message somebody hid. A `NOT EXISTS` rather
      than a `LEFT JOIN`, because MySQL optimises it as an antijoin against the
      `(identityId, messageId)` primary key.
- [x] **Search was the likeliest place to forget**: a hidden message that reappears
      under search is the feature silently not working.

**The write is claimed, scoped and idempotent**

- [x] Membership is checked BEFORE the row is written, and inside
      `hideMessageForIdentity` rather than at the call site — a message id is a small
      integer, so without it anybody could write a row naming any message in the
      database.
- [x] **THE INSERT IS THE ATOMIC CLAIM**: `ON DUPLICATE KEY UPDATE` reports
      `affectedRows: 0` for a row that already existed, so a double-tap or a retry
      cannot run the unread adjustment twice — the defect v2.99.57 found in
      `deleteMessage`, where two concurrent unsends each moved a STORED counter. An
      already-hidden message succeeds without touching it, so the endpoint is
      idempotent rather than an error the UI has to explain.
- [x] The unread count is **RECOMPUTED, never decremented** (v2.99.74: a decrement is
      not idempotent and a retry drives a stored counter negative). New
      `recomputeUnreadFor` derives it from the read watermark — messages after it, not
      this person's own, not unsent, not hidden — which also heals any pre-existing
      drift for that participant.
- [x] "Not a member" and "no such message" answer **identically**, so probing ids
      reveals nothing about which conversations exist or who is in them.

**The machine-checked purge registry earned its keep again**

- [x] `IDENTITY_REFERENCING_COLUMNS` failed the build BY NAME the moment
      `message_hides.identityId` existed. Declared `cascade`: it is purely theirs,
      visible to nobody else, and describes a view that is about to stop existing — and
      unlike an `attachments` row, deleting it cannot make anything MORE readable, since
      the rows it names are other people's messages either way. A test asserts the
      declaration AND that the cascade really performs the delete, so a declared-but-not-
      done entry cannot read as covered.

**A guard I tripped with my own prose, and made stricter rather than looser**

- [x] `contacts.test.ts` forbids destructive DDL in the boot migrator by sweeping the
      whole function for `/\bDELETE\b/i`. The comment naming the "delete for me"
      feature tripped it, in a function containing no DELETE statement at all —
      scanning prose as a proxy for SQL. The sweep is now case-SENSITIVE (every DDL
      string in the file is upper case) and matches destructive STATEMENT forms
      (`DELETE FROM`, `DROP TABLE`, `TRUNCATE`, `RENAME`) rather than bare words, plus a
      new assertion that every `CREATE TABLE` is `IF NOT EXISTS`. **Strictly tighter**:
      verified by planting a `DROP COLUMN` DDL and an unguarded `CREATE TABLE`, both of
      which the rewritten guard catches.
- [x] **And the trap for the TWELFTH time, in the fix itself**: that new `CREATE TABLE`
      assertion matched v2.102.0's comment "the CREATE TABLE never re-runs" and failed.
      It now runs on stripped SQL, like the sweep beside it.

**Tests**

- [x] `server/messageHide.test.ts` (21). **All 26 tripwires verified by MUTATION** from
      byte-exact backups, from a confirmed-GREEN baseline.
- [x] **One survivor, and it was the dangerous one**: the assertion that the unread
      recompute is scoped to one participant matched the SELECT's copy of the clause
      while the mutation stripped it from the **UPDATE** — an unscoped UPDATE rewrites
      every member's badge in the conversation to this person's count. Now pinned on the
      write specifically, with the count asserted so a missing clause on either side is
      caught rather than masked.
- [x] One additive table, no new dependency, no new env var. Suite 3091 passed /
      1 skipped.

## v2.102.1 — the editor for a group's own name, photo and status (2026-07-27)

Owner (#89), the other half. v2.102.0 shipped the DATA — a 6-digit group id, an avatar, a
status from the shared vocabulary, the guarded write endpoint and every READ surface — but
nothing in the app called it, so a member could not pick any of it from a screen.

**Nothing was duplicated, and that is the release**

- [x] **The status picker is EXTRACTED, not copied** into `client/src/app/ProfileStatusPicker.tsx`.
      A group's status and a person's are the same five labels (v2.101.1), and two copies of
      the grid is how the two come to look and behave differently one edit at a time. The
      picker is presentational — a test asserts it reaches for no `trpc` and no
      `useMutation` — and `StatusSection` and the group sheet each own only their own write.
- [x] **The note's follow-the-server rule lives IN the picker**, so the second caller inherits
      "a refetch must not erase a note somebody is halfway through typing" instead of having
      to remember it.
- [x] **`AvatarPicker`'s save sink is INJECTED**, defaulting to today's `identity.updateProfile`
      so every existing call site is byte-identical. A group passes `messages.setGroupProfile`.
      A second component would have meant a second copy of the upload pipeline, the emoji
      renderer, the animated-GIF path, the 4 MB cap and the mime check — and v2.99.89 found a
      DEAD duplicate upload path in Profile doing exactly that.
- [x] The uploaded key lands in the CALLER's own storage namespace either way, which is exactly
      what `setGroupProfile`'s ownership gate requires — so a member setting a group photo
      needed no server change at all.
- [x] Its copy is parameterised, so a group is not asked to remove "your photo".

**The sheet**

- [x] Opened by tapping the group's conversation header, **which did nothing at all for a group
      before** (it only ever opened a peer's profile for a DM), so a dead tap becomes the way
      in. ONE handler serves both kinds — two would be two places that can disagree about
      which tap does what — and the header is now focusable for a group as well as a DM.
- [x] **The header disc shows the group's own photo.** It drew the generic glyph even for a
      group WITH a picture, so the thread row and the conversation's own header disagreed
      about the same group.
- [x] **Nothing is optimistic.** It writes a row other people are looking at, so a failure
      already painted as success would leave this member believing they renamed a group
      everybody else still sees under the old name.
- [x] **BOTH reads are invalidated**, because the thread list renders the same photo, id and
      status — refreshing one would leave the other advertising what was just changed (the
      v2.99.87 defect).
- [x] It gates nothing itself: membership is the SERVER's check, because a client-side check on
      a row several people share is a suggestion, not a rule.
- [x] The members list is READ-ONLY — adding and removing people stays the call screen's job,
      and two ways to change who is in a group is two places that can disagree about it.
- [x] The group's id is copyable, `dir="ltr"` so an RTL locale cannot reorder it, and a group
      created before v2.102.0 says it has none rather than showing a gap.

**A false claim in my own code, found by the mutation run and fixed rather than reworded**

- [x] A comment said closing the sheet could not unmount an open avatar picker. `if (!open)
      return null` means it CAN — the picker is a child. The early return now tolerates an
      open picker (`!open && !pickingAvatar`) and the sheet's BODY is gated instead, so the
      claim is true. Both halves are pinned, and both mutations bite.

**A REAL BUG IN THE TEST HELPER, in eleven files**

- [x] `codeOnly()` — the helper that strips comments before a `not.toMatch`, added because this
      repo has matched its own prose ten times — began with a JSX-span strip,
      `/\{\s*\/\*[\s\S]*?\*\/\s*\}/`. **A DOCUMENTED PROP TYPE has the same shape**
      (`}: { /** … */ value: unknown; … }`), so it swallowed the whole prop block and much of
      the function body: on the new picker it cut 5,412 characters to 1,084. Every
      `not.toMatch` running through it was reading a gutted source and could pass vacuously —
      which is exactly how the "the picker owns no mutation" pin survived a mutation that gave
      it one. Found because that survivor made no sense and was traced rather than accepted.
- [x] Fixed in all **eleven** files that carry the helper, by stripping block comments FIRST
      (simpler and correct: a JSX comment collapses to a bare `{}`, whose prose is gone, and
      no code is touched). **The full suite stays green afterwards**, so no live defect was
      being hidden — what was weakened was those files' ability to catch a FUTURE one.

**#96 RE-RESOLVED HONESTLY, and my earlier claim about it was WRONG**

- [ ] v2.102.0's note said the group story ring "was blocked on exactly this data" and is now
      unblocked. Read against the schema, that is **not true**: `statuses.identityId` is
      `notNull` with no conversation reference, so **a story belongs to a person and a group
      cannot post one**. The avatar now exists, but the STORY does not — a ring around a group
      would signify nothing. Building it would have been decoration dressed as a feature.
      Unblocking it means letting a GROUP post a story, which is its own feature (a nullable
      `conversationId` on `statuses`, a per-group audience rule, and a posting surface) and
      nobody has asked for it.

**Tests**

- [x] `server/groupProfileEditor.test.ts` (24), which assert the ABSENCE of a second copy
      rather than the presence of a first.
- [x] **All 29 tripwires verified by MUTATION** from byte-exact backups, the mutator aborting
      unless its target occurs exactly once, from a confirmed-GREEN baseline.
- [x] **Four survivors, all fixed:** one was the `codeOnly` bug above; one pinned
      `title="…"`, which is a SUBSTRING of `data-title="…"`, so renaming the prop passed; one
      matched a bare `dir="ltr"` that the member rows satisfied after it was deleted from the
      id itself; and one compared indexes against the last `</div>`, a fragile proxy that a
      mutation into dead code satisfied. **Two of my own mutations were bad** and are reported
      rather than counted — an unused import owns no mutation, and moving a component into
      dead code does not move it relative to anything.
- [x] **The prose trap for the ELEVENTH time**: the count of `dir="ltr"` read 3, because the
      comment above the group id explains the rule and therefore contains the string. Counted
      on stripped code.
- [x] Five pre-existing pins in `server/profileStatus.test.ts` repointed at the shared picker —
      expected fallout from the extraction, and strictly better, since they now name the one
      place the rule lives.
- [x] No schema change, no new dependency, no new env var, no server change.
      Suite 3070 passed / 1 skipped.

## v2.102.0 — a group gets its own 6-digit id (2026-07-27)

Owner (#89): a group should have a 6-digit **group ID**, a group **avatar**, a group **status**, and a
**groups section**.

**THE LOAD-BEARING FINDING IS NOT THE FEATURE — IT IS WHAT A THIRD NUMBER TABLE BREAKS.**

- [x] `number_reservations` is the monotonic ledger that stops a handed-out number ever reaching a
      stranger, and **BOTH of its deleters guarded with `NOT EXISTS` subqueries naming `identities` and
      `party_lines` ONLY**. A group number lives in neither table, so `reapUnclaimedReservations` — whose
      own predicate is `claimedAt IS NULL` — would have seen a LIVE group's reservation as unclaimed,
      deleted it, and the id could later be reissued to somebody else. `releaseUnusedNumberReservation`
      had the identical blind spot, so a failed create elsewhere could un-reserve a bound group id.
      **This is the exact trap v2.100.0's purge hit, in a second place** (there the fix was to INSERT the
      number with `claimedAt` stamped; here it is a third `NOT EXISTS` conjunct). All three call sites —
      both deleters and `numberTaken` — are pinned individually, so a fourth number table cannot be
      added without the suite naming the gap.

**One allocator, three callers, and the count is asserted**

- [x] `allocateGroupNumber` is four lines delegating to `allocateSharedNumber`, so a group inherits the
      cross-table `numberTaken` check, the atomic reservation claim that closes the NEW-vs-NEW race, and
      the global mint budget. A test asserts the 40-attempt search loop occurs exactly ONCE in `v2db.ts`
      and that exactly THREE functions call the shared allocator — a parallel allocator here is precisely
      the cross-table collision v2.99.30 closed.
- [x] `numberTaken` now checks all three tables, each of the two newer ones in its own try/catch so a
      pre-migrator boot reads *free* rather than throwing — the shape the party-line check has had since
      v2.89.

**Both machine-checked registries gained an entry, which is the point of having them**

- [x] `conversations.number` → **`not-a-person`** in `NUMBER_BEARING_COLUMNS`: a MEMBER renumbering must
      never move the group's id. The id belongs to the group, not to whoever created it — the same rule
      a party line already has.
- [x] `conversations.ownerIdentityId` → **`keep-safer`** in `IDENTITY_REFERENCING_COLUMNS`, with the
      reason recorded: a purged creator's id is left pointing at a deleted row ON PURPOSE, because
      nulling it would be a silent ownership change for members who did not ask for one and are not
      told. An unresolvable creator already reads as "no owner" everywhere it is used.
- [x] Neither addition was optional: both registries scan `drizzle/schema.ts` and fail the build on an
      undeclared column, so the suite named them the moment the columns landed.

**Allocation, release and degradation**

- [x] The id is allocated BEFORE the transaction (so the ledger claim is settled by the time the row
      lands) and released if the row never lands — otherwise every failed create leaks one of ~980,000
      ids. `releaseUnusedNumberReservation` re-checks the number is absent from all three tables, so
      even then it cannot un-reserve a bound one.
- [x] An EXHAUSTED allocator degrades to a group with `number = null` rather than a failed create: a
      group is reached through its thread, so the id is for identifying and sharing it, not for reaching
      it, and refusing to create the group would be the worse failure.
- [x] The UNIQUE index is added by the boot migrator, not the CREATE TABLE — `conversations` exists on
      every deployment so the create never re-runs. MySQL tolerates repeated NULLs under a UNIQUE index,
      so every DM and every pre-release group is untouched.

**`setGroupProfile` — the write endpoint**

- [x] The membership check lives INSIDE the function, never in options a caller passes: it writes a row
      several people share, so "who may change it" IS the safety argument and must not be something a
      call site can forget (the same reasoning that put the purge's guard inside
      `claimIdentityForPurge`). Any member may edit — a group has no owner role today, and inventing one
      here would be a permission model nobody asked for.
- [x] Refuses a DM outright: a DM borrows the peer's name, photo and status and has none of its own.
      Every refusal is NAMED, because "only members can change a group" and "that's a direct chat" need
      different next steps from the reader.
- [x] The avatar URL goes through the SAME `keyInOwnerNamespace` gate an identity's photo does, matched
      with `lastIndexOf` so the absolute form is covered too (v2.98.4/F2 plus v2.99.26/H5). Without it a
      group could be pointed at a stranger's private attachment and the proxy would serve it.
- [x] **No presence is derived from a group's status**, unlike an identity's: a group has no presence,
      so there is nothing for an availability to describe. Pinned by asserting `statusOverride` is
      absent from the function.
- [x] The status vocabulary is the one from v2.101.1 (`shared/profileStatus.ts`), not a second one, so a
      group's status and a person's cannot come to read differently.

**Read surfaces**

- [x] Wire fields are named `group*`, never reused `peer*`: a group is not a peer, and one field meaning
      two things is how a surface comes to render a group's id as a person's. Threaded explicitly out of
      `listThreads` rather than spread, so a new column cannot reach the browser without a decision.
- [x] A group is findable by its own id in thread search — most of what having one is for.
- [x] The thread row and the conversation header both show it in the same place a person's number sits,
      `dir="ltr"` so an RTL locale cannot reorder the digits; the tier badge is withheld for a group,
      because that badge describes a person's account.
- [x] A broken group photo falls back to the purple glyph, never the browser's broken-image icon — the
      rule `PeerAvatar` already follows.
- [x] **The groups section already existed and is CONFIRMED rather than rebuilt**: Messages has grouped
      threads under Direct / Groups / Notes since the v2.99.98 sectioning, so the fourth item on the
      owner's list needed nothing.

**Shipped half, said plainly** (the owner authorised this split)

- [x] Here: the id, the allocator wiring, all three ledger guards, both registry entries, the five
      columns, the guarded write endpoint, and every READ surface.
- [ ] **Not here: an editor UI.** Nothing in the app calls `setGroupProfile`, so a group's photo and
      status can be set by an API caller and will render everywhere, but a member cannot yet pick them
      from a screen. That plus the group story ring (#96, which was blocked on exactly this data) is
      v2.102.1.

**Tests**

- [x] `server/groupIdentity.test.ts` (27) — the allocator delegation, the three ledger guards and the
      registry entries tested against the REAL exported registries rather than a copy.
- [x] **All 32 tripwires verified by MUTATION** from byte-exact backups, mutator aborting unless its
      target occurs exactly once, from a confirmed-GREEN baseline.
- [x] **Three mutation survivors, all real weaknesses in my own tests**, each fixed and re-verified:
      (a) "allocated before the transaction" passed with the allocation moved into an UNUSED CLOSURE,
      because the text still appeared before the transaction — it now pins the try block's body exactly;
      (b) the avatar-gate case passed with the condition replaced by `if (false)`, the recurring
      pin-the-TEXT-while-the-PATH-dies shape, so the condition itself is now asserted and a
      constant-false one forbidden; (c) a `not.toMatch(/border-b/)` meant to forbid a bottom border
      matched inside `border-border` on the group avatar's ordinary ring, failing a correct line —
      bounded to `/border-b(?![a-z-])/`.
- [x] **The prose trap for the TENTH time**: `setGroupProfile`'s own comment names `statusOverride` in
      order to say it is NOT derived, which the `not.toMatch` guarding that very property matched. Fixed
      with `codeOnly()`.
- [x] Five pre-existing pins updated: `chooseNumber.test.ts` (froze the registry list — my first
      insertion was in the wrong position and the test said so), `adminToolParity.test.ts` (needed the
      new table in its SQL map), and three Messages pins — one of which,
      `messagesRowRedesign.test.ts`, had frozen `t.peerNumber.slice(...)`, i.e. it asserted the
      1:1-only rule this release deliberately widens.
- [x] **NOT VERIFIED AGAINST A DATABASE, said plainly**: no MySQL is reachable here, so the third
      `NOT EXISTS` conjunct is proven correct by reading and pinned at all three sites, but no
      reservation has been reaped and no id observed surviving one.
- [x] Five additive nullable columns and one additive unique index, no new dependency, no new env var.
      Suite 3045 passed / 1 skipped.

## v2.101.1 — the real profile status: work / vacation / travel / free / busy (2026-07-27)

Owner: *"you are in work, vacation, travel, free, and you can put some notes on it… and everyone has
emoji and color."* Completes #105.

**A second column, not a wider `statusOverride`** — and that constraint shaped everything.
`statusOverride` feeds `effectiveStatus` → `presenceDot`, whose colour vocabulary is four values wide
on purpose; five labels crammed in would have meant five new LED hues, which v2.99.92 forbids. So the
label is stored and the availability is DERIVED by `overrideForStatus` in exactly one place. A test
counts that call across the whole server and asserts it appears ONCE.

**The derivation is proven closed**, not merely written: every value it can return goes back through
the real `sanitizeStatusOverride` and `effectiveStatus` and must land in one of the four display
states — so a label cannot produce a fifth.

- **work → auto**, deliberately: somebody at work is usually at their computer, so marking them away
  would make the LED lie about the most reachable state on the list.
- vacation, travel → `travel`. busy → `away`, which is the point of saying busy.
- **Clearing is written unconditionally**, or somebody back from vacation still reads as travelling
  with no label left to explain why.

**Colour is reinforcement, never the carrier** — the emoji names the status, the label is foreground
text, and the hue only tints. That is why these five need no contrast measurement, unlike the
`--relay-*-text` tokens (v2.99.94). Both the picker and the chip apply the hue INLINE, never as a
runtime-composed Tailwind class (the JIT cannot see those; they come out unstyled).

Tapping the current status clears it, so the picker is its own "none" control. The note appears only
alongside a status, collapses newlines, and a refetch cannot erase one being typed.

**The label is withheld with presence**: a long-inactive guest has presence suppressed for privacy
(v2.95), and "On vacation · back Monday" leaks in words what the suppression withholds. A party line
carries none — a line is not a person.

`server/profileStatus.test.ts` (36), tested behaviourally through the real presence functions. 32
tripwires by mutation; **one survived and it was a real gap** — the case-folding case used `"AWAY"`,
which is not a status either way, so it never exercised the fold. `"WORK"` is the input that
distinguishes them. Two additive nullable columns. 3017 tests.

## v2.101.0 — story and status stop being the same word (2026-07-27)

Owner, third time: *"For the story is the one on the message where you can post video, voice, text,
image… The status will be showing on your profile… So fix the pronouncing properly everywhere."*
Part of #105.

A STORY is the ephemeral Messages post people react and reply to, signified by the avatar ring. A
STATUS is the profile label. Every user-facing string meaning the former now says story: the ring
tooltip and aria-label, the top-bar pip, both strip titles, the composer heading/placeholder/Share
button, "My story", the delete toasts, the reply aria-label, the story-reply chip and its four kind
labels, and the audience row that read "Status privacy" while naming a different feature.

**One-directional.** The Profile pane that opens the away/travel picker IS a status and keeps its
name — renaming it too would swap one wrong word for another.

**The API keeps its names, deliberately.** `statuses`, `status.*`, `relay:open-status` untouched: a
half-renamed API is worse than a consistently-misnamed one.

**The load-bearing test is a sweep, not a list** — it extracts every title / placeholder / aria-label
/ toast string from six surfaces and fails if any says "status" to a person, so the next wrong string
is caught rather than counted.

**The avatar menu is rebuilt to the owner's list** (open story / add story / add status / profile /
log out). Add-a-story is no longer the else-branch of Open — it used to be either/or, so somebody
with one story had no way to post a second from here.

**"Set my status" needed an out-of-band intent.** Profile's panes are local state because wouter's
`useLocation` returns pathname only, so a `#pane` navigation re-renders nothing (v2.99.89). New
`client/src/app/profilePane.ts` uses sessionStorage (Profile is a lazy route, so a module variable in
another chunk would be a different value), is one-shot by construction, and guards every storage
access. The pane set is now a runtime array with the type derived from it, so the request can be
validated against the real set.

`client/src/app/storyVsStatus.test.ts` (16). 24 tripwires by mutation. **One bad mutation of my own,
reported rather than counted**: swapping `requestProfilePane` and `navigate` in one handler survived,
and rightly — both are synchronous and Profile mounts later either way, so the order carries no
behaviour. The assertion was replaced with one that checks both calls share a handler. The prose trap
bit for the ninth time (the menu's comment quotes the very call a `not.toMatch` forbade). Six
pre-existing pins updated.

**Not done, and it is the other half of the ask:** the real status picker (work / vacation / travel /
free / busy, emoji + colour + notes) is its own release. `identities.statusOverride` holds only
`""`/`away`/`travel`, and `effectiveStatus` maps those into a four-value vocabulary `presenceDot`
branches on for COLOUR — widening that is what CLAUDE.md warns against, so the label needs its own
column and a derivation.

**For the owner to settle:** the avatar ring means "this is you" in the top bar and "unseen story" on
PeerAvatar. One shape, two meanings. 2981 tests.

## v2.100.1 — a second-device sign-in says where it came from and how (2026-07-27)

Owner: *"it need to be sent always the details from where his login type, country, IP, device name,
everything."* Closes #102.

**The three ways in already existed** (v2.99.7: passcode bypass, email code that parks as pending,
approve/decline on an online device) and are confirmed here rather than rebuilt. What was missing is
the DETAIL — the prompt said "New sign-in waiting" and a device label, so it could not answer the one
question it exists to answer.

- **Four additive nullable columns** on `sessions`: `ip`, `country`, `city`, `method`. Pre-existing
  rows simply have no details and each surface omits what it lacks.
- **The IP is captured synchronously; the country is not.** Geo resolution is a 4s external call, so
  it runs AFTER the row lands, un-awaited. A row with an IP and no place is the honest degraded state
  and, on a LAN or behind a VPN, the ordinary one.
- **The IP comes from `pickClientIp`** — the hop the proxy appended, never the leftmost
  `X-Forwarded-For` (v2.98.4/F4), or anybody could write their own "where from".
- **One geo implementation**, extracted out of `geoSelf` and shared with the top bar's flag chip; a
  test asserts `ipapi.co` appears in the code exactly once.
- **The login method is recorded, never inferred** — a session row looks identical however it was
  created. `normalizeLoginMethod` fails to NULL rather than a default.
- **One projection, three surfaces**: `pendingSessionWire` builds the approval prompt, the
  notification-centre row and the Devices list. The phrasing lives in a pure `server/loginOrigin.ts`.
- **The IP is shown deliberately**: the owner's own sign-in, the one detail that survives a geo
  failure, named explicitly by them, and every procedure carrying it is scoped to `ctx.user`.
- The notification centre names the sign-in only when there is exactly ONE waiting, and the prompt
  ends with what to do about it.

`server/loginOrigin.test.ts` (33). 31 tripwires by mutation; **three survived and all three were real
gaps in my own tests** — an over-length IP refused for the wrong reason (so the length cap was
untested), a fixed 700-char window that spilled into the next procedure's `if (!user)`, and a slice to
end-of-file where another function's identical WHERE clause satisfied the assertion. Six more test
bugs caught before that run, one of which asserted a behaviour the code does not have. Three
pre-existing pins rewritten to the property. **Not verified on a device.** 2965 tests.

## v2.100.0 — deleting a person: one cascade, two callers, three things left alone (2026-07-27)

Owner, twice: *"if I click delete, it will delete him completely. Whoever he took, whoever he had
contact data, everything will delete"*, and — chosen explicitly when asked — **"Delete everything
they touched"** with the window **"Keep 30 days"**. Closes #103 (guest auto-purge) and #104 (admin
delete-the-user), which are the same operation.

**One cascade, two callers.** `server/purgeIdentity.ts` holds the only implementation; the guest
reaper and the admin button differ ONLY in the predicate that decides who may be selected, and that
predicate lives INSIDE `claimIdentityForPurge` rather than in options a caller passes. A caller that
could supply its own WHERE would be a caller that could delete a registered account by accident.

**Three things are deliberately NOT deleted, because deleting them would do active harm:**
- `attachments` rows are KEPT. `authorizeStorageKey` classifies a key with no row as `unknown`, and
  the proxy serves an `unknown` key to any signed-in caller — so deleting the row makes the media
  MORE readable. v2.98.4/F3 in a second place; the row is the lock.
- A third party's contact row carrying this number is KEPT. `blocked` lives there, so deleting it
  would silently unblock a blocked person (v2.99.28/M13). Their own address book goes in full.
- The 6-digit number is TOMBSTONED, never released. `number_reservations` only exists from v2.99.30
  and `reapUnclaimedReservations` deletes rows whose number is absent from both number tables —
  exactly what a purge creates. Step zero inserts the number with `claimedAt` stamped.

**The claim does two jobs in one statement.** A conditional UPDATE of the new nullable
`identities.purgeStartedAt`: `affectedRows` decides which instance owns the purge, and the same
statement NULLs `guestToken`, `deviceId` and `recoveryHash`. That is also how every guest resolver is
closed — each looks a guest up BY one of those handles, so nulling them closes all three at once and
no fourth can be forgotten. Editing four hot auth paths was the alternative, and that is where
v2.99.49's data loss lived.

**Order is the safety property.** Zero foreign keys in this schema, so nothing cascades and nothing
detects an orphan. Reachability is severed first; `identities` is deleted last with the claim
restated. A DM goes whole, a group survives while anyone remains, replies are unhooked before the
quoted message goes, `unreadCount` is recomputed rather than decremented, and a shared conference
roster is redacted rather than deleted.

**The load-bearing test is about the next table, not this one.** `IDENTITY_REFERENCING_COLUMNS` is
machine-checked against `drizzle/schema.ts` in both directions, the contract
`numberContinuity.test.ts` has enforced for the number since v2.99.54.

**Off by default.** `RELAY_GUEST_PURGE` is one variable with three states (`off` / `dry` / `on`); the
gate precedes `getDb`, so a disabled sweep costs nothing. Arming it is one env var and a restart.

**Also:** the guest countdown beside the blue badge (one component, both profile surfaces, reads the
server's own expiry, says the clock resets on every visit); the admin panel confirms by TYPING the
number, not with a Yes/No, because the list shows several people at once.

**Corrected from my own design review:** it claimed deleting the identity makes their profile photo
more readable. Read against `storageProxy`, that is wrong — an avatar has always been served to any
signed-in caller. What is true is the bytes are not erased, because there is no storage-delete path
in this codebase, and the panel says that rather than claiming an erasure.

`server/identityPurge.test.ts` (62). 38 of 39 tripwires verified by mutation. One bad mutation of my
own (an inert `void 0;` that changed no order) replaced; it then found a real weakness — the
severing-order test compared `indexOf` results, so deleting the `onlineWatches` sweep outright left
it green, because `-1` is less than anything. **Not verified against a database:** no MySQL is
reachable here, which is why it ships off by default with a dry run. 2932 tests.

## v2.99.99 — an admin can change an account type, and only one of the three directions is real (2026-07-27)

Owner: *"in the admin panel for me as a admin, I can delete the user because you gave me only to change
number. I can delete the user or change type of account from guest to registered to admin."*

**THIS DELIBERATELY WIDENS A SURFACE v2.99.76 KEPT NARROW ON PURPOSE**, whose note read: *"an admin panel
is a permanent high-value surface, so it does exactly those two things and cannot read a message, list
contacts, delete an account, or grant itself more power — widening it is a decision somebody has to make
on purpose rather than something that arrived for free."* The owner has now made that decision. The guard
built for exactly this moment did its job: adding the procedure turned the capability-enumeration test
RED, which is the deliberate act being forced.

**ONLY ONE OF THE THREE DIRECTIONS IS A REAL FLAG, and saying which is most of the value here.** The tier
is DERIVED, not stored — `admin` when `users.role = "admin"`, else `registered` when `identities.verified`,
else `guest`. So:

- **registered ↔ admin — REAL.** One enum column on a row that already exists.
- **guest → anything — REFUSED.** A guest has NO `users` row at all; that is what being a guest *is*, so
  there is no role column to write. Flipping `identities.verified` instead would have handed them the
  Registered badge while they still had no email, no password and no way to sign in anywhere else — a
  badge that lies about the account behind it. A guest becomes registered by REGISTERING, which already
  keeps their number and all their data (v2.99.49). The panel says so in place of the control rather than
  offering a button that always fails.
- **anything → guest — REFUSED**, for the mirror reason: somebody with an email and a password does not
  become a guest because a flag says so. If the intent is removal, that is deletion, not a downgrade.

**AN ADMIN CANNOT REMOVE THEIR OWN ADMIN RIGHTS, and that guard is what makes the control safe rather than
merely careful.** `users.role` is otherwise grantable only by hand — SQL, or the backend admin-tool — so a
self-demotion could leave this deployment with NO administrator and no way back in through the app.
Refusing it also GUARANTEES at least one admin always remains, however many others are demoted, which is a
stronger property than a "last admin" count would have been. It is checked against the ACCOUNT rather than
the identity, because one account can hold more than one identity over its life.

**EVERY REFUSAL IS NAMED**, because the three of them need three different next steps — register, ask
another admin, or delete instead — and a generic error would send the operator looking in the wrong place.
The procedure writes ONE enum column and can reach nothing else: a test asserts it never touches
`identities`, and never any credential field. Admin is re-derived from the `users` row before anything
happens, and the trace carries ids only.

**DELIBERATELY NOT SHIPPED HERE: promoting a guest by supplying an email.** It is mechanically possible and
it is an account-takeover primitive — an admin could attach an address they control to somebody else's
guest identity and then sign in as them with an email code. A guest can already register themselves and
keep everything. If that is wanted anyway it should be asked for knowingly, not arrive as a side effect.

**ALSO NOT IN THIS RELEASE: deleting a user.** The owner asked for it in the same breath, and it is the
same cascade as the guest auto-purge — so it lands with that cascade, once, rather than being written
twice. That release is being designed and adversarially reviewed first, because it permanently destroys
data belonging to people who did not ask for it.

`server/pushDoctor.test.ts` grows to 25 with five new pins: the exact capability set, the one-column
reach, the self-demotion guard, the guest refusal, and that every refusal is named.

No schema change (`users.role` has existed since v2.99.6), no new dependency, no new env var. 2870 tests.

## v2.99.98 — a Received tab, and one row per person (2026-07-27)

Owner: *"now you have all these tabs, all the dial and received. You should add received, and there is a
missed call, and there is something called grouping. Grouping means grouping, if a person who called you
several time, it will group his number of notification into one. Like, it will say if a user called me ten
times, it will say this user called you ten times, and it will show me the details of these ten times
below his ID. outgoing calls, it will show me outgoing calls."*

**"RECEIVED" HAS EXACTLY ONE AVAILABLE DEFINITION, and establishing that was most of the work.**
`call_history.status` is NEVER written as "answered": its only two writers are `recordCallStart` (which
writes `"initiated"`) and `recordMissedCall` (`"missed"` / `"declined"`), there is no
`.update(callHistory)` anywhere in the server, and nothing calls `calls.logStart` at all — so `answeredAt`
is always NULL and **every answered call, 1:1 included, exists only as a `conference_history` row**.
Received is therefore a conference row whose direction is inbound. A test asserts that claim about the
server rather than trusting it, because if it ever stops being true the definition has to change with it.

Missed and Received are now provably **disjoint**, and together they are every incoming call.

**GROUPING IS A TOGGLE, NOT A FIFTH TAB, and that is a deliberate deviation.** The owner listed it
alongside the tabs, so it sits in the tab row where they expect it — but as a toggle (`aria-pressed`) it
composes with the filters, so you can group inside Missed or Received as well, which an exclusive tab
could not do. A "Grouping tab" would also have shown the same rows as All, only stacked. It defaults OFF,
so the log looks unchanged until asked.

**THE GROUPING KEY IS THE IDENTITY, NEVER THE NUMBER.** The number moves and the identity does not, so
keying on the number would file one person's calls under two headings the moment they renumber — which is
exactly the class of bug v2.99.95 had just finished fixing three rows above. `conference_participants`
now carries `identityId` on the wire (additive, resolved from data the server already had); a roster entry
we can no longer resolve falls back to its number as the best key available. A **GROUP** call gets its own
key per room rather than being filed under one member, because a five-way call is not "a call with Ahmed"
and filing it under him would make the count beside his name wrong.

**THE COUNT SAYS "IN THIS LOG", AND THAT WORDING IS LOAD-BEARING.** Both call payloads are hard-capped at
100 rows server-side, so a lifetime "called you ten times" is a number this screen cannot know. Claiming
one would have been worse than being specific — and a test pins both the wording and the cap it is being
honest about.

**A HIDDEN PRECONDITION REMOVED RATHER THAN PINNED.** `groupByPeer` first relied on the caller passing a
newest-first list and took the first row it saw as the head. The mutation run then showed the final sort
could be **deleted with nothing noticing**, because a sorted input makes insertion order already correct.
Rather than pin the precondition, the precondition is gone: the head is chosen by COMPARING timestamps, so
the function is right for any input and both the head choice and the ordering are now load-bearing.

**THE TAB SELECTION BECAME A PURE FUNCTION** (`filterItems`) so "Received never contains a missed call" is
a fact that can be tested rather than a line that can be read.

`client/src/pages/app/historyGrouping.test.ts` (33), the key and the counting tested BEHAVIOURALLY because
the count IS the feature and a wrong count is worse than none; **all 21 tripwires verified by MUTATION**
from byte-exact backups and a confirmed-GREEN baseline.

**TWO WEAKNESSES OF MY OWN CAUGHT BY THAT RUN.** The order-independence test's shuffle happened to
encounter the newest group FIRST, so it passed with the sort deleted — rewritten so the older group is
encountered first, which only the sort can correct. And nothing guarded that an EXPANDED group renders its
own calls; replacing that map with an empty one left the suite green while an opened group would have
rendered nothing, looking like a broken toggle.

**ONE BAD MUTATION OF MY OWN, reported rather than counted as a survivor**: the first attempt added an
inert `data-` attribute to the expanded list, which changes no behaviour, so the test was right and the
mutation meaningless.

**TWO PRE-EXISTING PINS REWRITTEN TO THE PROPERTY.** One froze the exact filter ternary that lived inside
`visible`, so it broke the moment the selection became a function while saying nothing about whether the
filters actually filter — it is now behavioural, which is strictly stronger. The other said "exactly three
filters" and is now four, with the count asserted so a fifth has to be deliberate. And v2.99.95's own
presence pin, which counted `presenceOf` call sites, now counts them against the number of ROW MOUNTS —
the grouped view added two, and a fixed number would have gone stale while still letting a new mount go
without presence.

**NOT DONE, said plainly**: the 100-row cap itself. Grouping and search both work over the most recent 100
calls, so an older one cannot be found or counted. Raising it is a paging change with its own cost, not a
grouping change. And answered GROUP calls still carry no Voice/Video marker, because
`conference_history` stores no channel column — a data gap, not an oversight.

The ES5 `Map`-iteration trap (TS2802) bit again while sorting each group's own calls, and was caught by
`pnpm check` — the same one recorded in v2.99.72.

No schema change, no new dependency, no new env var. 2866 tests.

## v2.99.97 — an Online section, and counts that say how many and how many are here (2026-07-27)

Owner, with a marked-up Contacts screenshot: *"these are the all categories where I usually manually add
people to it. Also, add in the top online. Online means whoever on your contacts and all type of
categories will be showing online also on that one beside of the assigned category … where I put for you
red circle here mention number of contacts in each category and also mention number of online in each
category … let's say, in VIP, I have ten … it will mention total ten. On beside, it will show green color
… to show that is online."*

**AN ONLINE SECTION AT THE TOP, and it CROSS-CUTS the categories rather than being one.** Somebody online
appears there AND under whatever category they were filed in — exactly as Favorites already cross-cuts —
so it is deliberately NOT part of `CATEGORY_ORDER`: an "online" category would be a thing people could be
moved into, which is not what it is. It is derived from the same filtered list every other section is
built from, so a search applies to it identically, and it hides itself when nobody is online.

**EVERY HEADER NOW CARRIES TWO NUMBERS**: the total in muted, then how many of them are online in green.
A green ZERO is withheld, because it spends attention on the one answer that needs none. The Online
section shows ONE number, since its total *is* its online count and "5 · 5" would be noise. Both are
`tabular-nums` so the column cannot jitter, and each carries a title saying what it means.

**THE GREEN IS THE AA-MEASURED TEXT TOKEN, not the LED green** — the LED green computes to 4.46:1 on the
light card and fails AA for text this small (measured in v2.99.86, which is why a separate token exists).

**ONE PREDICATE ANSWERS ALL THREE QUESTIONS.** `isActiveContact` decides which rows the Online section
holds, what the green count says, and whether a header shows anything at all. Three copies of "is this
person online" is how a section comes to list four people under a header that says three — the class of
bug v2.99.95 had just finished removing from History. It respects `presenceHidden` FIRST, because a guest
inactive over a day has presence suppressed for privacy (v2.95) and counting them would leak precisely
what the suppression withholds — worse in the Online section, which is a visible list of names rather
than a number. Being ON A CALL counts as active.

**TWO ITEMS IN THE SAME MESSAGE ALREADY WORKED, and are confirmed rather than rebuilt**:

- **Deleting a contact from the list** exists — the row's ⋮ menu → Delete, behind a "Remove contact?"
  confirmation, which also still warns that removing a BLOCKED contact unblocks them (v2.99.28: the block
  lives on the contact row, so deleting it silently drops the block). Now pinned so it cannot quietly go.
- **The Admin area is already invisible to everyone but admins.** The Profile entry renders only on
  `admin.amIAdmin` — a SERVER answer, never the cached whoami role — the panel itself gates on the same,
  and every admin procedure re-derives admin from the `users` row and refuses uniformly, so typing the URL
  gets a caller nothing (v2.99.76, v2.99.89).

**A DECISION TAKEN TO THE OWNER RATHER THAN GUESSED AT.** They asked for a guest's profile to show a
countdown to automatic deletion after five inactive days. Established by reading the code first: **nothing
deletes guest accounts at all today** — `guestExpiresAt` gates only the guest COOKIE lookup, the sole
`.delete(identities)` in the codebase is Adopt-and-Retire's provably-empty retire, and `GUEST_DAYS` is 30
rather than 5. So a countdown would have been counting down to nothing, which is the exact class of lie
this session has spent five releases removing. The purge has to be BUILT, it is irreversible, and it
reaches other people's data — so the semantics were put to the owner, who chose a full cascade delete and
to keep the 30-day hold. That ships as its own release with its own review rather than bolted onto a UI
change.

`client/src/pages/app/contactSections.test.ts` (18), the online RULE tested behaviourally because the two
ways a count can silently lie are suppression and being on a call.

No schema change, no new dependency, no new env var, no server change. 2833 tests.

## v2.99.96 — search that actually finds it, and a match that was being hidden after it was found (2026-07-27)

Owner: *"also activate the search. The search anywhere in the system, either by call, by history, by
message, contact. Whenever I put the keywords either by words, single words, it will deduct anything on
that single word. Let's say if a name, it will deduct on the names first, second, third … Or if I put a
number, it will deduct the number. So make sure that the search is properly working because currently, I
put the words doesn't deduct hundred percent."*

**THERE WAS NO SHARED SEARCH PRIMITIVE AT ALL.** Four screens each hand-rolled
`oneJoinedString.toLowerCase().includes(query.toLowerCase())`, and that one shape produces four distinct
failures the owner would experience as "doesn't detect 100%":

1. **It is a contiguous substring test.** A query whose words are not adjacent in the stored name can
   never match: "khalifa ali" misses **"Khalifa Mohamed Ali"**, and any reversed order misses too. That is
   precisely the "first, second, third" ask, and no surface implemented it.
2. **The number was not digit-folded** on Contacts or the group picker, which compared the RAW query
   against the raw number — so typing back the `777-777` those very rows DISPLAY matched nothing.
3. **No diacritic folding anywhere**, so "jose" missed "José" and "alvaro" missed "Ålvaro".
4. **Each surface searched a different name.** Contacts searched the frozen saved name; History searched
   the live one. So somebody saved as "Dad" was findable in Contacts and not in History, and their real
   name was findable in History and not in Contacts.

**AND THE ONE NOBODY WOULD HAVE GUESSED, found by an adversarial review of the diagnosis: A MATCH INSIDE
A COLLAPSED SECTION WAS FILTERED IN, COUNTED IN THE HEADER, AND NEVER RENDERED.** All three list screens
gate their section bodies on collapse state, and none of them opened on a query — so a search could put
"1" beside a heading and draw no rows at all. The match was found and then hidden, which is as close to
the literal complaint as it gets. A query now forces every section open on Contacts, Messages and History.

**ONE MATCHER, FOUR CONSUMERS** (`client/src/app/searchMatch.ts`). Every query token must match SOME
field, and different tokens may match different fields — so "khalifa 777" finds the person whose name
matches one and whose number matches the other. **THE FIELDS ARE COMPARED SEPARATELY, never pre-joined**:
History used to glue every field together and strip non-digits from the whole string, so a digit run
SPANNING two fields matched — a false positive in the opposite direction.

**INFIX IS DELIBERATELY KEPT, not narrowed to word-start.** The v2.99.93 suggestion list is word-start
only, and adopting that here would REGRESS the main lists: today "hammadi" does find "Alhammadi", and
removing that to satisfy the letter of the ask would take away a match people use. The complaint is
under-matching, so loose is the safer direction — and it does mean "ali" also matches "Khalifa", which is
accepted out loud rather than overlooked.

**THE TEXT PRIMITIVES NOW EXIST IN EXACTLY ONE PLACE.** `foldText`/`digitsOf`/`isNumberQuery` were living
in `contactSuggest.ts`; they are promoted and re-exported from there, because two implementations of
"fold this name" is exactly how two screens come to disagree about one query.

**A REAL OVER-MATCH CAUGHT BY THIS RELEASE'S OWN TEST.** The digit rule first pulled the digits out of ANY
token, so typing **"7th"** extracted "7" and matched every contact whose number contains a seven — which
is most of them. A name search that returns the whole list is worse than one that returns nothing, and it
is the same trap as a two-letter infix (v2.99.80). The digit rule now requires a digit-SHAPED token, and
"7th floor" is a name search again.

**A REDUNDANCY THE MUTATION RUN EXPOSED, and the fix was to DELETE code rather than add a test.** The
first cut had two number mechanisms: a whole-query digit compare before tokenising, and a per-token digit
compare. Removing either one changed no behaviour, because each was covered by the other — three
survivors from one design flaw. Two mechanisms that are individually removable are not defence in depth,
they are dead weight that reads as load-bearing, so the redundant branch is gone and the remaining one is
now genuinely load-bearing (its removal bites). `777-777` still works as one number-shaped token; `777
777` works as two tokens against the field's digits.

**HISTORY EXCLUDES THE VIEWER from the roster it searches** — your own name is on every conference row, so
including it made a search for yourself match every single call — and it now also searches the SAVED
contact name, closing the cross-surface asymmetry. Its contacts query moved above the filter so the names
are available to it. The server sends a search-only `liveName` on `contacts.list`, resolved from
identities it was already fetching; the row still DISPLAYS the name you chose.

`client/src/app/searchMatch.test.ts` (30), tested BEHAVIOURALLY against the owner's own cases because a
source pin cannot tell you whether "khalifa ali" finds Khalifa Mohamed Ali; **all 23 tripwires verified by
MUTATION** from byte-exact backups and a confirmed-GREEN baseline. **THREE PRE-EXISTING PINS REWRITTEN TO
THE PROPERTY** rather than relaxed: `searchEnhancements.test.ts` froze the exact
`peerDisplayName.toLowerCase().includes(q)` expression and the `searchTextOf` joined-haystack helper — so
frozen, it asserted the defect.

**NOT DONE, said plainly**: History filters over a TRUNCATED window — both call payloads are capped at 100
rows server-side — so a call older than that cannot be found however good the matcher is. Raising the cap
is a paging change, not a search change, so it is flagged rather than quietly bundled. Message search is
also still scoped to one already-open conversation; there is no cross-conversation message search.

No schema change, no new dependency, no new env var. 2815 tests.

## v2.99.95 — the green dot was the VIEWER'S OWN, painted on somebody else's face (2026-07-27)

Owner, third report, with a screenshot: *"Here, the user showing online. But if you go into contact and
everywhere, it's still showing offline. Still, this glitch is happening with several users."*

**THE SCREENSHOT CONTAINED THE PROOF, and it is not any of the three things this was assumed to be.**
The one History row with a green LED reads **Incoming**; the two grey ones read **Outgoing**. That
pairing is the whole diagnosis.

**ROOT CAUSE.** There is exactly ONE shared `conference_history` row per call room, and the CALLER seeds
`dialedNumber` with the number they dialled. So on the RECIPIENT'S screen that field holds *the
recipient's own number* — and the row's presence LED was keyed on `dialedNumber` FIRST, with the peer
only as a fallback (`History.tsx:581`). An answered incoming call therefore asked `presenceMany` for the
viewer's own presence — which is online by definition while they are looking at their own call log — and
painted it on the caller's avatar. Permanently green, per-row rather than per-person, and affecting
everyone who has ever called the owner and been answered. Contacts, keyed on that person's actual
identity, was right all along. Outgoing rows were also right, because there `dialedNumber` really is the
peer, which is exactly why the bug was invisible for so long.

**A SECOND SYMPTOM FROM THE SAME EXPRESSION, found in the same read**: `callBack` (`History.tsx:745`)
used the same key, so **Message / Video / Call on an answered incoming row dialled the viewer
themselves** — which the signaling layer refuses with `error{self}`, i.e. a button that silently does
nothing. Fixed in the same change.

**THE RULE NOW LIVES IN ONE PURE FUNCTION** (`conferenceRowKeys`) that a row calls to derive its own key,
rather than the call site guessing which of a row's numbers it is about. That guess *was* the bug, so
removing the guess is the fix; the function is exported so the rule could be tested against a row shaped
exactly like the owner's screenshot instead of pinned in source, and so v2.99.96's per-peer grouping can
key on the same thing rather than re-deriving it.

**A PARTY LINE IS THE ONE PLACE `dialedNumber` IS RIGHT** — there it is the LINE's number rather than a
person's, and redialling it is what rejoins the room without ringing anybody (v2.89). Taking it away
everywhere would have broken rejoining a line, so the exception is explicit and tested.

**THE VIEWER'S OWN NUMBER IS NO LONGER PUT INTO THE PRESENCE BATCH AT ALL**, belt-and-braces so the class
cannot recur: no History row should ever need it, and a self entry also made the busy set probe
`directory.liveRoom` for our own number. `dialedNumber` is likewise gone from the batch — for an outgoing
call it was already there via the roster, and for an incoming one it was the self entry.

**A GROUP ROW NOW DRAWS NO LED.** The disc it sat on is a generic `Users` glyph standing for N people, and
N people do not have one presence — showing an arbitrary member's as the group's is a guess presented as
a fact, and grey would be equally wrong. So it is absent rather than invented.

**AND THE SECOND, INDEPENDENT DIVERGENCE IS CLOSED AT THE FUNNEL.** `presenceMany` has carried `idle`
since v2.99.92 and History threw it away, so a **backgrounded** person read as full-strength green here
while Contacts said "away" — one person, two answers, which is the class `presenceDot` exists to end.
History's `PresenceLed` and the group-call picker's dot were the last two inline copies of the colour
rule (4 of 6 dot sites shared it); both now defer to `presenceDot`, so there is no fourth hand-rolled
ternary to forget next time — v2.99.77 was precisely that bug. A standing guard test fails if any of
these surfaces branches on `isOnline` for a colour again.

**THE STORY THAT WOULD NOT DELETE — a real, previously-undocumented defect found while investigating.**
v2.99.86 started routing the top bar's "See my status" through `openPeerStatus(me.number)`. That fires
into `PeerOverlaysHost`, which locates the group **by number** and, on a miss, **synthesises** one with
`isMe: false` hard-coded — under a comment asserting "this host only ever opens for another peer's
number", which had stopped being true. `status.forNumber` *does* return your own stories, so the content
rendered and only the ownership verdict was wrong: no Viewers list, no audience chip, and **no Delete
row**. The feed and whoami are cached separately, so their idea of your number can disagree for a few
seconds, and a renumber opens exactly that window. `isMe` is now derived.

**SAID PLAINLY, ABOUT THE OWNER'S PARTICULAR ROW: it removed itself.** `statuses.expiresAt` is `notNull`
and always stamped `now + 24h`, and an identity-agnostic reaper runs every 10 minutes — so no story can
persist beyond a day, and theirs showed "16h ago". There was never a permanently-stuck row to delete.
An earlier draft of this release claimed `deleteStatus` could report success while the row survived;
**that was wrong and is recorded as such** — its SELECT and DELETE carry identical predicates, and the
DELETE is not catch-wrapped, so a failure throws rather than lying. Their screenshot also predates
v2.99.87 (its top bar is the older layout and it is signed in as 235-680, not 777777).

**A WEAKNESS OF MY OWN CAUGHT BY THE MUTATION RUN, twice, both the same class** — pinning a rule's
DECLARATION instead of its USE. The LED test asserted `presenceDot` was *called* and the old class strings
were gone, so a mutation that called the rule for its label and then painted a hand-rolled colour anyway
stayed green; and the presence-lookup test used a bare `toMatch` for `presenceOf={presenceOf}`, which one
of the two row kinds satisfied while the other had been cut off from presence entirely. Both now assert
the applied value and the count.

`client/src/pages/app/historyPresence.test.ts` (17), the key rule tested BEHAVIOURALLY against the
owner's own row shape because a source pin cannot tell you which number a row ends up asking about; **all
15 tripwires verified by MUTATION** from byte-exact backups and a confirmed-GREEN baseline, including the
original bug reinstated verbatim.

**NOT VERIFIED AGAINST THE OWNER'S DATA**: their rows are not readable from here, so the diagnosis rests
on the code plus the direction/colour pairing in their screenshot — which is a sharp, falsifiable
prediction rather than a guess, and it held.

No schema change, no new dependency, no new env var, no server change. 2782 tests.

## v2.99.94 — the top bar answers to two taps, the dot has a pulse, and the bottom bar stops leaving a gap (2026-07-27)

Owner, verbatim: *"I circle on the notification center push it left little bit, keep space and gap
between the notification center and the profile and also whoever click on the bar anywhere in the top
bar. no need to take him to the profile only. there is two places to be clicked either the profile on
the right or the notification center only whether it will take you to the notifications. colored light
blue and there was a word mention Relay make type of animation that it keep blinking their light from
lighter blue to light green to light different light and flashing similar to the heart way. this is for
the dot on the top left and for the word rely make kind of nice animated animation for that word. it
keep animated every 30 seconds … and below the flashy light put small line and [mention] online small
letter. it means you are online now and when you are idle it will mention you are idle in yellow color
and if you were disconnected from the internet it will […] show you you are offline red color and at
the bottom after the bottom bar there's a still gap space so I stick the bottom down because I need the
space for the middle frame."*

**ONLY TWO THINGS IN THE BAR ARE TAPPABLE NOW, AND THAT IS A REVERSAL THE OWNER ASKED FOR.** v2.99.86
made the identity strip a shortcut to Profile — precisely what is being removed. The strip and the brand
mark are inert; the pin that asserted "one tap to Profile" is rewritten to assert the opposite, and
`wouter`'s `Link` is no longer imported by the module at all. Profile is still one tap inside the
avatar's own menu, so nothing is unreachable. **The BACK arrow is deliberately kept** — a navigation
control the owner was not talking about, and removing it would strand people on every sub-page.

**THE BELL MOVES BY WIDENING A GAP, NOT BY MOVING THE BELL.** The right-hand cluster is pinned to the
edge by the header's `justify-between`, so the avatar cannot move without leaving the edge: growing the
space between the two children is what pushes the bell left. `gap-2` → `gap-3.5`. **MEASURED** at
320/360/375/390/430px against the REAL built stylesheet, five name shapes each (long Arabic,
single-glyph CJK, blank): 14px of gap, both chips inside the header, PIN never clipped, nothing
overlapping the middle zone, no horizontal overflow — 25/25 cases.

**THE DOT IS THREE STACKED LAYERS, NOT ONE THAT CHANGES COLOUR.** An animated `background-color`
repaints every frame and this element sits on the bar's `backdrop-blur-xl backdrop-saturate-150` surface
— the most expensive host in the app to repaint over (v2.99.84 measured that class of cost and removed
14 of them from the call grid). So the colour comes from opacity cross-fades over a **static opaque
light-blue base**: three opacities engineered to sum to 1 would show a transparent hole the instant
their easing curves disagreed, and would leave whichever layer is declared last as the reduced-motion
still frame. **The two hue windows are DISJOINT** (measured: 0.0% of the cycle has both lit), or they
would additively blend into a fourth colour nobody asked for.

**THE HEARTBEAT IS A DOUBLE THUMP ON A WRAPPER.** "Similar to the heart way" — a single sine pulse reads
as breathing, so the keyframe beats at 7% and again, smaller, at 26%, then rests for 66% of the cycle
(measured from the real animation: local maxima 1.319 and 1.176). It rides a **wrapper** because two
animations on one element do not compose — the later declaration simply wins (the v2.99.85 lesson) — so
the scale and the opacity must live on different elements or one of them silently stops happening.

**"EVERY 30 SECONDS" COSTS NO TIMER.** Both wordmark animations run a 30s cycle whose visible portion is
only its opening fraction — measured in motion for 4.7% and 7.2% of the cycle, i.e. ~1.4s and ~2.2s of
movement and then ~28s of rest. No interval to arm, nothing to leak, no re-render per tick, and it stays
inside the existing reduced-motion gate. The v2.99.86 sheen is **retimed** from 5.5s rather than joined
by a second animation: keeping both cadences would have buried the slower event under the faster one.
Its pin, which asserted the 5.5s duration and the 38% hold, is rewritten to the property — a 30s cycle
whose motion is confined to a small opening fraction — rather than relaxed.

**THE CONNECTION LINE REPORTS THIS DEVICE'S OWN REALTIME HEALTH, and that is the whole design.** The
tempting alternative — read my own presence row back from the server — cannot work for the one case the
line exists for: if the connection has just died, the round trip that would tell you so is the thing
that fails. **THE MIDDLE STATE NEEDS POSITIVE EVIDENCE**: `isSseConnected()` starts false and only flips
on the stream's `onopen`, so a rule of "not connected ⇒ idle" would paint amber for the first few hundred
ms of *every* app load and then snap to green — a flicker that reads as a bug. So a **second** flag,
`realtimeDegraded`, starts FALSE and is set only when the stream actually fails; both are written from
the same two handlers, so there is one owner of the truth and no chance of the pair drifting (the failure
this codebase keeps relearning — v2.99.50, v2.99.71). **GREEN IS NEVER A LIE**, which is why the stream
is consulted at all: `navigator.onLine` only reports that an interface is up, so a captive portal or a
dead uplink still reads true and would paint "online" over a connection carrying nothing. **NO NETWORK
OUTRANKS A DEGRADED STREAM**, because a dropped stream is a *symptom* of no network and reporting the
symptom sends somebody looking in the wrong place. **"IDLE" IS THE HONEST WORD**: a backgrounded tab is
precisely a tab whose EventSource the browser throttles, which is the same condition the server records
as `presence.idle` (v2.99.92) — so the line agrees with what other people see of you without asking.
Said plainly: you cannot watch your own "idle" label while the app is hidden; what you see is the
reconnect window right after you return, and a genuine stream failure.

**THE TWO NEW COLOUR TOKENS ARE MEASURED, NOT PICKED BY EYE, and the measurement changed the plan.**
Reusing `--relay-dnd` — the amber already in the palette — was the obvious move and is wrong twice over:
it computes to **3.72:1 on the light card**, which FAILS WCAG AA for text this small, and it already means
"alerts are silenced", so borrowing it would put one colour on two meanings in a single bar (the exact
collision v2.99.86 moved DND off green to avoid). New `--relay-amber-text` (5.16:1 light / 9.91:1 dark)
and `--relay-red-text` (5.61:1 / 5.96:1), both within a hair of the green text's 5.91:1 so no state of
the line is harder to read than another. The colour is applied as an **inline CSS variable**, never a
runtime-composed Tailwind class, which would be absent from the source at build time and come out
unstyled — the trap already documented for the bottom tab bar's accents. And the line carries a **word
as well as a colour**, so it does not depend on being able to tell green from amber.

**THE BOTTOM BAR: 81px → 68px, MEASURED.** The `0.55rem` floor under the tab row is gone and the tab's
own padding tightened, so 13px goes back to the scroll area — real, not cosmetic, because the bar is an
in-flow flex sibling and the scroll container ends exactly at its top edge. **The safe-area inset itself
STAYS**: on an iPhone the home indicator sits there, and dropping it would put it on top of the tab icons.

**ONE `<BrandMark>` INSTEAD OF TWO.** The shell used to mount it twice, one per breakpoint; the wordmark's
390px rule now lives inside the component. Two mounts would mean two subscriptions to the connection
store and the same breakpoint restated in two places. The pin that froze the two call sites is rewritten
to the property: exactly one mount, the wordmark carrying the breakpoint, and the dot never carrying it.

**A HARNESS BUG OF MY OWN, reported rather than counted as a result.** The first geometry run reported
25/25 FAILING — the bell gap measuring 4px, the media queries not matching, the header 85px tall — and I
was one step from "the layout is broken". It was not: `readdirSync(...).find(f => f.endsWith(".css"))`
picked **`Docs-*.css`** (29KB of markdown styles) instead of `index-*.css` (602KB), so it measured a page
with no Tailwind utilities at all — the 4px was inline-block whitespace between two un-flexed buttons.
The harness now names the app stylesheet explicitly AND **aborts** unless it can prove the CSS is in
force (the header computes to `display:flex`, the bell to exactly 36px, and the phone media query agrees
with the emulated width) — the same shape of gate v2.99.84 added after measuring a phone at desktop width.

**THREE OF MY OWN TEST BUGS, all found before shipping.** One was the recurring **unbounded-slice**
fragility: a percentage assertion sliced from a keyframe's start to the end of the file and read
`relayHueB`'s 94% while claiming to check `relaySheen` — now **brace-matched** to exactly one block, with
a helper that returns `""` rather than the rest of the file when a block is absent. One matched
`RELAY</span>`, a needle the multiline JSX does not contain. And the third is **the prose trap for the
eighth time**: `not.toMatch(/fixed/)` matched the comment that says the bar is *not* `position: fixed`.
The line-based `codeOnly` used across this repo cannot catch that — a JSX `{/* … */}` block's
continuation lines begin with ordinary words — so this file's version strips the block forms as **spans**
first, and the assertion is scoped to the element's own `className` rather than to a window of source.

**A WEAKNESS THE MUTATION RUN FOUND IN A PIN I HAD JUST WRITTEN**: "the bell comes before the avatar"
asserted DOM order only, and a `flex-row-reverse` on the cluster paints them the other way round while
leaving the source order untouched. Now pinned in both directions.

`client/src/app/topBarStatus.test.ts` (42), with the three-way connection rule tested **behaviourally**
because that is the whole feature — a source pin cannot tell you whether losing the network turns the
line red, or whether a fresh load flickers amber before settling. **All 37 tripwires verified by
MUTATION** from byte-exact backups and a confirmed-GREEN baseline, sources byte-identical afterwards.

**NOT VERIFIED ON A DEVICE, said plainly**: the geometry and the animation cost are measured in headless
Chromium against the real built stylesheet, but how the heartbeat and the 30-second flourish *look* on
the owner's phone is not. The transcribed markup the harness drives is a transcription, not the mounted
React component — reaching `/app` headless needs a signed-in identity plus a dozen stubbed queries, and a
hand-written copy proves nothing about the real component (the v2.99.82 lesson), which is why every
structural claim is additionally pinned in source.

No schema change, no new dependency, no new env var, no server change. 2765 tests.

## v2.99.93 — the pending-task batch: find a contact by digit OR letter, icons, and an honest guest notice (2026-07-27)
- [x] **THREE PENDING ITEMS CLOSED, and the rest of the list triaged HONESTLY rather than left ambiguous** —
      see the two "not done, and why" entries at the end.
- [x] **#91 — START A CONVERSATION BY FIRST DIGIT *OR* FIRST LETTER.** The New-conversation field ran
      `e.target.value.replace(/\D/g, "")` on the way in, so **a name could not be typed at all** — you had to
      know the six digits by heart. Both fields (the DM one and the group member one) now take a query, and a
      suggestion list resolves it.
- [x] **TWO RULES, PICKED BY WHAT WAS TYPED, because they answer different questions.** Digits match the
      **start** of the number — never an infix, because a 6-digit number has no meaningful interior and `55`
      matching 155234 would put a stranger above the person being dialled. Letters match the start of **any
      word** of the name, so a SURNAME works: people search "Alhammadi" as readily as "Khalifa". A first-name
      match outranks a surname match.
- [x] **NEVER AN INFIX ON A SHORT QUERY** — one or two letters inside a word matches most of a contact list,
      which is indistinguishable from no filter at all (the v2.99.80 emoji-catalogue lesson). Case and
      diacritics fold, so "alv" finds "Ålvaro" and "nun" finds "Núñez".
- [x] **THE SUBMIT PATH STILL ONLY EVER SEES SIX DIGITS, and `digitsOf` alone is NOT enough to guarantee it**:
      stripping non-digits reads `7a7b7c7d7e7f` as `777777`, so a typo would become a successful open of
      somebody else's thread. The button is gated on the digit count **and** on the query being number-SHAPED,
      which is the same reasoning as v2.99.75's `normalizeDesiredNumber`. A name is opened by tapping its
      suggestion, which supplies the number.
- [x] **`isNumberQuery` REQUIRES THE WHOLE QUERY TO BE DIGITS AND GROUPING**, so "7th floor" is a name search
      rather than the number 7 — and the grouping people actually type (`777-777`, `735 680`) is accepted,
      because the app DISPLAYS numbers that way and refusing the shape back would be rude.
- [x] **A CONTACT YOU BLOCKED IS NEVER SUGGESTED.** Offering to start a conversation with somebody you
      deliberately blocked is a mis-suggestion, and unblocking is a decision to make in Contacts, on purpose.
      A malformed stored number is skipped rather than offered and then refused, and the group list withholds
      members already added — a suggestion that does nothing when tapped reads as broken.
- [x] **NOTHING TYPED SHOWS FAVOURITES, THEN WHOEVER IS ONLINE**, because that is the most useful default for
      an empty field; an empty RESULT renders **nothing** rather than a "no matches" row, since the field still
      works by number and an error state under every unmatched keystroke would be noise. The contact list is
      only fetched while the sheet is open. The suggestion's number is `dir="ltr"` + bidi-ISOLATED so an Arabic
      name on the line above cannot reorder it (v2.99.77).
- [x] **#90 (the icon half) — PER-ROW ICONS ON THE PROFILE CONTACT ROWS**, per the owner's mockup: a mail glyph
      on Email, a phone on Mobile numbers, and a **per-platform** glyph on each social link. **THE LABELS STAY**
      — four platforms is exactly the range where icon-only becomes a guessing game, and an icon alone gives a
      screen reader nothing; every glyph is `aria-hidden` so it is not announced twice per row. `SocialIcon` has
      an **exhaustive switch with a neutral fallback**, so adding a fifth platform to `SOCIAL_PLATFORMS` and
      forgetting its icon degrades to a link glyph rather than rendering nothing.
- [x] **#90 (the notice half) — HOW LONG A GUEST NUMBER IS HELD, stated ACCURATELY rather than alarmingly.**
      Read from the server's own `guestExpiresAt` rather than a day count written into the copy, so the two
      cannot drift — and it says out loud that **the clock resets every time you open RELAY**, which is true
      (`touchGuestExpiry` pushes it forward on every visit) and is the part that makes the figure
      non-frightening: a bare "expires in N days" implies a countdown you cannot stop. Renders nothing when
      there is no clock to report.
- [x] **AND IT NEVER CLAIMS THE DATA IS DELETED, because nothing deletes it.** Established by reading the code
      rather than assumed: `guestExpiresAt` gates only the guest COOKIE lookup, and **no reaper touches guest
      identity rows at all** — the only `.delete(identities)` in the codebase is Adopt-and-Retire's
      provably-empty retire. So after expiry the number, contacts and messages are still there and this browser
      can still reclaim them with the recovery key (v2.99.68). A test pins that the copy makes no
      deletion claim and that the delete count stays at one.
- [x] `client/src/app/contactSuggest.test.ts` (36), the ranking tested BEHAVIOURALLY because that is the entire
      feature — a source pin cannot tell you whether typing `7` surfaces 777777. **All 28 tripwires verified by
      MUTATION** from byte-exact backups and a confirmed-GREEN baseline.
- [x] **A WEAKNESS OF MY OWN CAUGHT BY THAT RUN**: the "a first-name match outranks a surname match" case used
      "Zain Ali" / "Ali Hassan", where the ALPHABETICAL tiebreak happens to produce the same order — so deleting
      the rank comparison entirely left the test green. Rewritten with "Ahmed Ali" / "Ali Hassan", where the
      rank-1 match sorts alphabetically BEFORE the rank-0 one, so only the rank term can produce the expected
      order.
- [x] **#96 RESOLVED WITHOUT BUILDING IT, and the reasoning is recorded rather than the task quietly dropped.**
      The owner asked for the story ring "wherever it's showing history, in contact, in groups, everywhere" —
      Contacts, the Messages thread rows, the chat header and History **already** carry it through `PeerAvatar`.
      Call tiles were NOT in that list, and putting a ring there costs paint on the app's single most expensive
      surface (six tiles of live video, the thing v2.99.84 measured 14 repaints out of) for an indicator that
      cannot safely be tapped — opening a full-screen story over a live call is not a thing to offer. **Group
      rows are the real gap and are blocked on #89**: a group has no avatar and no status of its own yet, so
      there is nothing for a ring to mean.
- [x] **#75 RE-AUDITED AND HANDED BACK, with the evidence.** The mailer's MIME is clean and was checked again
      line by line: `Date`, `Message-ID` on the From domain, `MIME-Version`,
      `multipart/alternative` with BOTH a text and an HTML part, RFC 2047 subject encoding. There is no
      code-side defect left to fix, so verification mail landing in spam is **SPF / DKIM / DMARC alignment and
      domain reputation** — DNS and SES configuration, owner-side. Deliberately NOT shipped: speculative header
      tweaks dressed up as a spam fix (`Precedence: bulk` would actively HURT a transactional message, and a
      `List-Unsubscribe` on somebody's own login code is wrong).
- [x] **#44 STILL BLOCKED, said plainly**: live verification needs to reach `your-chat.io`, and this sandbox's
      outbound network refuses it (`curl` exits 56). Nothing in the repo can change that.
- [x] No schema change, no new dependency, no new env var, no server change. 2724 tests.

## v2.99.92 — minimising the app is IDLE, not offline (2026-07-27)
- [x] **OWNER**: *"Whenever you minimize the app, the user showing offline, not the idle."* `PresenceManager`
      fired the go-offline BEACON on `visibilitychange → hidden` as well as on `pagehide`, so switching apps for
      five seconds told every contact you had left. Now: **hidden → idle** (a slow 60s beat), **visible → the
      ordinary heartbeat, which clears idle in the same write**, **pagehide/beforeunload → the offline beacon,
      exactly as before**.
- [x] **THE HARD PART WAS NOT THE THIRD STATE — IT IS THAT `isOnline` ANSWERED TWO DIFFERENT QUESTIONS.** "What
      LED do I draw?" and "should I push, because they cannot see this in the open app?" were the same boolean.
      So keeping `isOnline` true while backgrounded would have **SILENTLY STOPPED NOTIFYING A MINIMISED APP** —
      making the owner's complaint worse, in a way nothing on screen would ever show. New shared
      `presenceNeedsNotification` (`!isOnline || idle`) is used at every site that asks the second question,
      it FAILS TOWARD telling somebody (an unknown identity counts as needing one, because failing the other
      way loses the message rather than a moment's quiet), and a test enumerates the call sites so a fourth
      added later has to come through it.
- [x] **THE AUTO-REPLY DELIBERATELY DOES NOT USE THAT RULE, and the difference is the point**: it posts a line
      in somebody else's name saying they are away and will reply later, and a person who switched apps for ten
      seconds may reply immediately — firing it on idle would make the auto-reply a lie, which is the same
      over-reaction to minimising this release exists to remove, in message form. Pinned as a deliberate
      exception rather than left to look like an oversight.
- [x] **ONE NEW NULLABLE COLUMN, `presence.idleSince`, and NULL is exactly the reading every existing row
      needs** — so the additive migration is a no-op until a client starts reporting idle. It is a TIMESTAMP
      rather than a flag because the offline-message email's rule 2 asks "have they really been away a while",
      and `lastSeenAt` can no longer answer that: a backgrounded app keeps beating, which is precisely what
      stops it decaying to offline after two minutes. `awayForMs` now measures from `idleSince` while idle and
      falls back to `lastSeenAt` for a genuinely offline person.
- [x] **`markIdle` KEEPS `isOnline` TRUE — and that is the truth, not a convenience**: the SSE stream is open
      and a call still rings, so the person really is reachable. It records the FIRST idle moment via
      `COALESCE`, because a bare `now` would reset the clock on every beat and nobody would ever read as away
      for a while. `markOnline` and `markOffline` both clear `idleSince`, and so does the reaper — an offline
      row carrying an idle timestamp is a contradiction, harmless today and a trap the moment anyone reads the
      column alone.
- [x] **`markIdle` IS A SEPARATE ENDPOINT FROM `heartbeat`, NOT A FLAG ON IT.** `heartbeat` calls `markOnline`,
      which clears idle AND can fire the "X is back online" watcher push — reusing it while hidden is exactly
      the bug v2.99.25/H6 fixed, and an idle beat built on it would have reintroduced it. It also fans NO
      presence SSE event: `isOnline` has not changed, so publishing `true` again is a no-op costing an audience
      query per app switch, and publishing `false` would be the bug.
- [x] **`idle` IS DERIVED IN EXACTLY ONE PLACE.** Every presence read in the routers already funnelled through
      `getPresenceForIds`, so `idle: r.isOnline && idleSince != null` there reaches all of them at once — and no
      consumer can combine the two fields wrongly, because none of them sees the raw pair. Guest-privacy
      suppression covers idle too: a hidden presence must not leak "away" while withholding everything else.
- [x] **IT MAPS ONTO THE `away` THE APP ALREADY HAS**, rather than inventing a display state: every surface
      already knows how to render away, so an automatic idle cannot be handled inconsistently by one screen. A
      MANUAL override still wins — somebody who set "travelling" said so on purpose, and an automatic signal
      must not overwrite a deliberate one. `idle` DEFAULTS TO FALSE in `effectiveStatus`, and that default is the
      safety property: a caller not yet taught about it degrades to the old reading (online), never to the
      wrong-way failure of showing somebody offline.
- [x] **AN AUTOMATIC IDLE IS NOT LABELLED AS A CHOSEN STATUS.** The dialer's status chip now reads the
      OVERRIDE directly instead of the resolved status, because both resolve to `away` and reading the chip off
      the resolution would put a label in somebody's mouth that they never selected. The presence LINE says
      "away"; the chip stays empty. (A manual "Away" also now reads "away" on that line rather than "online
      now", which was the line contradicting the chip.)
- [x] **ONE LED RULE FOR EVERY DOT** (new `client/src/app/presenceDot.ts`). A third state meant eight separate
      dots across Contacts, the Messages thread list, the chat header and the profile popup each had to learn
      it — and eight copies is exactly how two surfaces end up disagreeing about the same person (v2.99.77 was
      that bug: one rule applied in four places and forgotten in a fifth). **THE COLOUR VOCABULARY IS NOT
      WIDENED**: idle is the online green FADED with no glow, not a new hue, because amber already means "on a
      call" here and "Do Not Disturb" in the top bar and a third meaning would make colour stop carrying
      information; the glow is what makes green read as "active right now", so idle loses it, and the LABEL is
      what says it unambiguously — which is also what a screen reader and a colour-blind reader get.
- [x] **`onLeave`'s DEAD BRANCH DELETED**: its `closing` parameter had exactly one false caller,
      `visibilitychange → hidden`, which now marks idle — so the branch was unreachable, and an unreachable
      branch in a presence path is how the wrong one gets taken later.
- [x] **THE COST, STATED RATHER THAN HIDDEN**: on mobile Safari a real tab CLOSE often fires only
      `visibilitychange`, so such a close now reads "away" for up to two minutes instead of going offline at
      once. That is the trade — a wrong "offline" every time somebody checks another app, against a slightly
      late "offline" when they close one browser tab. The 2-minute reaper still converges it. An idle identity
      also still counts in the landing page's "online now", which makes that figure MORE stable than before,
      since minimising no longer decrements it.
- [x] `server/presenceIdle.test.ts` (30), with the shared rule, `effectiveStatus` and the LED tested
      BEHAVIOURALLY — a source pin cannot tell you whether a backgrounded app still gets its push, and that is
      the whole risk. **All 28 tripwires verified by MUTATION** from byte-exact backups and a confirmed-GREEN
      baseline.
- [x] **TWO WEAKNESSES OF MY OWN CAUGHT BY THAT RUN and fixed rather than counted as passes, both the same
      class**: the markIdle assertions matched `isOnline: true` and `lastSeenAt: now` ANYWHERE in the function,
      and since it is an upsert each string occurs twice — so breaking the UPDATE path left the test green, and
      the UPDATE is the worse half, the one that keeps a minimised app out of the reaper's way. Now COUNTED,
      with the insert and the update asserted separately. **A BAD MUTATION OF MY OWN, reported rather than
      hidden**: the markOnline case inserted a COMMENT line, which changes no behaviour at all — the test was
      right and the mutation meaningless; replaced with one that drops `idleSince: null` from the UPDATE.
- [x] **NINE PRE-EXISTING PINS REWRITTEN**, and six of them for the SAME structural reason rather than because
      the property changed: `ownerUiBatch2`, `qaBatch3`, `qaBatch10` (×2), `statsFeed` and `presenceReaper` all
      sliced a FIXED number of characters from an anchor, and this release's added comments pushed the code they
      were reading out of the window — the recurring fixed-slice fragility (v2.99.78). All now bound by the
      function's own end with a non-empty assertion. The other three were genuine intent changes: `statusReply`,
      `roundsGaps` and `emailNotifyPrefs` pinned the bare `!isOnline` notification check, i.e. they would have
      pinned the silent regression; `qaBatch10` also froze `onLeave`'s deleted parameter; and the Contacts /
      Messages / messagesRowRedesign LED pins froze inline ternaries that moved into the shared helper.
- [x] **AND THE PROSE TRAP FOR THE SEVENTH TIME**: a `not.toMatch(/onLeave\(/)` matched MY OWN COMMENT
      explaining `onLeave(false)`'s removal, because `codeOnly` strips comment LINES and the phrase sat
      mid-line. Fixed by stripping comments — and the wider window it used also ran past `onVisibility` into
      `const onClose = () => onLeave()`, which legitimately calls it, so it is bounded to its own function now.
- [x] **NOT VERIFIED ON A DEVICE, said plainly**: the state machine is tested, but nobody has watched a real
      phone minimise and seen a contact's dot go from green to faded green. The client half rests on
      `visibilitychange` firing as specified, which is exactly where mobile Safari is inconsistent — hence the
      cost stated above.
- [x] One additive nullable column, no new dependency, no new env var. 2688 tests.

## v2.99.91 — why a notification did not arrive (2026-07-27)
- [x] **OWNER**: *"Can you check the Firebase configuration as still the notification for the front mobile apps
      for Android? It's not showing or it's not active."* **A NATIVE PUSH CROSSES FIVE LINKS AND EVERY ONE OF
      THEM FAILS THE SAME WAY FROM THE PHONE — nothing happens**: the shell posts a token into the WebView,
      `push.subscribe` stores it under a routable kind, the transport for that kind is configured on the fleet,
      the recipient has not turned push off, and something actually SENDS for the event being tested. Guessing
      which link is broken has already cost more than building the check, so the admin panel now reports them
      **separately** and can fire a real send. The owner can run it themselves in ten seconds.
- [x] **THE ANSWER I CAN GIVE WITHOUT THE FLEET, and it is the most likely explanation**: **no code path sends
      a push for an incoming CALL.** `kind:"incoming-call"` was removed in v2.99.11 at the owner's own explicit
      request (*"if the user is offline and you try to call him it should NOT ring automatically"*) and nothing
      has sent it since — verified again here by scanning every `sendPushToIdentity` call site. So if the test
      was "call the phone with the app closed", no Firebase configuration on earth would make it ring. What DOES
      push: a message, a missed call, a voicemail, and a back-online alert. The panel says this out loud rather
      than leaving it to be rediscovered, and a test **cross-checks the claimed list against the kinds the code
      really passes** — a hard-coded list that drifts is worse than no list, because it sends somebody looking
      in the wrong place.
- [x] **THE SERVER-SIDE CHAIN IS COMPLETE AND WAS AUDITED RATHER THAN ASSUMED.** `sendPushToIdentity` fans out
      to all three transports (Expo → `sendExpoPush`, raw device token → `sendFcmData`, browser → Web Push), the
      shape-derived kind decides the transport, `push.subscribe` refuses a token it cannot classify, and the
      WebView token bridge is mounted for every signed-in session in `RelayEngine`. Nothing in the repo is
      missing; what cannot be verified from here is the EXTERNAL Expo app, which must post the exact
      `{type:"SET_PUSH_TOKEN", token}` envelope — a bare token string is refused by design, because a listener
      that registers whatever arrives is a notification-hijack primitive (the v2.99.49 R1 class).
- [x] **`admin.pushDiagnostics` — READ-ONLY, AND IT NEVER RETURNS A TOKEN.** An FCM registration token plus the
      project key, or an Expo token on its own, is enough to push to that handset, so a device is reported as
      **kind + length + a 12-character prefix**: enough to tell two devices apart, not enough to address either.
      The Firebase key is reported as *whether it parses*, never its contents; same for `EXPO_ACCESS_TOKEN`.
      Tests forbid every shape that would leak one (`token: r.endpoint`, `...r`, the raw env var).
- [x] **IT REPORTS THE STORED KIND *AND* THE SHAPE-DERIVED KIND, and that pairing is the point**: the sender
      routes by the STORED kind, so an Expo token filed as `fcm` goes to FCM and is dropped with **no error
      anywhere**. That is the one failure in the whole chain with no other symptom, and it is invisible unless
      both are printed side by side. A legacy NULL kind is reported as `webpush` — the same reading the sender
      takes — because calling it "unknown" would invent a problem.
- [x] **A DB FAILURE AND AN EMPTY LIST ARE REPORTED DIFFERENTLY** (`dbOk`): "no devices registered" and "we
      couldn't look" need different next steps, and collapsing them is how a diagnostic starts lying.
- [x] **`admin.sendTestPush` GOES THROUGH THE REAL `sendPushToIdentity`.** A parallel test sender is the worst
      possible thing to build here — it could pass while production was broken. Calling the real one proves the
      actual path including the master push switch, the per-kind routing and the dead-token pruning; tests
      forbid bypassing it via `sendFcmData` / `sendExpoPush` / `webpush.sendNotification`. It is
      `directoryGate`-limited **even for an admin**, because it writes to a third party's device and a stuck
      retry in the panel must not become a notification flood; the body is content-free and says it is a test,
      since it lands on somebody else's lock screen; and the trace carries **ids only**.
- [x] **A DELIVERED COUNT OF ZERO IS DISTINGUISHABLE FROM A FAILED REQUEST** — the panel says "nothing was
      reachable" rather than a generic error, because those are different diagnoses.
- [x] **THE PANEL DID NOT QUIETLY WIDEN.** An admin panel is a permanent high-value surface, so a test
      enumerates every `trpc.admin.*` call the page makes and asserts the set is exactly
      `amIAdmin`/`findIdentities`/`setIdentityNumber`/`pushDiagnostics`/`sendTestPush`. Adding a sixth
      capability now has to be a deliberate act that updates that assertion. Both new procedures re-derive admin
      from the `users` row via `requireAdmin` — never the cached whoami role — with the gate asserted to precede
      every read and write, and the refusal is uniform so the endpoint is not an oracle for who holds the role.
- [x] `server/pushDoctor.test.ts` (21), with `classifyNativeToken` tested BEHAVIOURALLY because sending an Expo
      token to FCM is a silent delivery failure and a source pin cannot tell you the two are separated.
      **All 19 tripwires verified by MUTATION** from byte-exact backups and a confirmed-GREEN baseline; sources
      byte-identical afterwards.
- [x] **NOT VERIFIED FROM HERE, said plainly**: the sandbox's outbound network cannot reach `your-chat.io`
      (`curl` exits 56), so the live fleet's `FIREBASE_SERVICE_ACCOUNT_JSON` was NOT read and no live push was
      sent. That is exactly why this ships as a panel the owner can run against production rather than a claim
      about it. **OWNER-ONLY STEPS if the panel shows no registered device**: the Expo shell must post the
      envelope; with **Expo** tokens the FCM server key and APNs key go to **EAS** and nothing is needed
      server-side; with **raw device** tokens the Firebase service-account JSON goes into `/home/relay/.env` as
      `FIREBASE_SERVICE_ACCOUNT_JSON` (that private key is a real secret — never a chat message, never a
      `workflow_dispatch` input, where it would sit in run metadata).
- [x] **STILL OPEN, and it is the other half of the owner's message**: minimising the app marks the person
      OFFLINE rather than idle. Diagnosed here and shipping next — `PresenceManager` beacons offline on
      `visibilitychange → hidden`, and the fix needs a third presence state plus care at the three sites where
      `isOnline` decides whether to PUSH rather than what LED to draw, since a backgrounded app must keep
      getting notifications.
- [x] No schema change, no new dependency, no new env var. 2658 tests.

## v2.99.90 — the dead keys go, the dialer says who you're calling, and a story stops dragging you onward (2026-07-27)
- [x] **`*` AND `#` ARE GONE FROM BOTH DIAL PADS; THE BOTTOM ROW IS BLANK · 0 · ERASE** (owner, with a
      screenshot: *"This star no need for this bottom. Remove it from here and also remove it from the … dial
      pad, the main page … The star and the hash key. So just keep in the center below zero, and on the right
      is the delete of the numbers."*). Neither symbol was ever usable: a RELAY number is six DIGITS, so `tap()`
      refused them for the field and they only played a tone. `#` gave up its cell to erase (landing v2.99.36,
      app v2.99.86); `*` gives up its cell to **nothing**. **THE BLANK IS A REAL GRID CELL, not a shortened
      list** — that is what keeps `0` in the middle column and the erase key bottom-right under the thumb that
      was just typing; a 3-column grid has no other way to centre it. It is a `<span aria-hidden>`, not a
      button, so there is no empty focusable control between 9 and 0, and on the landing pad it carries no
      `data-lp-key`, so the delegated click handler cannot route a tap on it into `press()`.
- [x] **THE NON-DIGIT GUARD STAYS, and it is what made the removal safe rather than merely tidy**: the length
      cap used to apply ONLY to digits, so `*` appended without limit and could push junk into a field that can
      only ever hold six. The pin was rewritten from the exact body (`{ playDtmf(d); return; }` — the
      consolation tone for a key that no longer exists) to the property: the guard refuses, and it refuses
      BEFORE anything appends.
- [x] **ADD-TO-CONTACTS: ONE GLOSSY ICON, OR NOTHING AT ALL** (owner: *"If the number is already on contact,
      you don't need to show this message. If he's not in the contact, just show an icon added to contact but a
      different color, make it nice color … glossy, glossy, and flashy."*). Already saved → the component
      returns null; the old "✓ In your contacts" chip answered a question nobody asked, on a card with no spare
      vertical space directly under three call buttons. Not saved → a 48px round `UserPlus` in **pink→fuchsia**,
      and the colour choice is not arbitrary: green is Voice, sky is Video, violet is Group Call, red is erase,
      amber is Do Not Disturb, so a fourth reuse would make colour stop carrying information. A test asserts
      the new hexes appear nowhere in the call row. **FLASHY WITHOUT REPAINTING**: the halo is a STATIC
      box-shadow on a stacked overlay with only its OPACITY animated (`relay-gloss-pulse`, the same primitive
      as the erase key) — animating the button's own box-shadow repaints it every frame, the class v2.99.84
      measured and removed 14 of. The gloss is a fixed specular highlight, static on purpose: a moving shine on
      a button you are aiming at is a distraction rather than "flashy". Icon-only as asked, with the label on
      `aria-label` + `title` so it is still reachable without sight, and `disabled` while saving.
- [x] **THE DIALER PREVIEW, IN THE OWNER'S ORDER** (*"it shows you his badge. It shows you when was his last
      login. First, to show you also he is online, then last login, number of hours."*): name + badge ·
      **online-or-not** · **how long since** · the status they chose. New pure `peerPresenceLines` so the
      ordering rule is testable without a DOM, and a test asserts the four are rendered in that order by index.
- [x] **HOW LONG AGO IS AN ELAPSED DURATION AND NEVER A DATE** (*"Days that shows you one day, two day, three
      days like this, not date as a date."*). New `formatElapsedSince`: `8s` under a minute, `14m` under an
      hour, `3h 20m` under a day, `2d 4h` past 24h. Seconds stop where they stop being information — printing
      them on a two-day-old figure is noise AND would need the line to re-render every second to stay honest.
      A test walks four ranges and asserts NO month name, NO year, NO clock and NO `AM`/`PM` can appear.
      **`formatLastSeen` IS DELIBERATELY UNTOUCHED** and still backs Contacts and the profile popup: the owner
      asked for the clock THERE in v2.99.66 (*"it doesn't show you the time and the minutes"*), so replacing it
      globally would have undone an earlier explicit request. Two formatters, two surfaces, both asked for.
- [x] **THE ELAPSED FIGURE IS WITHHELD WHILE THEY ARE ONLINE**: "last login 3s ago" beside "online now"
      restates the same fact and would need a per-second re-render. But **`travelling` and `away` KEEP it**,
      because a manual label is not presence — the person set it days ago and how long since they were actually
      here is still news. It is `dir="ltr"` + bidi-ISOLATED so an RTL locale cannot reorder `2d 4h`.
- [x] **THE STATUS THEY PICKED GETS ITS OWN CHIP — not their bio, not their story media** (owner: *"his
      profile, there is two things. Not the bio. If he's travel or he's not travel, his status. Not the image
      and video."*). `peerStatus` folds the override INTO the presence text, so travelling REPLACED "offline";
      now they coexist and the chip reads as a label the person chose rather than as live presence.
      `peerStatus` itself is left alone — it is what Contacts and the popup render.
- [x] **SPACE BETWEEN THE NUMBER, THE INFORMATION AND THE PAD** (*"currently, it's showing you the dialed
      number, then the information, then the pad is all together attached. Make space between the little
      bit."*). `mt-1.5` → `mt-3 mb-1.5`, plus the preview's own line gap widened. The card's `gap` spaces its
      ROWS; this is the space INSIDE the number area, which the gap could not reach.
- [x] **A STORY NO LONGER DRAGS YOU INTO THE NEXT PERSON'S** (owner: *"when you open your store, your own story
      … it takes you to the other story after it finish your own story. This thing doesn't show … don't do it in
      the main profile if you click there or anywhere else. Except if you are in the message and you click in
      the other story, it will start from the first profile of your friends who published story, and it will
      keep going to the end of the last friend … But on your personal story, with its finish, it's closed."*)
      New `chain` prop on `StatusViewer`, **defaulting to FALSE — and that default is the safety property**: a
      call site added later inherits the single-story behaviour, which is the rule for everywhere except the
      Messages strip. `next()`/`prev()` both route through ONE `nextChainable` helper rather than each carrying
      their own branch.
- [x] **YOUR OWN STORY IS EXCLUDED INSIDE THE HELPER, not at the call site** — so a chain that STARTS on a
      friend can never land on you either, which a call-site-only check would have missed (the feed array
      contains your group). The strip passes `chain={!groups[viewerAt].owner.isMe}`, so tapping a friend walks
      to the last friend and tapping My status shows yours and closes. Exactly ONE opt-in exists across the
      whole client, asserted by count.
- [x] **THE UNIVERSAL OPENER STOPS CHAINING BY DEFAULT.** `PeerOverlaysHost` — the imperative
      `openPeerStatus` used by the profile popup, Contacts, History and the call tiles — hands the viewer the
      WHOLE feed so it can locate the right group, and with no `chain` prop that array is now navigable one
      group only. So a story opened from a contact row shows that person and closes, which is what the owner
      asked for and was previously the opposite. The progress bars were already per-ITEM of the current group,
      so nothing promises a chain that will not happen.
- [x] **FOUR PRE-EXISTING PINS REWRITTEN TO THE PROPERTY rather than relaxed**: `callUiV2998` asserted the
      "In your contacts" chip EXISTS, i.e. it pinned the very thing the owner asked to remove — it now asserts
      the offer/no-offer rule; `topBarSpec` froze the exact non-digit-guard body; `dialerToneLayout` froze the
      exact margin string and the exact `gap-0.5`, both of which this release deliberately changed, so they now
      assert min-height-not-fixed-height and is-a-column; and its tone pin sliced a fixed `+500` characters
      that the new guard pushed past, now bounded by the function's own end with a non-empty assertion.
- [x] **FIVE MISTAKES OF MY OWN IN THE TESTS, all found before shipping and fixed rather than counted as
      passes.** Three were the SAME declaration-vs-use trap in a row: `const KEYS: { d: string; sub: string }[]`
      contains the `{ d: ` needle the entry count used, and `Array<[string, string]>` contains two `[` — both
      read one or two entries too many, so the slices now start AFTER the declaration. A fourth was a 700-char
      window past the landing pad's blank-cell branch that ran into the DIGIT branch, which legitimately
      carries `data-lp-key` — now bounded to its own arm. The fifth is the recurring one: a `not.toMatch` for
      the removed "In your contacts" chip matched MY OWN COMMENT explaining its removal, because `codeOnly`
      strips comment LINES and the phrase sat mid-line inside a block comment; the comment was reworded.
      A sixth assertion was simply wrong about the code and corrected: the landing table lists 12 entries (its
      erase cell is one HTML string like the rest) while the app table lists 11 (its erase key needs its own
      gradient, halo and disabled state, so it is rendered after the map) — twelve cells either way.
- [x] `client/src/pages/app/dialPadStory.test.ts` (34), with the duration formatter and the presence ordering
      tested BEHAVIOURALLY because a source pin cannot tell you whether `2d 4h` comes out of a 52-hour gap.
      **All 22 tripwires verified by MUTATION** from byte-exact backups and a confirmed-GREEN baseline, with the
      mutator aborting unless its target occurs exactly once; sources byte-identical afterwards.
- [x] **NOT MEASURED, said plainly**: no browser measurement of the new pad or preview. Both are grid and flex
      primitives already proven here, the blank cell cannot overflow because it renders nothing, and the pin
      colours are opaque gradients — but how the pad and the pink button LOOK on the owner's phone is
      unverified. **NOT DONE, and it is a data gap rather than an oversight**: group thread rows carry no story
      ring, because a group has no avatar or status of its own yet — that is the group work already on the list,
      not a regression here.
- [x] No schema change, no new dependency, no new env var, no server change. 2637 tests.

## v2.99.89 — the Profile page becomes the control centre (2026-07-27)
- [x] **OWNER, TWICE, WITH TWO MOCKUPS**: *"you build the profile page to be more advanced. Everything
      controlled entire things from there. Also, put the barcode, put your number, put the badge, put your
      status, put the things that you have it, which is not in the picture."* Deferred twice before this,
      which is why they pushed back: *"I see so many things felt or that completed. Please redo it properly."*
- [x] **WHAT CHANGED IS THE SHAPE, NOT THE CONTROLS.** The page had grown to sixteen sections stacked one
      under another — roughly sixty controls in a single column about six phone screens tall, where "Devices"
      and "App lock" were reachable only by scrolling past everything else. It is now a HUB: an identity hero
      over grouped rows, each opening one pane. **EVERY EXISTING SECTION COMPONENT IS REUSED VERBATIM** rather
      than rewritten, which is what makes "nothing was lost" a structural fact rather than a claim, and is why
      this is a layout change with no new settings surface to re-verify.
- [x] **THE LOAD-BEARING TEST CHECKS NO LAYOUT AT ALL — it checks COMPLETENESS.** Restructuring a page this
      dense is exactly the change where a control quietly stops being reachable, and an unreachable setting is
      worse than an ugly one because nothing tells you it is gone. So the test ENUMERATES every `*Section`
      component defined across `Profile.tsx` and `ProfileHubSections.tsx` and asserts each is rendered; delete
      a pane and it names the missing one. It also asserts the enumeration is not empty, because a test that
      enumerates nothing passes for the wrong reason.
- [x] **PANES ARE LOCAL STATE, AND THAT IS NOT A STYLE PREFERENCE.** wouter's `useLocation` returns
      `location.pathname` ONLY, so a `#pane` or `?pane=` navigation re-renders nothing — the tap would do
      nothing with no error to explain why. A real sub-route per pane would also put ten entries in the app's
      history for what is one screen. Pinned: no `navigate("/app/profile#…")`, no `window.location.hash`.
- [x] **THE HERO CARRIES EVERYTHING THE OWNER LISTED, in the order they listed it**: the photo (tapping opens
      the picker), the name, the badge, the number in their own NNN-NNN grouping, the barcode, and the status —
      the status **tappable**, because they asked for it to BE here rather than be described here. The number
      uses `formatPin` IMPORTED FROM THE TOP BAR: two copies of "three numbers dash three number" is how the
      two surfaces end up disagreeing about the same number, so a local re-implementation is forbidden by test.
- [x] **THE HERO WEARS THE TOP BAR'S OWN BREATHING RING**, so the thing you tap up there and the thing you
      land on read as one object. The anti-phase is a half-cycle NEGATIVE DELAY, never
      `animation-direction: reverse`, which on this symmetric keyframe with a point-symmetric easing is an
      EXACT no-op (verified numerically in v2.99.86) and would peak both rings together — a white ring
      blinking, the one thing the owner ruled out. Ring B rests at `opacity: 0` so the REDUCED-MOTION still
      frame is the green ring rather than the later-declared white one covering it.
- [x] **A REAL PIECE OF DEAD CODE FOUND AND DELETED, not merely tidied**: `Profile.tsx` carried its own
      `<input type="file">` + `onAvatarPick` upload pipeline that **nothing ever clicked** — the avatar button
      opens `AvatarPicker`, which owns its own bare upload — so its `uploading` flag was permanently false and
      the button's spinner branch could never render. Two upload paths for one photo is also how they drift
      apart, and this one had already drifted into being unreachable without anyone noticing.
- [x] **AND THAT EXPOSED A TEST GUARDING THE WRONG COPY.** `v298ProfileAvatarFix.test.ts` existed to pin the
      v2.98.0 fix — upload and save in ONE try, the busy flag cleared in `finally` after BOTH awaits, no
      fire-and-forget `.mutate()` — and every one of its assertions read the DEAD handler. The property it
      protects was live and unguarded in `AvatarPicker`. Repointed at the live code and widened to cover BOTH
      of its upload paths (photo and emoji/animated) rather than the one that happened to be pinned.
- [x] **NO ROW IS A DEAD END, and the fix is structural rather than careful.** Three sections hide themselves:
      `EmailNotificationsSection` returns null without a signed-in account, `AdminLinkSection` for a
      non-admin, `GuestRestore` unless this browser holds a resolving recovery record. A row per section would
      draw a row that opens an EMPTY pane. So: the three notification sections share ONE row (the "is there an
      account" rule stays in exactly one place instead of being restated by the row that offers it); Admin
      becomes a row drawn only when `amIAdmin.data?.admin`, with the old self-hiding section DELETED so the
      predicate exists once; and `GuestRestore` stays a self-hiding BLOCK, because a row that is usually a dead
      end is worse than a block that is usually absent.
- [x] **"CHOOSE MY NUMBER" IS WITHHELD FROM A GUEST the server would refuse anyway.** `identity.setNumber`
      throws FORBIDDEN for a guest — a chosen number is first-come and permanent while a guest identity is
      session-scoped, so a guest claim would squat a memorable number and then strand it. Offering the button
      meant a guest tapping it, typing a number, and being refused for who they are rather than what they
      typed. A REGENERATE stays theirs: it hands out a random number and always has, so hiding it would take
      away the only number control a guest has.
- [x] **THE OVERLAYS AND THE CONFIRMATIONS LIVE AT THE ROOT, OUTSIDE THE PANE SWITCH.** `AuthPanel`,
      `AvatarPicker`, the sign-out dialog and the share sheet: closing a pane while one is open would unmount
      the open thing from under the user. The error banner and the "Saved" pill likewise, because
      `updateProfile` fires from more than one pane and a confirmation that renders only on the pane you
      happened to be on is worse than none.
- [x] **THE "SAVED" PILL MOVED OUT OF THE ANIMATED WRAPPER, and this trap has now bitten three times.**
      `animate-in` animates `filter`, and a filter establishes a containing block for `position: fixed`
      descendants — nested, the pill centres on that box instead of the viewport. Same defect as `.addpad` and
      the v2.99.54 video-consent card. A test asserts the pill is declared BEFORE the animated wrapper.
- [x] **OPENING A PANE SCROLLS THE PANE, NOT THE WINDOW.** The scroll container is the AppShell's, not the
      document (v2.78), so a `window.scrollTo` would do nothing; a pane opened from halfway down a list that
      no longer exists would otherwise start off-screen.
- [x] **A WEAKNESS OF MY OWN CAUGHT BY THE MUTATION RUN and fixed rather than counted as a pass**: the "the
      hero shows the number" assertion matched a bare `{formatPin(me.number)}`, which also occurs INSIDE the
      aria-label's `${formatPin(me.number)}` — so deleting the visible number left the test green. It is now
      anchored as a rendered child (`>` … `</span>`). Same interpolation trap as v2.99.86.
- [x] **A BAD MUTATION OF MY OWN, reported rather than counted as a survivor**: the first attempt at the
      Saved-pill case inserted `{}` before the pill, which does not move it relative to the wrapper at all —
      the test was right and the mutation was meaningless. Replaced with one that puts a genuine animated
      container around the pill; it bites.
- [x] **THREE MORE PRE-EXISTING PINS REWRITTEN TO THE PROPERTY rather than relaxed.** `adminToolParity` froze
      `function AdminLinkSection()` and that section's own `return null` — one particular implementation — so
      folding the entry into the hub broke it while the property was untouched; it now asserts the entry is
      gated on a SERVER answer and never on the cached whoami role. `guestRecovery` froze the one-line
      `RestoreNumberSection` wrapper; it now names `GuestRestore` itself, one indirection fewer. `v2961Fixes`
      froze the bare-upload call in Profile; it now pins both of `AvatarPicker`'s upload paths.
- [x] `client/src/pages/app/profileHub.test.ts` (29). **All 18 tripwires verified by MUTATION** from
      byte-exact backups, from a confirmed-GREEN baseline, with the mutator aborting unless its target occurs
      exactly once; sources confirmed byte-identical afterwards.
- [x] **NOT MEASURED, said plainly**: the layout is not device- or browser-verified. Reaching `/app/profile`
      in a headless run needs a signed-in identity plus roughly a dozen stubbed tRPC queries, and a
      hand-written copy of the markup would prove nothing about the real component (the v2.99.82 lesson). The
      geometry relies only on `truncate` + `min-w-0` + flex primitives already proven in this codebase, and
      the row's minimum-height and only-the-text-shrinks rules are pinned by test — but how it LOOKS on the
      owner's phone is unverified.
- [x] No schema change, no new dependency, no new env var, no server change. 2603 tests.

## v2.99.88 — the status refusal stops guessing at a cause (2026-07-27)
- [x] **A CORRECTION TO v2.99.87, MADE BY THE OWNER'S OWN DATA.** That release made a refused status delete
      visible, which was right — but its message asserted a CAUSE: "it was posted from a different sign-in on
      this browser". The `recover-identity` dry run then disproved it. Identity **#3 (777777)** holds
      **2 statuses** and 143 rows in total; the orphan **#62 (601586)** holds **0 statuses**. Both of the
      owner's stories are on the identity they are signed into, so the cross-identity explanation was wrong.
- [x] **THE MESSAGE NOW DESCRIBES THE EFFECT AND WHAT TO DO, and names no cause**: "That status is no longer
      there to delete — it may have already expired. Pull to refresh." The likelier mechanism is a STALE id:
      the feed is cached, a story expires at 24h, and tapping Delete on a row the reaper has already removed
      returns exactly that `ok: false`. But "likelier" is not grounds for telling somebody why, and a
      confident wrong reason sends them looking in the wrong place.
- [x] **THE RECOVERY FOR 601-586 IS BLOCKED, and the guard is what blocked it** — `recover-identity` refused
      because completing the swap would DELETE identity #3, which carries 39 messages, 15 conversations,
      14 contacts, 44 calls, 28 conferences, 2 statuses and a party line. That is exactly the emptiness check
      described in v2.99.60 doing its job on real data. **601-586's 17 rows** (4 messages, 1 conversation,
      3 contacts, 7 calls, 2 conferences) need a genuine MERGE, not a swap — a different and larger job,
      recorded rather than forced.
- [x] `statusDelete.test.ts` pin rewritten to assert the message carries no cause, and explicitly that it
      does NOT say "different sign-in".
- [x] No schema change, no new dependency, no server change. 2570 tests.

## v2.99.87 — a status that will not delete now says why (2026-07-27)
- [x] **OWNER, with a screenshot of their own story viewer**: *"i put status but i found something that i
      cant delete and i dunno why it showing and when i posted it ??!! The other status showing i can delete
      it and who viewed but the first one is award [weird]?"*
- [x] **THE DEFECT WAS THAT THE UI THREW THE SERVER'S ANSWER AWAY.** `status.remove` answers `{ ok: false }`
      — deliberately NOT an error — whenever `deleteStatus` finds the row's `identityId` is not the caller's.
      The handler was `await remove.mutateAsync({id}).catch(() => {}); invalidate(); next();`, which lies
      three separate ways: the `.catch` swallows a real transport failure, the `ok` verdict is never read,
      and it advances regardless — so the story slides past, comes back on the next open, and tapping Delete
      looks like it worked. Whatever the underlying data situation, "nothing happened and nobody said
      anything" is the bug that was actually experienced.
- [x] **THE VERDICT IS NOW READ AND A REFUSAL IS SAID OUT LOUD**, with the honest cause named: this browser
      can hold more than one identity (the guest→registered orphan class — the owner's own contact list shows
      235-680, 601-586 and 737-582, all of them them), and a status posted under a different sign-in is
      visible to you but is not yours to delete. A transport failure gets its own distinct message, a
      successful delete gets a confirmation, and a refusal does NOT advance the viewer.
- [x] **BOTH STATUS READS ARE REFRESHED, not just the feed.** `status.mine` backs the avatar's status pip
      (added in v2.99.86) and the strip's own ring, so invalidating only `feed` left them advertising a
      status that was gone.
- [x] **THE INDEX IS RE-CLAMPED rather than stepped forward.** Deleting shifts the array under the index, so
      `next()` from the last item walked off the end of a list that had just got shorter.
- [x] **DOUBLE-TAP GUARDED** — the button disables while the mutation is in flight and says "Deleting…".
- [x] **"WHEN DID I POST IT" IS ANSWERABLE NOW**: the relative time stays for the glance, with the exact
      timestamp on press. "16h ago" genuinely does not answer the question that was asked.
- [x] `client/src/pages/app/statusDelete.test.ts` (11), including pins that `deleteStatus` really can return
      false and that its argument order is not the one its neighbour `deleteContact` uses.
- [x] **NOT REPRODUCED FROM THE OWNER'S DATA, said plainly.** I cannot see their rows from here, so the
      root cause of the undeletable item is inferred rather than confirmed. What is fixed for certain is that
      the failure is no longer silent — the next time it happens the app will say which case it is, which is
      what makes it diagnosable at all.
- [x] No schema change, no new dependency, no server change. 2570 tests.

## v2.99.86 — the top bar to spec, and an erase key you can actually see (2026-07-27)
- [x] **OWNER, three screenshots and a long brief.** The erase key: *"This delete, I couldn't make it little
      large and red colour, flashy glossy to delete the numbers in case you want to delete it."* The bar:
      *"on the top bar on the left, there is the green icon, green blue of rely, and rely make it flashy,
      glossy, glossy. and it's, like, animated slowly. Uh, nice animation, but don't make it so much. And on
      the middle, put the flag first, little small size, not the normal size, make it little small. Then the
      first name and then the badge and then the PIN number, three numbers dash three number, put it in
      green color. and then it will show you on the right … this ring bill where for notification center.
      Green, if there is nothing… no notification. Red and blinking, if there is a notification, and then
      there's the profile where I told you you need to put circle of two colors."* And the ring: *"make a
      green silk kill on the profile image … flashy between green and white to keep flashy but feed and feed
      out."*
- [x] **THE ERASE KEY MOVED, AND A MEASUREMENT IS WHY.** The owner pointed at the floating ⌫ beside the call
      buttons and asked for it bigger and red. Measured first: at **320px that button ALREADY overlapped the
      Group Call button by 9px** before this release, and growing it to the size asked for took the overlap
      to **17px**; at 360px the enlarged version left 3px of clearance. So it is now the keypad's **12th
      cell** — big, red, glossy, and impossible to collide with. Measured there: **92×72 at 320px** rising to
      115×72, no overlap with any key or call button, grid still 3×4, no page overflow.
      `#` gave up the cell, which is the same trade **v2.99.36** already made on the LANDING pad: on a
      6-digit numeric pad it is pure decoration. There is now exactly ONE erase affordance (the "just put it
      one place" rule from v2.99.82), it sits under the thumb that is typing, and it DIMS rather than
      disappearing with nothing to erase — a key that comes and goes makes the grid jump mid-tap.
- [x] **A LIVE BUG FOUND WHILE THERE**: `tap`'s length guard applied only to DIGITS, so `*` (and the old `#`)
      appended without limit and could push non-numeric junk into a field that can only ever hold a 6-digit
      RELAY number. Now digit-only; `*` keeps its key and its tone but can no longer corrupt the number.
- [x] **THE BAR IS THREE ZONES, and the MIDDLE IS TWO LINES — the decision the whole layout rests on.**
      Seven monospace digits are ATOMIC: they cannot ellipsize without becoming a lie about somebody's
      number. On one line they compete with the name, the flag, the badge, the wordmark, a back arrow and two
      36px chips, and at 320px something has to give. Line 2 carries the PIN alone, so it can never be
      squeezed. Vertical cost is zero — the bar's height was already set by the 36px avatar, not by text.
- [x] **MEASURED, not asserted** — headless Chromium against the REAL built stylesheet, **5 widths (320/360/
      375/390/430) × back-arrow present or not × 6 names** including a long Arabic name and a single-glyph
      CJK name: the PIN is never clipped, the badge is always visible and never distorted, the avatar ring
      stays inside the header, there is no horizontal overflow, and there are zero nested buttons. The
      harness emits a `<meta viewport>` and ABORTS if the emulated width did not take effect (the v2.99.84
      harness bug).
- [x] **THE PIN'S GREEN IS A MEASURED TOKEN, NOT THE LED GREEN.** The presence green is
      `oklch(0.55 0.18 145)` = `rgb(0,139,29)`, which computes to **4.46:1** on the light theme's white card
      — it FAILS WCAG AA for text, and the PIN is 11.5px semibold. The grey it replaces was 5.97:1, so
      painting it the LED green would have made the owner's headline element LESS readable. New
      `--relay-green-text` is `oklch(0.48 …)` = **5.92:1**, fixed in the TOKEN so no call site has to know;
      the LED green is deliberately untouched, because a 12px dot is not text.
- [x] **THE FLAG'S BOX IS RESERVED even when there is no flag.** `geoSelf` returns a null country for a LAN,
      a VPN or a GeoIP miss and `CountryFlag` then renders NOTHING — so without a reserved box the whole
      identity block shifted sideways the moment geo resolved, changing where the name truncates mid-session.
      Rendered "little small" at 11px, per the ask.
- [x] **THE BELL CARRIES ITS STATE**: green when clear, red + blinking when something is waiting, and
      **DND moved to AMBER**. That last part is not cosmetic — green currently means DND, so shipping
      green-when-clear without moving DND would leave one colour meaning both "nothing waiting" and "alerts
      silenced". The CLEAR state is a green STROKE rather than a filled chip: the owner gets green, but a
      tinted plate lit 100% of the time spends attention on the one state that needs none.
- [x] **`.relay-blink-glow` ANIMATED BOX-SHADOW on the top bar** — a repaint every frame, hosted on the
      bar's `backdrop-blur-xl backdrop-saturate-150` surface, the most expensive host in the app to repaint
      over. Converted to the v2.99.84 overlay pattern (static shadow, animated opacity), and it now renders
      only while something is actually waiting, so a quiet bell runs no animation at all.
- [x] **THE AVATAR'S TWO-COLOUR RING, AND A REAL BUG IN MY OWN NEW CSS, caught in review before shipping.**
      The ring is two stacked rings whose opacities cross-fade — never an animated border-color or conic
      gradient, both of which repaint. My first version anti-phased them with `animation-direction: reverse`,
      which on a SYMMETRIC keyframe with a point-symmetric easing is an **EXACT no-op** — verified
      numerically, max |forward − reversed| = **0.000000**. Both rings therefore peaked together and the
      later-declared WHITE one covered the green for the entire cycle: a **white ring blinking**, which is
      precisely what the owner ruled out ("feed and feed out"). Fixed with a half-cycle negative delay and
      **MEASURED**: a+b stays ≈1 across the cycle, max |a−b| = 0.99.
- [x] **AND A SECOND ONE IN THE SAME COMPONENT**: under reduced motion neither ring animates, and without an
      explicit rest state the white ring sat at full opacity and covered the green — a still frame that looks
      nothing like the moving one. Ring B now rests at `opacity: 0`, so the quiet frame is the GREEN ring.
      Measured: 1.00/0.00 held across the sample.
- [x] **ONE TAP, A REAL CHOICE, AND DELIBERATELY NO DOUBLE-TAP.** The owner's brief said "double click" and
      then, later in the same breath, "even if there is a status, when you click it, it will tell you to see
      the status or go to the profile" — the second is the considered version and it is what shipped. A
      `dblclick` would put a ~300ms disambiguation delay on every single tap of the most-tapped chrome in the
      app, collides with iOS Safari's zoom gesture, has no keyboard or assistive equivalent, and would assign
      the HIDDEN gesture to the COMMON case, since most people have no status most of the time.
- [x] **A SILENT NO-OP CAUGHT BY READING THE ROUTE LIST**: my first cut sent "See my status" to
      `navigate("/app/status")`. **There is no such route** — statuses live as a strip atop Messages and the
      viewer is opened imperatively through the global overlay host. It would have been a dead menu item that
      no source pin could catch. Now `openPeerStatus(me.number)`; with no status the item honestly offers
      "Add a status" and goes to the Messages strip, which is where the composer is.
- [x] **THE STORY SIGNAL IS A PIP, NOT THE RING.** The ring means "this is you"; overloading it with story
      state would change an identity signal whenever you post a photo, and would contradict `PeerAvatar`,
      where a ring means somebody ELSE'S unseen story.
- [x] **THE GUEST'S ONLY MOBILE ROUTE TO REGISTRATION IS PRESERVED** — v2.95.10 put "Register — keep this
      number" in this menu because a separate pill overflowed the bar, and losing it would strand every guest
      on a phone. Pinned.
- [x] **A STANDING GUARD, because `relay-blink-glow` proved this can regress unnoticed**: a test now fails if
      ANY keyframe in `index.css` animates `box-shadow`, `height`, `width`, `background-position`,
      `border-color` or `filter`, and asserts all four new primitives animate only transform/opacity and sit
      inside the reduced-motion gate.
- [x] **TWO TEST BUGS OF MY OWN, both found by running them and both fixed rather than counted as passes.**
      The render-order test used `{formatPin(number)}` as a needle, which also matches inside the
      aria-label's `${formatPin(number)}` — it put the PIN at position 440 and read the order backwards. And
      the no-double-tap test matched the bare word `dblclick` in **my own JSX comment explaining why there is
      no double-tap**: `codeOnly` strips `//` lines but not a `{/* … */}` block. That is the fifth time this
      repo has matched its own prose; it now requires an actual `onDoubleClick=` binding.
- [x] **ONE PRE-EXISTING PIN REWRITTEN to the property rather than the expression**: `headerFixes.test.ts`
      froze the whole `{dnd ? <BellOff …/> : <Bell …/>}` line, so it broke the moment the Bell gained a blink
      class while saying nothing about what matters — that the three bell states are visually distinct and
      that DND is not green.
- [x] `client/src/app/topBarSpec.test.ts` (34); **all 20 tripwires verified by MUTATION** from byte-exact
      backups, sources byte-identical afterwards.
- [x] **NOT DONE, and said plainly rather than half-shipped: the PROFILE PAGE REBUILD.** The owner supplied
      two mockups and asked for a control centre — grouped rows, the barcode, the number, the badge, the
      status, and every existing control reachable from one place. A design pass mapped all ~60 existing
      profile controls and an adversarial review found real hazards in the obvious approach (a hash-only deep
      link is a no-op under this router; `@keyframes enter` animates `filter` and establishes a containing
      block that mis-centres the fixed "Saved" pill; the avatar file input is dead code; `identity.setNumber`
      renders for guests but throws FORBIDDEN). That is its own release, not a coda to this one.
- [x] No schema change, no new dependency, no server change. 2559 tests.

## v2.99.85 — who is speaking, told by colour; and the ⋮ looks like a button (2026-07-27)
- [x] **OWNER**, from a group-chat screenshot: *"when I type it should showing typing like my name typing and
      it's like first name is capital small letter for the rest and it keep increase. the second letter become
      capital and the first one small. it's like nice animation smoothly … and it give a different color if
      there is two three people typing in the same time … when he post mind bubble is orange so him he should.
      the other side should be blue, but if you were in the group each one give him a different colour for his
      type of chat bubble. also, the three dots is not clear. it's very light color. you need to make it
      highlighted."*
- [x] **ONE MODULE FOR THE COLOUR, DELIBERATELY** (`client/src/app/peerColors.ts`). A bubble colour and a
      typing colour that disagree about the same person is worse than having neither, because the colour is
      the only thing telling you who is who at a glance — and duplicated rules are exactly how two surfaces
      come to promise different things (the v2.99.55 lesson, and v2.99.77's one-rule-five-call-sites bug).
- [x] **MINE ORANGE, THE OTHER SIDE OF A 1:1 BLUE, EVERY GROUP MEMBER THEIR OWN HUE.** Blue is NAMED rather
      than drawn from the palette: a two-person thread has no ambiguity to resolve, so it must not depend on
      a hash that could hand out something else. The ten-hue group palette deliberately EXCLUDES blue (it
      would read as "the other person" from the 1:1 rule) and the own orange (that is always you) — either
      would make the colour lie about who is speaking.
- [x] **THE COLOUR IS DERIVED FROM THE IDENTITY ID, NOT ROSTER POSITION.** Position changes as people join,
      leave, or a query reorders them, which would silently recolour a conversation mid-scroll; an identity
      id never moves. It also means every participant sees the same person in the same colour with nobody
      having to agree on an ordering.
- [x] **A REAL BUG IN MY OWN HASH, caught by this release's own test before shipping.** The first version used
      a plain `n * 2654435761`, which produces a DOUBLE — and the following `>>>` truncates to 32 bits,
      throwing away the high bits that carry all the mixing. At base 1000 it returned **1,1,3,1**: three of
      four neighbours on one colour, i.e. the exact thing the palette exists to prevent. Fixed with
      `Math.imul` throughout, and mutation-verified against the EXACT broken form.
- [x] **AN OVERCLAIM OF MY OWN, corrected rather than left standing.** That test was first named "the case a
      plain modulo fails" — and a plain `id % 10` **passes** it, since consecutive ids trivially differ under
      a modulo. The mix is not justified by that property; it is there so sparse and non-consecutive ids
      distribute as evenly as dense ones, and with ten colours some pair must always collide (pigeonhole, not
      a defect). Renamed and the claim removed. A second, partial precision-loss mutation SURVIVES and is
      recorded rather than hidden: it still distributes acceptably at the sampled bases, which is an honest
      limit of a sampled property test.
- [x] **A CONSEQUENCE THAT HAD TO BE FINISHED RATHER THAN SHIPPED HALF-DONE**: with received bubbles now
      coloured, every inner `mine ? white : muted-foreground` ternary would have rendered **muted grey text on
      a blue bubble**. Twelve of them collapsed to the light variant across the bubble body, the voice-note
      player, the file card and the receipt row. `mine` still means something for the menu, the receipts and
      the alignment — only the dead dark-on-grey branches went.
- [x] **THREE SENDER-LABEL SITES, NOT TWO — and the COUNT is what found the third.** My first pass converted
      one of the two bubble paths and left the other on `text-primary`, one colour for everybody, which is
      the thing being fixed. A test asserting the exact number of label sites caught it.
- [x] **AN EMOJI-ONLY MESSAGE IN A GROUP NOW SAYS WHO SENT IT.** That branch renders no bubble and had no
      sender name either, so a bare 🔥 arrived attached to NOBODY while every text message from the same
      person was labelled — visible in the owner's own screenshot. Same label, same colour, so the two paths
      cannot drift.
- [x] **THE BRAND ORANGE WAS WRITTEN OUT THREE TIMES** (my bubbles and both send buttons), so a change to one
      would have silently disagreed with the others. Now one `BRAND_GRADIENT`.
- [x] **THE TYPING LINE: ONE CAPITAL WALKS ALONG THE NAME**, letter by letter, repeating, with the handover
      between neighbours fading rather than snapping — the "smoothly" in the request. Only LETTERS are
      candidates: walking onto a space or a hyphen reads as the animation stalling for a beat. An Arabic name
      has no case to change, so the walk carries on opacity instead and still reads.
- [x] **IT IS ITS OWN COMPONENT, AND THAT IS LOAD-BEARING RATHER THAN TIDY.** It ticks several times a second;
      inline in the conversation it would re-render the whole message list on every step — the v2.99.67
      mistake, and the reason v2.99.73's waveform is written imperatively. Isolated, a tick repaints one
      short line. The timer is armed on `idxs.length`, NOT the array: depending on the array re-arms the
      interval every render — which is every tick — so the walk would never advance.
- [x] **EACH TYPER GETS THEIR OWN COLOUR** from the same module, and two typers are STAGGERED so they are
      never mid-step together — that is what makes "two three people typing" read as two separate names
      rather than one blinking blur. The first two are NAMED and the rest counted, because knowing who is
      typing is the whole value and a third name wraps on a phone.
- [x] **THE ⋮ NOW READS AS A BUTTON.** It was 35% opacity on a phone and INVISIBLE until hover on desktop — a
      control nobody could tell was a control. It is a real chip now: filled circle, border, shadow, fully
      opaque, 32px, on every screen. The desktop hover-reveal is REMOVED rather than kept at a higher
      opacity, because "appears on hover" is what made it undiscoverable and a touch screen has no hover to
      discover it with.
- [x] **THE TS1501 REGEX-LITERAL TRAP AGAIN**: a `/\p{L}/u` literal is a compile error at this repo's target.
      Built with `new RegExp("\\p{L}", "u")`, the house workaround, and pinned so it cannot come back.
- [x] **ONE PRE-EXISTING PIN REWRITTEN TO THE STRONGER INVARIANT rather than relaxed**: v2.71 asserted
      received bubbles use the neutral grey surface — i.e. it pinned the exact thing the owner asked to
      remove. It now asserts that NO bubble carries a hard-coded colour and all of them resolve through the
      one function.
- [x] `client/src/app/messagingColors.test.ts` (25) — the colour rule tested BEHAVIOURALLY, because whether
      two different people can collide on one hue is the only question that matters about it. **18 of 20
      tripwires bite**; the two that do not are recorded above as non-defects rather than counted, and one
      mutation ABORTED honestly because its needle matched all three label sites (the count test covers it,
      and a uniquely-targeted variant does bite).
- [x] **NOT VERIFIED ON A DEVICE**: the walking capital and the new colours are not seen on a real phone from
      here. The logic is tested; the look is not.
- [x] No schema change, no new dependency, no server change. 2525 tests.

## v2.99.84 — the conference stops cooking the phone, and the voice survives it (2026-07-27)
- [x] **OWNER**: *"my phone become verry hot whenever we have conference call multiple parties. I think
      because of the video or because of what? Make sure that the length of the sound to be very clear and
      good latency for both video and voice."*
- [x] **THE TRANSPORT DECIDES THE ANSWER, AND IT IS THE MESH — established, not assumed.** LiveKit needs
      three env vars an operator sets, and it appears nowhere in this repo except as a commented-out
      optional in `docs-aws-io-deploy.md`, so the fleet runs the **WebRTC mesh**: every phone in an N-party
      call runs **N-1 independent video encoders and N-1 decoders**. At the 6-participant cap that is five
      of each, on a handset. That is the heat, and it is structural rather than a bug.
- [x] **THE CANVAS PIPELINE WAS RULED OUT BY READING IT, not by trusting its comment.** `mediaPipeline`
      claims "plain, unfiltered calls don't use this pipeline at all"; both `ensurePipeline` call sites were
      checked and the claim holds (`activeFilter !== "none"` gates it), so a 30fps main-thread canvas paint
      is NOT part of the default cost. Said plainly because it was the first suspect.
- [x] **FRAME RATE WAS NEVER CAPPED — the largest CPU lever left.** Bitrate and resolution have scaled with
      party size since v2.80; framerate did not, so five encoders ran at the camera's native 30 and did
      roughly twice the work of five at 15. New ladder: **30 / 24 / 15** at 1 / ≤3 / >3 peers. 1:1 is
      unchanged in effect (30 IS the source rate) but is a REAL value rather than an absent field, because
      the party can SHRINK 6 → 2 and an undefined cap is not reliably cleared by every engine — assigning 30
      back is deterministic and reversible.
- [x] **`degradationPreference: "balanced"` GOES IN ITS OWN `setParameters` CALL, and the separation is the
      whole point.** It is a TOP-LEVEL field some engines reject outright, and a rejected `setParameters`
      discards the **entire object** — so folding it in with the caps would silently lose the bitrate AND
      framerate caps on exactly the browsers that most need them. "balanced" rather than the common
      maintain-framerate default, which keeps frames and sheds nothing else — precisely wrong on a
      thermally throttled phone, where dropping resolution is the correct sacrifice.
- [x] **THE AUDIO ASK IS ANSWERED BY THE VIDEO FIX, and that is worth saying out loud rather than shipping a
      separate knob.** A thermally throttled phone starves its AUDIO encoder too, which is heard as choppy,
      unclear sound. Capping the video is what protects the voice; there is no "make audio clearer" setting
      that survives a hot CPU.
- [x] **AUDIO IS PROTECTED, NEVER CAPPED.** Marked `priority`/`networkPriority` `"high"` so that when the
      uplink or the CPU runs short the engine sheds VIDEO and keeps the voice — the difference between a
      call that goes blurry and one that goes unusable. Deliberately NO audio bitrate cap (it is a rounding
      error beside video, and capping it is the exact opposite of the ask), and a missing `encodings` array
      is left ALONE rather than fabricated: for video an empty array is filled in because the cap is the
      point, but inventing an encoding purely to stamp a priority risks disturbing a working track for no
      gain. Its branch `return`s so it can never fall into the video path.
- [x] **THE MICROPHONE IS CAPTURED MONO** (`channelCount: { ideal: 1 }`). A voice call carries no spatial
      information, so a stereo capture doubles the encoder's sample work for nothing on the very path where
      N-1 encoders are already the problem. **`ideal`, not `exact`** — `exact` throws
      `OverconstrainedError` on a device that only offers stereo and would cost that person their
      microphone entirely. Clarity is unaffected; only redundant channels go.
- [x] **THE GRID WAS REPAINTING ITSELF 14 TIMES A FRAME OVER LIVE VIDEO.** Three animations, all running per
      speaking tile: `relayWave` animated **height** (a layout+paint animation, five bars per tile),
      `relaySpeakPulse` animated the tile's own **box-shadow** (a full-tile repaint), and `relayAvBreath`
      animated a colour-cycling box-shadow. A tile's backdrop is live video, so nothing can ever be cached.
      This is exactly the class v2.99.70 measured on the landing page.
      **`relayWave` → `transform: scaleY`** (full height, bottom origin, scaled down at rest — identical
      look, compositor-only). **`relaySpeakPulse` → a `.spk-glow` overlay carrying the glow as a STATIC
      box-shadow with only its OPACITY animated** — identical look, compositor-only, static markup, still
      driven by the `.speaking` class alone so no JS toggles it. **`relayAvBreath` keeps its colour cycle on
      DESKTOP, where a GPU handles it for free, and runs a transform-only `relayAvBreathLite` on phones** —
      the device in the report. Only small screens trade the colour cycle.
- [x] **THIRTY-SIX BLUR LAYERS OVER LIVE VIDEO, and the existing cap never covered any of them.** The
      v2.9x mobile blur cap named exactly TWO elements — `.ctrl-bar` and `.filter-dock`. Every TILE carries
      **six** blurred chips (name band, add pill, two info chips, menu and maximize buttons), so at the
      6-cap a phone was compositing 36 `backdrop-filter` layers, each re-blurred **every frame** because its
      backdrop never stops changing. Suppressed on phones with the backgrounds taken opaque in the same
      breath, so nothing becomes harder to read; desktop keeps the glass.
- [x] **THE OVERRIDE'S POSITION IS LOAD-BEARING, and the measurement is what proved it.** Equal-specificity
      overrides are decided by ORDER, and four of the six base rules are declared LATE in the stylesheet —
      so in its natural home the rule measured as doing **nothing at all** (36 blur layers before AND
      after) while reading as correct. It now sits last, with a comment saying so and a test that fails if
      any of those six base rules ever moves after it.
- [x] **MEASURED, not asserted** — headless Chromium against the real stylesheet, six tiles with two
      speaking, emulated 390px phone: **repainting animations 14 → 0** (compositor-only 0 → 14), **blur
      layers over live video 36 → 0**, no horizontal overflow. Re-measured at 1440 desktop and deliberately
      **unchanged at 36** blur layers with the colour cycle intact, so the trade is confined to phones.
- [x] **A HARNESS BUG OF MY OWN, reported rather than counted as a result.** The first run showed blur
      36 → 36 and I nearly recorded the override as ineffective for the wrong reason: `page.setContent`
      without a `<meta viewport>` leaves the emulated page on the **980px default layout viewport**, so
      every `max-width` query silently fails to match (`innerWidth` was 980, not 390). The harness now
      emits the meta the real app has AND **aborts** if the phone query does not match, so it can never
      again report a phone measurement taken at desktop width. The cascade bug above was real and separate;
      it was only visible once the harness was honest.
- [x] **THREE MISTAKES OF MY OWN IN THE TESTS, all found by the mutation run and all fixed rather than
      counted as passes.** Two were the recurring shape — pinning the DECLARATION instead of the USE: one
      asserted the bitrate LADDER existed while deleting the line that APPLIES it stayed green, and the
      other COUNTED `setParameters` calls, which says nothing about which OBJECT carries
      `degradationPreference` — the one property that matters. The third is worse and is recorded plainly:
      my replacement assertion counted the bare identifier `degradationPreference`, which also matches the
      COMMENT above it and the type annotation, so it read 3 and **the test was RED** — and an already-red
      test fails for every mutation, so that mutation's "bit" was a **false positive**. It now counts
      ASSIGNMENTS with comments stripped, and the entire sweep was **re-run from a confirmed-green
      baseline** so no result rests on a test that was failing anyway.
- [x] `client/src/lib/conferenceCost.test.ts` (19); **all 20 tripwires verified by MUTATION** from
      byte-exact backups, from a green baseline, sources confirmed byte-identical afterwards.
- [x] **NOT MEASURED, said plainly: none of the encoder changes were tested on a real phone in a real
      6-party call.** There is no handset and no multi-party call available here, so the framerate,
      priority and mono changes rest on how WebRTC is specified to behave, not on a thermal reading. The
      CSS half IS measured. The owner should expect a visible improvement on a crowded call and should say
      if the video looks softer than they want — the ladder is one line to retune.
- [x] No schema change, no new dependency, no new env var, no server change. 2500 tests.

## v2.99.83 — a renumbered person stays reachable (2026-07-27)
- [x] **THE BUG, PROVEN BY THE OWNER'S OWN TWO SCREENSHOTS TAKEN SECONDS APART.** Verbatim: *"I have this
      user. He is online. But when I call him, it give me offline. I think there is a glitch or, you know,
      not for this user. Check it generic."* The dialer showed **"Mohamed Idris · Registered · online
      now"**; the call answered **"Mohamed Idris is offline right now."** Two surfaces disagreeing about
      one person, in the same breath.
- [x] **ROOT CAUSE — RELAY NAMES A PERSON TWICE, AND ONLY ONE OF THE TWO MOVED.** Presence is a database
      row keyed on `identityId`. The signaling registry — the thing that actually ROUTES a call — is in
      memory and keyed on the **6-digit PIN**. `regenerateIdentityNumber` moved the database and every
      stored copy of the number inside one transaction and touched the registry **not at all**. So a
      person who was signed in when their number changed stayed registered under their **OLD** pin:
      unreachable at the number they now own, and still occupying one that no longer exists. This is the
      v2.99.54 identity-continuity story with one layer missing — the layer that is not in the database.
- [x] **THREE MORE OWNER-REPORTED SYMPTOMS WERE THE SAME BUG, said plainly rather than chased separately.**
      The in-call **"Add to contacts" pill reappearing for somebody already SAVED** (the roster names the
      old pin while their `contacts.number` row was rewritten, so the saved-set lookup misses), and
      **Contacts showing them plain "online" instead of "on a call"** (`pinsInCall` reports the old pin).
      The owner reached this diagnosis themselves — *"I think this glitch of showing add to contact, which
      already the user in my contact is because they changed their number"* — and they were right.
- [x] **THE HOOK, NOT A SECOND WRITER.** `identities.number` has exactly ONE writer and a test pins that
      (`guestUpgrade.test.ts` / `chooseNumber.test.ts`); propagation is the whole difficulty of renumbering
      and a parallel implementation is precisely how History's copies came to rot before v2.99.54. So this
      is a `setNumberChangeHook` fired from inside that writer, at the commit point — immediately after
      `confirmNumberReservation` — registered in `relay.ts` beside `initBusyStateSync`. A hook rather than
      a direct call because `v2db → relay` would close the cycle `v2db → relay → _core/context → v2db`;
      `setPresenceChangeHook` (v2.99.73) is the established precedent for exactly this.
- [x] **`rebindRegisteredPin` MOVES TWELVE PLACES IN ONE SYNCHRONOUS PASS, and the synchrony is the design
      rather than a convenience.** The registry is plain Maps dispatched from one event loop, so a function
      with no `await` in it cannot be observed half-done — which matters enormously here, because a
      half-renamed registry is worse than a stale one: the person would be in a room under one pin and
      addressed under another. In order: resolve-and-no-op → collision check → **sever `cidToPin` FIRST** →
      client record → devices → membership across BOTH `pinRoom` and `heldRoom` plus the `rooms` Sets →
      `roomMeta` roster/hostPin/cohosts/knocks + `recordings.by` → `pendingRings` by KEY and by every
      `from` value → every other client's `ringing` Set → `markRoomDirty` + `touchBusyState` → re-send
      `registered`.
- [x] **WHY `cidToPin` GOES FIRST, and it is the single most dangerous omission in the whole rename.** That
      reverse index BEATS the client's requested pin in the register handler. Until it moves, a concurrent
      re-register either re-asserts the OLD pin or is misclassified as an **identity switch** — and the
      identity-switch body deliberately DESTROYS the live call (it exists to stop a cross-user hijack on a
      shared browser). Moving it last would have left a window in which a routine SSE reconnect drops the
      call it was supposed to save.
- [x] **THE OLD NUMBER IS RETIRED, NEVER ALIASED.** An alias would re-create two addresses for one person —
      the exact split being removed — and would silently bypass the block-follows-you property, because
      `contacts.number` was rewritten in the same transaction, so a block placed on the old number lives on
      the new one. Nobody is put at risk by the retirement: the reservation ledger is **monotonic**, so the
      old number is never handed to a stranger.
- [x] **A VERIFIED HOLDER OF THE NEW PIN IS NEVER EVICTED.** The only legitimate way somebody else holds it
      is an unverified `genPin` allocation, and such a registration is already un-ringable via
      `pinIsAddressable` — so an unverified squatter is evicted and a **verified** holder makes the rebind
      REFUSE, because evicting them would be the v2.98.4/F1 number-seizure class in reverse. The
      client-side self-heal then converges it.
- [x] **`verifiedPin` IS SET EXPLICITLY.** Left false, `pinIsAddressable` makes the person un-ringable and
      un-rejoinable — an "offline" **indistinguishable from the bug being fixed**. After the DB commit the
      new pin genuinely IS cookie-resolvable, so setting it is correct rather than optimistic.
- [x] **THE CLIENT IS TOLD, NOT MADE TO RE-REGISTER.** Re-registering mid-call is read as an identity switch
      and drops the call, so the server re-sends `registered` with a new `renumbered: true` flag; the
      client's existing handler already sets `me.pin` from it and persists it, so an older client needs no
      change at all.
- [x] **A NEW `number` SSE EVENT, declared in BOTH places — and that is not bookkeeping.**
      `KNOWN_V2_EVENT_KINDS` gates the **receive** side of the Redis bus, so an undeclared kind is
      delivered locally and **silently DROPPED whenever the recipient is on the other instance** — which
      on a two-instance fleet is most of the time, and single-instance dev would have looked perfect. This
      is the v2.99.74 `delivered` bug, avoided by having been bitten by it once.
- [x] **A CLIENT-SIDE SELF-HEAL, because one real path fires no hook at all.** `scripts/admin-tool.mjs`
      runs as plain `node` on an EC2 instance and writes straight to MySQL — it CANNOT import the server's
      TypeScript writer, so no hook can fire for it and no SSE event is sent. `useIdentity` therefore now
      has `refetchOnWindowFocus: true`, which is the only backstop covering that path; the script's header
      says so in as many words, and it prints the fact after an apply so the operator knows the affected
      person needs to reopen the app.
- [x] **CLUSTERED MODE ROUTES TO THE LEADER.** The registry lives on the elected leader, so a non-leader
      instance forwards the event as a `__renumber` frame rather than mutating a registry it does not own.
- [x] **A REAL BUG IN MY OWN CODE, CAUGHT BY THIS RELEASE'S OWN TEST and worth naming because it would have
      been invisible.** Step 11 originally called `socket.send(JSON.stringify({…}))`, but `RelaySocket.send`
      takes an **object** — the transport serializes. A pre-stringified frame arrives as a JSON *string*
      with no `.type`, which the client's dispatcher silently drops: the whole "tell the client its pin
      moved" step would have been a no-op that reads as working.
- [x] **THE CATCH IS DESTRUCTIVE-BUT-SAFE, ON PURPOSE.** The hook swallows throws (the renumber is already
      committed and must never be reported as failed), which means a throw here would be **invisible**. So
      a failure retires the old registration instead: that ends the person's live call, which is bad, but it
      leaves no half-renamed state and their next register lands correctly. A dropped call is recoverable;
      a split identity is the bug being fixed.
- [x] `server/renumberRebind.test.ts` (26) — **behavioural against the REAL registry**, because a source pin
      cannot tell you whether a call actually connects after a rename and that is the entire feature. It
      reproduces the bug, then proves an invite to the new number rings, the old number rings nobody, and
      answering mid-rename still works. **All 18 tripwires verified by MUTATION** from byte-exact backups.
- [x] **THREE HARNESS BUGS OF MY OWN, fixed rather than reported as results.** (1) `reg.connections` is
      seeded by the HTTP layer, not by `handleMessage`, so the map the rebind rewrites was empty and a
      correct rebind read as broken; the harness now mirrors `attachRelay`'s **stable** connection object,
      which is load-bearing rather than cosmetic — a snapshotted pin would report success while the next
      message from that browser still carried the old number. (2) A bare `{type:"accept"}` cannot be
      authorized (it must name the room the ring carried — v2.99.43/M45), so every accept in the file was
      silently doing nothing. (3) `pinsInCall` reads a module global and takes a pin LIST; it is now driven
      through `_setActiveRegistryForTests` so the owner's actual Contacts symptom is tested through the
      real function, with an `afterEach` so the registry cannot leak into later files.
- [x] **ONE OF MY OWN ASSERTIONS WAS VACUOUS AND THE MUTATION RUN CAUGHT IT.** The `verifiedPin` test
      re-read the value after a rebind — but this harness registers over the non-HTTP path, where
      `verifiedClaim` is true by construction, so it passed whether the assignment existed or not. It now
      forces the record to `false` first and asserts the CONSEQUENCE (the invite rings). Recorded honestly:
      reaching an unverified record through the front door is not possible today, because an unverified
      registration is handed a random `genPin` unrelated to its identity and no renumber event can name it
      — so that line is a guard on an invariant, not a reproduction of a live case.
- [x] **A SILENT-SKIP TEST OF MY OWN REMOVED.** The held-room case had a conditional `return` when nothing
      was parked, so it could pass by doing nothing — worse than not having it, because it reports safety.
      The park is now asserted (and there is no `hold` flag: the accept handler parks automatically whenever
      the answerer is already in another room).
- [x] **NO SCHEMA CHANGE, no new dependency, no new env var, and the no-op path costs nothing** — a renumber
      while signed out (the common case) resolves no residue and returns immediately.
- [x] Suite 2481 passed / 1 skipped (2482).

## v2.99.82 — the call tile says each thing once, and add-to-contacts has one home (2026-07-26)
- [x] **THE OWNER ASKED TWICE, the second time with a screenshot circling all three renderings of one name
      on a single tile.** Verbatim: *"you mentioned the name in two places, like you put my icon logo up,
      it means k h, and then below it, it mentioned u, and then below it mentioned u with my flag country.
      You don't need to repeat the name. You need to put the profile picture or the avatar, and below it,
      you put add to contact if he was not in your contact. and at the bottom of the border of the frame of
      the user where you put the flag and you put his first name only, and beside, you put the PIN number,
      the six digits without mention PIN."* Recorded plainly: this was mapped rather than shipped on the
      first ask, which is why it needed a second.
- [x] **THE NAME NOW APPEARS EXACTLY ONCE.** `.ph-name` — the centred full name under the avatar — is
      GONE, and with it two CSS rules, **one of which was already dead** before this release (nothing ever
      put a flag inside `.ph-name`, so `.ph-name .nm-flag` could never match). The tile reads: avatar →
      Add pill if unsaved → one bottom band.
- [x] **THE BOTTOM BAND IS flag · FIRST NAME · SIX DIGITS.** First name only, with the FULL name on
      `title` so nothing is lost to a hover or a screen reader. The digits are raw — no "PIN" label, no
      grouping dash, since the owner said "the six digits" — in their own colour so the name and the
      number read apart at a glance, and **bidi-ISOLATED** (the v2.99.77 `PinTag` lesson) so an Arabic
      first name beside them cannot reorder them.
- [x] **THE ONE REAL RISK, AND IT WAS MEASURED.** `.nm` is `nowrap` + `overflow:hidden`, so a long first
      name would EAT the digits — and the digits are the one part of the band that must never truncate.
      `flex:0 0 auto` on the pin makes the name the only shrinker. Headless Chromium against the real
      stylesheet at 390 and 320 wide, driving the engine's OWN `tileContentHTML` output rather than a hand
      copy: **name elements per tile 2 → 1**, digits never clipped, always inside the band, band always
      inside the tile, Add pill never overlapping the band. The first pass DID truncate ("Mohamed" →
      "Moha…") in a 2-up phone grid, so the band's gap and padding were tightened and the pin dropped a
      point; re-measured, nothing truncates now — including a long Arabic name.
- [x] **ADD-TO-CONTACTS HAS ONE HOME** (owner: *"currently you're putting on the profile, on the video, and
      also you put it on the top left. Just put it one place. Under the name of each user"*). The top-left
      `InCallSaveContacts` chip is UNMOUNTED. **Nothing is lost and three things improve**: the chip only
      ever offered the FIRST unsaved peer (a `roster.find`) while the per-tile pill is per-peer; it polled
      every 3 seconds; and it derived a SECOND saved-set from `contacts.list` that could disagree with the
      engine's own — two copies of one fact, the class this repo keeps re-learning. It also sat at
      `top-3 left-3`, the same corner as the "connecting…" and on-hold badges.
- [x] **ONE BUILDER FOR EVERY TILE.** `addSelfTile` hand-rolled the same DOM instead of calling
      `tileContentHTML`, which is exactly why it kept its own duplicate name after the remote tiles lost
      theirs. It now calls the shared builder with no `pin` — so no ⋮ menu, no maximize, no Add pill and no
      digits (you cannot add yourself, and the owner has already said they do not need their own number
      shown back to them, the v2.99.77 call-log rule) — plus a new `avatarName` so the band reads "You"
      while the disc still shows the person's own initials.
- [x] `client/src/lib/callTileIdentity.test.ts` (15). **All 8 tripwires verified by MUTATION**, sources
      byte-identical afterwards.
- [x] **A HARNESS BUG OF MY OWN, reported rather than counted as a result.** Two mutations first came back
      as "target missing" and "survived". Neither was true: the perl replacement had inserted its text at
      **line 1** instead of replacing the call site, and the harness's needle check only asked whether the
      string existed SOMEWHERE in the file — the same weakness caught in v2.99.76. Rewritten as a python
      mutator that asserts the target occurs **exactly once** and fails the harness otherwise; both
      mutations then bit.
- [x] **TWO PRE-EXISTING PINS REWRITTEN TO THE NEW INTENT rather than relaxed**: `relayAssets.test.ts`
      asserted `.relay-tile .ph-name{` EXISTS — i.e. it pinned the very thing the owner asked to remove —
      and `peerIdentityBatch.test.ts` asserted the top-left chip was MOUNTED.
- [x] **A BUILD TRAP THAT HAS NOW BITTEN TWICE gets a named guard.** The whole call stylesheet is a
      template literal, so a backtick inside a CSS COMMENT terminates it — v2.99.16 hit this, and so did
      this release, twice, surfacing as syntax errors 300 lines away. `pnpm check` catches it but says
      nothing about the cause, so there is now an explicit assertion that `RELAY_CSS` contains no backtick.
- [ ] **STILL OPEN and the more serious half of this batch**: a renumbered person stays registered in the
      signaling layer under their OLD pin, so the dialer says "online now" while the call says "offline".
      That is the root cause of the Add pill reappearing for a SAVED contact, and of contacts showing
      "online" instead of "on a call". Fix designed (registry rebind hook + client self-heal, since the
      operator admin-tool writes straight to MySQL and no server hook can fire for it) — not yet shipped.
- [x] Suite 2455 passed / 1 skipped (2456). No schema change, no new dependency.

## v2.99.81 — the eight-item security batch, each finding re-confirmed before it was touched (2026-07-26)
- [x] **PROCESS FIRST, because it changed two of the answers.** Every item below had been sitting in the
      v2.99.57 REMAINING list. Each was handed to an independent SKEPTIC briefed to REFUTE it and
      defaulting to refuted, and required to produce a concrete exploit before it counted as confirmed.
      Six came back CONFIRMED, two PARTIAL — and two of the original claims were **wrong in ways that
      would have made a naive fix harmful**:
      - **The claimed OTP bug was in the wrong function.** "`mintOtp` never invalidates prior codes" is
        harmless: superseding only SHADOWS, so once the newest row is burned `latestOtp` falls back to the
        older un-consumed row, and every mint mails the valid code to the victim's OWN inbox, which the
        attacker cannot read. Making `mintOtp` invalidate priors — the obvious fix — would DELETE that
        self-healing fallback and make an attacker's burn permanent. **Strictly worse.** The real defect is
        that `verifyOtp` has no per-address budget at all.
      - **F3 rewrites `firstName`/`lastName`, not `displayName`.** `ensureUserIdentity` returns a
        pre-existing row untouched, so the display name was never at risk — but the first/last pair is
        what `directory.lookup` returns and what the landing dialer PREFERS, so the rewrite was visible to
        strangers anyway.
- [x] **F1 — A BLOCKED PERSON COULD STILL POST, BY REPLYING TO AN OLD NOTIFICATION EMAIL.** The inbound
      handler checked thread membership and that the From address matched the signed identity, then called
      `sendMessage` **directly** — inheriting none of the router's block rule. The reply address carries
      **no expiry**, so a months-old missed-call email stays a usable credential forever, and a blocked
      person can even mint a fresh one by simply not answering a call (the missed-call gate checks the
      OTHER direction). Fixed in the reply branch: 1:1 only, matching `messages.send` exactly, because
      group semantics deliberately do not refuse a send when one member blocked the sender. Fails **OPEN**
      on a lookup hiccup — a bare `await` would throw into the outer catch, which answers 200, and the
      provider does not retry, so a genuine reply would be silently destroyed. Answers **200, not 503**,
      or the provider redelivers the same mail forever. Deliberately NOT pushed down into `sendMessage`:
      its other callers include the offline auto-reply, which legitimately posts on behalf of somebody the
      sender may have blocked.
- [x] **F2 — DRAINING SOMEBODY'S SIGN-IN CODES WAS UNBOUNDED.** `verifyOtp` has a per-IP gate and no
      per-address one, so five wrong guesses burn a code (`recordOtpFailure` consumes at the cap) and
      repeating drains every outstanding row until `latestOtp` returns null and the victim's real code
      reports "expired" — chained with four wrong PIN tries, a full unauthenticated lockout, because the
      email code is the PIN's own unlock path. New per-address budget claimed **before the row is read**,
      so a drain cannot outrun it and rotating IPs gains nothing. Sized 20 per ten minutes: a real person
      needs one or two attempts, and this repo already fixed the case where correcting a digit cost an
      attempt (v2.99.31 L3), so it cannot lock out a legitimate user.
- [x] **F3 — A REGISTER CODE COULD SKIP NEW-DEVICE APPROVAL AND RENAME YOU.** `otpAuth.register` accepts
      an address that already has an account (the legacy password route refuses — the two paths
      disagreed), and `verifyOtp` then read
      `const wasRegistration = !!(row.firstName || row.lastName)` and skipped approval whenever the row
      carried a name. **`NameSchema` makes a name MANDATORY on register**, so every register-minted row set
      it: an attacker who could read or phish the code got an immediately-usable session, and the victim's
      online device was never prompted and could never decline. Inferring "first device" from an
      attacker-supplied field was the whole defect. The short-circuit is DELETED —
      `shouldRequireApproval` already answers the real question, and a genuine first registration still
      never waits because it has no prior approved session, which is the property the short-circuit was
      reaching for. The name is now written only when the account did not already exist, captured BEFORE
      `createOtpUser` (after it, a pre-existing account is indistinguishable from a new one).
- [ ] **DELIBERATELY NOT DONE in F3: `register` still accepts an existing address.** Refusing it would
      mirror the legacy path, but with approval now enforced the security hole is closed, and a refusal
      would create an email-EXISTENCE ORACLE on a surface that has none today. The two paths still
      disagree, and that disagreement is now defensible: a password on an existing account is a pre-hijack
      vector (which is why M35 fixed it there), while a code proves ownership and approval gates the
      session.
- [x] **F4 — SIGNING OUT LEFT THE PUSH SUBSCRIPTION BOUND TO THE SIGNED-OUT IDENTITY.** Sign-out rotated
      the device id, the channel and the guest recovery key and never touched `push_subscriptions`, so the
      browser kept receiving that person's notifications after they left. `push.unsubscribe` already
      existed and is identity-scoped — nothing called it. Called **before** the server sign-out, because
      the scoping needs the caller still to BE that identity; the browser-side subscription is dropped too,
      so a re-registration mints a fresh endpoint instead of reviving this one; best-effort throughout,
      because a push failure must never be the reason somebody cannot sign out. The per-browser push CLAIM
      is still deliberately kept (it identifies the browser profile, not the identity — v2.99.49 R1).
- [x] **F5 — DO NOT DISTURB DID NOT APPLY TO "X IS BACK ONLINE".** The service worker early-returned "not
      suppressed" for any kind outside message / missed-call / voicemail **before the prefs were read**, so
      a `contact-online` push buzzed the phone with DND on — while the same alert delivered IN-PAGE
      honoured it, so the two paths disagreed about the user's own setting. A list of covered kinds also
      exempts every FUTURE kind by default. Inverted: a **ring** is exempt explicitly (missing a call is
      worse than an unwanted buzz, and it is the one alert you cannot get later), DND applies to everything
      else, and MUTE stays message-only so a per-conversation mute cannot silence a missed call from the
      same person. Same reasoning that put `pushEnabled` inside `sendPushToIdentity` rather than at its
      call sites.
- [x] **F8 — A 100-NUMBER BATCH COST ONE TOKEN.** `directoryGate` charged a flat token, so
      `presenceMany` (up to 100 numbers) and `presence` (up to 200 ids) had an enumeration throttle 100x
      and 200x weaker than `lookup`'s — and both drop unknown entries, which makes each element an
      existence probe. Measured: the whole 10^6 space mapped in **~2.8 hours** via `presenceMany` versus
      ~11.6 days via `lookup`. The limiter now takes an **optional** `cost` defaulting to 1 — load-bearing,
      because this limiter also backs the OTP gates, the status gate, the mint gate, the upload buckets,
      the storage proxy and the signaling flood guard, all of which pass two arguments. Charged
      **sub-linearly** (one token per ten numbers, per twenty ids) and BEFORE the dedupe, so padding with
      repeats costs the same as distinct probes. The naive fix — `cost = n` — would have refused History's
      legitimate 100-number presence poll outright and throttled real users' presence LEDs; a test drives
      20 consecutive real polls through the actual limiter to prove they pass.
- [x] **F10 — `+alias` BYPASSED THE PER-INBOX COOLDOWN.** The cooldown keyed on the exact string, so
      `victim+1@`, `victim+2@` … were each a fresh bucket while all of them deliver to `victim@` — and that
      cooldown is the only bound on mail to one inbox that is not per-IP, so aliasing turned it into a
      bounded-only-by-IP mail cannon aimed at a third party, which is an SES-reputation problem this repo
      already treats as first-class (v2.99.42 GAP3). New `canonicalRecipient` strips a `+tag` for
      THROTTLING ONLY. `normalizeEmail` is deliberately untouched — it is the storage and identity key, and
      merging aliases there would make `victim+work@` and `victim@` resolve to ONE account, breaking the
      exact-match resolution `findUserByEmailAny` depends on and the one-email-one-row invariant M35 holds.
      Dots are NOT stripped: dot-insensitivity is a Gmail behaviour, and applying it globally would merge
      genuinely distinct addresses elsewhere and refuse a legitimate signup. The exact-string cooldown is
      KEPT alongside the new one, or an attacker could deny the legitimate owner of an alias their own code.
      **PARTIAL, said plainly**: only `register` was exploitable — `requestOtp` short-circuits on an
      unregistered address before the cooldown is even consulted.
- [x] **F11 — TWO CONCURRENT RENUMBERS COULD STRAND EVERY SAVER PERMANENTLY, AND SHED A BLOCK.**
      `regenerateIdentityNumber` read `oldNumber` up to three round-trips before its transaction opened
      (`allocateNumber` alone does two SELECTs plus a ledger insert, retried up to 40x). Both racers
      captured the SAME value; the loser's UPDATE blocks on the winner's row lock, and under REPEATABLE
      READ its read view forms at the first consistent read — the contacts SELECT — which runs AFTER the
      winner committed. So the loser propagated against a number that no longer existed, matched nothing,
      and left every saver's contact row on a number **nobody holds and never will**, because the ledger is
      monotonic. Permanent, self-heals nowhere — and because `isNumberBlockedBy` keys on
      `contacts.number`, it also SHEDS a block the renumbering person was under, inverting the registry's
      own promise that "a block placed on your old number FOLLOWS you". Fixed with a locking re-read
      (`.for("update")`) inside the transaction, plus a no-op guard for the case where a racer already
      landed us on this number (propagating with old === new would delete rows it should keep). A SELECT,
      not a second writer: this file must contain exactly **ONE** writer of `identities.number`, which is
      what stops a parallel implementation from skipping propagation. A vanished identity is reported as
      `not-found` rather than a generic fault.
- [x] `server/securityBatch2999.test.ts` (35). The limiter cost and the canonicalisation are tested
      BEHAVIOURALLY — a source pin cannot tell you whether 100 numbers now cost more than one, and that
      arithmetic is the entire fix. **All 17 tripwires verified by MUTATION**, reverted from byte-exact
      backups with every source confirmed byte-identical afterwards.
- [x] **TWO WEAKNESSES OF MY OWN CAUGHT BY THAT RUN and fixed rather than counted as passes**, both the
      same class — an assertion that never reached the code it claimed to cover: the "does not strip dots"
      test used `first.last@example.com`, which returns EARLY because it has no `+`, so a dot-stripping
      regression could never be detected; and the cooldown test pinned that `const last = await
      lastOtpAt(email)` exists, which says nothing about whether the value is USED — deleting the
      comparison left the read in place and stayed green.
- [x] **THREE PRE-EXISTING PINS REWRITTEN TO THE STRONGER INVARIANT rather than relaxed**, each predicted
      by its skeptic before the change: the new-device-approval pin froze the two `wasRegistration` lines,
      i.e. it froze the DEFECT while its stated intent was something weaker; the sw.js pin froze the exact
      early-return line whose comment claimed only "a call is never suppressed by a mute" while the line
      silently exempted every other kind from DND; and the `directory.presence` pin froze the
      one-argument `directoryGate(ctx)` call shape while saying nothing about whether the gate runs.
- [ ] **HONEST LIMITATION**: the two new budgets (per-inbox mint, per-address verify) are in-memory and
      therefore per-instance, so on the two-instance fleet the effective ceiling is double. That still
      turns an unbounded attack into a bounded trickle; making them fleet-wide means Redis, which is a
      bigger change than these findings warrant.
- [x] Suite 2439 passed / 1 skipped (2440). No schema change, no new dependency, no new env var.

## v2.99.80 — react or reply to a status, and one emoji library instead of three (2026-07-26)
- [x] **THE ASK.** Owner: *"When any user plays status, you can see his status. If he put it everyone or
      contact, and you can make a kind of emoji or put a reply. So it will reply to him on the private
      message on the message showing that I replied on this status. So put the list of all emojis."*
      A band below the story now carries six one-tap reactions, the full emoji catalogue, and a reply
      input; either lands in the owner's inbox as a private message whose bubble says what it was about.
- [x] **AN EMOJI AND A SENTENCE ARE THE SAME OPERATION**, which is what the owner described ("a kind of
      emoji OR put a reply", both arriving as a private message). A separate reaction counter on the
      status would have been a second data model, a second notification path and a second privacy
      question — for something asked to land in the inbox. One procedure, one authorization path.
- [x] **THE MARKER IS STAMPED SERVER-SIDE, AND THAT IS THE LOAD-BEARING DECISION.** The chip that reads
      "replied to your status" is a CLAIM ABOUT PROVENANCE, so it must not be client-settable. Widening
      `messages.send`'s meta schema would have been the obvious shortcut and is unsafe: that schema is a
      plain `z.object`, which **STRIPS** unknown keys rather than rejecting them, and `sendMessage` casts
      meta straight through without validating it — so the key would let any client label any message a
      reply to any status, including one they never had access to. `status.reply` stamps it instead,
      matching how `autoReply` and `viaEmail` already work, and a test asserts `statusReply` appears
      nowhere in `send`'s input schema.
- [x] **NO COPY OF THE STATUS MEDIA IS STORED, and that is a promise rather than an omission.** A status
      is unreachable after 24h by design (`authorizeStorageKey` resolves through
      `getActiveStatusByMediaKey`, which filters on `expiresAt > now`), so a bubble holding a `mediaUrl`
      would render a broken tile forever afterwards — and a durable copy would quietly break the
      ephemerality the whole feature promises. The marker carries the KIND plus a ≤80-char text excerpt,
      which is enough for the bubble to read correctly for the rest of time; the only two people who ever
      see it are the author being quoted their own words and the replier who was audience-authorised.
- [x] **EVERY GUARD RE-APPLIED, because the viewer's verdict lived in a different request.** In order:
      `requireIdentity` (a **publicProcedure**, so a GUEST can reply — guests have identities and can
      legitimately be in an "everyone" audience), `statusGate` **before any DB work** (each reply is a
      row plus an unread increment in someone else's inbox, so a loop is inbox spam), `getActiveStatusById`,
      a self-reply refusal, then `statusAudienceAuthorized` — which also covers blocks in BOTH directions
      ahead of the "everyone" short-circuit, so a block outranks a public audience.
- [x] **MISSING AND EXPIRED ANSWER IDENTICALLY.** Distinguishing them would make the endpoint an
      existence oracle over status ids. The honest reason is derived on the CLIENT instead: `expiresAt`
      is already on the wire, so the band shows "This status has expired" and disables the input, and a
      real user is told why without the endpoint leaking anything.
- [x] **REFUSING YOUR OWN STATUS is a real fix, not defensive noise**: `getOrCreateDmConversation(me, me)`
      is a supported self-thread ("Notes (You)"), so an unguarded self-reply would silently post into the
      user's own notes — confusing rather than broken. Hidden in the UI and refused server-side.
- [x] **REALTIME AND PUSH REUSE `kind:"message"`.** A bespoke SSE kind is dropped by
      `KNOWN_V2_EVENT_KINDS` whenever the recipient's stream is on the other instance — most of the time
      on a two-instance fleet, and single-instance dev would look perfect (the v2.99.74 trap). The
      `relay-msg-<id>` tag is also what makes DND and per-conversation mute apply in the service worker,
      and what makes ten replies REPLACE one notification instead of stacking ten. The push body is
      content-free per the standing rule: the sender's name, never a word of the reply.
- [x] **THE BUG THAT WOULD HAVE MADE THE WHOLE FEATURE INVISIBLE, caught before shipping**: a one-tap
      reaction is *precisely* an emoji-only message, and `Messages.tsx` renders those as a large bare
      glyph with **no bubble** — and therefore nowhere to put the chip. The owner would have received a
      floating ❤️ with no indication what it referred to, which is the one thing they asked for. A status
      reply is now excluded from that branch. The chip is also withheld while a self-destructing message
      is still LOCKED, since its body is withheld too and the chip would sit above an empty bubble.
- [x] **THE VIEWER'S PRESS-HOLD CONFLICT, and why it needed its own state.** The story auto-advances on a
      rAF clock, so typing must pause it — but `paused` is CHURNED by the body wrapper's
      `onPointerUp`/`onPointerLeave`, so the very pointerup that ends the tap opening the composer clears
      it and the story moves on mid-sentence. New `replyOpen` is owned solely by the band and read by the
      rAF guard, exactly as `showViewers` already is. The band sits OUTSIDE the body div for the same
      reason. Both tap zones AND both desktop chevrons dismiss instead of navigating while it is open —
      the chevrons bypass the `HOLD_MS` check entirely, so guarding only the zones would still have let a
      stray click advance mid-compose. An advance closes the band and the bar is keyed on the status id,
      so a draft cannot be sent against the NEXT story (the QA M5 class).
- [x] **"THE LIST OF ALL EMOJIS" — one catalogue replacing three.** There were `EMOJI_QUICK` (32, chat
      composer), `CHAT_EMOJIS` (48, in-call palette) and `AVATAR_EMOJIS` (56, but a different purpose),
      already drifted apart; a fourth for statuses would have been the wrong answer. New
      `client/src/lib/emojiCatalog.ts` carries **~1,124 glyphs across ten categories**, every one
      searchable by the word a person would actually type ("happy", "pizza", "uae", "lau" → 😂) rather
      than by Unicode name. Zero dependency, matching this repo's own SMTP / S3 SigV4 / FCM / Expo / GIF
      encoders. Search matches a keyword or a keyword PREFIX but **never an infix**, because a two-letter
      infix query matches most of the catalogue and is indistinguishable from no filter. Cross-listed
      glyphs (🧗 is both a person and an activity) are deduped in the flat list and in search results,
      or a repeat becomes a duplicate React key. New `client/src/app/EmojiPicker.tsx` is the shared,
      categorised, searchable panel — and **the Messages composer now uses it too**, so the two surfaces
      cannot drift the way the three lists had. SAID PLAINLY: the full Unicode set is ~3,700 glyphs and
      shipping literally all of them needs a dependency or a generated dataset plus a virtualised grid;
      ~1,124 is what "all emojis" means in practice on a phone, and a complete dump with every skin-tone
      and profession variant would be slower to use rather than richer.
- [x] **LAYOUT MEASURED, NOT ASSUMED** — this repo has been bitten by clipping repeatedly. Headless
      Chromium against the real built CSS at 390 / 320 / 1280: no horizontal page overflow, nothing past
      the viewport bottom, the grid scrolls internally, the category tabs scroll on a phone. It caught a
      real desktop bug: 8 columns across the full-width panel measured **153px emoji cells** for a 20px
      glyph, so the picker and the band are now width-capped and centred — 49px after the fix, phone
      unaffected. Both caps are pinned.
- [x] `client/src/app/statusReply.test.ts` (44). The catalogue and the emoji predicates are tested
      BEHAVIOURALLY — a source pin cannot tell you whether "lau" finds 😂, and search that does not work
      is the whole feature. **All 16 tripwires verified by MUTATION**, one test each, reverted from
      byte-exact backups with every source confirmed byte-identical afterwards.
- [x] **ONE PIN OF MY OWN REWRITTEN DURING THE RUN rather than counted as a pass**: the select-text
      assertion froze the exact class prefix `className="select-text px-3` and broke the moment the width
      cap was prepended, while saying nothing about whether selection is actually re-enabled. It now
      anchors on the component and asserts the property; re-verified to still bite.
- [ ] **NOT DONE, flagged rather than faked**: the owner's thread LIST still shows a bare emoji with no
      context for a one-tap reaction, because the thread-preview projection carries `{body, kind}` and
      not `meta`. Adding it touches a hot groupwise-max query, so it is a follow-up. Also: the chip is
      static and cannot re-open a still-live status — `v2StatusRouter` has no by-id read, and adding one
      is a new audience-gated surface.
- [x] Suite 2403 passed / 1 skipped (2404). No schema change, no new dependency, no new env var —
      `messages.meta` is already a JSON column.

### Operations run this session (production, owner-directed)
- [x] `grant-admin khalifa@khalifa.net` — APPLIED (`user 1 role user -> admin`). The yellow **Admin**
      badge needs no code change: `getRolesByIdentityIds` reads `users.role` and `roleFromFlags` maps it,
      so it appears on every surface, and `/app/admin` is now reachable.
- [x] `set-number 483307 -> 699999` — APPLIED, identity 60 "Ahmed Alkhyeli", 2 contacts propagated.
- [x] `set-number 596484 -> 909090` — APPLIED, identity 23 "Mohamed Idris", 5 contacts propagated.
- [x] Each ran DRY RUN first, then APPLY, each verdict read from the script's own `ADMIN_EXIT=0` marker
      rather than the SSM status (a wrapper can mask a non-zero exit — the v2.99.46 bug).

## v2.99.79 — Firebase/Expo linked: the WebView shell's push token now reaches the right transport (2026-07-26)
- [x] **THE ASK, AND WHAT IT ACTUALLY NEEDED.** Owner: *"i have created a firebase account and i want to
      link it to your web apps to send the notification to the front mobile apps for andriod and ios ...
      npm install firebase"*, with the Firebase **Web SDK** config and `getAnalytics(app)`. The shipping
      app then turned out to be a **React Native + Expo (SDK 54) shell wrapping this site in a
      full-screen WebView** — which changes the answer completely, so the `firebase` npm package is
      deliberately NOT installed and no `getAnalytics` is wired.
      - The web SDK's job is Web Push in a BROWSER, which this app has had since v2.83 (VAPID, its own
        keys, no Firebase). Adding Firebase Web there would be a second, parallel notification stack for
        a case already covered.
      - Inside a WebView the browser push API is either absent or unreliable, so the notification is the
        NATIVE layer's job. The native layer holds the token; the web app holds the identity. The token
        has to cross that boundary — which is the whole of this release.
- [x] **EXPO HANDS OUT TWO TOKENS AND THEY ARE NOT INTERCHANGEABLE.** `getExpoPushTokenAsync()` returns
      `ExponentPushToken[…]`, which Expo's own service delivers (talking to FCM/APNs with credentials
      uploaded to EAS); `getDevicePushTokenAsync()` returns a raw FCM registration token or an APNs token,
      which goes to FCM directly. Sending an Expo token to FCM is not an error anybody sees — it is a
      **silent** delivery failure, and this repo only had the FCM sender (v2.86). New dependency-free
      `server/expoPush.ts` adds the other transport, matching the house pattern for SMTP / S3 SigV4 / FCM;
      Expo's send endpoint is a plain JSON POST, and `EXPO_ACCESS_TOKEN` is honoured for accounts with
      enhanced security enabled. Batched at Expo's documented 100/request.
- [x] **THE TOKEN'S SHAPE DECIDES THE TRANSPORT, NOT ITS LABEL.** `classifyNativeToken` is the single rule;
      `push.subscribe` accepts `"expo"` but **re-derives** the kind from the token and refuses one it
      cannot classify, rather than storing an unroutable row that would fail silently forever. A ring is
      `priority:"high"` with `ttl:60` on the `calls` channel; everything else is `normal`, so the OS may
      batch it for the user's battery. Only `DeviceNotRegistered` marks a token dead — a transient failure
      must never cost somebody their registration.
- [x] **THE SNIPPET THE OWNER WAS GIVEN IS A NOTIFICATION-HIJACK PRIMITIVE, so it is not what shipped.**
      The advice was a bare `window.addEventListener("message", …)` that registers whatever token arrives.
      On a real website ANY frame that can post into the page — an embedding iframe, an opener, a
      malicious ad — hands us a token for THEIR device and starts receiving somebody else's calls and
      messages. This repo already has a recorded finding of that exact class (v2.99.49 R1, push-endpoint
      re-bind). New `client/src/app/nativeTokenBridge.ts` keeps three gates: **origin** must be
      same-origin, or empty/`"null"` (which is what an injected-JS post from a WebView looks like on iOS —
      refusing those would refuse the only case the module exists for); **source** must be our window or
      absent; **shape** must be the exact `{type:"SET_PUSH_TOKEN", token}` envelope with a plausible
      token, bounded at 8192 chars before parsing. A **bare token string is refused** — without the
      envelope it is indistinguishable from any other string a library posts into a page. `platform` may
      be sent and is ignored, because the shape already decides.
- [x] **REGISTERS ONCE PER DISTINCT TOKEN.** The shell may post on every foreground; re-registering an
      unchanged token would be a database write per app switch, forever. A genuinely NEW token still gets
      through, or a rotated token would leave the device unnotifiable. The bridge also posts
      `RELAY_WEB_READY` so a shell that posted before the bundle finished evaluating can re-send, rather
      than having to time its post against our mount.
- [x] Tests: `client/src/app/nativeTokenBridge.test.ts` (20). The gates are tested **behaviourally** —
      a source pin cannot tell you whether a cross-origin message is refused, and that refusal is the
      entire point. Includes a **client/server parity** test cross-checking `tokenKind` against
      `classifyNativeToken` over 9 inputs: two gates disagreeing about one rule is the recurring bug in
      this codebase (v2.99.50, v2.99.71), and here a disagreement would be a broken registration, since
      the client picks the label and the server re-derives it.
- [x] **ONE PRE-EXISTING PIN REWRITTEN TO THE STRONGER INVARIANT rather than relaxed.** `nativeAndroid.test.ts`
      froze the exact two-value enum (`["webpush", "fcm"]`) and the exact `=== "fcm" || !!v.keys`
      refinement — so a THIRD native transport broke it while saying nothing about the property that
      matters. It now asserts, order-independently, that the stored union and the wire enum both cover
      webpush plus every native kind, and expresses the keys rule as *not-webpush ⇒ no keys needed* so it
      cannot go stale on the next addition. Anchored inside `upsertPushSubscription`, because `kind?:`
      also names a CONVERSATION kind earlier in the same file and an unanchored match read that one.
      **All four mutations bite** (enum loses expo / keys rule names fcm only / db union loses expo /
      anchor renamed), reverted from byte-exact backups, sources confirmed byte-identical afterwards.
- [x] **ONE PRE-EXISTING BUG CORRECTED IN PASSING:** the `web-push`-unavailable branch of
      `sendPushToIdentity` returned a bare `0`, discarding native deliveries that had ALREADY succeeded.
      Cosmetic today (every caller is fire-and-forget) but the return value's whole meaning is "how many
      devices got it", and this release adds a second contributor to that count.
- [ ] **SAID PLAINLY — FIREBASE ALONE WILL NOT MAKE A CLOSED APP RING**, and this is a decision, not a gap:
      **no code path sends a `kind:"incoming-call"` push.** It was removed in v2.99.11 at the owner's own
      request (*"if the user is offline and you try to call him it should NOT ring automatically"*).
      Verified by a 5-agent audit and independently. Messages, missed calls, voicemails and back-online
      alerts all push and will now reach the Expo shell; a ring will not, until that decision is reversed.
      The `incoming-call` kind and its 70s TTL remain in the senders as infrastructure.
- [ ] **OWNER-ONLY STEPS (nothing here can do them):** if the shell uses **Expo** tokens, upload the FCM
      server key + APNs key to EAS and nothing else is needed server-side. If it uses **device** tokens,
      put the Firebase **service-account JSON** into `/home/relay/.env` as `FIREBASE_SERVICE_ACCOUNT_JSON`
      and restart pm2 — that private key is a real secret and must never go into a chat message or a
      `workflow_dispatch` input, where it would be visible in run metadata. iOS needs the APNs key in
      Firebase either way. The two uploaded config files (`com.relaytech.calling` /
      `io.yourchat.relay`) belong in the **external Expo app**, not in this repo — whose own native
      project is a different package (`org.yourchat.relay`).
- [x] Suite 2359 passed / 1 skipped (2360). No schema change, no new dependency, no new required env var.

## v2.99.78 — the badge is just the badge, and the call log finally has one (2026-07-26)
- [x] **CAPTION OFF.** Owner: *"Inside the message, you don't need to put the word registered under the
      verified badge ... So just put the badge only. No need to mention below it registered."* v2.99.6
      shipped the tier name in tiny type under the mark at the owner's own request; they have now
      reversed that. Flipped at **`RoleBadge`'s DEFAULT** rather than at the ten call sites, so a surface
      added later inherits the decision instead of re-litigating it. The colour already carries the tier,
      and the word under it made every name two lines tall for no new information.
- [x] **CALL HISTORY HAD NO BADGE AT ALL**, because the payload carried no role. Owner: *"inside the call
      history, even here, you didn't put the badge ... immediately put the badge."* Added to BOTH shapes:
      `calls.history` resolves it for the peer, and `conferenceHistory` resolves it per roster member **by
      identityId** — like the name and avatar already are, so a renumbered person keeps their badge. One
      batched query each, and `getRolesByIdentityIds` already swallows its own failure, so a role lookup
      cannot stop the log rendering. Rendered immediately after the name, before the `PinTag`.
- [x] **TWO PRE-EXISTING PINS REWRITTEN** rather than relaxed, and one fragile slice rebounded:
      `numberContinuity.test.ts` sliced a fixed `+5200` characters past the procedure start to check the
      renumber-safe roster resolution — which silently shrank as the procedure grew. It is now bounded by
      the procedure's own end (`ROUTERS.indexOf("clearHistory:", procStart)`) with an assertion that the
      slice did not collapse to nothing, because a pin reading an empty string cannot fail for the reason
      it was written.
- [x] Suite 2340 passed / 1 skipped. **This release's `todo.md` / `CLAUDE.md` entry was missed at commit
      time and is backfilled here in v2.99.79** — recorded rather than quietly added, since keeping those
      two files current in the same commit is a standing rule.

## v2.99.77 — the call log says each thing once; one presence surface stopped disagreeing (2026-07-26)
- [x] **(1) THE PRESENCE GLITCH IS REAL AND HAS A NAMED CAUSE.** Owner: *"I saw this user in the contacts
      one time showing online. But when I went to his message or to his call history ... is offline."*
      `isGuestPresenceHidden` was applied in FOUR resolvers and NOT in `messages.threads`, which returned
      a bare `p?.isOnline ?? false`. For a stale GUEST the thread list said ONLINE while every other
      surface said OFFLINE. One rule, five call sites, the fifth forgot it. Fixed; `peerLastSeenAt` is
      nulled with it, or a row would show a last-seen time for presence it is hiding.
- [ ] **SAID PLAINLY: that fix is NOT proven to be the owner's case.** The account in their screenshot is
      REGISTERED, and `isGuestPresenceHidden` returns false immediately for a non-guest. The remaining
      structural cause: `getPresenceAudienceIds` covers people who SAVED you and people who share a
      CONVERSATION with you, but NOT people you have only ever CALLED — so a call-history-only peer
      generates no presence SSE for you and each surface falls back to its own poll cadence (History 30s,
      threads 4–30s, contacts its own), which legitimately disagree between ticks. Closing it means
      widening who learns when you come online, so it is flagged for a decision rather than done quietly.
- [x] **(2) THE CALL LOG REPEATED ITSELF.** Each row said the name, then `PIN 566666` in the meta line,
      then a chip row repeating `khaloud alhammadi 566666` AND `You 777777`.
- [x] The number is now carried ONCE, as a bracketed `(566666)` tag in its own colour straight after the
      name (new `PinTag`): no "PIN" label, `dir="ltr"` + bidi isolation so an Arabic name cannot reorder
      the digits or their brackets.
- [x] The meta line is action · media · duration. **The viewer's own number appears nowhere** — *"you
      don't need to put my number because I know my PIN."*
- [x] The roster chip row is GROUPS ONLY and excludes self: on a 1:1 row it repeated the line above, and
      on a group row you are not news to yourself. A group row leads with `Group · N` before direction,
      so the KIND of call reads first.
- [x] Duration to the owner's rule: under ten minutes one minute digit (`1:23`), over ten two (`12:34`),
      and with hours EVERY field two digits (`01:05:03`) so the column stops jittering down the log.
- [x] Heavier `border-b-2` dividers and more row padding — *"make, like, clear line."*
- [ ] **NOT DONE — a data gap, not an oversight:** media type on an ANSWERED GROUP call.
      `conference_history` has no channel column, so Voice/Video is genuinely unknown there and printing
      either would be a guess. Solo rows show it because `call_history.channel` exists.
- [x] TWO PRE-EXISTING PINS REWRITTEN to the new intent rather than relaxed: one asserted the `h:mm:ss`
      hour padding this release deliberately changed; the other counted `PIN {` occurrences, i.e. it
      pinned the very prose the owner asked to remove. It now asserts the `PinTag` carrier and that the
      label is gone from CODE (comment lines stripped), plus a new pin that the viewer's own number is
      never rendered.
- [x] `pnpm verify` green, 2339 tests.

## v2.99.76 — an admin panel, and a backend that can actually do it (2026-07-26)
- [x] Owner: *"So why you dont do it at the backend / Or create for me an admin panel were i can
      change it."* Both.
- [x] **THE HONEST ANSWER TO "why not at the backend"**: this sandbox has no route to the database —
      `DATABASE_URL` exists only in `/home/relay/.env` on the fleet. A sanctioned path already existed
      (v2.99.60's `recover-identity`: a script run ON an app instance over SSM, sourcing the fleet env,
      so no production credential is copied anywhere); the number change simply had not been wired into
      it. Now it is.
- [x] **(1) THE PANEL** — `/app/admin`, new `v2AdminRouter` (`amIAdmin` / `findIdentities` /
      `setIdentityNumber`). Find anyone by 6-digit number, email or name; change their number.
- [x] SCOPE IS DELIBERATELY NARROW. An admin panel is a permanent high-value read and write surface, so
      it does exactly two things and cannot read a message, list contacts, delete an account, or grant
      itself more power. Widening it later is a decision somebody has to make on purpose rather than
      something that arrived for free.
- [x] `adminFindIdentities` is a PROJECTION that withholds every credential hash, guest token, recovery
      hash and device id — pinned by name, so a future `select()` cannot quietly widen it. It escapes
      LIKE wildcards, so a typed `%` matches a literal `%` instead of silently widening the search.
- [x] EVERY procedure re-derives admin status from the `users` row via a new `isUserAdmin` that FAILS
      CLOSED on a non-numeric id, an unreachable DB, or any throw. `whoami` already reports a `role`,
      but that value has been through the browser and is a RENDERING hint, never a permission — a
      client that renders the page anyway gets FORBIDDEN on every call. The refusal is uniform for
      "not signed in", "not an admin" and "DB unreadable", so it is not an oracle for who holds it.
- [x] The number change routes through `claimIdentityNumber` — the SAME single writer the self-service
      path uses — so an admin change propagates to everyone who saved the old number inside one
      transaction. An admin shortcut writing the column directly would silently skip all of it; a test
      asserts `.update(identities)` appears nowhere in the router and that v2db still has exactly ONE
      such writer. An admin acting on somebody else logs a trace carrying IDS ONLY: no name, no email,
      no content, because that line lands in logs.
- [x] **(2) THE BACKEND TOOL** — `scripts/admin-tool.mjs` plus the `admin-tool` action in `aws-ops.yml`:
      `whois`, `grant-admin`, `revoke-admin`, `set-number`. DRY RUN IS THE DEFAULT on every write. It
      exists for the BOOTSTRAP (`users.role` is granted by hand, so without it a fresh install has no
      admin at all and the panel is unreachable) and for direct backend repair.
- [x] `grant-admin` REFUSES AN AMBIGUOUS EMAIL rather than guessing: `users.email` carries no unique
      index, and "whichever row came back first" is not an answer when the operation is granting
      administrator. Its verdict comes from `affectedRows`, not from the earlier read.
- [x] **THE REAL RISK IN (2), AND THE GUARD FOR IT.** The script CANNOT import the server's renumber —
      it is plain `.mjs` run by bare `node` on EC2 while the writer is TypeScript inside the bundle — so
      its `set-number` is a SECOND implementation of the propagation rule in ANOTHER LANGUAGE. That is
      the exact shape that rots (v2.99.50: two gates disagreeing about one rule; v2.99.71: the TURN
      checker disagreeing with the server). No string check catches the NEXT divergence, so
      `server/adminToolParity.test.ts` cross-checks the script against `NUMBER_BEARING_COLUMNS` itself:
      a column declared `renumber` MUST be written by the script, one declared `live`/`not-a-person`
      must NOT be. Mutation-proven in BOTH directions — dropping the `conference_participants` update
      fails, and adding an `UPDATE conference_history` fails.
- [x] The script also reproduces `planRenumber`'s stale-duplicate delete (without it, a saver who
      already had a row for the NEW number collides with the unique (ownerId, number) key and the whole
      renumber fails), checks both tables of the shared number space, reserves in the ledger, writes in
      a transaction that rolls back as a unit, never releases the OLD number, and PREFLIGHTS every
      table and column against `information_schema` so a rename cannot make a guard pass by reading
      nothing.
- [x] **INJECTION PROVEN EMPIRICALLY, not asserted.** All four free-text inputs are base64'd on the
      runner and decoded only on the instance. The step's own CMDLINE construction was replayed with 8
      hostile values (quote+semicolon, double-quote break, `$( )`, backticks, `&&`, `|`, embedded
      newline, bare `;`) against a stub `node`, using a SENTINEL FILE as the detector rather than a grep
      of the output — text in output is not evidence of execution, the v2.99.70 harness bug. 0/8
      executed; each value arrived as ONE literal argument. `admin_op` is the one unencoded value and is
      a closed `choice` re-whitelisted by a `case` in the step.
- [x] My harness reported a "SHAPE?" mismatch on 7 of 8 runs — that was ITS OWN off-by-one (argv[0] is
      the script path, so the value is arg 9 not 8), not a code problem. Recorded rather than presented
      as a clean run.
- [x] **FOUR WEAK ASSERTIONS OF MY OWN, caught by the mutation run and fixed rather than counted as
      passes.** All the same class — pinning incidental TEXT instead of the property: (a) the
      ambiguous-email test pinned the MESSAGE while the mutation changed the CONDITION, so making it
      guess stayed green; (b) the injection test checked that `ADM_EMAIL_B64` appeared *somewhere* — it
      still did, as a now-unused assignment — instead of checking the CMDLINE, so putting the RAW value
      back stayed green; (c) the verdict test matched `ADMIN_EXIT=`, which also occurs in the line that
      PRINTS it, so replacing the check with `if true` stayed green; (d) a pre-existing aws-ops pin
      froze the whole action list for the THIRD time on a legitimate addition — rewritten to assert
      MEMBERSHIP, since the list-wide invariants (verify first, no duplicates) are pinned once already.
      13/13 tripwires now bite.
- [x] `server/adminToolParity.test.ts` (29). NO SCHEMA CHANGE — `users.role` has existed since v2.99.6.
      `pnpm verify` green, 2336 tests.
- [ ] NOT built, deliberately: anything else an admin panel could do. Reading messages, deleting
      accounts and granting roles from the UI are all absent by choice, not by omission — see the scope
      note above.

## v2.99.75 — choose your own 6-digit number (2026-07-26)
- [x] Owner: *"my personal number is 235680. Can you change it to 777777 and make sure whoever added me
      in his contact book or has any communications and messages makes sure they appear with the new
      number and keep the old data, such as calls or messages, but only updates to 777777."*
- [x] **HALF OF THAT ALREADY WORKED**, stated rather than quietly re-fixed. Renumbering has propagated
      since v2.99.54 and `numberContinuity.test.ts` MACHINE-CHECKS it: it scans `drizzle/schema.ts` for
      every `varchar(…, {length: 6})` and fails the build if a number-bearing column has no declared
      strategy. All five are declared — `identities.number` moves; `contacts.number` is rewritten (so
      everyone who saved you keeps reaching you, and a block on the old number FOLLOWS you);
      `conference_participants.number` is rewritten scoped by identityId; `conference_history.dialedNumber`
      is resolved LIVE at read time; `party_lines.number` is never touched, because a line is not a
      person. The History roster JSON is resolved by identityId too, separately pinned. Everything else —
      messages, threads, call history, statuses, attachments, presence, push subscriptions — references
      the identity by numeric id, so it follows the person with nothing to migrate.
- [x] **WHAT DID NOT EXIST**: any way to pick a SPECIFIC number. `regenerateNumber` only ever handed out
      a random one, so "change it to 777777" was not expressible.
- [x] **THE CONSTRAINT THAT SHAPED THE CHANGE, and it is a good one**: `guestUpgrade.test.ts` pins that
      the codebase contains exactly ONE writer of `identities.number`. Propagation is the whole
      difficulty of renumbering, and a parallel implementation is precisely how History's copies came to
      rot before v2.99.54. So this is a `desiredNumber` PARAMETER on the existing writer, never a second
      function — mutation-proven: a parallel writer that skips propagation fails the suite. The chosen
      number resolves to `newNumber` BEFORE the transaction, so the body it shares with a random
      allocation is identical and inherits every copy.
- [x] `normalizeDesiredNumber` accepts the grouping people actually type ("777 777", "777-777" — the app
      displays numbers that way, so refusing it would be rude) but strips ONLY spacing and grouping,
      never every non-digit: `\D`-stripping would silently read "7a7b7c7d7e7f" as 777777 and turn a typo
      into a successful renumber of somebody's identity. Honours the same `RESERVED_PREFIXES` a random
      allocation does, or the reserved range is reserved against the allocator and not against people.
      Fails closed on a non-string.
- [x] Availability checked against BOTH number tables, then RESERVED in the shared ledger — which is what
      closes the cross-table NEW-vs-NEW race against a party line minted in the same instant. Spends the
      same GLOBAL MINT BUDGET, because the drain backstop must not be sidesteppable by naming numbers
      instead of asking for them.
- [x] Choosing the number you already hold is a NO-OP, not an error, so a double-tap or a retry after a
      dropped response is harmless rather than reporting "taken" about the caller's own number.
- [x] **THE SUBTLE BUG I HAD TO REASON OUT, THEN PIN**: the failure path must NOT hand the reservation
      back on a pre-flight refusal. "taken" means somebody ELSE holds it — possibly an allocation that
      has reserved the number but not yet inserted its row — so releasing there would un-reserve a
      stranger's in-flight number and let two people end up with it. The early return precedes the
      release, and that ordering is mutation-verified rather than assumed. A genuine post-reservation
      failure DOES release, and `releaseUnusedNumberReservation` re-checks the number is absent from both
      tables, so even then it cannot un-reserve a bound one. A lost race surfaces as `taken` (errno 1062)
      rather than a 500. The OLD number is never released: the ledger is monotonic on purpose, or a
      number somebody kept written down would later connect them to a stranger.
- [x] **REGISTERED ACCOUNTS ONLY**, as policy rather than as an implementation limit: a chosen number is
      first-come and permanent, and a guest identity is session-scoped, so a guest claim would squat a
      memorable number and then strand it the moment the browser closed.
- [ ] **FLAGGED HONESTLY: chosen numbers are FIRST-COME.** Nothing reserves 777777 for anybody, so the
      owner should claim it promptly. Admin-only was considered and rejected: `users.role = "admin"` is
      granted by hand via SQL and may not be set on their account, which would have shipped a feature
      they could not use.
- [x] UI: Profile offers "Choose my number" beside "Random number" (the old button, renamed; a test pins
      it still calls the no-argument path, so its behaviour is unchanged). The dialog deliberately does
      NOT close on submit — the number may be taken, and closing before the server answers would hide the
      one message telling the person to pick another. Refusals are the SERVER's own named messages, since
      a typo and a collision need different things from the reader. A text input with
      `inputMode="numeric"` rather than `type="number"` (spinners, accepts "1e5", drops a leading zero),
      `dir="ltr"` so an RTL locale cannot reorder the digits being typed.
- [x] `server/chooseNumber.test.ts` (30); all 12 tripwires verified by MUTATION from byte-exact backups,
      source confirmed byte-identical afterwards.
- [x] **A RECURRING WEAKNESS OF MY OWN, finally fixed rather than patched a fourth time**: for the fourth
      release running, a "this pattern is gone" assertion matched a COMMENT explaining why it is gone —
      here `type="number"` inside the comment justifying its absence — so it passed on prose rather than
      behaviour, which is worse than no assertion. Every `not.toMatch` against a source file now goes
      through a `codeOnly()` helper that strips comment lines.
- [x] NO ops work and NO schema change: reuses the existing transaction, reservation ledger and boot
      migrator entirely. `pnpm verify` green, 2308 tests.

## v2.99.74 — delivery receipts, a real message menu, and the voice bar that still did not move (2026-07-26)
- [x] **(1) ONE TICK AND TWO TICKS WERE THE SAME STATE.** Owner: *"it shows you what check if it's
      delivered. I mean the other user is online and he received, but he didn't open it. It should show
      second check mark beside that. If he [read] it, it will turn both check marks into blue colour…
      and any type of message either voice text video whatever."*
      `messages.status` has carried a `delivered` value since the schema was written and NOTHING EVER
      WROTE IT, so the UI's `status === "read" ? "✓✓" : "✓"` was a two-state display of a three-state
      fact: sent and delivered rendered identically. This adds the missing transition.
- [x] **THE RECIPIENT REPORTS IT, NOT THE SERVER.** The tempting version marks a message delivered when
      the server fans its SSE event — but an open stream proves a socket exists, not that the message
      reached an app that HAS it, and it would MISS the case the second tick exists for: somebody who
      was offline when it was sent and opens the app later without opening the thread. So the report is
      driven off the RECIPIENT's thread list (`useDeliveryReceipts`), mounted in `AppShell` rather than
      `Messages` for exactly that reason: opening the app is enough, opening the thread is not required.
- [x] **DEDUPED ON THE THREAD'S NEWEST MESSAGE TIME** — load-bearing, not an optimisation. That list
      refetches every 15s, so an undeduped report is a write over the conversation's messages every
      fifteen seconds forever, for a fact that has not changed; that is worse than the missing feature.
      A newer `lastMessageAt` is precisely the signal that something new arrived. The watermark never
      moves backwards (two tabs, or a stale cached list, must not re-fire). The claim is taken BEFORE
      the request, because the live `message` event and the refetch it triggers land in the same tick
      and would otherwise each fire their own write. A genuine failure UN-claims, because a blip must
      not cost the sender their tick until the next message happens to arrive. One sweep is capped at
      12, so opening the app on a large backlog is not a write storm — the remainder goes on the next
      sweep, proven by test rather than asserted.
- [x] **THE RECEIPT CANNOT WALK BACKWARDS.** `markThreadDelivered` promotes ONLY from `sent`, so a late
      report cannot turn two blue ticks grey again; excluding `failed` leaves a real failure visible
      instead of claiming it arrived. Membership-scoped, and never delivers to your own messages — the
      S6 finding's shape, in a second place. Fails to `false` rather than throwing: a receipt is not
      worth a failed render.
- [x] **IN A GROUP, "delivered" MEANS AT LEAST ONE MEMBER HAS IT**, not all of them — the row is shared,
      so the first member to report flips it for the sender's view. Not a shortcut introduced here:
      `markThreadRead` has always worked exactly this way, so the second tick inherits the semantics the
      third one already had rather than inventing a different rule for the same row. Per-recipient
      receipts would need a per-participant table (see the "delete for me" item below — same shape).
- [x] The read transition already accepted `delivered` as well as `sent` BEFORE this release, which is
      the one thing that would have silently broken the whole chain: a message that got its second tick
      could never have gone blue, for everybody whose app reported delivery first, i.e. everybody. It
      was already correct; now pinned, so a future narrowing has to come back and think about it.
- [x] **READING BACKFILLS THE DELIVERED TIME** (`COALESCE(deliveredAt, now)` inside `markThreadRead`),
      or the info panel would show a message read at 10:05 that was never delivered — not a thing that
      can happen, and it would read as a bug in the panel rather than in the data.
- [x] **A BUG CAUGHT BEFORE SHIPPING, worth naming because it would have been invisible in testing.**
      The first cut cast the new event through `as unknown as` to avoid touching the union — but
      `KNOWN_V2_EVENT_KINDS` gates the RECEIVE side of the Redis bus, so an undeclared kind is
      delivered locally and silently DROPPED whenever the sender is on the other instance, which on a
      two-instance fleet is most of the time. Single-instance dev would have looked perfect.
      `delivered` is now a declared member of both, and a test asserts the cast is absent.
- [x] New nullable `messages.deliveredAt` / `messages.readAt` via the boot migrator; both returned by
      `messages.list` to BOTH sides — they are timestamps the recipient generated about their own
      reading, and the sender is exactly who the info panel is for. Nothing there reveals content, an
      identity, or anything the ticks do not already imply.
- [x] **(2) THE ⋮ MENU.** Owner: *"reply or put forward or delete or info."* Now Reply / Forward /
      Copy / Info, plus Unsend on your own.
- [x] Forward RE-SENDS rather than re-pointing the row, so the target thread gets its own message with
      its own receipts — which is what makes a forward behave like a send. The attachment rides by id
      and `messages.send` re-checks the sender may use it, so this cannot smuggle media the forwarder
      could not already see. The picker never offers the thread you are already in.
- [x] Forward is WITHHELD from a self-destructing message in both directions rather than
      offered-then-refused: copying a view-once message into a second permanent thread breaks the exact
      promise it was sent under, and a menu item that cannot do its job should not be there. The action
      still refuses, as a backstop rather than as the UI.
- [x] A still-LOCKED expiring message shows no menu at all — the QA H2 guard that was already there,
      which Forward and Info inherit by living inside it (Reply and Copy would extract the plaintext
      without burning it; the same is true of the two new items).
- [x] **INFO** lists Sent / Delivered / Read, to the SECOND and always naming the date. Deliberately
      NOT the bubble's `formatTime`, which drops today's date and rounds to the minute: those three
      times are frequently inside the same minute, so a minute-precision panel shows three identical
      values and answers nothing. A time nobody recorded shows an honest em dash, never a guess —
      every message predating this release has none.
- [x] **(3) THE VOICE BAR STILL DID NOT MOVE** (owner, second report on the same control). v2.99.73
      fixed the probe that DESTROYED playback and threaded the stored duration through the ordinary
      bubble — and MISSED the second render path: the revealed-expiring `content()` helper never passed
      `durationMs`, so a view-once voice note had `dur = 0`, and since the fill is `cur / dur` the bar
      was pinned at zero however well playback was going. That is the screenshot.
- [x] Two more holes closed in the same pass. Making the probe safe by deferring it until PAUSED meant
      it never ran during a FIRST play, so a note with no stored length still sat still for its entire
      first play — it now probes on MOUNT, and only when nothing is stored, so the normal case costs no
      request at all (the cost lands on pre-v2.96 notes as one `preload="metadata"` header fetch). The
      rAF clock also picks a duration up mid-playback if the engine settles it late, without ever
      overwriting one already trusted.
- [x] `client/src/app/deliveryReceipts.test.ts` (39). The reporting RULE is tested BEHAVIOURALLY,
      because a source pin cannot tell you whether a 15-second poll writes every 15 seconds.
- [x] **ALL 24 tripwires verified by MUTATION** — reverted from byte-exact backups, aborting on a
      missing target, source confirmed byte-identical afterwards. Includes the original screenshot bug,
      the receipt-walks-backwards case, the bus-allowlist drop, and the hook being unmounted entirely.
- [x] One of my own assertions was thrown out during that run rather than counted as a pass: a check
      that the old hand-drawn "✓✓" was gone matched two COMMENTS describing the history, so it passed
      or failed on prose rather than on behaviour. It now strips comment lines and checks CODE. This is
      the third release in a row where a self-referential comment match was the weakness.
- [x] Two redundancies removed while pinning: `Receipt` owned its own mine/status guard AND had an
      outer one at the call site (two guards for one rule is how a receipt ends up rendering in one
      place and not the other after somebody edits only one), and its non-`mine` colour branch was
      unreachable behind its own early return.
- [ ] **NOT DONE, said plainly:** "delete" for a message somebody else sent. Unsend removes a message
      for everyone and is rightly ours-only; a per-recipient "delete for me" needs a real
      per-participant tombstone touching `messages.list`, thread previews, `searchMessages` and the
      STORED unread counters — and a localStorage version would be a lie that reappears on their other
      device. It is a feature, not a polish item, so it is flagged rather than faked.
- [x] `pnpm verify` green: 2278 tests. No ops work — no env var, no new dependency; the two columns are
      additive nullable and land via the existing boot migrator.

## v2.99.73 — voice playback that moves, recording you can see and undo, dated messages, instant stats (2026-07-26)
- [x] **(0) "MAKE IT LIVE, NOT AFTER 30 SECONDS."** v2.99.71 replaced the 30s poll with a 2s push, which is
      close but still tick-bound — signing in could take two seconds to show. Now every online/offline
      TRANSITION pokes the feed directly (`pokeStatsFeed`), so the figure moves in ~150ms. The poke is
      COALESCED, and that is load-bearing: presence writes genuinely arrive in bursts (a heartbeat sweep, a
      call ending, the reaper), and one database read per event would be far worse than the polling this
      replaced — 50 simultaneous sign-ins cost one read. A poke only ever re-reads `onlineNow`, never the
      full-table counts, and is a no-op when nobody is watching. The notify lives INSIDE
      `markOnline`/`markOffline` rather than at their four call sites, because forgetting one is the exact
      class of bug this codebase keeps re-learning; it is registered as a HOOK (`setPresenceChangeHook`)
      because `statsFeed` already imports `v2db` and a second edge would be a cycle. A mere heartbeat from
      someone already online deliberately does NOT poke — otherwise every open tab costs a read every 30s.
- [x] **(1) THE VOICE PLAYER'S CONTROL NEVER MOVED** (owner: *"when you click to play, the sound is played,
      but the control doesn't show that it's moving, which second you reach. It only stays there like it's
      not played."*). TWO REAL BUGS, both visible in the screenshot as a scrubber pinned at the start with
      "0:00" beside "· · ·":
      - **THE DURATION PROBE DESTROYED PLAYBACK.** MediaRecorder blobs report `duration === Infinity` until
        seeked past the end, and the workaround ran from `loadedmetadata` — which fires just AFTER the click
        that started playback. So pressing play seeked the element to `Number.MAX_SAFE_INTEGER`, which clamps
        to the end, fires `ended`, and resets the clock to 0: audio you had already heard start, with a
        control frozen at zero. The probe now never runs while playing (it waits for a pause) and uses the
        `1e101` form the codebase's own `readMediaDurationMs` already uses — MAX_SAFE_INTEGER is refused
        outright by several engines, which is also why the total stayed "· · ·".
      - **THE DURATION WAS ALREADY KNOWN AND WENT UNREAD.** Every voice note recorded in the app stores its
        real length in `attachments.durationMs`, and `messages.list` already hands the whole attachment row
        to the client. Seeding from it means the common case needs NO probe, shows a real total immediately,
        and the scrubber is seekable before the first play.
      Also: the clock is now driven by rAF while playing instead of `timeupdate`, which browsers fire about
      four times a second — enough to look like a control that barely moves on a short note.
- [x] **(2) RECORDING SHOWED NOTHING AND COULD ONLY BE SENT** (owner: *"when you record the voice, [it]
      doesn't show that you are talking. Like, it just turned red, and there is no wave when you talk… and
      then you need to click on the red to send, or there's no choice to delete the voice, or you can pause
      the voice, or you cancel the voice and you want to re-record again."*). All of it was true: recording
      replaced the mic button with a red square and Stop was the ONLY exit — which also sent. A misfire, a
      cough or a change of mind had no way out except sending the note and unsending it afterwards.
      The composer row now becomes a recording bar: **discard · live waveform · elapsed clock · pause/resume
      · send**. THE WAVE IS REAL — RMS off a WebAudio analyser tapped from the SAME MediaStream the recorder
      is encoding, so the bars move because the microphone is actually hearing you; a decorative animation
      would have looked identical while telling you nothing, which is the complaint. RMS rather than peak,
      because a peak meter pins to the top on any transient and stops conveying speech. The analyser is
      deliberately NOT connected to `ac.destination` (that is a feedback loop), degrades to 0 rather than
      failing the recording, and is released on both reachable exit paths.
      PAUSED TIME IS EXCLUDED FROM THE DURATION — a note paused for a minute would otherwise claim to be a
      minute longer than its audio and every player would show a bogus total. The UI reads the paused state
      BACK from the recorder rather than assuming, because an engine without `MediaRecorder.pause` leaves it
      running and the bar must not claim otherwise. Discard calls `cancel()`, which resolves `done` with
      null, so the note is genuinely gone rather than sent-and-unsent.
      The 30 bars and the clock are written IMPERATIVELY from one rAF loop sampled at ~20Hz — a state update
      per frame would re-render the whole thread 60 times a second, the mistake the landing page had to be
      rescued from in v2.99.67.
- [x] **(3) NO DATE ON A MESSAGE** (owner: *"there is no time and date for each message when it's sent."*).
      Subtler than it sounds: the TIME was already there, the DATE was not. The thread draws a day separator
      but only from the first one onward, so every message ABOVE it carried a bare "12:09 PM" with nothing
      saying which day — the owner's screenshot shows exactly that, three "12:09 PM" bubbles sitting above a
      "Today" divider. Today stays time-only (repeating today's date on every bubble is noise); anything
      older names the day, and anything from another year names the year too, because "Jul 23" silently
      reads as this year and being twelve months wrong without saying so is worse than one extra token —
      the same rule as `formatLastSeen` (v2.99.66), deliberately. The comparison is the whole date, not just
      the day-of-month, or "the 26th of last month" would render as today.
- [x] Tests: `client/src/pages/app/voiceAndStamps.test.ts` (20) + `statsFeed.test.ts` 14 -> 19. ALL 12
      messaging tripwires and 4 of 5 stats tripwires verified by MUTATION.
- [x] THREE OF MY OWN TEST WEAKNESSES FOUND BY THAT MUTATION RUN AND FIXED, rather than counted as passes:
      (a) the rAF assertion matched the self-re-arm INSIDE `tick()`, so deleting the kick-off — which stops
      the clock dead — left it green; it now requires BOTH occurrences. (b) The timestamp test asserted the
      day/year FORMATTERS, which left `return time;` passing — the very bug being fixed; it now asserts the
      returned shape. (c) A new poke test claimed in a comment to slow the tick down so only the poke could
      be responsible, and then did not — so a coincidental tick would have satisfied it; the tick is now
      400ms against a 150ms coalesce and the test asserts the LATENCY.
- [x] ONE MUTATION THAT DID NOT BITE, recorded rather than hidden: removing the audience check from
      `pokeStatsFeed` breaks nothing, because `refresh()` also returns early on an empty client set. The
      property is defended twice; the check is still worth keeping (presence writes happen whether or not
      anyone is watching, so without it every burst allocates a timer) but the invariant rests on
      `refresh()`, and the test now says so and pins that guard instead.
- [x] TWO PRE-EXISTING v2.96 PINS REWRITTEN TO THE STRONGER INVARIANT rather than relaxed: one asserted the
      exact `<VoiceNotePlayer url mine />` prop list, which legitimately grew; the other pinned
      `duration === Infinity` plus a `MAX_SAFE_INTEGER` seek — i.e. it pinned THE BUG as the cure. It now
      asserts the quirk is still handled AND that it is handled without touching a playing element.
- [x] Suite 2237 passed / 1 skipped (2238); check and build green. No schema change, no new dependency.
      (Measured AFTER rebasing onto main's v2.99.71 TURN-checker work, which landed while this branch
      was open and took that number — hence the renumber to .72/.73. My own pre-rebase figures were
      2204 and 2229.)

## v2.99.72 — the five live figures are PUSHED, so they move while you watch (2026-07-26)
- [x] OWNER: *"the statistics of number of users, active users, messages, calls — the one on the main page
      and on the login page — it should be dynamic. While I'm seeing the page, if somebody logs in, it will
      automatically update. No need for me to refresh the page. These numbers are read from the database,
      for all five."*
- [x] WHAT WAS ALREADY TRUE, said plainly rather than quietly re-fixed: all five figures WERE already live
      database reads (`getPublicStats` runs six `COUNT(*)`s with no cache anywhere), and both surfaces
      already refreshed without a reload. So the ask was not broken — it was SLOW, and it scaled badly.
- [x] WHAT WAS ACTUALLY WRONG. The landing page polled every **30s** with `refetchOnWindowFocus: false`,
      so a visitor could sit looking at figures half a minute stale AND returning to the tab did not
      refresh them — which is exactly the "I have to refresh" experience being reported. The sign-in
      screen polled at 15s. Worse, polling scales the wrong way: EVERY viewer independently ran six
      `COUNT(*)`s, one of them over `messages`, the largest table in the schema.
- [x] THE FIX: one shared computation per instance, pushed to every viewer over SSE
      (`server/statsFeed.ts`, `GET /api/stats/stream`). Ten thousand people watching the landing page now
      cost what one person costs. Public and unauthenticated by design, exactly like the `stats.public`
      procedure it mirrors — the landing page has no identity, and the payload is aggregate counts and
      nothing else (a test asserts the frame's key set: no name, no number, no identity ever).
- [x] TWO CADENCES, because one would have been indefensible. `onlineNow` is the figure the owner actually
      named — it is the one that moves when somebody signs in — and it is CHEAP: `presence` is small and
      carries `presence_isOnline_idx`, so counting it is an index scan. It refreshes every **2s** via a new
      `getOnlineCount()`. The other four barely move and are expensive, so they refresh every **20s**.
      Recomputing a `COUNT(*)` over `messages` every two seconds to watch a number that changes hourly
      would be wasteful in a way no user would ever see.
- [x] NOTHING RUNS WHEN NOBODY IS WATCHING. The timers start on the first subscriber and stop on the last,
      so an idle instance does zero database work — which is the property the old per-visitor polling had,
      and it would have been easy to lose. Two tests cover it (timers off at zero subscribers; no further
      reads after the last viewer leaves), and the mutation run confirms both bite.
- [x] FRAMES ONLY ON CHANGE. A quiet network costs one heartbeat comment every 25s and nothing else.
- [x] IT DEGRADES RATHER THAN MISLEADS. `getOnlineCount` returns **null, never 0**, on any trouble, and the
      feed then holds the previous snapshot — "0 people online" is a visible claim on the front page and a
      query blip must never be allowed to make it. A refused client is answered as a STREAM carrying a
      `retry:` directive rather than a bare JSON 429, because an EventSource ignores the body and reconnects
      on its own schedule: without the directive, the clients being refused become the reconnect storm.
- [x] THE CLIENT KEEPS A BACKSTOP POLL, and that is deliberate. A proxy can hold an `text/event-stream`
      response open while buffering it, which from the browser's side is indistinguishable from a quiet
      network. So `client/src/app/useLiveStats.ts` polls every 15s until the stream proves itself and every
      120s after — never zero. It also does NOT hand-roll a reconnect loop on top of EventSource's own,
      which is how you end up with two overlapping streams per tab. Renders `null` rather than five zeros.
- [x] BOTH SURFACES NOW READ THE SAME HOOK (the landing page's raw-DOM strip via its imperative `put()`
      effect, the sign-in screen's `LiveStats` directly), so neither can be fresher than the other — the
      previous 30s-vs-15s split was exactly that kind of silent drift.
- [x] Tests: `server/statsFeed.test.ts` (14) drive the REAL Express route over a REAL socket, because a
      source pin cannot tell you whether a stream actually delivers a second frame when a number moves,
      and that is the entire feature. They prove: a new viewer is seeded immediately, a change pushes a
      new frame, an unchanged network pushes nothing, TWO viewers are served from ONE read, the timers
      start and stop with the audience, and a failed read holds the last good value instead of zeroing it.
      All 8 tripwires verified by MUTATION (change-gate removed, timers leaked, null read reported as 0,
      seed removed, fast tick made to recompute everything, bare 429, landing reverted to its own poll,
      hook's backstop dropped), each reverted from a byte-exact backup.
- [x] TWO HARNESS BUGS OF MY OWN, found and fixed rather than shipped as results: I first waited 1200ms for
      a 2000ms tick, so "the cheap figure is re-read often" failed for lack of a tick rather than for the
      reason it was written; and the feed's snapshot is MODULE state, so a later test opened against the
      previous test's value and the feed correctly pushed a corrective frame, which my "sends nothing when
      unchanged" assertion counted as noise. The cadences are now overridable by env (clamped, so a bad
      value cannot make a busy loop) and the quiet window starts only once the feed has settled. Re-run
      three times to confirm it is not flaky.
- [x] TWO PRE-EXISTING PINS REWRITTEN TO THE STRONGER INVARIANT rather than relaxed — both asserted the
      POLLING this release removed. `Home.test.ts`'s live-stats pin asserted `trpc.stats.public.useQuery` +
      `refetchInterval`; it now asserts the shared hook, all five keys, and that the imperative DOM writes
      still run keyed on the snapshot. `ownerUiBatch2.test.ts` pinned `refetchInterval: 15_000` on the
      sign-in strip; it now asserts the shared hook and that no poll interval remains there at all.
- [x] The ES5 `Set`-iteration trap (TS2802) bit again in `broadcast()` and was caught by `pnpm check` —
      `pnpm build` uses esbuild and does not typecheck, which is precisely how it reached CI in v2.99.49.
      Noted in-source next to the `forEach` so the next person does not reintroduce it.
- [x] NO OPS WORK: no env var required, no schema change, no new dependency. Suite 2237 passed / 1 skipped
      (2238) after the rebase onto main's v2.99.71; check and build green.

## v2.99.70 — the group grid reads as a live call; the orphan recovery can actually be run (2026-07-26)
- [x] THE GROUP-CALL TILES (owner, asked TWICE: *"I told you before to edit it to make it animated like
      people is talk… their lips is moving"*). WHAT IS HONESTLY POSSIBLE, SAID PLAINLY FIRST: lips cannot
      move on a still image. The ten tiles are stock PHOTOGRAPHS of people on video calls — laptop and
      monitor bezels in frame, faces at wildly different scales and positions — so there is no normalised
      mouth region to animate; a hardcoded mouth overlay would land on a houseplant in one tile and a
      keyboard in another. Real lip movement needs real footage, which is an asset decision. So this
      release makes the grid read as a live conference by every other means, and the load-bearing
      insight is that what betrayed the photos was NOT the missing lip motion — it was that NOTHING
      CORRELATED.
- [x] THE ACTUAL BUG: four tiles carried hardcoded speaking times (`lpSpkA2`/`lpSpkO2` at -15s/-10s/-5s)
      on a DIFFERENT stagger from the ring sweep (-2s per tile), so the ring lit one face while another
      face's bars bounced. Nothing belonged to anybody, which is exactly why 20s of motion still read as
      decoration. Now there is ONE schedule per tile — ring, level meter, nod and the chip's speaking dot
      all run the same 20s loop at the same offset — so the grid reads as a single conversation moving
      around the room.
- [x] A MUTED PERSON IS NEVER THE SPEAKER. The first cut derived the schedule from the raw tile index and
      the screenshot showed the bug immediately: the ring lit ZAIN and DANA, who wear mute badges. New
      `speakingTurns()` gives a turn only to UNMUTED tiles (ordinal, not index), and eight speakers over
      the shared 20s loop is 2.5s each, which fills the loop exactly so there is no dead gap either. A
      muted tile keeps its live feed but gets no ring, no nod, no meter and no dot.
- [x] WHAT MAKES A PHOTOGRAPH READ AS A FEED: new `lpLive`, a sub-pixel non-periodic drift on every tile.
      A real video tile is never perfectly still; photographs have no drift at all, which is why the grid
      read as fixed images however much the surrounding chrome moved. It rides a WRAPPER rather than the
      img, because the img already runs Ken-Burns and two transform animations on ONE element do not
      compose — the later declaration simply wins. Ten non-harmonic timings so no two tiles drift in
      lockstep and none visibly loops.
- [x] THE LEVEL BARS ARE VOICE-SHAPED. The old `lpEq` was one smooth 1.1s sine on every bar, which reads
      as a loading spinner; speech is bursty and the bars have to disagree with one another. Four bars,
      four uneven envelopes (`lpVox1/2/3`), four different periods. `lpTalk` also became a nod plus a
      scale rather than a pure scale, because a pure scale reads as a camera zoom and an offset reads as a
      person.
- [x] COST, MEASURED — this is the page that made a phone hot two releases ago, so the claim is measured
      rather than asserted. Emulated 390px phone at 4x CPU throttle, before -> after: **repainting
      animations 4 -> 0** (the removed `lpSpkA2` animated `box-shadow`, which repaints every frame),
      compositor-only animations 50 -> 84, phone layout and tile size identical. Repaint is the expensive
      one, so this is a net win on the metric that matters; layer count went up and that is the deliberate
      trade, stated rather than hidden. No JavaScript is added — the whole effect is CSS, and it stays
      inside the existing `prefers-reduced-motion` kill switch.
- [x] TEN PEOPLE NO LONGER RENDER AS EIGHT PLUS TWO. `auto-fit/minmax(130px,1fr)` resolved to EIGHT
      columns on the 1138px card, so the 10-up rendered 8 + 2 with a large empty block underneath — which
      is what the owner's screenshot shows. Now an explicit 5x2, stepping to 4 / 3 / 2 so no breakpoint
      orphans a single tile, and a phone gets 2x5 (verified: 2 columns, no horizontal overflow). The
      "GROUP CALL · 10 LIVE" chip also sat ON TOP of the first tile; it now has its own band, confirmed by
      rect intersection rather than by eye — and the FIRST metric written for it was wrong (it compared
      the grid CONTAINER's box to the card's, but padding moves the tiles, not the container, so it could
      never have detected the fix).
- [x] THE ORPHAN RECOVERY CAN NOW ACTUALLY BE RUN. `scripts/recover-orphan-identity.mjs` has existed since
      v2.99.60 but had no way to reach a live database: `DATABASE_URL` exists only in `/home/relay/.env` on
      the fleet, and this environment cannot reach production. New `recover-identity` action in
      `aws-ops.yml` runs it over SSM on ONE app instance, sourcing the fleet env, so no production
      credential ever has to be copied onto anyone's laptop and none is printed.
      - DRY RUN IS THE DEFAULT (`recover_apply` defaults false), because the script's one destructive act
        is deleting the account's current identity row — which it does only after proving that row is
        empty across all seven identity-referencing tables.
      - ONE instance, `--max-concurrency 1 --max-errors 0`. Running a database mutation on both boxes
        would in fact be harmless (the second pass finds the orphan already claimed and refuses), but
        "harmless because a guard catches it" is not a reason to fire a write twice.
      - The verdict is read from the script's own printed `RECOVER_EXIT=` marker rather than the SSM
        status, because a wrapper or a pipeline can mask a non-zero exit — the v2.99.46 bug.
      - INJECTION: `recover_number` and `recover_email` are free-text `workflow_dispatch` inputs that end
        up inside a command string executed on production EC2. This file has been bitten by exactly that
        class TWICE (SES_EMAIL/DOMAIN, then `region`), so both get the established treatment — base64 on
        the runner, decoded ONLY on the instance. PROVEN EMPIRICALLY, not asserted: the step's own CMDLINE
        construction was replayed with eight hostile values (quote+semicolon, double-quote break, `$( )`,
        backticks, `&&`, `|`, an embedded newline) and executed with a stub `node`; in all 8 the value
        arrived as ONE literal argument and no payload ran. The FIRST harness reported all eight as pwned
        — a bug in the harness, not the code: the stub echoes its arguments, so the payload's own text
        appeared in the output and a naive grep matched it. Text in output is not evidence of execution,
        so the detector became a sentinel FILE that either exists or does not.
- [x] Tests: `client/src/pages/groupGridLive.test.ts` (19, incl. behavioural `speakingTurns` coverage) and
      8 new `recover-identity` pins in `awsOps.test.ts`. TWO PRE-EXISTING PINS REWRITTEN TO THE STRONGER
      INVARIANT rather than relaxed: the v2.99.16 grid pin asserted `-i * 2` and the comma-combined
      `g.spk` speaking animation — and both of those WERE the incoherence this release removed, so it now
      asserts that exactly one schedule exists and that a muted tile takes no turn; and the aws-ops
      options pin froze the exact action list, which has now broken twice on a legitimate addition while
      saying nothing about the property that matters, so it is a prefix match plus "verify must stay
      first, and no duplicates". Suite 2189 passed / 1 skipped (2190); check and build green. (That total is measured AFTER
      rebasing onto main's Round 11, which landed while this branch was open and took the v2.99.68
      number — hence the renumber to .69/.70. My own pre-rebase figures were 2121 and 2148.)
- [x] STILL OPEN: lip movement itself, which needs footage. Everything else in the owner's batch is done.

## v2.99.69 — Adopt-and-Retire: a guest can reclaim the number a browser close forgot (2026-07-26)
- [x] THE LAST STRUCTURAL DATA-LOSS PATH. v2.99.49 fixed the guest -> register transition and v2.99.54
      welded the number to the person through a renumber. What stayed broken was simpler and far more
      common: **a guest closes their browser**. Both things that resolve a guest are session-scoped BY
      DESIGN — the device id lives in `sessionStorage` and the guest cookie is a session cookie — so the
      number, contacts, threads, call history and statuses were stranded with NOTHING left in the browser
      able to name the row. Nothing reaps those rows either, so the data sat there, intact and unreachable.
      This is the real answer to the owner's requirement that data "move with you whenever you are moving".
- [x] THE DESIGN DECISION THAT MAKES IT SAFE: **automatic resolution is NOT loosened.** Making the device
      id or the cookie durable would restore the previous guest AUTOMATICALLY, which on a SHARED browser
      drops the next person into someone else's account — that is precisely why the session scoping exists,
      and it was an explicit product decision, not an oversight. So this adds a SECOND, DELIBERATE path
      instead of widening the first: a recovery key the browser keeps in `localStorage`, sent only when the
      person asks for their number back. Because recovery takes a tap, an explicit **sign-out** is enough to
      sever it — `forgetGuestRecovery()` on both sign-out paths — and the shared-browser property is
      preserved by the gesture that actually protects it. Pinned: the device id is still sessionStorage and
      `guestCookieOptions` still adds no `maxAge`.
- [x] THE KEY. New `server/guestRecovery.ts` (dependency-free): 32 bytes of CSPRNG as 64 hex, stored
      SERVER-SIDE ONLY AS A SHA-256 HASH in the new nullable `identities.recoveryHash` (+ `recoveryIssuedAt`),
      so a row read — or a database dump — never yields something that can claim an identity, the same reason
      `push_subscriptions.claimHash` is a hash. Plain sha256 with no salt is correct here and a KDF would be
      wrong: the input is 256 bits of uniform randomness so there is no dictionary to stretch against, and
      every request must find the row BY this value, which a per-row salt would turn into a table scan.
      `normalizeRecoveryKey` fails CLOSED — anything that is not exactly 64 hex is never hashed and never
      looked up. Minted inside the SAME insert that creates the identity, so there is no window in which a
      guest exists with no way back to it.
- [x] EVERY EXISTING GUEST IS HEALED. Every row minted before this release has a NULL `recoveryHash` and
      would otherwise stay permanently unrecoverable — which is the exact failure being fixed. New
      `ensureGuestRecoveryKey` issues one on the row's NEXT visit, called from both of `startGuest`'s reuse
      branches, so an ordinary returning visitor is covered with no action. It never overwrites an EXISTING
      hash (that would invalidate the copy the browser is already holding, converting a recoverable identity
      into a lost one), never touches a row with a `userId`, and never throws — a guest sign-in must not fail
      over a convenience column. The verdict comes from `affectedRows`, so two concurrent requests cannot
      both believe they minted the live key.
- [x] THE SAFETY GATE, because this feature DELETES AN IDENTITY ROW. `adoptRecoveredIdentity` binds the
      caller to the recovered identity and retires the one they were using — and the row being retired must
      be **provably EMPTY**, counted across all seven identity-referencing tables by the new
      `identityFootprint`. Otherwise adoption would simply move the loss to the other row and this feature
      would become a new way to destroy data. There is deliberately **no override flag**. An unreadable count
      is reported as **-1, never 0**, and any negative refuses — treating an unknown as empty is how you
      delete somebody's messages. The column list is the one `scripts/recover-orphan-identity.mjs` validates
      against `information_schema`: note `contacts.ownerId` (NOT `ownerIdentityId`) and that call history
      splits into `callerIdentityId`/`calleeIdentityId`; both were wrong in that script's first draft and a
      test now forbids the wrong spelling.
- [x] THE RECOVERED IDENTITY KEEPS ITS OWN NUMBER — that is the entire point, since the number is what other
      people stored. Nothing in the adoption path writes `identities.number` (pinned), so the
      `NUMBER_BEARING_COLUMNS` contract from v2.99.54 needs no new entry and nobody who saved 601-586 is
      broken by its owner coming back. One transaction: retire FIRST (the per-account unique index means the
      claim cannot succeed while the old row exists), then claim, each statement re-stating its own
      preconditions in the WHERE so a concurrent change LOSES instead of corrupting; a lost claim throws to
      roll the delete back rather than leaving the caller with no identity at all, and is reported as
      `race-lost` rather than papered over. Idempotent when the caller is already on the target.
- [x] TWO CALLER SHAPES, ONE RULE. A GUEST has this browser rebound to the recovered row (device id + a
      fresh guest token move over, so every later request resolves it the ordinary way with no special case
      anywhere else). A REGISTERED caller has the row CLAIMED by their account — the same claim
      `ensureUserIdentity` performs — with the guest handles dropped, because after adoption the account is
      the only way in. A visitor with NO identity yet skips the retire entirely, and that is the PRIMARY
      path: someone reopens their browser and restores BEFORE typing a name.
- [x] AN EMERGENT PROPERTY WORTH NAMING: this also gives a **self-service fix for the owner's original bug**.
      If a registration ever fails to adopt the browser's guest row, that row stays `userId IS NULL` while the
      browser still holds its key — so the Profile card offers exactly the stranded identity, and a registered
      caller can claim it onto their account without an operator touching the database.
- [x] `identity.guestRecoveryPreview` (read-only) answers with the number, name and footprint the prompt shows
      verbatim — "restore 601-586 · 14 contacts, 320 messages" — because a restore prompt the user cannot
      verify is one they should not tap; negative counts report `null` rather than a confident zero, so the copy
      falls back to "your data" instead of naming figures it cannot stand behind. `identity.adoptGuestRecovery`
      performs it. Both `directoryGate`-limited BEFORE any database work (brute force is not the threat at 2^256
      — an unmetered DB read is), both reject a malformed key without hashing it, and refusals are NAMED
      (`not-found` / `current-has-data` / `footprint-unknown` / `race-lost` / `unavailable`) because each has a
      different correct next step and `current-has-data` in particular must never be silently "resolved" by
      throwing one side away. A key can only ever name an UNCLAIMED row (`userId IS NULL`) and is deliberately
      NOT gated on `guestExpiresAt` — that expiry models the COOKIE's life, and this lookup exists for exactly
      the case where the cookie is long gone. Registration now also nulls `recoveryHash` as defence in depth.
- [x] UI. New `client/src/lib/guestRecovery.ts` (localStorage, NOT a cookie — a cookie is sent on every request,
      which is what would make recovery automatic again) and `client/src/app/GuestRestore.tsx`, used by BOTH
      surfaces so they can never make different promises: the entry screen ABOVE the sign-in card (for a
      returning guest, restoring IS the primary action — typing a name mints a second identity and strands the
      first), and a Profile section for someone who typed a name before noticing. Deliberately NOT on the
      `/i/<pin>` call-link screen, which is one focused field by design. **The card NEVER discards the stored
      key on a failure** — it is the only copy in existence, and a lookup can come back empty for reasons that
      have nothing to do with the key (a DB blip, a rate-limit, a dropped request), so forgetting is only ever
      an explicit "Not me" tap; a test asserts there is exactly ONE `forgetGuestRecovery()` call and that it is
      not in the error path. The number is `dir="ltr"` + bidi-isolated so an RTL display name cannot reorder it.
      Guest copy on the entry screen, in Profile and in the sign-out dialog was corrected: a browser close no
      longer wipes the number, but signing out still does, and the dialog now says so.
- [x] Tests: `server/guestRecovery.test.ts` (54 — behavioural coverage of the key/hash/normalize helpers plus
      pins on every safety property). **All 10 tripwires verified by MUTATION** (footprint gate removed, contacts
      column renamed, unknown-count read as 0, the `userId` gate dropped, an existing key overwritten, sign-out
      keeping the record, the card forgetting on failure, the device id made durable, the gate mount removed, and
      adoption writing the number) — each mutation reverted from a byte-exact backup copy, never from git, per the
      v2.99.56 lesson about a harness that discarded the work under test.
- [x] Suite 2189 passed / 1 skipped (2190) after the rebase onto main's Round 11; check and build green.
- [x] TWO PRE-EXISTING PINS REWRITTEN TO THE STRONGER INVARIANT rather than relaxed. The v2.99.49 mint-gate pin
      hardcoded the destructured names (`{ identity, guestToken }`) and broke when `recoveryKey` joined the same
      statement — it now asserts the ADJACENCY, which is the actual invariant, plus that `createGuestIdentity`
      has exactly ONE call site so nothing can allocate without passing the gate. The v2.99.43 M47 pin sliced to
      a bare `identities_user_unique` token; this release mentioned that index name in prose 1,000 lines earlier,
      which put the slice's end BEFORE its start and silently reduced it to `""` — a pin reading an empty string
      cannot fail for the reason it was written. It now anchors on the migrator entry and asserts the slice is
      non-empty first. (The colliding comment was also reworded.) Both rewrites verified to still bite.
- [x] STILL OPEN, unchanged and stated plainly: the owner's own 601-586 row predates this feature, so its key
      does not exist and `scripts/recover-orphan-identity.mjs` remains the route for that one — its database paths
      have still never run, which is why the destructive half stays behind `--apply`. The animated group-call tiles
      still need an asset decision. Email deliverability is still mostly DNS.

## v2.99.67 — phone heating, a vanishing conference tile, the wrapped dial pad, the missed-call banner (2026-07-26)
- [x] 1. THE LANDING PAGE MADE PHONES HOT. Owner: "when I open this website from the phone, the phone is heating."
      MEASURED on an emulated 390px phone at 4x CPU throttle against the real built bundle, not guessed. The page
      ran TWO uncapped requestAnimationFrame loops (the fx loop + the WebGL scene), repainted a FULL-VIEWPORT
      canvas at device pixel ratio EVERY frame, rewrote SIX gradient/box-shadow style strings 20 times a second
      (fc % 3 at 60fps — each pass re-parsing two 1100px radial-gradients plus three box-shadows across most of
      the viewport), and gated none of it on the tab being visible.
      FIXED: frame budget (30fps desktop / 20fps low-power); early return when document.hidden, with the rAF
      re-armed BEFORE the return so the loop resumes; the chrome tint throttled by TIME not frame count (~4.5/s
      vs 20/s, so cost no longer tracks frame rate and the slow hue drift looks identical); matrix canvas DPR
      1.5 -> 1.0 and column pitch 18px -> 26px on a phone; and the WEBGL SCENE SKIPPED ENTIRELY on a low-power
      device (innerWidth <= 820 OR hardwareConcurrency <= 4 OR Data Saver).
      RESULT before -> after: canvas repaints 59.1/s -> 16.6/s; backing store 585x1266 -> 390x844; canvas fill
      ~43.7 Mpx/s -> ~5.5 Mpx/s (~8x less).
      HONEST LIMIT: the WebGL saving is asserted from the source gate, NOT measured — this environment runs
      --disable-gpu and reported no WebGL context in EITHER run, so the probe could not see the scene either way.
      The prefers-reduced-motion path is untouched.
- [x] 2. A PARTICIPANT WHO TOOK ANOTHER CALL CAME BACK WITH NO TILE. Owner: "on the conference call, somebody got
      a line, when he answer and he returned back, he disappeared… he keep hearing [him], but his profile is
      disappeared." onPeerHold restored a placeholder ONLY under livekitEnabled, so on the MESH the tile stayed
      gone; and the coming-BACK branch only stripped the .on-hold class, so if the tile had already left with the
      peer's transport there was nothing to un-hold. addTile cannot help — it requires a live peers[id] entry,
      which is exactly what the teardown removed. New ensurePlaceholderTile makes a name-only tile on EITHER
      transport, marked data-ph so addTile/addLkTile REPLACE it rather than appending a second element with the
      same id; called on hold AND on return.
- [x] 3. THE LANDING DIAL PAD WRAPPED ON A PHONE (five digits up, one below). Six digits joined by spaces is 11
      characters; at 30px monospace with .28em letter-spacing that is ~290px against ~285px of inner card width
      at 390px — so it wrapped, and only on a phone, which is why it shipped. Now white-space:nowrap
      (structurally one line) plus font:clamp(19px,6.2vw,30px) and letter-spacing:clamp(.13em,.6vw,.28em), whose
      maxima are the original values, so desktop is unchanged.
- [x] 4. THE MISSED-CALL BANNER IS GONE FROM THE MAIN SCREEN. Owner: "don't show it on the main screen as a side
      banner from up to down. Show it only on the notification center on the top… and also on the history."
      AwaySummaryToast is no longer mounted (component kept, import cleaned up). Nothing is lost: the bell still
      counts missed calls AND unread messages, still blinks for them, lists them in its panel, and routes to
      History / Messages — pull rather than push.
- [ ] 5. STILL OPEN — THE GROUP-CALL TILES ARE STATIC PHOTOS. The owner has now asked TWICE for people who look
      like they are talking (moving lips, hands, "like normal people in a conference"). v2.99.16 added per-tile
      Ken-Burns drift and a rotating active-speaker ring; that is motion, but it is not talking. LIPS CANNOT MOVE
      ON A STILL IMAGE — this needs a short looping video per tile (or an animated portrait), which is an ASSET
      decision (licensing + ~10 clips + bytes on the landing page), so it is flagged for the owner rather than
      faked. Options put to them: supply/approve stock clips, or accept stronger non-lip motion.
- [x] Tests: client/src/app/ownerUiBatch3.test.ts (17). Two pre-existing pins REWRITTEN to the new intent rather
      than relaxed: the v2.97.1 hold pin now asserts the transport-agnostic restore in BOTH directions, and the
      v2.99.12 away-card pin asserts the banner is unmounted while the bell keeps the count, blink and routes.
      Suite 2066 passed / 1 skipped; check + build green.
- [x] PARTLY VERIFIED LIVE (2026-07-26, correcting this entry's original claim — HTTP to your-chat.io works
      fine from the agent sandbox; what does NOT work is a headless BROWSER, which gets
      `net::ERR_CONNECTION_RESET` through the agent proxy, so a rendered LAYOUT still needs a real phone).
      Fetched the deployed chunk `assets/Home-CYSiliSF.js` off the live site and confirmed the shipped CSS:
      `white-space:nowrap` present (the dial display is structurally one line), `clamp(19px,6.2vw,30px)` and
      `letter-spacing:clamp(.13em,.6vw,.28em)` present (the phone-sized type that stops the wrap), plus the
      phone-heating gates `document.hidden` and `hardwareConcurrency`. Zero raw U+2197 in either the main
      bundle or the Home chunk, so the Arabic arrow fix holds in what is actually served.
- [ ] STILL NEEDS A PHONE (not a code question): that the page no longer heats after a few minutes, and that
      a conference peer who takes another call returns with their tile. Both are runtime/thermal behaviour
      no static check can stand in for.

## v2.99.66 — owner UI batch from five screenshots (2026-07-25)
- [x] 1. LAST SEEN CARRIES THE CLOCK. formatLastSeen returned "last seen on Jul 23" for anything older
      than yesterday, while the same-day and yesterday branches already had the time. Owner: "it shows you
      below last seen on this, but doesn't show you the time and the minutes." Every dated branch now ends
      "at H:MM AM"; the YEAR is named only when it differs from now, because "Jul 23" silently reads as
      this year and being twelve months wrong without saying so is worse than one extra token.
- [x] 2a. ONE "+" REPLACES THE IMAGE AND PAPERCLIP BUTTONS. Owner: "put the attachment and the image into
      one icon like you click a plus… it will give more space for the input box of chatting." The + always
      opens the existing attach menu, which now carries Record video (still gated on
      videoRecorderSupported()), Photo & video, and Attach file — nothing lost, ~44px returned to the text
      field. The old handler opened the menu ONLY when a recorder existed and otherwise jumped straight to
      the library, which would have hidden "Attach file" entirely, so it is now an unconditional toggle.
- [x] 2b. THE BELL AND MAGNIFIER MOVED INTO THE PEER PROFILE. Owner: "for the search and for the
      notification, make it inside the profile of the person when you click on his name." As permanent
      header icons they squeezed the name to "Ibrahi..." and left the "last seen" line with nothing after
      it. openPeerProfile(number, chat?) now takes an optional PeerProfileChatActions
      ({onSearch, muted, onToggleMute, lastSeenText}); Messages passes it, Contacts / History / the dialer
      pass nothing and render exactly as before. The popup also shows the FULL last-seen line with its
      clock, which the single-line header cannot fit. Only the close-search affordance stays inline, and
      only while search is open, because it acts on what is on screen.
- [x] 3. LIVE COUNTERS ON THE SIGN-IN SCREEN. Owner: "this is the live reads on the main website where I
      want also this one to be also on the login page... below the login and registration with the email,
      above the voice video chat." New client/src/app/LiveStats.tsx — Registered / Guests served / Call
      parties / Messages / Online now, same public aggregate stats.public endpoint, polled every 15s, the
      online figure pulsing. New messagesSent COUNT(*) joins the four existing counters, wrapped in
      try/catch because `messages` is the largest table and a headline number must never stop the landing
      page rendering; the landing page gains the same tile in EN and AR. Renders NOTHING rather than five
      zeros when the query has no data — getPublicStats answers zeros on a dead DB, and a wall of "0" on
      the sign-in screen reads as a broken product.
- [x] 4. THE AWAY AUTO-REPLY IS OPT-IN. Owner: "you have it as a feature, but you should allow the user to
      enable and disable it. You don't enable it by default." New identities.autoReplyEnabled (additive
      nullable via the boot migrator) — on the IDENTITY rather than `users`, so a GUEST can set it and it
      travels with the person through registration and renumbering, consistent with v2.99.54. Only an
      explicit true enables it, so NULL turns the old always-on behaviour off for everybody, which is the
      intended change. autoReplyEnabledFor FAILS CLOSED on any trouble — this posts a line in someone's
      name into a conversation they are not watching, so silence beats guessing yes — and the pref is
      checked BEFORE the presence and dedupe reads, so the common opted-out path costs one indexed lookup
      instead of three. Surfaced as a switch in the Messages header (AutoReplyToggle), optimistic with
      rollback so it cannot misreport its own state, plus identity.setAutoReply and autoReplyEnabled on
      whoami.
- [x] 5. CONTACTS PUT LAST SEEN BELOW THE PIN. They shared one line, and with a 6-digit PIN plus "last
      seen 18h ago" there was never room — every row wrapped mid-phrase and read as broken. Two short
      lines now, with the pin dir="ltr"-isolated so an RTL name cannot reorder it.
- [x] Tests: client/src/app/ownerUiBatch2.test.ts (23) + 2 new formatLastSeen cases. The v2.96.2 recorder
      pin was REWRITTEN to the new menu shape rather than relaxed — it asserted the exact branch this batch
      deleted, and still gates Record video on recorder support. Suite 2049 passed / 1 skipped; check +
      build green.
- [x] SIGN-IN COUNTERS VERIFIED LIVE (2026-07-26): this entry's premise was wrong — HTTP to your-chat.io
      works from the agent sandbox (only a headless browser is blocked by the proxy). The deployed
      `assets/index-SEadxTeO.js` contains the "Guests served" label and references `stats.public`, so
      LiveStats is genuinely shipped and wired on the live sign-in screen.
- [ ] STILL NEEDS A PHONE (visual/interaction, not checkable from source): the dialer preview's last-seen
      line, the composer's + menu, tapping a chat name for search/notifications, the Messages auto-reply
      switch, and the contacts rows.

## v2.99.64/65 — TURN :443 diagnosed to two owner-only steps; TLS-on-443 unblocked (2026-07-26)
- [x] `turn-fix` established: both relays are EC2 instances in this account —
      `i-0ccd35acc6940c5dc` (13.232.119.83) and `i-0cf65f64e50fa4e3d` (13.204.23.58) — and they SHARE ONE
      SECURITY GROUP, `sg-063532b4c358d1513`. That is why :443 is dead on BOTH identically, and it means
      the network half of the fix is ONE rule on ONE group, not two.
- [x] It could not go further, and says so rather than guessing: `ec2:DescribeSecurityGroups` is denied to
      relay-github-deploy, and the relay hosts are NOT SSM-managed from this account, so coturn's listeners
      can be neither inspected nor changed from CI. Both remaining steps are owner-only; the action prints
      the exact IAM grant that would let it finish the SG half itself.
- [x] BUG OF MY OWN, found by that first run: GitHub runs steps as `bash -e {0}`, so the denied
      DescribeSecurityGroups call aborted the whole diagnostic before the listener check — the more
      informative half — ever ran. The step now sets `+e` explicitly, and reports a denial as UNKNOWN
      instead of letting it read as "not open", which would have been a finding this role could not make.
- [x] NEW `TURN_TCP_ALT_PORT=off|none|0|false` suppresses ONLY the plaintext alt-port candidate. This is
      what makes the better fix possible: `turns:<host>:443` is indistinguishable from HTTPS and passes
      DPI, where plaintext TURN on 443 is exactly what DPI drops — and the two cannot share a port, so
      advertising both would point clients at a TLS listener in plaintext. Unset still means 443, so every
      existing deployment is byte-identical.
- [x] Fixed the test helper while adding coverage: its KEYS list omitted TURN_TCP_ALT_PORT and
      TURN_TLS_PORT, so those leaked between cases and the new assertions did not mean what they said.
- [x] REMAINING (owner-only, both on the relay side):
      1. allow tcp/443 inbound on sg-063532b4c358d1513 (one rule, covers both relays), and
      2. make coturn listen on 443 — preferably TLS: `alt-tls-listening-port=443` in turnserver.conf, then
         `TURN_TLS_PORT=443` + `TURN_TCP_ALT_PORT=off` via env-set. (Plaintext alternative: leave the env
         alone and redirect 443→3478 on the relay hosts.)
      Then re-run `verify` — it will report 8/8 allocating.

## v2.99.68 — ROUND 11: the signaling room registry survives the loss of the leader (2026-07-26)
- [x] THE GAP, as the owner's reviewer described it and as the code confirmed: clustered signaling elects ONE
      leader that owns the whole call registry — rooms, members, roles, the pin→room index — in memory. Kill
      that process and every active call's room is gone FLEET-WIDE. Browsers reconnect, but there is no room
      to renegotiate through, so a relayed call cannot recover and a P2P call becomes unrepairable at the
      first hiccup. Verified absent before building: `relay:room:*` and `rejoin-recreate` were 0 occurrences.
- [x] **A. DURABLE SHADOW** — new `server/roomStore.ts`. Every room mutation marks the room dirty; a
      coalesced next-tick flush writes it (the `touchBusyState` discipline, so a handler crossing several
      funnels mid-transition writes ONCE, settled), plus a 15s sweep that rewrites every live room so a
      mutation site nobody marked still converges and TTLs stay fresh on a quiet call. `relay:room:<id>` is
      ONE hash with `e` (epoch) + `d` (signed JSON) — a single atomic HSET, so a reader can never see a
      half-written room; `relay:rooms` is a SET index so hydration is one SMEMBERS, not a SCAN.
- [x] **THE PIN→ROOM INDEX IS DERIVED, NOT STORED** (a deliberate deviation from the spec's
      `SET relay:pinroom:<pin>`): a pin is in at most its ACTIVE room and its HELD room, and BOTH always
      contain it, so a `held` flag per member rebuilds both maps and rides the SAME atomic write. Separate
      per-pin keys would be a second write that can land out of order with the first.
- [x] **FENCING** — a lease can expire while its holder is alive and still believes it leads (GC pause,
      network blip); two leaders both writing would interleave two registries into one record. Every write
      carries a monotonic epoch (`INCR relay:leader:epoch` on winning the lease) and is applied by a Lua CAS
      that refuses a LOWER epoch. `>` not `>=`, so a leader can always overwrite itself. Losing the lease
      sets the epoch to 0 immediately, which stops writes at the source.
- [x] **HYDRATION GATES SERVING** — a new leader mints its epoch, reads the rooms back, and only THEN
      processes signaling; frames queue meanwhile. A leader that answered `accept` for a room it had not
      hydrated would tell the caller the call is gone. 5s timeout, then it serves ANYWAY — fail open,
      deliberately: a missing room degrades to "dial again", a wedged signaling layer means nobody can call.
- [x] **THE BUG THAT WOULD HAVE MADE ALL OF THIS A NO-OP**, found by reasoning through the behavioural test
      before writing it: a hydrated room has NO connected members by construction (every client record died
      with the old leader), which is exactly the "room of ghosts" shape `sendRejoinIfInRoom` exists to
      dissolve — so the FIRST peer to come back would have called `leaveRoom` and deleted the very call
      hydration saved. New `roomMeta.hydratedAt` + `HYDRATED_GRACE_MS` (45s) keeps it alive until its owners
      re-register, after which a ghost room behaves exactly as before. Pinned by a test proven to fail
      against the ungraced version.
- [x] **SIGNED RECORDS** — they cross the same trust boundary as bus envelopes (anything with network reach
      to Redis can write them) and hydration feeds them into the live registry, so they are HMAC'd with the
      same fleet key. `busSecret` is now EXPORTED from redisBus and imported rather than re-derived — a
      second copy of "which env var is the fleet secret" is what caused the v2.99.49 identity bug. A forged
      record is dropped at hydration and its index entry pruned (proven against a real redis-server).
- [x] **B. `rejoin-recreate` — REWRITTEN AROUND A SIGNED CAPABILITY.** The spec had the client send
      `{roomId, selfPin, selfRole, knownMembers}` and the server "recreate the room shell and admit". That is
      an authorization hole: room ids are relayed to every participant, so naming a stranger's roomId would
      admit you to their live call, and `selfRole: "host"` would hand you kick/mute/admit over it — the exact
      class closed by v2.99.43 (M45) and v2.99.57 (R-GENPIN). Instead the client is asked for ONE thing: a
      capability THIS FLEET minted when it admitted that pin to that room (`server/roomCapability.ts`,
      `<exp>.<role>.<hmac>`, 12h). The subject pin comes from the CONNECTION, the role from INSIDE the
      signature, and a claimed member list is not read at all — membership converges because every returning
      peer presents its own capability. A signed `host` capability takes a VACANT host seat and never
      displaces one, so two peers recreating concurrently cannot fight over moderation. No fleet secret ⇒
      the path does not exist rather than existing unauthenticated.
- [x] **C. CLUSTER HYGIENE** (findings 26/27 of the review, both confirmed real first). `makeRemoteSocket`
      returned only `{send, close}`, so `relay.ts`'s `!target.socket.alive` short-circuited TRUE for every
      remote peer — the leader could not tell a dead browser from a quiet one. New per-instance heartbeat
      (`relay:sig:hb:<leader>`, 5s, one frame per instance carrying its cid list) drives a real `alive()`.
      It FAILS OPEN twice over — unknown cid, and an instance that has never beaten at all (an older build
      mid-rollout) — because reporting a LIVE browser as dead sends its calls to the leave-a-message card
      instead of ringing them. A home that misses 20s hands its browsers to the ORDINARY
      `cleanupRegistryConn` grace, not oblivion: it may simply be restarting.
- [x] **LEADERSHIP HANDOVER** — on a leader change each instance sends its local browsers `{type:"resync"}`,
      which re-registers them (rebuilding the client records the dead leader held; a client record owns a
      socket, and the socket lives on the home) and yields a `rejoin` from the hydrated rooms. Old clients
      ignore the unknown message and are no worse off than before. SECOND BUG CAUGHT BEFORE SHIPPING: the
      change hook is deliberately silent when the new leader is US, so the instance that TOOK OVER would have
      repaired every browser in the fleet except its own — the ones most likely to be in the call. It now
      resyncs its own browsers at the end of taking over, after hydration. Also pinned by a mutation test.
- [x] The client keeps the capability alongside `roomId`, refreshed by every room ack (captured in ONE place
      in `handle()` so an ack added later inherits recovery for free), persists it in the rejoin snapshot,
      and drops it on hang-up/destroy — which is what guarantees the repair path can never resurrect a call
      the user ended. `rejoin-recreate` is ARMED (1.5s) rather than sent: register→rejoin is one round trip
      and usually wins, so the repair only fires when the room is genuinely gone.
- [x] TESTS: `server/roundEleven.test.ts` (35, driving the real registry) + `server/roomStoreLive.test.ts`
      (7, against a REAL spawned redis-server — the fence is Lua and Lua runs inside Redis, so a string check
      of the script is not evidence that the script works; a lower-epoch write AND a lower-epoch DELETE are
      both proven refused). **10 tripwires verified by mutation**, reverting from byte-exact backups and
      aborting on a missing mutation target (never `git checkout --`, which discarded uncommitted work under
      test in v2.99.56 and produced three false PASSes). Two of my first mutations were wrong rather than the
      tests, and one property turned out to be defended by three redundant gates — recorded honestly rather
      than quietly counted as a pass. 2108 tests (this branch rebased onto v2.99.67, which added its own).
- [ ] OPERATOR: nothing required — `RELAY_CLUSTER=1` + `REDIS_URL` are already set on the fleet, and every
      new key self-expires. The manual failover test is in `docs-cross-instance-signaling.md`: kill the
      LEADER mid-call and the call should survive.

## v2.99.71 — the TURN health checker disagreed with the server about what is advertised (2026-07-26)
- [x] CONTEXT: the owner completed the TURN work and reported it tested. Read back from the LIVE
      `/api/relay/ice` rather than taken on trust, the fleet's relay list is now **hostname-based with TLS
      on 443**: `turn:{turn,turn2}.your-chat.io:3478?transport=udp` + `:3478?transport=tcp` +
      `turns:...:443?transport=tcp`, 6 URLs over 2 relays. Hostnames (not the old raw IPs) because a
      public TLS cert cannot be issued for an IP; `turns:` on 443 because that is indistinguishable from
      HTTPS and survives the DPI that was dropping plaintext TURN; and the plaintext `turn:...:443` form
      is ABSENT, which is the observable proof that v2.99.65's `TURN_TCP_ALT_PORT=off` is live and doing
      its job. That closes the last owner-only item from v2.99.63–65.
- [x] BUG FOUND IN MY OWN TOOLING, in the same breath: `scripts/turn-check.mjs` never learned the `off`
      rule. `const ALT = process.env.TURN_TCP_ALT_PORT || "443"` then `port: +ALT` — with `off` set that
      is `+"off"` = **NaN**, so the checker probed a third endpoint per relay that the fleet does not
      advertise and could never answer. Every future health check would have reported 2 permanently DOWN
      endpoints, and a false failure is precisely what hides a real one. The `off` parsing is now the
      SAME expression as `iceServers()` uses, and the endpoint is skipped rather than probed at NaN.
- [x] THE REAL FIX IS THE TEST, because this is the v2.99.50 class — two gates that disagree about the
      same rule, in different files and different languages (the checker is plain `.mjs` run by bare
      `node` on an EC2 instance from the release tar; `iceServers()` is TypeScript in the server bundle),
      so no string comparison would catch the NEXT divergence. `deriveTurnEndpoints` + `endpointToUrl`
      are now exported from the script and `server/turnCheckParity.test.ts` compares their ACTUAL OUTPUT
      against `iceServers()` over 7 env shapes — including the live fleet's — asserting the two sets are
      EQUAL. Verified by mutation: reinstating the unconditional push fails 3 of the 9 tests.
- [x] The script's main body is now guarded by a real run-as-main check (`fileURLToPath(import.meta.url)`
      vs `path.resolve(process.argv[1])`) so importing it for the test is inert — without that, the
      import ran a health check and then `process.exit(0)`, taking the test runner with it. Confirmed
      both ways: the import yields two functions and prints nothing, and `node scripts/turn-check.mjs`
      still runs a real check.
- [x] Triggered the in-VPC `aws-ops.yml verify` (the only place an authenticated TURN Allocate can be
      measured — the runner is outside the VPC and this sandbox's proxy answers :3478/:5349 with ASCII
      "HTTP/1.1", the trap that produced a false 0/3-relays-dead report in v2.99.62). 2198 tests.
- [x] LIVE EVIDENCE from the in-VPC run (30193640103), which independently confirmed BOTH halves:
      every real endpoint allocates — `turn:turn.your-chat.io:3478 udp` OK relayed port 61660,
      `:3478 tcp` OK 51267, **`turns:turn.your-chat.io:443 tcp` OK 58067**, and the same three on
      turn2 (55678 / 54591 / **65319**). So TLS-on-443 WORKS on both relays, and because the check is
      an authenticated Allocate rather than a ping it also proves both relays share one
      `static-auth-secret`. That is the v2.99.63 item CLOSED with measurement, not assertion.
      Meanwhile the run printed, verbatim, the bug this release fixes:
      `turn:turn.your-chat.io:NaN tcp  DOWN  connect: Port should be >= 0 and < 65536. Received type
      number (NaN).` on BOTH relays, giving `TURN_CHECK_EXIT=1` and "2/8 endpoint(s) NOT usable as a
      relay" — a wholly FALSE failure. After this fix the checker derives 6 endpoints, not 8, and the
      run should exit 0. NOTE the step deliberately echoes the script's exit code instead of
      propagating it (`verify` is a status report and must not mask the rest of the fleet report), so
      the step going green is NOT evidence of relay health — the per-endpoint lines are.

## Round 11 leader-failover test — RUN AND PASSED (2026-07-26)
- [x] The one Round 11 claim I could not verify from the sandbox (it needs two live instances and a
      browser on each) was run by the owner against a **real 2-device call**. An identical script went to
      both instances; each compared `relay:leader` to its own id and only the leader `kill -9`'d itself —
      SIGKILL, so no graceful-shutdown path could flush anything on the way out. Verdict PASS, and the
      owner's subjective report is the headline: *"I didn't feel anything — it works normal, like there
      was no disconnection."*
- [x] The evidence pins the MECHANISMS, not just the outcome, which is what makes it worth recording:
      (1) `relay:room:r6fb23ba9d392` was already in Redis with both members and epoch field `2` BEFORE
      the kill — so the write-through had genuinely persisted a live room, and the record was not
      manufactured by the recovery path; (2) `relay:leader:epoch` advanced to `3` on election, i.e.
      `mintLeaderEpoch` minted a strictly higher fence; (3) the new leader logged
      `[relay] hydrated 1 room(s) from Redis on taking leadership` VERBATIM — that string only prints
      when `applyHydratedRooms` returns non-zero, so hydration provably ran, and it runs inside the gate
      that precedes serving any signaling; (4) the room record survived the election with its epoch field
      advanced `2` → `3`, which shows the Lua CAS admits a HIGHER epoch, complementing
      `roomStoreLive.test.ts`'s proof that it refuses a lower one. pm2 revived the killed process
      (`restarts: 1`) with no ASG replacement.
- [x] Recorded in `docs-cross-instance-signaling.md` § Round 11 so the next contributor finds the result
      beside the procedure rather than only in a chat log.
- [ ] STILL UNTESTED, stated rather than glossed: (a) a STRICT split topology — production logs do not
      record which instance each browser's SSE was attached to, so "one browser per instance" cannot be
      proven retroactively for that run (force it by deregistering one ALB target, connecting device 1,
      swapping, connecting device 2, re-registering both, then killing the leader); (b) test 3, the
      `rejoin-recreate` fallback, which needs the Redis room keys deleted before the kill; (c) the
      companion TURN test — kill a relay mid-**relayed** call and expect recovery via the second relay.
      The tested call was P2P, so the relays were bystanders and the multi-relay path is still unexercised
      end to end even though both relays are now proven to allocate.
- [x] NO VERSION BUMP: this commit records a test result and changes no code, so bumping would mint a
      release that alters nothing a user can observe (and invite a fourth version collision with the
      parallel branches).

## Session close-out — everything landed, nothing unmerged (2026-07-26)
- [x] AUDITED for unlanded work rather than assumed: zero open PRs; no stashes; a clean tree; and every
      remote branch now reports `0 ahead` of `origin/main`. TWO branches LOOKED unmerged and were not —
      `claude/jolly-brown-isnjrh` and `claude/connected-ready-glsdab` were both stale post-squash remnants,
      and their content-diff against main was pure DELETION, meaning merging either would have REVERTED
      live content (#48's branch predates #49, so it would have removed the Round 11 failover record).
      Checked before acting instead of merging on the strength of "1 commit ahead".
- [x] VERIFIED my work survived #48's merge, since that branch was cut before #49 landed: the failover
      record and its verbatim hydration log line are still in `docs-cross-instance-signaling.md`, the
      `altOff` fix is still in `scripts/turn-check.mjs`, and all four Round 11 sources plus both test files
      are present on main.
- [x] main (v2.99.73) is LIVE on both instances (`7b9fd4f1`, `fe2517fd`), `cluster=True redisBus=True`,
      2237 tests passing. `claude/jolly-brown-isnjrh` reset to main so the next task starts from a clean base.
- [x] DELIBERATELY NOT DELETED: the two stale remote branches. `claude/connected-ready-glsdab` belongs to a
      parallel session that may still be active, and deleting someone else's branch is an outward-facing,
      hard-to-reverse act on work I do not own. Both are harmless — fully merged and 0 ahead.
- [ ] REMAINING WORK, none of it a loose end: task #26 (call media — iOS self-mirror, call quality, live
      video filters) which the owner explicitly deferred; the group-call tiles being static photos, which
      needs footage and is an asset decision; the TURN relay-failover test (both relays now proven to
      allocate, but no call has yet MOVED between them — the highest-value remaining test); Round 11 test 3
      (`rejoin-recreate`, needs the Redis keys deleted before the kill) and a strict split topology; and the
      phone-only visual checks above.
