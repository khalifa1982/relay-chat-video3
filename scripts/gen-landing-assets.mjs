#!/usr/bin/env node
/**
 * Generate the RELAY cinematic landing page illustrations via Gemini's
 * image API (`gemini-3.1-flash-image`).
 *
 * Output: /home/ubuntu/webdev-static-assets/relay-landing/*.png
 *
 * The prompts are tuned for the existing RELAY brand:
 *   - Dark background (#0b0f12 → #0e1518) with a deep cyan accent (#5eead4 /
 *     teal-300) and faint emerald online dots.
 *   - Glassmorphic surfaces, hairline borders, soft long shadows.
 *   - "App-quality" mockups — not screenshots, but stylized phone frames
 *     and floating UI panels that *feel* like RELAY in production.
 *
 * Run from anywhere:
 *   $ node scripts/gen-landing-assets.mjs
 *
 * Requires GEMINI_API_KEY in env (already provided by the sandbox).
 */

import fs from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("FATAL: GEMINI_API_KEY missing in env");
  process.exit(1);
}

const MODEL = "gemini-3.1-flash-image";
const OUT_DIR = "/home/ubuntu/webdev-static-assets/relay-landing";

// Each prompt is a carefully composed, single-shot description. We never ask
// for "screenshots of an app" — that produces watermarked UI mockups. Instead
// we describe the SCENE that demonstrates the value: a glass card hovering
// in the dark, with a specific UI element rendered inside, lit cinematically.
const SCENES = [
  {
    name: "hero",
    prompt: `Ultra-wide cinematic 16:9 product hero render. Centered: a single
floating smartphone shown in 3/4 perspective, jet-black bezel-less device with
chrome edges, screen on — displaying the RELAY app's dial pad: large white
6-digit number "482 015" at the top, then a 3x4 keypad of glass-pill buttons,
each with a tall digit and a faint subdigit caption (ABC, DEF, GHI...), and a
single round bright-teal "Call" button at the bottom. Background: a near-black
gradient (#0a0d10 at the edges, lifting to #0e1820 at the middle), with a
diffuse turquoise glow (~#5eead4) emerging from behind the phone, like a
billboard backlight. Faint chromatic-aberration ring around the device. No
text, no logo, no watermark. Photoreal but slightly stylized — feel of an
Apple keynote product shot. Subtle film grain.`,
    aspect: "16:9",
  },
  {
    name: "scene-chat",
    prompt: `Wide 16:9 cinematic render. Two stylized phones tilted toward each
other against a deep navy-black backdrop, framed like two people having a
conversation across a table. Each phone shows the RELAY messaging UI: a stack
of chat bubbles — left phone has incoming bubbles in soft graphite with one
outgoing teal (#5eead4) bubble at the bottom; right phone has the mirrored
view. One bubble on the left shows a small attached image thumbnail, another
shows a voice-note waveform. The phone bezels are jet-black with chrome rims.
A warm soft spotlight from above-left, deep cyan rim light from below.
Particles of light dust floating between them. No text labels, no brand marks
visible. Atmosphere: intimate, calm, "two friends connecting".`,
    aspect: "16:9",
  },
  {
    name: "scene-voice-call",
    prompt: `Wide 16:9 cinematic render of a single floating smartphone, screen
on, displaying an in-call voice screen: a large circular caller avatar at the
top (abstract geometric portrait, no face), the caller name "Aman" below it,
a rolling 00:42 timer beneath, then a horizontal row of four glass control
pills (mute, keypad, speaker, hangup — hangup is bright red). Background: a
moody dark space with concentric soft cyan sound-wave rings emanating
outward from the phone, suggesting live audio. Color palette near-black with
teal (#5eead4) accents. No watermark, no logo. Atmosphere: focused, intimate.`,
    aspect: "16:9",
  },
  {
    name: "scene-video-grid",
    prompt: `Wide 16:9 cinematic render of a multi-party video call grid
floating in the center of a dark cinematic stage. Six rounded glass tiles in a
3x2 grid, each tile contains a softly stylized portrait of a different person
(diverse, abstract semi-realistic, varied ages and ethnicities), each tile has
a tiny green "online" dot in the top-right and a small caller-name label at
the bottom. The grid itself sits inside a larger floating glass panel with
hairline cyan border. Floor-glow of teal beneath. Background: charcoal-black
with soft volumetric light rays. No app branding, no text watermark, no
on-screen text other than the small portrait name labels. Atmosphere:
"everyone in one room, no installs".`,
    aspect: "16:9",
  },
  {
    name: "scene-dialpad",
    prompt: `Tall 9:16 cinematic render of the RELAY dial pad UI shown as a
single glass card hovering against a near-black background. The card has a
bright "482 015" 6-digit dialed number at the top (cyan #5eead4, monospace),
a faint ghost preview number "177 375" subtly visible above it like a watermark
hint, then a 3x4 keypad of glassmorphic pill buttons with rounded corners and
hairline borders, each pill carries a large white digit and a 3-letter caption
underneath (1, 2 ABC, 3 DEF, 4 GHI, 5 JKL, 6 MNO, 7 PQRS, 8 TUV, 9 WXYZ, *, 0,
#). At the bottom a single circular bright-teal "Call" button with a phone
icon, glowing. The card has a deep teal glow behind it. No additional text,
no logo, no watermark.`,
    aspect: "9:16",
  },
  {
    name: "scene-launch",
    prompt: `Wide 16:9 cinematic finale shot. A single black smartphone
floating dead-center, screen showing the RELAY home screen with three large
glass tiles: "Call" (with a phone icon), "Message" (with a chat icon),
"Contacts" (with a people icon). Each tile glows with a teal (#5eead4) edge.
The phone itself sits in a beam of vertical cyan light, with soft starbursts
around it, like a product reveal in a keynote. Background: deep charcoal
with a hint of starfield. No watermark, no logo, no extra text. Atmosphere:
"the launch moment".`,
    aspect: "16:9",
  },
  // ---- Loop reel frames (6 frames, square, used as a horizontal carousel
  // animated by CSS). Each frame is one "moment" in the call flow.
  {
    name: "loop-1-dial",
    prompt: `Square 1:1 cinematic render. A single floating phone in 3/4
perspective on a near-black background, screen showing only the bright-teal
"482 015" dialed number and the round teal "Call" button glowing. Soft cyan
backlight halo behind the phone. Frame of a sequence — moment "dialing".
No logo, no watermark.`,
    aspect: "1:1",
  },
  {
    name: "loop-2-ringing",
    prompt: `Square 1:1 cinematic render. Same floating phone on a near-black
background. The screen now shows an outgoing-call screen: a large pulsing
ring around an abstract avatar, the word "Ringing" below it (no other text),
and a hangup pill at the bottom. The pulsing ring is bright cyan #5eead4.
Frame of a sequence — moment "ringing". No logo.`,
    aspect: "1:1",
  },
  {
    name: "loop-3-connecting",
    prompt: `Square 1:1 cinematic render. A second floating phone slides in
from the right, slightly behind the first. Both phones glow softly. The
first phone now shows "Connecting…" with three small dots, the second phone
shows an inbound-call screen with Accept (green) and Decline (red) glass
buttons. Near-black background. Frame of a sequence — moment "connecting".
No logo, no watermark.`,
    aspect: "1:1",
  },
  {
    name: "loop-4-live",
    prompt: `Square 1:1 cinematic render. The same two floating phones, now
both showing a live video tile: each phone's screen is dominated by an
abstract semi-realistic portrait of a different person, with a small
"00:14" timer in the corner. Cyan connection lines arc between the two
phones like a data bridge. Near-black backdrop. Frame of a sequence —
moment "connected, live video". No logo.`,
    aspect: "1:1",
  },
  {
    name: "loop-5-group",
    prompt: `Square 1:1 cinematic render. Six floating phones in a loose
orbit around a central glowing teal sphere, each phone shows a different
person's video tile. Connection lines link every phone to every other, like
a peer-to-peer mesh diagram. Near-black background with deep teal glow at
center. Frame of a sequence — moment "group of six". No logo.`,
    aspect: "1:1",
  },
  {
    name: "loop-6-chat",
    prompt: `Square 1:1 cinematic render. Two floating phones tilted toward
each other, screens showing chat bubbles in the RELAY style: graphite
incoming bubbles, bright teal outgoing bubbles, a small voice-note bubble
with a waveform, a small image bubble with a thumbnail. Near-black
backdrop with warm light from above. Frame of a sequence — moment "they
keep talking". No logo, no watermark.`,
    aspect: "1:1",
  },
];

async function generateOne(scene) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: scene.prompt }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: scene.aspect },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${scene.name}: ${text.slice(0, 400)}`);
  }
  const data = JSON.parse(text);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p.inlineData?.data);
  if (!imgPart) {
    throw new Error(
      `No image returned for ${scene.name}: ${JSON.stringify(data).slice(0, 400)}`,
    );
  }
  const buf = Buffer.from(imgPart.inlineData.data, "base64");
  const outPath = path.join(OUT_DIR, `${scene.name}.png`);
  await fs.writeFile(outPath, buf);
  return { name: scene.name, path: outPath, bytes: buf.length };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`Generating ${SCENES.length} scenes with ${MODEL} into ${OUT_DIR}`);
  // Run them in parallel-ish but cap at 4 concurrent calls to be polite.
  const results = [];
  const queue = [...SCENES];
  const concurrency = 4;
  async function worker(id) {
    while (queue.length > 0) {
      const scene = queue.shift();
      if (!scene) return;
      const t0 = Date.now();
      try {
        const r = await generateOne(scene);
        const ms = Date.now() - t0;
        console.log(`  [${id}] ${r.name} → ${(r.bytes / 1024).toFixed(0)} KB in ${ms}ms`);
        results.push({ ...r, ok: true });
      } catch (err) {
        const ms = Date.now() - t0;
        console.error(`  [${id}] ${scene.name} FAILED in ${ms}ms: ${err.message}`);
        results.push({ name: scene.name, ok: false, error: err.message });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i + 1)));
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`\nDone. ${ok}/${SCENES.length} succeeded.`);
  if (failed.length > 0) {
    console.log("Failures:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.error}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
