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
  it("offers the ops actions with verify as the safe default (v2.97.2 adds ses/ses-ssm/iam-grant-ses)", () => {
    expect(OPS).toMatch(/options: \[verify, cloudfront, alb-tune, ses, ses-ssm, iam-grant-ses\]/);
    expect(OPS).toMatch(/default: verify/);
  });
  it("region input defaults to ap-south-1; auth prefers access keys but falls back to the deploy OIDC role", () => {
    expect(OPS).toMatch(/default: ap-south-1/);
    expect(OPS).toMatch(/aws-actions\/configure-aws-credentials@v4/);
    expect(OPS).toMatch(/aws-access-key-id: \$\{\{ secrets\.AWS_ACCESS_KEY_ID \}\}/);
    expect(OPS).toMatch(/aws-secret-access-key: \$\{\{ secrets\.AWS_SECRET_ACCESS_KEY \}\}/);
    // v2.97.1: no ops secrets configured ⇒ assume the deploy pipeline's role.
    expect(OPS).toMatch(/role-to-assume: arn:aws:iam::342494841476:role\/relay-github-deploy/);
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
