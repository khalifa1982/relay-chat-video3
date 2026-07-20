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

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
