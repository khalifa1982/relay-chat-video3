/* ──────────────────────────────────────────────────────────────────────────
 * Call recording via LiveKit Egress → S3.
 *
 * Feature-gated exactly like TURN / LiveKit: dormant until the operator sets
 * the storage env vars. Recording requires the SFU (LiveKit) AND an
 * S3-compatible output bucket. When unset, the Record control is hidden and the
 * signaling `start-recording` message is a no-op.
 *
 * A "room composite" egress records the whole call (grid of all participants,
 * mixed audio) as a single MP4 written straight to the operator's bucket — the
 * bytes never touch this server. We keep only the egressId in memory (per room)
 * so a later `stop-recording` can stop it.
 *
 * Env (all required to enable, on top of LIVEKIT_*):
 *   RECORDING_S3_BUCKET        e.g. "relay-recordings"
 *   RECORDING_S3_REGION        e.g. "us-east-1"  (any value for non-AWS S3)
 *   RECORDING_S3_ACCESS_KEY
 *   RECORDING_S3_SECRET
 *   RECORDING_S3_ENDPOINT      optional — for non-AWS S3 (R2, MinIO, …)
 *   RECORDING_S3_PREFIX        optional — key prefix, default "recordings/"
 *   RECORDING_S3_FORCE_PATH_STYLE  optional — "1"/"true" for MinIO/R2
 * ────────────────────────────────────────────────────────────────────────── */
import {
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  S3Upload,
} from "livekit-server-sdk";

export interface RecordingS3 {
  bucket: string;
  region: string;
  accessKey: string;
  secret: string;
  endpoint?: string;
  prefix: string;
  forcePathStyle: boolean;
}

export interface RecordingConfig {
  enabled: boolean;
  /** LiveKit project URL in https form (Egress uses the Twirp HTTP API). */
  httpUrl: string;
  apiKey: string;
  apiSecret: string;
  s3: RecordingS3 | null;
}

/** wss://host → https://host (Egress talks HTTP, not WebSocket). */
export function toHttpUrl(wsUrl: string): string {
  return wsUrl.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
}

function readS3(): RecordingS3 | null {
  const bucket = process.env.RECORDING_S3_BUCKET || "";
  const region = process.env.RECORDING_S3_REGION || "";
  const accessKey = process.env.RECORDING_S3_ACCESS_KEY || "";
  const secret = process.env.RECORDING_S3_SECRET || "";
  if (!bucket || !region || !accessKey || !secret) return null;
  const endpoint = process.env.RECORDING_S3_ENDPOINT || undefined;
  const prefix = (process.env.RECORDING_S3_PREFIX || "recordings/").replace(/^\/+/, "");
  const fps = (process.env.RECORDING_S3_FORCE_PATH_STYLE || "").toLowerCase();
  return {
    bucket,
    region,
    accessKey,
    secret,
    endpoint,
    prefix: prefix.endsWith("/") ? prefix : prefix + "/",
    forcePathStyle: fps === "1" || fps === "true" || fps === "yes",
  };
}

/** Read env per-call (so creds can be added via Manus Secrets without a restart). */
export function recordingConfig(): RecordingConfig {
  const url = process.env.LIVEKIT_URL || "";
  const apiKey = process.env.LIVEKIT_API_KEY || "";
  const apiSecret = process.env.LIVEKIT_API_SECRET || "";
  const s3 = readS3();
  const enabled = !!(url && apiKey && apiSecret && s3);
  return { enabled, httpUrl: toHttpUrl(url), apiKey, apiSecret, s3 };
}

/** Object key for a room's recording. Pure + deterministic given (room, ts). */
export function recordingKey(prefix: string, roomId: string, ts: number): string {
  const safeRoom = roomId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  // YYYYMMDD-HHMMSS in UTC, no separators that confuse S3 console previews.
  const d = new Date(ts);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}` +
    `-${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}`;
  return `${prefix}${safeRoom}-${stamp}.mp4`;
}

export interface StartedRecording {
  egressId: string;
  key: string;
}

/**
 * Start a room-composite (grid) recording for `roomId`, written to the
 * operator's S3 bucket. Returns the egressId (to stop later) and the object
 * key. Throws if recording isn't configured.
 */
export async function startRoomRecording(
  roomId: string,
  ts: number
): Promise<StartedRecording> {
  const cfg = recordingConfig();
  if (!cfg.enabled || !cfg.s3) throw new Error("recording not configured");
  const key = recordingKey(cfg.s3.prefix, roomId, ts);
  const client = new EgressClient(cfg.httpUrl, cfg.apiKey, cfg.apiSecret);
  const fileOutput = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: key,
    output: {
      case: "s3",
      value: new S3Upload({
        accessKey: cfg.s3.accessKey,
        secret: cfg.s3.secret,
        bucket: cfg.s3.bucket,
        region: cfg.s3.region,
        ...(cfg.s3.endpoint ? { endpoint: cfg.s3.endpoint } : {}),
        forcePathStyle: cfg.s3.forcePathStyle,
      }),
    },
  });
  const info = await client.startRoomCompositeEgress(
    roomId,
    { file: fileOutput },
    { layout: "grid" }
  );
  return { egressId: info.egressId, key };
}

/** Stop an in-progress egress by id. Best-effort; throws on hard failure. */
export async function stopRoomRecording(egressId: string): Promise<void> {
  const cfg = recordingConfig();
  if (!cfg.enabled) return;
  const client = new EgressClient(cfg.httpUrl, cfg.apiKey, cfg.apiSecret);
  await client.stopEgress(egressId);
}
