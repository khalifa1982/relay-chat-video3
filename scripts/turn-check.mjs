#!/usr/bin/env node
/**
 * Prove every advertised TURN relay is ALIVE and accepts our credentials.
 *
 * WHY AN ALLOCATE AND NOT A PING
 * ------------------------------
 * A STUN Binding only proves a port answers. The failure mode that actually
 * matters once the fleet runs one coturn per zone is a relay whose
 * `static-auth-secret` does not match the others: it answers happily, appears
 * in the ICE list, and then refuses every real allocation — so calls that need
 * a relay fail for whatever fraction of users get steered to it. Only an
 * authenticated TURN Allocate distinguishes that from a healthy relay, so that
 * is what this does.
 *
 * WHERE IT RUNS
 * -------------
 * On an app instance (via the `verify` action in aws-ops.yml), for two reasons:
 * it is in-region so it can actually reach :3478/:5349, and the credentials
 * never leave the VPC. Nothing secret is ever printed — not TURN_SECRET, not
 * the derived password, not the username (which embeds an expiry and is
 * uninteresting, but there is no reason to emit it either).
 *
 * It is READ-ONLY with respect to the relay: each successful allocation is
 * released immediately with a zero-lifetime Refresh, so a repeated health check
 * cannot accumulate allocations.
 *
 * Exit code 0 = every endpoint healthy, 1 = at least one is not.
 *   node scripts/turn-check.mjs            # every configured relay
 *   node scripts/turn-check.mjs --json     # machine-readable
 */
import net from "node:net";
import tls from "node:tls";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dgram from "node:dgram";
import crypto from "node:crypto";

const JSON_OUT = process.argv.includes("--json");
const MAGIC = 0x2112a442;
const M = {
  BINDING_REQ: 0x0001, BINDING_OK: 0x0101,
  ALLOCATE_REQ: 0x0003, ALLOCATE_OK: 0x0103, ALLOCATE_ERR: 0x0113,
  REFRESH_REQ: 0x0004,
};
const A = {
  USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009,
  REALM: 0x0014, NONCE: 0x0015, XOR_RELAYED: 0x0016,
  REQUESTED_TRANSPORT: 0x0019, LIFETIME: 0x000d,
};

const pad4 = (n) => (n + 3) & ~3;

function encode(method, txn, attrs) {
  const parts = [];
  for (const [type, value] of attrs) {
    const h = Buffer.alloc(4);
    h.writeUInt16BE(type, 0);
    h.writeUInt16BE(value.length, 2);
    parts.push(h, value, Buffer.alloc(pad4(value.length) - value.length));
  }
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(20);
  head.writeUInt16BE(method, 0);
  head.writeUInt16BE(body.length, 2);
  head.writeUInt32BE(MAGIC, 4);
  txn.copy(head, 8);
  return Buffer.concat([head, body]);
}

/** Append MESSAGE-INTEGRITY: HMAC-SHA1 over the message whose declared length
 *  ALREADY counts the 24-byte MI attribute, but whose bytes stop before it. */
function withIntegrity(method, txn, attrs, key) {
  const partial = encode(method, txn, attrs);
  const forHmac = Buffer.from(partial);
  forHmac.writeUInt16BE(partial.length - 20 + 24, 2);
  const mac = crypto.createHmac("sha1", key).update(forHmac).digest();
  return encode(method, txn, [...attrs, [A.MESSAGE_INTEGRITY, mac]]);
}

function decode(buf) {
  if (!buf || buf.length < 20 || buf.readUInt32BE(4) !== MAGIC) return null;
  const type = buf.readUInt16BE(0);
  const len = buf.readUInt16BE(2);
  const attrs = new Map();
  let o = 20;
  while (o + 4 <= 20 + len && o + 4 <= buf.length) {
    const t = buf.readUInt16BE(o);
    const l = buf.readUInt16BE(o + 2);
    if (o + 4 + l > buf.length) break;
    attrs.set(t, buf.subarray(o + 4, o + 4 + l));
    o += 4 + pad4(l);
  }
  return { type, attrs };
}

const errCode = (a) => (a ? a.readUInt8(2) * 100 + a.readUInt8(3) : null);

/* ── transports ─────────────────────────────────────────────────────────── */
function tcpSession({ host, port, secure, timeoutMs = 6000 }) {
  return new Promise((resolve, reject) => {
    const sock = secure
      ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false })
      : net.connect({ host, port });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("timeout")); }, timeoutMs);
    let waiter = null;
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      // STUN over TCP is length-prefixed by its own header.
      while (buf.length >= 20) {
        const need = 20 + buf.readUInt16BE(2);
        if (buf.length < need) break;
        const msg = buf.subarray(0, need);
        buf = buf.subarray(need);
        if (waiter) { const w = waiter; waiter = null; w(msg); }
      }
    });
    sock.on("error", (e) => { clearTimeout(timer); reject(e); });
    sock.once(secure ? "secureConnect" : "connect", () =>
      resolve({
        send: (m) => new Promise((res, rej) => {
          const to = setTimeout(() => rej(new Error("no reply")), timeoutMs);
          waiter = (msg) => { clearTimeout(to); res(msg); };
          sock.write(m);
        }),
        close: () => { clearTimeout(timer); try { sock.destroy(); } catch { /* */ } },
      }));
  });
}

function udpSession({ host, port, timeoutMs = 6000 }) {
  const sock = dgram.createSocket("udp4");
  let waiter = null;
  sock.on("message", (m) => { if (waiter) { const w = waiter; waiter = null; w(m); } });
  return Promise.resolve({
    send: (m) => new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error("no reply")), timeoutMs);
      waiter = (msg) => { clearTimeout(to); res(msg); };
      sock.send(m, port, host, (e) => { if (e) { clearTimeout(to); rej(e); } });
    }),
    close: () => { try { sock.close(); } catch { /* */ } },
  });
}

/* ── the actual check ───────────────────────────────────────────────────── */
async function checkEndpoint(ep, secret, user) {
  const out = { ...ep, binding: false, allocate: false, note: "" };
  let s;
  try {
    s = ep.transport === "udp"
      ? await udpSession(ep)
      : await tcpSession({ ...ep, secure: ep.scheme === "turns" });
  } catch (e) {
    out.note = `connect: ${e.message}`;
    return out;
  }
  try {
    // 1. Liveness — unauthenticated Binding.
    const bind = decode(await s.send(encode(M.BINDING_REQ, crypto.randomBytes(12), [])));
    out.binding = !!bind && bind.type === M.BINDING_OK;
    if (!out.binding) { out.note = "no STUN Binding success"; return out; }

    // 2. Allocate without credentials — coturn must answer 401 with realm+nonce.
    const txn1 = crypto.randomBytes(12);
    const rt = Buffer.from([17, 0, 0, 0]); // UDP transport
    const first = decode(await s.send(encode(M.ALLOCATE_REQ, txn1, [[A.REQUESTED_TRANSPORT, rt]])));
    if (!first || first.type !== M.ALLOCATE_ERR) { out.note = "no 401 challenge to Allocate"; return out; }
    const realm = first.attrs.get(A.REALM);
    const nonce = first.attrs.get(A.NONCE);
    if (!realm || !nonce) { out.note = `challenge missing realm/nonce (err ${errCode(first.attrs.get(A.ERROR_CODE))})`; return out; }
    out.realm = realm.toString();

    // 3. Allocate WITH credentials — this is what proves the shared secret.
    //    Long-term credential key = MD5(username ":" realm ":" password).
    const username = `${Math.floor(Date.now() / 1000) + 300}:${user}`;
    const password = crypto.createHmac("sha1", secret).update(username).digest("base64");
    const key = crypto.createHash("md5").update(`${username}:${realm.toString()}:${password}`).digest();
    const txn2 = crypto.randomBytes(12);
    const attrs = [
      [A.REQUESTED_TRANSPORT, rt],
      [A.USERNAME, Buffer.from(username)],
      [A.REALM, realm],
      [A.NONCE, nonce],
    ];
    const second = decode(await s.send(withIntegrity(M.ALLOCATE_REQ, txn2, attrs, key)));
    if (second && second.type === M.ALLOCATE_OK) {
      out.allocate = true;
      const rel = second.attrs.get(A.XOR_RELAYED);
      if (rel && rel.length >= 8) {
        const port = rel.readUInt16BE(2) ^ (MAGIC >>> 16);
        out.note = `relayed port ${port}`;
      }
      // Release it immediately — a health check must not accumulate allocations.
      try {
        const life = Buffer.alloc(4); // lifetime 0
        await s.send(withIntegrity(M.REFRESH_REQ, crypto.randomBytes(12),
          [[A.LIFETIME, life], [A.USERNAME, Buffer.from(username)], [A.REALM, realm], [A.NONCE, nonce]], key));
      } catch { /* best effort */ }
    } else {
      const code = errCode(second?.attrs.get(A.ERROR_CODE));
      out.note = code === 401 || code === 441
        ? `credentials REJECTED (err ${code}) — this relay's static-auth-secret differs from TURN_SECRET`
        : `Allocate failed (err ${code ?? "no reply"})`;
    }
  } catch (e) {
    out.note = e.message;
  } finally {
    s.close();
  }
  return out;
}

/* ── endpoints, derived exactly as the server advertises them ─────────────
   EXPORTED and pure so a test can compare this set against what iceServers()
   in server/relay.ts actually hands clients. The two drifted once already:
   v2.99.65 taught the SERVER that TURN_TCP_ALT_PORT=off suppresses the
   plaintext alt-port candidate, and this checker was never told — so with `off`
   set it probed port `+"off"` = NaN and reported a DOWN endpoint the fleet does
   not advertise, a permanent false failure on every relay, which is exactly the
   noise that hides a real one. Keep the two in agreement. */
export function deriveTurnEndpoints(env = process.env) {
  const secret = env.TURN_SECRET || "";
  const hosts = (env.TURN_HOSTS || env.TURN_HOST || "")
    .split(/[\s,]+/).map((h) => h.trim()).filter(Boolean).filter((h, i, a) => a.indexOf(h) === i);
  const PORT = env.TURN_PORT || "3478";
  // Same rule as iceServers() in server/relay.ts.
  const altRaw = env.TURN_TCP_ALT_PORT ?? "443";
  const altOff = /^(off|none|0|false)$/i.test(altRaw.trim()) || altRaw.trim() === "";
  const ALT = altOff ? "" : altRaw.trim();
  const TLSP = env.TURN_TLS_PORT || "5349";
  const useTls = env.TURN_TLS === "1";

  const eps = [];
  for (const host of hosts) {
    eps.push({ host, port: +PORT, transport: "udp", scheme: "turn" });
    if (!altOff) eps.push({ host, port: +ALT, transport: "tcp", scheme: "turn" });
    eps.push({ host, port: +PORT, transport: "tcp", scheme: "turn" });
    if (useTls) eps.push({ host, port: +TLSP, transport: "tcp", scheme: "turns" });
  }
  return { secret, hosts, eps };
}

/** The `turns:`/`turn:` URL each endpoint corresponds to — the exact string the
 *  server puts in an ICE server list, so the comparison is like-for-like. */
export function endpointToUrl(ep) {
  return `${ep.scheme}:${ep.host}:${ep.port}?transport=${ep.transport}`;
}

/* ── main ─────────────────────────────────────────────────────────────────
   Guarded so `server/turnCheckParity.test.ts` can import the two pure exports
   above and compare them against iceServers(). Without this, importing the
   module would run a health check and then process.exit(0), taking the test
   runner with it. */
const IS_MAIN =
  !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (IS_MAIN) {
const { secret, hosts, eps } = deriveTurnEndpoints();

if (!secret || hosts.length === 0) {
  console.log("TURN is not configured on this host (TURN_SECRET / TURN_HOSTS unset) — nothing to check.");
  process.exit(0);
}

const results = [];
for (const ep of eps) results.push(await checkEndpoint(ep, secret, "healthcheck"));

if (JSON_OUT) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`TURN health — ${hosts.length} relay(s), ${eps.length} endpoint(s)\n`);
  for (const r of results) {
    const label = `${r.scheme}:${r.host}:${r.port} ${r.transport}`.padEnd(38);
    const verdict = r.allocate ? "OK      " : r.binding ? "NO-ALLOC" : "DOWN    ";
    console.log(`  ${label} ${verdict} ${r.note}`);
  }
  const byHost = {};
  for (const r of results) (byHost[r.host] ||= []).push(r.allocate);
  console.log("\nper relay:");
  for (const [h, oks] of Object.entries(byHost)) {
    console.log(`  ${h}: ${oks.filter(Boolean).length}/${oks.length} endpoints allocating`);
  }
  // The cross-relay check that matters: every relay must accept the SAME secret.
  const realms = [...new Set(results.filter((r) => r.realm).map((r) => r.realm))];
  if (realms.length > 1) console.log(`\nNOTE: relays report different realms (${realms.join(", ")}) — expected if intentional.`);
}

const bad = results.filter((r) => !r.allocate);
if (bad.length) {
  console.error(`\n${bad.length}/${results.length} endpoint(s) NOT usable as a relay.`);
  process.exit(1);
}
console.log("\nAll endpoints alive and accepting our credentials.");
} // end IS_MAIN
