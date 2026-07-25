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
 * v2.99.56 CLOSES the gap PENDING_SHA existed to document. The three remaining
 * `@v4` refs (actions/setup-java, actions/upload-artifact,
 * gradle/actions/setup-gradle) are now commit SHAs, so PENDING_SHA is empty and
 * every action in all three workflows is pinned.
 *
 * How they were resolved, since it matters if anyone repeats it: this session's
 * GitHub *API* access is scoped to this repo (api.github.com returns 403 for
 * anything else), but `git ls-remote https://github.com/<owner>/<repo>
 * refs/tags/v4 'refs/tags/v4^{}'` is NOT scoped and answers the question better —
 * one call gives both the ref and, for an ANNOTATED tag, the commit it
 * dereferences to.
 *
 * That distinction was not academic. gradle/actions v4 IS annotated: the ref is a
 * tag OBJECT (0b6dd653ba04f4f93bf581ec31e66cbd7dcb644d) and the commit is
 * ed408507eac070d1f99cc633dbcf757c94c7933a. `--jq .object.sha` on the ref API
 * returns the tag object, so pinning that value would have put a non-commit SHA
 * in `uses:`. Always pin the commit. (actions/setup-java v4 = v4.8.0 and
 * actions/upload-artifact v4 = v4.6.2 are lightweight tags — ref == commit. The
 * pre-existing actions/checkout and actions/setup-node pins were verified against
 * upstream at the same time: both are v4.4.0 and both are current.)
 *
 * PENDING_SHA stays as an (empty) mechanism rather than being deleted: if some
 * future action genuinely cannot be resolved, enumerate it there instead of
 * exempting a whole file. Shrink it; never grow it.
 *
 * v2.99.58 covers EVERY workflow, discovered by reading the directory rather
 * than a hand-maintained list. The hand-list was itself the weak point: it named
 * deploy.yml + the two Android files, so `aws-ops.yml` — which assumes the SAME
 * production role as deploy.yml (`role-to-assume: …/relay-github-deploy`, with
 * `id-token: write`) — sat outside the rule with an UNPINNED
 * aws-actions/configure-aws-credentials@v4. A mutable tag was reaching the exact
 * credentials the original rule was written to protect. `ci.yml` was uncovered
 * for the same reason. Globbing means a NEW workflow file is covered the moment
 * it lands, instead of silently starting life exempt.
 *
 * Two more ANNOTATED tags turned up while pinning those:
 * aws-actions/configure-aws-credentials v4 (tag object
 * ff717079ee2060e4bcee96c4779b553acc87447c → commit 7474bc46…, v4.3.1) and
 * pnpm/action-setup v4 (tag object f40ffcd9367d9f12939873eb1018b921a783ffaa →
 * commit b906affc…, v4.3.0). So three of the seven distinct actions here use
 * annotated tags — the `.object.sha` trap is the common case, not the exception.
 * Both pins that already existed in deploy.yml were verified to be the correct
 * dereferenced COMMITs, not tag objects.
 */
const ROOT = path.resolve(__dirname, "..");
const WORKFLOW_DIR = ".github/workflows";
/** EVERY workflow, read from disk — never a hand-maintained list (see header). */
const CREDENTIAL_WORKFLOWS = fs
  .readdirSync(path.join(ROOT, WORKFLOW_DIR))
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .sort()
  .map((f) => `${WORKFLOW_DIR}/${f}`);

/** Actions whose SHA is not yet resolved. Shrink this; never grow it.
 *  Empty since v2.99.56 — every action in the covered workflows is pinned. */
const PENDING_SHA = new Set<string>([]);

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
  it("the workflow list is read from disk and is not empty (no vacuous pass)", () => {
    // If the glob ever resolves to nothing, every per-file assertion below
    // disappears and the suite goes green while enforcing nothing.
    expect(CREDENTIAL_WORKFLOWS.length).toBeGreaterThanOrEqual(5);
    for (const wf of CREDENTIAL_WORKFLOWS) {
      expect(fs.existsSync(path.join(ROOT, wf)), `${wf} should exist`).toBe(true);
    }
    // The files that hold credentials must be among them, by name.
    for (const must of ["deploy.yml", "aws-ops.yml", "android-apk.yml", "native-rn.yml"]) {
      expect(CREDENTIAL_WORKFLOWS.join(",")).toContain(must);
    }
    // A global floor belongs here, not per-file: individual workflows legitimately
    // differ in size (aws-ops.yml has 2 action refs, ci.yml 3), but the suite as a
    // whole must be inspecting a real, substantial set.
    const total = CREDENTIAL_WORKFLOWS.reduce(
      (n, wf) => n + actionRefs(fs.readFileSync(path.join(ROOT, wf), "utf8")).length,
      0,
    );
    expect(total, "the parser found suspiciously few actions overall").toBeGreaterThanOrEqual(15);
  });

  for (const wf of CREDENTIAL_WORKFLOWS) {
    const yaml = fs.readFileSync(path.join(ROOT, wf), "utf8");
    const refs = actionRefs(yaml);

    it(`${wf} — the parser sees every remote action in the file`, () => {
      // Independent count: every `uses:` line, minus the in-repo/image forms
      // that actionRefs deliberately skips. If a regex change ever made the
      // parser blind, this diverges instead of passing vacuously — which an
      // arbitrary "at least N" floor would not catch (and that floor also broke
      // as soon as the rule covered the smaller workflows).
      const usesLines = yaml.split("\n").filter((l) => /^\s*-?\s*uses:\s*\S/.test(l));
      const localOrImage = usesLines.filter((l) =>
        /^\s*-?\s*uses:\s*(\.\/|docker:\/\/)/.test(l),
      );
      expect(refs.length).toBe(usesLines.length - localOrImage.length);
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

  it("PENDING_SHA is empty — no action anywhere is excused from being pinned", () => {
    // The gap closed in v2.99.56. Re-adding an entry is a REGRESSION, not a
    // routine edit: it means a mutable tag is once again running in a job that
    // holds either production credentials or the upload keystore. If a tag truly
    // cannot be resolved, resolve it with `git ls-remote` (see the header) before
    // reaching for this list.
    expect([...PENDING_SHA]).toEqual([]);
    const floating = CREDENTIAL_WORKFLOWS.flatMap((wf) =>
      actionRefs(fs.readFileSync(path.join(ROOT, wf), "utf8"))
        .filter((r) => !/^[0-9a-f]{40}$/.test(r.ref))
        .map((r) => `${wf}: ${r.raw}`),
    );
    expect(floating, `these are not pinned to a commit SHA: ${floating.join(", ")}`).toEqual([]);
  });

  it("no pin is an annotated-tag OBJECT sha (gradle/actions v4 is the trap)", () => {
    // `gh api .../git/ref/tags/v4 --jq .object.sha` returns the TAG OBJECT for an
    // annotated tag, which is not a commit. The one known instance is pinned to
    // its dereferenced commit; assert the tag object appears in no workflow.
    const TAG_OBJECTS = [
      "0b6dd653ba04f4f93bf581ec31e66cbd7dcb644d", // gradle/actions v4
      "ff717079ee2060e4bcee96c4779b553acc87447c", // aws-actions/configure-aws-credentials v4
      "f40ffcd9367d9f12939873eb1018b921a783ffaa", // pnpm/action-setup v4
    ];
    for (const wf of CREDENTIAL_WORKFLOWS) {
      const yaml = fs.readFileSync(path.join(ROOT, wf), "utf8");
      for (const obj of TAG_OBJECTS) {
        expect(yaml, `${wf} pins a tag OBJECT, not a commit: ${obj}`).not.toContain(obj);
      }
    }
    const gradle = fs.readFileSync(path.join(ROOT, ".github/workflows/android-apk.yml"), "utf8");
    expect(gradle).toContain("gradle/actions/setup-gradle@ed408507eac070d1f99cc633dbcf757c94c7933a");
  });

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
