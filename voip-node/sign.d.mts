/**
 * Types for `sign.mjs`, so the APP can import the node's OWN signer.
 *
 * THIS IS WHY IT IS WORTH A DECLARATION FILE RATHER THAN A TYPESCRIPT COPY: there is then
 * exactly ONE implementation of the signature rule, shared by the app (bundled at build
 * time — the import is relative, so esbuild inlines it and nothing named `voip-node` exists
 * on the app fleet at runtime) and by the node agent (which runs the file directly). Parity
 * is STRUCTURAL rather than tested. A copy in TypeScript would be the two-implementations
 * problem v2.99.71 recorded drifting in production, and no test can catch the divergence
 * that has not happened yet; deleting the second implementation can.
 *
 * A hand-written declaration can still go stale against the JavaScript, but only in its
 * TYPES — and a changed shape then fails `tsc` at every call site, which is loud. It cannot
 * diverge in BEHAVIOUR, because there is no second behaviour.
 */

/** Replay window: how far a request's timestamp may be from the verifier's clock. */
export declare const SIG_WINDOW_MS: number;

/** The header the signature travels in. */
export declare const SIG_HEADER: string;

/**
 * Sign a request body. Returns the header value `<ts>.<hex>`.
 *
 * `body` must be the EXACT bytes that will be sent: the timestamp is inside the signed
 * string, so a re-serialization with different key order verifies as a forgery.
 */
export declare function signBody(secret: string, body: string, nowMs: number): string;

/**
 * Verify a body against its header. FAILS CLOSED with an empty secret.
 *
 * `rawBody` must be the bytes as received, not a re-serialization of the parsed JSON.
 */
export declare function verifySignature(
  secret: string,
  rawBody: string,
  header: unknown,
  nowMs: number,
): boolean;
