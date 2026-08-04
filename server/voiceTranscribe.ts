/**
 * VOICE TRANSCRIPTS (v2.107.31) — Gemini-backed transcription + EN↔AR
 * translation for voice-note attachments.
 *
 * SERVER-SIDE ON PURPOSE, all of it:
 *   • the API key must never reach a client bundle;
 *   • the result is CACHED ON THE ATTACHMENT ROW, so a note is transcribed
 *     exactly once and every participant — and every later scroll — reads the
 *     stored text for free (messages.list already ships the full row);
 *   • the bytes are fetched through the same signed-URL lane the storage proxy
 *     uses, behind `getAttachmentForIdentity` — the ONE gate that already
 *     knows about view-once locks and participant rules.
 *
 * The MODEL CONTRACT is a JSON object, and `parseTranscriptReply` is the only
 * reader of it: models wrap JSON in prose and code fences on their worst days,
 * so the parser hunts for the object rather than trusting the envelope, and a
 * reply it cannot read returns null — which surfaces as a retryable error, not
 * as a cached wrong answer.
 */

/* ── configuration ───────────────────────────────────────────────────────── */

export function geminiKey(): string | null {
  const k = (process.env.GEMINI_API_KEY || "").trim();
  return k.length > 0 ? k : null;
}

/** Overridable so a model retirement is an env change, not a deploy. */
export const GEMINI_MODEL = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();

/** Voice notes are opus/webm and a minute is well under a megabyte; anything
 *  approaching this cap is not a voice note and would 4xx at Gemini anyway
 *  (inline audio uploads are bounded). Refused BEFORE the bytes are fetched. */
export const MAX_TRANSCRIBE_BYTES = 12 * 1024 * 1024;

/** One knob for both calls. Transcription of a minute of audio completes in a
 *  few seconds; a call still open at 45 is wedged, not slow. */
const GEMINI_TIMEOUT_MS = 45_000;

/* ── pure: the reply contract ────────────────────────────────────────────── */

/** Normalize whatever the model called the language to a lowercase 2-letter
 *  code. Accepts BCP-47 ("en-US"), names ("Arabic"), and shrugs ("unknown") —
 *  the CLIENT only branches on "en"/"ar", everything else just renders. */
export function normalizeLang(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "und";
  if (s.startsWith("ar") || s === "arabic" || s === "العربية") return "ar";
  if (s.startsWith("en") || s === "english") return "en";
  const m = s.match(/^[a-z]{2}/);
  return m ? m[0] : "und";
}

/** Parse the model's transcription reply. Tolerates code fences and prose
 *  around the object; returns null for anything that does not contain a
 *  readable `{lang, text}` — including a non-string text, which a caller must
 *  treat as "try again", never as "cache this". */
export function parseTranscriptReply(raw: string): { lang: string; text: string } | null {
  const src = String(raw ?? "");
  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(src.slice(start, end + 1)) as { lang?: unknown; text?: unknown };
    if (typeof obj.text !== "string") return null;
    return { lang: normalizeLang(obj.lang), text: obj.text.trim() };
  } catch {
    return null;
  }
}

/** The instruction the parser's contract depends on — exported so the tests can
 *  pin that the JSON shape and the VERBATIM requirement survive rewording. */
export const TRANSCRIBE_INSTRUCTION =
  'Transcribe this audio verbatim, in the language actually spoken. ' +
  'Reply with ONLY a JSON object of the exact shape {"lang":"<two-letter language code>","text":"<the transcript>"} — ' +
  'no code fences, no commentary. If nothing intelligible is spoken, use an empty text.';

export function translateInstruction(target: "en" | "ar"): string {
  const name = target === "ar" ? "Arabic" : "English";
  return (
    `Translate the following message into ${name}. ` +
    "Reply with ONLY the translation — no quotes, no commentary, keep the speaker's tone."
  );
}

/* ── the calls ───────────────────────────────────────────────────────────── */

async function callGemini(body: unknown): Promise<string | null> {
  const key = geminiKey();
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? "").join("");
    return text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Transcribe raw audio bytes. Null on any failure — the caller reports a
 *  retryable error and caches nothing. */
export async function transcribeAudio(
  bytes: Buffer,
  mimeType: string,
): Promise<{ lang: string; text: string } | null> {
  if (bytes.length === 0 || bytes.length > MAX_TRANSCRIBE_BYTES) return null;
  const reply = await callGemini({
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: bytes.toString("base64") } },
          { text: TRANSCRIBE_INSTRUCTION },
        ],
      },
    ],
  });
  return reply ? parseTranscriptReply(reply) : null;
}

/** Translate a transcript. Null on failure; the empty string is a failure too —
 *  a blank "translation" cached over real text would be strictly worse than the
 *  error it hides. */
export async function translateText(text: string, target: "en" | "ar"): Promise<string | null> {
  const reply = await callGemini({
    contents: [{ parts: [{ text: `${translateInstruction(target)}\n\n${text}` }] }],
  });
  const out = reply?.trim() ?? "";
  return out.length > 0 ? out : null;
}
