/**
 * The 6-digit RELAY number, as a person TYPES it.
 *
 * Owner: *"anywhere in the system for the pin number don't exceed six digits — such as when
 * you add inside the group it gives you more than six digits; you need to put a restriction,
 * only six digits."*
 *
 * They are right, and the group add-member box was the clearest case: four PIN inputs carried
 * `maxLength={9}` and an `onChange` that wrote `e.target.value` STRAIGHT through — no digit
 * count, no strip — so you could type nine characters and the only feedback was a submit
 * button that stayed disabled without saying why.
 *
 * ONE MODULE RATHER THAN FOUR EDITS, because "anywhere in the system" is a rule and four
 * copies is how the fifth input forgets it. `pinInputSweep` in the test file walks every
 * numeric input in the client and fails on one that is not capped, so the input somebody adds
 * NEXT is covered rather than exempt.
 *
 * WHY THE SEPARATORS SURVIVE. The app itself renders numbers as `777-777` (`formatPin`), so
 * refusing the form it just showed you would be the app arguing with itself — v2.99.75 made
 * exactly that call for `normalizeDesiredNumber` on the server. Spacing and grouping are kept
 * while being counted as nothing.
 *
 * WHY ONLY SPACING AND GROUPING ARE STRIPPED, never every non-digit. `raw.replace(/\D/g, "")`
 * reads `7a7b7c7d7e7f` as `777777`, which turns a typo into a successful operation on somebody
 * ELSE's number. Here the character is DROPPED as it is typed rather than folded away, so the
 * field always shows exactly what will be submitted — and the strict `/^\d{6}$/` submit gates
 * stay in place regardless, because this is a typing aid and not the boundary.
 */

/** A RELAY number is six digits. Not a preference — it is the whole number space. */
export const PIN_LENGTH = 6;

/**
 * The `maxLength` for a PIN field: six digits plus one grouping separator, so the browser's
 * own cap AGREES with ours instead of contradicting it. It was 9, which is what let the
 * owner type past the limit in the first place.
 */
export const PIN_INPUT_MAXLENGTH = PIN_LENGTH + 1;

/** The grouping characters the app's own `formatPin` output can contain, plus whitespace. */
const SEPARATORS = " -. ‐‑‒–—";

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

/**
 * The value to write back into a PIN field on every keystroke: digits capped at six, grouping
 * kept, everything else dropped.
 */
export function capPinInput(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  let out = "";
  let digits = 0;
  // `split("")` rather than `for…of`: iterating a string needs `downlevelIteration` under this
  // tsconfig and fails the build with TS2802 — a trap this repo has hit four times. A PIN is
  // ASCII, so there is no surrogate pair to split.
  for (const ch of raw.split("")) {
    if (isDigit(ch)) {
      if (digits >= PIN_LENGTH) continue; // THE CAP
      digits += 1;
      out += ch;
    } else if (SEPARATORS.includes(ch)) {
      out += ch;
    }
    // anything else is dropped rather than silently folded into a digit
  }
  return out;
}

/**
 * The digits behind a typed PIN — the ONE strip, replacing four hand-rolled copies of
 * `replace(/[\s\-.]/g, "")` that had already drifted in which separators they knew about.
 */
export function pinDigits(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  let out = "";
  for (const ch of raw.split("")) if (isDigit(ch)) out += ch;
  return out;
}

/** Whether a typed value is a complete, submittable RELAY number. */
export function isCompletePin(raw: string | null | undefined): boolean {
  return pinDigits(raw).length === PIN_LENGTH;
}
