import { writeFileSync } from "node:fs";

// Key passed via argv to avoid persisting it anywhere in the repo.
const KEY = process.argv[2];
if (!KEY) {
  console.error("Usage: node gen-landing-copy.mjs <GEMINI_API_KEY>");
  process.exit(1);
}
const MODEL = "gemini-3.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;

const sys = `You are a senior brand copywriter for "RELAY", a browser-based voice/video/chat app.

What RELAY is:
- Runs entirely in the web browser. Nothing to install. No account needed to start.
- You type a name and instantly get a personal 6-digit number. You share THAT number — never your phone number, email, or real contacts.
- People reach you by your 6-digit number only. Your real identity and contact list stay private and hidden.
- One-to-one voice & video calls, and one-to-many group video rooms via a single invite link (host can mute-all, co-host, pin/remove, transfer host, active-speaker spotlight).
- Rich messaging (files, images, voice notes), screen sharing, Picture-in-Picture, choose audio output / Bluetooth, multi-device ringing, full call history with one-tap redial.
- Works on any desktop or mobile browser. Calls are peer-to-peer.

BRAND PERSONALITY for this rewrite (the user asked for these themes — weave them in naturally and confidently):
- PRIVACY / HIDE YOUR IDENTITY: "no one knows your real contacts", "share a number, not yourself", "stay anonymous".
- ONE-TO-MANY: connect with one person or a whole room from a single link.
- FAST, EASY, FREE, CHEAP, UNIQUE: instant, frictionless, costs nothing, one of a kind.

TONE: light, energetic, modern, confident — punchy and a little playful, but still clear. Short sentences. Vary sentence length. No corporate jargon. Make it feel premium and unique, not generic.
Produce copy in BOTH English (en) and Arabic (ar). Arabic must be natural, fluent, modern and equally punchy.
Do NOT mention any AI tool, model, or brand name anywhere (no "Gemini", no "AI").

Return ONLY a valid JSON object (no markdown fences) with this exact shape:
{ "en": { ...fields... }, "ar": { ...same fields... } }

Each language object MUST contain these string fields:
hero_kicker, hero_title_1, hero_title_2, hero_sub, hero_note, hero_cta,
sticky_cta,
stats_title, stats_sub, stat_registered, stat_guests, stat_total, stat_online,
privacy_kicker, privacy_title, privacy_sub,
feat_kicker, feat_title, feat_sub,
shots_kicker, shots_title, shots_sub,
shot_dialer_t, shot_dialer_d, shot_chat_t, shot_chat_d, shot_group_t, shot_group_d, shot_mobile_t, shot_mobile_d,
cta_title, cta_sub, cta_button, footer_tag

AND a "pillars" array of EXACTLY 4 objects each {"t":"2-3 word title","d":"one short punchy sentence"} covering, in order:
1) Hide your identity (share a number, not your contacts),
2) One-to-many (one link, a whole room),
3) Fast & easy (instant, nothing to install),
4) Free & unique (costs nothing, one of a kind).

AND a "features" array of EXACTLY 9 objects each {"t":"2-4 word title","d":"one short sentence"} in THIS ORDER:
1) instant 6-digit number, 2) voice & video calls, 3) group conferences, 4) host controls,
5) messaging, 6) screen share & Picture-in-Picture, 7) audio output / Bluetooth routing,
8) call history & redial, 9) privacy / anonymous.

Keep hero_title_1 + hero_title_2 together forming one short headline (each 2-4 words). hero_cta and cta_button are short button labels. sticky_cta is a very short floating-button label (1-3 words, e.g. "Open RELAY").`;

const body = {
  systemInstruction: { parts: [{ text: sys }] },
  contents: [{ role: "user", parts: [{ text: "Write the new RELAY landing-page copy now in English and Arabic, leaning into privacy/identity-hiding, one-to-many, and fast/free/unique. Return only the JSON object." }] }],
  generationConfig: { temperature: 0.9, responseMimeType: "application/json" },
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
  const d = data[lang];
  if (!d || !Array.isArray(d.features) || d.features.length !== 9 || !Array.isArray(d.pillars) || d.pillars.length !== 4) {
    console.error(`Invalid ${lang} payload: features=`, d?.features?.length, "pillars=", d?.pillars?.length);
    process.exit(1);
  }
}

writeFileSync(new global.URL("./landing-copy.json", import.meta.url), JSON.stringify(data, null, 2));
console.log("OK — wrote landing-copy.json via", MODEL);
console.log("EN hero:", data.en.hero_title_1, "/", data.en.hero_title_2);
console.log("EN sub :", data.en.hero_sub);
console.log("EN pillars:", data.en.pillars.map((p) => p.t).join(" | "));
console.log("AR hero:", data.ar.hero_title_1, "/", data.ar.hero_title_2);
console.log("AR pillars:", data.ar.pillars.map((p) => p.t).join(" | "));
