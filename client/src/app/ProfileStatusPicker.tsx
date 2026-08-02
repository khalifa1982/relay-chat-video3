import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_STATUS_NOTE,
  PROFILE_STATUS_META,
  normalizeProfileStatus,
  profileStatusMeta,
  type ProfileStatus,
} from "@shared/profileStatus";

/**
 * The status picker — five labels with an emoji and a colour, plus a note (v2.102.1).
 *
 * EXTRACTED out of Profile's `StatusSection` rather than copied, because a group now
 * has a status too (v2.102.0) and two copies of this grid is precisely how a group's
 * status and a person's come to look and behave differently — the divergence class
 * `shared/profileStatus.ts` exists to prevent on the DATA side. This is the same fix
 * on the UI side: one picker, and each caller owns only its own mutation.
 *
 * IT OWNS THE NOTE'S EDITING STATE ON PURPOSE. "A refetch must not erase a note
 * somebody is halfway through typing" is a correctness rule, not a detail, and putting
 * it here means the second caller inherits it instead of having to remember it.
 *
 * COLOUR IS REINFORCEMENT, NEVER THE CARRIER: the emoji names the status and the label
 * renders in the ordinary foreground colour, with the hue only on a tint and a border.
 * Nothing here depends on telling sky from violet, which is why these five hues need no
 * contrast measurement of their own — unlike the `--relay-*-text` tokens, which DO carry
 * small coloured text and were measured for exactly that reason (v2.99.94).
 */
export function ProfileStatusPicker({
  value,
  note,
  pending,
  onPick,
  onSaveNote,
  idPrefix = "status",
  emptyHint,
}: {
  /** The stored label, as the server has it. Anything unrecognised reads as none. */
  value: unknown;
  /** The stored note, as the server has it. */
  note: string | null | undefined;
  pending: boolean;
  /** null clears. Tapping the current one also clears — see below. */
  onPick: (next: ProfileStatus | null) => void;
  /** Called on blur/Enter, only when the text actually changed. */
  onSaveNote: (next: string) => void;
  /** Distinguishes the input's id when two pickers could share a page. */
  idPrefix?: string;
  /** What to say when nothing is picked; a group's presence story differs. */
  emptyHint?: string;
}) {
  const current = normalizeProfileStatus(value);
  const [draft, setDraft] = useState(note ?? "");
  // The note follows the server when it changes underneath us (another device, a
  // refetch) — but only while this field is NOT being edited, or a poll would erase
  // what somebody is halfway through typing.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(note ?? "");
  }, [note, editing]);

  const commitNote = () => {
    setEditing(false);
    const next = draft.trim().slice(0, MAX_STATUS_NOTE);
    if (next === (note ?? "")) return;
    onSaveNote(next);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {PROFILE_STATUS_META.map(({ key, label, emoji, color }) => {
          const on = current === key;
          return (
            <button
              key={key}
              type="button"
              // Tapping the CURRENT one clears it — the picker is its own "none"
              // control, so there is no sixth button whose only job is to undo the
              // other five.
              onClick={() => onPick(on ? null : key)}
              disabled={pending}
              aria-pressed={on}
              // Inline styles, NOT template-composed Tailwind classes: the JIT
              // compiler cannot see a class name assembled at runtime, so a
              // `border-[${color}]` comes out unstyled (the trap recorded for the
              // tab-bar accents).
              style={on ? { borderColor: color, background: `${color}1f` } : undefined}
              className={
                "flex flex-col items-center gap-1.5 rounded-xl border p-3 transition disabled:opacity-50 disabled:pointer-events-none " +
                (on ? "text-foreground" : "border-border bg-card/40 text-muted-foreground hover:bg-card/70")
              }
            >
              <span aria-hidden="true" className="text-lg leading-none">{emoji}</span>
              <span className="text-xs font-medium text-center leading-tight">{label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {profileStatusMeta(current)?.hint ??
          emptyHint ??
          "No status — presence decides: online when you're active, offline otherwise."}
      </p>
      {/* The note is only meaningful ALONGSIDE a status, so it appears with one. On
          its own it would be a caption for nothing. */}
      {current && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-note`} className="text-xs text-muted-foreground">
            Note (optional)
          </Label>
          <Input
            id={`${idPrefix}-note`}
            value={draft}
            maxLength={MAX_STATUS_NOTE}
            placeholder="back Monday"
            onFocus={() => setEditing(true)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitNote}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </div>
      )}
    </div>
  );
}
