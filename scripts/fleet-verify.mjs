#!/usr/bin/env node
/**
 * Run the in-fleet verification on EVERY app instance, and compare them.
 *
 * WHAT WAS WRONG WITH DOING IT IN THE WORKFLOW
 * -------------------------------------------
 * The first version (v2.105.2) picked ONE instance —
 * `sort_by(Reservations[].Instances[],&LaunchTime)[0]` — and then read ONE
 * invocation, `CommandInvocations[0]`. Both are the same mistake: this fleet runs
 * two app instances, and the failures an in-fleet probe exists to catch are
 * precisely the per-box ones — a release that extracted on one host and not the
 * other, a pm2 process that never reloaded, an env var set on one box, an
 * instance quietly out of the load balancer. Probing one box finds those half the
 * time, and the runner-side probe cannot help because the ALB round-robins: it
 * may well hit the healthy one. So this fans out to all of them.
 *
 * COMPARING THE INSTANCES IS A CHECK IN ITSELF, and it is the one no single probe
 * can perform. Two boxes serving DIFFERENT versions is a real, visible condition
 * — the auto-updater compares the client's baked version against the server's
 * runtime one, so a split fleet makes the refresh prompt flap for everybody — and
 * `cluster`/`redisBus` differing between hosts means cross-instance calling is
 * broken for whoever lands on the wrong one (the v2.94.4 bug, where RELAY_CLUSTER
 * simply was not set). Neither is visible from inside one instance.
 *
 * WHY A SCRIPT AND NOT MORE YAML
 * ------------------------------
 * The aggregation has real logic in it — parsing per-instance reports, deciding
 * what counts as divergence, attributing a failure to a host. In YAML none of
 * that can be tested, which is how `CommandInvocations[0]` survived review. Every
 * AWS call goes through an injected `run`, so the whole thing is driven in tests
 * with recorded output and no AWS account.
 *
 * READ-ONLY. The only AWS verbs are describe-* and ssm send-command plus reading
 * its result. Nothing on the instance is written; the checks it runs there are
 * themselves read-only.
 *
 *   node scripts/fleet-verify.mjs                          # every app instance
 *   node scripts/fleet-verify.mjs --email me@example.com   # + prove mail delivery
 *   node scripts/fleet-verify.mjs --json
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

/** Default AWS runner. Injected in tests, so no call here ever needs an account. */
export function awsRunner() {
  return (args) =>
    new Promise((resolve) => {
      execFile("aws", args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: String(stdout || ""), stderr: String(stderr || "") });
      });
    });
}

/* ── the remote command ────────────────────────────────────────────────────
   Built in ONE place, and exported, because it is a string executed on
   production EC2 with values that came from a workflow input. This file has been
   bitten three times by an unescaped input reaching a remote shell
   (SES_EMAIL/DOMAIN, then `region`, then the recovery inputs), so the values are
   base64 on the way in and decoded only on the instance — and being a function
   means the construction can be replayed against hostile input in a test rather
   than reasoned about. */
export function buildRemoteCommand({ numberB64 = "", emailB64 = "", send = false } = {}) {
  const parts = [
    // `cd` first: every script path below is relative to the release root, and
    // the fallback keeps a half-extracted release from silently running nothing.
    "cd /home/relay/app 2>/dev/null || cd /home/relay",
    // The fleet env holds PORT, the SMTP credentials and DATABASE_URL. Nothing
    // from it is printed.
    "set -a; . /home/relay/.env 2>/dev/null; set +a",
    `N=$(echo ${numberB64} | base64 -d)`,
    /* THE VERSION AND BYTE CHECKS ARE ABOUT THIS BOX SPECIFICALLY. The script
       resolves its own root, which on an instance is the DEPLOYED tree — so
       comparing /api/version against that tree's shared/version.ts proves the
       running process matches the release that was extracted here, and comparing
       the served assets against this box's own dist/ proves it is serving them
       rather than a stale copy. Neither is answerable from outside. */
    'node scripts/live-verify.mjs --base http://127.0.0.1:${PORT:-3000} ${N:+--number $N}',
  ];
  if (emailB64) {
    // Mail runs HERE and nowhere else: the SMTP credentials exist only in
    // /home/relay/.env. It stops before DATA unless --send, so the default
    // costs the recipient nothing.
    parts.push(`node scripts/mail-verify.mjs --to "$(echo ${emailB64} | base64 -d)"${send ? " --send" : ""}`);
  }
  /* INSTANCE-LOCAL FACTS THE APPLICATION CANNOT SELF-REPORT. A box that is
     crash-looping answers /api/health perfectly in between restarts, and a full
     disk is the classic reason a deploy "succeeded" without extracting. Both are
     printed as FACT_ lines and parsed below; every one is `|| true` so a missing
     tool degrades to "unknown" instead of failing a verification run. */
  parts.push('echo "FACT_UPTIME=$(cat /proc/uptime 2>/dev/null | cut -d" " -f1)"');
  parts.push('echo "FACT_DISKFREE=$(df -Pk /home/relay 2>/dev/null | awk \'NR==2{print $4}\')"');
  parts.push(
    'echo "FACT_PM2=$(sudo -u relay bash -lc \'pm2 jlist\' 2>/dev/null ' +
      '| node -e \'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const l=JSON.parse(s);' +
      'console.log(l.map(p=>p.name+":restarts="+(p.pm2_env&&p.pm2_env.restart_time)+",status="+(p.pm2_env&&p.pm2_env.status)).join(";"))}catch{console.log("")}})\' ' +
      "|| true)\"",
  );
  return parts.join("; ") + ";";
}

/* ── parsing one instance's report ─────────────────────────────────────────── */

/** Pull the facts this aggregation reasons about out of one instance's stdout. */
export function parseInstanceReport(text) {
  const s = String(text || "");
  const grab = (re) => {
    const m = re.exec(s);
    return m ? m[1] : null;
  };
  const exitOf = (marker) => {
    // LAST occurrence wins: the marker is printed after the run, and a retried
    // command could contain more than one.
    const all = [...s.matchAll(new RegExp(`${marker}=(\\d+)`, "g"))];
    return all.length ? Number(all[all.length - 1][1]) : null;
  };
  /* PARSED BY COLUMN, not by "two or more spaces".
     live-verify prints `"  " + verdict.padEnd(5) + " " + name.padEnd(24) + " " + note`,
     so a check whose name is exactly 24 characters long is followed by ONE space
     — and a two-space rule silently failed to parse it. That was not
     hypothetical: `arabic parity rules live` is exactly 24 characters, i.e. the
     one check this whole exercise exists to verify was the one that could not be
     read. The column offsets come from that format and are pinned in the test. */
  const NAME_AT = 8;
  const NOTE_AT = 33;
  const checks = {};
  for (const line of s.split("\n")) {
    const m = /^ {2}(PASS|FAIL|SKIP) /.exec(line);
    if (!m) continue;
    const name = line.slice(NAME_AT, NOTE_AT).trim();
    if (!name) continue;
    checks[name] = { verdict: m[1], note: line.slice(NOTE_AT).trim() };
  }
  return {
    version: grab(/live (\d+\.\d+\.\d+) === shared\/version\.ts/),
    // `health` prints these as `redisBus true · cluster true`.
    redisBus: grab(/redisBus (true|false)/),
    cluster: grab(/cluster (true|false)/),
    instanceTag: grab(/instance ([0-9a-f]{4,})/),
    assetsNote: checks["assets === local build"]?.note ?? null,
    checks,
    liveExit: exitOf("LIVE_VERIFY_EXIT"),
    mailExit: exitOf("MAIL_VERIFY_EXIT"),
    uptimeSec: Number(grab(/FACT_UPTIME=([\d.]+)/)) || null,
    diskFreeKb: Number(grab(/FACT_DISKFREE=(\d+)/)) || null,
    pm2: grab(/FACT_PM2=(.*)/),
  };
}

/** pm2's `restarts=N,status=S` string → the fields worth a finding. */
export function parsePm2(fact) {
  const out = [];
  for (const part of String(fact || "").split(";")) {
    const m = /^([^:]+):restarts=(\d+|undefined),status=(\S+)$/.exec(part.trim());
    if (m) out.push({ name: m[1], restarts: m[2] === "undefined" ? null : Number(m[2]), status: m[3] });
  }
  return out;
}

/* ── fleet-level findings ──────────────────────────────────────────────────── */

/**
 * What can only be seen by comparing instances. Pure, so the interesting cases
 * (a split fleet, one box out of the load balancer, one crash-looping) are driven
 * directly in tests rather than waited for in production.
 */
export function aggregate(reports, opts = {}) {
  const findings = [];
  const add = (severity, name, detail) => findings.push({ severity, name, detail });
  const live = reports.filter((r) => r.report);

  if (live.length === 0) {
    add("fail", "no instance reported", "every SSM invocation failed or timed out");
    return { findings, ok: false };
  }

  // Per-instance verdicts first, attributed — an unattributed failure in a fleet
  // is a failure nobody can act on.
  for (const r of live) {
    if (r.report.liveExit !== 0) {
      const bad = Object.entries(r.report.checks)
        .filter(([, v]) => v.verdict === "FAIL")
        .map(([k, v]) => `${k}: ${v.note}`);
      add("fail", `${r.id} failed its own checks`, bad.length ? bad.join("; ") : "no FAIL line found — see its output");
    }
    if (r.report.mailExit != null && r.report.mailExit !== 0) {
      add("fail", `${r.id} cannot deliver mail`, r.report.checks["rcpt to"]?.note ?? "see its output");
    }
  }

  /* A SPLIT FLEET. Two boxes on different versions is visible to users: the
     auto-updater compares the client's baked version against the server's runtime
     one, so whichever instance a poll lands on decides whether a refresh prompt
     appears — it flaps. Normal for the ~60s of a rolling deploy, which is why the
     detail says so rather than pretending it is always broken. */
  const versions = [...new Set(live.map((r) => r.report.version).filter(Boolean))];
  if (versions.length > 1) {
    add(
      "fail",
      "the fleet is serving more than one version",
      `${versions.join(" vs ")} — expected during a rolling deploy, a problem if it persists: ` +
        live.map((r) => `${r.id}=${r.report.version ?? "?"}`).join(", "),
    );
  } else if (versions.length === 1) {
    add("info", "every instance serves the same version", versions[0]);
  }

  /* CONFIGURATION DIVERGENCE. `cluster`/`redisBus` off on one box means
     cross-instance calling is broken for whoever lands on it — and that is
     exactly the v2.94.4 bug, where RELAY_CLUSTER was simply never set on the
     hosts. Invisible from inside any one instance. */
  for (const key of ["cluster", "redisBus"]) {
    const vals = [...new Set(live.map((r) => r.report[key]).filter((v) => v != null))];
    if (vals.length > 1) {
      add(
        "fail",
        `${key} differs between instances`,
        live.map((r) => `${r.id}=${r.report[key]}`).join(", ") +
          " — a caller on the wrong box cannot reach one on the other",
      );
    }
  }

  /* THE SERVED BYTES MUST MATCH EACH BOX'S OWN RELEASE. A skip here is honest
     (no dist on that host) but must not read as a pass. */
  for (const r of live) {
    const c = r.report.checks["assets === local build"];
    if (c && c.verdict === "SKIP") {
      add("warn", `${r.id} could not compare its served bytes`, c.note);
    }
  }

  // Crash-looping and disk, per instance.
  const restartCap = opts.restartCap ?? 20;
  /**
   * RESTARTS ARE JUDGED BY RATE, NOT BY COUNT (v2.105.10).
   *
   * The absolute cap of 20 was calibrated for crash-loop detection and this fleet trips
   * it on deploy cadence alone: pm2 restarts once per release, so the counter ticks +1
   * per box per deploy and reached 46/47 with `status=online` on both and ~8.4 days of
   * uptime. That is one restart per ~4.3 hours — the release schedule, not a fault — and
   * a WARN there is a false alarm, which is the thing that hides a real one.
   *
   * A genuine crash loop is not a bigger number, it is a different RATE: pm2 restarts
   * within seconds and backs off, so over eight days it would show thousands. One per
   * hour sustained is already an order of magnitude above any plausible deploy cadence
   * and two below a loop, so that is the line.
   *
   * The window is HOST uptime, which is the only clock the report carries. If pm2 were
   * started before the counter's own epoch the rate would read HIGH, which is the
   * fail-loud direction. With no uptime the rate cannot be computed at all, so the
   * absolute cap stands — today's behaviour rather than silence.
   */
  const restartsPerDayCap = opts.restartsPerDayCap ?? 24;
  /** Below this, the window is too short to divide by: a box up two minutes after a
   *  reboot would turn one ordinary restart into a screaming rate. */
  const restartRateMinWindowSec = 3600;
  const diskFloorKb = opts.diskFloorKb ?? 512 * 1024; // 512 MB
  for (const r of live) {
    for (const proc of parsePm2(r.report.pm2)) {
      if (proc.status && proc.status !== "online") {
        add("fail", `${r.id} pm2 process not online`, `${proc.name} is ${proc.status}`);
      }
      if (proc.restarts != null && proc.restarts >= restartCap) {
        // A box that restarts constantly answers health perfectly in between — which is
        // why this is checked at all — but the count alone cannot tell a crash loop from
        // a deploy history. Divide by the window.
        const up = r.report.uptimeSec;
        const rate =
          up != null && up >= restartRateMinWindowSec ? proc.restarts / (up / 86400) : null;
        if (rate == null) {
          add(
            "warn",
            `${r.id} has restarted a lot`,
            `${proc.name} restart_time=${proc.restarts} (uptime unknown, so the rate could not be checked)`,
          );
        } else if (rate >= restartsPerDayCap) {
          add(
            "warn",
            `${r.id} is restarting faster than deploys explain`,
            `${proc.name} restart_time=${proc.restarts} over ${(up / 86400).toFixed(1)}d = ${rate.toFixed(1)}/day`,
          );
        } else {
          // Reported, not hidden: an operator looking at a count in the forties should
          // be able to see that it was accounted for rather than wonder why nothing said
          // anything about it.
          add(
            "info",
            `${r.id} restart count is deploy cadence, not a loop`,
            `${proc.name} restart_time=${proc.restarts} over ${(up / 86400).toFixed(1)}d = ${rate.toFixed(1)}/day, status=${proc.status ?? "?"}`,
          );
        }
      }
    }
    if (r.report.diskFreeKb != null && r.report.diskFreeKb < diskFloorKb) {
      add("warn", `${r.id} is low on disk`, `${Math.round(r.report.diskFreeKb / 1024)} MB free under /home/relay`);
    }
  }

  // Load-balancer membership, when the caller could read it.
  for (const r of live) {
    if (r.targetHealth == null) continue;
    if (r.targetHealth !== "healthy") {
      add(
        "fail",
        `${r.id} is not healthy in the load balancer`,
        `target state "${r.targetHealth}" — it can serve perfectly and still receive no traffic`,
      );
    }
  }
  for (const r of reports.filter((x) => !x.report)) {
    add("fail", `${r.id} did not report`, r.error || "no output");
  }

  return { findings, ok: !findings.some((f) => f.severity === "fail") };
}

/* ── AWS plumbing ─────────────────────────────────────────────────────────── */

export async function discoverInstances(run, tag = "relay-app") {
  const r = await run([
    "ec2", "describe-instances",
    "--filters", `Name=tag:Name,Values=${tag}`, "Name=instance-state-name,Values=running",
    "--query", "Reservations[].Instances[].{id:InstanceId,az:Placement.AvailabilityZone,ip:PrivateIpAddress}",
    "--output", "json",
  ]);
  if (!r.ok) return [];
  try {
    const list = JSON.parse(r.stdout || "[]");
    return Array.isArray(list) ? list.filter((i) => i && i.id) : [];
  } catch {
    return [];
  }
}

/** Target-group health per instance id. Degrades to an empty map when the caller
 *  lacks the permission — a missing reading must not become a false finding. */
export async function targetHealthByInstance(run) {
  const tg = await run(["elbv2", "describe-target-groups", "--query", "TargetGroups[].TargetGroupArn", "--output", "json"]);
  if (!tg.ok) return {};
  let arns = [];
  try {
    arns = JSON.parse(tg.stdout || "[]");
  } catch {
    return {};
  }
  const out = {};
  for (const arn of arns) {
    const h = await run([
      "elbv2", "describe-target-health", "--target-group-arn", arn,
      "--query", "TargetHealthDescriptions[].{id:Target.Id,state:TargetHealth.State}", "--output", "json",
    ]);
    if (!h.ok) continue;
    try {
      for (const d of JSON.parse(h.stdout || "[]")) {
        if (!d || !d.id) continue;
        // healthy anywhere counts as in service: an instance legitimately sits in
        // more than one target group (the /api/relay/* signaling group pins one
        // instance, so the other is deliberately absent from it).
        if (out[d.id] !== "healthy") out[d.id] = d.state;
      }
    } catch {
      /* ignore a malformed page */
    }
  }
  return out;
}

export async function sendToAll(run, ids, command, { pollMs = 5000, tries = 36, sleep } = {}) {
  const nap = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const params = JSON.stringify({ commands: [command] });
  const sent = await run([
    "ssm", "send-command",
    "--instance-ids", ...ids,
    "--document-name", "AWS-RunShellScript",
    // Every instance, in parallel, and a failure on one must not stop the others
    // being reported — this is a read-only status sweep, not a mutation.
    "--max-concurrency", "100%", "--max-errors", "100%",
    "--parameters", params,
    "--query", "Command.CommandId", "--output", "text",
  ]);
  if (!sent.ok) return { error: sent.stderr.trim() || "send-command failed", perInstance: [] };
  const cmdId = sent.stdout.trim();
  if (!cmdId) return { error: "send-command returned no CommandId", perInstance: [] };

  for (let i = 0; i < tries; i++) {
    const st = await run([
      "ssm", "list-command-invocations", "--command-id", cmdId,
      "--query", "CommandInvocations[].Status", "--output", "text",
    ]);
    const s = st.ok ? st.stdout : "";
    if (s && !/InProgress|Pending|Delayed/.test(s)) break;
    await nap(pollMs);
  }

  /* EVERY invocation, keyed by instance. The first version read
     `CommandInvocations[0]` — one arbitrary box — so a failure on the other was
     invisible and a pass was attributed to a host that may not have produced it. */
  const inv = await run([
    "ssm", "list-command-invocations", "--command-id", cmdId, "--details",
    "--query", "CommandInvocations[].{id:InstanceId,status:Status,out:CommandPlugins[0].Output}",
    "--output", "json",
  ]);
  if (!inv.ok) return { error: "could not read the invocations", perInstance: [], commandId: cmdId };
  let rows = [];
  try {
    rows = JSON.parse(inv.stdout || "[]");
  } catch {
    return { error: "invocation output was not JSON", perInstance: [], commandId: cmdId };
  }
  return { commandId: cmdId, perInstance: Array.isArray(rows) ? rows : [] };
}

/** The whole sweep, pure enough to drive with a fake `run`. */
export async function verifyFleet(run, opts = {}) {
  const instances = await discoverInstances(run, opts.tag);
  if (instances.length === 0) return { instances: [], reports: [], ...aggregate([]) };
  const health = opts.skipTargetHealth ? {} : await targetHealthByInstance(run);
  const command = buildRemoteCommand(opts);
  const sent = await sendToAll(run, instances.map((i) => i.id), command, opts);
  const byId = new Map(sent.perInstance.map((p) => [p.id, p]));
  const reports = instances.map((i) => {
    const p = byId.get(i.id);
    const out = p && p.out ? String(p.out) : "";
    return {
      id: i.id,
      az: i.az ?? null,
      status: p?.status ?? "no invocation",
      raw: out,
      report: out ? parseInstanceReport(out) : null,
      error: out ? null : sent.error || p?.status || "no output",
      targetHealth: Object.prototype.hasOwnProperty.call(health, i.id) ? health[i.id] : null,
    };
  });
  return { instances, reports, commandId: sent.commandId ?? null, ...aggregate(reports, opts) };
}

/* ── main ─────────────────────────────────────────────────────────────────── */
const IS_MAIN =
  !!process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (IS_MAIN) {
  const b64 = (v) => (v ? Buffer.from(v, "utf8").toString("base64") : "");
  const res = await verifyFleet(awsRunner(), {
    numberB64: b64(flag("number", "")),
    emailB64: b64(flag("email", "")),
    send: has("send"),
  });

  if (has("json")) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(`FLEET VERIFY — ${res.instances.length} running app instance(s)\n`);
    for (const r of res.reports) {
      console.log(`── ${r.id}${r.az ? ` (${r.az})` : ""} — ${r.status}${r.targetHealth ? ` · LB ${r.targetHealth}` : ""}`);
      console.log(r.raw ? r.raw.trimEnd().split("\n").map((l) => "   " + l).join("\n") : `   (no output: ${r.error})`);
      console.log("");
    }
    console.log("=== fleet findings ===");
    if (res.findings.length === 0) console.log("  (nothing to report)");
    for (const f of res.findings) {
      console.log(`  ${f.severity.toUpperCase().padEnd(4)} ${f.name}${f.detail ? " — " + f.detail : ""}`);
    }
  }

  // Printed so the caller reads the verdict from THIS script rather than from a
  // wrapper's status, which a pipeline can mask (v2.99.46).
  console.log(`FLEET_VERIFY_EXIT=${res.ok ? 0 : 1}`);
  process.exit(res.ok ? 0 : 1);
}
