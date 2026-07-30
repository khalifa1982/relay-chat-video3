# RELAY — frames still needed

Paste this into Claude Design. It lists only what is **not yet built to its own frame**.

## Status (34 frames)

> **Updated 2026-07-30 (v2.106.21).** Twelve more frames are now built: 2c story viewer ·
> 2d notification center · **2e register sheet** · **the passcode lock** · 3b contact
> categories · 3c group conversation · **3d new group** · 4a peer profile tags ·
> 4c message actions/reactions · 4d voice-note recording · 4e media viewer ·
> 4g guest restore. The two blocked data models from `DATA-CONTRACTS.md` are both built
> (`shared/contactTags.ts`, `shared/reactions.ts` + the `message_reactions` table).
>
> **A NUMBERING COLLISION, named rather than left to be tripped over:** the board's own
> frame labels and the README's Screens list disagree about 2f/2g — the board labels the
> **passcode lock 2f** and the README lists *2f Voicemail / 2g Passcode lock*. The BOARD
> is the source of truth (CLAUDE.md v2.106.11), so the passcode lock ships as 2f and the
> table below, which follows the README, still lists it under 2g. Voicemail is the one
> genuinely outstanding.
>
> Still outstanding: **voicemail** · **2h** admin console · **2i** group info ·
> **4j** video message · plus the 5a–5h state frames.

- **Built to the frame (12):** 1a Dialer · 1b History · 1c Messages · 1d Conversation · 1e Contacts · 1f Profile · 1g Incoming call · 1i Desktop dialer · 2a Group call · 2b Voice call · 3a Matrix calling · 4f Share my number
- **Partial (1):** 1h In-call video
- **System only, layout still needed (21):** everything below

"System only" means the screen already breathes with the cycling accent, carries the glass/sheet
material and the story rings — it just doesn't have this frame's own layout yet.

---

## Rules the new frames must respect

These are already shipped and must not be designed away.

1. **One accent, cycling.** Every accent surface reads `var(--rb)` / `rgba(var(--rb-rgb), α)`. On-accent
   text is `#04211a`. Never a fixed hue.
2. **Dark only.** The live canvas and the glass recipes are dark-scoped. Light theme keeps opaque
   surfaces. Don't design a light variant of these.
3. **Green means ONLINE, and nothing else.** Presence LEDs own green. Don't use it for "active",
   "speaking", "enabled" or a CTA — that's what the accent is for.
4. **Gold means admin / owner / locked.** Don't spend it elsewhere.
5. **Outgoing chat bubbles stay ORANGE.** (You asked for this; it also makes the accent read receipt
   legible.) The board's accent-tinted outgoing bubble is overruled here.
6. **Story rings don't animate.** They render once per row on the densest scrolling list.
7. **The call bar is 11 controls, not 6.** You had me remove in-call controls in v2.99.39; the bar was
   restyled, not reduced. Any frame showing the bar should show it as it is.
8. **No `backdrop-filter` over live video.** Phones get an opaque fill instead.
9. **Hit targets ≥44px.** Phone frames are 390×812.

---

## The 21 frames

### Overlays and sheets

| # | Frame | Repo file | What I need |
|---|---|---|---|
| 2c | **Story viewer** | `pages/app/Status.tsx` | Full-bleed story, top progress segments, author row (avatar+ring, name+badge, "2h ago"), reply field + heart/send, L/R tap zones. Show the **group-story** variant too (a story posted to a group, which we support). |
| 2d | **Notification center** | `app/AppShell.tsx` (bell panel) | Glass sheet. Rows with type icons: missed call (red), message (accent), story, system. Name+badge, preview, mono time. "Mark all read". Also: the **empty** state, and the **pending device-approval** row (Approve / Decline). |
| 2e | **Register sheet** | `app/AuthPanel.tsx` | Bottom sheet: "Keep this number forever", email field, Private/Business toggle (Business = gold "SOON"), benefits list, accent CTA. Needs the **"this email already has an account → Log in"** state too. |
| 2f | **Voicemail** | `app/VoicemailPrompt.tsx` | Rows: avatar, name+badge, waveform + duration, accent play button, 2-line transcript preview, mono time. Plus the **recording** state (we record up to 60s). |
| 2g | **Passcode lock** | `app/PasscodeGate.tsx` | Logo, "Enter passcode", 4 dots, glass keypad, Face ID icon, "Forgot?". Plus the **wrong-passcode** state and the **locked-out** state (we lock after 4 wrong tries). |
| 2h | **Admin console** | `pages/app/Admin.tsx` | Gold-accented. Stats tiles, user rows with role badges + role tags, actions, search. We also have: **change account type**, **delete user** (typed-number confirmation), **push doctor** (per-transport rows), **media/TURN readout**. Please include those. |
| 2i | **Group info** | `app/GroupInfoSheet.tsx` | Group avatar 74px, name, "5 members · 3 online", E2E chip. Member rows with role tags (OWNER gold / ADMIN). Rows: mute, wallpaper, invite link, locked-group PIN toggle, leave. We also have **add/remove member**, an **"all members can add" toggle**, **group 6-digit ID**, **group status**, and an **invite-link audience picker** (guests-only / registered-only / all) with a **revoke**. Please include those. |

### Messaging

| # | Frame | Repo file | What I need |
|---|---|---|---|
| 3c | **Group conversation** | `pages/app/Messages.tsx` | Sender-coloured names + badges, reply-quote block (accent left border), @mention accent bold, "seen by 4", "Dana is typing", header "5 members · 3 online". Note we already colour **16** distinct senders and show each sender's **avatar thumbnail** in the gutter — keep both. |
| 3d | **New group** | `pages/app/Messages.tsx` (new-message sheet) | Direct/Group segmented, GROUP NAME field (accent focus ring), selected-member chips, ADD MEMBERS search, picker rows with accent check circles, CTA "Create group · 4 members". |
| 4c | **Message actions** | `pages/app/Messages.tsx` | Long-press: reaction bar (❤️👍😂😮😢 +), highlighted bubble, glass menu Reply/Copy/Forward/Message info/Delete for me/Remove for everyone. **The reaction bar needs a new data model — design it, and I'll build the backing store.** Also needs the **view-once / disappearing** variant, where the menu is suppressed until revealed. |
| 4d | **Voice note recording** | `pages/app/Messages.tsx` | Red recording pill: pulsing dot, mono timer, live waveform, "‹ slide to cancel", delete circle left, send accent circle right. We already have pause/resume — please place it. |
| 4e | **Media viewer** | `app/PeerOverlays.tsx` (lightbox) | Black fullscreen, photo centre, top bar (sender name+badge, timestamp, download/menu), caption + "MEDIA IS END-TO-END ENCRYPTED" footer. Needs the **video** variant. |
| 4j | **Video message** | `app/VideoRecordSheet.tsx` | Camera view, REC chip (red dot + mono 0:07 / 1:00), progress hairline, gallery thumb · white shutter ring with red square · send accent circle. Plus the **review/retake** state, and the **flip camera** control. |

### Contacts and profile

| # | Frame | Repo file | What I need |
|---|---|---|---|
| 3b | **Contact categories** | `pages/app/Contacts.tsx` | Chips All/VIP/Family/Friend/Team; sections ONLINE (accent) / FAVORITES (gold) / FAMILY (pink) / FRIEND (blue) / TEAM (violet); VIP/FRIEND tag chips, presence dots incl. busy, a blocked red note. **Needs a new `contact.tags` column — design it, and I'll build it.** Note we already have per-section **counts + online counts** in the headers; keep them. |
| 4a | **Peer profile** | `app/PeerOverlays.tsx` | Centred glass card: 92px avatar+ring+presence, name+badge, PIN accent, status chip, bio, social chips, 3 action tiles (Message accent / Video / Voice), category chips, Block · Report · Close. Depends on 3b's tags. |
| 4b | **Story composer** | `pages/app/Status.tsx` | Gradient bg picker (5 swatches), 26px centred text + caret, text/camera tools, audience chip, accent "Post story" pill. We also support **image / video / audio** stories with a caption, and posting **to a group** — please show those tabs. |

### Onboarding and entry

| # | Frame | Repo file | What I need |
|---|---|---|---|
| 4g | **Guest restore** | `app/GuestRestore.tsx` | Glass card: sparkle icon, "Welcome back", explainer, session row (avatar, name + blue guest badge, "842-317 · guest", "2 DAYS AGO"), CTA "Restore my session" + "Start fresh". We show a **footprint** ("14 contacts, 320 messages") — please place it. |
| 4h | **Group invite** | `app/OnboardingGate.tsx` + `pages/app/JoinInvite` | Landing card: 74px group avatar, "YOU ARE INVITED TO JOIN", group name, overlapping member avatars + count, E2E chip, accent join CTA, display-name note. Needs the **refused** state (a registered-only link opened by a guest). |
| 4i | **Locked group** | `pages/app/Messages.tsx` (gate) | Group avatar + gold lock puck, "This group is locked", 4 PIN dots, glass keypad (gold hover), "Locked groups never show previews". Needs the **recovery** state — our lock is unlocked by the group code *or* the app passcode. |

### System

| # | Frame | Repo file | What I need |
|---|---|---|---|
| 4k | **System alerts** | `app/PushBanner.tsx`, `app/MessagePopups.tsx`, `app/UpdateChecker.tsx`, `app/useSignOut.tsx` | Push-permission banner (bell, Enable accent) — **plus the iOS "Add to Home Screen" variant**; message toast (avatar+ring, name+badge, Reply chip); update dialog (show the version, Refresh now / Later); sign-out confirm (red-tinted, Cancel / red Sign out). |

### Desktop

| # | Frame | Repo file | What I need |
|---|---|---|---|
| 1j | **Desktop messages** | `app/AppShell.tsx` + `pages/app/Messages.tsx` | 88px icon rail (logo, 5 tabs with badges, avatar+ring at bottom) · 360px thread list · chat pane (header, bubbles max-width 420px, composer with accent send). **Note:** our desktop shell today is a **280px labelled sidebar**, not an icon rail — if 1j replaces it, 1i's sidebar has to change too. Please make the two agree. |
| 1h | **In-call video** *(partial)* | `lib/relayAssets.ts` | Bar, accent and tiles are done. Still need the frame's own chrome: top chip (name + badge + mono timer + lock), signal-bars chip, self PiP 92×126 with "YOU". |

---

## Two that need data we don't have

Design them anyway — I'll build the backing store from the design.

- **3b / 4a** — `contact.tags: ['vip'|'family'|'friend'|'team'|'favorite']`
- **4c** — a message-reactions model (who reacted with what)

## Also worth designing (in the app, not on the board)

Screens that exist and have no frame at all:

- **Party lines** — a dialable number that joins a room without ringing anyone; create/manage list.
- **Rejoin a live call from History** — "Live now · 3 in the call · hosted by X · Join", plus the host's Approve/Decline knock prompt.
- **Call quality readout** — the in-call stats chip (RTT, loss, jitter, relay/direct).
- **Sign-in method switcher** — the OTP / passcode / second-device picker with countdowns.
