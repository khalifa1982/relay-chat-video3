/**
 * GIF PICKER (QW-10, v2.107.62) — a search-backed GIF picker riding the attachment
 * sheet. A chosen GIF is re-hosted server-side into a normal self-hosted attachment and
 * sent like a picked photo. The two things that matter for safety are pinned hard: the
 * key stays server-side (env-gated, never on the wire), and the re-host fetch is
 * restricted to a Giphy host allowlist (an SSRF guard on a provider-supplied URL). Also
 * pins the button-gating (absent when unconfigured, not a dead control), the search +
 * attach procedures, the bilingual strings, and the version.
 *
 * Beyond source pins, this exercises the two pure guards — `isAllowedGifUrl` and
 * `gifEnabled` — directly, since they are the SSRF and env gates.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./testing/codeOnly";
import { isAllowedGifUrl, gifEnabled } from "./gif";

const read = (rel: string) => readFileSync(join(__dirname, rel), "utf8");
const gif = codeOnly(read("./gif.ts"));
const routers = codeOnly(read("./v2routers.ts"));
const messages = codeOnly(read("../client/src/pages/app/Messages.tsx"));
const msgDict = read("../client/src/app/dict/messages.ts");
const version = read("../shared/version.ts");

const hasBilingualKey = (src: string, key: string, prefix: string): boolean => {
  const at = src.indexOf(`"${key}":`);
  if (at < 0) return false;
  const rest = src.slice(at + key.length);
  const nextKey = rest.indexOf(`"${prefix}`, 3);
  const entry = nextKey > 0 ? rest.slice(0, nextKey) : rest.slice(0, 400);
  return /\ben:/.test(entry) && /\bar:/.test(entry);
};

/* ─────────────────── the SSRF guard actually bites ─────────────────── */

describe("QW-10 — the re-host fetch is host-restricted (SSRF guard)", () => {
  it("accepts only https Giphy media hosts", () => {
    expect(isAllowedGifUrl("https://media1.giphy.com/media/abc/giphy.gif")).toBe(true);
    expect(isAllowedGifUrl("https://i.giphy.com/media/abc/giphy.gif")).toBe(true);
    expect(isAllowedGifUrl("https://media.giphy.com/media/abc/giphy.gif")).toBe(true);
  });

  it("rejects other hosts, other schemes, and internal addresses", () => {
    expect(isAllowedGifUrl("https://evil.example.com/x.gif")).toBe(false);
    expect(isAllowedGifUrl("http://media1.giphy.com/x.gif")).toBe(false); // not https
    expect(isAllowedGifUrl("https://media1.giphy.com.evil.com/x.gif")).toBe(false);
    expect(isAllowedGifUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isAllowedGifUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedGifUrl("not a url")).toBe(false);
  });
});

/* ─────────────────── env-gated: no key → off ─────────────────── */

describe("QW-10 — env-gated on a provider key", () => {
  const prev = process.env.GIPHY_API_KEY;
  beforeEach(() => {
    delete process.env.GIPHY_API_KEY;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.GIPHY_API_KEY;
    else process.env.GIPHY_API_KEY = prev;
  });

  it("gifEnabled is false with no key and true once one is set", () => {
    expect(gifEnabled()).toBe(false);
    process.env.GIPHY_API_KEY = "test-key";
    expect(gifEnabled()).toBe(true);
    process.env.GIPHY_API_KEY = "   ";
    expect(gifEnabled()).toBe(false); // whitespace-only doesn't count
  });
});

/* ─────────────────── module: search + attach shape ─────────────────── */

describe("QW-10 — the server module", () => {
  it("search pins a pg-13 rating (UGC-safe) and returns [] without a key", () => {
    expect(gif).toMatch(/rating=pg-13/);
    const at = gif.indexOf("export async function searchGifs");
    const fn = gif.slice(at, at + 400);
    expect(fn).toMatch(/if \(!key\) return \[\]/);
  });

  it("attach guards the URL, caps the bytes, checks the mime, and re-hosts", () => {
    const at = gif.indexOf("export async function attachGif");
    const fn = gif.slice(at, at + 1800);
    expect(fn).toMatch(/if \(!isAllowedGifUrl\(input\.url\)\) return \{ ok: false, reason: "bad-url" \}/);
    expect(fn).toMatch(/> MAX_GIF_BYTES\) return \{ ok: false, reason: "too-large" \}/);
    expect(fn).toMatch(/!== "image\/gif"\) return \{ ok: false, reason: "not-a-gif" \}/);
    // Re-hosted into the caller's own namespace, then recorded like any attachment.
    expect(fn).toMatch(/relay-chat\/\$\{input\.identityId\}\/gif\//);
    expect(fn).toMatch(/storagePut\(key, buf, "image\/gif"\)/);
    expect(fn).toMatch(/recordAttachment\(/);
  });
});

/* ─────────────────── router: procedures + flag ─────────────────── */

describe("QW-10 — the router exposes search, attach and the flag", () => {
  it("gifSearch reports enabled and returns results", () => {
    const at = routers.indexOf("gifSearch: publicProcedure");
    const proc = routers.slice(at, at + 700);
    expect(proc).toMatch(/if \(!gifEnabled\(\)\) return \{ enabled: false as const, results: \[\] \}/);
    expect(proc).toMatch(/searchGifs\(input\.q \?\? "", input\.limit \?\? 24\)/);
  });

  it("gifAttach maps a bad URL and too-large to sane errors", () => {
    const at = routers.indexOf("gifAttach: publicProcedure");
    const proc = routers.slice(at, at + 1400);
    expect(proc).toMatch(/attachGif\(\{ identityId: me\.id, url: input\.url/);
    expect(proc).toMatch(/"too-large": \{ code: "PAYLOAD_TOO_LARGE"/);
  });

  it("whoami reports gifSearchEnabled so the client can gate the button", () => {
    expect(routers).toMatch(/gifSearchEnabled: gifEnabled\(\)/);
  });
});

/* ─────────────────── client: gated button + picker + send ─────────────────── */

describe("QW-10 — the client picker", () => {
  it("the GIF button is shown only when the server reports it configured", () => {
    expect(messages).toMatch(/\{me\?\.gifSearchEnabled && \(/);
  });

  it("a chosen GIF is re-hosted then STAGED like a picked photo (reuses the send path)", () => {
    expect(messages).toMatch(/gifAttachMutation\.mutateAsync\(\{ url, width, height \}\)/);
    expect(messages).toMatch(/setPendingUpload\(\{ id: att\.id, url: att\.url, mimeType: att\.mimeType/);
  });

  it("the picker searches (debounced) and shows the required attribution", () => {
    expect(messages).toMatch(/function GifPicker/);
    expect(messages).toMatch(/trpc\.identity\.gifSearch\.useQuery/);
    expect(messages).toMatch(/setDebouncedQ\(q\.trim\(\)\)/);
    expect(messages).toMatch(/t\("msg\.gifPoweredBy"\)/);
  });

  it("display uses the preview URL in an <img> (no client CORS needed to show it)", () => {
    expect(messages).toMatch(/src=\{g\.previewUrl\}/);
    // The full URL only goes UP to onPick (server re-hosts it), never fetched client-side.
    expect(messages).toMatch(/onPick\(g\.gifUrl, g\.width, g\.height\)/);
  });
});

/* ─────────────────── i18n + version ─────────────────── */

describe("QW-10 — strings are bilingual and it shipped at or past its release", () => {
  it("the GIF strings are in en and ar", () => {
    for (const k of ["msg.gifPick", "msg.gifSearchPlaceholder", "msg.gifNoResults", "msg.gifPoweredBy", "msg.gifFailed"]) {
      expect(hasBilingualKey(msgDict, k, '"msg.'), k).toBe(true);
    }
  });

  /* Floor check, not an exact pin — the version has exactly ONE owner
     (client/src/app/updateChecker.test.ts). What matters here is only that QW-10 shipped
     at or after the release that introduced it, so this stays green on every later
     release instead of going red and needing a hand-bump. */
  it("the app version is at or past the release that introduced it", () => {
    const m = /APP_VERSION = "(\d+)\.(\d+)\.(\d+)"/.exec(version);
    expect(m, "version.ts must declare a version").toBeTruthy();
    const got = [+m![1], +m![2], +m![3]];
    const min = [2, 107, 63];
    expect(got[0] * 1e6 + got[1] * 1e3 + got[2]).toBeGreaterThanOrEqual(min[0] * 1e6 + min[1] * 1e3 + min[2]);
  });
});
