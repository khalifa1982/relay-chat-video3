import { afterEach, describe, expect, it } from "vitest";
import { detectDeviceType } from "./deviceType";

function setNav(nav: unknown) {
  (globalThis as unknown as { navigator?: unknown }).navigator = nav;
}

afterEach(() => {
  delete (globalThis as unknown as { navigator?: unknown }).navigator;
});

describe("detectDeviceType", () => {
  it("returns Desktop when navigator is unavailable (SSR-safe)", () => {
    delete (globalThis as unknown as { navigator?: unknown }).navigator;
    expect(detectDeviceType()).toBe("Desktop");
  });

  it("prefers userAgentData.mobile when present", () => {
    setNav({ userAgentData: { mobile: true }, userAgent: "" });
    expect(detectDeviceType()).toBe("Mobile");
    setNav({ userAgentData: { mobile: false }, userAgent: "" });
    expect(detectDeviceType()).toBe("Desktop");
  });

  it("falls back to a UA regex for mobile devices", () => {
    setNav({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" });
    expect(detectDeviceType()).toBe("Mobile");
    setNav({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8)" });
    expect(detectDeviceType()).toBe("Mobile");
  });

  it("classifies a desktop UA as Desktop", () => {
    setNav({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    expect(detectDeviceType()).toBe("Desktop");
  });
});
