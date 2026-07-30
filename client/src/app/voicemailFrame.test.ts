import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { codeOnly } from "../../../server/testing/codeOnly";
import { VOICEMAIL_MAX_MS, CAP_LABEL, fmtClock, reasonLine } from "./VoicemailPrompt";

/* ============================================================================
   BOARD 2g VOICEMAIL — the leave-a-message card (plus 5h's recording panel)
   ============================================================================

   These pin the properties, not the pixels. The two that matter most are the
   ones about what this screen must NEVER claim: a fabricated transcript, and a
   duration the app does not implement.
   ========================================================================== */

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const VM_PATH = "client/src/app/VoicemailPrompt.tsx";
const VM_RAW = read(VM_PATH);
const VM = codeOnly(VM_RAW);
const MSG = codeOnly(read("client/src/pages/app/Messages.tsx"));
const CSS = read("client/src/index.css");
const ENGINE = read("client/src/app/RelayEngine.tsx");

/**
 * A window bounded by its OWN end, never by a fixed character count.
 *
 * A stale anchor makes `indexOf` return -1, and `slice(-1 - 900)` is
 * `slice(-901)` — which silently reads the LAST 901 characters of the file from
 * the other end. That trap hid a broken pin for nineteen releases (v2.106.20),
 * so both anchors are asserted to exist and the window is asserted non-empty.
 */
function region(src: string, startAnchor: string, endAnchor: string, minLen = 1): string {
  const a = src.indexOf(startAnchor);
  expect(a, `start anchor missing: ${startAnchor}`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(endAnchor, a + startAnchor.length);
  expect(b, `end anchor missing after start: ${endAnchor}`).toBeGreaterThan(a);
  const slice = src.slice(a, b);
  // Non-emptiness is guaranteed by `b > a`; `minLen` is for the windows where a
  // suspiciously SHORT slice would itself be the bug (a big region that has
  // silently collapsed because a neighbour moved).
  expect(slice.length, `window too short for ${startAnchor}`).toBeGreaterThanOrEqual(minLen);
  return slice;
}

const PANEL = region(VM, "function RecordPanel(", "export function VoicemailPrompt(", 2000);
const CARD = region(VM, "export function VoicemailPrompt(", "\n}\n", 2000);

describe("board 2g — this frame is the leave-a-message card, not a voicemail inbox", () => {
  it("renders no LIST of voicemails and no per-row inbox scaffolding", () => {
    // The README's Screens list describes an inbox; the BOARD's own 2g frame is
    // this card, and the board wins (MISSING-FRAMES.md / v2.106.11). There is no
    // voicemail list query, route or read model to build rows from, so nothing
    // here may pretend to enumerate them.
    expect(VM).not.toMatch(/voicemails/i);
    expect(VM).not.toMatch(/\bvoicemail\.list\b/);
  });

  it("NEVER fabricates a transcript, and the comment strip is doing real work", () => {
    // The refusal is RECORDED in the file's own prose, which is exactly why the
    // assertion has to run on stripped CODE — matching the comment that explains
    // an absence is how this repo has passed sixteen tests on English.
    expect(VM_RAW).toMatch(/transcript/i); // the recorded refusal
    expect(VM).not.toMatch(/transcript/i); // …and no code that renders one
  });

  it("the app still has no transcription anywhere, so a preview would be invented", () => {
    // A SWEEP rather than a list: this is the fact the refusal above rests on, so
    // if transcription ever lands, this test is where the decision gets revisited.
    const dirs = ["client/src", "server", "shared"];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${entry}`;
        const abs = join(ROOT, rel);
        if (statSync(abs).isDirectory()) {
          walk(rel);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
        // Stripped, because the refusal is documented in prose in at least one
        // file — matching that comment would be the prose trap again, and the
        // question here is whether any CODE transcribes anything.
        if (/transcri/i.test(codeOnly(readFileSync(abs, "utf8")))) hits.push(rel);
      }
    };
    dirs.forEach(walk);
    expect(hits).toEqual([]);
  });
});

describe("the readout is DERIVED from the cap, never a literal", () => {
  it("fmtClock formats the board's own values", () => {
    expect(fmtClock(0)).toBe("0:00");
    expect(fmtClock(7)).toBe("0:07"); // board 2g: "REC 0:07"
    expect(fmtClock(23)).toBe("0:23"); // board 5h: "0:23 / 1:00"
    expect(fmtClock(60)).toBe("1:00");
    expect(fmtClock(65)).toBe("1:05");
    expect(fmtClock(-4)).toBe("0:00");
  });

  it("the '/ 1:00' total comes from VOICEMAIL_MAX_MS", () => {
    expect(CAP_LABEL).toBe(fmtClock(VOICEMAIL_MAX_MS / 1000));
    expect(CAP_LABEL).toBe("1:00");
    // Asserted structurally as well, because a hardcoded "1:00" is behaviourally
    // identical TODAY and silently wrong the moment the cap moves — the
    // behavioural check alone cannot tell the two apart.
    expect(VM).toMatch(/CAP_LABEL = fmtClock\(VOICEMAIL_MAX_MS \/ 1000\)/);
    // A mutation that moves the cap must move the copy with it, so the readout
    // can never promise a ceiling the recorder does not enforce.
    expect(PANEL).toContain("{CAP_LABEL}");
    expect(PANEL).not.toMatch(/"1:00"|'1:00'|\/ 1:00/);
  });

  it("states no no-answer duration the app does not implement", () => {
    // Board 2g says "No answer after 30 seconds"; the real backstop is 65_000ms.
    expect(VM).not.toMatch(/\d+\s*seconds?/);
    // Nor the board's other unbuilt claims: no greeting feature exists, nothing
    // is end-to-end encrypted here, and this card cannot decline a live call.
    expect(VM).not.toMatch(/greeting/i);
    expect(VM).not.toMatch(/encrypt/i);
    expect(VM).not.toMatch(/declines the call/i);
  });

  it("reasonLine still answers all three real reasons distinctly", () => {
    const a = reasonLine("peer-rejected");
    const b = reasonLine("server-error:offline");
    const c = reasonLine("no-answer");
    expect(new Set([a, b, c]).size).toBe(3);
    expect(b).toBe("They're offline right now.");
    expect(c).toBe("They didn't answer.");
  });
});

describe("the clock and the rail read the recorder's OWN elapsed time", () => {
  it("reads elapsedMs() and never a wall clock", () => {
    // `elapsedMs()` excludes paused time. A `Date.now() - startedAt` — which is
    // what this card used to do — over-reports a paused take, so the readout
    // would claim audio the recipient will not hear and the rail would run past
    // a cap that never fired.
    expect(PANEL).toMatch(/rec\.elapsedMs\(\)/);
    expect(PANEL).not.toMatch(/Date\.now\(/);
    expect(PANEL).not.toMatch(/setInterval\(/);
  });

  it("the fill is a bounded scaleX transform, never an animated width", () => {
    expect(PANEL).toMatch(/Math\.min\(1,\s*ms \/ VOICEMAIL_MAX_MS\)/);
    expect(PANEL).toMatch(/style\.transform = `scaleX\(/);
    expect(PANEL).not.toMatch(/style\.width/);
  });
});

describe("discard, pause and the microphone", () => {
  it("Discard routes through the shared handle's cancel() and is really wired", () => {
    // New function, not a restyle: before this frame, Stop-and-send was the only
    // exit from a live recording (the header X dismissed the whole card).
    expect(CARD).toMatch(/function discardRecording\(\) \{\s*recRef\.current\?\.cancel\(\);/);
    expect(CARD).toMatch(/onDiscard=\{discardRecording\}/);
    // …and the button is a real control with a real handler, not a decoration.
    expect(PANEL).toMatch(/onClick=\{onDiscard\}/);
  });

  it("a discarded take returns to the idle card rather than closing it", () => {
    // `cancel()` resolves `done` null. Closing the card there would take away
    // the text message and the back-online alert as well.
    const nullBranch = region(CARD, "if (!result) {", "setRecState(\"sending\")");
    expect(nullBranch).toMatch(/setRecState\("idle"\)/);
    expect(nullBranch).not.toMatch(/onClose/);
  });

  it("pause/resume go through the handle and read its state BACK", () => {
    const fn = region(CARD, "function togglePause()", "async function sendText()");
    expect(fn).toMatch(/rec\.state\(\) === "recording"\) rec\.pause\(\)/);
    expect(fn).toMatch(/rec\.resume\(\)/);
    // An engine without MediaRecorder.pause leaves the recorder running, which
    // is why voiceNote.ts exposes state() at all — assuming would lie.
    expect(fn).toMatch(/setPaused\(rec\.state\(\) === "paused"\)/);
  });

  it("every panel control is wired to the real handler, not to an inert one", () => {
    // FOUND BY MUTATION: the three assertions above pin what `togglePause` DOES
    // and said nothing about whether the button calls it — pointing the control
    // at `() => {}` left the whole file green while pause silently stopped
    // existing. Pinning a rule's presence is not pinning its use.
    for (const prop of ["onTogglePause", "onDiscard", "onSend"]) {
      expect(PANEL, prop).toMatch(new RegExp(`onClick=\\{${prop}\\}`));
    }
    expect(CARD).toMatch(/onTogglePause=\{togglePause\}/);
    expect(CARD).toMatch(/onDiscard=\{discardRecording\}/);
    expect(CARD).toMatch(/onSend=\{stopRecording\}/);
    // …and none of them is an inline no-op.
    expect(PANEL).not.toMatch(/onClick=\{\(\) => \{\s*\}\}/);
  });

  it("never touches the microphone directly", () => {
    // Every release path lives on the VoiceRecording handle (onstop stops the
    // tracks and closes the AudioContext). A second capture here would be a mic
    // nothing can release — the one unrecoverable failure on this surface.
    expect(VM).not.toMatch(/getUserMedia/);
    expect(VM).not.toMatch(/new MediaRecorder/);
    expect(VM).not.toMatch(/MediaStream/);
  });

  it("keeps the two mount-safety guards mediaRelease.test.ts pins", () => {
    expect(VM).toMatch(/if \(!aliveRef\.current\) \{ rec\.cancel\(\); return; \}/);
    expect(VM).toMatch(/recRef\.current\?\.cancel\(\)/);
  });
});

describe("colour vocabulary", () => {
  it("spends no presence green anywhere — green means ONLINE and nothing else", () => {
    // Fifth-and-sixth occurrence of this habit: the two confirmation ticks here
    // were painted with `--relay-online`. Neither is a presence statement (one
    // says a voicemail was sent, one says an alert was registered).
    expect(VM).not.toMatch(/--relay-online/);
    expect(VM).not.toMatch(/--relay-dnd/);
  });

  it("every accent reference carries a LITERAL fallback (no custom-property cycle)", () => {
    // A SWEEP, so the accent somebody adds next is covered too. `var(--rb,
    // var(--rb))` is a cycle: it resolves to the guaranteed-invalid value and the
    // browser DROPS the declaration, leaving no colour at all (v2.106.7).
    const bare = VM.match(/var\(--rb(?!-rgb)[^)]*\)/g) ?? [];
    expect(bare.length).toBeGreaterThan(0);
    for (const m of bare) expect(m, m).toMatch(/^var\(--rb, #[0-9A-Fa-f]{6}\)$/);
    const rgb = VM.match(/var\(--rb-rgb[^)]*\)/g) ?? [];
    expect(rgb.length).toBeGreaterThan(0);
    for (const m of rgb) expect(m, m).toMatch(/^var\(--rb-rgb, \d+, \d+, \d+\)$/);
    expect(VM).not.toContain("var(--rb, var(--rb))");
  });

  it("composes no Tailwind class name at runtime", () => {
    // A class assembled at render time is invisible to the JIT and renders
    // completely unstyled; dynamic colour goes in an inline style.
    expect(VM).not.toMatch(/-\[\$\{/);
  });

  it("agrees with the composer's recording bar about send and the red dot", () => {
    // The app has TWO recording surfaces. Asserted in BOTH files so a restyle of
    // one cannot silently diverge from the other.
    for (const [name, src] of [["voicemail", PANEL], ["composer", MSG]] as const) {
      expect(src, name).toMatch(/bg-destructive motion-safe:animate-pulse/);
    }
    expect(PANEL).toMatch(/className="rcta grid size-\[54px\]/);
    expect(MSG).toMatch(/className="rcta grid size-9 shrink-0 place-items-center rounded-full/);
  });
});

describe("motion", () => {
  it("every animation here is motion-safe gated and namespaced", () => {
    const anims = VM.match(/\[animation:[^\]]+\]/g) ?? [];
    expect(anims.length).toBeGreaterThan(0);
    for (const a of anims) {
      expect(VM, a).toContain(`motion-safe:${a}`);
      expect(a, a).toMatch(/\[animation:relay[A-Z]/);
    }
    // Tailwind's own animate-* utilities likewise.
    for (const m of VM.match(/(?<![:\w-])animate-[a-z]+/g) ?? []) {
      expect(VM, m).toContain(`motion-safe:${m}`);
    }
  });

  it("the keyframe it relies on animates only transform and opacity", () => {
    const kf = region(CSS, "@keyframes relayPing", "@keyframes relayPulse");
    expect(kf).toMatch(/transform:/);
    expect(kf).not.toMatch(/box-shadow|height|width|filter|background-position|border-color/);
  });
});

describe("material and scoping", () => {
  it("the wrapper carries relay-v2 and deliberately NOT dark", () => {
    // `.rcta` is `.relay-v2`-scoped, so carrying that class here makes the CTA
    // work however this overlay is reached. `dark` is NOT added: `.rsheet` is
    // `.dark.relay-v2`-scoped precisely so the LIGHT theme is byte-identical
    // (v2.106.10), and this card has always been `bg-card` — light in light.
    const wrapper = region(VM, "return (\n    <div\n      className=", "role=\"alertdialog\"");
    expect(wrapper).toContain("relay-v2");
    expect(wrapper).not.toMatch(/\bdark\b/);
    expect(VM).toMatch(/className="rsheet /);
    expect(CSS).toMatch(/\.dark\.relay-v2 \.rsheet \{/);
  });

  it("does NOT put .rscrim on the modal backdrop", () => {
    // `.rscrim` is the over-the-canvas scrim: a radial gradient that is fully
    // TRANSPARENT for the inner 50%. On a modal backdrop it would let the app
    // show straight through the middle, i.e. remove the dimming.
    expect(VM).not.toContain("rscrim");
    const rule = region(CSS, ".relay-v2 .rscrim {", "}");
    expect(rule).toContain("radial-gradient");
    expect(rule).toContain("rgba(4, 7, 10, 0)");
    // …and the backdrop keeps a real dimming layer.
    expect(VM).toContain("bg-black/70");
  });
});

describe("the avatar is decorative and degrades to nothing", () => {
  it("the peer lookup is shape-gated, non-retrying, and never blocks the card", () => {
    const q = region(CARD, "const peer = trpc.directory.lookup.useQuery(", "const [recState");
    expect(q).toMatch(/enabled: \/\^\\d\{6\}\$\/\.test\(info\.pin\)/);
    expect(q).toMatch(/retry: false/);
    // Nothing gates the card on the query: a directoryGate refusal or an
    // in-flight read must not be the reason somebody cannot leave a voicemail.
    expect(CARD).not.toMatch(/peer\.(isLoading|isPending|isError)/);
    expect(CARD).toMatch(/peer\.data\?\.avatarUrl \?\? null/);
    expect(CARD).toMatch(/peer\.data\?\.role \?\? null/);
  });

  it("a photo that fails falls back to initials, never a broken-image glyph", () => {
    const av = region(VM, "function CalleeAvatar(", "function RecordPanel(");
    expect(av).toMatch(/onError=\{\(\) => setFailedUrl/);
    expect(av).toMatch(/showPhoto \?/);
    expect(av).toMatch(/initialsOf\(label\)/);
  });

  it("does not import PeerOverlays, because that would close an import cycle", () => {
    // RelayEngine → VoicemailPrompt → PeerOverlays → RelayEngine, and
    // `useRelayEngine` is a `const` export: a TDZ hazard inside the entry chunk.
    expect(VM).not.toMatch(/PeerOverlays/);
    expect(ENGINE).toMatch(/from "\.\/VoicemailPrompt"/);
    expect(codeOnly(read("client/src/app/PeerOverlays.tsx"))).toMatch(
      /import \{ useRelayEngine \} from "\.\/RelayEngine"/,
    );
    expect(read("client/src/app/RelayEngine.tsx")).toMatch(/export const useRelayEngine =/);
  });
});

describe("shipped behaviour survives the reskin", () => {
  it("the idle card still offers all THREE ways to reach the person, by handler", () => {
    // Asserted on the HANDLERS, not the copy: `if (false && …)` leaves every
    // string in place while the control stops doing anything.
    expect(CARD).toMatch(/onClick=\{sendText\}/);
    expect(CARD).toMatch(/onClick=\{beginRecording\}/);
    expect(CARD).toMatch(/onClick=\{requestWatch\}/);
    expect(CARD).toMatch(/Leave a voice message/);
    expect(CARD).not.toMatch(/if \(false/);
  });

  it("still sends the voicemail as a meta-tagged audio message in the DM thread", () => {
    expect(CARD).toMatch(/kind: "audio"/);
    expect(CARD).toMatch(/meta: \{ voicemail: true \}/);
    expect(CARD).toMatch(/openThread\.mutateAsync\(\{ number: info\.pin \}\)/);
  });
});
