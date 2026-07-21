// pm2 process config for the self-hosted AWS deploy (your-chat.io). The deploy
// pipeline copies this onto each server as /home/relay/ecosystem.config.cjs.
//
// script: the REAL esbuild output is dist/index.js — NOT dist/server/_core/index.js.
//   (build = `esbuild server/_core/index.ts --outdir=dist` → dist/index.js;
//    confirmed by `pnpm start` = `node dist/index.js`.)
//
// instances: MUST stay 1 PER MACHINE. RELAY's signaling/call registry lives
//   in-memory in a single process (see CLAUDE.md — the relay.ts Maps are
//   per-instance). Never use pm2 cluster mode to fork workers on one box — that
//   splits call state across workers. The .io fleet scales HORIZONTALLY instead
//   (2+ EC2 machines behind the ALB), and cross-machine signaling is bridged by
//   RELAY_CLUSTER below (leader model over Redis), not by pm2.
//
// RELAY_CLUSTER=1 (baked in below): .io runs 2+ instances behind the ALB, so
//   per-process signaling can't ring a callee homed on the OTHER instance — the
//   caller sees nothing and the callee only gets a missed-call. The leader model
//   (server/relayCluster.ts) elects ONE instance to own the whole registry over
//   Redis while every instance keeps serving load-balanced SSE, so calls ring +
//   connect across instances with NO ALB pin. It's a no-op unless REDIS_URL is
//   also set (it is, via .env → ElastiCache), and .env can still override this.
//   This file is copied ONLY onto the AWS .io servers; .org (single Manus
//   instance) never uses it, so .org stays unclustered. See
//   docs-cross-instance-signaling.md.
// PM2 has NO `env_file` option — it silently ignores unknown keys, which
// booted the app with an empty environment ("database unavailable" while
// drizzle, run with the .env sourced in a shell, reached the same DB fine).
// Parse the .env HERE (this file is plain JS) and hand it to pm2 as `env`.
const fs = require("fs");
function loadEnvFile(path) {
  try {
    return Object.fromEntries(
      fs
        .readFileSync(path, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && l.includes("="))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
        })
    );
  } catch {
    return {};
  }
}

module.exports = {
  apps: [
    {
      name: "relay",
      cwd: "/home/relay/app",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      // RELAY_CLUSTER default goes BEFORE the .env spread so an operator can
      // still override it in /home/relay/.env (e.g. RELAY_CLUSTER=0 to disable).
      env: { NODE_ENV: "production", RELAY_CLUSTER: "1", ...loadEnvFile("/home/relay/.env") },
      max_memory_restart: "1G",
    },
  ],
};
