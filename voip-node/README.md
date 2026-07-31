# RELAY media node (mediasoup)

This directory is the agent that runs **on a media node**. It is not part of the app.

## Why it is a separate package

Two independent reasons, and both are the kind of thing that looks like tidiness until it
costs a deploy:

1. **The app must never depend on `mediasoup`.** The server bundle is built with
   `esbuild --packages=external`, and every app instance runs
   `pnpm install --frozen-lockfile` on **every** deploy. A root `mediasoup` dependency would
   therefore make each app box fetch or compile a ~9.7 MB C++ worker binary it never
   executes, on every release. `server/voipNodeParity.test.ts` fails the build if `mediasoup`
   appears in the root `package.json`, and if `deploy.yml`'s release tar ever includes
   `voip-node`.

2. **Media cannot sit behind the load balancer.** Signaling is one endpoint (the ALB, any
   instance). Media is a live UDP flow that has to reach the *exact* host holding that room's
   mediasoup router — so each node is addressed by its own public IP, and the app learns
   those from a registry rather than from config.

## The two nodes (Mumbai, one per AZ)

| zone | instance | private | public |
|---|---|---|---|
| ap-south-1a | `i-062022390e558ce74` | 10.0.1.192 | 13.201.44.153 |
| ap-south-1b | `i-0dce71f5056f73ce6` | 10.0.2.246 | 13.203.219.67 |

**Those public IPs are auto-assigned, not Elastic.** They change if an instance is stopped
and started. Nothing in this repo may hardcode them: the agent reads its own address from
IMDSv2 at boot (and re-reads it every 60s), publishes it to the registry, and the app reads
the registry. The table above is for humans checking a node by hand.

An Elastic IP per node is still worth having — it makes the address survive a stop/start and
lets a DNS name point at it — and is blocked on an EIP quota increase (request
`26f4f2b67b7544c8b0f9b65529ba6ce6A3fUyxSF`). Nothing depends on it, because self-reporting
is correct either way.

## What is here

- **`agent.mjs`** — one mediasoup worker per core, a router per room, WebRTC transports
  announcing this node's public IP, an HMAC-authenticated JSON API on `VOIP_API_PORT`
  (VPC-internal only), an `audioLevelObserver` per room, and a heartbeat into the registry.
- **`record.mjs`** — just the registry record shape. Deliberately importable and
  side-effect-free so the parity test can drive it; **keep the `mediasoup` import out of
  this file.**
- **`relay-voip.service`** — the systemd unit.

The app half is `server/voipRegistry.ts` (node selection, freshness, transport precedence)
with `server/voipRegistry.test.ts` and `server/voipNodeParity.test.ts`.

## The app fleet's workflows will never touch this box

`deploy.yml` runs on every push to `main` and targets **`tag:Name=relay-app`** with
`--max-errors 0`. If a media node carried that tag, the deploy would try to install the app here,
fail its `/api/health` probe, and **abort the whole fleet deploy** — so a push to main would stop
deploying at all. Every `aws-ops.yml` action targets the same tag.

Both are now guarded, and the guard does **not** depend on a tag:

```sh
if [ -d /opt/relay-voip ]; then echo SKIP_MEDIA_NODE; exit 0; fi
```

That directory is evidence this host carries about itself — an app box never has it — so it cannot
go stale the way a tag list or a hardcoded instance id would, and it needs no AWS read to be right.
It is the **first** remote command, so nothing is even downloaded here.

One guard, two correct behaviours, because the callers differ:

| command | behaviour on a media node | why that is right |
|---|---|---|
| `deploy`, `env-set`, `ses-ssm` | silent skip, exit 0 | fleet-wide; a media node in the target set must cost nothing |
| `admin-tool`, `recover-identity` | the step **FAILS** | they pick ONE instance and require a printed `ADMIN_EXIT=0` / `RECOVER_EXIT=0`; the guard prints neither, so a skip cannot be mistaken for a completed admin operation |

The coturn probe in `verify` is deliberately unguarded: it selects the relay hosts by matching
`TURN_HOSTS` addresses against SSM-managed IPs, so a media node can never be selected, and it is
read-only.

**Still worth doing, owner-side:** tag these two instances something of their own (`relay-voip`)
rather than relying on the guard. The guard makes a mis-tag harmless; a correct tag makes the
`verify` action's instance table readable, and stops `aws-ops` reporting a media node as part of the
app fleet. Nothing in the repo records what they are currently named, which is exactly why the
guard keys on the filesystem instead.

## Install / update

Run on each media node. `/opt/relay-voip` already exists with mediasoup 3.19.3 installed and
its worker compiled, so an update is the two `.mjs` files plus a restart.

```bash
# 1. copy agent.mjs + record.mjs + package.json into /opt/relay-voip
#    (from the repo, or via SSM send-command — NOT from the app release tar)

# 2. first time only: the env file with the secrets
sudo install -d -m 0750 -o root -g relay /etc/relay-voip
sudo tee /etc/relay-voip/env >/dev/null <<'EOF'
VOIP_NODE_SECRET=<same value as the app fleet's VOIP_NODE_SECRET>
REDIS_URL=redis://<the same ElastiCache endpoint the app uses>:6379
EOF
sudo chmod 0640 /etc/relay-voip/env
sudo chown root:relay /etc/relay-voip/env

# 3. the unit
sudo cp /opt/relay-voip/relay-voip.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now relay-voip
```

`VOIP_NODE_SECRET` and `REDIS_URL` are real secrets. They belong in
`/etc/relay-voip/env` — never in this repo, never in a `workflow_dispatch` input (inputs are
visible in run metadata).

## Verify

```bash
# the agent is up and knows its own address
systemctl status relay-voip --no-pager
journalctl -u relay-voip -n 40 --no-pager

# it registered (run from an app instance, which can reach Redis)
redis-cli -u "$REDIS_URL" smembers relay:voip:nodes
redis-cli -u "$REDIS_URL" get relay:voip:node:i-062022390e558ce74
```

A healthy record carries this node's own `publicIp`, its `az`, `cores`, and an `updatedAt`
within the last 15 seconds. If the key is missing while the service is running, the agent
either cannot reach Redis or is publishing something the app refuses — the parity test exists
so the second case cannot happen silently, but check `journalctl` first.

The registry is the app's only read path; there is no health endpoint to poll. A node that
stops heartbeating disappears from selection within `NODE_TTL_MS` (15s) on its own.

## Four API facts, read off mediasoup's own declarations rather than the docs

Three planning decisions rested on documentation. These are the answers from the installed
`.d.ts`, so they can be relied on.

**1. `announcedAddress` is IMMUTABLE per transport.** It appears only inside
`TransportListenInfo` — a creation option — and there is no setter on `Transport`, `WebRtcServer`
or anywhere else in the type surface. Consequence: **an Elastic IP attached to a running node
cannot be picked up by transports that already exist.** Live calls on that node keep announcing
the old address and their media stops arriving; new rooms are fine once the agent's cached
address refreshes.

That refresh is now on `NODE_TTL_MS` rather than 60s, and the reason is worth stating: **the app
cannot detect a stale cache.** This agent is the sole source of the address, so a stale value is
published in the heartbeat too — the app's `assignmentStillValid` compares the address it was
given against the address the node reports, both are the same stale value, they agree, and
nothing looks wrong. There is no second opinion to disagree with. Reading IMDS at
transport-creation time was rejected: that puts a round trip on the call-setup path.

**So when the EIP quota lands, attach during a maintenance window, or accept that calls in
progress on that node break.**

**2. `listenInfos` and `webRtcServer` are still mutually exclusive** in 3.23 as in 3.19 —
`Either<Either<listenInfos, listenIps>, webRtcServer>`. `listenIps` and `announcedIp` are both
`@deprecated`. A conversion must supply **two** `listenInfos` entries (udp *and* tcp) or it
silently ships UDP-only.

**3. `createWebRtcServer` is on `Worker`, not `Router`,** and `Router` does not expose its
worker. A room must therefore record the `{router, webRtcServer}` pair rather than deriving one
from the other.

**4. `producer.replaceTrack({track})` exists on the client**, so one video producer per
participant can carry camera *or* screen — which matches how RELAY's screen share already works
(`replaceVideoEverywhere` swaps the track on the existing publication) and avoids two video
consumers racing one tile.

### `mediasoup-client` is deliberately NOT a dependency yet

It was installed to answer fact 4 above and then removed. Nothing imports it, so it was an unused
package that would be installed on both app boxes on every deploy and shipped in no bundle — and
this repo removed six such packages in one release (v2.99.54) and hand-writes its SMTP client, S3
signer, FCM sender and GIF encoder rather than take a dependency at all. It comes back in the
increment that actually imports it, code-split, and the fact it was installed to establish is
already written down above.

### Versions are pinned EXACTLY, and the range was already lying

The live nodes were installed at **mediasoup 3.19.3**. A fresh `pnpm install` against `^3.19.3`
today resolves to **3.23.2** — four minor versions apart, with a compiled C++ worker per install
and nothing that would surface the difference until a call behaved differently on one box. The
deprecations above landed inside that range, which is exactly the drift a caret hides.

## What is deliberately NOT here

- **No `PipeTransport`.** A room is pinned to one node and is never split. Cross-node piping
  is a real feature with real failure modes; it is not needed for a 10-way call and would be
  its own change.
- **No server-side mixing.** This is an SFU, not an MCU.
- **No Auto Scaling group.** Nodes hold live calls and their addresses are advertised to
  connected clients; replacing one on a schedule would drop those calls.
- **No load balancer in front of the media ports**, for the reason at the top.
- **No change to coturn or `/api/relay/ice`.** The existing ephemeral-credential mechanism is
  untouched; the app composes a room's node with the coturn relay in the *same* zone.
