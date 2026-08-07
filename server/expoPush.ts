/**
 * Expo push sender (v2.99.79) — the OTHER kind of native token.
 *
 * WHY THIS EXISTS ALONGSIDE fcm.ts
 * --------------------------------
 * The owner's shipping mobile app is a React Native + Expo (SDK 54) shell that
 * wraps the live app URL in a WebView. Expo hands an app TWO different
 * push tokens and they are NOT interchangeable:
 *
 *   getExpoPushTokenAsync()   -> "ExponentPushToken[xxxxxxxx]"
 *       Delivered through Expo's own service, which then talks to FCM/APNs using
 *       credentials the developer uploaded to EAS. Sending one of these to FCM
 *       fails — it is not an FCM registration token.
 *
 *   getDevicePushTokenAsync() -> a raw FCM registration token (Android) or an
 *       APNs token (iOS). These go to FCM directly, which is what `fcm.ts` does.
 *
 * Supporting only one would silently drop every notification the moment the app
 * used the other, with nothing in the logs pointing at the cause. So the token's
 * SHAPE decides the transport (`classifyNativeToken`), and both transports exist.
 *
 * Zero dependencies, matching this codebase's SMTP / S3 / FCM senders: Expo's
 * send endpoint is a plain JSON POST and needs no credential for ordinary use.
 * `EXPO_ACCESS_TOKEN` is honoured when set, because Expo requires it once an
 * account has enhanced security enabled.
 */

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";

/** Expo caps a single request at 100 messages. */
const EXPO_BATCH = 100;

/**
 * `apns` is a RECOGNISED but NOT-YET-DELIVERABLE kind (v2.105.11). RELAY has no direct
 * APNs transport, so nothing sends to it — but it is stored rather than refused, because
 * the admin push doctor reporting "this device registered an APNs token, which needs the
 * shell to send an Expo push token instead" is the one thing that makes the failure
 * diagnosable. Refusing outright would leave the operator with an empty device list and
 * no reason for it.
 *
 * CRITICALLY, an `apns` row must NOT count as reachable — see `hasRoutablePushKind`.
 */
export type NativeTokenKind = "expo" | "fcm" | "apns" | "apns-voip";

/**
 * THE ONE CASE WHERE THE SHAPE CANNOT DECIDE, AND SAYING SO IS THE WHOLE POINT
 * (v2.105.13).
 *
 * iOS hands an app TWO different hex tokens and they are NOT interchangeable:
 *
 *   • the ALERT token, from `registerForRemoteNotifications`, addressed on topic
 *     `<bundle>` — ordinary notifications.
 *   • the PUSHKIT token, from `PKPushRegistry`, addressed on topic
 *     `<bundle>.voip` — VoIP pushes, and the ONLY thing that shows CallKit on a
 *     locked phone.
 *
 * Both are pure hex of the same length, so `classifyNativeToken` physically
 * cannot tell them apart. Send a VoIP push to an ALERT token and APNs answers
 * `BadDeviceToken`, which the sender reads as stale and PRUNES — destroying the
 * registration, the exact defect v2.105.11 fixed on the FCM path.
 *
 * So this is the single kind a client is TRUSTED to assert, and it is safe for a
 * narrow reason: a shell that mislabels its own token breaks only its own
 * delivery. There is nothing to gain and no other user to affect. Everywhere
 * else the shape still overrides the label.
 */
export function isVoipDeclaration(declared: unknown, shape: NativeTokenKind | null): boolean {
  return declared === "apns-voip" && shape === "apns";
}

/** The kinds something actually sends to. `apns` is deliberately absent: a stored token
 *  we cannot deliver to must never suppress the offline-message EMAIL fallback, or the
 *  recipient gets neither, which is strictly worse than the bug this release fixes. */
export const ROUTABLE_PUSH_KINDS = ["webpush", "fcm", "expo"] as const;

/**
 * Which transport does this token belong to?
 *
 * Deliberately shape-based rather than trusting a client-supplied label: the
 * label comes from the app over a WebView bridge, and routing an Expo token to
 * FCM (or the reverse) is a silent delivery failure rather than an error anybody
 * sees. Returns null when it is neither, so an unknown token is REFUSED at the
 * door instead of being stored and never delivered to.
 */
export function classifyNativeToken(token: unknown): NativeTokenKind | null {
  if (typeof token !== "string") return null;
  const t = token.trim();
  if (!t) return null;
  // Expo's documented forms. Both bracketed spellings are accepted because Expo
  // has shipped both, and the closing bracket is required so a truncated token
  // cannot pass as a valid one.
  if (/^Expo(nent)?PushToken\[[^\]\s]+\]$/.test(t)) return "expo";
  // AN APNs DEVICE TOKEN IS NOT AN FCM TOKEN, AND SAYING SO IS THE WHOLE FIX.
  //
  // This branch used to return "fcm" for a bare hex token, under a comment claiming
  // APNs tokens "also reach FCM (via the APNs key uploaded to Firebase)". THAT WAS
  // FALSE. FCM v1 `messages:send` takes an FCM REGISTRATION token; handed a raw APNs
  // device token it answers 400/404, and `sendFcmData` reads 400/404 as a stale token
  // and PRUNES the row. So an iOS shell that posted its APNs token got silently
  // deregistered on the very first push — it did not merely fail, it destroyed its own
  // registration.
  //
  // An APNs device token is pure hex (32 bytes → 64 chars classically, up to 100 bytes
  // on newer iOS). An FCM registration token is never pure hex: it carries a `:` (the
  // `<instance-id>:APA91b…` shape) plus `-`/`_`. So the hex-only test is a safe, narrow
  // discriminator that cannot swallow an Android token.
  if (/^[0-9a-fA-F]{64,200}$/.test(t) && t.length % 2 === 0) return "apns";
  if (/^[A-Za-z0-9_:%.~-]{32,4096}$/.test(t)) return "fcm";
  return null;
}

export interface ExpoSendResult {
  ok: boolean;
  sent: number;
  /** Tokens Expo reported as permanently unregistered — safe to delete. */
  dead: string[];
  error?: string;
}

/**
 * Send one data payload to a batch of Expo push tokens.
 *
 * Notifications are sent with `data` plus a title/body, because the shell needs
 * both: the data drives the app's own handling (a full-screen ring), and the
 * title/body are what the OS shows when the app is not running to handle it.
 */
export async function sendExpoPush(
  tokens: string[],
  payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
    /** iOS/Android channel hint. "call" gets max priority. */
    kind?: string;
    /** Silent send (v2.107.57): deliver the banner with NO sound. */
    silent?: boolean;
  }
): Promise<ExpoSendResult> {
  const valid = Array.from(new Set(tokens.filter((t) => classifyNativeToken(t) === "expo")));
  if (valid.length === 0) return { ok: true, sent: 0, dead: [] };

  const isCall = payload.kind === "incoming-call";
  const dead: string[] = [];
  let sent = 0;

  for (let i = 0; i < valid.length; i += EXPO_BATCH) {
    const slice = valid.slice(i, i + EXPO_BATCH);
    const messages = slice.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
      // Expo reads `sound: null` as "show it, don't play anything" — that IS the
      // silent send. A call is never silent.
      sound: payload.silent && !isCall ? null : ("default" as const),
      // A ring must arrive now or not at all; everything else can be batched by
      // the OS to save the user's battery.
      priority: isCall ? ("high" as const) : ("normal" as const),
      ...(isCall ? { ttl: 60, channelId: "calls" } : {}),
    }));
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "application/json",
      };
      // Trimmed (v2.105.17): a whitespace-only value used to REPLACE the working
  // no-credential request with an `authorization: Bearer` header carrying nothing.
  const accessToken = (process.env.EXPO_ACCESS_TOKEN || "").trim();
      if (accessToken) headers.authorization = `Bearer ${accessToken}`;
      const res = await fetch(EXPO_SEND_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        return { ok: false, sent, dead, error: `expo http ${res.status}` };
      }
      const json = (await res.json()) as {
        data?: Array<{ status?: string; details?: { error?: string } }>;
      };
      (json.data ?? []).forEach((r, idx) => {
        if (r?.status === "ok") {
          sent++;
          return;
        }
        // "DeviceNotRegistered" is the one error that means the token is dead
        // FOREVER; everything else is transient and must NOT cost the user their
        // registration.
        if (r?.details?.error === "DeviceNotRegistered") {
          const t = slice[idx];
          if (t) dead.push(t);
        }
      });
    } catch (e) {
      return { ok: false, sent, dead, error: (e as Error)?.message || "expo send failed" };
    }
  }
  return { ok: true, sent, dead };
}
