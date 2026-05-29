import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { attachRelay } from "../relay";

/**
 * Resolve the standalone RELAY web app. In dev it lives in `client/public/relay`
 * (Vite serves /public verbatim from the site root, but for the `/app` and
 * `/app/*` routes we want to deliver the same index.html on both, so we register
 * an Express route ahead of Vite/static).
 */
function registerRelayApp(app: express.Express) {
  // In dev, source from client/public; in prod the build copies it into
  // dist/public/relay (Vite handles the publicDir copy automatically).
  const candidates = [
    path.resolve(import.meta.dirname, "../../client/public/relay"),
    path.resolve(import.meta.dirname, "../..", "dist", "public", "relay"),
    path.resolve(import.meta.dirname, "public", "relay"),
  ];
  const relayDir = candidates.find(p => fs.existsSync(p));
  if (!relayDir) {
    console.warn("[relay] could not locate the standalone web app directory");
    return;
  }

  // /app/app.js, /app/static/whatever -> serve from relay dir.
  app.use("/app", express.static(relayDir, { index: false }));
  // /app and /app/ -> the calling UI.
  app.get(["/app", "/app/"], (_req, res) => {
    res.sendFile(path.join(relayDir, "index.html"));
  });
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // RELAY signaling — WebSocket upgrades on /api/relay are dispatched here.
  attachRelay(server);
  // Standalone calling UI (original index.html + app.js) mounted at /app.
  registerRelayApp(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
