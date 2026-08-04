/**
 * The fleet sweep is driven end-to-end here with a FAKE aws runner.
 *
 * That is the point of it being a script rather than YAML: the interesting
 * conditions — a split fleet mid-deploy, one box out of the load balancer, one
 * crash-looping, one that never answered — are all things you would otherwise
 * have to wait for in production, and the previous version's real defect (reading
 * `CommandInvocations[0]`, i.e. one arbitrary instance) survived precisely because
 * it lived in shell where nothing could exercise it.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
// @ts-expect-error — plain .mjs by design: it runs under bare `node` on a runner.
import {
  buildRemoteCommand,
  parseInstanceReport,
  parsePm2,
  aggregate,
  discoverInstances,
  targetHealthByInstance,
  sendToAll,
  verifyFleet,
} from "../scripts/fleet-verify.mjs";

type Run = (args: string[]) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

/** A healthy instance's stdout, in the shape live-verify actually prints. */
function report(opts: {
  version?: string;
  cluster?: boolean;
  redisBus?: boolean;
  liveExit?: number;
  mailExit?: number | null;
  assets?: "PASS" | "SKIP";
  pm2?: string;
  diskKb?: number;
  extraFail?: string;
  /** Host uptime in seconds. The restart check divides by it (v2.105.10), so a case
   *  about restart RATE has to be able to set the window. */
  uptimeSec?: number | null;
} = {}) {
  const {
    version = "2.105.4",
    cluster = true,
    redisBus = true,
    liveExit = 0,
    mailExit = null,
    assets = "PASS",
    pm2 = "relay:restarts=2,status=online",
    diskKb = 8_000_000,
    extraFail,
    uptimeSec = 100234.5,
  } = opts;
  const lines = [
    "LIVE VERIFY — http://127.0.0.1:3000",
    "",
    `  PASS  version                  live ${version} === shared/version.ts`,
    `  PASS  health                   instance f506e322 · redisBus ${redisBus} · cluster ${cluster} · signalingPinned false`,
    "  PASS  index.html               6145 bytes, #root present, no placeholder leak",
    assets === "PASS"
      ? "  PASS  assets === local build   3 asset(s) byte-identical to this tree's build"
      : "  SKIP  assets === local build   dist/public/assets absent (run `pnpm build` first) — cannot compare bytes",
    "  PASS  arabic parity rules live Arabic face + RTL override + LTR islands all served",
  ];
  if (extraFail) {
    // The REAL format: two spaces, verdict padded to 5, a space, name padded to
    // 24, a space, then the note. Approximating it is how a parser comes to pass
    // a test and fail on production output.
    const [nm, ...rest] = extraFail.split("|");
    lines.push(`  ${"FAIL".padEnd(5)} ${nm.padEnd(24)} ${rest.join("|")}`);
  }
  lines.push("", `LIVE_VERIFY_EXIT=${liveExit}`);
  if (mailExit != null) {
    lines.push("MAIL VERIFY", "  PASS  rcpt to     <a@b> accepted (250)", `MAIL_VERIFY_EXIT=${mailExit}`);
  }
  lines.push(
    uptimeSec == null ? `FACT_UPTIME=` : `FACT_UPTIME=${uptimeSec}`,
    `FACT_DISKFREE=${diskKb}`,
    `FACT_PM2=${pm2}`,
  );
  return lines.join("\n");
}

/** A fake aws that answers each verb from a fixture. */
function fakeAws(cfg: {
  instances?: Array<{ id: string; az?: string }>;
  outputs?: Record<string, string>;
  statuses?: Record<string, string>;
  targetHealth?: Record<string, string>;
  sendFails?: boolean;
  denyElbv2?: boolean;
  omitInvocationFor?: string[];
}): { run: Run; calls: string[][] } {
  const calls: string[][] = [];
  const run: Run = async (args) => {
    calls.push(args);
    const j = (v: unknown) => ({ ok: true, stdout: JSON.stringify(v), stderr: "" });
    if (args[0] === "ec2") {
      return j((cfg.instances ?? []).map((i) => ({ id: i.id, az: i.az ?? "ap-south-1a", ip: "10.0.0.1" })));
    }
    if (args[0] === "elbv2" && args[1] === "describe-target-groups") {
      if (cfg.denyElbv2) return { ok: false, stdout: "", stderr: "AccessDenied" };
      return j(["arn:tg/1"]);
    }
    if (args[0] === "elbv2" && args[1] === "describe-target-health") {
      return j(Object.entries(cfg.targetHealth ?? {}).map(([id, state]) => ({ id, state })));
    }
    if (args[0] === "ssm" && args[1] === "send-command") {
      if (cfg.sendFails) return { ok: false, stdout: "", stderr: "InvalidInstanceId" };
      return { ok: true, stdout: "cmd-1\n", stderr: "" };
    }
    if (args[0] === "ssm" && args.includes("CommandInvocations[].Status")) {
      return { ok: true, stdout: "Success\tSuccess\n", stderr: "" };
    }
    if (args[0] === "ssm") {
      const rows = (cfg.instances ?? [])
        .filter((i) => !(cfg.omitInvocationFor ?? []).includes(i.id))
        .map((i) => ({
          id: i.id,
          status: cfg.statuses?.[i.id] ?? "Success",
          out: cfg.outputs?.[i.id] ?? report(),
        }));
      return j(rows);
    }
    return { ok: false, stdout: "", stderr: "unexpected verb" };
  };
  return { run, calls };
}

const noSleep = () => Promise.resolve();

/* ── the remote command ───────────────────────────────────────────────────── */

describe("buildRemoteCommand", () => {
  it("sources the fleet env and probes the app's own port", () => {
    const c = buildRemoteCommand();
    expect(c).toMatch(/cd \/home\/relay\/app 2>\/dev\/null \|\| cd \/home\/relay/);
    expect(c).toMatch(/\. \/home\/relay\/\.env/);
    expect(c).toMatch(/--base http:\/\/127\.0\.0\.1:\$\{PORT:-3000\}/);
  });

  it("omits the mail check entirely when no address was given", () => {
    // The default must cost a recipient nothing, so the command should not even
    // mention the mailer.
    expect(buildRemoteCommand()).not.toMatch(/mail-verify/);
    expect(buildRemoteCommand({ emailB64: "eA==" })).toMatch(/mail-verify\.mjs --to/);
  });

  it("only sends real mail behind --send", () => {
    expect(buildRemoteCommand({ emailB64: "eA==" })).not.toMatch(/--send/);
    expect(buildRemoteCommand({ emailB64: "eA==", send: true })).toMatch(/--send/);
  });

  it("interpolates only base64, never a raw input value", () => {
    // The established defence: this string runs on production EC2.
    const c = buildRemoteCommand({ numberB64: "Nzc3Nzc3", emailB64: "YUB4LmNvbQ==" });
    expect(c).toMatch(/N=\$\(echo Nzc3Nzc3 \| base64 -d\)/);
    expect(c).toMatch(/echo YUB4LmNvbQ== \| base64 -d/);
    expect(c).not.toMatch(/777777/);
    expect(c).not.toMatch(/a@x\.com/);
  });

  it("survives hostile input as ONE literal argument", () => {
    // Proven by construction rather than argued: every payload arrives base64'd,
    // so no quote, semicolon, backtick or newline can reach the remote shell.
    for (const payload of [
      'a@x.com;touch PWNED',
      'a@x.com" ; touch PWNED ; echo "',
      "$(touch PWNED)",
      "`touch PWNED`",
      "a@x.com && touch PWNED",
      "a@x.com | touch PWNED",
      "line1\nline2",
    ]) {
      const c = buildRemoteCommand({ emailB64: Buffer.from(payload, "utf8").toString("base64") });
      expect(c, payload).not.toMatch(/touch PWNED/);
      expect(c, payload).not.toContain(payload);
      // The decoded value is quoted at the point of use.
      expect(c).toMatch(/--to "\$\(echo [A-Za-z0-9+/=]+ \| base64 -d\)"/);
    }
  });

  it("gathers instance-local facts the app cannot self-report", () => {
    // A box that crash-loops answers /api/health perfectly in between restarts,
    // and a full disk is the classic reason a deploy "succeeded" without
    // extracting. Neither is visible over HTTP.
    const c = buildRemoteCommand();
    expect(c).toMatch(/FACT_UPTIME=/);
    expect(c).toMatch(/FACT_DISKFREE=/);
    expect(c).toMatch(/FACT_PM2=/);
  });

  it("is read-only on the instance — it writes nothing and restarts nothing", () => {
    const c = buildRemoteCommand({ emailB64: "eA==" });
    for (const forbidden of [/pm2 (restart|reload|stop|delete|startOrReload)/, />\s*\/home\/relay/, /rm -/, /apt-get/, /systemctl/]) {
      expect(c).not.toMatch(forbidden);
    }
    // pm2 is only ever READ.
    expect(c).toMatch(/pm2 jlist/);
  });
});

/* ── parsing ──────────────────────────────────────────────────────────────── */

describe("parseInstanceReport", () => {
  it("reads the version, the config and the exit markers", () => {
    const r = parseInstanceReport(report({ version: "2.105.4", cluster: true, redisBus: false, mailExit: 0 }));
    expect(r.version).toBe("2.105.4");
    expect(r.cluster).toBe("true");
    expect(r.redisBus).toBe("false");
    expect(r.liveExit).toBe(0);
    expect(r.mailExit).toBe(0);
  });

  it("reads each check's verdict and note", () => {
    const r = parseInstanceReport(report());
    expect(r.checks["assets === local build"].verdict).toBe("PASS");
    /* A 24-CHARACTER NAME IS THE INTERESTING CASE, and it broke the first parser:
       live-verify pads names to 24, so a name of exactly that length is followed
       by ONE space and a "two or more spaces" rule could not see it. `arabic
       parity rules live` is exactly 24 characters — the very check this exercise
       exists to verify was the one that could not be read. */
    expect("arabic parity rules live".length).toBe(24);
    expect(r.checks["arabic parity rules live"]).toBeTruthy();
    expect(r.checks["arabic parity rules live"].verdict).toBe("PASS");
    expect(r.checks["arabic parity rules live"].note).toMatch(/Arabic face/);
  });

  it("agrees with the column layout live-verify actually prints", () => {
    // The parser slices at fixed offsets, so the format it slices is pinned here
    // against the real print statement rather than assumed.
    const src = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "live-verify.mjs"), "utf8");
    expect(src).toMatch(/`  \$\{r\.verdict\.padEnd\(5\)\} \$\{r\.name\.padEnd\(24\)\} \$\{r\.note\}`/);
  });

  it("takes the LAST exit marker, not the first", () => {
    // A retried command can contain more than one run; the final verdict is the
    // one that counts.
    const r = parseInstanceReport("LIVE_VERIFY_EXIT=1\nsomething\nLIVE_VERIFY_EXIT=0\n");
    expect(r.liveExit).toBe(0);
  });

  it("reports a missing marker as null rather than as success", () => {
    // A truncated or killed command must never read as a pass.
    const r = parseInstanceReport("LIVE VERIFY — http://127.0.0.1:3000\n  PASS  version  live 1.0.0 === shared/version.ts");
    expect(r.liveExit).toBeNull();
  });

  it("leaves mailExit null when the mail check did not run", () => {
    expect(parseInstanceReport(report()).mailExit).toBeNull();
  });

  it("parses pm2's restart count and status, and tolerates rubbish", () => {
    expect(parsePm2("relay:restarts=7,status=online")).toEqual([{ name: "relay", restarts: 7, status: "online" }]);
    expect(parsePm2("relay:restarts=undefined,status=errored")).toEqual([
      { name: "relay", restarts: null, status: "errored" },
    ]);
    expect(parsePm2("")).toEqual([]);
    expect(parsePm2("nonsense")).toEqual([]);
  });
});

/* ── the fleet-level findings, which are the whole reason for fanning out ──── */

const rep = (id: string, text: string, targetHealth: string | null = "healthy") => ({
  id,
  az: "ap-south-1a",
  status: "Success",
  raw: text,
  report: parseInstanceReport(text),
  error: null,
  targetHealth,
});

describe("aggregate — what only a comparison can see", () => {
  it("is quiet and OK when both instances agree and are healthy", () => {
    const res = aggregate([rep("i-1", report()), rep("i-2", report())]);
    expect(res.ok).toBe(true);
    expect(res.findings.filter((f: { severity: string }) => f.severity === "fail")).toEqual([]);
    expect(res.findings.some((f: { name: string }) => /same version/.test(f.name))).toBe(true);
  });

  it("FAILS a split fleet, and names which box has which version", () => {
    // Visible to users: the auto-updater compares baked against runtime version,
    // so whichever instance a poll lands on decides whether a refresh prompt
    // appears — it flaps.
    const res = aggregate([rep("i-1", report({ version: "2.105.4" })), rep("i-2", report({ version: "2.105.3" }))]);
    expect(res.ok).toBe(false);
    const f = res.findings.find((x: { name: string }) => /more than one version/.test(x.name));
    expect(f).toBeTruthy();
    expect(f.detail).toMatch(/i-1=2\.105\.4/);
    expect(f.detail).toMatch(/i-2=2\.105\.3/);
    // Says out loud that this is normal mid-deploy rather than crying outage.
    expect(f.detail).toMatch(/rolling deploy/);
  });

  it("FAILS when cluster or redisBus differs between instances", () => {
    // This is the v2.94.4 bug: RELAY_CLUSTER simply was not set on the hosts, so
    // a caller on one box could not reach a callee on the other. Invisible from
    // inside either one.
    for (const key of ["cluster", "redisBus"] as const) {
      const res = aggregate([
        rep("i-1", report({ [key]: true } as never)),
        rep("i-2", report({ [key]: false } as never)),
      ]);
      expect(res.ok, key).toBe(false);
      const f = res.findings.find((x: { name: string }) => x.name.startsWith(key));
      expect(f, key).toBeTruthy();
      expect(f.detail).toMatch(/cannot reach/);
    }
  });

  it("attributes a per-instance failure to the instance that produced it", () => {
    const res = aggregate([
      rep("i-1", report()),
      rep("i-2", report({ liveExit: 1, extraFail: "seo is dynamic|sitemap names a different host" })),
    ]);
    expect(res.ok).toBe(false);
    const f = res.findings.find((x: { name: string }) => /i-2 failed/.test(x.name));
    expect(f).toBeTruthy();
    expect(f.detail).toMatch(/sitemap names a different host/);
    // …and does NOT blame the healthy one.
    expect(res.findings.some((x: { name: string }) => /i-1 failed/.test(x.name))).toBe(false);
  });

  it("FAILS an instance that is out of the load balancer even though it serves fine", () => {
    // It can be running the right code and receive no traffic at all — a state
    // neither the HTTP probe nor the instance itself can see.
    const res = aggregate([rep("i-1", report()), rep("i-2", report(), "unhealthy")]);
    expect(res.ok).toBe(false);
    expect(res.findings.find((x: { name: string }) => /i-2 is not healthy in the load balancer/.test(x.name))).toBeTruthy();
  });

  it("does NOT invent a load-balancer finding when the reading was unavailable", () => {
    // A missing permission must degrade to silence, not to a false alarm.
    const res = aggregate([rep("i-1", report(), null), rep("i-2", report(), null)]);
    expect(res.ok).toBe(true);
    expect(res.findings.some((x: { name: string }) => /load balancer/.test(x.name))).toBe(false);
  });

  it("FAILS a pm2 process that is not online, and WARNS on a restart storm", () => {
    const dead = aggregate([rep("i-1", report({ pm2: "relay:restarts=3,status=errored" }))]);
    expect(dead.ok).toBe(false);
    expect(dead.findings.find((f: { name: string }) => /pm2 process not online/.test(f.name))).toBeTruthy();

    // 97 restarts over 1.16 days ≈ 84/day. A warning, not a failure: it is serving. But
    // it is the signal that a box answering health perfectly is doing so between crashes.
    //
    // REWRITTEN IN v2.105.10 TO THE PROPERTY. This matched the finding's wording
    // (`restarted a lot`), so it pinned a STRING while the property is a RATE — and it
    // would have gone on passing for the reading that made this release necessary: 46/47
    // restarts on production with status=online and 8.4 days of uptime, which is one per
    // ~4.3 hours, i.e. pm2 restarting once per deploy. The check now divides by uptime,
    // so the two cases are asserted separately.
    const loop = aggregate([rep("i-1", report({ pm2: "relay:restarts=97,status=online" }))]);
    expect(loop.ok).toBe(true);
    const warned = loop.findings.find((f: { severity: string; name: string }) =>
      /restarting faster than deploys explain/.test(f.name),
    );
    expect(warned).toBeTruthy();
    expect(warned!.severity).toBe("warn");
  });

  it("a DEPLOY-CADENCE restart count is reported as information, not a warning", () => {
    // The real production reading: 47 restarts over ~8.4 days = 5.6/day, status online.
    // A WARN here is a false alarm, and a false alarm is what hides a real one.
    const res = aggregate([
      rep("i-1", report({ pm2: "relay:restarts=47,status=online", uptimeSec: 8.4 * 86400 })),
    ]);
    expect(res.ok).toBe(true);
    expect(res.findings.some((f: { severity: string }) => f.severity === "warn")).toBe(false);
    const info = res.findings.find((f: { name: string }) => /deploy cadence, not a loop/.test(f.name));
    // Reported rather than hidden, so an operator seeing a count in the forties can tell
    // it was accounted for instead of wondering why nothing mentioned it.
    expect(info).toBeTruthy();
    expect((info as { severity: string }).severity).toBe("info");
    expect((info as { detail: string }).detail).toMatch(/5\.6\/day/);
  });

  it("with no uptime reading the rate cannot be checked, so the absolute cap stands", () => {
    // Degrading to silence here would drop crash-loop detection entirely whenever the
    // uptime line is missing. Today's behaviour is the safe fallback.
    const res = aggregate([
      rep("i-1", report({ pm2: "relay:restarts=47,status=online", uptimeSec: null })),
    ]);
    const f = res.findings.find((x: { name: string }) => /restarted a lot/.test(x.name));
    expect(f).toBeTruthy();
    expect((f as { severity: string }).severity).toBe("warn");
    expect((f as { detail: string }).detail).toMatch(/uptime unknown/);
  });

  it("WARNS on low disk — the classic reason a deploy 'succeeded' without extracting", () => {
    const res = aggregate([rep("i-1", report({ diskKb: 100_000 }))]);
    expect(res.findings.find((f: { name: string }) => /low on disk/.test(f.name))).toBeTruthy();
  });

  it("WARNS rather than passing when a box could not compare its served bytes", () => {
    const res = aggregate([rep("i-1", report({ assets: "SKIP" }))]);
    expect(res.findings.find((f: { name: string }) => /could not compare its served bytes/.test(f.name))).toBeTruthy();
    expect(res.ok).toBe(true); // honest, not fatal
  });

  it("FAILS an instance that did not report at all", () => {
    const res = aggregate([
      rep("i-1", report()),
      { id: "i-2", az: null, status: "TimedOut", raw: "", report: null, error: "TimedOut", targetHealth: "healthy" },
    ]);
    expect(res.ok).toBe(false);
    expect(res.findings.find((f: { name: string }) => /i-2 did not report/.test(f.name))).toBeTruthy();
  });

  it("FAILS when NOTHING reported, rather than reporting an empty success", () => {
    const res = aggregate([]);
    expect(res.ok).toBe(false);
    expect(res.findings[0].name).toMatch(/no instance reported/);
  });

  it("FAILS when an instance cannot deliver mail", () => {
    const res = aggregate([rep("i-1", report({ mailExit: 1 }))]);
    expect(res.ok).toBe(false);
    expect(res.findings.find((f: { name: string }) => /cannot deliver mail/.test(f.name))).toBeTruthy();
  });
});

/* ── the AWS plumbing, driven with recorded output ────────────────────────── */

describe("the AWS calls", () => {
  it("discovers every RUNNING instance carrying the tag", async () => {
    const { run, calls } = fakeAws({ instances: [{ id: "i-1" }, { id: "i-2" }] });
    const got = await discoverInstances(run);
    expect(got.map((i: { id: string }) => i.id)).toEqual(["i-1", "i-2"]);
    const q = calls[0].join(" ");
    expect(q).toMatch(/Name=tag:Name,Values=relay-app/);
    expect(q).toMatch(/Name=instance-state-name,Values=running/);
    // NOT sort_by(...)[0] — that was the defect.
    expect(q).not.toMatch(/sort_by/);
    expect(q).not.toMatch(/\[0\]/);
  });

  it("sends ONE command to ALL instances and reads EVERY invocation", async () => {
    const { run, calls } = fakeAws({ instances: [{ id: "i-1" }, { id: "i-2" }] });
    const sent = await sendToAll(run, ["i-1", "i-2"], "echo hi", { sleep: noSleep });
    expect(sent.perInstance.map((p: { id: string }) => p.id)).toEqual(["i-1", "i-2"]);
    const send = calls.find((c) => c[1] === "send-command")!.join(" ");
    expect(send).toMatch(/--instance-ids i-1 i-2/);
    // Every box in parallel, and one failure must not stop the others reporting.
    expect(send).toMatch(/--max-concurrency 100%/);
    expect(send).toMatch(/--max-errors 100%/);
    const read = calls.find((c) => c.includes("--details"))!.join(" ");
    expect(read).toMatch(/CommandInvocations\[\]/);
    expect(read).not.toMatch(/CommandInvocations\[0\]/);
  });

  it("returns an error rather than throwing when send-command is refused", async () => {
    const { run } = fakeAws({ instances: [{ id: "i-1" }], sendFails: true });
    const sent = await sendToAll(run, ["i-1"], "echo hi", { sleep: noSleep });
    expect(sent.perInstance).toEqual([]);
    expect(sent.error).toMatch(/InvalidInstanceId/);
  });

  it("treats healthy in ANY target group as in service", async () => {
    // An instance legitimately sits in more than one group: the /api/relay/*
    // signaling group pins ONE instance, so the other is deliberately absent from
    // it and must not be reported as unhealthy for that.
    const { run } = fakeAws({ instances: [{ id: "i-1" }], targetHealth: { "i-1": "healthy" } });
    expect(await targetHealthByInstance(run)).toEqual({ "i-1": "healthy" });
  });

  it("returns nothing when the elbv2 read is denied, so no false finding appears", async () => {
    const { run } = fakeAws({ instances: [{ id: "i-1" }], denyElbv2: true });
    expect(await targetHealthByInstance(run)).toEqual({});
  });
});

describe("verifyFleet — end to end against a fake fleet", () => {
  it("passes a healthy two-instance fleet", async () => {
    const { run } = fakeAws({
      instances: [{ id: "i-1" }, { id: "i-2" }],
      targetHealth: { "i-1": "healthy", "i-2": "healthy" },
    });
    const res = await verifyFleet(run, { sleep: noSleep });
    expect(res.reports).toHaveLength(2);
    expect(res.ok).toBe(true);
  });

  it("catches the case the old single-instance probe would have MISSED", async () => {
    /* THE WHOLE POINT. i-1 is fine and i-2 is serving an older release. The
       previous design probed `sort_by(...)[0]` — one box — and read
       `CommandInvocations[0]`, so this was found only by luck, and the runner-side
       probe cannot help because the ALB round-robins and may well hit i-1. */
    const { run } = fakeAws({
      instances: [{ id: "i-1" }, { id: "i-2" }],
      outputs: { "i-1": report({ version: "2.105.4" }), "i-2": report({ version: "2.105.1" }) },
      targetHealth: { "i-1": "healthy", "i-2": "healthy" },
    });
    const res = await verifyFleet(run, { sleep: noSleep });
    expect(res.ok).toBe(false);
    expect(res.findings.find((f: { name: string }) => /more than one version/.test(f.name))).toBeTruthy();
  });

  it("reports an instance with no invocation instead of silently dropping it", async () => {
    const { run } = fakeAws({
      instances: [{ id: "i-1" }, { id: "i-2" }],
      omitInvocationFor: ["i-2"],
      targetHealth: { "i-1": "healthy", "i-2": "healthy" },
    });
    const res = await verifyFleet(run, { sleep: noSleep });
    expect(res.reports).toHaveLength(2); // still both, one with no output
    expect(res.ok).toBe(false);
    expect(res.findings.find((f: { name: string }) => /i-2 did not report/.test(f.name))).toBeTruthy();
  });

  it("FAILS rather than passing vacuously when the fleet has no instances", async () => {
    const { run } = fakeAws({ instances: [] });
    const res = await verifyFleet(run, { sleep: noSleep });
    expect(res.ok).toBe(false);
  });
});

describe("the workflow calls the script rather than re-implementing it", () => {
  const OPS = fs.readFileSync(path.resolve(__dirname, "..", ".github", "workflows", "aws-ops.yml"), "utf8");
  const lvAt = OPS.indexOf("live-verify — prove the live site is serving");
  const lvEnd = OPS.indexOf("- name: recover-identity", lvAt);
  const lv = OPS.slice(lvAt, lvEnd);

  it("the window read here is real and bounded", () => {
    expect(lvAt).toBeGreaterThan(0);
    expect(lvEnd).toBeGreaterThan(lvAt);
    expect(lv).not.toMatch(/recover-identity|admin-tool/);
  });

  it("invokes fleet-verify and no longer picks one instance itself", () => {
    expect(lv).toMatch(/node scripts\/fleet-verify\.mjs/);
    /* Scanned on the SHELL, with comment lines stripped — for the fourteenth time
       in this repo, a `not.toMatch` matched the prose explaining the absence: the
       step's own comment names `CommandInvocations[0]` in order to record that it
       was removed. */
    const shell = lv
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(shell).not.toMatch(/sort_by\(Reservations/);
    expect(shell).not.toMatch(/CommandInvocations\[0\]/);
    // …and the comment really is where it lives, so the strip is doing work.
    expect(lv).toMatch(/CommandInvocations\[0\]/);
  });

  it("still probes the public URL from the runner — both vantage points remain", () => {
    expect(lv).toMatch(/--base "https:\/\/\$DOMAIN"/);
    expect(lv).toMatch(/this is an EDGE problem/);
  });

  it("a non-zero fleet verdict fails the run", () => {
    expect(lv).toMatch(/FLEET=\$\?/);
    expect(lv).toMatch(/\[ \$FLEET -eq 0 \] \|\| APP=1/);
    expect(lv).toMatch(/\[ \$EDGE -eq 0 \] && \[ \$APP -ne 1 \] && \[ \$MAIL -eq 0 \] \|\| exit 1/);
  });

  it("the script is shipped to the instances' release tar", () => {
    // It runs on the RUNNER, but live-verify/mail-verify run on the instance, and
    // all three live in scripts/ — which the deploy must keep shipping.
/* v2.107.34 - `deploy.yml` (Deploy to AWS) IS GONE. It kept firing on every
       push after the Doha cutover, against decommissioned AWS infrastructure,
       failing in ~46s and EMAILING THE OWNER each time - his report is why it
       was finally excised. The live pipeline is `deploy-doha.yml`. Its rsync
       ships the whole tree; the pin is that scripts/ is never excluded. */
    const deploy = fs.readFileSync(path.resolve(__dirname, "..", ".github", "workflows", "deploy-doha.yml"), "utf8");
    expect(deploy).toMatch(/rsync -az --exclude node_modules --exclude \.git --exclude \.env/);
    expect(deploy).not.toMatch(/--exclude scripts/);
    expect(fs.existsSync(path.resolve(__dirname, "..", "scripts", "fleet-verify.mjs"))).toBe(true);
  });
});
