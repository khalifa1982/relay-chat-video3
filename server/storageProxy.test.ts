/* ============================================================
   v2.91 review D2 — /manus-storage traversal guard must be
   SEGMENT-WISE, matching sanitizeS3Key.

   v2upload's safeName keeps dots and appendHashSuffix/minting
   preserves the original filename, so a legal upload like
   "photo..2020.png" mints a key CONTAINING ".." on both storage
   drivers. The original substring guard (`key.includes("..")`)
   permanently 400'd every such attachment — including pre-v2.91
   rows already live on .org. Only a full "."/".." PATH SEGMENT is
   hostile (Express percent-decodes before req.params, so encoded
   traversal still arrives as a real segment).

   Requests are issued with a RAW http client: fetch()/new URL()
   resolve dot segments client-side, which would hide the exact
   path shape a hostile client (curl --path-as-is) can send.
   ============================================================ */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { registerStorageProxy, _clearStorageProxyCache } from "./_core/storageProxy";

// This suite exercises the TRAVERSAL GUARD (segment-wise), which runs BEFORE the
// participant-only authorization added later. Stub the auth to pass so a legal
// key reaches the streaming path — the authorization decision table itself is
// covered by server/_core/storageProxy.test.ts.
vi.mock("./_core/context", () => ({
  createContext: async () => ({ identity: { id: 5 } }),
}));
vi.mock("./v2db", () => ({
  authorizeStorageKey: async () => ({ kind: "attachment", authorized: true }),
}));

// Drive the native-S3 branch: presigning is pure local crypto (no network),
// so a passing key deterministically yields a 307 redirect.
const S3_VARS: Record<string, string> = {
  S3_BUCKET: "test-bucket",
  S3_REGION: "ap-south-1",
  S3_ACCESS_KEY: "AKIAIOSFODNN7EXAMPLE",
  S3_SECRET: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const [k, v] of Object.entries(S3_VARS)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  _clearStorageProxyCache();
  // v2.99.14: the proxy now STREAMS bytes (it fetches the presigned URL
  // server-side instead of redirecting the browser to it). Stub that upstream
  // fetch so a legal key completes deterministically with no real network.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "3" },
      })
    )
  );
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _clearStorageProxyCache();
  vi.unstubAllGlobals();
});

/** GET `rawPath` with Node's http client — the request-target is sent
 *  verbatim (no client-side dot-segment resolution). */
async function rawGet(
  rawPath: string
): Promise<{ status: number; location: string | undefined }> {
  const app = express();
  registerStorageProxy(app);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: rawPath, method: "GET" },
        (res) => {
          res.resume();
          res.on("end", () =>
            resolve({ status: res.statusCode ?? 0, location: res.headers.location })
          );
        }
      );
      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("storage proxy traversal guard (segment-wise, v2.91 review D2)", () => {
  it('STREAMS a legal key whose FILENAME contains ".." ("photo..2020.png"-style) — 200, and NEVER redirects to a presigned URL (v2.99.14)', async () => {
    const { status, location } = await rawGet("/manus-storage/relay-chat/5/a..b_hash.png");
    // Legal key passes the segment-wise guard and is streamed back through the
    // proxy (200), NOT 307-redirected — so the browser never sees a shareable
    // presigned storage URL (no Location header).
    expect(status).toBe(200);
    expect(location).toBeUndefined();
  });

  it('rejects a real ".." PATH SEGMENT with 400', async () => {
    const { status } = await rawGet("/manus-storage/relay-chat/../x");
    expect(status).toBe(400);
  });

  it('rejects percent-encoded traversal ("%2e%2e" decodes to a ".." segment) with 400', async () => {
    const { status } = await rawGet("/manus-storage/relay-chat/%2e%2e/x");
    expect(status).toBe(400);
  });

  it('rejects a bare "." segment with 400 (same sanitizeS3Key form)', async () => {
    const { status } = await rawGet("/manus-storage/relay-chat/./x");
    expect(status).toBe(400);
  });
});
