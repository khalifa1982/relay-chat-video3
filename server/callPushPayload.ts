/**
 * THE CALL-PUSH ENVELOPE — one shape, both platforms.
 *
 * The owner's push spec (2026-07-31) asks for an identical field set on APNs and
 * FCM, because the two native shells share one call-handling path and a field that
 * exists on one platform and not the other is a branch nobody remembers to write:
 *
 *     type: "incoming_call" | "call_cancel"
 *     callId, roomId, mode ("voice"|"video"), callerName, callerAvatar, ts
 *
 * This module is the ONLY place that composes it. Two copies is how iOS and Android
 * come to disagree about what a call is — the class this repo keeps paying for
 * (v2.99.71's TURN checker, v2.105.11's token classifier).
 *
 * ── EVERY VALUE IS A STRING, AND THAT IS NOT COSMETIC ────────────────────────
 * FCM's data-message contract REFUSES a non-string value: the send comes back 400
 * INVALID_ARGUMENT, which the sender used to read as a dead token and prune (see
 * `tokenIsDead`). So a boolean `video` in this map would not merely fail to ring —
 * it would deregister the device. Composing one string map for both transports is
 * what makes that impossible by construction rather than by remembering.
 *
 * ── `callId` IS THE ROOM ID, DELIBERATELY ────────────────────────────────────
 * RELAY has no separate call identifier; the signaling room IS the call. The spec
 * lists both, so both are emitted — and they are equal because THE CANCEL MUST
 * CARRY THE SAME id AS THE RING OR IT WILL NOT STOP IT. Minting a fresh id would
 * mean storing it somewhere both the ring path and the hang-up path could read, and
 * a mismatch there is a phone that rings until its 45s expiry with nobody on the
 * other end. Using the room makes them equal by construction: both paths already
 * know it, neither has to look it up, and there is nothing to keep in sync.
 *
 * ── ADDITIVE, NEVER RENAMING ─────────────────────────────────────────────────
 * The shells already on people's phones read `kind`, `callerPin` and `video`. The
 * shell being built to this spec reads `type`, `mode` and `callId`. BOTH are sent.
 * A field a reader ignores costs a few bytes; a renamed field is a handset that
 * stops ringing after a deploy nobody connected to it. Same discipline as the
 * optional `PersistedRoom.groupAdminPins` and the `parties` hint on the invite.
 */

export type CallPushType = "incoming_call" | "call_cancel";

export interface CallPushInput {
  type: CallPushType;
  /** The signaling room. Also the callId — see the header. */
  roomId: string;
  callerName: string;
  /** The caller's 6-digit number. Legacy field, kept for the shipped shells. */
  callerPin: string;
  video: boolean;
  /** Absolute or app-relative URL. Best-effort: absent is normal, never an error. */
  callerAvatar?: string | null;
  /** Injected so the composed map is deterministic in a test. */
  nowMs: number;
}

/**
 * Compose the wire map.
 *
 * The returned object is sent VERBATIM as the FCM `data` block and merged into the
 * APNs body, so what a test asserts here is what both phones receive.
 */
export function buildCallPush(input: CallPushInput): Record<string, string> {
  const mode = input.video ? "video" : "voice";
  return {
    // ── the spec's envelope ──────────────────────────────────────────────────
    type: input.type,
    callId: input.roomId,
    roomId: input.roomId,
    mode,
    callerName: input.callerName,
    callerAvatar: input.callerAvatar ?? "",
    ts: String(input.nowMs),
    // ── what the shipped shells read (v2.105.12/.13) ─────────────────────────
    // `kind` is the discriminator RelayFcmService and the PushKit handler branch
    // on today. Dropping it to "clean up" would silence every handset already
    // installed, which is a worse outcome than a duplicated field.
    kind: input.type === "call_cancel" ? "call-cancel" : "incoming-call",
    callerPin: input.callerPin,
    video: input.video ? "1" : "0",
  };
}

/**
 * A cancel carries no caller identity — it only has to name the call to stop.
 *
 * Said plainly because the omission is deliberate: a cancel arrives when the
 * callee may already have dismissed the ring, and re-sending a name and an avatar
 * there is data about who called leaving the server for a screen that is being
 * torn down. The shell needs `callId` and nothing else.
 */
export function buildCallCancel(roomId: string, nowMs: number): Record<string, string> {
  return buildCallPush({
    type: "call_cancel",
    roomId,
    callerName: "",
    callerPin: "",
    video: false,
    nowMs,
  });
}
