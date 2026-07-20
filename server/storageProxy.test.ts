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
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { registerStorageProxy, _clearStorageProxyCache } from "./_core/storageProxy";

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
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _clearStorageProxyCache();
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
  it('serves a legal key whose FILENAME contains ".." ("photo..2020.png"-style) with a 307', async () => {
    const { status, location } = await rawGet("/manus-storage/relay-chat/5/a..b_hash.png");
    expect(status).toBe(307);
    expect(location).toContain("test-bucket.s3.ap-south-1.amazonaws.com");
    expect(location).toContain("/relay-chat/5/a..b_hash.png");
    expect(location).toContain("X-Amz-Signature=");
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
