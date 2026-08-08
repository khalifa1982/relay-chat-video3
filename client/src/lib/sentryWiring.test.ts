/**
 * Sentry wiring (v2.107.78) — the pins.
 *
 * Two nets, one pipe: Sentry's own global hooks PLUS a forward from
 * `reportCrash`, the choke point the in-house reporter already routes
 * window.onerror, unhandledrejection and render crashes through. What this file
 * defends is the wiring order (hooks before anything can throw), the noise
 * policy (expected tRPC codes and offline flaps never spend quota), and the one
 * secret rule: the DSNs in the repo are INGEST-ONLY public keys — the readable
 * org token must never appear anywhere in this codebase.
 */
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../../..", p), "utf8");
const WEB = read("client/src/lib/sentry.ts");
const SRV = read("server/_core/sentry.ts");
const MAIN = read("client/src/main.tsx");
const CRASH = read("client/src/lib/crashReporter.ts");
const ENTRY = read("server/_core/index.ts");

describe("the readable token stays out of the repo", () => {
  it("no tracked file contains a Sentry org/user auth token", () => {
    /* The DSN keys committed here can only INGEST. The org token can READ every
       event — grep the whole tree, because the day it lands in a commit it is
       public (this repo is public). The needle is assembled from parts so THIS
       file can never match its own guard. */
    const prefixes = ["sntryu", "sntrys"].map((p) => p + "_").join("|");
    const hits = execSync(
      `git grep -lE '${prefixes}' || true`,
      { cwd: resolve(__dirname, "../../.."), encoding: "utf8" },
    ).trim();
    expect(hits).toBe("");
  });
});

describe("web wiring", () => {
  it("initSentry runs in main.tsx before the rest of the boot", () => {
    expect(MAIN).toMatch(/import \{ initSentry \} from "@\/lib\/sentry";\ninitSentry\(\);/);
    expect(MAIN.indexOf("initSentry()")).toBeLessThan(MAIN.indexOf("createRoot"));
  });

  it("reportCrash forwards into Sentry — one choke point, two sinks", () => {
    expect(CRASH).toMatch(/sentryCapture\(err, \{ kind: extra\?\.kind \?\? "crash"/);
    // The in-house report stays unconditional: the forward sits BEFORE the try,
    // and the original body still runs.
    expect(CRASH).toMatch(/import \{ sentryCapture \} from "@\/lib\/sentry";/);
  });

  it("dev stays quiet and the offline flap never spends quota", () => {
    expect(WEB).toMatch(/if \(!import\.meta\.env\.PROD\) return;/);
    for (const noise of ["ResizeObserver loop", "Failed to fetch", "AbortError"]) {
      expect(WEB).toMatch(noise);
    }
    // Errors-only install: tracing off on both halves.
    expect(WEB).toMatch(/tracesSampleRate: 0/);
    expect(SRV).toMatch(/tracesSampleRate: 0/);
  });
});

describe("server wiring", () => {
  it("the sentry module is imported on the entry's FIRST line after dotenv", () => {
    expect(ENTRY).toMatch(/^import "dotenv\/config";\n\/\/ Sentry hooks[^\n]*\nimport \{ sentryTrpcError \} from "\.\/sentry";/);
  });

  it("tRPC's onError forwards only the UNEXPECTED classes", () => {
    expect(ENTRY).toMatch(/onError: sentryTrpcError,/);
    for (const code of ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "TOO_MANY_REQUESTS"]) {
      expect(SRV).toMatch(new RegExp(`"${code}",`));
    }
    // INTERNAL_SERVER_ERROR must NOT be in the expected set — it is the signal.
    expect(SRV).not.toMatch(/"INTERNAL_SERVER_ERROR"/);
  });

  it("release strings carry the app version so issues bind to deploys", () => {
    expect(WEB).toMatch(/release: `relay-web@\$\{APP_VERSION\}`/);
    expect(SRV).toMatch(/release: `relay-server@\$\{APP_VERSION\}`/);
  });
});
