/**
 * FEATURE ROADMAP WAVE 1 (v2.107.52) — playback speed (QW-1) and the draft
 * indicator (QW-2), docs/feature-roadmap.md.
 *
 * House style: source-string pins over the stripped source, plus REAL unit
 * tests where the module runs headless — draftStore does (localStorage is
 * stubbed the way a browser would provide it), so its listener contract is
 * exercised for real rather than pinned.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const messagesSrc = codeOnly(read("../pages/app/Messages.tsx"));
const storeSrc = codeOnly(read("./draftStore.ts"));
const dictSrc = read("./dict/messages.ts");

/* ─────────────────────────── QW-1: playback speed ─────────────────────────── */

describe("QW-1 — voice playback speed", () => {
  it("offers WhatsApp's exact cycle, 1× → 1.5× → 2×", () => {
    expect(messagesSrc).toMatch(/VOICE_RATES = \[1, 1\.5, 2\] as const/);
  });

  it("reads the stored speed defensively (bad or missing storage ⇒ 1×)", () => {
    expect(messagesSrc).toMatch(/function readVoiceRate\(\): number \{\s*try \{/);
    expect(messagesSrc).toMatch(/localStorage\.getItem\("relay_voice_rate"\)/);
    expect(messagesSrc).toMatch(/catch \{\s*return 1;/);
  });

  it("applies the STORED rate at element creation — the chained run inherits it", () => {
    // ensure() creates the element; the very next lines must set both rate
    // fields from storage, not from this bubble's state.
    expect(messagesSrc).toMatch(
      /a\.preload = "metadata";[\s\S]{0,400}a\.defaultPlaybackRate = readVoiceRate\(\);\s*a\.playbackRate = a\.defaultPlaybackRate;/,
    );
  });

  it("cycling persists the choice and retunes the live element", () => {
    expect(messagesSrc).toMatch(/localStorage\.setItem\("relay_voice_rate", String\(next\)\)/);
    expect(messagesSrc).toMatch(/a\.playbackRate = next;\s*a\.defaultPlaybackRate = next;/);
  });

  it("the pill sits between the two clocks and is labelled for readers", () => {
    expect(messagesSrc).toMatch(
      /fmtClock\(cur\)[\s\S]{0,900}aria-label=\{t\("msg\.playbackSpeed"\)\}[\s\S]{0,900}\{rate\}×/,
    );
  });
});

/* ─────────────────────────── QW-2: draft indicator ─────────────────────────── */

describe("QW-2 — draft indicator on thread rows", () => {
  it("draftStore exposes the change signal and both writers fire it", () => {
    expect(storeSrc).toMatch(/export function onDraftsChange\(cb: \(\) => void\)/);
    // saveDraftNow's notify comes after its try/catch; clearDraft's likewise.
    const notifies = storeSrc.match(/notify\(\);/g) ?? [];
    expect(notifies.length).toBeGreaterThanOrEqual(2);
  });

  it("the list subscribes once and repaints via a bare tick", () => {
    expect(messagesSrc).toMatch(/useEffect\(\(\) => onDraftsChange\(\(\) => setDraftsTick\(\(v\) => v \+ 1\)\), \[\]\)/);
  });

  it("a draft is read for every row EXCEPT the active and the locked one", () => {
    expect(messagesSrc).toMatch(
      /const draftText = !isActive && !hidden \? getDraft\(t\.conversationId\)\.text\.trim\(\) : "";/,
    );
  });

  it("the draft wins line 2 ahead of the receipt+preview branch", () => {
    expect(messagesSrc).toMatch(/\) : draftText \? \(/);
    expect(messagesSrc).toMatch(/\{tr\("msg\.draft"\)\}/);
  });

  it("the marker is the QUIET treatment — italics, no unread/online/mute colour", () => {
    const m = messagesSrc.match(/draftText[\s\S]{0,900}?\{tr\("msg\.draft"\)\}/);
    expect(m).toBeTruthy();
    expect(m![0]).toMatch(/italic text-foreground\/75/);
    expect(m![0]).not.toMatch(/text-primary|--relay-online|amber/);
  });

  it("both locales carry both new keys", () => {
    expect(dictSrc).toMatch(/"msg\.draft": \{ en: "Draft", ar: "مسودة" \}/);
    expect(dictSrc).toMatch(/"msg\.playbackSpeed": \{ en: "Playback speed", ar: "سرعة التشغيل" \}/);
  });
});

/* ─────────────────── draftStore, exercised for real ─────────────────── */

describe("draftStore listener contract (live, stubbed storage)", () => {
  let bag: Record<string, string>;

  beforeEach(() => {
    bag = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => (k in bag ? bag[k] : null),
      setItem: (k: string, v: string) => {
        bag[k] = v;
      },
      removeItem: (k: string) => {
        delete bag[k];
      },
    };
  });

  it("save → listener fires and getDraft round-trips; clear → fires again and empties", async () => {
    const { saveDraftNow, clearDraft, getDraft, onDraftsChange } = await import("./draftStore");
    let fired = 0;
    const off = onDraftsChange(() => {
      fired += 1;
    });

    saveDraftNow(910001, { text: "typed and left", replyToId: null });
    expect(fired).toBe(1);
    expect(getDraft(910001).text).toBe("typed and left");

    clearDraft(910001);
    expect(fired).toBe(2);
    expect(getDraft(910001).text).toBe("");

    off();
    saveDraftNow(910001, { text: "after unsubscribe", replyToId: null });
    expect(fired).toBe(2);
  });

  it("an empty draft save REMOVES the key (no phantom Draft rows) yet still notifies", async () => {
    const { saveDraftNow, onDraftsChange } = await import("./draftStore");
    let fired = 0;
    onDraftsChange(() => {
      fired += 1;
    });
    saveDraftNow(910002, { text: "x", replyToId: null });
    saveDraftNow(910002, { text: "", replyToId: null });
    expect(Object.keys(bag).some((k) => k.includes("910002"))).toBe(false);
    expect(fired).toBe(2);
  });
});
