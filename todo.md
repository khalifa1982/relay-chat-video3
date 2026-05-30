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
- [x] Serve the original RELAY HTML/CSS/JS verbatim from `client/public/relay/` (preserves the WebRTC mesh code paths the user already validated end-to-end)
- [x] Connect to `wss://<host>/api/relay`
- [x] Register flow with name → server-issued 6-digit number
- [x] Dial pad / call by number
- [x] Incoming call screen with accept/decline
- [x] In-call grid with up to 6 video tiles, mute / camera / hangup controls
- [x] In-call text chat over WebRTC data channels
- [x] Recents list, share-my-number control, toasts for errors

## Routing & landing
- [x] Route `/` → marketing landing page introducing RELAY
- [x] Route `/app` → the actual calling app (Express serves the standalone UI)
- [x] Privacy / hosting notes inline on the landing page

## Quality & delivery
- [x] Unit tests for the signaling logic (vitest, 9/9 passing)
- [x] Verify `webdev_check_status` passes (LSP / TypeScript clean, dev server running)
- [x] Save checkpoint and provide preview link to user

## Bugs
- [x] Clicking "Launch RELAY" shows a "Redirecting to /app/" plain text page instead of loading the calling UI in production (fixed: explicit GET /app and /app/ handlers registered ahead of express.static; redirect disabled on static middleware)
- [x] App is stuck on "Connecting…" in production — the WebSocket to /api/relay isn't completing (fixed: switched signaling from raw WebSocket to Server-Sent Events + HTTP POST so it goes through Cloudflare/Cloud Run cleanly)
- [x] Production /app still stuck on "Connecting…" — fixed by porting the standalone HTML/JS calling UI into a real React route at /app (`client/src/pages/Relay.tsx` + `client/src/lib/relayClient.ts`). SSE+POST signaling unchanged. Tests still 10/10.
- [x] Add version number to footer on every deploy (RELAY · v1.0.2 visible bottom-right of the calling UI)

## Calls stuck on "Connecting…" between two real users (intermittent — reported by user on 3rd test)
- [x] Add free public TURN fallback (openrelay.metered.ca) on top of Google STUN so strict-NAT users can establish media without operator-run coturn
- [x] Surface per-peer WebRTC connection state next to each video tile so failures are diagnosable (per-tile data-state attribute + colored "connecting/checking/reconnecting/failed" label)
- [x] Add a "Diagnostics" overlay (toggle with `?` key or button bottom-left) showing per-peer ICE/conn/gather/signaling state and a rolling event log; Copy button to share logs
- [x] Auto-trigger ICE restart on the offerer side when connection fails (rescues calls where a NAT mapping died mid-call)
- [x] Verify in dev before saving checkpoint (manual smoke test passed; vitest 11/11)
- [x] Bump version to v1.1.0 (visible bottom-right of the calling UI)

## v1.2 — Camera UX, live filters, redesigned call bar
- [x] Self-preview no longer mirrors outgoing video (outgoing canvas stream is never mirrored; local self-tile shows mirrored preview only when using front cam, no mirror on back cam)
- [x] Add a "Flip camera" button to swap between front (`facingMode: user`) and back (`facingMode: environment`) on devices that have both
- [x] Build a canvas-based local-camera processing pipeline (`client/src/lib/mediaPipeline.ts`) that captures raw `getUserMedia` track, runs filters per-frame on a hidden `<canvas>`, republishes `captureStream()` track via `RTCRtpSender.replaceTrack`
- [x] Color filters: none / B&W / sepia / vivid / cool / warm (canvas `filter` property)
- [x] Background blur using MediaPipe Selfie Segmentation (lazy-loaded — only fetched on first blur use)
- [x] Face overlays using MediaPipe Face Detector: sunglasses, dog ears, hearts (drawn on canvas relative to detected bounding boxes; lazy-loaded)
- [x] Snapchat-style horizontal scrollable filter picker (filter dock with horizontal scroll, scroll-snap, active-state highlight, close button)
- [x] Redesign the in-call control bar — glassmorphic floating pill, frosted blur, circular icon buttons, gradient hangup pill
- [x] Bump version to v1.2.0
- [x] Verify with two real devices — deferred to user (real-device verification of camera flip on phone, filter render fps, and remote peer receiving filtered stream cannot be performed by the agent without physical hardware; covered instead by 6 new vitest tests for the filter registry, manual UI inspection of the dock & control bar, and code-level review of replaceTrack wiring)

## v1.2.1 — Claude / external-LLM cloud editing pipeline
- [x] Write CLAUDE.md at repo root with full project briefing (architecture decisions, conventions, pitfalls, pending work) so Claude or any LLM agent has accurate context the moment it opens the repo
- [x] Add GitHub Actions CI workflow (`.github/workflows/ci.yml`) that runs `pnpm check`, `pnpm test`, and `pnpm build` on every push and PR — safety net against breaking commits from automated agents
- [x] Add `.github/pull_request_template.md` that nudges contributors (human or LLM) to update `todo.md`, `CLAUDE.md`, and bump the version footer on every PR
- [x] User-side: export project to GitHub — done by agent via `gh` CLI to https://github.com/khalifa1982/relay-chat-video (private). 155 files pushed on `main`.
- [x] Push `.github/workflows/ci.yml` and `.github/pull_request_template.md` to GitHub — completed by agent after the user re-authorized the `gh` CLI on the cloud computer with the `workflow` scope (commits 574f10ff for ci.yml, 8a5cb4d9 for the PR template).
- [ ] User-side: install Claude GitHub App on the new repo so Claude can read files and push commits directly (https://github.com/apps/claude → Install → select only `relay-chat-video`)

## v2.0 — Phone-app experience (planned)

### Design (Gemini 2.5 Flash)
- [ ] Generate visual direction via Gemini: palette refinement, dial-pad layout for phone / tablet / desktop, message bubble system, contact card, online/offline status pills, app-shell chrome
- [ ] Write `design/v2-spec.md` capturing the chosen direction so it survives across sessions

### Backend & data model
- [ ] Schema: `guest_sessions` (id, username, number, cookie_token, created_at, expires_at, ip, upgraded_user_id)
- [ ] Schema: `contacts` (owner_user_id_or_guest, contact_number, display_name, avatar_url, created_at)
- [ ] Schema: `conversations` (id, kind, last_message_at) + `conversation_participants` (conversation_id, party_id, party_kind, unread_count, last_read_at)
- [ ] Schema: `messages` (id, conversation_id, sender_party_id, sender_kind, body, kind, attachment_id, created_at, edited_at, deleted_at, status)
- [ ] Schema: `attachments` (id, storage_key, url, mime, size, width, height, duration_ms, uploaded_by)
- [ ] Schema: `presence` (party_id, party_kind, last_seen_at, is_online) updated by WS heartbeats
- [ ] tRPC: `guest.start({username})` → sets 30-day cookie, allocates 6-digit number, returns identity
- [ ] tRPC: `auth.upgradeGuestToUser()` — migrate guest data to OAuth user
- [ ] tRPC: `contacts.list/add/update/remove`
- [ ] tRPC: `messages.threads/messages/send/markRead/typing`
- [ ] tRPC: `attachments.signUpload` + server-side `storagePut` integration
- [ ] WS: presence channel (online/offline/last_seen) and new-message push
- [ ] Migration script + `pnpm db:push` verified

### Frontend app shell
- [ ] Landing page: clean hero with single "Enter your name" input → CTA "Get my number"
- [ ] After name: routed into `/app` shell with persistent header (your number) + nav
- [ ] Mobile: bottom tab bar with Dialer + Messages (+ unread badge)
- [ ] Desktop/tablet: left sidebar version with same nav
- [ ] Theme polish per Gemini spec; preserve dark theme; ensure tokens consistent

### Dialer tab
- [ ] Top: large display of *your* 6-digit number with copy button
- [ ] Center: input field accepting 6 digits, backspace, long-press-0 for "+" (future)
- [ ] 12-key grid (1–9, *, 0, #) sized via CSS clamp so it never overflows on any viewport
- [ ] Big green call button (full width on mobile, fixed-circle on desktop)
- [ ] Call history list below pad: avatar/initials, name (from contacts) or number, time, in/out/missed icon
- [ ] On dial: peek modal showing callee name (if contact) + online/offline + last seen, ringing animation
- [ ] During call: existing in-call UI preserved (filters, mute, hangup, etc.)

### Messages tab
- [ ] Thread list: avatar, name/number, last message preview, time, unread count badge
- [ ] Conversation view: SMS-style bubbles, day separators, delivery/read ticks
- [ ] Composer: text + emoji picker + attachment menu (image/video/audio/file)
- [ ] Voice notes: record + send as audio attachment
- [ ] Image/video previews inline, lightbox on tap
- [ ] Pull-down for older messages (pagination)
- [ ] Typing indicators ("Aman is typing…")
- [ ] System-message: "Call ended — 02:34" auto-inserted after a call between two parties

### Contacts
- [ ] After a successful call, prompt "Save Aman to contacts?"
- [ ] Contacts page accessible from sidebar/long-press in thread
- [ ] Online dot + last-seen on each contact card
- [ ] Edit display name, optional avatar (uploaded via storage)

### Onboarding & upgrade
- [ ] Cookie `relay_guest=<token>` set with 30-day max-age, HttpOnly, SameSite=Lax
- [ ] On revisit within 30 days: skip name prompt, restore previous identity + number
- [ ] "Keep my number forever" CTA in profile → triggers Manus OAuth → server migrates guest rows to the new user_id
- [ ] Show clear "Guest — expires in N days" or "Permanent — registered" status in profile

### Tests & quality
- [ ] Vitest: guest flow (start, restore, expire, upgrade)
- [ ] Vitest: messages send/receive/read/unread counters
- [ ] Vitest: attachment upload roundtrip
- [ ] Vitest: presence transitions
- [ ] Vitest: regressions on existing call-setup flow

### Delivery
- [ ] Update CLAUDE.md with v2.0 architecture
- [ ] Deploy and save checkpoint as v2.0.0
