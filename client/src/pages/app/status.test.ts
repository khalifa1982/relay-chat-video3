import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const src = read("client/src/pages/app/Status.tsx");

/**
 * Rich user status client (v2.95) — story strip, composer, and full-screen
 * viewer. No DOM test env, so wiring is source-pinned.
 */
describe("Status client", () => {
  it("exports the strip + full-screen viewer", () => {
    expect(src).toMatch(/export function StatusStrip\(/);
    expect(src).toMatch(/export function StatusViewer\(/);
  });

  it("drives the status tRPC surface", () => {
    for (const call of [
      /trpc\.status\.feed\.useQuery/,
      /trpc\.status\.post\.useMutation/,
      /trpc\.status\.markViewed\.useMutation/,
      /trpc\.status\.remove\.useMutation/,
      /trpc\.status\.viewers\.useQuery/,
    ]) {
      expect(src).toMatch(call);
    }
  });

  it("uploads media via the no-row status helper before posting", () => {
    expect(src).toMatch(/uploadStatusMedia\(file/);
    // media kinds resolve to the four status kinds
    expect(src).toMatch(/"image"|"video"|"audio"/);
  });

  it("supports all four kinds (text with a bg + the three media types)", () => {
    expect(src).toMatch(/kind === "text"/);
    expect(src).toMatch(/BG_OPTIONS/);
    expect(src).toMatch(/kind === "image"/);
    expect(src).toMatch(/kind === "video"/);
    expect(src).toMatch(/kind === "audio"/);
  });

  it("auto-advances the story and marks each item viewed", () => {
    expect(src).toMatch(/requestAnimationFrame/);
    expect(src).toMatch(/markViewed\.mutate\(\{ id: item\.id \}\)/);
  });

  it("is mounted at the top of the Messages tab", () => {
    const msgs = read("client/src/pages/app/Messages.tsx");
    expect(msgs).toMatch(/import \{ StatusStrip \}/);
    expect(msgs).toMatch(/<StatusStrip \/>/);
  });
});
