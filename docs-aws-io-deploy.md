# RELAY on AWS — self-hosted `your-chat.io` (Mumbai / ap-south-1)

A **parallel** deployment of the SAME `main` branch that Manus serves as
`your-chat.org`, for latency/perf testing. `.org` on Manus is **untouched**;
the Android APK stays on `.org`. Nothing in the source is domain-specific —
the app serves whatever Host it runs under and reads `APP_URL` from the
environment — so `.io` is set entirely by **env vars + DNS**, never a code edit.

> **Why no find-and-replace?** Both domains build from the same `main`. Hardcoding
> `.io` into the source would make Manus's next `.org` build serve `.io` too and
> break your live app. Env-driven is the only correct mechanism, and it's fully
> reversible.

---

## 0 · The two decisions that matter most (read first)

1. **Database.** The single biggest way to *ruin* a latency test: if the Mumbai
   app talks to a database hosted elsewhere (e.g. Manus's MySQL in another
   region), you'll measure cross-region DB round-trips, not hosting speed.
   - **For a clean latency test:** stand up MySQL **in ap-south-1** (RDS MySQL 8,
     or on-box) — *separate data* from `.org`. Users on `.io` are an isolated
     realm; that's fine for a perf test.
   - **For shared data** (same users/messages on both): point `.io` at the same
     MySQL as `.org` — but expect the DB latency to dominate unless that DB is
     also near Mumbai. Recommend the isolated ap-south-1 DB for the test.
2. **JWT_SECRET.** Reuse the **same** `JWT_SECRET` as Manus only if you want
   push (VAPID) keys and signed tokens to be identical across both. For an
   isolated `.io` test realm, a fresh secret is fine.

---

## 1 · AWS resources to provision (ap-south-1)

| Resource | Detail |
|---|---|
| **VPC + Security Group** | Inbound: 443 + 80 (world), 22 (your IP only). If TURN/coturn is colocated: 3478 tcp/udp + 49152–65535/udp. |
| **EC2** | Ubuntu 22.04, t3.small+ (t3.medium for calls). **Tag `Name=relay-app`** (the deploy targets this). Attach an **Elastic IP**. |
| **Instance IAM role** | `AmazonSSMManagedInstanceCore` (for SSM deploys) + read on the deploy bucket. |
| **MySQL** | RDS MySQL 8 in ap-south-1 (see §0). Note the connection string. |
| **S3 deploy bucket** | `relay-deploy-342494841476` (matches `deploy.yml`). Private. |
| **GitHub OIDC** | IAM OIDC provider `token.actions.githubusercontent.com` + role **`relay-github-deploy`** trusting `repo:khalifa1982/relay-chat-video3:*`, with permissions: `s3:PutObject` on the bucket + `ssm:SendCommand`/`ssm:ListCommandInvocations` on the tagged instances. |
| **DNS** | `your-chat.io` + `www.your-chat.io` **A → the Elastic IP**. (`.org` DNS stays pointed at Manus.) |
| **TLS** | Caddy or nginx+certbot terminating 443 for `your-chat.io`, reverse-proxying to `127.0.0.1:3000`. |

## 2 · On the EC2 box (one-time)

```bash
sudo useradd -m -s /bin/bash relay
# Node 22 + pnpm + pm2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
sudo npm i -g pnpm pm2
# pm2 process manager for the relay user
sudo -u relay bash -lc 'pm2 startup' # follow its printed command
```

`/home/relay/ecosystem.config.cjs`:
```js
module.exports = {
  apps: [{
    name: "relay",
    cwd: "/home/relay/app",
    script: "dist/index.js",
    env_file: "/home/relay/.env",
    instances: 1,
    max_memory_restart: "512M",
  }],
};
```

`/home/relay/.env` (chmod 600, owned by relay):
```ini
PORT=3000
NODE_ENV=production
APP_URL=https://your-chat.io
DATABASE_URL=mysql://USER:PASS@your-rds-endpoint:3306/relay
JWT_SECRET=...            # see §0.2
# optional, same as your Manus secrets if you want parity:
# TURN_HOST=... TURN_SECRET=...  LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...
# SMTP_HOST=... SMTP_PORT=587 SMTP_USER=... SMTP_PASS=... SMTP_FROM="RELAY <no-reply@your-chat.io>"
```

Initialize the schema once (the app also auto-migrates additive columns at boot):
```bash
sudo -u relay bash -lc 'cd /home/relay/app && pnpm db:push'
```

## 3 · First deploy

1. Confirm all of §1 exists (esp. the OIDC role trusting this repo).
2. GitHub → **Actions → "Deploy to AWS (your-chat.io)" → Run workflow** (it's
   **manual-only** on purpose). It builds `main`, pushes the artifact to S3, and
   SSM-deploys to every `relay-app` instance one at a time, gated on
   `GET /api/health` returning 200.
3. Browse `https://your-chat.io` — it identifies as `.io` automatically.
4. **To make it continuous:** once a manual run is green, uncomment the `push:`
   block in `.github/workflows/deploy.yml` — then every merge to `main`
   deploys `.io` while Manus independently keeps `.org` current.

## 4 · Rollback / safety

- `.org` (Manus) and the APK never change — they're a live fallback the entire
  time. If `.io` misbehaves, just don't point users/DNS at it; nothing to undo.
- Each release is in `s3://…/releases/<sha>.tar.gz`; redeploy an older SHA to
  roll the `.io` box back.

---

## What I (Claude) need to do the AWS side for you

I currently have **no AWS access** in this environment (`aws` CLI absent, no
credentials). To provision §1–§3 myself, add to this session a **scoped IAM
access-key pair** (an IAM user `relay-infra` with EC2/S3/VPC/IAM-role +
RDS permissions — *not* root), ideally as session secrets. Then I can create
the fleet, the OIDC role, the bucket, and wire DNS end-to-end, and hand you a
working `https://your-chat.io`. Delete/rotate that key in IAM the moment the
build-out is done — one click, and it's inert.
