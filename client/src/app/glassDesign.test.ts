import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.67 — glassy/transparent design system. The frosted-glass surface tiers are
 * defined once as Tailwind v4 `@utility` classes (so they compose with variants
 * like `md:glass-surface-md`) with a mobile blur cap, an unsupported-backdrop
 * fallback, and a prefers-reduced-transparency escape hatch. These static guards
 * pin the token layer + its per-screen application so a refactor can't silently
 * drop the glass treatment or the performance/a11y safeguards.
 */
const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const CSS = read("client/src/index.css");

describe("glass design tokens (index.css)", () => {
  it("defines the surface tiers + overlay as composable @utility classes", () => {
    expect(CSS).toMatch(/@utility glass-surface \{/);
    expect(CSS).toMatch(/@utility glass-surface-sm \{/);
    expect(CSS).toMatch(/@utility glass-surface-md \{/);
    expect(CSS).toMatch(/@utility glass-surface-lg \{/);
    expect(CSS).toMatch(/@utility glass-overlay \{/);
  });

  it("each tier is a real frosted surface (backdrop blur + saturate)", () => {
    expect(CSS).toMatch(/backdrop-filter: blur\(16px\) saturate\(1\.4\)/);
    expect(CSS).toMatch(/-webkit-backdrop-filter: blur\(/); // Safari/iOS prefix present
  });

  it("caps blur on mobile (Android backdrop-filter perf)", () => {
    expect(CSS).toMatch(/@media \(max-width: 768px\)[\s\S]*?glass-surface[\s\S]*?blur\(10px\)/);
  });

  it("falls back to a more opaque fill where backdrop-filter is unsupported", () => {
    expect(CSS).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\)/);
    expect(CSS).toMatch(/var\(--card\) 92%/);
  });

  it("honors prefers-reduced-transparency (drops blur, solid fill)", () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
  });
});

describe("glass applied across screens", () => {
  it("Contacts, History, Messages thread list use a glass surface", () => {
    expect(read("client/src/pages/app/Contacts.tsx")).toMatch(/md:glass-surface-md/);
    expect(read("client/src/pages/app/History.tsx")).toMatch(/glass-surface-md/);
    expect(read("client/src/pages/app/Messages.tsx")).toMatch(/md:glass-surface-md/);
  });

  it("Profile sub-cards use the small glass tier", () => {
    expect(read("client/src/pages/app/ProfileHubSections.tsx")).toMatch(/glass-surface-sm/);
  });

  it("all modal scrims share the glass-overlay tint", () => {
    expect(read("client/src/components/ui/dialog.tsx")).toMatch(/glass-overlay/);
    expect(read("client/src/components/ui/alert-dialog.tsx")).toMatch(/glass-overlay/);
    expect(read("client/src/app/AuthPanel.tsx")).toMatch(/glass-overlay/);
    expect(read("client/src/app/UpdateChecker.tsx")).toMatch(/glass-overlay/);
  });
});
