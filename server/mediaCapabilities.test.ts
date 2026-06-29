import { describe, it, expect } from "vitest";
import { buildCapabilityReport, type MediaFeatureProbe } from "@shared/mediaCapabilities";

const base: MediaFeatureProbe = {
  getUserMedia: true,
  getDisplayMedia: true,
  setSinkId: true,
  enumerateDevices: true,
  pictureInPicture: true,
  webkitPresentationPip: false,
  canvasCaptureStream: true,
  isIOSWebKit: false,
};

const row = (r: ReturnType<typeof buildCapabilityReport>, key: string) =>
  r.rows.find((x) => x.key === key)!;

describe("buildCapabilityReport", () => {
  it("desktop Chrome: everything supported", () => {
    const r = buildCapabilityReport(base);
    expect(r.screenShareSupported).toBe(true);
    expect(r.audioOutputSelectable).toBe(true);
    expect(r.pipSupported).toBe(true);
    expect(row(r, "audio-output").supported).toBe(true);
  });

  it("Android Chrome: no audio-output selection (real browser limit), but screen share + PiP work", () => {
    const android: MediaFeatureProbe = { ...base, setSinkId: false };
    const r = buildCapabilityReport(android);
    expect(r.audioOutputSelectable).toBe(false);
    expect(r.screenShareSupported).toBe(true);
    expect(r.pipSupported).toBe(true);
    // The honest note explains the OS handles routing.
    expect(row(r, "audio-output").note).toMatch(/routes call audio automatically/i);
  });

  it("iOS Safari: no screen share + no audio-output, but webkit PiP works", () => {
    const ios: MediaFeatureProbe = {
      ...base,
      getDisplayMedia: false,
      setSinkId: false,
      pictureInPicture: false,
      webkitPresentationPip: true,
      isIOSWebKit: true,
    };
    const r = buildCapabilityReport(ios);
    expect(r.screenShareSupported).toBe(false);
    expect(row(r, "screen-share").note).toMatch(/Apple limitation/i);
    expect(r.audioOutputSelectable).toBe(false);
    expect(r.pipSupported).toBe(true); // via webkit presentation mode
  });

  it("in-app webview (no getDisplayMedia, not iOS): generic screen-share note", () => {
    const webview: MediaFeatureProbe = { ...base, getDisplayMedia: false, isIOSWebKit: false };
    const r = buildCapabilityReport(webview);
    expect(r.screenShareSupported).toBe(false);
    expect(row(r, "screen-share").note).toMatch(/webview|doesn't expose/i);
  });

  it("PiP needs canvas.captureStream on the standard path, OR webkit", () => {
    expect(buildCapabilityReport({ ...base, canvasCaptureStream: false }).pipSupported).toBe(false);
    expect(
      buildCapabilityReport({ ...base, pictureInPicture: false, canvasCaptureStream: false, webkitPresentationPip: true }).pipSupported,
    ).toBe(true);
  });
});
