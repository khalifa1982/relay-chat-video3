/** Strings owned by the history surface. See ./core.ts for why each area has its own file. */
import type { Entry } from "./types";

export const HISTORY = {} as const satisfies Record<string, Entry>;
