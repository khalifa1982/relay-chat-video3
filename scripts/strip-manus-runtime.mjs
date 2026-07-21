#!/usr/bin/env node
/**
 * Self-host build step (.io): clean the built index.html of template artifacts
 * that only make sense on Manus hosting. Run ONLY in the AWS deploy pipeline,
 * after `pnpm build`, before packaging:
 *
 *   node scripts/strip-manus-runtime.mjs dist/public/index.html
 *
 * 1. Remove the Manus host runtime (Space Editor / host bridge) — 367 KB of
 *    the 372 KB page, including a second copy of React. Required on Manus,
 *    dead weight anywhere else.
 * 2. Remove any tag still carrying an UNSUBSTITUTED %VITE_*% placeholder
 *    (v2.95.7): the template's analytics <script> keeps its literal
 *    "%VITE_ANALYTICS_ENDPOINT%/umami" src when the analytics env isn't set
 *    (the .io CI build doesn't set it), so every page load requested that
 *    garbage URL, got the SPA fallback HTML back, and threw
 *    "SyntaxError: Unexpected token '<'" in the console.
 */
import fs from "node:fs";

const file = process.argv[2] || "dist/public/index.html";
const html = fs.readFileSync(file, "utf8");
const before = html.length;

// The runtime is one inline <script> whose body starts by defining
// window.__MANUS_HOST_DEV__. Remove exactly that block, nothing else.
let stripped = html.replace(
  /<script[^>]*>window\.__MANUS_HOST_DEV__[\s\S]*?<\/script>/,
  "<!-- manus host runtime stripped for self-hosted deploy -->"
);
const runtimeRemoved = stripped.length !== before;

// Any script/link whose attributes still contain a %VITE_*% placeholder was
// never substituted (its env var is unset on this deploy) — drop it.
const placeholderRe = /<script[^>]*%VITE_[A-Z_]+%[^>]*>\s*<\/script>|<script[^>]*%VITE_[A-Z_]+%[^>]*\/>|<link[^>]*%VITE_[A-Z_]+%[^>]*\/?>/g;
const beforePlaceholders = stripped.length;
stripped = stripped.replace(placeholderRe, "<!-- unsubstituted VITE placeholder stripped -->");
const placeholdersRemoved = stripped.length !== beforePlaceholders;

if (!runtimeRemoved && !placeholdersRemoved) {
  console.log(`strip-manus-runtime: nothing to remove in ${file} (already clean?)`);
  process.exit(0);
}
fs.writeFileSync(file, stripped);
console.log(
  `strip-manus-runtime: ${file} ${before} → ${stripped.length} bytes` +
    ` (runtime: ${runtimeRemoved ? "removed" : "absent"}, placeholders: ${placeholdersRemoved ? "removed" : "absent"})`
);
