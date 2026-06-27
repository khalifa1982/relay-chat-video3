import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { toHttpUrl, recordingKey, recordingConfig } from "./recording";

describe("recording — pure helpers", () => {
  it("toHttpUrl converts ws(s) → http(s)", () => {
    expect(toHttpUrl("wss://x.livekit.cloud")).toBe("https://x.livekit.cloud");
    expect(toHttpUrl("ws://localhost:7880")).toBe("http://localhost:7880");
    // https passes through unchanged
    expect(toHttpUrl("https://already.https")).toBe("https://already.https");
  });

  it("recordingKey is deterministic, prefixed, and S3-safe", () => {
    const ts = Date.UTC(2026, 5, 27, 9, 8, 7); // 2026-06-27 09:08:07 UTC
    expect(recordingKey("recordings/", "room-abc", ts)).toBe(
      "recordings/room-abc-20260627-090807.mp4"
    );
  });

  it("recordingKey sanitizes unsafe room characters", () => {
    const ts = Date.UTC(2026, 0, 1, 0, 0, 0);
    // "a b/c*?:" → each of space / * ? : becomes "_"
    const key = recordingKey("rec/", "a b/c*?:", ts);
    expect(key).toBe("rec/a_b_c___-20260101-000000.mp4");
    // the room slug carries no spaces or filesystem-hostile characters
    const slug = key.slice("rec/".length, key.indexOf("-2026"));
    expect(slug).not.toMatch(/[ /*?:]/);
  });
});

describe("recording — config gate", () => {
  const SAVE = { ...process.env };
  beforeEach(() => {
    // Clear all relevant vars to a known-empty baseline.
    for (const k of [
      "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
      "RECORDING_S3_BUCKET", "RECORDING_S3_REGION", "RECORDING_S3_ACCESS_KEY",
      "RECORDING_S3_SECRET", "RECORDING_S3_ENDPOINT", "RECORDING_S3_PREFIX",
      "RECORDING_S3_FORCE_PATH_STYLE",
    ]) {
      delete process.env[k];
    }
  });
  afterEach(() => {
    process.env = { ...SAVE };
  });

  it("is disabled when nothing is configured", () => {
    expect(recordingConfig().enabled).toBe(false);
    expect(recordingConfig().s3).toBeNull();
  });

  it("is disabled when LiveKit is set but S3 is not", () => {
    process.env.LIVEKIT_URL = "wss://x.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "key";
    process.env.LIVEKIT_API_SECRET = "secret";
    expect(recordingConfig().enabled).toBe(false);
  });

  it("is disabled when S3 is partial (missing secret)", () => {
    process.env.LIVEKIT_URL = "wss://x.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "key";
    process.env.LIVEKIT_API_SECRET = "secret";
    process.env.RECORDING_S3_BUCKET = "b";
    process.env.RECORDING_S3_REGION = "r";
    process.env.RECORDING_S3_ACCESS_KEY = "ak";
    // secret missing
    expect(recordingConfig().enabled).toBe(false);
  });

  it("is enabled with LiveKit + full S3, and normalizes the prefix", () => {
    process.env.LIVEKIT_URL = "wss://x.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "key";
    process.env.LIVEKIT_API_SECRET = "secret";
    process.env.RECORDING_S3_BUCKET = "b";
    process.env.RECORDING_S3_REGION = "r";
    process.env.RECORDING_S3_ACCESS_KEY = "ak";
    process.env.RECORDING_S3_SECRET = "sk";
    process.env.RECORDING_S3_PREFIX = "calls"; // no trailing slash
    const cfg = recordingConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.httpUrl).toBe("https://x.livekit.cloud");
    expect(cfg.s3?.bucket).toBe("b");
    expect(cfg.s3?.prefix).toBe("calls/"); // trailing slash added
    expect(cfg.s3?.forcePathStyle).toBe(false);
  });

  it("honors RECORDING_S3_FORCE_PATH_STYLE and endpoint for non-AWS S3", () => {
    process.env.LIVEKIT_URL = "wss://x.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "key";
    process.env.LIVEKIT_API_SECRET = "secret";
    process.env.RECORDING_S3_BUCKET = "b";
    process.env.RECORDING_S3_REGION = "auto";
    process.env.RECORDING_S3_ACCESS_KEY = "ak";
    process.env.RECORDING_S3_SECRET = "sk";
    process.env.RECORDING_S3_ENDPOINT = "https://r2.example.com";
    process.env.RECORDING_S3_FORCE_PATH_STYLE = "true";
    const cfg = recordingConfig();
    expect(cfg.s3?.endpoint).toBe("https://r2.example.com");
    expect(cfg.s3?.forcePathStyle).toBe(true);
  });
});
