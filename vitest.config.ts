import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/src/lib/**/*.test.ts",
      "client/src/app/**/*.test.ts",
      "client/src/pages/**/*.test.ts",
      /* shared/ was never in these globs, so `shared/crashCore.test.ts` and
         `shared/telemetryCore.test.ts` sat green-by-omission — never executed —
         since the day they were written. Found when `shared/albumRules.test.ts`
         (v2.107.32) "passed" without running. */
      "shared/**/*.test.ts",
    ],
  },
});
