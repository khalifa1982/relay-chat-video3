repo: khalifa1982/relay-chat-video3
branch: main

## Last sync
date: 2026-07-30T00:14:26Z

### Updated in this project
- Badge system rolled out everywhere: blue = guest, green = registered, gold = admin; every name row, header, call screen, sender label, group-call tile and toast now carries a role badge; legend added at board top
- Earlier: full 34-frame board — all screens, overlays, groups/categories/matrix dialing, standard call bar, 8-person conference

## Screen map
| Project screen | Repo files |
| --- | --- |
| Relay Login.dc.html (login/registration, shipped) | client/src/app/LoginScreen.tsx, client/src/app/RelayBackground.tsx, client/src/lib/relayBackground.ts, client/src/app/OnboardingGate.tsx, client/src/app/LiveStats.tsx |
| Relay App Redesign.dc.html #1a Dialer | client/src/pages/app/Dialer.tsx |
| Relay App Redesign.dc.html #1b History | client/src/pages/app/History.tsx |
| Relay App Redesign.dc.html #1c Messages / #1d Conversation / #1j Desktop messages | client/src/pages/app/Messages.tsx, client/src/pages/app/Status.tsx |
| Relay App Redesign.dc.html #1e Contacts | client/src/pages/app/Contacts.tsx |
| Relay App Redesign.dc.html #1f Profile | client/src/pages/app/Profile.tsx, client/src/pages/app/ProfileHubSections.tsx |
| Relay App Redesign.dc.html #1g Incoming / #1h In-call / #2a Group / #2b Voice | client/src/app/RelayEngine.tsx, client/src/pages/app/GroupCallScreen.tsx |
| Relay App Redesign.dc.html #2c Story viewer | client/src/pages/app/Status.tsx, client/src/app/PeerOverlays.tsx |
| Relay App Redesign.dc.html #2d Notification center | client/src/app/MissedCalls.tsx |
| Relay App Redesign.dc.html #2e Register sheet | client/src/app/AuthPanel.tsx |
| Relay App Redesign.dc.html #2f Passcode lock | client/src/app/PasscodeGate.tsx, client/src/app/biometric.ts |
| Relay App Redesign.dc.html #2g Voicemail | client/src/app/VoicemailPrompt.tsx |
| Relay App Redesign.dc.html #2h Admin | client/src/pages/app/Admin.tsx |
| Relay App Redesign.dc.html #4a Peer profile | client/src/app/PeerOverlays.tsx |
| Relay App Redesign.dc.html #4b Story composer / #2c viewer | client/src/pages/app/Status.tsx |
| Relay App Redesign.dc.html #4c Message actions/info, #4d voice note, #4e media viewer | client/src/pages/app/Messages.tsx |
| Relay App Redesign.dc.html #4f QR &amp; number | client/src/pages/app/Profile.tsx |
| Relay App Redesign.dc.html #4g Guest restore | client/src/app/GuestRestore.tsx |
| Relay App Redesign.dc.html #4h Group invite | client/src/pages/GroupInvite.tsx |
| Relay App Redesign.dc.html #4i Locked group | client/src/app/GroupLockGate.tsx |
| Relay App Redesign.dc.html #4j Video record | client/src/app/VideoRecordSheet.tsx |
| Relay App Redesign.dc.html #4k System alerts | client/src/app/PushBanner.tsx, client/src/app/MessagePopups.tsx, client/src/app/UpdateChecker.tsx, client/src/app/useSignOut.tsx |
| Relay App Redesign.dc.html #2i Group info | client/src/app/GroupInfoSheet.tsx |
| Relay App Redesign.dc.html shell (top bar, tab bar, sidebar) | client/src/app/AppShell.tsx, client/src/app/TopBar.tsx |

## App inventory (for redesign, not yet built here)
- Shell: client/src/app/AppShell.tsx (bottom tabs: Calls #22c55e / History #38bdf8 / Messages #fb923c / Contacts #a78bfa; desktop sidebar), TopBar.tsx (brand dot + wordmark + identity strip + bell + avatar ring)
- Dialer: client/src/pages/app/Dialer.tsx (keypad, hosts call engine)
- History: client/src/pages/app/History.tsx (filters incl. missed)
- Messages: client/src/pages/app/Messages.tsx (threads + status strip + conversation + composer)
- Contacts: client/src/pages/app/Contacts.tsx
- Profile: client/src/pages/app/Profile.tsx + ProfileHubSections.tsx
- Status/stories: client/src/pages/app/Status.tsx, app/PeerOverlays.tsx
- Calls UI: app/RelayEngine.tsx (ring/in-call overlay), pages/app/GroupCallScreen.tsx
- Aux: app/MissedCalls.tsx (bell), app/AuthPanel.tsx, app/VoicemailPrompt.tsx, app/GuestRestore.tsx, app/PasscodeGate.tsx
- Theme: client/src/index.css (.relay-v2 tokens, glass-surface utilities), design/v2-spec.md
