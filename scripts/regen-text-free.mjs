#!/usr/bin/env node
/**
 * Regenerate the three landing frames where Gemini leaked stage/label text
 * into the image. We re-issue stricter prompts that explicitly forbid any
 * baked-in lettering and ask for purely-graphic compositions.
 */
import fs from "node:fs/promises";
import path from "node:path";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("FATAL: GEMINI_API_KEY missing");
  process.exit(1);
}

const MODEL = "gemini-3.1-flash-image";
const OUT_DIR = "/home/ubuntu/webdev-static-assets/relay-landing";

const NO_TEXT_CLAUSE = ` ABSOLUTE RULE: there must be ZERO baked-in text in the
image — no captions, no titles, no labels, no clock readouts, no app names, no
brand names, no watermarks, no signatures, no "online" badges with words, no
"Caller Name" labels. If anywhere a text element would naturally appear, REPLACE
it with a small abstract geometric glyph (a dot, a chevron, a tiny shape). The
image must be 100% language-free so it works in every locale.`;

const SCENES = [
  {
    name: "scene-video-grid",
    aspect: "16:9",
    prompt: `Wide 16:9 cinematic render. A floating glass panel hovering in a
dark cinematic stage. The panel contains a 3x2 grid of rounded glass tiles, six
in total, each tile shows a softly stylized semi-realistic portrait of a
different person (diverse, varied ages and ethnicities — abstract painterly
style, NOT photoreal). Each tile has a tiny round green dot in the top-right
corner (no word next to it). The whole panel has a hairline cyan border, sits
on a deep teal floor glow. Background: charcoal-black with soft volumetric
light beams. Color palette: near-black + cyan (#5eead4) accents only.${NO_TEXT_CLAUSE}`,
  },
  {
    name: "loop-5-group",
    aspect: "1:1",
    prompt: `Square 1:1 cinematic render. Six floating black smartphones in a
loose orbit around a glowing teal sphere at the center, each phone tilted at a
different angle, each phone's screen shows a painterly portrait of a different
person (diverse, abstract semi-realistic, varied ages and ethnicities — not
photoreal). Thin cyan connection lines arc between every phone, forming a peer-
to-peer mesh diagram. Near-black background with a deep teal radial glow at
the center. The connection lines should be cyan (#5eead4), not orange or
yellow.${NO_TEXT_CLAUSE}`,
  },
  {
    name: "scene-launch",
    aspect: "16:9",
    prompt: `Wide 16:9 cinematic finale shot. A single jet-black smartphone
floating dead-center against a deep starfield-charcoal background. The phone
screen shows three large rounded glass tiles stacked vertically — top tile has
a phone-handset icon, middle tile has a chat-bubble icon, bottom tile has a
people icon. Each tile glows with a teal (#5eead4) edge. The phone sits inside
a vertical beam of pale cyan light with soft starbursts radiating outward.
Atmosphere: keynote product reveal.${NO_TEXT_CLAUSE}`,
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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  const data = JSON.parse(text);
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p.inlineData?.data);
  if (!imgPart) throw new Error(`No image: ${JSON.stringify(data).slice(0, 400)}`);
  const buf = Buffer.from(imgPart.inlineData.data, "base64");
  const outPath = path.join(OUT_DIR, `${scene.name}.png`);
  await fs.writeFile(outPath, buf);
  return { name: scene.name, bytes: buf.length, path: outPath };
}

(async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const results = await Promise.allSettled(SCENES.map(generateOne));
  results.forEach((r, i) => {
    const s = SCENES[i];
    if (r.status === "fulfilled") {
      console.log(`OK ${s.name} → ${(r.value.bytes / 1024).toFixed(0)} KB`);
    } else {
      console.error(`FAIL ${s.name}: ${r.reason.message}`);
    }
  });
  const anyFail = results.some((r) => r.status !== "fulfilled");
  process.exit(anyFail ? 2 : 0);
})();
