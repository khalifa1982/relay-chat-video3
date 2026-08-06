/**
 * Plain APNs ALERT sender (v2.107.50) — iOS banner notifications for the thin
 * WebView shell.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * Until v2.107.50, a `kind="apns"` subscription row was deliberately INERT: the
 * only iOS transport was VoIP/PushKit (`apnsVoip.ts`), which rings CallKit and
 * can carry no visible alert. That was correct while the shipping shell held the
 * VoIP entitlement. Shell 1.0.42 removed CallKit/PushKit entirely (owner's
 * direction, 2026-08-06: "very light version… just notifications integrated with
 * the backend") and registers the ORDINARY alert token instead — so with no
 * alert sender, an iPhone on 1.0.42 received NOTHING for messages or calls.
 * That is the exact reported symptom this file closes.
 *
 * ── WHAT IT SHARES AND WHY ───────────────────────────────────────────────────
 * Credentials, JWT minting, host selection, and the prune rule are the VoIP
 * module's, imported rather than copied — two APNs stacks drifting apart is the
 * class of defect this repo keeps re-learning (see `nativeTokenBridge.ts` on
 * two gates disagreeing). Only two things differ, and both are load-bearing:
 *
 *   • TOPIC: the alert topic is the BARE bundle id (`com.app.relaymobile`),
 *     never the `.voip` topic. Sending an alert push to the voip topic earns
 *     `TopicDisallowed`; sending to the wrong token/topic pair earns
 *     `BadDeviceToken` — see the prune rule below for why neither may delete.
 *   • PUSH TYPE: `apns-push-type: alert` with an `aps.alert` body, so iOS
 *     hands it to the notification centre — banner on the lock screen, exactly
 *     what a WebView shell without native call UI needs.
 */

import http2 from "http2";
import {
  apnsVoipConfig,
  apnsProviderToken,
  type ApnsVoipConfig,
} from "./apnsVoip";
import { CALL_PUSH_EXPIRY_SECONDS } from "./callPushPayload";

/** How long APNs may store a non-call alert for an offline device (mirrors the
 *  web-push TTL of 3600 in `webPush.ts` — one bound, two transports). */
const ALERT_STORE_SECONDS = 3600;

export interface ApnsAlert {
  title: string;
  body: string;
  /** Collapse/thread key — later alerts with the same tag replace earlier ones. */
  tag: string;
  /** Web-app path the shell should open on tap, e.g. "/app/messages?c=…". */
  url: string;
  /** Payload discriminator ("message", "voicemail", "incoming-call", …). */
  kind: string;
  /** A call alert is worthless late: bound its life to the ring window. */
  isCall: boolean;
}

export interface ApnsAlertResult {
  sent: number;
  invalidTokens: string[];
}

/**
 * The ALERT topic for a given (voip-shaped) config: env override first, else
 * the voip topic with its `.voip` suffix stripped. Exported for the doctor.
 */
export function apnsAlertTopic(cfg: ApnsVoipConfig | null = apnsVoipConfig()): string | null {
  const explicit = (process.env.APNS_BUNDLE_ID || "").trim();
  if (explicit) return explicit;
  if (!cfg) return null;
  const bare = cfg.topic.replace(/\.voip$/, "").trim();
  return bare || null;
}

/**
 * Send one alert to each token. Same transport discipline as `sendVoipRing`:
 * one HTTP/2 session, 5s connect and per-request bounds, prune ONLY on
 * 410/`Unregistered` — a 400 `BadDeviceToken` here is exactly as ambiguous as
 * it is on the VoIP path (environment or topic mismatch on a LIVE token), and
 * wrongly pruning it costs that iPhone every future notification.
 */
export async function sendApnsAlert(
  tokens: string[],
  alert: ApnsAlert,
): Promise<ApnsAlertResult> {
  const out: ApnsAlertResult = { sent: 0, invalidTokens: [] };
  const cfg = apnsVoipConfig();
  const topic = apnsAlertTopic(cfg);
  if (!cfg || !topic || tokens.length === 0) return out;
  let jwt: string | null = null;
  if (cfg.mode === "token") {
    jwt = apnsProviderToken(cfg);
    if (!jwt) return out;
  }

  const body = JSON.stringify({
    aps: {
      alert: { title: alert.title, body: alert.body },
      sound: "default",
      // Groups alerts of one conversation in the notification centre.
      ...(alert.tag ? { "thread-id": alert.tag.slice(0, 64) } : {}),
    },
    // Custom keys the shell forwards to the web app on tap.
    kind: alert.kind,
    url: alert.url,
    tag: alert.tag,
  });

  const expiry = alert.isCall ? CALL_PUSH_EXPIRY_SECONDS : ALERT_STORE_SECONDS;

  let session: http2.ClientHttp2Session | null = null;
  try {
    session = http2.connect(
      `https://${cfg.host}`,
      cfg.mode === "cert" ? { key: cfg.keyPem, cert: cfg.certPem } : undefined,
    );
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("apns connect timeout")), 5000);
      session!.once("connect", () => { clearTimeout(t); resolve(); });
      session!.once("error", (e) => { clearTimeout(t); reject(e); });
    });

    await Promise.all(
      tokens.map(
        (token) =>
          new Promise<void>((resolve) => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            try {
              const req = session!.request({
                ":method": "POST",
                ":path": `/3/device/${token}`,
                "apns-topic": topic,
                "apns-push-type": "alert",
                "apns-priority": "10",
                "apns-expiration": String(Math.floor(Date.now() / 1000) + expiry),
                // Later alerts with the same id replace earlier ones on-device
                // (a second message in one thread edits, not stacks).
                ...(alert.tag ? { "apns-collapse-id": alert.tag.slice(0, 64) } : {}),
                ...(jwt ? { authorization: `bearer ${jwt}` } : {}),
                "content-type": "application/json",
                "content-length": Buffer.byteLength(body),
              });
              let status = 0;
              let respBody = "";
              req.on("response", (h) => { status = Number(h[":status"]) || 0; });
              req.setEncoding("utf8");
              req.on("data", (c: string) => { respBody += c; });
              req.on("end", () => {
                if (status === 200) out.sent++;
                else if (status === 410 || /\bUnregistered\b/.test(respBody)) {
                  out.invalidTokens.push(token);
                } else if (status >= 400) {
                  console.warn(
                    `[apns-alert] send failed status=${status} reason=${respBody.slice(0, 200)} — ` +
                      `token KEPT (only 410/Unregistered prunes). BadDeviceToken/` +
                      `DeviceTokenNotForTopic usually means APNS_ENV, the topic, or a ` +
                      `voip token misfiled as "apns" — not a gone device.`,
                  );
                }
                finish();
              });
              req.on("error", finish);
              const t = setTimeout(finish, 5000);
              req.once("close", () => clearTimeout(t));
              req.end(body);
            } catch {
              finish();
            }
          }),
      ),
    );
  } catch {
    /* unreachable APNs — best-effort, exactly like every other transport */
  } finally {
    try { session?.close(); } catch { /* already gone */ }
  }
  return out;
}
