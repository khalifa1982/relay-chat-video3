// pm2 process config for the self-hosted AWS deploy (your-chat.io). The deploy
// pipeline copies this onto each server as /home/relay/ecosystem.config.cjs.
//
// script: the REAL esbuild output is dist/index.js — NOT dist/server/_core/index.js.
//   (build = `esbuild server/_core/index.ts --outdir=dist` → dist/index.js;
//    confirmed by `pnpm start` = `node dist/index.js`.)
//
// instances: MUST stay 1. RELAY's signaling/call registry lives in-memory in a
//   single process (see CLAUDE.md — the relay.ts Maps are per-instance and there
//   is no Redis/pub-sub adapter). Running multiple instances would split the
//   call state across workers and break calls. Scale vertically, not with cluster
//   mode, until signaling is externalized.
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
      env: { NODE_ENV: "production", ...loadEnvFile("/home/relay/.env") },
      max_memory_restart: "1G",
    },
  ],
};
