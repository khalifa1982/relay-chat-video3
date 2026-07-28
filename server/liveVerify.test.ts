/**
 * The live-verification checks are BEHAVIOURAL, driven against real spawned
 * servers, because that is the only way to know whether they would actually
 * catch a broken deployment.
 *
 * Task #44 sat blocked for six releases on one sentence: the agent sandbox
 * cannot reach `your-chat.io`. The checks therefore run somewhere that can (the
 * CI runner, and an app instance over SSM) — but that means nothing here can
 * observe them working, so a source pin would prove only that some code was
 * written. So each check is pointed at a local HTTP server that serves a
 * DELIBERATELY BROKEN response, and the check must go red. A verification tool
 * that cannot fail is worse than none, because it reports health.
 *
 * Three of these tests exist because the check itself was wrong the first time
 * it ran against a healthy site — see the comments on each.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
// Both scripts guard their own main body, so importing them here runs nothing.
// @ts-expect-error — plain .mjs by design: it must run under bare `node` on an
// EC2 instance, from the release tar, with no build step.
import { readExpectedVersion, assetUrlsFrom, markupOnly, lazyChunkNames, runChecks, isLoopbackHost } from "../scripts/live-verify.mjs";
// @ts-expect-error — same.
import { resolveFrom, readSmtpConfig, verifyMail } from "../scripts/mail-verify.mjs";
import { APP_VERSION } from "../shared/version";

const ROOT = path.resolve(__dirname, "..");

type Result = { name: string; verdict: string; note: string };
const verdictOf = (rs: Result[], name: string) => rs.find((r) => r.name === name)?.verdict;
const noteOf = (rs: Result[], name: string) => rs.find((r) => r.name === name)?.note ?? "";

/* ── a stub deployment we can break on purpose ────────────────────────────── */

const GOOD_CSS = `.x{color:red}@keyframes relaySheen{0%{}}@keyframes relayWordPop{0%{}}`;
const RTL = String.fromCharCode(34) + "rtl" + String.fromCharCode(34);
const LTR = String.fromCharCode(34) + "ltr" + String.fromCharCode(34);
// Byte-for-byte what the real landing chunk contains: the selector text appears
// unescaped in the shipped bundle. Written with backslash-escaped quotes it
// produced `[dir=\"rtl\"]`, which the check correctly reported as missing the
// rules — the fixture was wrong, not the check.
const GOOD_HOME =
  `var css=".lp-root[dir=${RTL}] *{font-family:'Noto Kufi Arabic',sans-serif!important}"+` +
  `".lp-root[dir=${RTL}] [dir=${LTR}]{font-family:'IBM Plex Mono',monospace!important}";`;
const GOOD_ENTRY = `import("./Home-abc123.js");console.log("entry");`;
const GOOD_HTML = `<!doctype html><html><head>
<script type="module" src="/assets/index-aaa.js"></script>
<link rel="stylesheet" href="/assets/index-bbb.css">
</head><body><div id="root"></div></body></html>`;

type Overrides = Record<string, (req: http.IncomingMessage, res: http.ServerResponse) => void>;

/** Spin up a stub that answers every endpoint the checks probe, with named
 *  routes any test may override to inject exactly one defect. */
async function stubSite(overrides: Overrides = {}, bindAll = false) {
  const routes: Overrides = {
    "/api/version": (_q, res) => res.end(JSON.stringify({ version: APP_VERSION })),
    "/api/health": (_q, res) =>
      res.end(JSON.stringify({ status: "ok", instance: "abcdef1234", redisBus: false, cluster: false, signalingPinned: true })),
    "/": (_q, res) => res.end(GOOD_HTML),
    "/assets/index-aaa.js": (_q, res) => res.end(GOOD_ENTRY),
    "/assets/index-bbb.css": (_q, res) => res.end(GOOD_CSS),
    "/assets/Home-abc123.js": (_q, res) => res.end(GOOD_HOME),
    "/api/trpc/directory.lookup": (_q, res) => res.end(JSON.stringify([{ result: { data: { json: null } } }])),
    "/api/relay/ice": (_q, res) =>
      res.end(JSON.stringify({ iceServers: [{ urls: ["stun:a:3478"] }, { urls: ["turn:b:3478?transport=udp"] }] })),
    "/robots.txt": (_q, res) => res.end("User-agent: *\n"),
    "/sitemap.xml": (q, res) => res.end(`<?xml version="1.0"?><urlset><url><loc>http://${q.headers.host}/</loc></url></urlset>`),
    ...overrides,
  };
  const server = http.createServer((req, res) => {
    const p = (req.url || "/").split("?")[0];
    const h = routes[p];
    if (h) {
      res.statusCode = 200;
      return h(req, res);
    }
    if (p.startsWith("/manus-storage/")) {
      res.statusCode = 403;
      return res.end("forbidden");
    }
    res.statusCode = 404;
    res.end("nope");
  });
  await new Promise<void>((r) => (bindAll ? server.listen(0, r) : server.listen(0, "127.0.0.1", r)));
  const port = (server.address() as net.AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** Run the checks against a stub. `root` points somewhere with no dist/, so the
 *  byte-comparison SKIPs rather than depending on a build having happened. */
async function checksAgainst(overrides: Overrides = {}, number = ""): Promise<Result[]> {
  const site = await stubSite(overrides);
  try {
    return (await runChecks(site.base, { root: "/nonexistent-root", number })) as Result[];
  } finally {
    await site.close();
  }
}

describe("live-verify — the happy path", () => {
  it("passes every applicable check against a healthy deployment", async () => {
    const rs = await checksAgainst();
    const failed = rs.filter((r) => r.verdict === "FAIL");
    expect(failed.map((f) => `${f.name}: ${f.note}`)).toEqual([]);
    // Every check must report SOMETHING; a check silently absent is a check
    // that cannot fail.
    for (const name of [
      "version", "health", "index.html", "assets fetched", "assets === local build",
      "arabic parity rules live", "wordmark flourish live", "landing dialer lookup",
      "ice servers", "seo is dynamic", "media stays in the app",
    ]) {
      expect(verdictOf(rs, name), `${name} did not run`).toBeDefined();
    }
  });

  it("PASSES the byte comparison when the live assets really are this build's", async () => {
    /* A mutation run found this untested, and it is the single most important
       check in the file: it is what lets every measurement taken against the
       local build be claimed of production. Every other test here uses an empty
       root, so the comparison always SKIPped and gutting it changed nothing. */
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "relay-lv-root-"));
    const dir = path.join(root, "dist", "public", "assets");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index-aaa.js"), GOOD_ENTRY);
    fs.writeFileSync(path.join(dir, "index-bbb.css"), GOOD_CSS);
    fs.writeFileSync(path.join(dir, "Home-abc123.js"), GOOD_HOME);
    const site = await stubSite();
    try {
      const rs = (await runChecks(site.base, { root })) as Result[];
      expect(verdictOf(rs, "assets === local build")).toBe("PASS");
      expect(noteOf(rs, "assets === local build")).toMatch(/3 asset\(s\) byte-identical/);
    } finally {
      await site.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("FAILS the byte comparison when one live asset's CONTENT differs", async () => {
    // Same name, different bytes: the deploy that half-landed, or a CDN serving
    // a stale object under a name vite already reused.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "relay-lv-root-"));
    const dir = path.join(root, "dist", "public", "assets");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index-aaa.js"), GOOD_ENTRY);
    fs.writeFileSync(path.join(dir, "index-bbb.css"), GOOD_CSS + "/* drifted */");
    fs.writeFileSync(path.join(dir, "Home-abc123.js"), GOOD_HOME);
    const site = await stubSite();
    try {
      const rs = (await runChecks(site.base, { root })) as Result[];
      expect(verdictOf(rs, "assets === local build")).toBe("FAIL");
      expect(noteOf(rs, "assets === local build")).toMatch(/index-bbb\.css differs/);
    } finally {
      await site.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("FAILS the byte comparison when a live asset is not in this build at all", async () => {
    // Vite hashes content into the filename, so a name absent locally IS a
    // content difference — and a clearer one to report than a hash mismatch.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "relay-lv-root-"));
    const dir = path.join(root, "dist", "public", "assets");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index-aaa.js"), GOOD_ENTRY);
    fs.writeFileSync(path.join(dir, "index-bbb.css"), GOOD_CSS);
    // Home-abc123.js deliberately not written.
    const site = await stubSite();
    try {
      const rs = (await runChecks(site.base, { root })) as Result[];
      expect(verdictOf(rs, "assets === local build")).toBe("FAIL");
      expect(noteOf(rs, "assets === local build")).toMatch(/Home-abc123\.js is not in this build/);
    } finally {
      await site.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("SKIPs the byte comparison rather than passing it when there is no local build", async () => {
    // A skip reported as a pass is how this check would rot: it is the one that
    // carries the whole render-side argument, so it must never look green
    // without actually having compared anything.
    const rs = await checksAgainst();
    expect(verdictOf(rs, "assets === local build")).toBe("SKIP");
    expect(noteOf(rs, "assets === local build")).toMatch(/cannot compare bytes/);
  });
});

describe("live-verify — each check actually bites", () => {
  it("FAILS when the fleet serves a different version than this tree", async () => {
    // ROOT, not the empty root the other cases use: with nothing to compare
    // against the check SKIPs, which is the honest answer and not this property.
    const site = await stubSite({
      "/api/version": (_q, res) => res.end(JSON.stringify({ version: "0.0.1" })),
    });
    const rs = (await runChecks(site.base, { root: ROOT })) as Result[];
    await site.close();
    expect(verdictOf(rs, "version")).toBe("FAIL");
    expect(noteOf(rs, "version")).toMatch(/NOT running this commit/);
  });

  it("FAILS on an unsubstituted build placeholder in the served markup", async () => {
    const rs = await checksAgainst({
      "/": (_q, res) =>
        res.end(GOOD_HTML.replace("<div id=\"root\">", '<script src="%VITE_ANALYTICS_ENDPOINT%/umami"></script><div id="root">')),
    });
    expect(verdictOf(rs, "index.html")).toBe("FAIL");
    expect(noteOf(rs, "index.html")).toMatch(/placeholder/);
  });

  it("PASSES a page whose only mention of a placeholder is in a comment", async () => {
    // THE trap this repo keeps falling into, and it caught me here too: the real
    // client/index.html carries a comment explaining that a static analytics tag
    // used to leave `%VITE_ANALYTICS_ENDPOINT%` behind, so the first version of
    // the check went red against a perfectly healthy build — matching the prose
    // that describes the bug instead of the bug.
    const rs = await checksAgainst({
      "/": (_q, res) => res.end(GOOD_HTML.replace("<body>", "<body><!-- %VITE_ANALYTICS_ENDPOINT% was removed -->")),
    });
    expect(verdictOf(rs, "index.html")).toBe("PASS");
  });

  it("FAILS when the served landing bundle has lost the Arabic parity rules", async () => {
    const rs = await checksAgainst({
      "/assets/Home-abc123.js": (_q, res) => res.end(`console.log("no arabic rules here")`),
    });
    expect(verdictOf(rs, "arabic parity rules live")).toBe("FAIL");
    const note = noteOf(rs, "arabic parity rules live");
    expect(note).toMatch(/Noto Kufi Arabic/);
    expect(note).toMatch(/RTL font override/);
    expect(note).toMatch(/LTR-island override/);
  });

  it("FAILS on the RTL override alone going missing, not just the whole block", async () => {
    // v2.99.21 was exactly this shape: the font was loaded and the rules were
    // present but one selector no longer matched. A check that only asks "is
    // Arabic mentioned" would have passed that release.
    const rs = await checksAgainst({
      "/assets/Home-abc123.js": (_q, res) =>
        res.end(`var css="'Noto Kufi Arabic'" + ".lp-root[dir=\\"rtl\\"] [dir=\\"ltr\\"]{}";`),
    });
    expect(verdictOf(rs, "arabic parity rules live")).toBe("FAIL");
    expect(noteOf(rs, "arabic parity rules live")).toMatch(/RTL font override/);
  });

  it("FAILS when the 390px wordmark breakpoint reappears", async () => {
    const rs = await checksAgainst({
      "/assets/index-aaa.js": (_q, res) => res.end(`${GOOD_ENTRY};var c="max-[389px]:hidden";`),
    });
    expect(verdictOf(rs, "wordmark flourish live")).toBe("FAIL");
    expect(noteOf(rs, "wordmark flourish live")).toMatch(/breakpoint is back/);
  });

  it("FAILS when the landing page's own chunk is unreachable", async () => {
    const rs = await checksAgainst({
      "/assets/Home-abc123.js": (_q, res) => {
        res.statusCode = 404;
        res.end("gone");
      },
    });
    expect(verdictOf(rs, "assets fetched")).toBe("FAIL");
  });

  it("FAILS when the entry bundle names no landing chunk at all", async () => {
    const rs = await checksAgainst({
      "/assets/index-aaa.js": (_q, res) => res.end(`console.log("nothing lazy here")`),
    });
    expect(verdictOf(rs, "assets fetched")).toBe("FAIL");
    expect(noteOf(rs, "assets fetched")).toMatch(/landing page is unreachable/);
  });

  it("FAILS when the resolver the landing dialer depends on is down", async () => {
    const rs = await checksAgainst({
      "/api/trpc/directory.lookup": (_q, res) => {
        res.statusCode = 500;
        res.end("boom");
      },
    });
    expect(verdictOf(rs, "landing dialer lookup")).toBe("FAIL");
  });

  it("reports an unknown number as NOT FOUND, never as a nameless user", async () => {
    // My own bug, caught by reading the note rather than trusting the PASS:
    // superjson wraps a null result as `{json: null}`, and unwrapping with `??`
    // falls through on null to the WRAPPER — a truthy object — so a number that
    // does not exist was reported as a resolved user who is offline. That is the
    // same false claim the landing page itself was fixed for in v2.99.25.
    const rs = await checksAgainst();
    expect(verdictOf(rs, "landing dialer lookup")).toBe("PASS");
    expect(noteOf(rs, "landing dialer lookup")).toMatch(/no such user/);
    expect(noteOf(rs, "landing dialer lookup")).not.toMatch(/offline|online/);
  });

  it("names the person and their presence when the number DOES resolve", async () => {
    const rs = await checksAgainst(
      {
        "/api/trpc/directory.lookup": (_q, res) =>
          res.end(JSON.stringify([{ result: { data: { json: { displayName: "Sara", isOnline: true } } } }])),
      },
      "777777",
    );
    expect(verdictOf(rs, "landing dialer lookup")).toBe("PASS");
    expect(noteOf(rs, "landing dialer lookup")).toMatch(/777777 → Sara · online/);
  });

  it("FAILS when no ICE server is advertised, so no call could traverse NAT", async () => {
    const rs = await checksAgainst({
      "/api/relay/ice": (_q, res) => res.end(JSON.stringify({ iceServers: [] })),
    });
    expect(verdictOf(rs, "ice servers")).toBe("FAIL");
  });

  it("FAILS when the sitemap advertises a host other than the one that served it", async () => {
    /* The stub listens on 127.0.0.1, which the check now treats as a loopback
       probe — so this drives it through a NON-loopback base to exercise the
       self-reference rule. A `Host` header is enough: the stub echoes whatever it
       is given, and the check reads the base URL it was asked about. */
    // BOUND TO ALL INTERFACES, deliberately: the stub otherwise listens on
    // 127.0.0.1 only, so addressing it by a non-loopback IP never connected and
    // the check FAILED by THROWING — the assertion below then passed for the
    // wrong reason, which a mutation disabling the self-reference rule proved by
    // surviving. No public DNS is involved either way.
    const site = await stubSite({
      "/sitemap.xml": (_q, res) => res.end(`<?xml version="1.0"?><urlset><url><loc>https://example.org/</loc></url></urlset>`),
    }, true);
    const port = new URL(site.base).port;
    try {
      const addr = Object.values(os.networkInterfaces())
        .flat()
        .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
      expect(addr, "no non-loopback IPv4 on this host — cannot exercise the public branch").toBeTruthy();
      const rs = (await runChecks(`http://${addr}:${port}`, { root: "/nonexistent-root" })) as Result[];
      // The SPECIFIC message, not merely "not loopback": a thrown fetch also
      // produces a FAIL, and only the wording distinguishes the two.
      expect(noteOf(rs, "seo is dynamic")).toMatch(/names a different host/);
      expect(verdictOf(rs, "seo is dynamic")).toBe("FAIL");
    } finally {
      await site.close();
    }
  });

  it("PASSES a loopback probe whose sitemap names the fleet's configured origin", async () => {
    /* THE FALSE FAILURE THIS CHECK PRODUCED ON ITS FIRST REAL RUN, pinned.
       `appBaseUrl()` resolves APP_URL, then DOMAIN, and only then the request's
       Host — so a fleet with either set (the recommended configuration) serves
       `https://your-chat.io` to everyone, including the in-fleet probe against
       127.0.0.1. Demanding self-reference there called correct behaviour a
       failure, from the one vantage point that cannot see its own public name. */
    const rs = await checksAgainst({
      "/sitemap.xml": (_q, res) => res.end(`<?xml version="1.0"?><urlset><url><loc>https://your-chat.io/</loc></url></urlset>`),
    });
    expect(verdictOf(rs, "seo is dynamic")).toBe("PASS");
    expect(noteOf(rs, "seo is dynamic")).toMatch(/your-chat\.io/);
  });

  it("still FAILS a loopback probe served a sitemap with no absolute origin", async () => {
    // The weaker loopback rule must still catch a stale STATIC sitemap, which is
    // what the check exists for.
    const rs = await checksAgainst({
      "/sitemap.xml": (_q, res) => res.end(`<?xml version="1.0"?><urlset><url><loc>/</loc></url></urlset>`),
    });
    expect(verdictOf(rs, "seo is dynamic")).toBe("FAIL");
    expect(noteOf(rs, "seo is dynamic")).toMatch(/no absolute <loc>/);
  });

  it("FAILS when an anonymous caller is served a storage object", async () => {
    const site = await stubSite();
    // Serve any /manus-storage/ key with a 200 — the v2.99.14 lockdown regressing.
    const rs = (await (async () => {
      const s2 = http.createServer((req, res) => {
        if ((req.url || "").startsWith("/manus-storage/")) {
          res.statusCode = 200;
          return res.end("bytes");
        }
        // proxy everything else to the healthy stub
        res.statusCode = 302;
        res.setHeader("location", site.base + req.url);
        res.end();
      });
      await new Promise<void>((r) => s2.listen(0, "127.0.0.1", r));
      const port = (s2.address() as net.AddressInfo).port;
      try {
        return (await runChecks(`http://127.0.0.1:${port}`, { root: "/nonexistent-root" })) as Result[];
      } finally {
        await new Promise<void>((r) => s2.close(() => r()));
      }
    })());
    await site.close();
    expect(verdictOf(rs, "media stays in the app")).toBe("FAIL");
    expect(noteOf(rs, "media stays in the app")).toMatch(/anonymous/);
  });

  it("FAILS when the proxy redirects anonymously to a copyable presigned URL", async () => {
    // v2.99.14 replaced a 307-to-S3 with a server-side stream precisely because
    // the redirect target was replayable by anyone for its lifetime.
    const s2 = http.createServer((req, res) => {
      if ((req.url || "").startsWith("/manus-storage/")) {
        res.statusCode = 307;
        res.setHeader("location", "https://bucket.s3.amazonaws.com/key?X-Amz-Signature=deadbeef");
        return res.end();
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => s2.listen(0, "127.0.0.1", r));
    const port = (s2.address() as net.AddressInfo).port;
    try {
      const rs = (await runChecks(`http://127.0.0.1:${port}`, { root: "/nonexistent-root" })) as Result[];
      expect(verdictOf(rs, "media stays in the app")).toBe("FAIL");
      expect(noteOf(rs, "media stays in the app")).toMatch(/shareable/);
    } finally {
      await new Promise<void>((r) => s2.close(() => r()));
    }
  });

  it("degrades to FAIL, never a crash, when the site is not there at all", async () => {
    // A verification tool that throws on an unreachable site tells you nothing
    // about the checks it never got to.
    const rs = (await runChecks("http://127.0.0.1:1", { root: "/nonexistent-root" })) as Result[];
    expect(rs.length).toBeGreaterThan(5);
    expect(rs.some((r) => r.verdict === "FAIL")).toBe(true);
    expect(rs.every((r) => ["PASS", "FAIL", "SKIP"].includes(r.verdict))).toBe(true);
  });
});

describe("live-verify — the pure helpers", () => {
  it("reads the SAME version the server serves and the client bakes in", () => {
    // The comparison is only meaningful if this reader agrees with the real
    // constant; a regex that silently stops matching would make every live
    // check SKIP with nothing to compare.
    expect(readExpectedVersion(ROOT)).toBe(APP_VERSION);
  });

  it("returns null rather than guessing when the version file is unreadable", () => {
    expect(readExpectedVersion("/nonexistent-root")).toBeNull();
  });

  it("strips comments and leaves the markup", () => {
    expect(markupOnly(`<a><!-- %VITE_X% -->b</a>`)).toBe(`<a>b</a>`);
    expect(markupOnly(`<!--\nmulti\nline\n--><b>`)).toBe(`<b>`);
  });

  it("finds no placeholder in the REAL client/index.html once comments are gone", () => {
    // Pinned against the actual file, because that file is what made the check
    // wrong: it genuinely contains the string, inside a comment.
    const html = fs.readFileSync(path.join(ROOT, "client", "index.html"), "utf8");
    expect(html).toMatch(/%VITE_[A-Z0-9_]+%/); // still true — it is in the comment
    expect(markupOnly(html)).not.toMatch(/%VITE_[A-Z0-9_]+%/);
  });

  it("absolutises only /assets/ script and stylesheet references", () => {
    const urls = assetUrlsFrom(
      `<script src="/assets/a.js"></script><link href="/assets/b.css"><script src="/other.js"></script><link href="/x.css">`,
      "https://h",
    );
    expect(urls).toEqual(["https://h/assets/a.js", "https://h/assets/b.css"]);
  });

  it("ignores an asset reference that is only inside a comment", () => {
    expect(assetUrlsFrom(`<!-- <script src="/assets/ghost.js"></script> --><script src="/assets/real.js"></script>`, "https://h"))
      .toEqual(["https://h/assets/real.js"]);
  });

  it("recognises the in-fleet probe's host, and only that", () => {
    for (const h of ["127.0.0.1", "127.1.2.3", "localhost", "LOCALHOST", "::1", "[::1]"]) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
    for (const h of ["your-chat.io", "10.0.0.4", "192.168.1.9", "example.com", "1270.0.0.1", ""]) {
      expect(isLoopbackHost(h), h).toBe(false);
    }
  });

  it("discovers the lazily-imported landing chunk by name", () => {
    expect(lazyChunkNames(`import("./Home-BD9-7zFK.js")`, "Home")).toEqual(["Home-BD9-7zFK.js"]);
    expect(lazyChunkNames(`nothing`, "Home")).toEqual([]);
    // Deduped: vite emits the specifier more than once (import + preload map).
    expect(lazyChunkNames(`"Home-a1.js" ... "Home-a1.js"`, "Home")).toEqual(["Home-a1.js"]);
  });

  it("finds the landing chunk in this tree's REAL build when one exists", () => {
    // Guards the assumption the whole Arabic check rests on: that the landing
    // page is a chunk named Home-*, discoverable from the entry bundle. If the
    // build ever stops code-splitting it, this says so instead of the live check
    // quietly reading the wrong file.
    const dir = path.join(ROOT, "dist", "public", "assets");
    if (!fs.existsSync(dir)) return; // no build here; the CI job builds first
    const names = fs.readdirSync(dir);
    const entry = names.find((n) => /^index-.*\.js$/.test(n));
    if (!entry) return;
    const js = fs.readFileSync(path.join(dir, entry), "utf8");
    const found = lazyChunkNames(js, "Home") as string[];
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) expect(names).toContain(f);
  });
});

/* ── mail-verify ──────────────────────────────────────────────────────────── */

/** A throwaway self-signed certificate for 127.0.0.1, minted per run.
 *
 *  The fake server has to perform a REAL STARTTLS upgrade, because
 *  `server/smtp.ts` requires one whenever the port is not implicit-TLS and this
 *  checker deliberately matches that: credentials must never cross an
 *  unencrypted link. Verification stays FULL-STRENGTH — the client is handed
 *  this certificate as its CA rather than being told to stop checking, which is
 *  what `rejectUnauthorized: false` would have done and what would have made
 *  the whole test meaningless. */
function mintTestCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-smtp-test-"));
  const key = path.join(dir, "k.pem");
  const cert = path.join(dir, "c.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-keyout", key, "-out", cert,
    "-days", "2", "-nodes", "-subj", "/CN=relay-smtp-test",
    "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost",
  ], { stdio: "ignore" });
  return { key: fs.readFileSync(key, "utf8"), cert: fs.readFileSync(cert, "utf8"), dir };
}

let TESTCERT: { key: string; cert: string; dir: string };
beforeAll(() => {
  // Deliberately NOT skipped when openssl is missing: a test that quietly does
  // nothing reports safety, which is the failure mode this whole file exists to
  // avoid. Every environment this runs in (this container, ubuntu-latest) has it.
  TESTCERT = mintTestCert();
});
afterAll(() => {
  if (TESTCERT?.dir) fs.rmSync(TESTCERT.dir, { recursive: true, force: true });
});

type SmtpOpts = { rejectAuth?: boolean; rejectRcpt?: boolean; noStarttls?: boolean; refuseStarttls?: boolean };

/** A fake SMTP server that can be told to refuse at any stage. Modelled on the
 *  fake coturn used to validate `turn-check.mjs`: the protocol has to be spoken
 *  correctly, and a string check of the script cannot show that. */
async function fakeSmtp(opts: SmtpOpts = {}) {
  const seen: string[] = [];
  const live: net.Socket[] = [];
  const closeWatchers: Array<() => void> = [];
  const server = net.createServer((raw) => {
    live.push(raw);
    raw.on("close", () => {
      for (const w of closeWatchers) w();
    });
    let sock: net.Socket | tls.TLSSocket = raw;
    let stage = "";
    const say = (s: string) => sock.write(s);
    const onLine = (line: string) => {
      if (stage === "data") {
        if (line === ".") {
          stage = "";
          say("250 2.0.0 Ok: queued as FAKE1\r\n");
        }
        return;
      }
      seen.push(line);
      const u = line.toUpperCase();
      if (u.startsWith("EHLO")) {
        const offerTls = !opts.noStarttls && !(sock as tls.TLSSocket).encrypted;
        say(`250-fake\r\n${offerTls ? "250-STARTTLS\r\n" : ""}250 AUTH LOGIN\r\n`);
      } else if (u === "STARTTLS") {
        if (opts.refuseStarttls) return say("502 not implemented here\r\n");
        say("220 2.0.0 Ready to start TLS\r\n");
        raw.removeAllListeners("data");
        const secured = new tls.TLSSocket(raw, {
          isServer: true,
          key: TESTCERT.key,
          cert: TESTCERT.cert,
        });
        sock = secured;
        secured.on("data", pump);
        secured.on("error", () => {});
      } else if (u === "AUTH LOGIN") {
        stage = "user";
        say("334 VXNlcm5hbWU6\r\n");
      } else if (stage === "user") {
        stage = "pass";
        say("334 UGFzc3dvcmQ6\r\n");
      } else if (stage === "pass") {
        stage = "";
        say(opts.rejectAuth ? "535 5.7.8 Authentication credentials invalid\r\n" : "235 2.7.0 Authentication successful\r\n");
      } else if (u.startsWith("MAIL FROM")) {
        say("250 2.1.0 Ok\r\n");
      } else if (u.startsWith("RCPT TO")) {
        say(
          opts.rejectRcpt
            ? "554 Message rejected: Email address is not verified. The following identities failed the check in region AP-SOUTH-1\r\n"
            : "250 2.1.5 Ok\r\n",
        );
      } else if (u === "DATA") {
        stage = "data";
        say("354 End data with <CR><LF>.<CR><LF>\r\n");
      } else if (u === "RSET") {
        say("250 2.0.0 Ok\r\n");
      } else if (u === "QUIT") {
        say("221 2.0.0 Bye\r\n");
        sock.end();
      } else {
        say("250 2.0.0 Ok\r\n");
      }
    };
    let pending = "";
    const pump = (d: Buffer) => {
      pending += d.toString("utf8");
      let i;
      while ((i = pending.indexOf("\r\n")) >= 0) {
        const line = pending.slice(0, i);
        pending = pending.slice(i + 2);
        onLine(line);
      }
    };
    raw.write("220 fake.smtp ESMTP ready\r\n");
    raw.on("data", pump);
    raw.on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    seen,
    onClose(fn: () => void) {
      closeWatchers.push(fn);
    },
    async close() {
      // `server.close()` refuses to call back while any connection is open, so a
      // client that abandoned the dialogue would wedge teardown forever. The
      // script now closes its own socket on every exit path; destroying here too
      // means a future leak shows up as a failing assertion rather than a
      // mysterious five-second timeout.
      for (const c of live) c.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

// `localhost`, not 127.0.0.1: TLS SNI with a bare IP is disallowed by RFC 6066
// and Node warns about it, and a real fleet always names a host anyway.
const cfgFor = (port: number) => ({
  host: "localhost", port, secure: false, user: "AKIAEXAMPLE", pass: "secret",
  from: "no-reply@example.org", tlsCa: TESTCERT.cert, configured: true,
});

describe("mail-verify", () => {
  it("resolves the From address by the same precedence the mailer uses", () => {
    // SMTP_FROM > EMAIL_FROM > SMTP_USER. Getting this wrong on SES means
    // testing a sender production never uses — an `AKIA…` key id, which SES
    // rejects, so a green check would coexist with undeliverable mail.
    expect(resolveFrom({ SMTP_FROM: "RELAY <a@x>", EMAIL_FROM: "b@x", SMTP_USER: "c@x" })).toBe("a@x");
    expect(resolveFrom({ EMAIL_FROM: "b@x", SMTP_USER: "c@x" })).toBe("b@x");
    expect(resolveFrom({ SMTP_USER: "c@x" })).toBe("c@x");
    expect(resolveFrom({})).toBe("");
  });

  it("reports SMTP as unconfigured rather than broken when there is nothing set", () => {
    expect(readSmtpConfig({}).configured).toBe(false);
    expect(readSmtpConfig({ SMTP_HOST: "h" }).configured).toBe(false); // no From
    expect(readSmtpConfig({ SMTP_HOST: "h", EMAIL_FROM: "a@x" }).configured).toBe(true);
  });

  it("defaults to STARTTLS on 587 and honours an explicit secure flag", () => {
    expect(readSmtpConfig({ SMTP_HOST: "h", EMAIL_FROM: "a@x" })).toMatchObject({ port: 587, secure: false });
    expect(readSmtpConfig({ SMTP_HOST: "h", EMAIL_FROM: "a@x", SMTP_PORT: "465", SMTP_SECURE: "1" }))
      .toMatchObject({ port: 465, secure: true });
  });

  it("completes the dialogue and sends NOTHING by default", async () => {
    const s = await fakeSmtp();
    try {
      const steps = await verifyMail(cfgFor(s.port), "someone@example.com", {});
      expect(steps.every((x: { ok: boolean }) => x.ok)).toBe(true);
      // The load-bearing assertion: it got as far as RCPT TO — which is where a
      // sandboxed SES refuses — and then abandoned the transaction.
      expect(s.seen.some((l) => /^RCPT TO:<someone@example\.com>$/.test(l))).toBe(true);
      expect(s.seen).toContain("RSET");
      expect(s.seen.some((l) => l.toUpperCase() === "DATA")).toBe(false);
    } finally {
      await s.close();
    }
  });

  it("sends a real message only when asked", async () => {
    const s = await fakeSmtp();
    try {
      const steps = await verifyMail(cfgFor(s.port), "someone@example.com", { send: true });
      expect(steps.every((x: { ok: boolean }) => x.ok)).toBe(true);
      expect(s.seen.some((l) => l.toUpperCase() === "DATA")).toBe(true);
      expect(s.seen).not.toContain("RSET");
    } finally {
      await s.close();
    }
  });

  it("FAILS on rejected credentials, and says they are the problem", async () => {
    const s = await fakeSmtp({ rejectAuth: true });
    try {
      await expect(verifyMail(cfgFor(s.port), "someone@example.com", {})).rejects.toThrow(/credentials REJECTED/);
    } finally {
      await s.close();
    }
  });

  it("FAILS on a refused recipient and passes the server's own words through", async () => {
    // This IS the production failure #44 asks about: SES in its sandbox refuses
    // any recipient that is not a verified identity, and it says so at RCPT TO.
    // The server's wording is what tells the operator which knob to turn, so it
    // must not be replaced with a generic message of mine.
    const s = await fakeSmtp({ rejectRcpt: true });
    try {
      await expect(verifyMail(cfgFor(s.port), "someone@example.com", {})).rejects.toThrow(
        /REFUSED \(554\).*not verified/s,
      );
    } finally {
      await s.close();
    }
  });

  it("refuses a port that does not offer STARTTLS at all, and says so distinctly", async () => {
    // A mutation run showed this branch was untested: the case below exercises a
    // server that ADVERTISES STARTTLS and then refuses it, which is caught one
    // check later. The two need different messages because they need different
    // fixes — "you pointed this at the wrong port" versus "your server refused an
    // upgrade it advertised" — and a single generic error sends the operator
    // looking in the wrong place.
    const s = await fakeSmtp({ noStarttls: true });
    try {
      await expect(verifyMail(cfgFor(s.port), "someone@example.com", {})).rejects.toThrow(
        /does not offer STARTTLS/,
      );
    } finally {
      await s.close();
    }
  });

  it("refuses to continue in plaintext when STARTTLS is offered but fails", async () => {
    // Credentials must never cross an unencrypted link because an upgrade the
    // server advertised did not happen.
    const s = await fakeSmtp({ refuseStarttls: true });
    try {
      await expect(verifyMail(cfgFor(s.port), "someone@example.com", {})).rejects.toThrow(/STARTTLS refused/);
    } finally {
      await s.close();
    }
  });

  it("closes its socket even when the dialogue is refused", async () => {
    /* Found by a mutation run: removing the close hook changed nothing, because
       the fake server tears sockets down in its own teardown and masked the
       leak. A run that reports several refusals would otherwise leave several
       half-open sessions on somebody else's mail server. Asserted by watching
       the SERVER's side close, with no help from teardown. */
    const s = await fakeSmtp({ rejectRcpt: true });
    try {
      const closed = new Promise<void>((resolve) => s.onClose(resolve));
      await expect(verifyMail(cfgFor(s.port), "someone@example.com", {})).rejects.toThrow(/REFUSED/);
      await expect(
        Promise.race([
          closed,
          new Promise((_r, rej) => setTimeout(() => rej(new Error("socket still open 2s after the refusal")), 2000)),
        ]),
      ).resolves.toBeUndefined();
    } finally {
      await s.close();
    }
  });

  it("never puts the password in a step's reported detail", async () => {
    const s = await fakeSmtp();
    try {
      const steps = await verifyMail(cfgFor(s.port), "someone@example.com", {});
      const all = JSON.stringify(steps);
      expect(all).not.toContain("secret");
      expect(all).not.toContain(Buffer.from("secret", "utf8").toString("base64"));
    } finally {
      await s.close();
    }
  });
});
