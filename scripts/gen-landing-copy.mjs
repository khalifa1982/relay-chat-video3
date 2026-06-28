import { writeFileSync } from "node:fs";

// Key passed via argv to avoid persisting it anywhere in the repo.
const KEY = process.argv[2];
if (!KEY) {
  console.error("Usage: node gen-landing-copy.mjs <GEMINI_API_KEY>");
  process.exit(1);
}
const MODEL = "gemini-3.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;

const sys = `You are a senior product copywriter for "RELAY", a browser-based voice/video/chat app.
Key facts about RELAY:
- It runs entirely in the web browser. No app to install, no account needed.
- You pick a name and instantly get a personal 6-digit number. Share it and people can call you.
- Features: 1:1 voice & video calls, group video conferences with an invite link, active-speaker spotlight, host controls (mute-all, co-host, pin/remove, transfer host), rich messaging (files, images, voice notes), screen sharing, Picture-in-Picture, choose audio output / Bluetooth routing, multi-device ringing, full call history with one-tap redial (incl. group redial), and privacy (guests stay on the device for 30 days, register to keep your number forever, calls are peer-to-peer).
- Works on desktop and mobile browsers.

Write warm, simple, plain-language copy. Short sentences. No jargon, no hype words. Friendly and clear, like explaining to a friend.
Produce copy in BOTH English (en) and Arabic (ar). Arabic must be natural, fluent Modern Standard Arabic, equally simple and clear.
Do NOT mention any AI tool, model, or brand name anywhere.

Return ONLY a valid JSON object (no markdown fences) with this exact shape:
{ "en": { ...fields... }, "ar": { ...same fields... } }
Each language object MUST contain these string fields:
hero_kicker, hero_title_1, hero_title_2, hero_sub, hero_note,
stats_title, stats_sub,
feat_kicker, feat_title, feat_sub,
shots_title, shot_dialer_t, shot_dialer_d, shot_chat_t, shot_chat_d, shot_group_t, shot_group_d,
mobile_t, mobile_d,
cta_title, cta_sub, footer_tag
AND a "features" array of EXACTLY 9 objects each {"t":"...","d":"..."} in THIS ORDER:
1) instant 6-digit number, 2) voice & video calls, 3) group conferences, 4) host controls,
5) messaging, 6) screen share & Picture-in-Picture, 7) audio output / Bluetooth routing,
8) call history & redial, 9) privacy.
"t" = 2-4 word title, "d" = one simple sentence.`;

const body = {
  systemInstruction: { parts: [{ text: sys }] },
  contents: [{ role: "user", parts: [{ text: "Write the RELAY landing-page copy now in English and Arabic. Return only the JSON object." }] }],
  generationConfig: { temperature: 0.8, responseMimeType: "application/json" },
};

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

if (!res.ok) {
  console.error("HTTP", res.status, await res.text());
  process.exit(1);
}

const json = await res.json();
let content = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
content = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
const data = JSON.parse(content);

for (const lang of ["en", "ar"]) {
  if (!data[lang] || !Array.isArray(data[lang].features) || data[lang].features.length !== 9) {
    console.error(`Invalid ${lang} payload: features=`, data[lang]?.features?.length);
    process.exit(1);
  }
}

writeFileSync(new global.URL("./landing-copy.json", import.meta.url), JSON.stringify(data, null, 2));
console.log("OK — wrote landing-copy.json via", MODEL);
console.log("EN hero:", data.en.hero_title_1, "/", data.en.hero_title_2);
console.log("EN sub :", data.en.hero_sub);
console.log("AR hero:", data.ar.hero_title_1, "/", data.ar.hero_title_2);
console.log("AR sub :", data.ar.hero_sub);
