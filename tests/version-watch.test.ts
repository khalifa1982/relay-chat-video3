import { describe, expect, it } from "vitest";

import { extractVersion, reconcileVersion } from "../lib/version-watch";

describe("extractVersion", () => {
  it("extracts a semantic version from footer text", () => {
    expect(extractVersion("© 2026 RELAY · v2.51.0 · 2026-06-29")).toBe(
      "v2.51.0",
    );
  });

  it("returns null when no version is present", () => {
    expect(extractVersion("no version here")).toBeNull();
    expect(extractVersion(null)).toBeNull();
    expect(extractVersion(undefined)).toBeNull();
  });
});

describe("reconcileVersion", () => {
  it("records the first version without prompting", () => {
    const r = reconcileVersion(null, "v2.51.0");
    expect(r.next).toBe("v2.51.0");
    expect(r.shouldPromptReload).toBe(false);
  });

  it("prompts a reload when the version changes", () => {
    const r = reconcileVersion("v2.51.0", "v2.52.0");
    expect(r.next).toBe("v2.52.0");
    expect(r.shouldPromptReload).toBe(true);
  });

  it("does nothing when the version is unchanged", () => {
    const r = reconcileVersion("v2.51.0", "v2.51.0");
    expect(r.next).toBe("v2.51.0");
    expect(r.shouldPromptReload).toBe(false);
  });

  it("ignores an empty incoming version", () => {
    const r = reconcileVersion("v2.51.0", null);
    expect(r.next).toBe("v2.51.0");
    expect(r.shouldPromptReload).toBe(false);
  });
});
