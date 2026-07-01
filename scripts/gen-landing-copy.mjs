import { writeFileSync } from "node:fs";

// Key passed via argv (preferred) or GEMINI_API_KEY env var; never persisted in repo.
const KEY = process.argv[2] || process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("Usage: node gen-landing-copy.mjs <GEMINI_API_KEY>  (or set GEMINI_API_KEY)");
  process.exit(1);
}
// Try a preferred model first, then fall back if the API rejects it.
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];

const sys = `You are a senior brand copywriter for "RELAY", a browser-based voice / video / chat product.

WHAT RELAY ACTUALLY IS (never claim anything outside this):
- Runs entirely in the web browser. Nothing to install, no account needed to start.
- You type a name and instantly get a personal 6-digit number. You share THAT number — never your real phone number, email, or contacts.
- People reach you only by your 6-digit number. Your real identity and contact list stay hidden.
- One-to-one voice & video calls, AND one-to-many group video rooms via a single invite link (host can mute-all, co-host, pin/remove, transfer host, active-speaker spotlight).
- Rich messaging (files, images, voice notes), screen sharing, Picture-in-Picture, choose audio output / Bluetooth, multi-device ringing, full call history with one-tap redial.
- Works on any desktop or mobile browser. Calls are peer-to-peer. It is free.

STRICTLY FORBIDDEN CLAIMS (RELAY does NOT have these — never imply them):
- No online classroom / school / LMS / courses / grading / student features.
- No media streaming library / movies / shows.
- No hardware / devices / projectors.
- No real-time language translation, no AI assistant, no transcription.
Do NOT mention any AI tool, model, or brand name (no "Gemini", no "AI").

The landing page is organized into three PRODUCT-STYLE capability blocks (inspired by a modern multi-product site, but every claim must be true for RELAY):
1) TALK  — instant voice & video calls in the browser.
2) MEET  — one-to-many group rooms from a single link, with host controls.
3) CHAT  — rich private messaging tied to your 6-digit number.

TONE: light, energetic, modern, confident — punchy, a little playful, still crystal clear. Short sentences, varied length. No corporate jargon. Premium and unique, not generic.
Produce copy in BOTH English (en) and Arabic (ar). Arabic must be natural, fluent, modern and equally punchy.

Return ONLY a valid JSON object (no markdown fences) with shape: { "en": { ...fields... }, "ar": { ...same fields... } }

Each language object MUST contain these STRING fields:
hero_kicker, hero_title_1, hero_title_2, hero_sub, hero_note, hero_cta,
sticky_cta,
stats_title, stats_sub, stat_registered, stat_guests, stat_total, stat_online,
privacy_kicker, privacy_title, privacy_sub,
feat_kicker, feat_title, feat_sub,
shots_kicker, shots_title, shots_sub,
shot_dialer_t, shot_dialer_d, shot_chat_t, shot_chat_d, shot_group_t, shot_group_d, shot_contacts_t, shot_contacts_d,
mobile_t, mobile_d,
cta_title, cta_sub, cta_btn,
footer_tag, footer_rights

AND a "privacy_points" array of EXACTLY 3 short strings (privacy guarantees, e.g. "Your real number is never exposed.").

AND a "pillars" array of EXACTLY 4 objects each {"t":"2-3 word title","d":"one short punchy sentence"} covering, in order:
1) Hide your identity (share a number, not your contacts),
2) One-to-many (one link, a whole room),
3) Fast & easy (instant, nothing to install),
4) Free & unique (costs nothing, one of a kind).

AND a "blocks" array of EXACTLY 3 objects — the product-style capability blocks — each:
{"tag":"TALK|MEET|CHAT (short uppercase kicker)","title":"3-6 word title","desc":"one to two punchy sentences","items":["4 short feature labels, 2-4 words each"]}
In THIS ORDER: 1) TALK (1:1 voice & video), 2) MEET (group rooms + host controls), 3) CHAT (private messaging).

AND a "features" array of EXACTLY 9 objects each {"t":"2-4 word title","d":"one short sentence"} in THIS ORDER:
1) instant 6-digit number, 2) voice & video calls, 3) group conferences, 4) host controls,
5) messaging, 6) screen share & Picture-in-Picture, 7) audio output / Bluetooth routing,
8) call history & redial, 9) privacy / anonymous.

AND a "faqs" array of EXACTLY 4 objects each {"q":"short question","a":"one to two sentence answer"} covering: (1) do I need to install anything / sign up, (2) how does the 6-digit number keep me private, (3) can I host a group call, (4) is it really free.

Keep hero_title_1 + hero_title_2 together forming one short headline (each 2-4 words). hero_cta, cta_btn are short button labels. sticky_cta is a very short floating-button label (1-3 words, e.g. "Open RELAY").`;

const userMsg =
  "Write the new RELAY landing-page copy now in English and Arabic. Lean into privacy / hide-your-identity, one-to-many rooms, and fast / free / unique. Include the three product-style blocks (TALK, MEET, CHAT), the 4 FAQs, 3 privacy points, 4 pillars, 9 features. Return only the JSON object.";

async function tryModel(model) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ role: "user", parts: [{ text: userMsg }] }],
    generationConfig: { temperature: 0.9, responseMimeType: "application/json" },
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
  for (const lang of ["en", "ar"]) {
    const d = data?.[lang];
    if (!d) return `missing ${lang}`;
    if (!Array.isArray(d.features) || d.features.length !== 9) return `${lang}.features != 9`;
    if (!Array.isArray(d.pillars) || d.pillars.length !== 4) return `${lang}.pillars != 4`;
    if (!Array.isArray(d.blocks) || d.blocks.length !== 3) return `${lang}.blocks != 3`;
    if (!Array.isArray(d.faqs) || d.faqs.length !== 4) return `${lang}.faqs != 4`;
    if (!Array.isArray(d.privacy_points) || d.privacy_points.length !== 3) return `${lang}.privacy_points != 3`;
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
console.log("EN hero:", data.en.hero_title_1, "/", data.en.hero_title_2);
console.log("EN blocks:", data.en.blocks.map((b) => b.tag + ":" + b.title).join(" | "));
console.log("AR hero:", data.ar.hero_title_1, "/", data.ar.hero_title_2);
