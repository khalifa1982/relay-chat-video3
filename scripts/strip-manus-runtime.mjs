#!/usr/bin/env node
/**
 * Self-host build step (.io): remove the Manus host runtime that the template
 * inlines into index.html. It is REQUIRED on Manus hosting (Space Editor /
 * host bridge) and pure dead weight anywhere else — 367 KB of the 372 KB
 * page, including a second copy of React. Run ONLY in the AWS deploy
 * pipeline, after `pnpm build`, before packaging:
 *
 *   node scripts/strip-manus-runtime.mjs dist/public/index.html
 *
 * The .org/Manus build never runs this — its page keeps the runtime.
 */
import fs from "node:fs";

const file = process.argv[2] || "dist/public/index.html";
const html = fs.readFileSync(file, "utf8");
const before = html.length;

// The runtime is one inline <script> whose body starts by defining
// window.__MANUS_HOST_DEV__. Remove exactly that block, nothing else.
const stripped = html.replace(
  /<script[^>]*>window\.__MANUS_HOST_DEV__[\s\S]*?<\/script>/,
  "<!-- manus host runtime stripped for self-hosted deploy -->"
);

if (stripped.length === before) {
  console.log(`strip-manus-runtime: marker not found in ${file} — nothing removed (already clean?)`);
  process.exit(0);
}
fs.writeFileSync(file, stripped);
console.log(
  `strip-manus-runtime: ${file} ${before} → ${stripped.length} bytes (removed ${before - stripped.length})`
);
