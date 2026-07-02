// Generate 10 realistic webcam-style portraits for the RELAY conference grid.
// Uses Google Gemini image generation (Nano Banana family).
import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import path from "node:path";

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error("Missing GEMINI_API_KEY"); process.exit(1); }

const ai = new GoogleGenAI({ apiKey: API_KEY });

const OUT = "/home/ubuntu/webdev-static-assets/relay-people";
fs.mkdirSync(OUT, { recursive: true });

// Try newest image models first, fall back gracefully.
const MODELS = [
  "gemini-3-pro-image",
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image",
  "gemini-2.0-flash-preview-image-generation",
];

// Each tile: a diverse person on a video call, framed head-and-shoulders,
// looking into a laptop/phone webcam, home/office background, soft indoor light.
const BASE =
  "Realistic candid webcam video-call screenshot, single person, head and shoulders, " +
  "centered, looking toward the camera/screen, casual indoor home or office background " +
  "softly blurred, natural soft indoor lighting, shot on a laptop front camera, " +
  "photorealistic, 4:5 vertical framing. Not a professional studio portrait. ";

const PEOPLE = [
  { id: "p01", who: "a young Black woman with curly hair, smiling and talking mid-sentence, hands slightly gesturing" },
  { id: "p02", who: "a middle-aged white man with glasses and a beard, listening calmly, slight nod" },
  { id: "p03", who: "an East Asian woman in her 20s, drinking water from a glass, relaxed" },
  { id: "p04", who: "a South Asian man in his 30s, mouth open talking and laughing, animated" },
  { id: "p05", who: "a Latina woman with long dark hair, resting chin on hand, attentive listening" },
  { id: "p06", who: "an older white woman with short grey hair, warm smile, waving hello at the camera" },
  { id: "p07", who: "a young man with headphones on, looking slightly to the side reading his screen" },
  { id: "p08", who: "a Black man in his 40s in a casual shirt, sipping coffee from a mug" },
  { id: "p09", who: "a Middle Eastern woman wearing a hijab, speaking and smiling, engaged" },
  { id: "p10", who: "a young white man with tousled hair, leaning back thinking, neutral expression" },
];

async function genOne(model, prompt) {
  const resp = await ai.models.generateContent({
    model,
    contents: prompt,
  });
  const parts = resp?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) return Buffer.from(part.inlineData.data, "base64");
  }
  return null;
}

let workingModel = null;

for (const person of PEOPLE) {
  const prompt = BASE + person.who + ".";
  let buf = null;
  const modelsToTry = workingModel ? [workingModel, ...MODELS] : MODELS;
  for (const model of modelsToTry) {
    try {
      buf = await genOne(model, prompt);
      if (buf) { workingModel = model; break; }
    } catch (e) {
      console.error(`  [${person.id}] model ${model} failed: ${String(e).slice(0, 140)}`);
    }
  }
  if (!buf) { console.error(`FAILED ${person.id}`); continue; }
  const file = path.join(OUT, `${person.id}.png`);
  fs.writeFileSync(file, buf);
  console.log(`OK ${person.id} -> ${file} (${(buf.length / 1024).toFixed(0)} KB) via ${workingModel}`);
}
console.log("DONE. model used:", workingModel);
