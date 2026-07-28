/**
 * The shape of a RELAY VoIP push, parsed.
 *
 * Kept in `lib/` rather than beside the hook for two reasons. It is PURE, so it
 * is the part worth testing — and a test cannot import a hook here at all, since
 * anything touching `react-native` drags in Flow-typed source the test parser
 * refuses. That is the same reason `lib/call-messages.ts` exists.
 */
export interface VoipCallPayload {
  callerName?: string;
  callerPin?: string;
  /** The room the callee must join to answer. Without it the ring is undialable. */
  roomId?: string;
  video?: boolean;
}

/**
 * Read the fields RELAY's server puts in a VoIP push.
 *
 * The payload crosses a native boundary as a loosely-typed dictionary, and
 * `video` arrives as the STRING "1" rather than a boolean — exactly the kind of
 * detail that silently turns every video call into a voice call, or worse, reads
 * the string "0" as true and turns every voice call into a video one.
 */
export function readVoipPayload(raw: unknown): VoipCallPayload {
  if (typeof raw !== "object" || raw === null) return {};
  const d = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    callerName: str(d.callerName),
    callerPin: str(d.callerPin),
    roomId: str(d.roomId),
    // "1" is what the server sends. A bare truthiness check would read "0" as true.
    video: d.video === "1" || d.video === true,
  };
}
