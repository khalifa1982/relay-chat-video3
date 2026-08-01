import type { Entry } from "./types";

/**
 * One module per surface — see `dict/index.ts` for why.
 *
 * PRE-REGISTERED EMPTY (v2.106.93) so the per-screen translation sweep can run several
 * contributors at once without every one of them editing `dict/index.ts`. Fill this in
 * with the screen's strings; both halves are required by `Entry`, which is what makes an
 * untranslated string a compile error rather than a review item.
 */
export const VIDEOREC = {} as const satisfies Record<string, Entry>;
