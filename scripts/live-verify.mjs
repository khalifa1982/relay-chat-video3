#!/usr/bin/env node
/**
 * Prove the LIVE deployment is serving THIS release, and that the three things
 * task #44 has been blocked on actually work in production.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * #44 asked for live verification of Arabic sizing parity, offline-message
 * email delivery, and the landing dialer's name/online preview. It sat blocked
 * for six releases with one line of explanation: the agent sandbox's outbound
 * network refuses `your-chat.io` (the proxy answers 403 to CONNECT), so nothing
 * running inside it can reach the site. That is an environment policy, not
 * something the repo can change — so the check moves to two places that CAN
 * reach it, and the workflow runs it from both:
 *
 *   • the GitHub runner, which has ordinary internet and is therefore the
 *     correct vantage point for "what does a real visitor get" — it sees the
 *     whole edge path (DNS → ALB → app);
 *   • an app INSTANCE, against http://127.0.0.1:3000, which sees only the app.
 *
 * Running both is the point. A check that fails from the runner and passes on
 * the instance is an EDGE problem (ALB, DNS, CloudFront, a stale target). One
 * that fails in both is the app. One value alone cannot tell those apart, which
 * is the same reason `turn-check.mjs` runs where it does.
 *
 * WHAT IT CANNOT DO, SAID PLAINLY
 * -------------------------------
 * It does not render the page. Verifying "Arabic renders at the same size as
 * English" by measurement needs a browser, and adding Playwright as a
 * dependency to this repo for one manual workflow is a cost it has refused
 * everywhere else (the SMTP client, the S3 signer, the FCM sender, the GIF
 * encoder and the STUN/TURN client are all hand-written for exactly this
 * reason). So the render half is verified a different way, and it is a STRONGER
 * check than re-measuring in the cloud would be: it proves the live assets are
 * BYTE-IDENTICAL to the ones this commit builds — same sha256 — so every
 * measurement already taken against the local build transfers to production by
 * identity rather than by assumption. If the bytes differ, the site is not
 * running this code and no cloud measurement of it would have meant anything.
 *
 * It also does not send mail. That check needs the fleet's SMTP credentials, so
 * it lives in `scripts/mail-verify.mjs`, which runs on an instance.
 *
 * Exit 0 = every applicable check passed. 1 = at least one FAILED. A SKIP never
 * fails the run, because a skip is honest ("dist/ is not here, so I cannot
 * compare bytes") and a skip reported as a pass is how a check rots.
 *
 *   node scripts/live-verify.mjs                                  # https://your-chat.io
 *   node scripts/live-verify.mjs --base http://127.0.0.1:3000     # on an instance
 *   node scripts/live-verify.mjs --number 777777 --json
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const TIMEOUT_MS = 15000;

/* ── the expected version comes off DISK, not from an argument ──────────────
   `shared/version.ts` is the single source of truth the server serves at
   /api/version and the client bakes into its bundle, so reading it here means
   the check compares production against the repo rather than against a number
   somebody typed into a workflow input — which could agree with neither. It is
   TypeScript and this file is run by bare `node` on an EC2 box, so it is read
   as text; that is the same constraint `admin-tool.mjs` lives under. */
export function readExpectedVersion(root = ROOT) {
  try {
    const src = fs.readFileSync(path.join(root, "shared", "version.ts"), "utf8");
    const m = /APP_VERSION\s*=\s*"([^"]+)"/.exec(src);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** HTML with comments removed.
 *
 *  NOT a nicety. The placeholder check below looks for an unsubstituted
 *  `%VITE_*%` build variable in the served page — and `client/index.html`
 *  carries a COMMENT explaining that a static analytics tag used to leave
 *  exactly that literal behind, so the check matched the prose describing the
 *  bug instead of the bug. This repo has now been bitten by that at least a
 *  dozen times, always the same way: text that talks ABOUT a pattern satisfying
 *  a search FOR the pattern. Strip the prose, search the markup. */
export function markupOnly(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

/** Absolute asset URLs referenced by index.html, in document order.
 *  Exported so a test can drive it with a fixture rather than the network. */
export function assetUrlsFrom(html, base) {
  const out = [];
  const push = (u) => {
    if (!u || out.includes(u)) return;
    out.push(u);
  };
  const abs = (u) => {
    try {
      return new URL(u, base.endsWith("/") ? base : base + "/").toString();
    } catch {
      return null;
    }
  };
  const src = markupOnly(html);
  for (const m of src.matchAll(/<script[^>]+src="([^"]+)"/g)) push(abs(m[1]));
  for (const m of src.matchAll(/<link[^>]+href="([^"]+\.css)"/g)) push(abs(m[1]));
  return out.filter(Boolean).filter((u) => /\/assets\//.test(u));
}

/** The LAZY chunk names a bundle dynamically imports, e.g. `Home-BD9-7zFK.js`.
 *
 *  The landing page is code-split (v2.81), so the entry bundle referenced by
 *  index.html does NOT contain the landing stylesheet or the dialer at all —
 *  they live in a `Home-*.js` chunk the browser fetches on demand. A check that
 *  only reads the entry assets would report the Arabic rules missing from a
 *  perfectly healthy deployment, which is worse than not checking: it is a
 *  false alarm on the exact thing being verified. So the chunk is discovered
 *  the way the browser discovers it — by name, out of the bundle that imports
 *  it. */
export function lazyChunkNames(js, prefix) {
  const re = new RegExp(`${prefix}-[A-Za-z0-9_-]+\\.(?:js|css)`, "g");
  return [...new Set(String(js).match(re) || [])];
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

async function fetchWithTimeout(url, init = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal, redirect: "manual" });
  } finally {
    clearTimeout(t);
  }
}

/* ── the checks ───────────────────────────────────────────────────────────── */

export async function runChecks(base, opts = {}) {
  /* The result list is PER CALL, not module state. It was a module-level array
     at first, which made the function non-re-entrant: the `live-verify` action
     runs it twice in one process — once against the public URL and once against
     an instance's localhost — and the second run would have appended to the
     first, so a reader looking up a check by name got the EDGE verdict while
     reading what it believed was the app's. Comparing the two vantage points is
     the entire reason both are probed. */
  const results = [];
  const record = (name, verdict, note) => {
    results.push({ name, verdict, note: note ?? "" });
    return verdict;
  };
  const pass = (n, note) => record(n, "PASS", note);
  const fail = (n, note) => record(n, "FAIL", note);
  const skip = (n, note) => record(n, "SKIP", note);

  /** Run one check; any throw becomes a FAIL naming the error, never a crash
   *  that hides the checks after it. */
  const check = async (name, fn) => {
    try {
      await fn(name);
    } catch (e) {
      fail(name, `threw: ${e && e.message ? e.message : String(e)}`);
    }
  };

  const root = opts.root ?? ROOT;
  const number = opts.number ?? "";
  const expected = readExpectedVersion(root);
  const b = base.replace(/\/+$/, "");
  let html = "";
  let assetBodies = [];

  await check("version", async (n) => {
    const r = await fetchWithTimeout(`${b}/api/version`);
    if (!r.ok) return fail(n, `HTTP ${r.status}`);
    const j = await r.json();
    const live = j && j.version;
    if (!live) return fail(n, "no version field in the response");
    if (!expected) return skip(n, `live ${live}; shared/version.ts unreadable, nothing to compare`);
    // THE most load-bearing check in the file: everything else about the
    // deployment is only interesting if it is running the code being verified.
    return live === expected
      ? pass(n, `live ${live} === shared/version.ts`)
      : fail(n, `live ${live} but this tree is ${expected} — the fleet is NOT running this commit`);
  });

  await check("health", async (n) => {
    const r = await fetchWithTimeout(`${b}/api/health`);
    if (!r.ok) return fail(n, `HTTP ${r.status}`);
    const j = await r.json();
    if (j.status !== "ok") return fail(n, `status=${j.status}`);
    const bits = [
      `instance ${String(j.instance || "?").slice(0, 8)}`,
      `redisBus ${j.redisBus}`,
      `cluster ${j.cluster}`,
      `signalingPinned ${j.signalingPinned}`,
    ];
    // NOT a failure. A single-instance fleet legitimately has both off, and a
    // health check that fails on a supported configuration is a false alarm —
    // which is what hides the real one.
    return pass(n, bits.join(" · "));
  });

  await check("index.html", async (n) => {
    const r = await fetchWithTimeout(`${b}/`);
    if (!r.ok) return fail(n, `HTTP ${r.status}`);
    html = await r.text();
    if (!/<div id="root">/.test(html)) return fail(n, "no #root mount point — this is not the SPA");
    // A real past bug (v2.99.35): vite leaves an unknown %VAR% verbatim, so an
    // unset env shipped a literal `%VITE_ANALYTICS_ENDPOINT%/umami` script that
    // every visitor's browser then tried to fetch. Scanned on the MARKUP, not
    // the raw text — the comment recording that fix names the placeholder.
    const leak = /%VITE_[A-Z0-9_]+%/.exec(markupOnly(html));
    if (leak) return fail(n, `unsubstituted build placeholder in the served HTML: ${leak[0]}`);
    return pass(n, `${html.length} bytes, #root present, no placeholder leak`);
  });

  await check("assets fetched", async (n) => {
    if (!html) return skip(n, "index.html did not load");
    const urls = assetUrlsFrom(html, b);
    if (urls.length === 0) return fail(n, "index.html references no /assets/ bundle");
    const bodies = [];
    const fetchInto = async (u) => {
      const r = await fetchWithTimeout(u);
      if (!r.ok) throw new Error(`${u.split("/").pop()} → HTTP ${r.status}`);
      bodies.push({ url: u, name: u.split("/").pop(), buf: Buffer.from(await r.arrayBuffer()) });
    };
    for (const u of urls) await fetchInto(u);
    // Follow one level, to the landing chunk specifically: that is where the
    // Arabic stylesheet and the dialer actually live.
    const entryJs = bodies.filter((x) => x.name.endsWith(".js")).map((x) => x.buf.toString("utf8")).join("\n");
    const lazy = lazyChunkNames(entryJs, "Home");
    for (const name of lazy) {
      if (bodies.some((x) => x.name === name)) continue;
      await fetchInto(new URL(`assets/${name}`, b + "/").toString());
    }
    assetBodies = bodies;
    const note = bodies.map((x) => `${x.name} ${(x.buf.length / 1024).toFixed(0)}kB`).join(" · ");
    return lazy.length
      ? pass(n, note)
      : fail(n, `${note} — but the entry bundle names no Home-* chunk, so the landing page is unreachable`);
  });

  /* THE RENDER HALF, verified by identity rather than by measurement. If every
     live asset is byte-identical to what this tree builds, then the Arabic
     stylesheet, the wordmark keyframes and the landing dialer running in
     production are literally the bytes already measured locally. */
  await check("assets === local build", async (n) => {
    if (assetBodies.length === 0) return skip(n, "no assets were fetched");
    const dir = path.join(root, "dist", "public", "assets");
    if (!fs.existsSync(dir)) {
      return skip(n, "dist/public/assets absent (run `pnpm build` first) — cannot compare bytes");
    }
    const localNames = new Set(fs.readdirSync(dir));
    const diffs = [];
    let compared = 0;
    for (const a of assetBodies) {
      if (!localNames.has(a.name)) {
        // Vite hashes the content into the filename, so a name that does not
        // exist locally IS a content difference — and a clearer one.
        diffs.push(`${a.name} is not in this build at all`);
        continue;
      }
      compared++;
      const local = fs.readFileSync(path.join(dir, a.name));
      if (sha256(local) !== sha256(a.buf)) diffs.push(`${a.name} differs (same name, different bytes)`);
    }
    if (diffs.length) return fail(n, diffs.join("; "));
    return pass(n, `${compared} asset(s) byte-identical to this tree's build`);
  });

  /* Arabic sizing parity — #44's first item. The defect this guards is real and
     shipped twice: v2.99.16 loaded no Arabic webfont, so Arabic fell back to a
     smaller system face; v2.99.21 then had the rules scoped to a selector that
     never matched. Both live in the stylesheet, so the stylesheet is where the
     live check belongs. */
  await check("arabic parity rules live", async (n) => {
    // Searched across EVERY fetched asset, because the landing stylesheet is a
    // template literal inside the Home chunk's JavaScript rather than a .css
    // file — looking only in .css files reported it missing from a healthy
    // build, which is how this check first went red against a correct site.
    const all = assetBodies.map((a) => a.buf.toString("utf8")).join("\n");
    if (!all) return skip(n, "no assets were fetched");
    const missing = [];
    if (!/Noto[+ ]Kufi[+ ]Arabic|Noto Kufi Arabic/.test(all)) missing.push("the Noto Kufi Arabic face");
    // The two rules that make Arabic the same SIZE as English. v2.99.16 added
    // them; v2.99.21 found they matched nothing because `dir` was only on an
    // inner div. Both halves are asserted: the override and the LTR islands
    // that keep the dial digits monospace inside an RTL page.
    if (!/\.lp-root\[dir="rtl"\] ?\*/.test(all)) missing.push("the RTL font override");
    if (!/\.lp-root\[dir="rtl"\] ?\[dir="ltr"\]/.test(all)) missing.push("the LTR-island override");
    if (missing.length) return fail(n, `the served landing bundle is missing ${missing.join(", ")}`);
    return pass(n, "Arabic face + RTL override + LTR islands all served");
  });

  await check("wordmark flourish live", async (n) => {
    const all = assetBodies.map((a) => a.buf.toString("utf8")).join("\n");
    if (!all) return skip(n, "no assets were fetched");
    const missing = [];
    if (!/relaySheen/.test(all)) missing.push("relaySheen");
    if (!/relayWordPop/.test(all)) missing.push("relayWordPop");
    if (missing.length) return fail(n, `served bundle is missing ${missing.join(", ")}`);
    // v2.103.2 deleted this breakpoint because it removed the word outright on
    // every 375px iPhone and 360px Android — the owner's own report. If it is
    // back in production, that report is back with it.
    if (/max-\[389px\]:hidden/.test(all)) {
      return fail(n, "the 390px wordmark breakpoint is back in the served bundle (v2.103.2 removed it)");
    }
    return pass(n, "sheen + pop keyframes served, no 390px breakpoint");
  });

  /* Landing dialer preview — #44's third item. What the landing page needs from
     the server is exactly this query: resolve six digits to a name and an
     online state. Rendering it is the browser's half; answering it is the
     server's, and this is the half that can fail in production only. */
  await check("landing dialer lookup", async (n) => {
    const probe = /^\d{6}$/.test(number) ? number : "000000";
    // The `{json:…}` envelope is superjson's, which this API uses on both ends;
    // a bare object is refused with a 400 that reads like an outage.
    const input = encodeURIComponent(JSON.stringify({ 0: { json: { number: probe } } }));
    const r = await fetchWithTimeout(`${b}/api/trpc/directory.lookup?batch=1&input=${input}`);
    if (!r.ok) return fail(n, `HTTP ${r.status} — the public resolver the landing dialer depends on is not answering`);
    const j = await r.json();
    const entry = Array.isArray(j) ? j[0] : j;
    if (entry && entry.error) return fail(n, `tRPC error: ${entry.error?.json?.message ?? "unknown"}`);
    // A resolver that answers `null` for an unknown number is CORRECT — that is
    // the landing page's "NO RELAY USER WITH THIS NUMBER" branch. The check is
    // that it answered at all, in the right shape.
    //
    // The unwrap must be by KEY PRESENCE, not `??`. superjson wraps a null
    // result as `{json: null}`, and `data?.json ?? data` falls through on null
    // to the WRAPPER — a truthy object — so an unknown number was reported as a
    // resolved user with no name. That is the same false claim the landing page
    // itself was fixed for in v2.99.25, reintroduced in the check meant to
    // detect it, and it made this check PASS for the wrong reason.
    const raw = entry?.result?.data;
    const data = raw && typeof raw === "object" && "json" in raw ? raw.json : raw;
    const hit = data && typeof data === "object" ? data : null;
    if (hit) {
      const who = [hit.displayName, hit.firstName && `${hit.firstName} ${hit.lastName ?? ""}`.trim()]
        .filter(Boolean)[0];
      const state = hit.partyLine ? `party line · ${hit.liveCount ?? "?"} on the line`
        : hit.isOnline ? "online" : "offline";
      return pass(n, `${probe} → ${who || "(no name)"} · ${state}`);
    }
    return pass(n, `${probe} → no such user (a correct answer; pass --number to probe a real one)`);
  });

  await check("ice servers", async (n) => {
    const r = await fetchWithTimeout(`${b}/api/relay/ice`);
    if (!r.ok) return fail(n, `HTTP ${r.status}`);
    const j = await r.json();
    const list = Array.isArray(j?.iceServers) ? j.iceServers : [];
    if (list.length === 0) return fail(n, "no ICE servers advertised — no call can traverse NAT");
    const urls = list.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls])).filter(Boolean);
    const turn = urls.filter((u) => /^turns?:/.test(u));
    const stun = urls.filter((u) => /^stun:/.test(u));
    if (turn.length === 0) {
      // Not a hard failure: the free public fallback is a supported (if worse)
      // configuration, and failing here would make this check red on a
      // deployment that works.
      return pass(n, `${stun.length} STUN, no operator TURN advertised (public fallback only)`);
    }
    return pass(n, `${stun.length} STUN · ${turn.length} TURN url(s): ${turn.slice(0, 4).join(", ")}`);
  });

  await check("seo is dynamic", async (n) => {
    const host = new URL(b).host;
    const [rb, sm] = await Promise.all([
      fetchWithTimeout(`${b}/robots.txt`),
      fetchWithTimeout(`${b}/sitemap.xml`),
    ]);
    if (!rb.ok || !sm.ok) return fail(n, `robots ${rb.status} / sitemap ${sm.status}`);
    const xml = await sm.text();
    if (!xml.includes("<urlset")) return fail(n, "sitemap.xml is not a urlset");
    // v2.92.1 made these dynamic precisely so they name the host that served
    // them; a sitemap advertising a different origin is the stale-static bug.
    if (!xml.includes(host)) return fail(n, `sitemap names a different host than ${host}`);
    return pass(n, `both dynamic and self-referential (${host})`);
  });

  await check("media stays in the app", async (n) => {
    // v2.99.14: the storage proxy must never serve a key to an anonymous
    // caller, and must never redirect to a presigned URL (which would be
    // copyable outside the app). A random key is either 403 or 404; a 200 or a
    // 307 with a Location is the lockdown regressing.
    const key = `relay-chat/probe-${crypto.randomBytes(6).toString("hex")}.bin`;
    const r = await fetchWithTimeout(`${b}/manus-storage/${key}`);
    if (r.status === 200) return fail(n, "an anonymous caller was served a storage object");
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      return fail(n, `redirected anonymously to ${String(r.headers.get("location")).slice(0, 60)}… — a shareable URL`);
    }
    return pass(n, `anonymous storage read refused (HTTP ${r.status})`);
  });

  return results;
}

/* ── main ─────────────────────────────────────────────────────────────────
   Guarded so a test can import the pure helpers above without running a live
   health check and then taking the test runner down with process.exit. */
const IS_MAIN =
  !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (IS_MAIN) {
  const base = flag("base", "https://your-chat.io");
  const number = flag("number", "");
  const jsonOut = has("json");

  const rs = await runChecks(base, { number });

  if (jsonOut) {
    console.log(JSON.stringify({ base, results: rs }, null, 2));
  } else {
    console.log(`LIVE VERIFY — ${base}\n`);
    for (const r of rs) {
      console.log(`  ${r.verdict.padEnd(5)} ${r.name.padEnd(24)} ${r.note}`);
    }
    const f = rs.filter((r) => r.verdict === "FAIL").length;
    const s = rs.filter((r) => r.verdict === "SKIP").length;
    console.log(
      `\n${rs.length - f - s}/${rs.length} passed` + (s ? `, ${s} skipped` : "") + (f ? `, ${f} FAILED` : ""),
    );
  }

  const failed = rs.filter((r) => r.verdict === "FAIL").length;
  // Printed so the caller reads the verdict from the SCRIPT rather than from a
  // wrapper's status, which a pipeline can mask (the bug v2.99.46 exists for).
  console.log(`LIVE_VERIFY_EXIT=${failed ? 1 : 0}`);
  process.exit(failed ? 1 : 0);
}
