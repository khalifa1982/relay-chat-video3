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
 * v2.99.55 extends this to the two ANDROID workflows, which hold the upload
 * keystore secrets (`ANDROID_KEYSTORE_BASE64` and friends) — an action running in
 * those jobs can read the decoded keystore, and a repointed mutable tag is how it
 * would get there.
 *
 * PENDING_SHA below is the honest part: three actions are still on `@v4` because
 * resolving a tag to a commit requires reading those upstream repositories, which
 * this session cannot do (its GitHub access is scoped to this repo alone). Rather
 * than exempt the files wholesale — which would let a NEW unpinned action slip in
 * unnoticed — the gap is enumerated. So the rule is: everything must be pinned
 * EXCEPT these three exact specs, and adding a fourth fails. Resolve one with
 *
 *     gh api repos/actions/setup-java/git/ref/tags/v4 --jq .object.sha
 *
 * (for a tag that points at a tag object, follow it with
 * `gh api repos/<owner>/<repo>/git/tags/<sha> --jq .object.sha`), then delete its
 * entry here and put the SHA in the workflow with a `# v4` comment.
 */
const ROOT = path.resolve(__dirname, "..");
const CREDENTIAL_WORKFLOWS = [
  ".github/workflows/deploy.yml",
  ".github/workflows/android-apk.yml",
  ".github/workflows/native-rn.yml",
];

/** Actions whose SHA is not yet resolved. Shrink this; never grow it. */
const PENDING_SHA = new Set([
  "actions/setup-java@v4",
  "actions/upload-artifact@v4",
  "gradle/actions/setup-gradle@v4",
]);

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

    it(`${wf} — every ref is a full 40-hex commit SHA (or a known-pending one)`, () => {
      const unpinned = refs
        .filter((r) => !/^[0-9a-f]{40}$/.test(r.ref))
        .map((r) => r.raw)
        .filter((raw) => !PENDING_SHA.has(raw));
      expect(unpinned, `pin these to a commit SHA: ${unpinned.join(", ")}`).toEqual([]);
    });

    it(`${wf} — no ref is a branch or a floating tag`, () => {
      for (const r of refs) {
        if (PENDING_SHA.has(r.raw)) continue;
        expect(r.ref, r.raw).not.toMatch(/^v?\d+(\.\d+)*$/); // v4, v4.1, 4
        expect(r.ref, r.raw).not.toMatch(/^(main|master|latest|HEAD)$/i);
      }
    });

    it(`${wf} — a ref is NEVER a mutable branch, pending or not`, () => {
      // The pending exemption covers a floating TAG on a well-known first-party
      // action. A branch ref is a different thing entirely and is never excusable.
      for (const r of refs) {
        expect(r.ref, r.raw).not.toMatch(/^(main|master|develop|latest|HEAD)$/i);
        expect(r.ref, `${r.raw} — a ref must not be empty`).not.toBe("");
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

  it("the PENDING_SHA list only excuses actions that are actually still unpinned", () => {
    // A stale entry is worse than none: it would silently exempt an action that
    // someone later ADDED back unpinned. So every entry must correspond to a real
    // unpinned `uses:` somewhere in the covered workflows.
    const all = CREDENTIAL_WORKFLOWS.flatMap((wf) =>
      actionRefs(fs.readFileSync(path.join(ROOT, wf), "utf8")).map((r) => r.raw),
    );
    for (const pending of PENDING_SHA) {
      expect(all, `PENDING_SHA has a stale entry — delete it: ${pending}`).toContain(pending);
    }
  });

  it("deploy.yml — the job that holds PRODUCTION credentials has no pending exemptions", () => {
    // The Android workflows can carry a documented gap for a while; the workflow
    // that can write the release bucket and drive SSM on the live fleet cannot.
    const refs = actionRefs(fs.readFileSync(path.join(ROOT, ".github/workflows/deploy.yml"), "utf8"));
    for (const r of refs) {
      expect(r.ref, `${r.raw} must be a SHA — no exemptions in deploy.yml`).toMatch(/^[0-9a-f]{40}$/);
    }
  });

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
