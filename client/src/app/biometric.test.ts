import { describe, it, expect, beforeEach } from "vitest";

/**
 * Tests for the biometric (WebAuthn) local-unlock helpers. The WebAuthn calls
 * themselves need a real platform authenticator, so here we cover the pure,
 * testable surface: base64url round-tripping (the credential-id codec),
 * localStorage-backed enrolled state, the no-credential short-circuit, and the
 * capability gate. localStorage is polyfilled for the node test env.
 */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}
const mem = new MemStorage();
(globalThis as unknown as { localStorage: MemStorage }).localStorage = mem;

import {
  bytesToB64url,
  b64urlToBytes,
  hasBiometric,
  biometricSupported,
  biometricUnlock,
  clearBiometric,
} from "./biometric";

beforeEach(() => {
  mem.clear();
  // Ensure no `window` leaks a PublicKeyCredential between tests.
  delete (globalThis as Record<string, unknown>).window;
});

describe("biometric base64url codec", () => {
  it("round-trips arbitrary bytes (no padding, url-safe alphabet)", () => {
    for (const len of [0, 1, 2, 3, 4, 16, 17, 31, 32, 64]) {
      const src = new Uint8Array(len);
      for (let i = 0; i < len; i++) src[i] = (i * 37 + 11) & 0xff;
      const round = b64urlToBytes(bytesToB64url(src));
      expect(Array.from(round), `len ${len}`).toEqual(Array.from(src));
    }
  });

  it("emits only url-safe characters (no +, /, or =)", () => {
    const src = new Uint8Array([251, 239, 190, 255, 0, 128, 64]);
    const s = bytesToB64url(src);
    expect(s).not.toMatch(/[+/=]/);
  });
});

describe("biometric enrolled-state", () => {
  it("reports not-enrolled on a fresh device", () => {
    expect(hasBiometric()).toBe(false);
  });

  it("reports enrolled once a credential id is stored, and clears it", () => {
    mem.setItem("relay_bio_cred", bytesToB64url(new Uint8Array([1, 2, 3, 4])));
    expect(hasBiometric()).toBe(true);
    clearBiometric();
    expect(hasBiometric()).toBe(false);
  });

  it("biometricUnlock short-circuits to false when nothing is enrolled (no navigator needed)", async () => {
    expect(hasBiometric()).toBe(false);
    await expect(biometricUnlock()).resolves.toBe(false);
  });
});

describe("biometricSupported capability gate", () => {
  it("is false when there is no window / PublicKeyCredential", async () => {
    await expect(biometricSupported()).resolves.toBe(false);
  });

  it("is false in an insecure context even if PublicKeyCredential exists", async () => {
    (globalThis as Record<string, unknown>).window = {
      isSecureContext: false,
      PublicKeyCredential: {
        isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
      },
    };
    await expect(biometricSupported()).resolves.toBe(false);
  });

  it("reflects the platform-authenticator probe in a secure context", async () => {
    (globalThis as Record<string, unknown>).window = {
      isSecureContext: true,
      PublicKeyCredential: {
        isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
      },
    };
    await expect(biometricSupported()).resolves.toBe(true);

    (globalThis as Record<string, unknown>).window = {
      isSecureContext: true,
      PublicKeyCredential: {
        isUserVerifyingPlatformAuthenticatorAvailable: async () => false,
      },
    };
    await expect(biometricSupported()).resolves.toBe(false);
  });
});
