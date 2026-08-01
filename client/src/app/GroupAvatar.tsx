import { useState, type ReactNode } from "react";
import { Users } from "lucide-react";

/**
 * A GROUP's photo, with the glyph underneath it (v2.106.89).
 *
 * ── THE BUG THIS EXISTS TO REMOVE ────────────────────────────────────────────────────
 * Owner: *"before it was showing only when you created but when you change it doesn't
 * appear."* Three separate places rendered a group photo, each with its own copy of the
 * fallback, and each copy hid a failed image by writing `style.display = "none"`
 * IMPERATIVELY on the DOM node.
 *
 * React reuses that node when only `src` changes — same type, same position, no key — so
 * the inline `display:none` written for the OLD url SURVIVES onto the new one. The
 * changed photo then loads perfectly and is invisible, for the life of that mount, with
 * nothing on screen saying why. That is the owner's report exactly.
 *
 * Here the failure is REACT STATE KEYED ON THE URL, so a new url is a fresh attempt by
 * construction rather than by remembering to clear something.
 *
 * ── AND THE GLYPH IS UNDERNEATH, NOT AN ELSE-BRANCH ──────────────────────────────────
 * v2.106.66 made exactly this fix in `GroupInfoSheet` and recorded why — *"hiding a
 * broken `<img>` used to leave a 76px hole"* — and it was applied to that one sheet. The
 * thread row and the conversation header kept the else-branch shape, so a group whose
 * photo failed rendered a HOLE in the list and in its own header. One component now, so
 * the next surface cannot inherit the old shape.
 */
export function GroupAvatar({
  url,
  name,
  size,
  className = "",
  ring,
  children,
}: {
  url: string | null | undefined;
  /** For the `alt` text; a group's title, when it has one. */
  name?: string | null;
  /** Rendered box in px. */
  size: number;
  /** Extra classes for the OUTER box (rounding, ring, border…). */
  className?: string;
  /** Optional story-ring class applied to the outer box. */
  ring?: string;
  /** Overlays (a presence LED, a badge…) drawn above the photo. */
  children?: ReactNode;
}) {
  // Keyed on the url: a different photo is a different attempt, so a failure can never
  // outlive the url that caused it.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const broken = !!url && failedFor === url;

  return (
    <span
      className={
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full " +
        (ring ? ring + " " : "") +
        className
      }
      style={{ width: size, height: size }}
    >
      {/* ALWAYS RENDERED, UNDER the photo — this is what makes "degrades to the glyph"
          true rather than aspirational. */}
      <span
        aria-hidden={url && !broken ? "true" : undefined}
        className="grid size-full place-items-center"
        style={{ background: "rgba(167,139,250,.16)", color: "#a78bfa" }}
      >
        <Users style={{ width: size * 0.5, height: size * 0.5 }} />
      </span>
      {url && !broken ? (
        <img
          src={url}
          alt={name || ""}
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailedFor(url)}
        />
      ) : null}
      {children}
    </span>
  );
}
