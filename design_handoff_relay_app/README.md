# Handoff: Relay App Redesign — Full Screen System

## Overview
Complete visual redesign of the Relay web app (`your-chat.io/app`, repo `khalifa1982/relay-chat-video3`, branch `main`, app code under `client/src`). It extends the already-shipped login redesign (see sibling `design_handoff_relay_login/`) across **every** in-app surface: 34 frames covering tabs, call screens, overlays, dialogs, and system alerts. Theme: dark glass ("smaller than Apple" density), one **cycling accent color**, and the live 3D canvas background running behind every screen.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, NOT production code to copy directly. The task is to **recreate these designs inside the existing codebase** (React 18 + Vite + Tailwind + wouter, `client/src`) using its established patterns: keep existing routes, state, RelayEngine call logic, and data flow; change only presentation and add the small bits of UI state described below. The repo already renders a `RelayBackground` canvas on the login screen — this handoff extends it app-wide.

`Relay App Redesign.dc.html` is a **design board**: one big canvas with all 34 phone/desktop frames side by side, each labeled with a badge id (1a…4k). Open it in a browser and pan/zoom. `relay-bg.js` is the reference implementation of the shared background engine (plain JS, framework-free) — port it into `client/src/lib/relayBackground.ts`, replacing/extending the login-only version.

## Fidelity
**High-fidelity.** Colors, spacing, radii, typography, icon shapes, and copy are final. Recreate pixel-perfectly with the codebase's existing stack (Tailwind utilities / CSS vars). Fonts: Space Grotesk (UI) + IBM Plex Mono (numbers, timers, section labels, PINs) — already used by the shipped login page.

## Global Design System

### Background engine (`relay-bg.js` → port to `relayBackground.ts`)
- One shared `requestAnimationFrame` loop drives N canvases (one per mounted screen; in production: ONE fixed fullscreen canvas behind the app shell, `position:fixed; inset:0`).
- Layers per frame: near-black fill `#04070a`; two radial accent glows (top ~10% alpha, bottom ~13%); ~30 twinkling stars; a flow-field particle swarm whose attractor wanders the WHOLE viewport (Lissajous path, both axes); a "yuruyurau" polar particle vortex whose center also wanders. Nothing is pinned to one spot — the animation drifts everywhere.
- **Accent cycling**: palette of 12 hues `['#35e0b4','#3ec9e8','#4f9df5','#7c8cf8','#a78bfa','#d174e8','#f472b6','#fb7185','#f97362','#f59e4b','#e8c94a','#8fd94f']`; a new random hue every **9.5s**, faded toward at rate `1−(1−.0055)^(dt/16.7)` per frame (imperceptible — user must never notice a switch). The loop writes the current color to CSS vars on `<html>`: `--rb` (rgb string) and `--rb-rgb` ("r,g,b"). ALL accent-colored UI uses `var(--rb)` / `rgba(var(--rb-rgb),α)` so the whole app breathes together.
- Auto-degrade: if frame time >38ms persistently, dim/lighten particle load (see `globalDim` in source).
- Tweakables shipped in the prototype: cycle on/off, global intensity 0.3–1.5.

### Glass surface recipe
- Card: `background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015))`; `border:1px solid rgba(255,255,255,.09)`; `box-shadow:inset 0 1px 0 rgba(255,255,255,.08)`; radius 14–16px (rows), 20–24px (sheets/dialogs), 28px (bottom sheets).
- Elevated sheet/dialog: `linear-gradient(180deg,rgba(15,21,25,.96),rgba(8,12,15,.98))` + `border rgba(255,255,255,.13)` + `box-shadow 0 24px 70px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.14)`.
- Bars (top/bottom/composer): `rgba(8,12,14,.4–.55)` + `backdrop-filter:blur(14–18px)` + hairline `rgba(255,255,255,.07)`.
- Accent fill chip/button: `background:rgba(var(--rb-rgb),.14)` + `border rgba(var(--rb-rgb),.4)`; primary CTA: solid `var(--rb)`, text `#04211a`, `box-shadow 0 10px 30px rgba(var(--rb-rgb),.4), inset 0 1px 0 rgba(255,255,255,.35)`.
- Scrim over canvas per screen: `radial-gradient(closest-side at 50% 40%, rgba(4,7,10,0) 50%, rgba(3,6,8,.55–.62))`; modal screens add `rgba(2,4,6,.5–.66)` + `backdrop-filter:blur(2–4px)`.

### Type & color tokens
- Text: primary `#eafff6`, body `#e8efec`, secondary `#9fb0ab`/`#8ea09b`, muted `#7d8f8a`, faint `#68797c`/`#5c6b67`.
- Danger: `#fb5560`/`#fb7185` (+ `#ffd6db` text); success/online dot `#3ddc84`; warn/busy `#e8c94a`.
- Mono labels: 8.5–11px, letter-spacing .14–.26em, color `#8fa39d`/`#68797c`, UPPERCASE.
- Peer identity colors: avatar gradient `linear-gradient(135deg, hsl(H 65% 62%), hsl(H+45 70% 42%))`, one fixed hue H per user (Layla 158, Marcus 208, Amira 282, Jonas 28, Dana 330, Yusuf 58, group crew 190, self 165). Group-chat sender names use `hsl(H 80% 72%)`.

### Badge system (role verification) — REQUIRED EVERYWHERE
Starburst badge (path in every frame; 9–15px depending on context) next to **every displayed user name**, colored by role:
- **Guest = blue `#4f9df5`**, **Registered = green `#22c55e`**, **Admin = gold `#e8c94a`**.
- Locations: contact/history/thread/member/picker/notification rows, chat headers, group sender labels, call screens (incoming/outgoing/in-call chip), group-call tiles, media viewer, toasts, profiles, desktop sidebar. Board top-left shows the legend.
- Role source: `users.role` (`guest`/`registered`/`admin`) — guests get badges too (blue), so "verified" ≠ badge; badge = identity type.

### Story ring + status (everywhere an avatar appears)
- Active story: 2–2.5px accent ring `box-shadow:0 0 0 2.5px var(--rb)` + slow flash `@keyframes rring{0%,100%{opacity:1}50%{opacity:.15}}` 2.6s ease-in-out infinite. Seen story: static `rgba(255,255,255,.2)` ring.
- Presence dot (bottom-right of avatar, 9–11px, 2px `#060a0c` border): online `#3ddc84`, busy/on-call `#e8c94a`.
- User status text (separate from story): short free text + colored dot, e.g. "Free — back at 3pm", shown in profile chip, peer profile, contact rows (`st`/dot), chat header ("online · Free · 219-406").

### Standard call bar — NEVER REDUCED
Every call surface (voice, video, group, outgoing/ringing) shows the same 6 controls, in order: **mute · camera · flip · speaker · chat · end** (end = red pill 56×50, others 50px glass circles `rgba(255,255,255,.14)` + `backdrop-filter:blur(14px)`; active-accent state = solid `rgba(var(--rb-rgb),.85)` with dark icon).

### Bottom tab bar (mobile)
5 tabs: **Calls · History · Messages · Groups · Contacts** (Groups sits between Messages and Contacts; icon = 2×2 dots). Active tab: 40×25 pill `rgba(var(--rb-rgb),.17)` + glow, label `var(--rb)` 700. Badges: History = red count (missed), Messages = accent count (unread). Bar: hairline top border, `linear-gradient(180deg,rgba(10,14,16,.55),rgba(5,8,10,.85))`, blur 18px, padding 6px 4px 18px.

## Screens (badge ids on the board)
Each frame = 390×812 phone (46px radius bezel) unless noted. Desktop frames 1200×786.

- **1a Dialer (Calls tab)** — top bar: RELAY logo + ONLINE, centered self name+badge+number `842-317`, bell + avatar (story ring). "MY NUMBER" glass card with copy/QR/share buttons. Typed number readout (mono 32px) + live contact match hint. 3×4 circular glass keypad (aspect 1, letters under digits), actions row: Video 50px / **Call 66px solid accent** / Group 50px. Keypad max-width 310px centered.
- **1b History** — title + search/trash icons; filter chips All/Missed/Incoming/Outgoing; day headers (mono, .26em); rows: avatar(+ring/presence) · name+badge · direction arrow (green in/out, red missed `#fb7185` + name `#ffd6db`) + duration · time + call-back icon. One row shown mid-swipe **left** revealing message/call-back actions (see Interactions).
- **1c Messages** — title + compose; horizontal **stories strip** (54px avatars: "My story" dashed ring + plus, unseen = flashing accent ring, seen = grey); search field; thread rows: avatar+ring+presence · name+badge (+pin/mute icons) · preview or typing indicator (3 bouncing dots + "typing") or ✓✓ ticks (accent = read, grey = delivered) · time + unread pill. Includes group thread (Design Crew) and "Notes to yourself" (bookmark avatar). One row mid-swipe showing pin/mute/delete.
- **1d Conversation** — header: back, avatar(ring+presence), name+badge, "online · Free · 219-406", video + call buttons. "END-TO-END ENCRYPTED" center chip + TODAY divider. Bubbles: incoming glass 16/16/16/5 radius; outgoing `rgba(var(--rb-rgb),.15)` + border .35, radius 16/16/5/16; mono timestamps inside; ✓✓ ticks. Voice-note bubble (play circle accent, 18-bar waveform, 0:19). Photo bubble (215×118 img + caption). Typing bubble. Composer: emoji circle · field "Message" + attach clip · **mic** accent circle (swaps to send when text).
- **1e Contacts** — title + "Add by PIN" accent chip; search; A–Z headers (accent letter); rows: avatar+presence · name+badge · mono PIN · 3 quick actions (chat/video/call, call = accent chip).
- **1f Profile** — 84px avatar + flashing story ring + presence; name+gold badge; number + copy/QR; status chip ("Free — back at 3pm"); hub rows (34px accent icon tiles): Contact info, Links & social, Status & story, Appearance ("Dark · cycling accent"), Notifications, Devices (2 active), Privacy & security (Passcode+FaceID, E2E) — each with chevron; red glass Sign out row.
- **1g Incoming call** — full-bleed background (intensity 1.3); "RELAY · ENCRYPTED" chip; 118px avatar with **two staggered ping rings** (2.2s); name 25px + badge; number · "Video call"; "ringing…" pulsing; "Reply with a message" glass chip; Decline (red 64px, rotated phone) / Accept (accent 64px + ping) with labels, 84px apart.
- **1h In-call video** — remote video area (gradient placeholder + giant initials watermark); top chip: name + green badge + mono timer (`{{ callTimer }}` live) + lock icon; signal bars chip. Self PiP 92×126 bottom-right (16px radius, "YOU"). **Standard 6-button call bar**.
- **1i Desktop dialer** — 280px sidebar: logo, self card (avatar ring, name+gold badge, number, 🇦🇪, "Desktop" chip), nav rows (Calls active accent, History +red badge, Messages +accent badge, Groups, Contacts), Dark/Light segmented control, Sign out. Main: MY NUMBER card, 38px readout, 74px keypad circles, Video/Call/Group row.
- **1j Desktop messages** — 88px icon rail (logo, 4 tabs with badges, avatar+ring at bottom) · 360px thread list (same rows as 1c + badges) · chat pane (header with name+badge, "online · 219-406 · end-to-end encrypted", video/call; bubbles max-width 420px; composer with send accent circle).
- **2a Group call (conference)** — header chip "Design Crew · 32:12 · 🔒", participants count chip (8). **2×4 grid fits up to 8**: each tile = peer-hue gradient (their "profile image as background") + big initials watermark; speaking tile = accent border + inner glow; camera-off tile = dark bg + centered avatar + "CAMERA OFF"; per-tile flags: pinned pin, weak-signal bars, "YOU" tag; name chip bottom-left (name + badge + mic-muted icon). Standard call bar below.
- **2b Voice call** — big avatar + flashing ring, name+badge, number, live waveform bars, mono timer, encrypted chip, standard call bar.
- **2c Story viewer** — full-bleed gradient story, top progress segments, author row (avatar+ring, name+badge, "2h ago"), reply field + heart/send, tap zones L/R.
- **2d Notification center** — glass sheet; rows with type icons (missed call red, message accent, story, system), name+badge, preview, mono time; "Mark all read".
- **2e Register sheet** (in-app upsell) — bottom sheet: "Keep this number forever", email field, Private/Business toggle (Business = gold "SOON" chip), benefits list, accent CTA.
- **2f Voicemail** — rows: avatar, name+badge, waveform + duration, play button accent, transcript preview 2 lines, mono time.
- **2g Passcode lock** — logo, "Enter passcode", 4 dots (2 filled accent), glass keypad, Face ID icon, "Forgot?".
- **2h Admin console** — gold-accented: stats tiles (users/guests/calls/messages), user rows with role badges (gold/green/blue) + role tags, actions (verify/suspend), search. Gold replaces accent for CTAs here.
- **2i Group info** — group avatar 74px, name, "5 members · 3 online", E2E chip; member rows: avatar+presence · name+badge · PIN · role tag (OWNER gold / ADMIN / blank); rows: mute, wallpaper, invite link (relay.app/g/…), Locked-group PIN toggle (gold lock), leave (red).
- **3a Calling (outgoing) — matrix digits** — like 1g but outgoing: dialed number shown as 6 mono tiles that **scramble matrix-style** (random digits flicker at ~140ms while `flick>0`, settling to the real digit with accent glow `text-shadow 0 0 14px`), whole row **heartbeats** (`@keyframes rbeat` scale 1→1.16→1.02→1.09→1, 1.9s); "LINE SECURED — KEYS EXCHANGED" mono line; standard call bar (end = Cancel).
- **3b Contact categories** — chips All/VIP/Family/Friend/Team; sections with icon+count+online: **ONLINE** (accent), **FAVORITES** (gold star), **FAMILY** (pink `#f9a8d4`), **FRIEND** (blue `#93c5fd`), **TEAM** (violet `#c4b5fd`); rows carry VIP/FRIEND tag chips, presence dots incl. busy, one "blocked" red note (Rami); category header colors tint their icons.
- **3c Group conversation** — sender-colored names + badges, reply-quote block (accent left border), @mention accent bold, "seen by 4", typing row "Dana is typing", group header "5 members · 3 online".
- **3d New group** — bottom sheet: Direct/**Group** segmented; GROUP NAME field (focused, accent ring); selected-member chips (accent, x to remove); ADD MEMBERS search; picker rows with status + accent check circles; CTA "Create group · 4 members".
- **4a Peer profile** (tap any avatar) — centered glass card: 92px avatar+ring+presence, name+badge 22px, PIN accent, status chip, one-line bio, social chips (@handle, site), 3 action tiles (Message accent / Video / Voice), category chips (VIP ✓ gold, Family, Friend, Team — tap to assign), Block · Report · Close footer.
- **4b Story composer** — full-bleed gradient bg picker (5 swatches), 26px centered text + caret, text/camera tools, audience chip "My contacts · 24h", accent "Post story" pill.
- **4c Message actions** — long-press state: reaction bar (❤️👍😂😮😢 +), highlighted bubble, glass menu: Reply/Copy/Forward/**Message info** (Delivered 10:04:12 grey ✓✓, Read 10:05:40 accent ✓✓)/Delete for me/Remove for everyone ("15 MIN WINDOW" mono note).
- **4d Voice note recording** — composer swaps to red recording pill: pulsing dot, mono 0:12, live waveform, "‹ slide to cancel", delete circle left, send accent circle right.
- **4e Media viewer** — black fullscreen, photo center, top bar (sender name+badge, "Today 10:16", download/menu), caption + "MEDIA IS END-TO-END ENCRYPTED" footer.
- **4f Share my number** — card: MY RELAY NUMBER + 30px accent number, white QR tile (150px, finder squares), Share (accent) / Copy buttons, rows: "Choose your RELAY number" (accent pencil) and "Generate a new 6-digit number" (gold refresh, warning subtext).
- **4g Guest restore** — glass card: sparkle icon, "Welcome back", explainer, session row (avatar, name + **blue guest badge**, "842-317 · guest", "2 DAYS AGO"), CTA "Restore my session" + "Start fresh".
- **4h Group invite** — landing card: 74px group avatar, "YOU ARE INVITED TO JOIN", group name, overlapping member avatars + count, E2E chip, accent join CTA, note about picking a display name.
- **4i Locked group** — group avatar + gold lock puck, "This group is locked", 4 PIN dots (2 filled gold), glass keypad (gold hover), footer note "Locked groups never show previews".
- **4j Video message** — camera view, REC chip (red dot + mono 0:07 / 1:00), progress hairline, gallery thumb · white shutter ring with red square · send accent circle.
- **4k System alerts** — push-permission banner (bell, Enable accent); message toast (avatar+ring, name+badge, Reply chip); update dialog (v2.106.0, Refresh now / Later); sign-out confirm (red-tinted, "Guest numbers are not recoverable…", Cancel / red Sign out).

## Interactions & Behavior
- **Swipe rows** (already implemented in app — keep gestures, restyle): History row swipe-left → message + call-back (green); Messages row swipe-left → pin (accent) / mute (gold) / delete (red); action pucks 40px, 13px radius, revealed bg `rgba(255,255,255,.02)`.
- **Matrix dial digits** (3a): per-tile `{digit, flick}`; every 140ms each settled tile has 9% chance to start flicking for 2–5 ticks showing random digits (white, 75% opacity, plain border), then settles (accent, glow). Row heartbeats 1.9s. Stop scramble on connect.
- **Live stats/timers**: call timer ticks 1s (mono, accent); typing dots `rtyp` 1.2s staggered; pings `rping` 2.2–2.4s; status pulse `rpulse`.
- **Keypad**: hover `rgba(var(--rb-rgb),.12)`, press `scale(.94)` 100ms; typing appends to readout; contact match hint under readout.
- **Tab switches / sheet presents**: sheets slide up (translateY, ~300ms ease); dialogs fade+scale from .97.
- **Story rings** flash only when unseen story exists; tapping avatar opens 4a peer profile; long-press opens story if present.
- **Accent cycling** never pauses; all accent UI follows `--rb` vars automatically.
- **Reduced motion**: respect `prefers-reduced-motion` — freeze canvas to static gradient, disable heartbeat/scramble (show settled digits).

## State Management (additions only)
- `users.role: 'guest'|'registered'|'admin'` → badge color; `users.statusText` + `presence: online|busy|offline`; `stories: {userId, seenBy[]}` → ring state.
- Contact categories: `contact.tags: ['vip'|'family'|'friend'|'team'|'favorite']` + blocked flag (rows + 3b filters + 4a chips).
- Groups: `group.locked` + `pin`; member `role: owner|admin|member`.
- Call state: standard bar flags (muted, camOn, speaker, flipped) + per-participant (speaking, camOff, pinned, signal).
- Background: module-level singleton {color, targetColor, cycleEnabled}; expose `RelayBG.setCycle/setIntensityAll`.

## Design Tokens
- Bg `#04070a`; card gradients above; hairlines `rgba(255,255,255,.07–.14)`.
- Accent = `var(--rb)` (cycling, 12-hue palette above); on-accent text `#04211a`.
- Badges: guest `#4f9df5` · registered `#22c55e` · admin `#e8c94a`.
- Status: online `#3ddc84`, busy `#e8c94a`, danger `#fb5560`/`#fb7185`.
- Radii: 9/11/13px chips-buttons, 14–16 rows, 20–24 cards, 28 sheets, 46 bezel. Spacing: 4/8/12/16/20/24. 
- Type: Space Grotesk 400–700; IBM Plex Mono 400–600; sizes 8.5–38px as specified per screen; mobile hit targets ≥44px.
- Keyframes: `rping`, `rpulse`, `rring`, `rtyp`, `rbeat` (definitions in the DC file `<helmet>`).

## Assets
No raster assets. All icons are inline SVG (24×24 viewBox, stroke 1.8–2.2, round caps) — lift paths directly from the board file. Avatars are initials on hue gradients (until real profile photos exist). QR is decorative placeholder — generate real QR in production.

## Files
- `Relay App Redesign.dc.html` — the 34-frame hifi board (open in browser; badge ids 1a…4k).
- `screenshots/` — reference captures across the board (a-series: 1a Dialer, 1d Conversation, 1g Incoming, 1i/1j Desktop, 2a Group call, 2c Story viewer, 2e Register, 2g Passcode, 2i Group info; b-series: 3a Matrix calling, 3c Group chat, 4a Peer profile, 4c Message actions, 4e Media viewer, 4g Guest restore, 4i Locked group, 4k System alerts). Each shot starts at the named frame; neighbors may appear. The live board is the source of truth — colors cycle, so screenshots freeze one accent hue.
- `relay-bg.js` — shared background engine reference (attach/loop/color-cycling/`--rb` vars).
- `../RELAY_LOGIN_HANDOFF.md` + `../design_handoff_relay_login/` — the earlier login handoff this extends.
- Repo mapping (screen → source file) lives in the project's `github.md` Screen map — key targets: `client/src/pages/app/{Dialer,History,Messages,Contacts,Profile,Status}.tsx`, `client/src/app/{AppShell,TopBar,RelayEngine,PeerOverlays,GroupInfoSheet,GuestRestore,PushBanner,MessagePopups,UpdateChecker}.tsx`, `client/src/pages/app/GroupCallScreen.tsx`, `client/src/lib/relayBackground.ts`.
