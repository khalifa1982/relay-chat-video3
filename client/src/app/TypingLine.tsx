/**
 * The "X is typing…" line, with the owner's animation.
 *
 * Owner: "when I type it should showing typing like my name typing and it's like
 * first name is capital small letter for the rest and it keep increase. the second
 * letter become capital and the first one small. it's like nice animation smoothly
 * … and it give a different color if there is two three people typing in the same
 * time like I'm typing and the other user typing it will show for him."
 *
 * So: the name is rendered letter by letter with exactly ONE letter capitalised at
 * a time, and that capital walks along the name and repeats. Each person typing
 * gets their own colour, taken from the SAME module the bubbles use so a name and
 * that person's bubble always agree.
 *
 * IT IS ITS OWN COMPONENT, AND THAT IS THE POINT rather than tidiness. This ticks
 * several times a second; inline in the conversation it would re-render the whole
 * message list on every step — the v2.99.67 mistake, and the reason v2.99.73's
 * waveform is written imperatively. Isolated here, a tick repaints one short line.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { nameColorFor } from "./peerColors";

/** How fast the capital walks. Slow enough to read, quick enough to look alive. */
export const STEP_MS = 260;

/**
 * Built with the CONSTRUCTOR, not as a `/…/u` literal: this repo targets a
 * downlevel ES version where a literal `u` flag is a compile error (TS1501), and
 * the constructor form is the house workaround. Unicode-aware on purpose, so an
 * Arabic name walks its letters too rather than being treated as punctuation.
 */
const IS_LETTER = new RegExp("\\p{L}", "u");

/**
 * One name with a single walking capital.
 *
 * The step counter is the ONLY state, and it is a plain integer rather than the
 * rendered string — a string would allocate per tick for no gain, and the letters
 * are derived cheaply.
 */
/**
 * A person's palette colour is handed over as `--rname` rather than as `color`, so the
 * `.rname` rule in `index.css` can darken it for the LIGHT theme (v2.107.27). These are
 * light tints picked for a near-black page; on the light one they measured 1.34–1.71:1.
 * Dark mixes at 100%, which returns the hex untouched.
 */
function rnameStyle(color: string): CSSProperties {
  return { "--rname": color } as CSSProperties;
}

function WalkingName({ name, color, offset }: { name: string; color: string; offset: number }) {
  const letters = Array.from(name);
  // Only the letters are candidates for the capital: walking onto a space or a
  // hyphen would look like the animation had stalled for a beat.
  const idxs = letters.map((c, i) => (IS_LETTER.test(c) ? i : -1)).filter((i) => i >= 0);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (idxs.length < 2) return; // nothing to walk
    const t = setInterval(() => setStep((s) => s + 1), STEP_MS);
    return () => clearInterval(t);
    // idxs.length, not idxs — a fresh array every render would re-arm the timer on
    // every tick and the walk would never advance smoothly.
  }, [idxs.length]);

  if (idxs.length === 0) return <span className="rname" style={rnameStyle(color)}>{name}</span>;
  // The offset staggers people so two typers are never mid-step together — that is
  // what makes "two three people typing" read as two separate names rather than
  // one blinking blur.
  const hot = idxs[(step + offset) % idxs.length];

  return (
    <span className="rname font-semibold" style={rnameStyle(color)}>
      {letters.map((ch, i) => (
        <span
          key={i}
          // The transition is on the LETTER, so the handover between neighbours
          // fades rather than snapping — the "smoothly" in the request.
          className="transition-all duration-200"
          style={
            i === hot
              ? { textTransform: "uppercase", opacity: 1, letterSpacing: ".02em" }
              : { textTransform: "lowercase", opacity: 0.72 }
          }
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

export function TypingLine({
  typers,
  isGroup,
  labelFor,
}: {
  /** Identity ids currently typing, excluding me. */
  typers: number[];
  isGroup: boolean;
  labelFor: (id: number) => string;
}) {
  if (typers.length === 0) return null;

  // Two names are shown in full; beyond that the line would wrap on a phone and
  // stop being glanceable, so the remainder is a count. Deliberately still names
  // the first two rather than collapsing to "several", because knowing WHO is
  // typing is the whole value.
  const shown = typers.slice(0, 2);
  const extra = typers.length - shown.length;

  return (
    <div
      className="px-4 md:px-5 pb-1 -mt-1 text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap"
      aria-live="polite"
    >
      <span className="inline-flex gap-0.5" aria-hidden="true">
        {[0, 150, 300].map((d) => (
          <span
            key={d}
            className="size-1.5 rounded-full bg-muted-foreground/60 motion-safe:animate-bounce"
            style={{ animationDelay: d + "ms" }}
          />
        ))}
      </span>
      {shown.map((id, i) => (
        <span key={id} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="text-muted-foreground">and</span>}
          <WalkingName
            name={labelFor(id)}
            color={nameColorFor({ isGroup, senderIdentityId: id })}
            offset={i * 3}
          />
        </span>
      ))}
      {extra > 0 && <span>and {extra} more</span>}
      <span>{typers.length === 1 ? "is typing…" : "are typing…"}</span>
    </div>
  );
}
