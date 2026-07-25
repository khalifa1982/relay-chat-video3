import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * v2.99.51 — third-party actions in the PRODUCTION-CREDENTIAL job must be pinned
 * to a commit SHA.
 *
 * `deploy.yml` assumes the production deploy role via OIDC, so every action it
 * runs holds credentials that can write to the S3 release bucket and drive SSM on
 * the live fleet. A major tag like `@v4` is a MUTABLE pointer: the action's owner
 * (or anyone who compromises their account) can repoint it at any commit, and the
 * next push to `main` would run that code with production access. Nothing in the
 * repo would show a diff.
 *
 * The tag is kept as a trailing comment so a human can see which release a SHA
 * corresponded to; the test deliberately does NOT trust that comment.
 *
 * NOT yet enforced for `android-apk.yml` / `native-rn.yml`: those hold the Android
 * keystore secrets and should be pinned next, but they are unpinned today and a
 * failing test would block deploys rather than fix anything. The list below is
 * where to add them.
 */
const ROOT = path.resolve(__dirname, "..");
const CREDENTIAL_WORKFLOWS = [".github/workflows/deploy.yml"];

/** `uses: owner/repo@ref` → the ref, ignoring comments. Local actions are skipped. */
function actionRefs(yaml: string): { raw: string; ref: string }[] {
  const out: { raw: string; ref: string }[] = [];
  for (const line of yaml.split("\n")) {
    const m = /^\s*-?\s*uses:\s*([^\s#]+)/.exec(line);
    if (!m) continue;
    const spec = m[1];
    if (spec.startsWith("./") || spec.startsWith("docker://")) continue; // in-repo / image
    const at = spec.lastIndexOf("@");
    out.push({ raw: spec, ref: at === -1 ? "" : spec.slice(at + 1) });
  }
  return out;
}

describe("production-credential workflows pin every action to a SHA", () => {
  for (const wf of CREDENTIAL_WORKFLOWS) {
    const yaml = fs.readFileSync(path.join(ROOT, wf), "utf8");
    const refs = actionRefs(yaml);

    it(`${wf} — the parser finds the actions (guards against a silent pass)`, () => {
      expect(refs.length).toBeGreaterThanOrEqual(4);
    });

    it(`${wf} — every ref is a full 40-hex commit SHA`, () => {
      const unpinned = refs.filter((r) => !/^[0-9a-f]{40}$/.test(r.ref)).map((r) => r.raw);
      expect(unpinned, `pin these to a commit SHA: ${unpinned.join(", ")}`).toEqual([]);
    });

    it(`${wf} — no ref is a branch or a floating tag`, () => {
      for (const r of refs) {
        expect(r.ref, r.raw).not.toMatch(/^v?\d+(\.\d+)*$/); // v4, v4.1, 4
        expect(r.ref, r.raw).not.toMatch(/^(main|master|latest|HEAD)$/i);
      }
    });

    it(`${wf} — records the intended tag beside each SHA for humans`, () => {
      // A bare SHA is unreviewable; the comment is how a reader knows what it was.
      for (const line of yaml.split("\n")) {
        if (!/^\s*-?\s*uses:\s*[^\s#]+@[0-9a-f]{40}/.test(line)) continue;
        expect(line, `add a "# <tag>" comment: ${line.trim()}`).toMatch(/#\s*v?\d/);
      }
    });
  }

  it("deploy.yml still ships the files the fleet needs to boot", () => {
    // Not about pinning — but this file is the one people hand-edit when they
    // change the pins, and an older revision of it (missing these) has been
    // circulated. Each was added after a real per-server failure: without
    // ecosystem.config.cjs pm2 starts a stale path with no entry file, and
    // without patches/ the server's `pnpm install --frozen-lockfile` ENOENTs on
    // the lockfile's patched-dependency reference.
    const yaml = fs.readFileSync(path.join(ROOT, ".github/workflows/deploy.yml"), "utf8");
    const tar = yaml.slice(yaml.indexOf("tar -czf relay.tar.gz"));
    const line = tar.slice(0, tar.indexOf("\n"));
    for (const needed of ["ecosystem.config.cjs", "patches", "shared", "drizzle", "dist"]) {
      expect(line, `the release tar must include ${needed}`).toContain(needed);
    }
    // …and the landing page must still be stripped of the Manus host runtime.
    expect(yaml).toMatch(/strip-manus-runtime\.mjs/);
  });
});
