// Generate "Coming soon" download-section copy in 6 languages via Gemini Flash.
import { GoogleGenAI } from "@google/genai";
import { writeFileSync } from "node:fs";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const LANGS = {
  en: "English",
  ar: "Arabic",
  es: "Spanish",
  fr: "French",
  de: "German",
  hi: "Hindi",
};

const schemaKeys = {
  dl_kicker: "Short uppercase eyebrow label, e.g. 'MOBILE APPS'",
  dl_title: "Section heading inviting users to get RELAY on mobile",
  dl_sub: "One short sentence: native apps are on the way; use the web app meanwhile",
  dl_soon: "The tiny 'Coming soon' badge text",
  dl_ios: "Label under Apple App Store icon (e.g. 'Download on the App Store')",
  dl_android: "Label under Google Play icon (e.g. 'Get it on Google Play')",
  dl_apk: "Label for direct Android APK download (e.g. 'Direct APK Download')",
  dl_apk_note: "Tiny note under APK button, e.g. 'Android .apk — link coming soon'",
};

const results = {};
for (const [code, name] of Object.entries(LANGS)) {
  const prompt = `You are localizing UI copy for RELAY, a private browser-based voice/video/chat app.
Return ONLY compact JSON (no markdown) with these keys, all values written naturally in ${name}:
${Object.entries(schemaKeys).map(([k, v]) => `"${k}": ${v}`).join("\n")}
Keep values short and punchy, suitable for buttons/labels. Do NOT mention Gemini or any AI. Do NOT invent features.`;

  const resp = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: prompt,
    config: { responseMimeType: "application/json" },
  });
  let txt = resp.text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  results[code] = JSON.parse(txt);
  console.log(`[${code}] ok`);
}

writeFileSync(new URL("./download-copy.json", import.meta.url), JSON.stringify(results, null, 2));
console.log("wrote download-copy.json");
