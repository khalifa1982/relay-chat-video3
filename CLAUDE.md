# CLAUDE.md — Briefing for Claude (and other LLM agents)

> Read this file first whenever you join this repo. It tells you what RELAY is, how it's built, what's already working, what's been deliberately chosen, and what to be careful about. Keeping this file accurate is part of your job as a contributor.

---

## TL;DR

**RELAY** is a self-hosted, browser-based voice / video / chat caller wrapped in a phone-app shell. Visitors pick a display name (or sign in), get a persistent 6-digit number, and can dial each other (peer-to-peer WebRTC mesh up to 6 participants), send SMS-style messages with attachments, and manage contacts. Hosted on **Manus** at `https://relaychat-lduywq6l.manus.space`.

Stack: **React 19 + Vite + Tailwind 4 + Express 4 + tRPC 11 + Drizzle ORM (MySQL) + Manus OAuth + Server-Sent Events signaling + native WebRTC + MediaPipe Tasks Vision**. Deployed as a single Node.js process on Cloud Run.

**Current version: v2.48.0** (Phone-app shell with Dialer/**History**/Messages/Contacts tabs, guest identities with 30-day cookies, persistent messaging with attachments, presence). v2.48 adds a **self-checking auto-updater** (`shared/version.ts` is the single source of truth, served at `GET /api/version`; a mounted-once `UpdateChecker` polls every 30s and either reloads silently mid-call — auto-rejoin keeps the call — or shows a centered reappear-on-dismiss refresh prompt when idle) and **"enable once" auto Picture-in-Picture** (persisted `relay_auto_pip`; primes the compositor at call start so the browser auto-opens a 2-up active-speaker PiP whenever the app is backgrounded mid-call). Recent batches added a **multi-device ring** (flag-gated), **persistent call membership + auto-rejoin** (refresh/step-away keeps the call; only an explicit hang-up or logout locks you out — hardened against a cross-user hijack on shared browsers), a **multi-party camera fix + mobile screen-share**, **conference call history** (the History tab: dialed number, party count, each party's name + PIN, duration, per room), and an **active-speaker / spotlight view** (the in-call grid follows the talker, auto-focuses a shared screen, tap-a-tile-to-spotlight, and collapses to a 2-up when minimized — pure decision logic in `client/src/lib/callLayout.ts`). The legacy single-screen calling UI is still reachable at `/app/call` for the actual in-call experience.

> Versions v2.1–v2.30 layered on a lot since this doc's v2.0 baseline — LiveKit SFU calls, Resend missed-call email, Do-Not-Disturb, invite links, offline auto-reply, call waiting, device **passcode app-lock** + **biometric (WebAuthn) unlock**, a call-engine reliability batch (raw-track publishing to kill mobile heat, a 10s reconnect window, live top-bar status), **screen sharing**, **call recording (LiveKit Egress → S3)**, **group messaging**, an installable **PWA**, **rich contact fields** (+ an additive boot-migrator), **inbound email reply-to-thread**, **voice calls + voice↔video**, message **unsend** / **reply** / **per-conversation mute**, and **typing indicators**. See `todo.md` for the per-version changelog; treat it as the source of truth for what shipped.

---

## What's been built (high-level feature inventory)

| Area | Status | Where |
|---|---|---|
| Marketing landing page at `/` | shipped | `client/src/pages/Home.tsx` |
| In-browser calling app at `/app` | shipped | `client/src/pages/Relay.tsx` + `client/src/lib/relayClient.ts` |
| Docs page at `/docs` | shipped | `client/src/pages/Docs.tsx` (renders `client/public/RELAY-README.md`) |
| Signaling server (SSE + POST, not WebSocket — see below) | shipped | `server/relay.ts`, mounted via `attachRelay(app)` in `server/_core/index.ts` |
| 6-digit number assignment, ringing, accept/reject, mesh room management, busy detection | shipped | `server/relay.ts` (`handleMessage`) |
| Short-lived HMAC-SHA1 TURN credentials when `TURN_SECRET` + `TURN_HOST` are set | shipped | `server/relay.ts` (`iceServers()`) |
| Free public TURN fallback (`openrelay.metered.ca`) layered on top of Google STUN | shipped | `server/relay.ts` |
| WebRTC mesh client (max 6, glare-free — only newcomer sends offers) | shipped | `client/src/lib/relayClient.ts` |
| In-call text chat over WebRTC data channels | shipped | `client/src/lib/relayClient.ts` |
| Per-peer connection-state indicators, auto-ICE-restart on failure | shipped | `client/src/lib/relayClient.ts` |
| Diagnostics overlay (`?` key) with per-peer ICE/conn/gather/signaling state + rolling event log + Copy button | shipped | `client/src/lib/relayClient.ts`, markup in `Relay.tsx` |
| Front/back camera flip (`facingMode: user` ↔ `environment`) with `RTCRtpSender.replaceTrack` (no renegotiation) | shipped | `client/src/lib/relayClient.ts` (`flipCamera`) |
| Snapchat-style live filter dock (color filters via canvas filter, background blur via MediaPipe Selfie Segmentation, face overlays via MediaPipe Face Detector) | shipped | `client/src/lib/mediaPipeline.ts` |
| Glassmorphic redesigned in-call control bar | shipped | `client/src/pages/Relay.tsx` (CSS in template literal) |
| Vitest suite (signaling, persistent-rejoin, conference-history, active-speaker layout, filters, auth, v2 routers, DND, passcode, biometric, geo, recording, inbound-email, contacts, groups, mute, typing, auto-update, auto-PiP, …) | **379 passing / 1 skipped** | `server/**/*.test.ts`, `client/src/lib/**/*.test.ts`, `client/src/app/**/*.test.ts`, `client/src/pages/**/*.test.ts` |

### v2.0 phone-app surface (added 2026-05-30)

| Area | Status | Where |
|---|---|---|
| Drizzle schema: `identities`, `presence`, `contacts`, `conversations`, `conversation_participants`, `messages`, `attachments`, `call_history`, `signaling` | shipped | `drizzle/schema.ts` |
| Unified context resolver (OAuth user OR guest cookie → `ctx.identity`) | shipped | `server/_core/context.ts` |
| Guest sessions with 30-day HttpOnly `relay_guest` cookie, 6-digit number allocation | shipped | `server/v2routers.ts` (`v2AuthRouter`) |
| Directory: lookup by number, presence heartbeat, go-offline beacon | shipped | `server/v2routers.ts` (`v2DirectoryRouter`) |
| Contacts CRUD + favorites | shipped | `server/v2routers.ts` (`v2ContactsRouter`) |
| SMS-style messaging: threads, messages, sendText, sendAttachment, markRead, **reply/quote**, **unsend**, **typing indicators**, **per-conversation mute**, **group threads**. Realtime via SSE push (`/api/v2/events`) + polling fallback. | shipped | `server/v2routers.ts` (`v2MessagesRouter`), `server/v2events.ts` |
| Attachment upload `POST /api/v2/upload` (base64 body, 40 MB cap, writes via `storagePut`) | shipped | `server/v2upload.ts` |
| Call history (start/end) — independent of the legacy in-memory signaling | shipped | `server/v2routers.ts` (`v2CallsRouter`) |
| Stale-presence reaper (60s sweep, 2 min timeout) | shipped | `server/_core/index.ts` (setInterval) |
| DB helpers (Drizzle queries) | shipped | `server/v2db.ts` |
| App shell: mobile bottom-nav, desktop sidebar, sticky header with number + Upgrade button | shipped | `client/src/app/AppShell.tsx` |
| Onboarding gate: name-entry form before entering `/app/*` | shipped | `client/src/app/OnboardingGate.tsx` |
| Identity hook: whoami + 30s heartbeat + pagehide go-offline | shipped | `client/src/app/useIdentity.ts` |
| Dialer tab: fluid responsive 3×4 keypad + dialed echo + presence preview + recent calls | shipped | `client/src/pages/app/Dialer.tsx` |
| Messages tab: thread list, conversation view, emoji picker, image/video/audio/file attachments, voice-note recording, read receipts | shipped | `client/src/pages/app/Messages.tsx` |
| Contacts tab: search, sort, presence dots, last-seen, favorite, edit/delete, inline message+call | shipped | `client/src/pages/app/Contacts.tsx` |
| Design spec (OKLCH dark palette + responsive sizing rules) | shipped | `design/v2-spec.md`, generated by `scripts/gen-design-spec.mjs` via `gemini-flash-latest` |

**Known gaps in v2.0 (carry into v2.1):**
- The legacy `/app/call` Relay component does **not** read the guest cookie — users still have to type a name when entering the actual call session. Wiring the cookie into the embedded HTML/JS is a deferred port.
- Messaging is **polling-based**, not WebSocket push. Typing indicators are not implemented. The `signaling` table is created for the eventual DB-backed signaling mailbox but not yet used.
- Avatar upload UI is a placeholder (DB column exists).
- The OAuth upgrade flow migrates the guest's number into the user row, but no end-to-end vitest covers it yet (only shape/validation tests cover v2 routers).
- No vitest coverage yet for message send/read/unread, attachment roundtrip, or presence transitions. The 8 new tests in `server/v2routers.test.ts` cover the pair-key helper, validation, and whoami shape only.

The full history of features and bugs lives in `todo.md` at the repo root; check it before you start a change so you don't redo work or relitigate a closed bug.

---

## Architectural decisions (and why)

These are decisions that look unusual but were made deliberately. Don't undo them without reading the rationale.

### 1. Signaling uses Server-Sent Events + HTTP POST, not WebSocket

The original RELAY zip the user uploaded used a `ws` WebSocket server. That works on a VPS but **does not work behind the Manus production gateway (Cloudflare + Cloud Run)** for arbitrary paths — WebSocket upgrade requests get downgraded and our server returns the SPA's HTML instead. We replaced the transport with **GET `/api/relay/stream` (SSE) for server → client** and **POST `/api/relay/send` for client → server**. Both are standard HTTP and route through the gateway cleanly. The protocol semantics (`register`, `invite`, `accept`, `reject`, `signal`, `leave`, `room`, `peer-joined`, `peer-left`, `bye`, `busy`) are unchanged.

> Don't switch back to WebSocket. If you need bidirectional, extend the SSE+POST envelope.

### 2. The calling UI is a React route, not standalone HTML

We originally served the unmodified `index.html` / `app.js` from `client/public/relay/`. In production, Manus's Space Editor injects a `<manus-content-root>` Web Component and a Space Editor script that interferes with the global scope of plain HTML pages — `connectWS` ended up `undefined` on the global object, so the page stayed stuck on "Connecting…". The fix was to port the markup + CSS + behavior into a real React component (`client/src/pages/Relay.tsx` mounts the markup via `dangerouslySetInnerHTML` once; `client/src/lib/relayClient.ts` runs the WebRTC logic via `useEffect`). The Space Editor leaves React routes alone.

> If you need to add a new page, make it a React component under `client/src/pages/` and register the route in `client/src/App.tsx`. Don't add raw HTML to `client/public/`.

### 3. The local camera goes through a canvas processing pipeline

`client/src/lib/mediaPipeline.ts` takes the raw `getUserMedia` track, paints each frame into a hidden `<canvas>` (applying CSS-filter color grading, MediaPipe-segmented background blur, and MediaPipe-detected face overlays), and republishes the canvas as a `MediaStream` via `canvas.captureStream(30)`. The processed stream is what's sent to peers; we hot-swap the track on every peer via `RTCRtpSender.replaceTrack` whenever the user picks a different filter or flips the camera — **no SDP renegotiation needed**, so it's silent on the wire.

MediaPipe models (selfie segmenter, face detector) are **lazy-loaded** — only fetched the first time a filter that needs them is picked. Don't preload them at app boot.

### 4. Outgoing video is never mirrored; local self-preview is mirrored only on the front camera

The outgoing canvas stream is the source of truth and is never flipped. CSS mirrors the **local self-tile** only when the front camera is active (so movements feel natural to you); the back camera and the remote tiles always show the true orientation.

### 5. In-memory state in `server/relay.ts` only survives within one Cloud Run instance

Channels (`channels: Map<cid, RelaySocket>`) and peer registry (`peers`, `rooms`) live in memory. Cloud Run scales to zero with `min-instances=0` and can spin up additional instances at low traffic. We've seen this work in practice because RELAY's traffic is so low that one instance is typically warm. **If you add a feature that needs multi-instance coordination, externalize the state to MySQL (already wired) or a Redis-like store.** Don't pretend the in-memory map is durable.

---

## Where things live

```
relay-chat-video/
├── client/
│   ├── public/                      ← favicon, robots.txt, RELAY-README.md (docs page source). NO source code.
│   └── src/
│       ├── App.tsx                  ← Wouter routes: /, /app, /docs, /404
│       ├── main.tsx                 ← Providers; don't edit
│       ├── index.css                ← Tailwind + global tokens
│       ├── pages/
│       │   ├── Home.tsx             ← landing page
│       │   ├── Relay.tsx            ← calling UI (markup + scoped CSS template literal)
│       │   ├── Docs.tsx             ← markdown-rendered README
│       │   └── NotFound.tsx
│       ├── lib/
│       │   ├── trpc.ts              ← tRPC client (don't edit)
│       │   ├── relayClient.ts       ← WebRTC mesh client, SSE transport, diag overlay
│       │   ├── mediaPipeline.ts     ← canvas filter pipeline (color / blur / face overlays)
│       │   └── mediaPipeline.test.ts
│       └── _core/, components/, hooks/, contexts/  ← framework plumbing; avoid editing
├── server/
│   ├── _core/                       ← framework plumbing; avoid editing
│   ├── relay.ts                     ← signaling server (HTTP transport, peer registry, TURN creds)
│   ├── relay.test.ts                ← vitest for protocol
│   ├── routers.ts                   ← tRPC procedures (auth + features). Currently only auth + system.
│   ├── db.ts                        ← Drizzle helpers
│   ├── storage.ts                   ← S3 helpers
│   └── auth.logout.test.ts          ← scaffold test
├── drizzle/
│   ├── schema.ts                    ← MySQL tables (users only; extend as needed)
│   └── migrations/
├── shared/                          ← constants/types shared between client and server
├── todo.md                          ← living feature + bug log; update on every change
├── README.md                        ← template README (extensive — read once)
├── CLAUDE.md                        ← this file
└── package.json
```

---

## Build & run loop

```bash
pnpm install              # install
pnpm dev                  # NODE_ENV=development tsx watch server/_core/index.ts (serves React + tRPC + relay on port 3000)
pnpm test                 # vitest run (379 tests)
pnpm check                # tsc --noEmit
pnpm format               # prettier --write .
pnpm db:push              # drizzle-kit generate && drizzle-kit migrate
pnpm build                # vite build (client) + esbuild bundle (server) → dist/
pnpm start                # NODE_ENV=production node dist/index.js
```

**Cloud Run constraints**: Node-only build image, 1 vCPU, 512 MiB RAM, 180s request timeout, min-instances=0 (cold starts). No Python, no native binaries beyond what npm ships. The signaling SSE connection is long-lived; Cloud Run is fine with this within the 180s window (and we send a ping every 25s).

---

## Environment variables (all injected by Manus, do NOT commit `.env`)

`DATABASE_URL`, `JWT_SECRET`, `VITE_APP_ID`, `OAUTH_SERVER_URL`, `VITE_OAUTH_PORTAL_URL`, `OWNER_OPEN_ID`, `OWNER_NAME`, `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`, `VITE_FRONTEND_FORGE_API_KEY`, `VITE_FRONTEND_FORGE_API_URL`, `VITE_APP_TITLE`, `VITE_APP_LOGO`, `VITE_ANALYTICS_ENDPOINT`, `VITE_ANALYTICS_WEBSITE_ID`.

**RELAY-specific** (optional; set when operator has their own coturn):
- `TURN_SECRET` — same `static-auth-secret` as the coturn instance
- `TURN_HOST` — public hostname/IP of coturn (port 3478)

These are read **per-call** in `iceServers()` so they can be added without restarting the process.

**Multi-device ring** (optional, **experimental**; one number rings all signed-in devices):
- `MULTI_DEVICE_RING` — `1`/`true` to enable. **Default OFF**, and the off-path is byte-identical to the historical single-device behavior (a 2nd device on the same number evicts the 1st). When ON, multiple devices share a number, an incoming call rings every idle device, the first to accept wins (the rest get an "answered elsewhere" `ring-cancel`), and in-call signaling routes to the accepting device. Needs real 2-device testing before relying on it. Read per-call from `multiDeviceEnabled()` in `server/relay.ts`.

**LiveKit SFU** (optional; enables professional 10-way calls + recording-ready media). When all three are set, call media routes through the LiveKit SFU instead of the WebRTC mesh; when unset, RELAY falls back to the mesh (≤6 comfortably). Read per-call like `TURN_*`:
- `LIVEKIT_URL` — `wss://` project URL of the LiveKit SFU
- `LIVEKIT_API_KEY` — LiveKit project API key
- `LIVEKIT_API_SECRET` — LiveKit project API secret (server-only; HMAC key for all grants; **never** sent to the browser — only short-TTL join JWTs are)

**Recording** (optional; LiveKit Egress → S3. Requires LiveKit above AND all four S3 vars. Records a room-composite grid MP4 straight to the operator's bucket — bytes never touch this server. Read per-call like `LIVEKIT_*`):
- `RECORDING_S3_BUCKET`, `RECORDING_S3_REGION`, `RECORDING_S3_ACCESS_KEY`, `RECORDING_S3_SECRET` — all four required to enable. When set, the in-call **Record** button appears and a "● REC" indicator shows for every participant.
- `RECORDING_S3_ENDPOINT` (optional) — custom endpoint for non-AWS S3 (Cloudflare R2, MinIO, …).
- `RECORDING_S3_PREFIX` (optional) — key prefix, default `recordings/`.
- `RECORDING_S3_FORCE_PATH_STYLE` (optional) — `1`/`true` for R2/MinIO.

**Email** (optional; missed-call notifications via Resend):
- `RESEND_API_KEY` — enables outbound email. Without a DNS-verified sending domain, Resend test mode only delivers FROM `onboarding@resend.dev` TO the account owner's address.
- `RESEND_FROM` — sender; defaults to `onboarding@resend.dev`. Set to a verified-domain address (e.g. `RELAY <notifications@your-chat.org>`) to email arbitrary registered users.
- `APP_URL` — base URL used in email links; defaults to `https://www.your-chat.org`.

**Inbound email** (optional; reply to a RELAY notification from your inbox and it posts into the thread). When set, missed-call emails get a SIGNED `Reply-To` (`relay+{convId}.{identityId}.{hmac}@domain`); the operator points an inbound provider (Resend Inbound) at `POST /api/email/inbound`. Replies are bound to the mailbox owner (the email `From` must match the signed identity's registered address):
- `INBOUND_EMAIL_DOMAIN` — enables the feature, e.g. `inbound.your-chat.org`. Add the provider's MX records for this domain + a route/webhook to `https://<app>/api/email/inbound`.
- `INBOUND_EMAIL_LOCALPART` (optional) — default `relay` (the part before `+`).
- `INBOUND_EMAIL_SECRET` (optional) — HMAC key for the reply-address signature; falls back to `JWT_SECRET`.
- `INBOUND_EMAIL_WEBHOOK_SECRET` (optional, recommended) — the provider's Svix signing secret (`whsec_…`) to verify webhook authenticity.

---

## Coding conventions

1. **tRPC-first** for any new HTTP feature. Don't introduce `axios` or `fetch` wrappers in `client/src/` — use `trpc.feature.useQuery()` / `useMutation()`. Exception: the SSE/POST relay endpoints, which are deliberately raw HTTP because tRPC doesn't model long-lived streams well.
2. **Optimistic updates** for list ops, toggles, profile edits (`onMutate` → `onError` rollback). Use `invalidate` only for critical operations (payments, auth).
3. **shadcn/ui** components for any new UI primitive (`@/components/ui/*`); compose with Tailwind utilities. Avoid bespoke CSS.
4. **Stable query inputs** — never pass `new Date()` or fresh array literals as tRPC query inputs. Use `useState(() => new Date())` or `useMemo`. (See `README.md` "Common Pitfalls" → "Infinite loading loops from unstable references".)
5. **File storage** — use `storagePut(key, bytes, mime)` in `server/storage.ts`. Save the returned `key` in MySQL; don't store bytes in the DB.
6. **Animation discipline** — 100–300ms, ease-out for entering UI, ease-in-out for moving. Never animate `width/height/padding/margin/top/left`; only `transform` and `opacity`. Add `@media (prefers-reduced-motion: no-preference)` gates around non-essential motion.
7. **Auth** — use `useAuth()` for current user state; never read cookies directly. `getLoginUrl()` from `client/src/const.ts` for login redirects.
8. **OAuth redirect URLs** — always use `window.location.origin`. Never hardcode `manus.space` domains or build URLs from env vars.
9. **Datetime** — store as UTC Unix ms in the DB; convert in React via `new Date(ts).toLocaleString()`.
10. **Logs** — `.manus-logs/devserver.log`, `browserConsole.log`, `networkRequests.log`, `sessionReplay.log`. Don't read these as text files; use grep/tail.

---

## Testing

Vitest runs Node-environment tests under `server/**/*.test.ts` and `client/src/lib/**/*.test.ts` (see `vitest.config.ts`). New features must come with tests — focus on protocol shapes, business logic, and pure functions. Browser DOM tests are not currently configured; UI is verified via manual preview.

> Run `pnpm test` before every checkpoint / PR. All 379 must stay green.

---

## Deploying

Manus deploys via the **Publish** button in the Management UI. Before publish, create a checkpoint (the Publish button is disabled without one). The latest checkpoint is what publishes.

There is **no Vercel, Netlify, Railway, or Render involved** — Manus has its own hosting layer. If asked to deploy elsewhere, warn the user about compatibility before proceeding.

---

## What to be careful about

1. **Don't refactor `server/relay.ts`'s in-memory maps into a database** unless you also implement durable cross-instance routing — the simple design relies on single-instance affinity that Cloud Run usually provides.
2. **Don't add SSR / Next.js** — this is a Vite SPA + Express server. Different framework.
3. **Don't add WebSocket** anywhere user-facing — production gateway won't pass the upgrade. Use SSE+POST or long-polling.
4. **Don't preload MediaPipe models** — they're ~3 MB each and most users won't use filters.
5. **Don't mirror the outgoing video** — only mirror the local self-preview on front camera, never the published stream.
6. **Don't bypass `RTCRtpSender.replaceTrack`** when changing the local track — replacing the stream object entirely forces a renegotiation that drops media for ~1s.
7. **Don't commit secrets** — `.env*` is in `.gitignore`. Use `webdev_request_secrets` in Manus or `Settings → Secrets` in the Management UI.
8. **Database changes** are not auto-reversible. Use `pnpm db:push` only after reviewing the generated SQL in `drizzle/migrations/`.

---

## Pending work / future ideas

These are noted but not yet implemented. If you pick one up, mark it in `todo.md` first.

- Persist a user's assigned 6-digit number + recents in `localStorage` so refreshes keep identity.
- Add a "Mic / Camera test" panel before registration so users confirm permissions before joining.
- Add a real-device test matrix (Safari iOS, Chrome Android, Firefox desktop) for the camera-flip + filter pipeline.
- Consider replacing the free TURN fallback with a self-hosted coturn once usage grows beyond what `openrelay.metered.ca` rate-limits comfortably.
- Add screen sharing via `getDisplayMedia` (no signaling changes needed; same `addTrack` flow).

---

## Working with the user

The user prefers:
- **Concise, honest progress updates** — no exaggeration ("perfect", "fully bug-free"); just specific, testable claims.
- **Versioned footer on every deploy** — bump the version string in `Relay.tsx` (`RELAY · v1.2.0`) on every shipped change.
- **Direct deployment to the live server** when possible — keep iteration cycles tight.
- **System-wide application** — when fixing a bug or adding a feature, apply it consistently across the codebase, not just where the bug surfaced.

---

*This file is the contract between the codebase and any agent contributing to it. Keep it accurate. When you ship a change, update the relevant section here and in `todo.md` in the same commit.*
