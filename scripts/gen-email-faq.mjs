// Generate a single bilingual-consistent FAQ (Q+A) across 6 languages:
// "Do I need an email or an account?" -> quick use needs nothing; saving/upgrading
// is OPTIONAL and email-only, fully internal, no Google/Apple/Facebook/Manus/external IdP.
const KEY = process.env.GEMINI_API_KEY;
const MODEL = "gemini-2.5-flash";

const langs = {
  en: "English",
  ar: "Arabic",
  es: "Spanish",
  fr: "French",
  de: "German",
  hi: "Hindi",
};

const instruction = `You are writing ONE FAQ entry for a privacy-first browser calling app called RELAY.
Meaning to convey (keep it faithful, do NOT invent features):
- Using RELAY needs NOTHING: no download, no account. You just get an instant 6-digit number.
- Saving or keeping your account across devices is OPTIONAL, and when you choose to do it, it uses your EMAIL ONLY.
- Account creation is fully internal / self-contained. It does NOT use Google/Gmail, Apple, Facebook, or any external / third-party sign-in provider.
Question should read naturally like: "Do I need an email address or an account?"
Answer must be 1-3 concise sentences, marketing tone, faithful to the meaning above.
Return STRICT JSON only, no markdown, shape:
{ "q": "...", "a": "..." }
Write it natively in this language: `;

async function gen(langName) {
  const body = {
    contents: [{ parts: [{ text: instruction + langName }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.5 },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`${langName}: HTTP ${res.status} ${await res.text()}`);
  const data = await res.json();
  const txt = data.candidates[0].content.parts[0].text;
  return JSON.parse(txt);
}

const out = {};
for (const [code, name] of Object.entries(langs)) {
  out[code] = await gen(name);
  console.error(`done ${code}`);
}
console.log(JSON.stringify(out, null, 2));
