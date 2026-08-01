/* ============================================================
   v2.91 — AWS ops workflow + scale-out runbook (shape pins).

   .github/workflows/aws-ops.yml is infrastructure-mutating, so its
   safety properties are pinned the same way this repo pins other
   generated-surface contracts (deploy invariants, router shapes):
   manual-only trigger, graceful no-secrets failure, the tiered-
   signaling constants, and the hands-off-DNS stance.
   ============================================================ */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const OPS = fs.readFileSync(
  path.resolve(__dirname, "..", ".github", "workflows", "aws-ops.yml"),
  "utf8"
);
const DOCS = fs.readFileSync(
  path.resolve(__dirname, "..", "docs-aws-scale-out.md"),
  "utf8"
);

describe("aws-ops.yml — trigger + auth safety", () => {
  it("is workflow_dispatch ONLY — never runs on push", () => {
    expect(OPS).toMatch(/on:\s*\n\s*workflow_dispatch:/);
    expect(OPS).not.toMatch(/\n\s*push:/);
    expect(OPS).not.toMatch(/\n\s*pull_request:/);
  });
  it("offers the ops actions with verify as the safe default (v2.97.2 adds ses/ses-ssm/iam-grant-ses/env-set)", () => {
    // v2.99.69 appended `recover-identity`. Rewritten as a PREFIX match plus an
    // explicit default rather than a frozen full list: the exact-list form has now
    // broken twice on a legitimate addition while telling us nothing about the
    // property that matters, which is that the DEFAULT is the read-only action.
    expect(OPS).toMatch(/options: \[verify, cloudfront, alb-tune, ses, ses-ssm, iam-grant-ses, env-set, turn-fix/);
    expect(OPS).toMatch(/default: verify/);
    // Whatever the list grows to, `verify` must stay first — it is the one that
    // changes nothing, and being first is what makes a mis-click harmless.
    const opts = (OPS.match(/options: \[([^\]]+)\]/) || [, ""])[1].split(",").map(s => s.trim());
    expect(opts[0]).toBe("verify");
    expect(new Set(opts).size).toBe(opts.length); // no duplicate actions
  });
  it("region input defaults to ap-south-1; auth prefers access keys but falls back to the deploy OIDC role", () => {
    expect(OPS).toMatch(/default: ap-south-1/);
    // v2.99.58 PINNED this action to a commit SHA. aws-ops.yml assumes the same
    // production role as deploy.yml, so a mutable `@v4` here was a tag the
    // action's owner could repoint straight into those credentials. Assert the
    // pinned form — the stronger property — rather than the old floating tag.
    expect(OPS).toMatch(/aws-actions\/configure-aws-credentials@[0-9a-f]{40} # v4\./);
    expect(OPS).not.toMatch(/aws-actions\/configure-aws-credentials@v\d/);
    expect(OPS).toMatch(/aws-access-key-id: \$\{\{ secrets\.AWS_ACCESS_KEY_ID \}\}/);
    expect(OPS).toMatch(/aws-secret-access-key: \$\{\{ secrets\.AWS_SECRET_ACCESS_KEY \}\}/);
    // v2.97.1: no ops secrets configured ⇒ assume the deploy pipeline's role.
    expect(OPS).toMatch(/role-to-assume: arn:aws:iam::342494841476:role\/relay-github-deploy/);
  });
  it("turn-fix DIAGNOSES by default — production networking is never changed on a guess", () => {
    // The action inspects the relay security groups and listeners and stops.
    // Only an explicit turn_apply=true opens tcp/443, and even then it will not
    // touch coturn's own config (that lives on hosts this role may not manage).
    expect(OPS).toMatch(/turn_apply:/);
    const inp = OPS.slice(OPS.indexOf("turn_apply:"), OPS.indexOf("env_key:"));
    expect(inp).toMatch(/type: boolean/);
    expect(inp).toMatch(/default: false/);
    expect(OPS).toMatch(/DIAGNOSE ONLY — nothing changed/);
    // the only mutation it can make, and it is gated
    const step = OPS.slice(OPS.indexOf("turn-fix — find why"));
    const gate = step.indexOf('if [ "${APPLY}" != "true" ]');
    const mutate = step.indexOf("authorize-security-group-ingress");
    expect(gate).toBeGreaterThan(-1);
    expect(mutate).toBeGreaterThan(gate); // the gate precedes the only write
  });

  it("degrades gracefully to OIDC (not a hard failure) when the ops secrets are absent", () => {
    // v2.97.1 replaced the old hard-fail gate with an auth-method DETECTOR:
    // keys present → access-key auth; keys absent → warn + fall back to the
    // deploy role, so the workflow still runs instead of erroring out.
    const detectIdx = OPS.indexOf("Detect auth method");
    const authIdx = OPS.indexOf("aws-actions/configure-aws-credentials");
    expect(detectIdx).toBeGreaterThan(-1);
    expect(detectIdx).toBeLessThan(authIdx);
    expect(OPS).toMatch(/falling back to the deploy pipeline's OIDC role/);
  });
});

describe("aws-ops.yml — action contracts", () => {
  it("verify is read-only (sts identity + tables, explicit no-mutations note)", () => {
    expect(OPS).toMatch(/aws sts get-caller-identity/);
    expect(OPS).toMatch(/verify done — no mutations were made\./);
  });
  it("cloudfront: us-east-1 cert (CloudFront requirement), printed validation CNAMEs, re-run guidance", () => {
    expect(OPS).toMatch(/aws acm request-certificate --region us-east-1/);
    expect(OPS).toMatch(/DNS VALIDATION RECORDS/);
    expect(OPS).toMatch(/RE-RUN this workflow with action=cloudfront/);
  });
  it("cloudfront: ALB origin https-only + AllViewer, SSE behaviors CachingDisabled, /assets/* CachingOptimized, http2and3", () => {
    expect(OPS).toMatch(/OriginProtocolPolicy: "https-only"/);
    expect(OPS).toMatch(/Managed-AllViewer/);
    expect(OPS).toMatch(/Managed-CachingDisabled/);
    expect(OPS).toMatch(/Managed-CachingOptimized/);
    expect(OPS).toMatch(/\/api\/relay\/stream\*/);
    expect(OPS).toMatch(/\/api\/v2\/events\*/);
    expect(OPS).toMatch(/PathPattern: "\/assets\/\*"/);
    expect(OPS).toMatch(/OriginReadTimeout: 60/);
    expect(OPS).toMatch(/HttpVersion: "http2and3"/);
  });
  it("cloudfront: prints the DNS change but NEVER performs it (no route53 mutations anywhere)", () => {
    expect(OPS).toMatch(/this workflow never touches DNS/);
    expect(OPS).not.toMatch(/route53 change-resource-record-sets/);
    expect(OPS).not.toMatch(/aws route53/);
  });
  it("alb-tune: idle timeout 300, relay-signaling TG on /api/health, ONE instance, priority-10 rule", () => {
    expect(OPS).toMatch(/Key=idle_timeout\.timeout_seconds,Value=300/);
    expect(OPS).toMatch(/--name relay-signaling/);
    expect(OPS).toMatch(/--health-check-path \/api\/health/);
    expect(OPS).toMatch(/--port 3000/);
    expect(OPS).toMatch(/relay-signaling must hold exactly one instance/);
    expect(OPS).toMatch(/--priority 10/);
    expect(OPS).toMatch(/Values=\/api\/relay\/\*/);
    expect(OPS).toMatch(/Default rule \(both instances\) untouched/);
  });
});

describe("aws-ops.yml — v2.91 review fixes (D1/D5/D9/D10/D11)", () => {
  it("D1: EVERY cache behavior carries AllViewer — /assets/* included (no-Host origin requests 502 on the ALB cert)", () => {
    // sse helper + ASSETS_BEHAVIOR + DefaultCacheBehavior = 3 occurrences.
    expect(OPS.match(/OriginRequestPolicyId: \$orp/g)?.length).toBe(3);
    const assetsIdx = OPS.indexOf('PathPattern: "/assets/*"');
    expect(assetsIdx).toBeGreaterThan(-1);
    const assetsJq = OPS.slice(OPS.lastIndexOf("ASSETS_BEHAVIOR=", assetsIdx), assetsIdx + 400);
    expect(assetsJq).toContain('--arg orp "$ORP_ALLVIEWER"');
    expect(assetsJq).toContain("OriginRequestPolicyId: $orp");
  });
  it("D5: the printed go/no-go check uses a Host override (plain https://<cf-domain> can never pass)", () => {
    expect(OPS).toMatch(/curl -si https:\/\/\$CF_DOMAIN\/api\/health -H \\"Host: \$DOMAIN\\"/);
    expect(OPS).not.toMatch(/https:\/\/\$CF_DOMAIN directly/); // the old, impossible gate
  });
  it("D9: once a 443 listener exists, any leftover :80 /api/relay/* forward rule is deleted", () => {
    expect(OPS).toMatch(/aws elbv2 delete-rule --rule-arn "\$OLD_HTTP_RULE"/);
    expect(OPS).toMatch(/DELETED leftover :80 fallback rule/);
  });
  it("D10: managed-policy lookups tolerate AccessDenied so the fallback ids engage; IAM actions are enumerated", () => {
    expect(OPS.match(/--output text 2>\/dev\/null \|\| echo None/g)?.length).toBe(3);
    expect(OPS).toMatch(/Required IAM actions for the ops key/);
    expect(OPS).toMatch(/cloudfront:CreateDistribution/);
    expect(OPS).toMatch(/elasticloadbalancing:DeleteRule/);
  });
  it("D11: dead ACM certs (VALIDATION_TIMED_OUT/FAILED) are swept + re-requested; no false idempotency claim", () => {
    expect(OPS).toMatch(/--certificate-statuses VALIDATION_TIMED_OUT FAILED/);
    expect(OPS).toMatch(/aws acm delete-certificate --region us-east-1/);
    expect(OPS).not.toMatch(/requesting a DNS-validated one now \(idempotent\)/);
  });
});

describe("docs-aws-scale-out.md — runbook contracts", () => {
  it("keeps the single-process signaling invariant front and center", () => {
    expect(DOCS).toMatch(/in-memory, single-process/);
    expect(DOCS).toMatch(/do NOT try to load-balance `\/api\/relay\/\*`/);
  });
  it("covers the tiered ALB: relay-signaling (one instance) vs default (both) + 300s idle", () => {
    expect(DOCS).toMatch(/relay-signaling/);
    expect(DOCS).toMatch(/\/api\/relay\/\*/);
    expect(DOCS).toMatch(/idle_timeout\.timeout_seconds,Value=300/);
    expect(DOCS).toMatch(/Priority 10/);
  });
  it("explains why /api/v2/events stays load-balanced (the Redis bus fans out)", () => {
    expect(DOCS).toMatch(/`\/api\/v2\/events` is NOT pinned/);
    expect(DOCS).toMatch(/relay:v2ev/);
  });
  it("provisions ElastiCache Redis: cluster mode OFF, small node, same VPC/subnets, 6379 from the app SG", () => {
    expect(DOCS).toMatch(/Cluster mode: DISABLED/);
    expect(DOCS).toMatch(/cache\.t4g\.micro/);
    expect(DOCS).toMatch(/same VPC \+ subnets as the\s+relay-app EC2 instances/);
    expect(DOCS).toMatch(/TCP 6379, source\s+= the EC2 instances' security group/);
    expect(DOCS).toMatch(/REDIS_URL=redis:\/\//);
    expect(DOCS).toMatch(/\/home\/relay\/\.env/);
  });
  it("orders the rollout: signaling rule BEFORE REDIS_URL (single-writer busy-state)", () => {
    expect(DOCS).toMatch(/Order of operations/);
    expect(DOCS).toMatch(/single writer/);
  });
  it("D8: documents the replication-group PRIMARY endpoint lookup and the REDIS_URL-must-be-primary rule", () => {
    // The console path creates a REPLICATION GROUP — describe-cache-clusters
    // on its name fails; and a replica endpoint splits the bus (READONLY).
    expect(DOCS).toMatch(/describe-replication-groups --replication-group-id relay-bus/);
    expect(DOCS).toMatch(/NodeGroups\[0\]\.PrimaryEndpoint/);
    expect(DOCS).toMatch(/must be the PRIMARY endpoint whenever a replica exists/);
  });
  it("D5: the runbook's CloudFront go/no-go check is the Host-override curl form", () => {
    expect(DOCS).toMatch(/curl -si https:\/\/dXXXX\.cloudfront\.net\/api\/health -H "Host: your-chat\.io"/);
  });
});

describe("aws-ops.yml — ses-ssm: no free-text workflow_dispatch input reaches the remote shell unescaped", () => {
  // SECURITY regression: SES_EMAIL and DOMAIN are both free-text
  // workflow_dispatch inputs that get embedded into command strings executed
  // on production EC2 via SSM RunShellScript. Splicing them directly inside
  // single-quoted fragments (the old shape) let a value containing a quote/
  // semicolon break out and inject arbitrary shell commands on the fleet
  // under the instance role. Both must now be base64-encoded on the runner
  // and decoded only on the remote instance — the same treatment the
  // account-description text (DESC_B64) already used.
  const sesSsm = OPS.slice(OPS.indexOf("ses-ssm — SES ops"), OPS.indexOf("- name: iam-grant-ses"));

  it("base64-encodes SES_EMAIL and DOMAIN before building the remote command strings", () => {
    expect(sesSsm).toMatch(/SES_EMAIL_B64=\$\(printf %s "\$SES_EMAIL" \| base64 -w0\)/);
    expect(sesSsm).toMatch(/DOMAIN_B64=\$\(printf %s "\$DOMAIN" \| base64 -w0\)/);
  });

  it("C3/C4/C5 decode the base64 value ON THE REMOTE INSTANCE rather than splicing the raw input", () => {
    expect(sesSsm).toMatch(/EM=\\\$\(echo \$SES_EMAIL_B64 \| base64 -d\)/);
    expect(sesSsm).toMatch(/DOM=\\\$\(echo \$DOMAIN_B64 \| base64 -d\)/);
  });

  it("never interpolates the raw $SES_EMAIL or bare 'https://$DOMAIN' inside a quoted remote command fragment", () => {
    // The old vulnerable shapes: a raw --email-address '$SES_EMAIL' and a raw
    // 'https://$DOMAIN' spliced straight into a C-string.
    expect(sesSsm).not.toMatch(/--email-address '\$SES_EMAIL'/);
    expect(sesSsm).not.toMatch(/'https:\/\/\$DOMAIN'/);
  });
});

describe("aws-ops.yml — recover-identity: a production DB write, gated and injection-safe", () => {
  /* v2.99.69. The recovery script (added v2.99.60) needs the live DATABASE_URL,
     which exists only in /home/relay/.env on the fleet — so SSM is the one path to
     it that does not involve a human copying a production credential onto a laptop.
     That makes this the most dangerous action in the file: it can DELETE an identity
     row. Every property below is what keeps it safe. */
  const rec = OPS.slice(OPS.indexOf("recover-identity — re-attach an ORPHANED"));

  it("exists as an explicit action with its own three inputs", () => {
    // Asserts MEMBERSHIP, not the whole list. The frozen-list form lived here too
    // and has now broken THREE times on a legitimate addition (v2.99.69's
    // recover-identity, v2.99.70, and v2.99.76's admin-tool) while saying nothing
    // about the property this test is actually about, which is that
    // `recover-identity` is a real selectable action wired to its own step.
    // The list-wide invariants (verify first, no duplicates) are pinned once, above.
    const opts = (OPS.match(/options: \[([^\]]+)\]/) || [, ""])[1]
      .split(",")
      .map((s) => s.trim());
    expect(opts).toContain("recover-identity");
    for (const k of ["recover_number", "recover_email", "recover_apply"]) {
      expect(OPS).toMatch(new RegExp(`\\n      ${k}:`));
    }
    expect(rec).toMatch(/if: inputs\.action == 'recover-identity'/);
  });

  it("DRY RUN is the default — the write needs recover_apply", () => {
    const apply = OPS.slice(OPS.indexOf("      recover_apply:"), OPS.indexOf("      turn_apply:"));
    expect(apply).toMatch(/type: boolean/);
    expect(apply).toMatch(/default: false/);
    // --apply is only ever added under the flag.
    expect(rec).toMatch(/if \[ "\$RAPPLY" = "true" \]; then\s*\n\s*FLAG=" --apply"/);
  });

  it("refuses without BOTH inputs, and shape-checks the number", () => {
    expect(rec).toMatch(/if \[ -z "\$\{RNUM\}" \] \|\| \[ -z "\$\{REMAIL\}" \]; then/);
    expect(rec).toMatch(/\*\[!0-9\]\*\)/);
    expect(rec).toMatch(/if \[ "\$\{#RNUM\}" -ne 6 \]; then/);
  });

  it("base64-encodes both free-text inputs and decodes them ON the instance", () => {
    // Same treatment as SES_EMAIL/DOMAIN and `region` — this file has been bitten
    // by that exact class twice, so a third free-text input reaching a remote
    // shell unescaped is not a mistake it gets to make again.
    expect(rec).toMatch(/NUM_B64=\$\(printf %s "\$RNUM" \| base64 -w0\)/);
    expect(rec).toMatch(/EMAIL_B64=\$\(printf %s "\$REMAIL" \| base64 -w0\)/);
    expect(rec).toMatch(/--number \\"\\\$\(echo \$NUM_B64 \| base64 -d\)\\"/);
    expect(rec).toMatch(/--email \\"\\\$\(echo \$EMAIL_B64 \| base64 -d\)\\"/);
    // …and the raw values never appear inside the remote command line.
    const cmdline = rec.slice(rec.indexOf("CMDLINE="), rec.indexOf("PARAMS="));
    expect(cmdline).not.toMatch(/\$RNUM/);
    expect(cmdline).not.toMatch(/\$REMAIL/);
  });

  it("runs on exactly ONE instance — a DB mutation must not fire twice", () => {
    expect(rec).toMatch(/--instance-ids "\$IID"/);
    expect(rec).toMatch(/--max-concurrency 1 --max-errors 0/);
    // Targeting the tag would hit the whole fleet.
    expect(rec).not.toMatch(/--targets "Key=tag:Name,Values=relay-app"/);
    expect(rec).toMatch(/sort_by\(Reservations\[\]\.Instances\[\],&LaunchTime\)\[0\]\.InstanceId/);
  });

  it("reads the verdict from the script's printed exit marker, not the SSM status", () => {
    // v2.99.46's lesson: a wrapper or a pipeline can mask a non-zero exit, so the
    // gate has to be something the script itself printed.
    expect(rec).toMatch(/echo \\"RECOVER_EXIT=\\\$\?\\"/);
    expect(rec).toMatch(/if echo "\$OUT" \| grep -q "RECOVER_EXIT=0"; then/);
    expect(rec).toMatch(/::error::the recovery script refused or failed/);
  });

  it("sources the fleet env so DATABASE_URL is present, and prints no credential", () => {
    expect(rec).toMatch(/set -a; \. \/home\/relay\/\.env 2>\/dev\/null; set \+a/);
    expect(rec).not.toMatch(/echo .*DATABASE_URL/);
  });

  it("the script it invokes is actually shipped to the instances", () => {
    const deploy = fs.readFileSync(
      path.resolve(__dirname, "..", ".github", "workflows", "deploy.yml"),
      "utf8"
    );
    expect(deploy).toMatch(/\[ -d scripts \] && echo scripts/);
    expect(
      fs.existsSync(path.resolve(__dirname, "..", "scripts", "recover-orphan-identity.mjs"))
    ).toBe(true);
  });
});

describe("aws-ops.yml — live-verify: read-only, two vantage points, injection-safe", () => {
  /* v2.105.2. Task #44 asked for live verification and sat blocked for six
     releases because the agent sandbox cannot reach `your-chat.io` at all. This
     action is how it gets done: the same script, run from the runner (a real
     visitor's path) and from an instance against 127.0.0.1 (the app alone). Every
     property below is either what makes the result trustworthy or what keeps a
     read-only check from becoming a way to run commands on production. */
  /* BOUNDED to this step's own text. An unbounded slice to end-of-file is a
     fragility this repo has been bitten by several times, and it bit here: a
     mutation that DELETED the number shape-check survived, because the slice
     still contained `recover-identity`'s identical check 200 lines later. The
     end anchor is searched FROM the start so it cannot resolve to something
     earlier, and the window is asserted non-empty — a slice that collapses to
     "" makes every assertion in it pass vacuously. */
  const FLEET = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "fleet-verify.mjs"), "utf8");
  const lvAt = OPS.indexOf("live-verify — prove the live site is serving");
  const lvEnd = OPS.indexOf("- name: recover-identity", lvAt);
  const lv = OPS.slice(lvAt, lvEnd);
  it("the window this describe reads is real and bounded to one step", () => {
    expect(lvAt).toBeGreaterThan(0);
    expect(lvEnd).toBeGreaterThan(lvAt);
    expect(lv.length).toBeGreaterThan(1500);
    expect(lv).not.toMatch(/recover-identity|admin-tool/);
  });

  it("exists as an explicit action with its own inputs", () => {
    const opts = (OPS.match(/options: \[([^\]]+)\]/) || [, ""])[1]
      .split(",")
      .map((x) => x.trim());
    expect(opts).toContain("live-verify");
    for (const k of ["verify_number", "verify_email", "verify_email_send"]) {
      expect(OPS).toMatch(new RegExp(`\\n      ${k}:`));
    }
    expect(lv).toMatch(/if: inputs\.action == 'live-verify'/);
  });

  it("probes BOTH vantage points, and names which side failed", () => {
    /* The whole reason for two probes: a check that fails from outside and passes
       inside localises the fault to the edge. Reporting only a combined verdict
       would throw away exactly the information the second probe was run for.

       REWRITTEN for v2.105.5: the in-fleet half moved into
       `scripts/fleet-verify.mjs`, which fans it out to EVERY instance instead of
       picking one — so the localhost base now lives there. The property is
       unchanged and is asserted at its new home plus behaviourally in
       server/fleetVerify.test.ts. */
    expect(lv).toMatch(/--base "https:\/\/\$DOMAIN"/);
    expect(lv).toMatch(/node scripts\/fleet-verify\.mjs/);
    expect(FLEET).toMatch(/--base http:\/\/127\.0\.0\.1:/);
    expect(lv).toMatch(/this is an EDGE problem/);
    expect(lv).toMatch(/the fault is in the application or its deploy/);
  });

  it("builds with byte-for-byte the same env deploy.yml builds with", () => {
    // Both values are baked into the client bundle, so a different build env
    // produces different bytes and a different content hash — the byte
    // comparison would then report a mismatch on a deployment that is perfectly
    // in sync, i.e. a false alarm on the check that carries the most weight.
    const deploy = fs.readFileSync(
      path.resolve(__dirname, "..", ".github", "workflows", "deploy.yml"),
      "utf8"
    );
    const envOf = (src: string) => ({
      forge: (src.match(/VITE_FRONTEND_FORGE_API_URL: (\S+)/) || [])[1],
      appId: (src.match(/VITE_APP_ID: (\S+)/) || [])[1],
    });
    const mine = envOf(OPS.slice(OPS.indexOf("live-verify (checkout + build)")));
    expect(mine.forge).toBeDefined();
    expect(mine.appId).toBeDefined();
    expect(mine).toEqual(envOf(deploy));
  });

  it("is READ-ONLY: it mutates no AWS resource and writes nothing on the instance", () => {
    // A verification action that can change things is a verification action
    // somebody will eventually be afraid to run.
    for (const forbidden of [
      /aws ec2 authorize-security-group/, /aws elbv2 (create|modify|delete)/,
      /aws acm (request|delete)/, /aws cloudfront (create|update)/,
      /aws ssm put-parameter/, /pm2 (restart|reload|startOrReload)/,
      / > \/home\/relay/, /aws s3 cp/,
    ]) {
      expect(lv).not.toMatch(forbidden);
    }
    /* The SSM verbs moved into the script with the fan-out, so they are checked
       there now — still exactly send-command plus reading its result, and the
       script is separately asserted to mutate nothing on the instance. */
    expect([...lv.matchAll(/aws ssm ([a-z-]+)/g)].map((m) => m[1])).toEqual([]);
    const verbs = [...FLEET.matchAll(/"ssm", "([a-z-]+)"/g)].map((m) => m[1]);
    expect([...new Set(verbs)].sort()).toEqual(["list-command-invocations", "send-command"]);
    for (const forbidden of [/"ec2", "(?!describe)/, /"elbv2", "(?!describe)/, /put-parameter/]) {
      expect(FLEET).not.toMatch(forbidden);
    }
  });

  it("shape-checks the number and base64-encodes every free-text input", () => {
    // This file has been bitten by an unescaped free-text input reaching a remote
    // shell three times (SES_EMAIL/DOMAIN, `region`, then the recovery inputs).
    expect(lv).toMatch(/\*\[!0-9\]\*\)/);
    expect(lv).toMatch(/\[ "\$\{#VNUM\}" -eq 6 \]/);
    /* The encoding moved into the script, where it is a FUNCTION and therefore
       replayable against hostile input — which server/fleetVerify.test.ts does,
       over seven payloads. Here the property is that the workflow hands the
       values over and builds no remote command of its own. */
    expect(FLEET).toMatch(/base64 -d/);
    expect(FLEET).toMatch(/Buffer\.from\(v, "utf8"\)\.toString\("base64"\)/);
    // The workflow no longer assembles a remote command line at all.
    expect(lv).not.toMatch(/CMD_APP=/);
    expect(lv).not.toMatch(/AWS-RunShellScript/);
  });

  it("sends mail only when explicitly asked, and only from the instance", () => {
    // The default stops before DATA, so a health check nobody asked for never
    // arrives in somebody's inbox — which is what stops it being switched off.
    const send = OPS.slice(OPS.indexOf("      verify_email_send:"), OPS.indexOf("      turn_apply:"));
    expect(send).toMatch(/type: boolean/);
    expect(send).toMatch(/default: false/);
    // Passed through as a flag; the gating itself is in the script and covered
    // behaviourally in server/fleetVerify.test.ts.
    expect(lv).toMatch(/\[ "\$VSEND" = "true" \] && echo --send/);
    /* The mail check must never run on the RUNNER: the SMTP credentials exist only
       in /home/relay/.env. The workflow does not mention the mailer at all now —
       it is inside the remote command the script builds. */
    expect(lv).not.toMatch(/mail-verify/);
    expect(FLEET).toMatch(/node scripts\/mail-verify\.mjs --to/);
  });

  it("reads each verdict from the script's own printed marker, not the SSM status", () => {
    /* v2.99.46's lesson, one layer out now: the workflow reads the FLEET script's
       exit code, and the fleet script reads each instance's printed
       LIVE_VERIFY_EXIT / MAIL_VERIFY_EXIT marker rather than the SSM status —
       because a wrapper or a pipeline can mask a non-zero exit. */
    expect(lv).toMatch(/FLEET=\$\?/);
    expect(FLEET).toMatch(/LIVE_VERIFY_EXIT/);
    expect(FLEET).toMatch(/MAIL_VERIFY_EXIT/);
    expect(FLEET).toMatch(/FLEET_VERIFY_EXIT=/);
    // The SSM per-invocation Status is used only to know when polling may stop,
    // never as the verdict.
    expect(FLEET).not.toMatch(/status === "Success"/);
  });

  it("both scripts it invokes are actually shipped to the instances", () => {
    const deploy = fs.readFileSync(
      path.resolve(__dirname, "..", ".github", "workflows", "deploy.yml"),
      "utf8"
    );
    expect(deploy).toMatch(/\[ -d scripts \] && echo scripts/);
    // shared/ too — live-verify reads shared/version.ts off disk to know what the
    // fleet ought to be serving, so without it the version check would SKIP.
    expect(deploy).toMatch(/drizzle\.config\.ts drizzle shared tsconfig\.json/);
    for (const f of ["live-verify.mjs", "mail-verify.mjs"]) {
      expect(fs.existsSync(path.resolve(__dirname, "..", "scripts", f))).toBe(true);
    }
  });

  it("a non-zero verdict from either vantage point fails the run", () => {
    // A status report that always exits 0 is a report nobody can gate on.
    expect(lv).toMatch(/\[ \$EDGE -eq 0 \] && \[ \$APP -ne 1 \] && \[ \$MAIL -eq 0 \] \|\| exit 1/);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────
 * A MEDIA NODE MUST NEVER BE DEPLOYED TO OR WRITTEN TO.
 *
 * THE HAZARD IS SPECIFIC AND IT IS ONE I CREATED. Two mediasoup media nodes now exist in the
 * account, and every SSM target in these workflows is `tag:Name=relay-app`. If either node
 * carries that tag, `deploy.yml` — which runs on EVERY push to main with `--max-errors 0` —
 * would install the app on it, fail the `/api/health` probe there, and ABORT THE WHOLE FLEET
 * DEPLOY. Whether they do carry it CANNOT be established from this repo: every EC2 call
 * filters on that one tag and nothing records what those instances were named.
 *
 * So the guard is not a tag check. `/opt/relay-voip` is evidence the HOST ITSELF carries — an
 * app box never has it — which cannot go stale the way a tag list or a hardcoded instance id
 * would, and needs no AWS read to be correct.
 *
 * ONE GUARD GIVES TWO DIFFERENT CORRECT BEHAVIOURS, and that is worth stating because
 * treating the two kinds of command the same WOULD be a bug:
 *   - a FLEET command (deploy, env-set, ses-ssm) wants a silent skip, so the guard exits 0;
 *   - a SINGLE-INSTANCE command that must run exactly once (admin-tool, recover-identity)
 *     must NOT silently skip, because an operator would believe the operation ran. Those two
 *     read a printed marker (`ADMIN_EXIT=0` / `RECOVER_EXIT=0`) and fail when it is absent —
 *     and the guard never prints one, so exiting 0 there FAILS the step loudly with
 *     SKIP_MEDIA_NODE in the output saying exactly why.
 * ────────────────────────────────────────────────────────────────────────────────────── */
describe("no workflow can deploy to or write to a mediasoup media node", () => {
  /* `OPS` is already read once at module scope with a resolved path; reading it again here
     would be a second source of truth for the same file. `DEPLOY` follows the same resolution
     so the suite does not depend on the process's working directory. */
  const DEPLOY = fs.readFileSync(
    path.resolve(__dirname, "..", ".github", "workflows", "deploy.yml"),
    "utf8",
  );

  it("the rolling deploy refuses a media node BEFORE it fetches anything", () => {
    /* First command, so nothing is even downloaded onto a box that is not an app server. */
    const cmds = DEPLOY.slice(DEPLOY.indexOf("--parameters 'commands=["));
    const first = cmds.slice(0, cmds.indexOf('",'));
    expect(first, "the guard must be the FIRST remote command").toMatch(/\/opt\/relay-voip/);
    expect(first).toMatch(/SKIP_MEDIA_NODE/);
    expect(first, "and it must exit 0, or a media node aborts the fleet deploy").toMatch(/exit 0/);
  });

  it("the guard is defined ONCE in aws-ops, not pasted per action", () => {
    /* Five call sites reference it. A copy each is exactly how one comes to be forgotten —
       the class this repo keeps paying for. */
    expect(OPS).toMatch(/MEDIA_NODE_GUARD: '.*\/opt\/relay-voip.*'/);
    /* DERIVED rather than a literal count, and my first draft got that literal wrong — it said
       five where there are six. A hardcoded number is also exactly what goes stale on the
       seventh action somebody adds, so the property is stated instead: every `jq -n` that
       builds an SSM `commands:` array must reference the one definition. */
    const builders = OPS.match(/jq -n[^\n]*\{commands:\[/g) ?? [];
    expect(builders.length, "there must be some to check").toBeGreaterThan(3);
    for (const b of builders) {
      expect(b, `an SSM param builder with no guard: ${b.slice(0, 70)}…`).toContain(
        "$MEDIA_NODE_GUARD",
      );
    }
  });

  it("EVERY tag-targeted SSM command carries it — a sweep, not a list of today's five", () => {
    /* A list would go stale on the sixth action somebody adds. This reads every
       `ssm send-command` in the file and requires each tag-targeted one to be guarded, so a
       new action is covered rather than exempt. */
    const lines = OPS.split("\n");
    const unguarded: number[] = [];
    lines.forEach((l, i) => {
      if (!l.includes("ssm send-command")) return;
      const window = lines.slice(Math.max(0, i - 25), i + 6).join("\n");
      const tagTargeted = window.includes("Key=tag:Name");
      const guarded = window.includes("MEDIA_NODE_GUARD") || window.includes("/opt/relay-voip");
      if (tagTargeted && !guarded) unguarded.push(i + 1);
    });
    expect(unguarded, `tag-targeted and unguarded at line(s): ${unguarded.join(", ")}`).toEqual([]);
  });

  it("the two single-instance DB operations are guarded too, and FAIL rather than skip", () => {
    /* Both pick ONE instance from the same tag filter, so a media node can be the one picked.
       Skipping silently there would leave an operator believing an admin operation ran. The
       marker check is what turns the skip into a loud failure — asserted here so a future
       change that drops the marker check does not quietly make the guard dangerous. */
    for (const marker of ["ADMIN_EXIT=0", "RECOVER_EXIT=0"]) {
      expect(OPS, `${marker} must still be required`).toContain(marker);
    }
    for (const script of ["admin-tool.mjs", "recover-orphan-identity.mjs"]) {
      const at = OPS.indexOf(script);
      expect(at, script).toBeGreaterThan(0);
      const region = OPS.slice(at, at + 900);
      expect(region, `${script} must be guarded`).toMatch(/MEDIA_NODE_GUARD/);
    }
  });

  it("the coturn probe is DELIBERATELY unguarded, and cannot select a media node anyway", () => {
    /* The one `ssm send-command` without the guard targets the RELAY hosts by matching
       `TURN_HOSTS` addresses against SSM-managed IPs. A media node's IP is not in TURN_HOSTS,
       so it can never be selected — and that command is read-only (`ss -lnt`, a config grep).
       Recorded as a decision rather than left looking like the one that was missed. */
    const at = OPS.indexOf("--instance-ids $RELAY_IIDS");
    expect(at, "the coturn probe must still select by resolved IP").toBeGreaterThan(0);
    const window = OPS.slice(Math.max(0, at - 900), at + 400);
    expect(window, "selected from TURN_HOSTS, never from the app tag").not.toContain(
      "Key=tag:Name",
    );
    expect(window, "and it must stay read-only").not.toMatch(/pm2 |rm -f|> \/home\/relay/);
  });

  it("the guard cannot match an app box, which is what makes it safe to exit 0", () => {
    /* If the discriminator could be true on a real app server, every deploy would silently
       skip the fleet and report success — the worst possible failure of this guard. It keys on
       a directory that only the media agent's own install creates. */
    expect(OPS).toMatch(/MEDIA_NODE_GUARD:.*\[ -d \/opt\/relay-voip \]/);
    // And the agent really does live there, or the guard is checking nothing.
    expect(
      fs.readFileSync(path.resolve(__dirname, "..", "voip-node", "relay-voip-agent.service"), "utf8"),
    ).toMatch(/\/opt\/relay-voip/);
  });
});

/**
 * v2.106.48 — `create-account` adds two FREE-TEXT inputs on the path that executes a
 * command string on production EC2. That class has bitten this file three times
 * (SES_EMAIL/DOMAIN, then `region`, then the recover inputs), so both get the
 * established base64-on-runner / decode-on-instance treatment, and it was replayed
 * empirically against 8 hostile payloads (0 executed, each arriving as ONE literal
 * argument) before shipping.
 */
describe("admin-tool create-account inputs cannot break out of the remote command", () => {
  // The region must START at the env block (which sits BEFORE the `run:` script, so
  // an "ADMIN TOOL" anchor misses every ADM_* assignment) and it must be sliced from
  // the ADMIN-TOOL step specifically — `recover-identity` also builds a
  // `CMDLINE="cd /home/relay/app …"`, so a whole-file indexOf finds THAT one first.
  const stepStart = OPS.indexOf("ADM_OP: ${{ inputs.admin_op }}");
  const stepEnd = OPS.indexOf('echo \\"ADMIN_EXIT=', stepStart);
  const step = OPS.slice(stepStart, stepEnd);

  it("both new free-text values are base64'd on the runner", () => {
    expect(step).toMatch(/ADM_PIN_B64=\$\(printf %s "\$ADM_PIN" \| base64 -w0\)/);
    expect(step).toMatch(/ADM_NAME_B64=\$\(printf %s "\$ADM_NAME" \| base64 -w0\)/);
  });

  it("the command line interpolates ONLY the encoded forms, never the raw values", () => {
    const line = step.slice(step.indexOf("CMDLINE="));
    expect(line).toContain("$ADM_PIN_B64");
    expect(line).toContain("$ADM_NAME_B64");
    // The raw shell variables must not reach the string that runs on the instance.
    expect(line).not.toMatch(/\$ADM_PIN[^_]/);
    expect(line).not.toMatch(/\$ADM_NAME[^_]/);
  });

  it("the op is whitelisted and the passcode shape is checked before anything runs", () => {
    expect(step).toMatch(/whois\|grant-admin\|revoke-admin\|set-number\|create-account\) : ;;/);
    expect(step).toMatch(/\[0-9\]\[0-9\]\[0-9\]\[0-9\]\) : ;;/);
    expect(step).toMatch(/create-account needs BOTH admin_email and admin_pin/);
  });

  it("EVERY free-text admin input on this path is encoded — the guard against a sixth", () => {
    // Enumerated from the assignments themselves rather than a hand-kept list, so
    // the input somebody adds next is covered instead of exempt.
    const assigns = step.match(/ADM_[A-Z]+: \$\{\{ inputs\.[a-z_]+ \}\}/g) || [];
    expect(assigns.length).toBeGreaterThanOrEqual(6);
    const line = step.slice(step.indexOf("CMDLINE="));
    // CLOSED-SET VALUES ARE EXEMPT, and the exemption is named rather than the rule
    // relaxed (v2.99.76 recorded this decision): `admin_op` is a `choice` that the
    // step re-whitelists with its own `case`, and the two booleans are compared
    // against the literal "true" and never interpolated at all. Everything that is
    // FREE TEXT must be encoded.
    const CLOSED = ["ADM_OP", "ADM_APPLY", "ADM_ALLOW_RESERVED"];
    // Prove the exemption is earned rather than asserted: the op really is
    // whitelisted, so a value outside the set cannot reach the command line.
    expect(step).toMatch(/whois\|grant-admin\|revoke-admin\|set-number\|create-account\) : ;;/);
    expect(step).toMatch(/\*\) echo "::error::unknown admin_op/);
    let checked = 0;
    for (const a of assigns) {
      const v = a.split(":")[0]; // e.g. ADM_PIN
      if (CLOSED.includes(v)) continue;
      // A free-text value is either absent from the command line, or present ONLY
      // in its base64 form.
      if (line.includes(v)) {
        expect(line, `${v} must reach the instance base64-encoded`).toContain(`${v}_B64`);
        checked++;
      }
    }
    // Non-vacuity: the sweep must actually have examined the free-text values.
    expect(checked).toBeGreaterThanOrEqual(4);
  });
});
