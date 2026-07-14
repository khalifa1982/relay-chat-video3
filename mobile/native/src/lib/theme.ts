/**
 * RELAY visual identity, ported from the web app's OKLCH dark palette
 * (client/src/index.css) to RN-friendly hex. One source of truth for every
 * screen so the native app reads as the SAME product.
 */
export const colors = {
  bg: "#0A0D10",
  surface: "#12171D",
  surfaceRaised: "#1A2129",
  border: "#232B34",
  text: "#F2F5F7",
  textMuted: "#9AA4AE",
  accent: "#3FE0C5",
  online: "#06D6A0",
  danger: "#FF3B5C",
  // Per-tab accents (web: Calls green / History sky / Messages orange /
  // Contacts purple — AppShell.tsx TABS).
  tabCalls: "#22C55E",
  tabHistory: "#38BDF8",
  tabMessages: "#FB923C",
  tabContacts: "#A78BFA",
} as const;

export const spacing = (n: number) => n * 4;
