/**
 * Static serving for PRODUCTION — deliberately in its own module with ZERO
 * vite imports. The server entry must never statically reach `vite` (a
 * devDependency): on the self-hosted fleet it isn't installed, and only
 * esbuild's lazy CJS wrapping kept the old layout from crashing at boot.
 */
import fs from "fs";
import path from "path";
import express, { type Express } from "express";

export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  // Vite emits content-hashed filenames under /assets — those bytes can NEVER
  // change for a given URL, so returning visitors should reuse them from the
  // browser/CDN cache instead of re-downloading megabytes of JS on every open
  // (express.static's default sends NO Cache-Control at all). index.html (and
  // anything unhashed) stays no-cache so a publish is picked up immediately —
  // it references the NEW hashed filenames, which then download once.
  // HIDDEN SOURCEMAPS (v2.107.28): the build emits .map files solely for the
  // server's own crash-stack decoding (server/crashDecode.ts). They are private
  // build artifacts — refuse them over HTTP so client source is never disclosed.
  app.use((req, res, next) => {
    if (req.path.endsWith(".map")) {
      res.status(404).end();
      return;
    }
    next();
  });

  app.use(
    express.static(distPath, {
      setHeaders(res, filePath) {
        if (/[/\\]assets[/\\]/.test(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );

  // Fall through to index.html ONLY for app routes. A missing static file —
  // a stale hashed bundle, an old map, an image — must be an honest 404:
  // serving the SPA shell as "*.js" poisons caches and made map probes return
  // HTML instead of a clean miss.
  app.use("*", (req, res) => {
    const p = (req.originalUrl || "").split("?")[0];
    if (
      p.startsWith("/assets/") ||
      /\.(?:js|mjs|css|map|json|webmanifest|png|jpe?g|gif|svg|ico|webp|avif|txt|xml|woff2?|ttf|otf|wasm)$/i.test(
        p
      )
    ) {
      res.status(404).end();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
