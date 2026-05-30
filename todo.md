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

### Deferred to v2.2
- [ ] Replace v1 in-memory signaling with the DB-backed `signaling` mailbox table (table exists, helpers exist, integration deferred to avoid risking working calls)
- [ ] Real-device QA on mobile Safari + Chrome Android for dialer-clamp and voice-note recording

### Real-device QA carried forward from v1.2
- [ ] Camera flip on physical phone
- [ ] Filter render fps + remote peer receiving filtered stream
