# RELAY Mobile — release QA protocol

*Run before every store release (and after any engine change touching
`relayClient.ts`, `relay.ts`, or the shells). Grown from real field failures —
each scenario below has broken at least once in RELAY's history.*

## Device matrix (minimum)

| # | Device | Runtime | Why it's in the matrix |
|---|---|---|---|
| 1 | Android phone (mid-range) | **RELAY TWA app** | the store artifact itself |
| 2 | Android phone | Chrome browser | parity baseline |
| 3 | iPhone (iOS 16.4+) | **RELAY iOS app** | the store artifact itself |
| 4 | iPhone | Safari + installed PWA | Web-Push path / parity baseline |
| 5 | Desktop | Chrome or Edge | mixed-platform third party |

## A · Call establishment (history: v2.74/78/83 regressions)

1. **A dials B (voice), B foreground** → B rings audibly (signature ringtone,
   medium-loud) + vibrates (Android); caller card walks Calling→Ringing;
   answer < 3s to two-way audio.
2. **B backgrounded/locked ≥ 1 min** → dial pages: caller shows "Reaching their
   phone…", B gets a push, opening the push lands in the ring, answer works.
3. **B has app closed entirely** → push arrives (Android app / iPhone
   *installed* app only — a plain Safari tab cannot be woken: expected).
4. **B reloads mid-ring** → ring re-appears (redelivery).
5. **Nonexistent number** → honest "That number doesn't exist." card, ~2s,
   clean return to dialer.
6. **Redial immediately after hangup, 5×** → no instant pre-ring drops.

## B · Audio routing (history: v2.80/84 — the top field-bug source)

7. **Answered call on Android app** → audio starts on SPEAKER (default);
   speaker button toggles earpiece↔speaker instantly, with toast.
8. **iPhone ↔ Android, both directions** → both sides hear at arm's length
   (iPhone must NOT be earpiece-quiet). This is the v2.84 acceptance test.
9. **Bluetooth headset connects mid-call** → audio moves to the headset; no
   one-way audio after.
10. **Backgrounding mid-call (both OS)** → call audio continues
    (`UIBackgroundModes audio` on iOS; auto-PiP on Android if enabled).

## C · Video & consent (v2.81 protocol)

11. Voice call → camera tap sends request → other side prompt → accept turns
    BOTH cameras on; decline keeps both off.
12. Video dial → "Answer as voice" keeps the answerer camera-less and stands
    the caller's camera down.
13. Camera flip front/back mid-call keeps outbound video live (no mirror on
    the far side).

## D · Shell-specific

14. **Native full-screen ring (closed app)**: force-stop the RELAY app on
    Android → call its number → the phone rings with the FULL-SCREEN
    Answer/Decline screen (even locked); Answer opens the app and the held
    ring is delivered. *(Requires Firebase configured — mobile/README.md.)*
14b. **Native ongoing-call service**: during a call, background the app for
    2+ minutes → audio keeps flowing; an "Ongoing call" notification shows;
    hang-up removes it.
14c. **Native speaker toggle**: in-call audio button flips earpiece↔speaker
    through the OS (verify with volume UI / actual loudness), remembered on
    the next call.
15. **TWA full-screen**: after assetlinks are configured, launch shows NO URL
    bar. (`https://www.your-chat.org/.well-known/assetlinks.json` must return
    the fingerprints.)
15. **First-run permissions**: camera/mic prompts appear once, are remembered
    on relaunch (Chrome site permissions / iOS per-app grant).
16. **Hang-up icon** renders as the horizontal call-end handset (not a pickup
    receiver) on every device in the matrix.
17. **Auto-update**: publish a web bump → open the installed apps → they pick
    up the new version (footer) within 30s idle / silently mid-call.
18. **Deep link** (Android): tapping a `https://www.your-chat.org/...` link
    opens the app once verified.

## E · Messaging & misc smoke

19. Text + photo attachment both directions; unread badges; typing indicator.
20. Missed-call push → tap → lands on History "Missed" filter.
21. Profile → Test ringtone plays the signature tone at medium volume.
22. Block a contact → their call is silently declined; their 1:1 message is
    rejected.

**Pass bar:** all of A+B on devices 1–4, plus C11–12, D14–16. Log failures
with device, OS version, and the in-call diagnostics overlay (`?` key /
diag button → Copy).
