import { writeFileSync } from "node:fs";

// Key passed via argv (preferred) or GEMINI_API_KEY env var; never persisted in repo.
const KEY = process.argv[2] || process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("Usage: node gen-landing-copy.mjs <GEMINI_API_KEY>  (or set GEMINI_API_KEY)");
  process.exit(1);
}
// User explicitly asked for gemini-3.5-flash (confirmed available on this key). Fallbacks after.
const MODELS = ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash"];

// Languages to produce. code -> human name for the model.
const LANGS = {
  en: "English",
  ar: "Arabic (Modern Standard, natural & punchy)",
  es: "Spanish",
  fr: "French",
  de: "German",
  hi: "Hindi",
};

const sys = `You are a senior brand copywriter for "RELAY", a browser-based voice / video / chat product.

WHAT RELAY ACTUALLY IS (never claim anything outside this):
- Runs entirely in the web browser. Nothing to install, no account needed to start.
- You type a name and instantly get a personal 6-digit number. You share THAT number — never your real phone number, email, or contacts.
- People reach you only by your 6-digit number. Your real identity and contact list stay hidden.
- One-to-one voice & video calls, AND one-to-many group video conferences (up to 10 people in one room) via a single invite link. Host can mute-all, co-host, pin/remove, transfer host, active-speaker spotlight, and a multi-screen video grid shows everyone.
- Rich messaging (files, images, voice notes), screen sharing, Picture-in-Picture, choose audio output / Bluetooth, multi-device ringing, full call history with one-tap redial.
- Works on any desktop or mobile browser. Calls are peer-to-peer. It is free.

STRICTLY FORBIDDEN CLAIMS (RELAY does NOT have these — never imply them):
- No online classroom / school / LMS / courses / grading / student features.
- No media streaming library / movies / shows.
- No hardware / devices / projectors.
- No real-time language translation, no AI assistant, no transcription.
Do NOT mention any AI tool, model, or brand name (no "Gemini", no "AI").

The landing page is organized into three PRODUCT-STYLE capability blocks (every claim must be true for RELAY):
1) TALK  — instant voice & video calls in the browser.
2) MEET  — group video conferences, up to 10 people, from a single link, with host controls.
3) CHAT  — rich private messaging tied to your 6-digit number.

TONE: light, energetic, modern, confident — punchy, a little playful, still crystal clear. Short sentences, varied length. No corporate jargon. Premium and unique, not generic. Each language must read like a native speaker wrote it — fluent and equally punchy, NOT a literal translation.

Return ONLY a valid JSON object (no markdown fences). The TOP-LEVEL keys are the language codes I give you; each maps to an object with the SAME fields.

Each language object MUST contain these STRING fields:
lang_name (the language's own name, e.g. "English", "العربية", "Español"),
hero_kicker, hero_title_1, hero_title_2, hero_sub, hero_note, hero_cta,
sticky_cta,
stats_title, stats_sub, stat_registered, stat_guests, stat_total, stat_online,
privacy_kicker, privacy_title, privacy_sub,
group_kicker, group_title, group_sub, group_badge (very short, e.g. "Up to 10 people"),
feat_kicker, feat_title, feat_sub,
shots_kicker, shots_title, shots_sub,
shot_dialer_t, shot_dialer_d, shot_chat_t, shot_chat_d, shot_group_t, shot_group_d, shot_contacts_t, shot_contacts_d,
mobile_t, mobile_d,
cta_title, cta_sub, cta_btn,
footer_tag, footer_rights

AND a "privacy_points" array of EXACTLY 3 short strings (privacy guarantees).

AND a "group_points" array of EXACTLY 4 short strings describing the group video conference (up to 10 people, multi-screen grid, one invite link, host controls / mute-all / spotlight).

AND a "pillars" array of EXACTLY 4 objects each {"t":"2-3 word title","d":"one short punchy sentence"} covering, in order:
1) Hide your identity, 2) One-to-many (up to 10), 3) Fast & easy, 4) Free & unique.

AND a "blocks" array of EXACTLY 3 objects each {"tag":"TALK|MEET|CHAT","title":"3-6 word title","desc":"one to two punchy sentences","items":["4 short feature labels"]} in THIS ORDER: TALK, MEET, CHAT.

AND a "features" array of EXACTLY 9 objects each {"t":"2-4 word title","d":"one short sentence"} in THIS ORDER:
1) instant 6-digit number, 2) voice & video calls, 3) group conferences up to 10, 4) host controls,
5) messaging, 6) screen share & Picture-in-Picture, 7) audio output / Bluetooth routing,
8) call history & redial, 9) privacy / anonymous.

AND a "faqs" array of EXACTLY 4 objects each {"q":"short question","a":"one to two sentence answer"} covering: (1) install / sign up, (2) how the 6-digit number keeps me private, (3) can I host a group call of up to 10 people, (4) is it really free.

Keep hero_title_1 + hero_title_2 together forming one short headline (each 2-4 words). hero_cta, cta_btn are short button labels. sticky_cta is a very short floating-button label (1-3 words, e.g. "Open RELAY"). Keep "RELAY" as the Latin brand name in every language (Arabic may add a transliteration only if natural, but keep short).`;

const langList = Object.entries(LANGS).map(([c, n]) => `${c} = ${n}`).join(", ");
const userMsg =
  `Write the new RELAY landing-page copy now in ALL of these languages: ${langList}. ` +
  `Lean into privacy / hide-your-identity, group video conferences up to 10 people with a multi-screen grid, and fast / free / unique. ` +
  `Top-level keys must be exactly: ${Object.keys(LANGS).join(", ")}. Return only the JSON object.`;

async function tryModel(model) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ role: "user", parts: [{ text: userMsg }] }],
    generationConfig: { temperature: 0.9, responseMimeType: "application/json", maxOutputTokens: 65536 },
  };
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[${model}] HTTP`, res.status, (await res.text()).slice(0, 400));
    return null;
  }
  const json = await res.json();
  let content = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  content = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(content);
  } catch (e) {
    console.error(`[${model}] JSON parse failed:`, e.message);
    return null;
  }
}

function validate(data) {
  for (const lang of Object.keys(LANGS)) {
    const d = data?.[lang];
    if (!d) return `missing ${lang}`;
    if (!Array.isArray(d.features) || d.features.length !== 9) return `${lang}.features != 9`;
    if (!Array.isArray(d.pillars) || d.pillars.length !== 4) return `${lang}.pillars != 4`;
    if (!Array.isArray(d.blocks) || d.blocks.length !== 3) return `${lang}.blocks != 3`;
    if (!Array.isArray(d.faqs) || d.faqs.length !== 4) return `${lang}.faqs != 4`;
    if (!Array.isArray(d.privacy_points) || d.privacy_points.length !== 3) return `${lang}.privacy_points != 3`;
    if (!Array.isArray(d.group_points) || d.group_points.length !== 4) return `${lang}.group_points != 4`;
    for (const b of d.blocks) {
      if (!Array.isArray(b.items) || b.items.length !== 4) return `${lang}.block items != 4`;
    }
  }
  return null;
}

let data = null;
let usedModel = null;
for (const model of MODELS) {
  const out = await tryModel(model);
  if (out) {
    const err = validate(out);
    if (!err) {
      data = out;
      usedModel = model;
      break;
    }
    console.error(`[${model}] validation failed:`, err);
  }
}

if (!data) {
  console.error("All models failed to produce valid copy.");
  process.exit(1);
}

writeFileSync(new global.URL("./landing-copy.json", import.meta.url), JSON.stringify(data, null, 2));
console.log("OK — wrote landing-copy.json via", usedModel);
for (const lang of Object.keys(LANGS)) {
  console.log(`${lang}:`, data[lang].hero_title_1, "/", data[lang].hero_title_2, "| group:", data[lang].group_title);
}
