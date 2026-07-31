/**
 * THE SIGNATURE ON THE SIGNALING→NODE API, ON THE NODE SIDE.
 *
 * The internal API is how signaling drives a media node: create a transport, produce,
 * consume, switch a consumer's simulcast layer, close a room. It is VPC-internal (TCP 4443
 * from the app security group only), which is a boundary and not an authenticator — a
 * request that reaches the port is not thereby a request the app made.
 *
 * THIS FILE IS SHARED BY BOTH SIDES RATHER THAN COPIED, AND THAT IS THE WHOLE POINT.
 * `server/mediasoupSignaling.ts` IMPORTS `signBody` from here — the app's bundler inlines
 * it, because the import is relative, so nothing named `voip-node` exists on the app fleet
 * at runtime — while the agent runs this file directly. There is therefore exactly ONE
 * implementation of the rule and parity is STRUCTURAL rather than tested.
 *
 * A TypeScript copy in the app was the first design and was rejected: it is the
 * two-implementations-of-one-rule shape v2.99.71 recorded drifting in production
 * (`turn-check.mjs` vs `iceServers()`, which would have reported two relays permanently
 * DOWN forever). A parity test comparing output is the fix when a copy is unavoidable;
 * deleting the copy is better, because no test catches a divergence that has not happened.
 *
 * Sharing it is only possible because this module is IMPORTABLE AND SIDE-EFFECT-FREE.
 * Importing `agent.mjs` would start mediasoup workers and listen on a port; v2.99.71
 * records that trap too (importing `turn-check.mjs` used to run a health check and
 * `process.exit(0)`, killing the test runner).
 *
 * KEEP THIS FILE FREE OF SIDE EFFECTS, OF `process.env`, AND OF THE `mediasoup` IMPORT —
 * the app bundle imports it, so anything added here ships to every app instance too.
 * The secret is a PARAMETER, not a module-level read: a module that reads the environment
 * cannot be driven with two different secrets in one test, and "a wrong secret is refused"
 * is the single most important thing to be able to check here. It also lets the app and the
 * node read the secret from the places each actually has it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * How far a request's timestamp may be from ours.
 *
 * A replay window, not a clock-skew allowance — those pull in opposite directions and the
 * window has to be honest about which it is. Five minutes is generous for two hosts in one
 * VPC (both run NTP), and it is the bound on how long a captured request stays replayable.
 * It is deliberately not tighter: a node whose clock has drifted a few seconds would
 * otherwise refuse every call in the fleet, and the failure mode of a slightly wide window
 * is bounded while the failure mode of a slightly narrow one is total.
 */
export const SIG_WINDOW_MS = 5 * 60_000;

/** The header the signature travels in. Spelled once, on both sides. */
export const SIG_HEADER = "x-relay-voip-sig";

/**
 * Sign a request body.
 *
 * THE TIMESTAMP IS INSIDE THE SIGNED STRING, not merely alongside it. Signing the body
 * alone and sending the timestamp in the clear would let anyone who captured one request
 * rewrite its timestamp and replay it forever — the window would be decoration. `<ts>.<body>`
 * binds them, so moving the timestamp invalidates the signature.
 *
 * @param {string} secret
 * @param {string} body   the EXACT bytes that will be sent — sign what you send, or a
 *                        re-serialization with different key order fails verification
 * @param {number} nowMs
 * @returns {string} the header value: `<ts>.<hex>`
 */
export function signBody(secret, body, nowMs) {
  const ts = Math.floor(nowMs);
  return `${ts}.${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
}

/**
 * Verify a request body against its header.
 *
 * FAILS CLOSED WITH NO SECRET, which is the opposite of most of this codebase's
 * fail-open rules and deliberately so. Everywhere a decision is about whether a call can
 * HAPPEN, this repo fails open — a misconfiguration must degrade quality, never remove the
 * ability to call. But this is a decision about whether a REQUEST IS AUTHENTIC, and an
 * unconfigured node that accepted everything would be an open SFU that anybody inside the
 * VPC could drive. The fail-open behaviour lives one level up, in the app: no secret means
 * mediasoup is simply not selected, and the call takes the mesh.
 *
 * @param {string} secret
 * @param {string} rawBody  the bytes as received, NOT a re-serialization of the parsed JSON
 * @param {unknown} header
 * @param {number} nowMs
 */
export function verifySignature(secret, rawBody, header, nowMs) {
  if (!secret) return false;
  if (typeof header !== "string") return false;
  const dot = header.indexOf(".");
  if (dot <= 0) return false;
  const ts = Number(header.slice(0, dot));
  const sig = header.slice(dot + 1);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowMs - ts) > SIG_WINDOW_MS) return false;
  const want = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(want, "utf8");
  // The length check is REQUIRED before timingSafeEqual, which throws on a length
  // mismatch rather than returning false — an uncaught throw here would be a 500 on
  // every malformed request instead of a 401, i.e. a denial-of-service with extra steps.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
