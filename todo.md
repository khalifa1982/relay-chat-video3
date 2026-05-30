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
