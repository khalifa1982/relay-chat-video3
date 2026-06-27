/**
 * Optional biometric unlock (Face ID / Touch ID / Windows Hello / Android
 * fingerprint) for the app lock. This is a LOCAL gate, not server auth: we use
 * a platform WebAuthn credential purely so the OS performs user verification
 * before unlocking the local UI. We never verify the assertion signature on a
 * server — a successful `navigator.credentials.get()` resolve means the
 * platform authenticator verified the user, which is all a local lock needs.
 *
 * Biometric is an alternate unlock for the passcode lock, never a replacement:
 * it's only offered once a numeric passcode exists (the always-available
 * fallback), and it's cleared when the passcode is removed.
 *
 * Storage: the created credential's rawId (base64url) in localStorage. No keys,
 * no secrets — the private key lives in the device's secure enclave.
 */

const CRED_KEY = "relay_bio_cred";

// ── base64url (no padding), implemented without btoa/atob/Buffer so the same
//    code runs in the browser and the node test env. ──
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function bytesToB64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64[b2 & 63];
  }
  return out;
}

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const lookup = new Map<string, number>();
  for (let i = 0; i < B64.length; i++) lookup.set(B64[i], i);
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const c0 = lookup.get(s[i]) ?? 0;
    const c1 = lookup.get(s[i + 1]) ?? 0;
    const c2 = i + 2 < s.length ? lookup.get(s[i + 2]) : undefined;
    const c3 = i + 3 < s.length ? lookup.get(s[i + 3]) : undefined;
    bytes.push((c0 << 2) | (c1 >> 4));
    if (c2 !== undefined) bytes.push(((c1 & 15) << 4) | (c2 >> 2));
    if (c2 !== undefined && c3 !== undefined) bytes.push(((c2 & 3) << 6) | c3);
  }
  return new Uint8Array(bytes);
}

// Allocate over an explicit ArrayBuffer so the result is Uint8Array<ArrayBuffer>
// (a valid BufferSource for the WebAuthn options under TS's strict typed-array
// generics — a bare `new Uint8Array(n)` widens to ArrayBufferLike).
function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const a = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(a);
  return a;
}

/** A biometric credential has been enrolled on this device. */
export function hasBiometric(): boolean {
  try {
    return !!localStorage.getItem(CRED_KEY);
  } catch {
    return false;
  }
}

/** This browser/device can do platform (built-in) user verification. */
export async function biometricSupported(): Promise<boolean> {
  try {
    if (typeof window === "undefined") return false;
    const PKC = (window as unknown as { PublicKeyCredential?: typeof PublicKeyCredential })
      .PublicKeyCredential;
    if (!PKC || !window.isSecureContext) return false;
    if (typeof PKC.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return false;
    return await PKC.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Create a platform credential (prompts Face ID / fingerprint to confirm).
 * Returns true and persists the credential id on success.
 */
export async function enrollBiometric(displayName: string): Promise<boolean> {
  if (!(await biometricSupported())) return false;
  try {
    const name = displayName?.trim() || "RELAY user";
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: "RELAY", id: location.hostname },
        user: { id: randomBytes(16), name, displayName: name },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 60_000,
        attestation: "none",
      },
    })) as PublicKeyCredential | null;
    if (!cred) return false;
    localStorage.setItem(CRED_KEY, bytesToB64url(new Uint8Array(cred.rawId)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Prompt the platform authenticator. Resolves true only if the user passed
 * verification (Face ID / fingerprint / device PIN). No-op false when nothing
 * is enrolled.
 */
export async function biometricUnlock(): Promise<boolean> {
  let id: string | null = null;
  try {
    id = localStorage.getItem(CRED_KEY);
  } catch {
    id = null;
  }
  if (!id) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: "public-key", id: b64urlToBytes(id) }],
        userVerification: "required",
        timeout: 60_000,
        rpId: location.hostname,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}

/** Forget the enrolled credential (the secure-enclave key is dropped by the OS
 *  on its own schedule; we just drop our reference). */
export function clearBiometric(): void {
  try {
    localStorage.removeItem(CRED_KEY);
  } catch {
    /* storage unavailable */
  }
}
