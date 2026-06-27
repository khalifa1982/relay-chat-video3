import { describe, it, expect } from "vitest";
import { buildAudioOutputList } from "./audioOutputs";

const dev = (deviceId: string, label: string, kind = "audiooutput") => ({ kind, deviceId, label });

describe("buildAudioOutputList", () => {
  it("always emits a single synthetic Automatic row, selected by default", () => {
    const { rows } = buildAudioOutputList([], "");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "", selected: true });
    expect(rows[0].label).toMatch(/Automatic/);
  });

  it("lists real outputs and ignores non-audiooutput devices", () => {
    const devices = [
      dev("spk", "Speakerphone"),
      dev("mic1", "Microphone", "audioinput"),
      dev("bt", "Pixel Buds"),
    ];
    const { rows } = buildAudioOutputList(devices, "");
    expect(rows.map((r) => r.id)).toEqual(["", "spk", "bt"]);
  });

  it("DROPS the platform 'default' pseudo-device (no duplicate defaults)", () => {
    const devices = [dev("default", "Default - Speaker"), dev("ear", "Earpiece")];
    const { rows } = buildAudioOutputList(devices, "");
    // Only the synthetic Automatic + the real Earpiece — never a 'default' row.
    expect(rows.map((r) => r.id)).toEqual(["", "ear"]);
    expect(rows.some((r) => r.id === "default")).toBe(false);
  });

  it("marks the requested sink selected and reports its label", () => {
    const devices = [dev("spk", "Speakerphone"), dev("bt", "Sony WH-1000")];
    const { rows, currentLabel, validSink } = buildAudioOutputList(devices, "bt");
    expect(validSink).toBe("bt");
    expect(currentLabel).toBe("Sony WH-1000");
    expect(rows.find((r) => r.id === "bt")?.selected).toBe(true);
    expect(rows.find((r) => r.id === "")?.selected).toBe(false);
  });

  it("falls back to Automatic when the persisted sink no longer exists (unplugged BT)", () => {
    const devices = [dev("spk", "Speakerphone")];
    const { rows, currentLabel, validSink } = buildAudioOutputList(devices, "bt-that-left");
    expect(validSink).toBe(""); // phantom selection dropped
    expect(currentLabel).toBe("Automatic");
    expect(rows.find((r) => r.id === "")?.selected).toBe(true);
    expect(rows.some((r) => r.id === "bt-that-left")).toBe(false);
  });

  it("labels unnamed outputs predictably", () => {
    const { rows } = buildAudioOutputList([dev("x", "")], "");
    expect(rows[1].label).toMatch(/^Output /);
  });
});
