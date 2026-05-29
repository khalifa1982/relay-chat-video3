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
- [ ] Verify with two real devices that camera flip works on phone, filters render smoothly, and remote peer receives the filtered stream (requires user verification on real devices)
