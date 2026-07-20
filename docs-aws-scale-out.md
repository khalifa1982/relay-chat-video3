# RELAY on AWS — scaling `your-chat.io` beyond one box (v2.91)

Companion to `docs-aws-io-deploy.md` (single-box provisioning, deploy pipeline).
This runbook takes the `.io` fleet from "1 EC2 behind an Elastic IP" to
"2 EC2 behind an ALB (+ optional CloudFront), with Redis fanning out realtime
events" — **without violating the repo's hard invariant**:

> `server/relay.ts`'s call/signaling registry is **in-memory, single-process**.
> Its call-state transitions (ring replacement, call-waiting hold/promote,
> grace-reap vs rejoin races) are only correct because they run atomically in
> one Node event loop. Cross-instance rooms are **phase 2** with its own
> design — do NOT try to load-balance `/api/relay/*`.

So the scale-out shape is a **tiered ALB**:

| Traffic | Routing | Why |
|---|---|---|
| `/api/relay/*` (call signaling: SSE stream + send + ICE) | **ONE instance** (the "signaling node", target group `relay-signaling`) | in-memory registry, single-process by design |
| everything else — SPA, tRPC, uploads, `/manus-storage/*`, **`/api/v2/events`** | **both instances** (default rule) | stateless per-request; v2 SSE events reach the right stream on ANY instance **because the Redis bus fans them out** (v2.91, `server/redisBus.ts`) |

Three independent v2.91 building blocks make the "everything else" tier true:

1. **Redis event bus** (`REDIS_URL`): every instance publishes v2 events
   (messages, typing, read, presence, call_offer, watched_online) to
   `relay:v2ev` and delivers foreign instances' events to its local
   `/api/v2/events` streams. The signaling node also mirrors busy-line +
   party-line live counts into `relay:busypins` / `relay:plcounts` (90s TTL,
   30s re-sync) so the API tier's `directory.lookup` / `presenceMany` /
   `contacts.list` stay truthful.
2. **Native S3 storage** (`S3_*`): uploads/downloads stop depending on the
   Manus Forge proxy; both instances serve `/manus-storage/*` by presigning
   locally (`server/s3.ts`, zero-dep SigV4).
3. **Tiered routing** (this doc §2 / the `alb-tune` workflow action).

Unset, each falls back to today's behavior — `.org` on Manus is untouched.

---

## 0 · Order of operations (matters!)

1. §1 ElastiCache Redis **created** (but `REDIS_URL` not yet in `.env`).
2. §2 ALB + tiered routing **live** (signaling pinned to instance A).
3. §3 flip the env: add `REDIS_URL` (+ optionally `S3_*`) to `/home/relay/.env`
   on BOTH instances, `pm2 startOrReload`.
4. §4 CloudFront (optional, via `aws-ops.yml`) + DNS cut-over.

Why 2-before-3: the busy-state mirror assumes a **single writer** (only the
signaling node has relay clients). If both instances still receive
`/api/relay/*` when Redis goes live, both write `relay:busypins` and fight.
The keys self-heal (90s TTL) but the interim data is noise. Rule first, then
Redis.

---

## 1 · ElastiCache Redis (the bus)

**Console** (ElastiCache → Redis OSS caches → Create):

1. **Deployment option**: Design your own cache → **Cluster cache**,
   **Cluster mode: DISABLED** (the bus uses plain pub/sub + a few keys — no
   keyspace sharding wanted; ioredis speaks to the single primary endpoint).
2. **Name**: `relay-bus`. **Node type**: `cache.t4g.micro` (one node is
   plenty: the bus carries tiny JSON envelopes + two small keys). **Replicas**:
   0 (dev/perf realm) or 1 for prod comfort.
3. **Subnet group**: create one containing the **same VPC + subnets as the
   relay-app EC2 instances**.
4. **Security**: encryption in transit OFF (VPC-internal; the app URL below is
   `redis://`; if you enable TLS use `rediss://` instead). Create/pick a
   security group `relay-redis-sg` and add an **inbound rule: TCP 6379, source
   = the EC2 instances' security group** (not 0.0.0.0/0 — ElastiCache is never
   internet-exposed).

**CLI equivalent**:

```bash
aws elasticache create-cache-subnet-group --cache-subnet-group-name relay-bus-subnets \
  --cache-subnet-group-description "relay app subnets" \
  --subnet-ids subnet-XXXX subnet-YYYY

aws ec2 create-security-group --group-name relay-redis-sg \
  --description "redis 6379 from relay-app" --vpc-id vpc-XXXX
aws ec2 authorize-security-group-ingress --group-id sg-REDIS \
  --protocol tcp --port 6379 --source-group sg-RELAY-APP

aws elasticache create-cache-cluster --cache-cluster-id relay-bus \
  --engine redis --cache-node-type cache.t4g.micro --num-cache-nodes 1 \
  --cache-subnet-group-name relay-bus-subnets --security-group-ids sg-REDIS
```

Get the endpoint once available. **The two provisioning paths create different
resource types**, so the lookup differs:

```bash
# CONSOLE path ("Cluster cache" creates a REPLICATION GROUP named relay-bus,
# whose member clusters are relay-bus-001/-002 — describe-cache-clusters on
# "relay-bus" fails CacheClusterNotFoundFault). Use the group's PRIMARY
# endpoint (or copy "Primary endpoint" from the console's cache details page):
aws elasticache describe-replication-groups --replication-group-id relay-bus \
  --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint'

# CLI path above (create-cache-cluster = a plain single-node cache cluster):
aws elasticache describe-cache-clusters --cache-cluster-id relay-bus \
  --show-cache-node-info \
  --query 'CacheClusters[0].CacheNodes[0].Endpoint.{Address:Address,Port:Port}'
```

> **`REDIS_URL` must be the PRIMARY endpoint whenever a replica exists.** A
> node/reader endpoint can land on the replica, where every busy-sync write
> fails `READONLY` and subscribing/publishing on the replica splits the bus —
> while everything *looks* configured. (With 0 replicas the single node IS the
> primary and either lookup works.)

> Don't add `REDIS_URL` to the servers yet — finish §2 first (see §0).

---

## 2 · ALB + tiered routing

> The `alb-tune` action of `.github/workflows/aws-ops.yml` automates the
> timeout + target-group + rule part of this section idempotently. The
> one-time ALB/listener creation below is manual either way.

### 2.1 One-time: the ALB itself

The single-box setup terminated TLS with Caddy on the instance. Behind an ALB,
the ALB terminates TLS and talks HTTP to port **3000** directly (stop/disable
Caddy after cut-over, or leave it — it just stops receiving traffic).

1. **ACM (ap-south-1)**: request a DNS-validated cert for `your-chat.io` +
   `www.your-chat.io`. Add the printed validation CNAMEs at your DNS panel;
   wait for **ISSUED**. (This regional cert is for the ALB. CloudFront needs a
   SEPARATE one in us-east-1 — the `cloudfront` workflow action handles that.)
2. **Second EC2**: launch a clone of the first (same AMI/user-data or repeat
   `docs-aws-io-deploy.md` §2), same VPC, **tag `Name=relay-app`** (the deploy
   + ops workflows target this tag), same instance IAM role. The deploy
   workflow is already fleet-shaped (`--max-concurrency 1` rolling over every
   tagged instance) — the next green deploy installs the app on it.
3. **Target group `relay-default`** (EC2 → Target groups → Create):
   - Target type **Instances**, protocol **HTTP : 3000**, the fleet VPC.
   - Health check: HTTP `GET /api/health` (interval 15s, healthy 2, unhealthy 3).
   - Register **BOTH** relay-app instances, port 3000.
4. **ALB** (EC2 → Load balancers → Create → Application Load Balancer):
   - Name **`relay-alb`** (the workflows find it by this name), scheme
     **internet-facing**, the fleet VPC, ≥2 public subnets.
   - Security group: inbound 443 + 80 from the world; and allow the ALB SG →
     instance SG on TCP 3000 (instances no longer need 80/443 from the world).
   - Listener **HTTPS : 443** → forward to `relay-default`, certificate = the
     ap-south-1 ACM cert from step 1.
   - Add listener **HTTP : 80** → redirect to HTTPS 443 (301).

### 2.2 The signaling pin (console)

1. **Target group `relay-signaling`**: same as `relay-default` (Instances,
   HTTP:3000, health check `/api/health`) but register **ONLY instance A**
   (pick one — the workflows use the oldest-launched — and be consistent).
2. **Listener rule** (EC2 → Load balancers → relay-alb → Listeners →
   HTTPS:443 → Manage rules → Add rule):
   - Condition: **Path** is `/api/relay/*`
   - Action: **Forward** to `relay-signaling`
   - **Priority 10** (anything above the default rule — the default rule
     always evaluates last).
   - Leave the **default rule → `relay-default` (both instances)** untouched.
3. **Idle timeout 300s** (Load balancer → Attributes → Edit): the relay SSE
   stream and `/api/v2/events` are long-lived; both heartbeat every 25s, but
   the ALB default of 60s idle would still sever any stream that pauses —
   300s gives 12× heartbeat headroom.

### 2.2-CLI equivalent

```bash
VPC=vpc-XXXX; ALB_ARN=$(aws elbv2 describe-load-balancers --names relay-alb \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)

# idle timeout for SSE
aws elbv2 modify-load-balancer-attributes --load-balancer-arn "$ALB_ARN" \
  --attributes Key=idle_timeout.timeout_seconds,Value=300

# signaling target group — INSTANCE A ONLY
TG=$(aws elbv2 create-target-group --name relay-signaling --protocol HTTP \
  --port 3000 --vpc-id "$VPC" --target-type instance \
  --health-check-protocol HTTP --health-check-path /api/health \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
aws elbv2 register-targets --target-group-arn "$TG" --targets Id=i-INSTANCE-A,Port=3000

# pin /api/relay/* to it, above the default rule
LISTENER=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" \
  --query 'Listeners[?Port==`443`].ListenerArn | [0]' --output text)
aws elbv2 create-rule --listener-arn "$LISTENER" --priority 10 \
  --conditions Field=path-pattern,Values='/api/relay/*' \
  --actions Type=forward,TargetGroupArn="$TG"
```

### 2.3 Why `/api/v2/events` is NOT pinned

The v2 SSE bus (messages/typing/read/presence/call_offer toasts) stays on the
**default, load-balanced** rule on purpose: with `REDIS_URL` set, an event
published on instance B reaches a stream held by instance A through the
`relay:v2ev` channel (v2.91, `server/v2events.ts` + `server/redisBus.ts`).
Pinning it would just concentrate load for no correctness gain. Without
`REDIS_URL` you MUST NOT scale to two instances at all — events and busy
LEDs would silently miss users on the other box.

### 2.4 If instance A dies

Signaling fails over MANUALLY (by design — phase 2 owns automatic failover):
register instance B in `relay-signaling`, deregister A (or run the `alb-tune`
workflow action after stopping A — it re-pins to the oldest RUNNING
instance). In-flight calls drop (the registry is memory); clients auto-rejoin
rooms don't survive a node swap, but new calls work immediately. The
`relay:busypins` ghosts from the dead node clear via the 90s TTL.

---

## 3 · Flip the env on the fleet

On **each** instance (values from §1; SSH or SSM Session Manager):

```bash
sudo -u relay tee -a /home/relay/.env >/dev/null <<'EOF'
# v2.91 scale-out — the PRIMARY endpoint from §1 (console path shape shown;
# a plain CLI-created cache cluster's node endpoint looks like
# relay-bus.XXXXXX.0001.aps1.cache.amazonaws.com instead)
REDIS_URL=redis://master.relay-bus.XXXXXX.aps1.cache.amazonaws.com:6379
# native S3 storage (optional but recommended — no Manus Forge on .io):
S3_BUCKET=relay-io-media
S3_REGION=ap-south-1
S3_ACCESS_KEY=AKIA…            # IAM user scoped to THIS bucket only
S3_SECRET=…
# S3_PREFIX=relay-chat/        # default; uncomment to change
EOF
sudo -u relay bash -lc "pm2 startOrReload /home/relay/ecosystem.config.cjs --update-env"
```

- `REDIS_URL` shape: `redis://<PRIMARY-endpoint>:6379` (no auth token by
  default inside the VPC; use `rediss://` + token if you enabled TLS/AUTH).
  It must be the **primary** endpoint whenever a replica exists — never a
  node/reader endpoint, which can point at the replica (writes fail
  `READONLY`, the bus silently splits; see §1).
- S3 side: create a private bucket + an IAM user whose policy allows only
  `s3:PutObject`/`s3:GetObject` on `arn:aws:s3:::relay-io-media/*`. The app
  uploads server-side and hands browsers 300s-presigned GETs via
  `/manus-storage/*` 307 redirects — the bucket stays fully private, no
  public access, no bucket policy needed.
- `ecosystem.config.cjs` parses `.env` itself — `--update-env` + reload is
  enough, no repo change needed. **`instances: 1` stays** (see the file's
  header; scaling is horizontal via this runbook, never pm2 cluster mode).

---

## 4 · CloudFront + DNS (optional edge)

Run the `cloudfront` action of **`.github/workflows/aws-ops.yml`** (needs the
`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` repo secrets). It:

1. ensures a us-east-1 ACM cert for `your-chat.io`+www (prints the validation
   CNAMEs and exits if pending — add them, re-run);
2. creates/updates the distribution: ALB origin (https-only + AllViewer on
   **every** behavior — the forwarded viewer Host is what matches the ALB's
   cert; the ALB's own `*.elb.amazonaws.com` name never would), default
   behavior CachingDisabled+compress, `/assets/*` CachingOptimized+AllViewer
   (hashed immutable assets; AllViewer shapes only the origin request, not
   the cache key), `/api/relay/stream*` + `/api/v2/events*` explicitly
   CachingDisabled with a 60s origin response timeout (both streams
   heartbeat every 25s, so the timeout never trips), HTTP/2+3;
3. prints the `dXXXX.cloudfront.net` domain and the exact DNS change.

**Go/no-go before the DNS change**: wait for distribution status *Deployed*,
then verify with a **Host override** — plain `https://dXXXX.cloudfront.net`
can NEVER pass (it forwards the cloudfront.net Host, which the ALB's
certificate doesn't match, so it 502s even when everything is healthy):

```bash
curl -si https://dXXXX.cloudfront.net/api/health -H "Host: your-chat.io"
# expect HTTP 200 from the fleet, via CloudFront
```

**DNS (you, manually — the workflow never touches DNS)**: point
`your-chat.io` (ALIAS/flattened-CNAME) and `www` (CNAME) at the printed
CloudFront domain — replacing the old A→Elastic-IP records from the
single-box setup. Roll back by restoring the A records. The ops key's exact
IAM actions per workflow action are enumerated in the `aws-ops.yml` header.

---

## 5 · Verify

```bash
# 1. tiering: the signaling stream opens and STAYS open >60s (idle timeout ok)
curl -N -m 70 -s "https://your-chat.io/api/relay/stream?cid=verify$(date +%s)" | head -c 200

# 2. two browsers, one per instance (repeat until you hit both — the ALB
#    round-robins): messages + typing indicators must flow BOTH ways
#    (that's the Redis bus), and calls must connect (that's the pinned rule).

# 3. busy LEDs across tiers: put phone A in a call, then from a browser that
#    landed on the OTHER instance check the contact's amber "on a call" LED.

# 4. Redis state, from an instance:
redis-cli -h <primary-endpoint> smembers relay:busypins
redis-cli -h <primary-endpoint> ttl relay:busypins        # ≤90, refreshed

# 5. read-only account sweep:
#    GitHub → Actions → "AWS ops (your-chat.io)" → action=verify
```

## 6 · Explicitly out of scope (phase 2)

- **Cross-instance relay rooms / mesh signaling** — see the invariant at the
  top and the header of `server/redisBus.ts`.
- **Automatic signaling failover** (§2.4 is manual).
- **Sticky sessions**: not needed — identity rides cookies, v2 events ride
  the bus, uploads are stateless, and signaling is pinned by path.
