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
module.exports = {
  apps: [
    {
      name: "relay",
      cwd: "/home/relay/app",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      env_file: "/home/relay/.env",
      max_memory_restart: "1G",
    },
  ],
};
