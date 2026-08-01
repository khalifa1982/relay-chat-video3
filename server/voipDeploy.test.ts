import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * v2.106.45 — THE MEDIA AGENT BECOMES DEPLOYABLE.
 *
 * `voip-node/` is deliberately EXCLUDED from the app release tar (voipNodeParity.test.ts pins
 * that: it carries a mediasoup dependency whose worker is a host-specific binary, and which
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

  it("the tag filter is a GLOB, or it selects none of the fleet", () => {
    /* v2.106.72, and this one had gone from "works" to "matches nothing" without a line of
       code changing. The nodes are named relay-voip-a, relay-voip-b, relay-voip-3 …
       relay-voip-8; an EXACT `Values=relay-voip` filter — which is what this was — matches
       NONE of them, so the action reported "no running instance tagged Name=relay-voip" over
       eight healthy boxes and read exactly like an untagged fleet.

       The safety property is untouched: `relay-voip-*` cannot match `relay-app`. Both
       spellings are listed because EC2 treats `Values=a,b` as an OR and a node tagged with the
       bare name must not become unreachable. */
    const step = voipStep();
    const line = step.split("\n").find((l) => l.includes("Name=tag:Name,Values=relay-voip"));
    expect(line, "the tag filter must exist").toBeTruthy();
    expect(line!, "the glob is what reaches relay-voip-a … relay-voip-8").toContain("relay-voip-*");
    expect(line!, "and the bare name must still work").toMatch(/Values=relay-voip[,"]/);
    expect(line!, "an app box can never match either spelling").not.toContain("relay-app");
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
    expect(fs.readFileSync(path.join(ROOT, "voip-node", "relay-voip-agent.service"), "utf8")).toMatch(
      /WorkingDirectory=\/opt\/relay-voip/,
    );
  });
});

describe("voip-deploy never writes a secret", () => {
  it("does not create or write the env file", () => {
    // VOIP_NODE_SECRET and REDIS_URL are real secrets, and a workflow_dispatch input is
    // visible in run metadata — so they can only be placed by a human. The script REPORTS the
    // file's presence and declines to start without it; it must never write it.
    //
    // REWRITTEN v2.106.72 to cover BOTH spellings. The provisioned nodes carry
    // `/etc/relay-voip/agent.env`; the older path is `/etc/relay-voip/env`. A sweep naming
    // only one of them would let a write to the other through.
    for (const src of [voipStep(), REMOTE]) {
      for (const f of ["/etc/relay-voip/env", "/etc/relay-voip/agent.env"]) {
        expect(src).not.toContain(`tee ${f}`);
        expect(src).not.toContain(`> ${f}`);
      }
      /* The KEY NAME is allowed to appear — the script greps for it, and the message tells an
         operator which line to add. A VALUE is not. Enumerated rather than pattern-matched,
         because my first attempt at a clever regex was WRONG ABOUT THE CODE: it forbade
         `VOIP_NODE_SECRET=` followed by anything but a placeholder, and the grep pattern
         `'^[[:space:]]*VOIP_NODE_SECRET=..*'` is itself exactly that shape. Every occurrence
         must be one of the two legitimate ones. */
      for (const occ of src.match(/VOIP_NODE_SECRET=\S*/g) ?? []) {
        const legit =
          occ === "VOIP_NODE_SECRET=..*'" || // the grep pattern (a shape, not a value)
          occ.startsWith("VOIP_NODE_SECRET=<"); // the "add this line" placeholder
        expect(legit, `unexpected VOIP_NODE_SECRET occurrence: ${occ}`).toBe(true);
      }
      expect(src).not.toMatch(/REDIS_URL=redis/);
    }
    // It does read whether the file EXISTS, which is the honest half.
    expect(REMOTE).toMatch(/for f in \/etc\/relay-voip\/agent\.env \/etc\/relay-voip\/env; do/);
  });

  it("prints no value from the env file — only that it is there, and that it names the secret", () => {
    const at = REMOTE.indexOf('echo "$ENV_FILE: present');
    expect(at).toBeGreaterThan(0);
    const line = REMOTE.slice(at, REMOTE.indexOf("\n", at));
    // A line count is not a value. `cat`/`grep -o`/`head` of that file would be.
    expect(line).toMatch(/grep -c \./);
    expect(line).toMatch(/values NOT read/);
    for (const f of ["/etc/relay-voip/env", "/etc/relay-voip/agent.env", "$ENV_FILE"]) {
      expect(REMOTE).not.toContain(`cat ${f}`);
    }
    /* THE SECRET IS CHECKED BY KEY NAME, WHICH IS NOT A DISCLOSURE — and it is the difference
       between one legible line and a 2s restart loop. `main()` throws outright without
       VOIP_NODE_SECRET ("the internal API is signed"), and infra's provisioning writes an
       agent.env that does NOT contain it, so every node would crash-loop with the real reason
       buried in journald. `grep -q '^VOIP_NODE_SECRET=..*'` reveals nothing: a name is not a
       value, and `-q` prints nothing at all. */
    expect(REMOTE).toMatch(/grep -q '\^\[\[:space:\]\]\*VOIP_NODE_SECRET=\.\.\*' "\$ENV_FILE"/);
    expect(REMOTE, "and it must be -q, so no matched line is ever echoed").not.toMatch(
      /grep [^|\n]*VOIP_NODE_SECRET[^|\n]*\|/,
    );
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
    expect(REMOTE).toMatch(/for f in index\.js record\.mjs sign\.mjs; do/);
    expect(REMOTE).toMatch(/does not parse — NOT restarting/);
  });

  it("it PROVES the service came back rather than assuming it did", () => {
    // A deploy that installs and leaves the unit dead is worse than none.
    const at = REMOTE.indexOf("systemctl restart");
    const after = REMOTE.slice(at);
    expect(after).toMatch(/systemctl is-active --quiet "\$SVC"/);
    expect(after).toMatch(/journalctl -u "\$SVC"/);
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
    // REWRITTEN v2.106.47 to the PROPERTY, and this pin is the cautionary tale: written two
    // hours earlier, it froze the gate's exact expression INCLUDING the `-d` directory test —
    // i.e. it froze the defect, and would have forbidden the fix. The property is only that
    // the install runs when the manifest moved OR the built artifact is absent; which artifact
    // counts is pinned by the worker-binary describe below.
    //
    // Widened again v2.106.72: the artifact may now be RESOLVED from either root, so "absent"
    // is `-z` (nothing resolved) as well as `! -x` (resolved but not runnable). Enumerated as
    // a set rather than one literal so the order of the conjuncts is free.
    // REWRITTEN AGAIN v2.106.73. It froze the gate with the fingerprint comparison FIRST — and
    // that ordering was the defect: on a first apply the fingerprint always differs, so the
    // install always ran and the pre-built worker was never reused. The property is that a
    // missing artifact forces an install and a fingerprint change only counts on an update.
    const gateLine = REMOTE.split("\n").find((l) => l.includes('"$HAD_MANIFEST"'));
    expect(gateLine, "the install gate must exist").toBeTruthy();
    expect(gateLine!).toContain('[ -z "$WORKER_BIN" ]');
    expect(gateLine!).toContain('[ ! -x "$WORKER_BIN" ]');
    expect(gateLine!).toContain('[ "$DEPS_BEFORE" != "$DEPS_AFTER" ]');
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
    for (const f of [
      "index.js",
      "record.mjs",
      "sign.mjs",
      "package.json",
      "pnpm-lock.yaml",
      "relay-voip-agent.service",
    ]) {
      expect(fs.existsSync(path.join(ROOT, "voip-node", f)), f).toBe(true);
    }
    // And the old names are GONE rather than lingering beside the new ones — two entrypoints
    // in the payload is how a node ends up running the one nobody edited.
    for (const stale of ["agent.mjs", "relay-voip.service"]) {
      expect(fs.existsSync(path.join(ROOT, "voip-node", stale)), stale).toBe(false);
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

/**
 * v2.106.47 — THE WORKER BINARY, NOT THE PACKAGE DIRECTORY.
 *
 * Found by a 20-agent map of the cutover, then PROVEN empirically in a scratch install:
 * `pnpm install --frozen-lockfile` in `voip-node/` exits 0 while printing
 * `Ignored build scripts: mediasoup@3.19.3` and finishing in 2.8s — pnpm 10 blocks dependency
 * lifecycle scripts by default and mediasoup fetches its worker from postinstall. So the
 * install "succeeds", `pendingBuilds` records the skip, no `mediasoup-worker` is written, and
 * the agent dies in `createWorker()` at startup.
 *
 * v2.106.45's gate was `[ ! -d node_modules/mediasoup ]` — a DIRECTORY test an unbuilt install
 * satisfies — so on a node in that state it printed "dependencies unchanged" and reported
 * VOIP_EXIT=0 over a node that cannot start. A successful deploy over a broken node is the one
 * outcome that script exists to prevent, and it was mine.
 */
describe("the mediasoup worker binary is what gets verified", () => {
  const PKG = JSON.parse(
    fs.readFileSync(path.join(ROOT, "voip-node", "package.json"), "utf8"),
  ) as { pnpm?: { onlyBuiltDependencies?: string[] }; dependencies?: Record<string, string> };

  it("the agent package allows mediasoup's build script to run", () => {
    // Without this, pnpm 10 silently ships no worker. Empirically verified both ways.
    expect(PKG.pnpm?.onlyBuiltDependencies, "mediasoup must be allowed to build").toContain(
      "mediasoup",
    );
  });

  it("only mediasoup is allowed — this is not a blanket opt-out of pnpm's protection", () => {
    /* `onlyBuiltDependencies` exists to keep arbitrary transitive postinstalls from running.
       Widening it to every dependency would trade a real supply-chain protection for
       convenience, so the list stays exactly the one package that genuinely needs it. */
    expect(PKG.pnpm?.onlyBuiltDependencies).toEqual(["mediasoup"]);
    expect(Object.keys(PKG.dependencies ?? {}).sort()).toEqual(["ioredis", "mediasoup"]);
  });

  it("the install gate keys on the BINARY, never on the package directory", () => {
    expect(REMOTE).toMatch(/MEDIASOUP_WORKER_BIN:-/);
    expect(REMOTE).toMatch(/mediasoup-worker/);
    expect(REMOTE).toMatch(/\[ ! -x "\$WORKER_BIN" \]/);
    /* The directory test is exactly the defect: an unbuilt install satisfies it.
       ON COMMENT-STRIPPED SOURCE, and that is the 18th time this trap has fired here — the
       script's own comment QUOTES `[ ! -d node_modules/mediasoup ]` to explain why it is gone,
       so a sweep for the pattern matches the prose that documents its removal and fails on
       correct source. The companion assertion below proves the strip is doing real work rather
       than hiding a defect. */
    const code = REMOTE.split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    expect(code, "a -d test on the package dir cannot see a blocked build").not.toMatch(
      /! -d [^\n]*node_modules\/mediasoup\b/,
    );
    expect(REMOTE, "…and the prose really does still carry it, so the strip is load-bearing").toMatch(
      /! -d node_modules\/mediasoup/,
    );
  });

  it("the PRE-BUILT worker is reused, but only at the version we pin", () => {
    /* v2.106.72. Infra provisions each node with mediasoup already compiled at
       /opt/relay-voip/node_modules — and Node finds it unaided by walking up from
       /opt/relay-voip/agent/index.js. Reusing it turns a ~2-minute-per-node compile (×8, well
       past the SSM window) into nothing.

       The VERSION CHECK is what makes reuse safe rather than convenient: the pins are exact
       precisely because the worker is a host-specific binary, so a silent version difference
       surfaces as one node behaving differently in a call with nothing anywhere saying why. A
       mismatch must fall through to a real install, never be adopted. */
    expect(REMOTE, "both roots are searched, ours first").toMatch(
      /for root in "\$AGENT_DIR" \/opt\/relay-voip; do/,
    );
    expect(REMOTE, "the wanted version comes from the manifest we ship").toMatch(
      /WANT_VER=.*dependencies\.mediasoup/,
    );
    const at = REMOTE.indexOf('for root in "$AGENT_DIR"');
    const loop = REMOTE.slice(at, REMOTE.indexOf("\nfi", at));
    expect(loop, "a version mismatch must be skipped, not adopted").toMatch(
      /\[ "\$HAVE_VER" != "\$WANT_VER" \][\s\S]{0,200}?continue/,
    );
    // …and it must still be executable to count, whatever the version says.
    expect(loop).toMatch(/\[ -x "\$CAND" \] \|\| continue/);
  });

  it("the binary is verified on the SKIP path too, and after any install", () => {
    /* `pnpm install` exits 0 while printing "Ignored build scripts", so its exit code is not
       evidence the worker exists — and the skip path runs no install at all. The check must
       therefore sit AFTER the whole if/else, unconditionally. */
    const gate = REMOTE.indexOf('if [ -z "$WORKER_BIN" ] || [ ! -x "$WORKER_BIN" ] ||');
    const skipMsg = REMOTE.indexOf("skipping the install");
    const verify = REMOTE.lastIndexOf('if [ ! -x "$WORKER_BIN" ]');
    expect(gate).toBeGreaterThan(0);
    expect(skipMsg).toBeGreaterThan(gate);
    expect(verify, "the verification must follow BOTH branches").toBeGreaterThan(skipMsg);
    expect(REMOTE).toMatch(/would die in createWorker\(\)[^"]*Service NOT restarted\.?" 101/);
  });

  it("a missing worker refuses BEFORE the service is restarted", () => {
    const verify = REMOTE.lastIndexOf('if [ ! -x "$WORKER_BIN" ]');
    const restart = REMOTE.indexOf("systemctl restart");
    expect(verify).toBeLessThan(restart);
  });

  it("it honours MEDIASOUP_WORKER_BIN, because mediasoup itself does", () => {
    // An operator who placed the binary elsewhere must not be forced into a reinstall.
    expect(REMOTE).toMatch(/MEDIASOUP_WORKER_BIN:-/);
  });

  it("the payload still excludes node_modules — the worker is host-specific", () => {
    /* mediasoup fetches a prebuilt binary VALIDATED AGAINST THE HOST when one matches, and
       builds from source otherwise. Either way it belongs to the box, so shipping one built on
       a GitHub runner is how a node ends up with a binary that does not match its libc. */
    expect(voipStep()).toMatch(/tar -czf [^\n]*--exclude=node_modules/);
  });
});

/**
 * v2.106.72 — THE FOUR VALUES THE NODES ALREADY DECIDED.
 *
 * Infra's scale-out script provisions each media node with `relay-voip-agent.service` ALREADY
 * INSTALLED AND ENABLED, held dormant by `ConditionPathExists=/opt/relay-voip/agent/index.js`.
 * That makes four values a contract with a machine that exists, not a naming preference:
 *
 *     unit      relay-voip-agent.service
 *     entry     /opt/relay-voip/agent/index.js
 *     env       /etc/relay-voip/agent.env
 *     user      relayvoip
 *
 * EVERY ONE OF THEM FAILS SILENTLY WHEN WRONG, which is why they are pinned rather than left
 * to review. A mismatched entrypoint leaves the condition unsatisfied; systemd reports a clean
 * "condition failed" and the unit sits inactive — indistinguishable from a node nobody has
 * started. The repo shipped all four wrong (`agent.mjs`, `relay-voip.service`,
 * `/etc/relay-voip/env`, user `relay`), so a deploy would have landed files onto eight nodes
 * and started nothing, with a green run.
 */
describe("the agent's install contract matches the provisioned nodes", () => {
  const UNIT_PATH = path.join(ROOT, "voip-node", "relay-voip-agent.service");
  const UNIT = fs.readFileSync(UNIT_PATH, "utf8");
  const ENTRY = "/opt/relay-voip/agent/index.js";

  it("the unit runs the entrypoint the provisioned condition names", () => {
    // The three have to agree with each other or the unit is dormant forever.
    expect(UNIT).toMatch(new RegExp(`ConditionPathExists=${ENTRY}$`, "m"));
    expect(UNIT).toMatch(new RegExp(`ExecStart=/usr/bin/node ${ENTRY}$`, "m"));
    expect(UNIT).toMatch(/WorkingDirectory=\/opt\/relay-voip\/agent$/m);
  });

  it("the entrypoint the unit names is the file this repo actually ships", () => {
    /* DRIVEN, not asserted: the whole failure mode is a unit pointing at a filename nothing
       produces. `--strip-components=1` puts voip-node/<f> at $AGENT_DIR/<f>, so the basename
       of the ExecStart path must be a real file in voip-node/. */
    const m = UNIT.match(/^ExecStart=\S+ (\S+)$/m);
    expect(m, "ExecStart must name a file").toBeTruthy();
    const basename = path.basename(m![1]);
    expect(basename).toBe("index.js");
    expect(
      fs.existsSync(path.join(ROOT, "voip-node", basename)),
      `voip-node/${basename} must exist, or the unit's condition is never satisfied`,
    ).toBe(true);
    // …and `"type": "module"` is what makes a .js file ESM here, so the agent still parses.
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "voip-node", "package.json"), "utf8"));
    expect(pkg.type, "a .js entrypoint needs type:module or `import` is a syntax error").toBe(
      "module",
    );
    expect(pkg.scripts?.start, "npm start must run the same file the unit does").toContain(
      basename,
    );
  });

  it("the unit runs as the user the nodes were provisioned with", () => {
    expect(UNIT).toMatch(/^User=relayvoip$/m);
    expect(UNIT).toMatch(/^Group=relayvoip$/m);
  });

  it("the unit reads the env file the nodes were provisioned with", () => {
    expect(UNIT).toMatch(/^EnvironmentFile=\/etc\/relay-voip\/agent\.env$/m);
  });

  it("the deploy installs under the unit name the node already has enabled", () => {
    /* Installing a SECOND unit beside the enabled one is how two agents end up fighting over
       the same media ports, so the script resolves which name this node carries and writes
       there — preferring the provisioned name, falling back to the legacy one. */
    expect(REMOTE).toMatch(/^SVC=relay-voip-agent$/m);
    expect(REMOTE).toMatch(/systemctl cat relay-voip-agent/);
    expect(REMOTE).toMatch(/install -m 0644 "\$AGENT_DIR\/relay-voip-agent\.service" "\/etc\/systemd\/system\/\$SVC\.service"/);
    expect(REMOTE, "never a hardcoded unit name at the write").not.toMatch(
      /\/etc\/systemd\/system\/relay-voip(-agent)?\.service"?\s*$/m,
    );
  });

  it("the deploy writes the agent into the directory the condition watches", () => {
    expect(REMOTE).toMatch(/^AGENT_DIR=\/opt\/relay-voip\/agent$/m);
    expect(REMOTE).toMatch(/^ENTRY="\$AGENT_DIR\/index\.js"$/m);
    // The extract must land THERE, not one level up where the old layout put it.
    expect(REMOTE).toMatch(/tar -xzf \/tmp\/voip-node\.tgz -C "\$AGENT_DIR" --strip-components=1/);
  });

  it("the legacy spellings are still accepted, so an older node is not stranded", () => {
    /* This script cannot see which vintage a node is, and refusing the old names would strand
       a box over a naming difference. Accepting them is free; guessing is not. */
    expect(REMOTE, "the legacy unit").toMatch(/systemctl cat relay-voip\b/);
    expect(REMOTE, "the legacy env path").toContain("/etc/relay-voip/env");
    expect(REMOTE, "the legacy user").toMatch(/for u in relayvoip relay; do/);
  });

  it("a missing service user REFUSES rather than chowning to a user that is not there", () => {
    const at = REMOTE.indexOf('[ -n "$SVC_USER" ]');
    expect(at).toBeGreaterThan(0);
    expect(REMOTE.slice(at, at + 200)).toMatch(/fail "REFUSED[^"]*relayvoip[^"]*" 92/);
    // …and the chown uses the RESOLVED user, never a literal.
    expect(REMOTE).toMatch(/chown -R "\$SVC_USER:\$SVC_USER" "\$AGENT_DIR"/);
    expect(REMOTE, "a hardcoded chown would fail on the provisioned nodes").not.toMatch(
      /chown -R relay:relay/,
    );
  });

  it("a node with no VOIP_NODE_SECRET is told, not left crash-looping", () => {
    /* The agent's main() throws without it, and infra's provisioned agent.env does not carry
       it — so without this the eight nodes would restart every 2s with the reason in journald
       and a green deploy above it. The gate must PRECEDE the restart. */
    const gate = REMOTE.indexOf('if [ "$HAVE_ENV" != "1" ] || [ "$HAVE_SECRET" != "1" ]');
    const restart = REMOTE.indexOf("systemctl restart");
    expect(gate, "the combined env+secret gate must exist").toBeGreaterThan(0);
    expect(restart).toBeGreaterThan(gate);
    const msg = REMOTE.slice(gate, restart);
    expect(msg).toMatch(/FILES INSTALLED, SERVICE NOT STARTED/);
    expect(msg, "it must name the missing thing, not just fail").toMatch(/VOIP_NODE_SECRET/);
    expect(msg, "and say where to put it").toContain("/etc/relay-voip/agent.env");
  });

  it("the agent really does refuse without that secret — so the gate is not theatre", () => {
    // DRIVEN off the agent's own source: if this ever became optional the gate above would be
    // a pointless obstacle, and if the message named a variable the agent does not read it
    // would send an operator to the wrong line.
    const agent = fs.readFileSync(path.join(ROOT, "voip-node", "index.js"), "utf8");
    expect(agent).toMatch(/const SECRET = process\.env\.VOIP_NODE_SECRET/);
    expect(agent).toMatch(/if \(!SECRET\) throw new Error\(/);
  });
});

/**
 * v2.106.73 — THE PERMISSION THE HEADER CLAIMED AND THE ROLE DID NOT HAVE.
 *
 * The first real `voip-deploy` run selected all eight nodes correctly and then died:
 * `AccessDeniedException ... ssm:SendCommand ... because no identity-based policy allows`.
 * aws-ops.yml's header had declared that permission since v2.106.45 — a comment listing a
 * permission is not a permission.
 *
 * The grant is attached OUT-OF-BAND (inline policy `relay-voip-ssm` on relay-github-deploy,
 * tag-scoped, simulator-verified: allowed on a media node, implicitDeny on a TURN host).
 *
 * A `voip-grant-ssm` ACTION was written and then DELETED before it shipped, and the reason is
 * worth keeping: a self-granting step needs either `iam:PutRolePolicy` on the role itself —
 * which makes the deploy role account administrator, reachable by anyone who can merge to
 * `main` — or IAM-write on the app INSTANCE role, a standing escalation door on production web
 * servers. `iam-grant-ses` does the second as a fallback; that is an older expedient, not a
 * pattern to copy, and the app instances do not in fact hold that power. So the rule this file
 * enforces is simply that no action here grants IAM to itself.
 */
describe("no action in aws-ops grants IAM to the role that runs it", () => {
  it("voip-deploy carries no IAM write of any kind", () => {
    const step = voipStep();
    for (const verb of ["put-role-policy", "attach-role-policy", "put-user-policy", "create-policy"]) {
      expect(step, `voip-deploy must never call iam ${verb}`).not.toContain(verb);
    }
  });

  it("the retired self-grant action is really gone, not merely unreferenced", () => {
    // Half-removing it — dropping the option while leaving the step — would leave a
    // dispatchable-by-hand IAM granter in the file with nothing pointing at it.
    expect(OPS, "no step").not.toContain("voip-grant-ssm");
    expect(OPS, "and no option").not.toMatch(/options: \[[^\]]*voip-grant-ssm/);
  });

  it("the header says the grant is attached out-of-band, and why there is no action for it", () => {
    /* Without this the next reader sees a documented permission with no way to obtain it and
       writes the self-granting step again — which is exactly how the escalation door gets
       reopened by somebody being helpful. */
    const hdr = OPS.slice(0, OPS.indexOf("on:\n  workflow_dispatch"));
    expect(hdr).toMatch(/relay-voip-ssm/);
    expect(hdr).toMatch(/OUT-OF-BAND/);
    expect(hdr).toMatch(/account administrator|escalation door/);
  });

  it("the ONE pre-existing self-grant is named as an expedient, so it is not read as a pattern", () => {
    // iam-grant-ses still exists and still does this. It is not being removed here — that is
    // the owner's call on a live SES path — but it must not read as the house style.
    expect(OPS).toContain("iam-grant-ses");
    expect(OPS).toMatch(/`iam-grant-ses` is an older\n#                expedient and not a pattern to copy/);
  });
});

describe("a FIRST apply reuses the pre-built worker instead of recompiling", () => {
  it("a manifest appearing where there was none does not count as a dependency change", () => {
    /* FOUND BY THE FIRST DRY RUN, in my own v2.106.72 gate. On a fresh node $AGENT_DIR holds
       no package.json, so DEPS_BEFORE is the hash of nothing and DEPS_AFTER is the hash of
       ours — "changed" by construction, on EVERY first apply. The install would therefore run
       on all eight nodes and recompile mediasoup, ~2 minutes each, defeating the pre-built
       worker the reuse path exists for and pushing a sequential 8-node rollout past the poll
       budget. HAD_MANIFEST is what tells a first apply apart from an update. */
    expect(REMOTE).toMatch(/HAD_MANIFEST=0/);
    expect(REMOTE).toMatch(/\[ -f "\$AGENT_DIR\/package\.json" \] && HAD_MANIFEST=1/);
    // It must be read BEFORE the extract, or it is always 1 and the fix is inert.
    expect(REMOTE.indexOf("HAD_MANIFEST=1")).toBeLessThan(REMOTE.indexOf("tar -xzf"));
    // ANCHORED ON HAD_MANIFEST, which only the install gate carries: `if [ -z "$WORKER_BIN" ]`
    // also opens the worker-RESOLUTION block twelve lines earlier, and anchoring there read
    // that line instead — a false failure on correct source.
    const gate = REMOTE.split("\n").find((l) => l.includes('"$HAD_MANIFEST"'));
    expect(gate, "the install gate must exist").toBeTruthy();
    expect(gate!, "a fingerprint change only counts when there WAS a manifest").toContain(
      '[ "$HAD_MANIFEST" = "1" ] && [ "$DEPS_BEFORE" != "$DEPS_AFTER" ]',
    );
    // A missing or unusable worker must still force the install, whatever the manifest says.
    expect(gate!).toContain('[ -z "$WORKER_BIN" ]');
    expect(gate!).toContain('[ ! -x "$WORKER_BIN" ]');
  });

  it("the unit line prints ONE state, not the answer and its fallback", () => {
    /* `systemctl is-active` PRINTS its answer and EXITS non-zero for anything but active, so
       an `|| echo absent` fallback fires alongside the real word — the first dry run reported
       "inactive / absent / enabled" on all eight nodes. */
    const line = REMOTE.split("\n").find((l) => l.startsWith('echo "unit: $SVC'));
    expect(line, "the unit line must exist").toBeTruthy();
    expect(line!, "no second word on the failure path").not.toMatch(/\|\| echo (absent|not-enabled)/);
    expect(line!).toMatch(/systemctl is-active "\$SVC" 2>\/dev\/null \|\| true/);
  });

  it("the poll budget outlasts a sequential eight-node compile", () => {
    /* --max-concurrency 1 makes this SEQUENTIAL. Eight nodes each needing a ~2-minute compile
       outruns a 20-minute poll, and giving up early reports a FAILURE for a deploy that is
       still running — on the one run where that is most expensive. */
    const step = voipStep();
    const m = step.match(/for i in \$\(seq 1 (\d+)\); do\n\s*S=\$\(aws ssm list-command-invocations/);
    expect(m, "the poll loop must exist").toBeTruthy();
    expect(Number(m![1]) * 10, "seconds of poll budget").toBeGreaterThanOrEqual(2400);
  });
});

describe("voip-deploy reads the whole output, not a truncated prefix", () => {
  it("the verdict is read from GetCommandInvocation, which does not truncate at 2,500", () => {
    /* ListCommandInvocations truncates inline output at roughly 2,500 characters and
       GetCommandInvocation returns roughly 24,000. `VOIP_EXIT=` is the LAST line
       deploy-remote.sh prints, so on a first install — which compiles the mediasoup worker and
       prints pages — the marker is exactly what gets cut off, and every node reports failure
       over a perfectly good deploy. */
    const step = voipStep();
    expect(step).toMatch(/aws ssm get-command-invocation --command-id "\$CMD" --instance-id "\$IID"/);
    expect(step).toMatch(/StandardOutputContent/);
    // The fallback keeps a role with only the older permission working.
    const at = step.indexOf("get-command-invocation");
    expect(step.slice(at, at + 600)).toMatch(/if \[ -z "\$OUT" \][\s\S]{0,300}list-command-invocations/);
  });

  it("the displayed excerpt includes the END, where the verdict is", () => {
    // A head-only view of a long install shows everything except the part that matters.
    const step = voipStep();
    expect(step).toMatch(/head -c 3000/);
    expect(step).toMatch(/tail -c 2000/);
  });

  it("the grep for the marker runs on the FULL output, never the excerpt", () => {
    const step = voipStep();
    expect(step).toMatch(/echo "\$OUT" \| grep -q "VOIP_EXIT=0"/);
  });
});

describe("the reuse gate proves EVERY dependency, not just the expensive one", () => {
  /* THE DEFECT THIS PINS COST TWO OF EIGHT NODES ON THE FIRST REAL APPLY (2026-08-01).
     The gate keyed the whole skip decision on the mediasoup WORKER BINARY, and read "a
     usable worker is present" as "dependencies are satisfied". They are different claims:
     the agent also imports `ioredis`, and infra's pre-provisioned
     /opt/relay-voip/node_modules is NOT uniform — six nodes had it, two did not. Those two
     skipped the install, started, and died at import with ERR_MODULE_NOT_FOUND, crash-looping
     on Restart=always. This is v2.106.47 one dependency along: there a DIRECTORY test passed
     over a blocked build; here a BINARY test passed over a missing sibling package. */

  it("resolves every name in the manifest the way Node will, from the agent's own directory", () => {
    const sh = REMOTE;
    expect(sh).toMatch(/DEP_NAMES=.*Object\.keys\(p\.dependencies/);
    // createRequire(...).resolve walks node_modules upward exactly as the ESM loader does
    // for a bare specifier — and does NOT execute the package, which importing it would.
    expect(sh).toMatch(/createRequire\('\$AGENT_DIR\/index\.js'\)\.resolve\('\$dep'\)/);
    expect(sh).toMatch(/for dep in \$DEP_NAMES/);
  });

  it("an unresolvable dependency FORCES the install", () => {
    const sh = REMOTE;
    // The flag must be a conjunct of the gate, not merely computed and discarded.
    expect(sh).toMatch(
      /if \[ -z "\$WORKER_BIN" \][\s\S]{0,160}\[ "\$DEPS_RESOLVE" != "1" \][\s\S]{0,160}then/
    );
  });

  it("fails TOWARD installing — an unreadable manifest forces it too", () => {
    // The opposite default is what produced a crash-looping node reported as deployed.
    const sh = REMOTE;
    expect(sh).toMatch(/\[ -n "\$DEP_NAMES" \] \|\|[\s\S]{0,120}DEPS_RESOLVE=0/);
  });

  it("the check runs BEFORE the gate, or the flag it sets is never read", () => {
    const sh = REMOTE;
    const setAt = sh.indexOf("DEPS_RESOLVE=1");
    const gateAt = sh.indexOf('[ "$DEPS_RESOLVE" != "1" ]');
    expect(setAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(-1);
    expect(setAt).toBeLessThan(gateAt);
  });
});

describe("the install picks a runner explicitly and refuses loudly with none", () => {
  /* Every node in the fleet reports `pnpm: MISSING`, so the fallback is the ONLY path on
     the nodes that actually need an install — it is not hypothetical. */

  it("tries pnpm, then corepack, and REFUSES rather than half-installing", () => {
    const sh = REMOTE;
    expect(sh).toMatch(/if command -v pnpm[\s\S]{0,120}elif command -v corepack[\s\S]{0,80}fi/);
    expect(sh).toMatch(/\[ -n "\$PNPM" \] \|\| fail "REFUSED: neither pnpm nor corepack/);
  });

  it("the agent manifest pins packageManager, or corepack refuses to guess a version", () => {
    // Without it corepack errors mid-deploy asking which version to use — on exactly the
    // nodes that need the install, which is the worst possible place to discover it.
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "voip-node", "package.json"), "utf8")
    );
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+/);
    // And the dependency set is exactly what the resolution check will walk.
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["ioredis", "mediasoup"]);
  });
});
