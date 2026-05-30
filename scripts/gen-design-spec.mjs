// Generates the v2.0 visual design spec by asking Gemini 2.5 Flash.
// Output goes to design/v2-spec.md so it survives across sessions.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set in env.");
  process.exit(1);
}

const briefing = `
You are a senior product designer working on RELAY v2.0 — a self-hosted browser caller that
already does WebRTC voice/video/chat between users who get a 6-digit number.

CURRENT STATE (v1.2.0):
- Single landing page with hero + an embedded call UI.
- Dark theme, cyan accent (oklch(~0.85 0.18 195)), Inter sans, JetBrains Mono digits.
- Uses tailwind v4, shadcn/ui, OKLCH tokens in client/src/index.css.

GOAL FOR v2.0 (phone-app metaphor):
1. Guest onboarding: visitor types a username on the landing page, gets a 6-digit number,
    cookie-pinned for 30 days. Option to "upgrade to keep forever" with OAuth.
2. Once signed in (guest or OAuth), enter an "app shell":
    - Persistent header showing the user's 6-digit number (copyable).
    - Mobile: bottom tab bar with two tabs: Dialer (phone icon) and Messages (chat icon).
       Each icon may carry an unread/missed badge.
    - Desktop/tablet (>=768px): a left sidebar version with the same two tabs + Contacts + Profile.
3. Dialer tab:
    - Header: my number, large and copyable.
    - Center: a number-input display (6-digit) + backspace.
    - Below: a 3x4 grid keypad (1,2,3 / 4,5,6 / 7,8,9 / *,0,#) sized with CSS clamp so it
       fully fits any viewport (320px phone -> 1440px desktop). Never overflow.
    - Big primary "Call" button (full-width on mobile, circular on desktop). Green/teal.
    - Below: call history list — avatar/initials, name (if contact) or number, time,
       in/out/missed direction icon.
    - On dial: a peek modal showing the callee's avatar, name (if contact), online/offline,
       last seen, and a ringing animation.
4. Messages tab (full SMS-style, internal to RELAY, not telecom SMS):
    - Thread list with: avatar, display name or number, last-message preview, time,
       unread count badge. Mobile-first.
    - Conversation view: SMS-style bubbles (mine right, theirs left), day separators,
       delivery & read ticks, typing indicator.
    - Composer: text input + emoji picker + attachment menu (image, video, voice note, file).
       Image/video previews inline. Voice notes have play/pause and a waveform-ish bar.
    - System messages like "Call ended — 02:34" between bubbles.
5. Contacts: card grid; name + number + online dot + last-seen; edit; avatar upload.
6. Cross-device: every screen must work on iPhone SE (320x568), iPhone 15 Pro, Pixel 8,
    iPad portrait/landscape, 1440 desktop. No clipped keypads. No horizontal scroll.

DELIVERABLE — a markdown spec with these sections, concrete and implementation-ready:
A. Brand & mood — one paragraph capturing the feel. (Confident, calm, premium, modern phone UI.)
B. Color tokens — give exact OKLCH values for the dark theme:
    background, surface, surface-elevated, foreground, foreground-muted,
    accent (primary action, used for the Call button), accent-foreground,
    success (online dot), warning (away), danger (decline/missed),
    chat-bubble-mine-bg/fg, chat-bubble-theirs-bg/fg, divider, ring.
    Also give a light-theme variant.
C. Typography — Google Fonts to load (with weights), sizes for: app-title, my-number-display,
    dialer-input, key-label, message-body, message-meta, list-name, list-preview.
    Specify line heights and tracking.
D. Spacing & radii — base unit, list-item paddings, key-button size, bubble radius (lg with
    one corner squared so it points to the sender), card radius, modal radius.
E. Elevation/shadow — describe 2 or 3 levels using oklch + alpha.
F. App shell — describe header height on mobile vs desktop, bottom-nav height (mobile),
    sidebar width (desktop), tab indicator style. Provide a textual wireframe with ascii.
G. Dialer — exact grid layout. Each key is square. Size = clamp(56px, 18vw, 88px).
    Gap = clamp(6px, 1.5vw, 14px). Total grid width = 3 keys + 2 gaps, centered.
    Provide: key default style, pressed style (transform: scale(0.96)), focus ring.
    Call button style.
H. Messages — bubble max-width 75%; my bubble uses accent gradient subtle; theirs uses
    surface-elevated. Read ticks: two cyan checks. Specify file/image/audio bubble layouts.
    Composer height grow rules. Emoji picker positioning (Radix popover origin-aware).
I. Animation — list the motion you'll use, with durations and easings. Follow rules:
    UI under 300ms, ease-out cubic-bezier(0.23,1,0.32,1), tap scale(0.97), origin-aware popovers.
J. Accessibility — focus rings, contrast notes (must AA pass body text), tap target >= 44px.
K. Component checklist — list shadcn/ui components used and any custom ones (DialPad,
    NumberDisplay, MessageBubble, ThreadListItem, ContactCard, OnlineDot, etc.)

Be specific and use concrete numbers and OKLCH triplets. No generic advice.
Return ONLY the markdown spec, no preamble.
`;

// Use the rolling "latest Flash" alias so we automatically benefit from newer Flash
// generations (e.g., Gemini 3.x Flash) once Google ships them. As of 2026-05 the alias
// resolves to gemini-2.5-flash.
const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

console.log(`Asking ${model} for the v2.0 design spec...`);
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: briefing }],
      },
    ],
    generationConfig: {
      temperature: 0.6,
      topP: 0.9,
      maxOutputTokens: 8000,
      responseMimeType: "text/plain",
    },
  }),
});

if (!res.ok) {
  const text = await res.text();
  console.error("Gemini HTTP", res.status, text.slice(0, 2000));
  process.exit(1);
}

const data = await res.json();
const spec =
  data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n") ||
  JSON.stringify(data, null, 2);

const outPath = "design/v2-spec.md";
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, spec, "utf8");
console.log(`Spec written: ${outPath} (${spec.length} chars)`);
