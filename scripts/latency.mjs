#!/usr/bin/env node
/**
 * RELAY latency harness — measures the full stack of a deployment:
 *   1. connection setup (DNS / TCP / TLS) — the "first visit" cost
 *   2. static: index.html + the entry JS chunk
 *   3. API compute: /api/version (no DB) and /api/health when present
 *   4. API + DB: tRPC stats.public (read) and identity.startGuest (write)
 *   5. realtime: time-to-`ready` on the signaling SSE stream
 *   6. signaling round-trip: POST /api/relay/send `register` (the RTT that
 *      paces call setup)
 *
 * Usage:  node scripts/latency.mjs https://your-chat.org [runs=8]
 * Same harness against both domains = the .org (Manus) vs .io (AWS Mumbai)
 * comparison. Results are per-vantage-point — run it from where users are.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

const BASE = (process.argv[2] || "https://your-chat.org").replace(/\/$/, "");
const RUNS = Number(process.argv[3] || 8);

const ms = (s) => Math.round(Number(s) * 1000);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const fmt = (a) => `${median(a)} ms  (min ${Math.min(...a)}, max ${Math.max(...a)})`;

/** One fresh-connection curl; returns timing phases in ms. */
function curlTimes(url, extra = []) {
  const w = '{"dns":%{time_namelookup},"tcp":%{time_connect},"tls":%{time_appconnect},"ttfb":%{time_starttransfer},"total":%{time_total},"code":%{http_code},"size":%{size_download}}';
  const out = execFileSync("curl", ["-o", "/dev/null", "-sS", "--max-time", "20", "-w", w, ...extra, url], { encoding: "utf8" });
  const t = JSON.parse(out);
  return { dns: ms(t.dns), tcp: ms(t.tcp), tls: ms(t.tls), ttfb: ms(t.ttfb), total: ms(t.total), code: t.code, size: t.size };
}

function series(label, url, extra = []) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(curlTimes(url, extra));
  const pick = (k) => runs.map((r) => r[k]);
  console.log(`\n■ ${label}`);
  console.log(`   HTTP ${runs[0].code} · ${runs[0].size} bytes`);
  console.log(`   DNS        ${fmt(pick("dns"))}`);
  console.log(`   TCP+TLS    ${fmt(runs.map((r) => r.tls - r.dns))}`);
  console.log(`   TTFB       ${fmt(pick("ttfb"))}   ← server answers`);
  console.log(`   total      ${fmt(pick("total"))}`);
  return runs;
}

async function sseReady() {
  const times = [];
  for (let i = 0; i < Math.min(RUNS, 5); i++) {
    const cid = crypto.randomBytes(16).toString("hex");
    const t0 = performance.now();
    const res = await fetch(`${BASE}/api/relay/stream?cid=${cid}`, { headers: { accept: "text/event-stream" } });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (buf.includes('"ready"')) break;
    }
    times.push(Math.round(performance.now() - t0));
    // signaling RTT: register over the freshly-bound cid
    const t1 = performance.now();
    const r = await fetch(`${BASE}/api/relay/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cid, message: { type: "register", name: "latency-probe", device: "Probe" } }),
    });
    await r.text();
    sseRtts.push(Math.round(performance.now() - t1));
    try { reader.cancel(); } catch { /* */ }
  }
  return times;
}
const sseRtts = [];

console.log(`RELAY latency baseline → ${BASE}   (${RUNS} fresh-connection runs each)`);
console.log(`vantage point: this machine — results are relative, compare runs from the SAME place`);

series("Static · index.html (first paint gate)", `${BASE}/`);
series("API · /api/version (compute only, no DB)", `${BASE}/api/version`);
series("API · /api/health (v2.90+; SPA fallback serves index.html on older deploys)", `${BASE}/api/health`);
series("API+DB read · tRPC stats.public", `${BASE}/api/trpc/stats.public?batch=1&input=${encodeURIComponent('{"0":{"json":null,"meta":{"values":["undefined"]}}}')}`);
const dev = crypto.randomBytes(16).toString("hex");
series("API+DB write · identity.startGuest", `${BASE}/api/trpc/identity.startGuest?batch=1`, [
  "-X", "POST", "-H", "content-type: application/json", "-H", `x-relay-device-id: ${dev}`,
  "-d", JSON.stringify({ 0: { json: { displayName: "Latency Probe", deviceId: dev } } }),
]);

const sse = await sseReady();
console.log(`\n■ Realtime · SSE stream time-to-ready`);
console.log(`   ${fmt(sse)}`);
console.log(`\n■ Signaling · register round-trip (paces call setup)`);
console.log(`   ${fmt(sseRtts)}`);
console.log("\nDone. Re-run against the .io deployment with:\n  node scripts/latency.mjs https://your-chat.io\n");
