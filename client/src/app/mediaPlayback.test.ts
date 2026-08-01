import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";

/**
 * v2.106.89 — THE THREE MEDIA BUGS THE OWNER REPORTED, IN ONE PLACE.
 *
 * (1) *"this voice bar … the iPhone showing [broken] … when you send him voice message
 *     from outside from anywhere."*
 * (2) *"you cannot play two multimedia files in the same time … if they are below each
 *     other it will run the first will end will go to the second … if they were separate
 *     message, no it will only run one message."*
 * (3) *"before it was showing only when you created but when you change it doesn't
 *     appear"* (the group photo).
 *
 * ── (1) WHAT WAS ACTUALLY WRONG, MEASURED ────────────────────────────────────────────
 * `pickAudioMime` preferred `audio/webm;codecs=opus`, so an ANDROID phone records WebM —
 * and iOS Safari has no WebM demuxer at all. Direction-specific by construction, which is
 * why it only ever broke one way: Safari records `audio/mp4`, which Android can decode.
 *
 * AND THE OBVIOUS FIX WOULD HAVE BEEN WORSE. Measured in this repo's Chromium 141:
 * `isTypeSupported("audio/mp4")` answers **true** and the recorder then reveals
 * `audio/mp4;codecs=opus` — Opus in a real MP4 container (`ftypisom` in the bytes). Safari
 * cannot decode that either, so preferring bare `audio/mp4` ships a file that LOOKS
 * correct and still fails, which is strictly harder to diagnose than the honest WebM
 * failure. That is v2.98.0's video-mislabel trap on the audio side, and it is why the
 * preference asks for AAC by name and why `isAacMp4` refuses a type with no codecs
 * parameter at all.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const VOICE = read("client/src/lib/voiceNote.ts");
const EXCL = read("client/src/app/mediaExclusive.ts");
const MESSAGES = codeOnly(read("client/src/pages/app/Messages.tsx"));
const GROUPAV = read("client/src/app/GroupAvatar.tsx");
/* Comment-stripped: this file EXPLAINS the imperative hide it replaces, so a raw sweep
   for it matches the prose describing its own removal — the trap this repo keeps hitting. */
const GROUPAV_CODE = codeOnly(GROUPAV);
const SHEET = read("client/src/app/GroupInfoSheet.tsx");
const SHELL = read("client/src/app/AppShell.tsx");

/* The pure predicate is re-declared from source so the shape rule can be DRIVEN — which
   is the only way to answer "does bare audio/mp4 count as proven AAC", and that question
   is the whole of the trap. Pinned byte-identical below so the copy cannot drift. */
function isAacMp4(mimeType: string): boolean {
  const m = (mimeType || "").toLowerCase();
  if (!m.startsWith("audio/mp4")) return false;
  if (!m.includes("codecs=")) return false;
  return m.includes("mp4a") || m.includes("aac");
}

describe("(1) a voice note recorded on Android can be played on an iPhone", () => {
  /* THE ORDER IS READ INSIDE THE CANDIDATE LIST, not across the whole file (v2.106.89).
     The first version compared `indexOf("audio/mp4;codecs=mp4a.40.2")` against the WebM
     entry — and that string ALSO occurs in the `AAC_MP4` const ABOVE the list, which is
     unconditionally earlier, so the comparison was satisfied by the DECLARATION however
     the list itself was ordered. Found by mutation: reinstating the original WebM-first
     defect SURVIVED it. Pinning where a rule is declared says nothing about where it is
     used — the class this repo keeps re-learning. */
  const CANDIDATES = (() => {
    const at = VOICE.indexOf("const candidates: AudioMimePick[] = [");
    expect(at, "the candidate list must exist").toBeGreaterThan(-1);
    const body = VOICE.slice(at, VOICE.indexOf("\n  ];", at));
    expect(body.length, "the slice must be real").toBeGreaterThan(120);
    return body;
  })();

  it("AAC-in-MP4 is preferred OVER WebM, because WebM is the half no iPhone can read", () => {
    const aac = CANDIDATES.indexOf("AAC_MP4.map");
    const webm = CANDIDATES.indexOf('{ mimeType: "audio/webm;codecs=opus"');
    expect(aac, "an explicit AAC spelling must be in the list").toBeGreaterThan(-1);
    expect(webm, "WebM must remain as the fallback").toBeGreaterThan(-1);
    expect(aac).toBeLessThan(webm);
    // …and the list really spells AAC out rather than relying on bare `audio/mp4`.
    expect(VOICE).toMatch(/const AAC_MP4 = \["audio\/mp4;codecs=mp4a\.40\.2"/);
  });

  it("BARE audio/mp4 is never preferred over WebM — measured, it is Opus in disguise", () => {
    /* THE LOAD-BEARING ORDERING. Chromium answers `isTypeSupported("audio/mp4")` true and
       then writes Opus into the MP4. Ranking it above WebM would replace an honest
       failure with a disguised one. */
    const bare = CANDIDATES.indexOf('{ mimeType: "audio/mp4", ext');
    const webm = CANDIDATES.indexOf('{ mimeType: "audio/webm;codecs=opus"');
    expect(bare).toBeGreaterThan(-1);
    expect(webm).toBeGreaterThan(-1);
    expect(bare).toBeGreaterThan(webm);
  });

  it("isAacMp4 treats an UNPROVEN type as not proven", () => {
    // The exact string the recorder reveals when it is lying.
    expect(isAacMp4("audio/mp4;codecs=opus")).toBe(false);
    // No codecs parameter is what bare audio/mp4 reports before it admits to Opus.
    expect(isAacMp4("audio/mp4")).toBe(false);
    expect(isAacMp4("")).toBe(false);
    expect(isAacMp4("audio/webm;codecs=opus")).toBe(false);
    // …and the genuine article passes, in the spellings engines actually emit.
    expect(isAacMp4("audio/mp4;codecs=mp4a.40.2")).toBe(true);
    expect(isAacMp4("AUDIO/MP4;CODECS=MP4A.40.2")).toBe(true);
    expect(isAacMp4("audio/mp4;codecs=aac")).toBe(true);
  });

  it("the re-declared predicate is the source's, statement for statement", () => {
    /* The one weakness of driving a copy is the original changing underneath it. Compared
       from each BODY's opening brace — the SIGNATURES legitimately differ, because the
       source is TypeScript and `toString()` hands back the transpiled form with the types
       erased (the v2.106.57 lesson: never byte-compare those two). */
    const at = VOICE.indexOf("export function isAacMp4");
    expect(at).toBeGreaterThan(-1);
    const strip = (x: string) => x.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "").replace(/\s+/g, "");
    const bodyOf = (x: string) => strip(x.slice(x.indexOf("{")));
    const source = bodyOf(VOICE.slice(at, VOICE.indexOf("\n}", at) + 2));
    expect(source.length, "the slice must be real").toBeGreaterThan(60);
    expect(source).toBe(bodyOf(isAacMp4.toString()));
  });

  it("a note this engine cannot decode says so instead of rendering a dead control", () => {
    /* The owner's actual screen: a play button that never plays and a bar pinned at zero.
       No recording change can help a note ALREADY SENT, so the player has to be honest. */
    expect(MESSAGES).toMatch(/setUndecodable\(true\)/);
    expect(MESSAGES).toMatch(/if \(undecodable\) \{/);
    expect(MESSAGES).toMatch(/msg\.voiceUnsupported/);
    // The download still works — it is this ENGINE that cannot read the bytes.
    const at = MESSAGES.indexOf("if (undecodable) {");
    const branch = MESSAGES.slice(at, MESSAGES.indexOf("\n  return (", at));
    expect(branch.length).toBeGreaterThan(100);
    expect(branch).toMatch(/download=\{true\}/);
  });

  it("the RECORDING meter's context is resumed — on iOS it is born suspended", () => {
    /* THE SECOND, INDEPENDENT iOS DEFECT, on the other half of the feature. `getUserMedia`
       is awaited before the AudioContext is constructed, so the synchronous user gesture
       is gone and WebKit starts that context SUSPENDED. A suspended context does not run
       its graph, so `getByteTimeDomainData` returns the all-128 midpoint fill and
       `level()` returns exactly 0 — the 30 recording bars sit flat at their floor for the
       whole take. That is the owner's *"no wave when you talk"* on iPhone.

       This repo already knew it: `relayClient.ts` resumes for the IDENTICAL
       mic → analyser → level pattern, and `dtmf.ts` names it in prose as the classic iOS
       Web Audio race. The recorder was never given the line. */
    const at = VOICE.indexOf("ac = new Ctor();");
    expect(at, "the meter's context must exist").toBeGreaterThan(-1);
    const block = VOICE.slice(at, VOICE.indexOf("levelBuf = new Uint8Array", at));
    expect(block.length, "the slice must be real").toBeGreaterThan(100);
    expect(block).toMatch(/ac\.resume\?\.\(\)/);
    // BEFORE the graph is wired, and fire-and-forget — a meter must never delay a take.
    expect(block.indexOf("ac.resume")).toBeLessThan(block.indexOf("createMediaStreamSource"));
    expect(block).toMatch(/void ac\.resume/);
  });

  it("the sibling that already got this right still has it", () => {
    /* The comparison that makes the finding above a gap rather than a preference. */
    const RC = read("client/src/lib/relayClient.ts");
    expect(RC).toMatch(/void meshAudioCtx\.resume\(\)/);
  });

  it("only a DECODE failure latches — a network blip must stay retryable", () => {
    /* Permanently marking a note unplayable because one fetch failed would be worse than
       the frozen bar it replaces. MEDIA_ERR_DECODE (3) / SRC_NOT_SUPPORTED (4) only. */
    expect(MESSAGES).toMatch(/code === 3 \|\| code === 4/);
  });
});

describe("(2) one thing plays at a time, app-wide", () => {
  it("the listener is on DOCUMENT in the CAPTURE phase — `play` does not bubble", () => {
    expect(EXCL).toMatch(/document\.addEventListener\(\s*"play"/);
    // The `true` is the whole mechanism: without capture this listener sees nothing.
    const at = EXCL.indexOf('document.addEventListener(\n    "play"');
    expect(at).toBeGreaterThan(-1);
    expect(EXCL.slice(at, at + 600)).toMatch(/true, \/\/ CAPTURE/);
  });

  it("A LIVE CALL'S AUDIO IS NEVER PAUSED — the one exclusion, and the safety argument", () => {
    /* v2.106.51 gives every mesh peer its own `<audio>` appended to its tile, so call
       audio really is in the document and really would be caught. Pausing one would
       present as "the other person went quiet", which is the hardest class of failure to
       trace and strictly worse than the bug being fixed. */
    expect(EXCL).toMatch(/const CALL_ROOT = "\.relay-root"/);
    expect(EXCL).toMatch(/function isCallMedia/);
    // Both paths must consult it: the sweep AND the listener.
    expect(EXCL.match(/isCallMedia\(/g) ?? []).toHaveLength(3); // decl + 2 call sites
  });

  it("the call root really is the call surface's own container", () => {
    /* A rule keyed on a class nothing carries is a rule that protects nothing. */
    const ASSETS = read("client/src/lib/relayAssets.ts");
    expect(ASSETS).toMatch(/relay-root/);
  });

  it("a detached `new Audio()` is registered by hand, because document never sees it", () => {
    expect(EXCL).toMatch(/export function registerDetachedMedia/);
    expect(MESSAGES).toMatch(/unregisterRef\.current = registerDetachedMedia\(a\)/);
    // …and dropped on unmount, or a thread switch leaks a registry entry per note.
    expect(MESSAGES).toMatch(/unregisterRef\.current\?\.\(\)/);
  });

  it("the player claims playback BEFORE it starts rather than relying on the listener", () => {
    const at = MESSAGES.indexOf("const toggle = () => {");
    expect(at).toBeGreaterThan(-1);
    const body = MESSAGES.slice(at, MESSAGES.indexOf("\n  };", at));
    const claim = body.indexOf("pauseOthers(a)");
    const play = body.indexOf("a.play()");
    expect(claim).toBeGreaterThan(-1);
    expect(play).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(play);
  });

  it("the rule is installed from the SHELL, not from whichever surface mounts first", () => {
    /* Otherwise the media lightbox and the story viewer are uncovered in any session
       where no voice note happened to render. */
    expect(SHELL).toMatch(/installExclusivePlayback\(\)/);
    expect(SHELL).toMatch(/from "\.\/mediaExclusive"/);
  });

  it("a MUTED element is decoration and is left alone", () => {
    /* The conversation's video THUMBNAIL is a muted `<video preload="metadata">`; pausing
       it would change nothing anybody can perceive while costing a DOM write per element
       per play. */
    expect(EXCL).toMatch(/if \(el\.muted\) continue;/);
  });
});

describe("(2b) a run of voice notes plays itself through", () => {
  it("the chain is ONE step, to the message directly below, and only if it is a note", () => {
    /* The owner's own line draws the boundary: *"if they were separate message, no it
       will only run one message."* So no sender window and no time window — position
       and kind, nothing else. A run of three chains by each note owning its own step. */
    expect(MESSAGES).toMatch(
      /const nextVoiceId =\s*\n?\s*next && next\.attachment\?\.mimeType\?\.startsWith\("audio\/"\) \? next\.id : null;/,
    );
  });

  it("the hand-over reads a REF, so a run that changed underneath cannot misfire", () => {
    /* The `ended` listener is installed once for the element's whole life while the run
       can change under it (a message arrives between two notes, or one is unsent). A
       captured prop would advance to a note that is no longer next. */
    expect(MESSAGES).toMatch(/advanceVoiceRun\(nextVoiceIdRef\.current\)/);
    expect(MESSAGES).toMatch(/nextVoiceIdRef\.current = nextVoiceId/);
  });

  it("a note registers HOW to play rather than its element", () => {
    /* A note nobody has played has no element yet — the player builds it lazily — so a
       registry of elements would simply miss every unplayed note, i.e. all of them. */
    expect(EXCL).toMatch(/const voiceRuns = new Map<number, \(\) => void>/);
    expect(MESSAGES).toMatch(/registerVoiceNote\(messageId, \(\) => \{/);
  });

  it("a refused hand-over fails quietly", () => {
    /* iOS can refuse a play the user did not initiate. The chain stopping is fine; an
       error about something nobody asked for is not. */
    expect(EXCL).toMatch(/export function advanceVoiceRun/);
    const at = EXCL.indexOf("export function advanceVoiceRun");
    const body = EXCL.slice(at);
    expect(body).toMatch(/if \(nextMessageId == null\) return false;/);
    expect(body).toMatch(/catch \{\s*\n\s*return false;/);
  });
});

describe("(3) a CHANGED group photo appears", () => {
  it("the failure is React state keyed on the URL, never an imperative style write", () => {
    /* THE BUG. Every site hid a failed image with `style.display = "none"` on the DOM
       node, and React reuses that node across a `src` change — so the inline style
       written for the OLD url survives onto the new one and the changed photo loads
       perfectly and is invisible. */
    expect(GROUPAV).toMatch(/const \[failedFor, setFailedFor\] = useState<string \| null>\(null\)/);
    expect(GROUPAV).toMatch(/const broken = !!url && failedFor === url/);
    expect(GROUPAV_CODE).not.toMatch(/style\.display/);
    // …and the strip is doing real work rather than hiding a defect: the reason IS recorded.
    expect(GROUPAV).toMatch(/style\.display/);
  });

  it("GroupAvatar APPLIES the label it is handed, not merely accepts it", () => {
    /* FOUND BY MUTATION (v2.106.91), and it is the v2.106.61 class: the coverage sweep
       proves `msg.groupConversation` has a READER, which the call site satisfies — and
       says nothing about whether the component does anything with it. Dropping the
       attribute left the key "wired" and the screen reader with nothing. */
    expect(GROUPAV).toMatch(/aria-label=\{label\}/);
    // `role="img"` only when there IS a label — an unlabelled decorative disc must not
    // announce itself as an image with no name.
    expect(GROUPAV).toMatch(/role=\{label \? "img" : undefined\}/);
  });

  it("the glyph is UNDERNEATH the photo, not its else-branch", () => {
    /* v2.106.66 made exactly this fix in one sheet and recorded why — hiding a broken
       `<img>` left a hole. The thread row and the header kept the else-branch shape. */
    const at = GROUPAV.indexOf("ALWAYS RENDERED");
    expect(at, "the reason must be recorded in place").toBeGreaterThan(-1);
    const after = GROUPAV.slice(at);
    expect(after.indexOf("<Users")).toBeLessThan(after.indexOf("<img"));
  });

  it("all three surfaces use the ONE component — a copy is how a copy misses the fix", () => {
    expect(MESSAGES.match(/<GroupAvatar/g) ?? []).toHaveLength(2); // row + chat header
    // The sheet's hero keeps its own bespoke 26px-radius shape, so it is keyed instead.
    expect(SHEET).toMatch(/key=\{avatarUrl\}/);
  });

  it("no group photo is rendered by a raw <img> with an imperative hide any more", () => {
    /* The sweep, so the NEXT surface cannot reintroduce the shape. */
    for (const [name, src] of [["Messages", MESSAGES], ["GroupAvatar", GROUPAV]] as const) {
      expect(src, `${name} must not hide a group photo imperatively`).not.toMatch(
        /groupAvatarUrl[\s\S]{0,400}?style\.display = "none"/,
      );
    }
  });

  it("the save still invalidates BOTH reads, so the list and the sheet cannot disagree", () => {
    const at = SHEET.indexOf("const save = trpc.messages.setGroupProfile.useMutation");
    expect(at).toBeGreaterThan(-1);
    const body = SHEET.slice(at, SHEET.indexOf("\n  /**", at));
    expect(body).toMatch(/utils\.messages\.threads\.invalidate\(\)/);
    expect(body).toMatch(/utils\.messages\.conversationInfo\.invalidate/);
  });
});
