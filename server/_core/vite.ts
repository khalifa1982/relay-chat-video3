import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";

/**
 * `vite` is imported DYNAMICALLY and the config is loaded BY VITE, on purpose.
 *
 * This module is only ever reached in development — the production entry calls
 * `serveStatic` and never touches it. But static top-level imports are hoisted
 * and evaluated when the module graph loads, so `import … from "vite"` plus
 * a default-import of the root vite config file put `vite` AND every dev-only
 * plugin the config imports (`@vitejs/plugin-react`, `@tailwindcss/vite`, …)
 * into `dist/index.js` as top-level imports: `node dist/index.js` then required
 * five devDependencies at boot just to serve static files. Today's deploy runs a
 * full `pnpm install`, so they happen to be present; the day anything installs
 * with `--prod` (or prunes), production stops booting for dependencies it never
 * uses.
 *
 * So: `await import("vite")` keeps that reference lazy, and instead of
 * importing the config module we hand vite the config file's PATH (a string,
 * which bundles to nothing) and let vite load and compile it — exactly what
 * `vite build` does. That also makes the config single-sourced: this used to
 * spread the imported config while telling vite there was no config file at
 * all, which quietly bypassed vite's own config resolution.
 */
export async function setupVite(app: Express, server: Server) {
  const { createServer: createViteServer } = await import("vite");

  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    configFile: path.resolve(import.meta.dirname, "../..", "vite.config.ts"),
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

