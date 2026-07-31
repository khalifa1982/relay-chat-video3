import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * v2.106.45 — THE MEDIA AGENT BECOMES DEPLOYABLE.
 *
 * `voip-node/` is deliberately EXCLUDED from the app release tar (voipNodeParity.test.ts pins
 * that: it carries a mediasoup dependency whose C++ worker is compiled per install and which
 * no app instance ever runs). The consequence, unnoticed until now, is that `deploy.yml`
 * structurally CANNOT reach a media node — so the agent's own README documents a fully MANUAL
 * file copy, and the agent has changed in four releases since the nodes were built. Every one
 * of those was a hand-copy somebody had to remember, which is how a node ends up running code
 * nothing in the repo matches with no way to tell from the outside.
 *
 * The new `voip-deploy` action closes that. These tests guard the two things that make it safe
 * — it can only ever touch a media node, and it never writes a secret — plus the several ways
 * a deploy tool can report success while leaving a node broken.
 */
const ROOT = path.resolve(__dirname, "..");
const OPS = fs.readFileSync(path.join(ROOT, ".github", "workflows", "aws-ops.yml"), "utf8");
const REMOTE_PATH = path.join(ROOT, "voip-node", "deploy-remote.sh");
const REMOTE = fs.readFileSync(REMOTE_PATH, "utf8");

/** The `voip-deploy` step's own region of the workflow. */
function voipStep(): string {
  const at = OPS.indexOf("- name: voip-deploy — install");
  expect(at, "the voip-deploy step must exist").toBeGreaterThan(0);
  const body = OPS.slice(at);
  expect(body.length, "the slice must be real").toBeGreaterThan(2000);
  return body;
}

describe("voip-deploy can only ever touch a media node", () => {
  it("targets tag:Name=relay-voip and NEVER the app tag", () => {
    // THE LOAD-BEARING PROPERTY. Every other action here targets `relay-app` and carries
    // MEDIA_NODE_GUARD to skip a media node in the set; this one is the mirror image, and
    // targeting is what makes it structurally unable to select an app box — a guard can be
    // forgotten, a tag filter cannot.
    const step = voipStep();
    expect(step).toMatch(/Name=tag:Name,Values=relay-voip/);
    expect(step, "an app-tag filter here would defeat the whole design").not.toMatch(
      /Values=relay-app/,
    );
  });

  it("is the recorded exemption from the tag-guard sweep, not the one that was missed", () => {
    /* v2.106.33's sweep requires every TAG-TARGETED `ssm send-command` to carry
       MEDIA_NODE_GUARD. This action resolves instance ids first and sends to `--instance-ids`,
       so the sweep does not flag it — and that must be a decision rather than an accident,
       exactly as the coturn probe's exemption is. It is exempt because the guard's whole
       purpose is to SKIP media nodes, and this action's purpose is to write to them. */
    const step = voipStep();
    const at = step.indexOf("aws ssm send-command");
    expect(at, "it must send a command").toBeGreaterThan(0);
    const window = step.slice(at, at + 400);
    expect(window, "sends to resolved ids, so the sweep correctly ignores it").toContain(
      "--instance-ids $IIDS",
    );
    expect(window, "and must never carry the skip-a-media-node guard, which would skip its own target").not.toContain(
      "MEDIA_NODE_GUARD",
    );
  });

  it("the remote script refuses an APP host LOUDLY rather than skipping", () => {
    // The asymmetry is the point. For an app action a media node in the target set costs
    // nothing, so MEDIA_NODE_GUARD exits 0 and the fleet command silently skips it. Here an
    // app server in the target set means somebody has tagged a production web host as a media
    // node — so the refusal must be a NON-ZERO marker, which the caller turns into a failure.
    expect(REMOTE).toMatch(/if \[ -f \/home\/relay\/\.env \] \|\| \[ -d \/home\/relay\/app \]/);
    const at = REMOTE.indexOf("/home/relay/.env");
    const window = REMOTE.slice(at, at + 400);
    expect(window).toMatch(/fail "REFUSED[^"]*APP server[^"]*" 90/);
    // 90 is not 0 — a zero here would make a mis-tag silently install onto a web server.
    expect(window).not.toMatch(/VOIP_EXIT=0/);
  });

  it("the discriminator really is something only an app box has", () => {
    /* If it could be true on a media node, every deploy would refuse and the action would be
       useless; if it could be FALSE on an app box, a mis-tag would install there. `/home/relay`
       is where the app's env and release live — asserted against deploy.yml so it cannot rot. */
    const deploy = fs.readFileSync(path.join(ROOT, ".github", "workflows", "deploy.yml"), "utf8");
    expect(deploy, "the app really does live in /home/relay").toMatch(/\/home\/relay/);
    // …and the media agent lives somewhere else entirely.
    expect(fs.readFileSync(path.join(ROOT, "voip-node", "relay-voip.service"), "utf8")).toMatch(
      /WorkingDirectory=\/opt\/relay-voip/,
    );
  });
});

describe("voip-deploy never writes a secret", () => {
  it("does not create or write /etc/relay-voip/env", () => {
    // VOIP_NODE_SECRET and REDIS_URL are real secrets, and a workflow_dispatch input is
    // visible in run metadata — so they can only be placed by a human. The script REPORTS the
    // file's presence and declines to start without it; it must never write it.
    for (const src of [voipStep(), REMOTE]) {
      expect(src).not.toMatch(/tee \/etc\/relay-voip\/env/);
      expect(src).not.toMatch(/> \/etc\/relay-voip\/env/);
      expect(src).not.toMatch(/VOIP_NODE_SECRET=/);
      expect(src).not.toMatch(/REDIS_URL=redis/);
    }
    // It does read whether the file EXISTS, which is the honest half.
    expect(REMOTE).toMatch(/if \[ -f \/etc\/relay-voip\/env \]/);
  });

  it("prints no value from the env file — only that it is there", () => {
    const at = REMOTE.indexOf("/etc/relay-voip/env: present");
    expect(at).toBeGreaterThan(0);
    const line = REMOTE.slice(at, REMOTE.indexOf("\n", at));
    // A line count is not a value. `cat`/`grep -o`/`head` of that file would be.
    expect(line).toMatch(/grep -c \./);
    expect(line).not.toMatch(/cat \/etc\/relay-voip\/env/);
    expect(REMOTE).not.toMatch(/cat \/etc\/relay-voip\/env/);
  });

  it("no secret is accepted as a workflow input either", () => {
    // The one input this action takes is a boolean. A string input here would be the exact
    // shape the repo's own rule forbids.
    const at = OPS.indexOf("      voip_apply:");
    expect(at).toBeGreaterThan(0);
    const block = OPS.slice(at, at + 500);
    expect(block).toMatch(/type: boolean/);
    expect(OPS, "no voip_* string input may exist").not.toMatch(
      /voip_(secret|redis|url|env)[a-z_]*:\s*\n\s*description/,
    );
  });
});

describe("voip-deploy cannot report success over a broken node", () => {
  it("the write is gated on an explicit flag, and dry run is the default", () => {
    const at = OPS.indexOf("      voip_apply:");
    const block = OPS.slice(at, at + 600);
    expect(block).toMatch(/default: false/);
    // The gate must PRECEDE every write in the remote script.
    const gate = REMOTE.indexOf('if [ "$VOIP_APPLY" != "1" ]');
    expect(gate, "the dry-run gate must exist").toBeGreaterThan(0);
    for (const write of ["base64 -d > /tmp/voip-node.tgz", "tar -xzf", "systemctl restart"]) {
      const w = REMOTE.indexOf(write);
      expect(w, `${write} must exist`).toBeGreaterThan(0);
      expect(w, `${write} must come AFTER the dry-run gate`).toBeGreaterThan(gate);
    }
  });

  it("the payload is checksummed BEFORE it is extracted", () => {
    // A truncated archive extracted over a working agent, then restarted, is the worst
    // outcome available here — so the mismatch branch must precede the extract.
    const check = REMOTE.indexOf('if [ "$GOT" != "$VOIP_SHA" ]');
    const extract = REMOTE.indexOf("tar -xzf");
    expect(check).toBeGreaterThan(0);
    expect(extract).toBeGreaterThan(check);
    expect(REMOTE).toMatch(/fail "REFUSED: payload checksum mismatch[^"]*" 94/);
  });

  it("every module is syntax-checked BEFORE the service is restarted", () => {
    /* A syntax error would otherwise surface as a crash-looping unit whose journal nobody
       reads until a call fails — and that mistake has already been made once in agent.mjs
       (v2.106.36, caught by `node --check` rather than by review). */
    const check = REMOTE.indexOf("node --check");
    const restart = REMOTE.indexOf("systemctl restart");
    expect(check).toBeGreaterThan(0);
    expect(restart).toBeGreaterThan(check);
    expect(REMOTE).toMatch(/for f in agent\.mjs record\.mjs sign\.mjs; do/);
    expect(REMOTE).toMatch(/does not parse — NOT restarting/);
  });

  it("it PROVES the service came back rather than assuming it did", () => {
    // A deploy that installs and leaves the unit dead is worse than none.
    const at = REMOTE.indexOf("systemctl restart");
    const after = REMOTE.slice(at);
    expect(after).toMatch(/systemctl is-active --quiet relay-voip/);
    expect(after).toMatch(/journalctl -u relay-voip/);
    expect(after).toMatch(/fail "STARTED BUT NOT RUNNING[^"]*" 100/);
  });

  it("the verdict is read from the printed marker, from EVERY invocation", () => {
    /* Two separate rules this repo has paid for: a wrapper or pipeline can mask a non-zero
       exit (v2.99.46), and reading CommandInvocations[0] lets a healthy sibling hide a broken
       node (v2.105.5) — which on a TWO-node fleet is exactly the failure worth catching. */
    const step = voipStep();
    expect(step).toMatch(/grep -q "VOIP_EXIT=0"/);
    expect(step).toMatch(/CommandInvocations\[\$idx\]/);
    expect(step, "must not read only the first invocation").not.toMatch(
      /CommandInvocations\[0\]\.CommandPlugins/,
    );
    // Every exit in the remote script prints a marker, or a silent path would read as failure
    // and a failing path could read as success.
    const exits = REMOTE.match(/^\s*exit 0$/gm) ?? [];
    const markers = REMOTE.match(/VOIP_EXIT=/g) ?? [];
    expect(exits.length, "every exit is preceded by a marker").toBeGreaterThan(0);
    expect(markers.length).toBeGreaterThanOrEqual(exits.length);
  });

  it("rolls ONE node at a time and stops on the first failure", () => {
    const step = voipStep();
    const at = step.indexOf("aws ssm send-command");
    const window = step.slice(at, at + 400);
    expect(window).toMatch(/--max-concurrency 1/);
    expect(window).toMatch(/--max-errors 0/);
  });

  it("zero media nodes is a loud error with the tagging command, not a silent success", () => {
    const step = voipStep();
    const at = step.indexOf('if [ -z "$IIDS" ]');
    expect(at).toBeGreaterThan(0);
    const window = step.slice(at, at + 1400);
    expect(window).toMatch(/::error::no running instance tagged Name=relay-voip/);
    expect(window, "it must say how to fix it").toMatch(/create-tags/);
    expect(window).toMatch(/exit 1/);
  });
});

describe("the payload is built correctly", () => {
  it("excludes node_modules — the compiled worker must never be shipped", () => {
    /* mediasoup builds a C++ worker per install against the box's own toolchain. Shipping
       one built on a GitHub runner is how a node ends up with a binary that does not match
       its libc. */
    const step = voipStep();
    expect(step).toMatch(/tar -czf [^\n]*--exclude=node_modules/);
  });

  it("installs with --frozen-lockfile, and skips the rebuild when nothing changed", () => {
    /* The versions are pinned EXACTLY (not ranges) because the worker is compiled per
       install, so a plain install without the lockfile resolves newer ones and the difference
       is invisible until a call behaves differently on ONE node. And the rebuild takes
       minutes, so re-running it for an agent.mjs one-liner would time the SSM command out and
       leave the node mid-install — hence the manifest fingerprint. */
    expect(REMOTE).toMatch(/install --frozen-lockfile/);
    expect(REMOTE).toMatch(/DEPS_BEFORE=/);
    expect(REMOTE).toMatch(/DEPS_AFTER=/);
    expect(REMOTE).toMatch(/if \[ "\$DEPS_BEFORE" != "\$DEPS_AFTER" \] \|\| \[ ! -d \/opt\/relay-voip\/node_modules\/mediasoup \]/);
    // The fingerprint must be taken BEFORE the extract, or it always compares equal.
    expect(REMOTE.indexOf("DEPS_BEFORE=")).toBeLessThan(REMOTE.indexOf("tar -xzf"));
    // And the pins really are exact in the manifest this ships.
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "voip-node", "package.json"), "utf8"));
    for (const [dep, ver] of Object.entries(pkg.dependencies as Record<string, string>)) {
      expect(ver, `${dep} must be an exact pin, not a range`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("the payload really contains every file the script requires", () => {
    // Driven rather than asserted: the script refuses on a missing module, so a file it names
    // that voip-node/ does not carry would be a deploy that always refuses.
    for (const f of ["agent.mjs", "record.mjs", "sign.mjs", "package.json", "pnpm-lock.yaml", "relay-voip.service"]) {
      expect(fs.existsSync(path.join(ROOT, "voip-node", f)), f).toBe(true);
    }
  });
});

describe("the remote script itself is sound", () => {
  it("parses — DRIVEN, because a syntax error here is a crash-looping unit", () => {
    // A source pin cannot tell you whether a shell script runs. `bash -n` can.
    expect(() =>
      execFileSync("bash", ["-n", REMOTE_PATH], { stdio: "pipe" }),
    ).not.toThrow();
  });

  it("its inputs arrive as separate SSM command elements, never substituted into it", () => {
    /* SSM concatenates every `commands` element into ONE shell script, so a plain assignment
       in an earlier element is in scope in a later one — the same mechanism MEDIA_NODE_GUARD
       uses. That is what lets the script be a checked-in, syntax-checkable file instead of a
       heredoc quoted three times over (YAML, the runner's shell, the SSM JSON). */
    const step = voipStep();
    expect(step).toMatch(/SCRIPT=\$\(cat voip-node\/deploy-remote\.sh\)/);
    expect(step).toMatch(/"VOIP_B64=" \+ \$b/);
    expect(step).toMatch(/"VOIP_SHA=" \+ \$sha/);
    expect(step).toMatch(/"VOIP_APPLY=" \+ \$apply/);
    // No placeholder substitution into the script body — that shape is what makes a payload
    // re-parseable by the runner's shell.
    expect(step).not.toMatch(/__B64__|__SHA__|__APPLY__/);
    expect(REMOTE).not.toMatch(/__B64__|__SHA__|__APPLY__/);
    // The script must tolerate the variables being absent (a bare `bash -n` / a manual run).
    expect(REMOTE).toMatch(/VOIP_B64="\$\{VOIP_B64:-\}"/);
    expect(REMOTE).toMatch(/VOIP_APPLY="\$\{VOIP_APPLY:-0\}"/);
  });

  it("is not shipped in the app release tar", () => {
    // It lives in voip-node/, which deploy.yml excludes; adding a file there must not change
    // that. voipNodeParity.test.ts owns the rule — this asserts the new file is inside it.
    const deploy = fs.readFileSync(path.join(ROOT, ".github", "workflows", "deploy.yml"), "utf8");
    expect(deploy, "the release tar must still not carry voip-node").not.toMatch(
      /tar[^\n]*\bvoip-node\b/,
    );
    expect(path.relative(ROOT, REMOTE_PATH).startsWith("voip-node" + path.sep)).toBe(true);
  });
});
