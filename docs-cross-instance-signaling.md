# Cross-instance call signaling (phase-2)

**Goal:** calls ring and connect between two users no matter which app instance
each is connected to — with NO ALB pinning of `/api/relay/*`. This replaces the
"pin signaling to one instance" workaround (docs-aws-scale-out.md) with an
in-app solution so the fleet can scale horizontally and still place calls.

**Status:** IMPLEMENTED + tested (phases 1–3 done). Flag-gated, OFF by default.
When off (or single instance / no Redis), behavior is byte-identical to today —
verified: the 67 single-process signaling tests pass unchanged, and a
2-"instance" integration test (`server/relayCluster.integration.test.ts`) proves
a call rings + connects + relays SDP across instances.

## Best `.io` configuration (turn it on)

`.io` runs 2 EC2 instances behind the ALB with ElastiCache Redis. Cross-instance
signaling is now **on by default on `.io`**: `RELAY_CLUSTER=1` is baked into
`ecosystem.config.cjs` (the pm2 config the deploy copies onto every `.io`
server), so the next `main` deploy activates it fleet-wide with no manual server
edit. `REDIS_URL` is already set (verified live: `/api/health` → `redisBus:true`),
which is the other half of the `clusterEnabled()` gate.

- After the deploy, the two instances elect a leader over Redis; calls ring +
  connect regardless of which instance each user hit. `/api/health` returns
  `"cluster": true` and the in-app "calls misconfigured" banner suppresses itself.
- You do NOT need the ALB `/api/relay/*` pin (`aws-ops.yml alb-tune`); if you
  applied it, you can leave it (harmless) or remove the priority-10 rule. SSE
  connections stay load-balanced across both instances either way.
- To DISABLE on a given server, set `RELAY_CLUSTER=0` in `/home/relay/.env` (the
  `.env` spread overrides the baked-in default) and `pm2 startOrReload … --update-env`.

`ecosystem.config.cjs` is copied ONLY onto the AWS `.io` servers; `.org` (single
Manus instance) never uses it, so `.org` stays unclustered.

---

## Why it's hard

`server/relay.ts` holds ALL call state in memory, per process:
`clients` (pin→socket), `rooms` (rid→pins), `pinRoom`/`heldRoom` (call
membership + hold), `roomMeta`, `pendingRings`, grace timers, `dialEpoch`/
`ctxEpoch` glare guards, multi-device sockets. `handleMessage` mutates this
transactionally within one process. Two users on different instances never share
this map, so an `invite` on instance A can't find a callee registered on B → the
callee only gets the missed-call/paging fallback (exactly the reported bug). ICE
`signal`s can't cross either → no media on the calls that half-connect.

## The model — single signaling authority ("leader"), SSE proxied

The lowest-risk design that makes calls cross-instance **without rewriting the
state machine**: run the ENTIRE registry + `handleMessage` UNCHANGED on ONE
elected leader instance; every other instance is a dumb SSE transport proxy.

```
  Browser (user A)                 Browser (user B)
       │ SSE + POST                     │ SSE + POST
       ▼                                ▼
  Instance 1 (proxy)              Instance 2 (proxy)      ← SSE connections
       │  forward inbound                │  forward inbound   load-balanced,
       └───────────────┬─────────────────┘                   scale out freely
                       ▼  (Redis pub/sub)
                 Instance L = LEADER
             full registry + handleMessage   ← all call state, one authority
                       │  deliver(cid,obj)
       ┌───────────────┴─────────────────┐
       ▼                                 ▼
  Instance 1 writes SSE            Instance 2 writes SSE
```

- **SSE stays load-balanced.** A browser connects `/api/relay/stream` to ANY
  instance (its "home"). Long-lived SSE connections — the real scaling
  constraint — spread across the fleet.
- **Signaling logic centralizes on the leader.** It's light (ring + SDP/ICE
  relay); media is P2P/SFU and never touches the server. One leader handles the
  whole fleet's signaling comfortably at RELAY's scale.
- **The state machine is untouched.** On the leader, each peer is a *virtual*
  `RelaySocket` whose `send(obj)` publishes `{cid,obj}` to the peer's home
  instance instead of writing a local response. `handleMessage`, rooms, epochs,
  held calls, pending rings — all run exactly as today, on virtual sockets.

### Redis protocol (adds to the existing `server/redisBus.ts` bus)

Channels (per-boot `INSTANCE_ID` from redisBus):
- `relay:leader` — lease key. `SET relay:leader <id> NX PX 9000`, renewed every
  3s by the holder; on expiry any instance may win. `isLeader()`/`leaderId()`.
- `relay:sig:in:<leaderId>` — proxies forward inbound `{cid, homeInstance, raw}`
  (a raw `/api/relay/send` body, or synthetic `register`/`disconnect`) here.
- `relay:sig:out:<homeInstance>` — the leader publishes `{cid, obj}`; the home
  instance writes `obj` to its local SSE response for `cid`.

Directory (so the leader can route a delivery to a peer's home):
- The leader tracks `cid → homeInstance` from the register/inbound envelopes it
  receives — no extra store needed (the virtual socket closes over the home id).

### Message flow

1. **Register.** Browser SSE-connects to home H + sends `register`. H creates the
   local SSE writer, then forwards `{register, cid, homeInstance:H, name/device/
   flag}` to the leader. The leader runs the normal register path, building a
   virtual socket that routes to `relay:sig:out:H`.
2. **Invite / accept / signal / leave / …** H forwards the raw message to the
   leader; the leader runs `handleMessage` unchanged; every outbound `send`
   routes back to the right home instance's `relay:sig:out`.
3. **Disconnect.** H's SSE closes → H forwards a synthetic `disconnect{cid}` →
   the leader runs the existing grace/leave/reap logic.

### Leader is itself a proxy

The leader also serves browsers directly; for locally-homed peers the virtual
socket's `send` short-circuits to the local SSE writer (no Redis hop), so a call
between two users who both happen to be on the leader has zero added latency.

### Failure modes (documented, acceptable for v1)

- **Leader dies.** Lease expires (≤9s) → new leader elected. ~~In-flight call state
  is lost.~~ **CLOSED in Round 11 (v2.99.66)** — see below.
- **Redis blip.** Signaling stalls until reconnect (same as the bus today);
  `commandTimeout` + retries prevent hangs.

## Flag

`RELAY_CLUSTER=1` **and** `REDIS_URL` set ⇒ clustered signaling on. Absent ⇒
today's single-process path, byte-identical. Single instance with the flag on
still works (that instance is the leader and every peer is local).

## Implementation phases

1. **`server/relayCluster.ts`** — leader election (Redis lease + renew), the
   in/out pub-sub channels, the virtual-socket factory, pure envelope/key
   helpers. Unit tests for the pure parts; a spawned-redis integration test for
   election + a 2-"instance" round-trip (mirrors the existing redisBus
   integration pair). **← this scaffold ships first, dormant.**
2. **Wire `server/relay.ts`** — behind `clusterEnabled()`: the SSE endpoint
   registers a home/virtual peer with the leader; `POST /api/relay/send` forwards
   to the leader when not local; disconnect forwards a synthetic event. The
   `handleMessage`/registry code is NOT modified — it operates on virtual sockets.
3. **Verify** — 2-process integration (two app instances + one Redis): A on inst1
   calls B on inst2 → B rings → accept → SDP relayed → `peer-joined` both sides.
4. **Adversarial review** + ship. Operator sets `RELAY_CLUSTER=1` on every `.io`
   instance; the "calls misconfigured" banner clears (calls now cross instances).

## Interim (do this NOW so calls work today)

Until phase 2–4 land, scale the `.io` ASG to **1 instance** (or pin `/api/relay/*`
via `aws-ops.yml alb-tune`). Calls ring immediately. The cluster work removes that
requirement.


---

## Round 11 (v2.99.66) — the room registry survives the leader

The v1 design accepted one failure mode: the registry lived only in the leader's
memory, so losing that process ended every active call fleet-wide. Three layers
close it. All of them are inert unless `RELAY_CLUSTER=1` + `REDIS_URL`.

### A. Durable shadow (`server/roomStore.ts`)

Every room mutation marks the room dirty; a coalesced next-tick flush writes it
to Redis, and a 15s sweep rewrites everything (so a mutation site nobody
remembered to mark still converges, and TTLs stay fresh on a quiet call).

| key | what |
|---|---|
| `relay:room:<roomId>` | HASH, two fields: `e` = writing leader's fence epoch, `d` = the whole record as signed JSON |
| `relay:rooms` | SET index, so hydration is one `SMEMBERS` instead of a `SCAN` |
| `relay:leader:epoch` | monotonic counter; `INCR` once per leadership win |

Three decisions worth knowing before editing it:

- **One hash per room.** A single `HSET` is atomic, so a reader can never see a
  half-written room. Spreading members/roles/pinroom over several keys would
  reintroduce the cross-key inconsistency the in-memory registry avoids.
- **The pin→room index is derived, not stored.** A pin is in at most its ACTIVE
  room and its HELD room, and both always contain it — so a `held` flag per
  member rebuilds `pinRoom` and `heldRoom`, riding the same atomic write.
- **Fencing.** A lease can expire while its holder still believes it leads (GC
  pause, network blip). Every write carries the epoch and is applied by a Lua CAS
  that refuses a **lower** epoch (`>`, not `>=`, so a leader can overwrite
  itself). Executed for real against a spawned redis-server in
  `server/roomStoreLive.test.ts`.
- **Signed.** Records cross the same trust boundary as bus envelopes and are
  HMAC'd with the same fleet secret (`busSecret`). A forged record is dropped at
  hydration and its index entry pruned.

On winning the lease the new leader mints an epoch, hydrates, and only THEN
serves signaling — inbound frames queue behind a gate (5s timeout, then it serves
anyway: a missing room degrades to "dial again", a wedged signaling layer means
nobody can call at all).

A hydrated room has no connected members by construction, which is exactly the
"room of ghosts" shape `sendRejoinIfInRoom` dissolves. `roomMeta.hydratedAt` +
`HYDRATED_GRACE_MS` (45s) keeps it alive until its owners re-register — without
it the first peer back would delete the very call hydration saved.

### B. `rejoin-recreate` — last resort, capability-gated

If even the shadow was unavailable (a failover blip), a client can ask the server
to rebuild the room. It is asked for exactly **one** thing: a capability the
server minted when it admitted that pin to that room
(`server/roomCapability.ts`, `<exp>.<role>.<hmac>`, 12h).

Everything else is re-derived: the subject pin comes from the **connection**, the
role from **inside the signature**, and a claimed member list is not read at all
(membership converges because each returning peer presents its own capability). A
signed `host` capability takes a *vacant* host seat and never displaces one. With
no fleet secret the path does not exist rather than existing unauthenticated.

Trusting a client-asserted `roomId`/`selfRole` here would reopen the class closed
by v2.99.43 (M45) and v2.99.57 (R-GENPIN) — do not "simplify" it.

### C. Cluster hygiene

- **Heartbeat** (`relay:sig:hb:<leader>`, 5s): each home tells the leader which
  cids it holds. `makeRemoteSocket` now implements `alive()` from it, **failing
  open** for an unknown cid and for an instance that has never beaten (an older
  build mid-rollout) — reporting a live browser as dead sends its calls to the
  leave-a-message card.
- **A lost home** (20s without a beat) hands its browsers to the ordinary
  `cleanupRegistryConn` grace, not oblivion — they may simply be reconnecting.
- **Leadership handover**: every instance sends its local browsers `{type:
  "resync"}`, which re-registers them (rebuilding the client records the dead
  leader held) and yields a `rejoin` from the hydrated rooms. The instance that
  *takes* the job resyncs its own browsers too, after hydration.

### Manual failover test

1. Two browsers in a call. Find the leader (`/api/health`, or the `relay:leader`
   key). **Kill that instance.** EXPECT: within ~10s the sockets resync, the new
   leader hydrates the room, both sides rejoin, the call continues.
2. Kill the **non**-leader mid-call. EXPECT: nothing (already true before).
3. `redis-cli DEL relay:rooms 'relay:room:*'` *then* kill the leader. EXPECT: the
   `rejoin-recreate` fallback carries the call instead.

#### Test 1 — RUN AND PASSED, 2026-07-26 07:44 UTC

Against a **real 2-device call**, not a synthetic one. An identical script went to
both instances; each compared `relay:leader` to its own id and only the leader
`kill -9`'d itself (SIGKILL — no graceful shutdown path, so nothing could flush
on the way out).

| fact | evidence |
|---|---|
| pre-kill leader | `relay:leader = 6987756681fc6166` (Server B, ap-south-1b) |
| the room was already shadowed | `relay:room:r6fb23ba9d392` in Redis, members pin 235680 + 319011, epoch field `2` |
| the kill | `kill -9` pid 88014 on the leader, mid-call |
| election | `relay:leader` → `db54cf614e883b38` (Server A); `relay:leader:epoch` advanced to **3** |
| **hydration ran** | `[relay] hydrated 1 room(s) from Redis on taking leadership` — verbatim from the new leader's log |
| the fence accepted the higher epoch | the room record survived the election and its epoch field advanced `2` → `3` |
| self-heal | pm2 revived the killed process (`restarts: 1`); no ASG replacement needed |
| **user experience** | *"I didn't feel anything — it works normal, like there was no disconnection."* |

What that evidence pins, mechanism by mechanism: the write-through had already
persisted the live room (epoch `2` present *before* the kill, so it was not
written by the recovery); `mintLeaderEpoch` produced a strictly higher epoch on
election; `applyHydratedRooms` returned 1, which is the only way that log line
prints, so the gate ran *before* signaling was served; and the room's epoch moving
to `3` shows the Lua CAS admits a higher epoch while (per
`roomStoreLive.test.ts`) refusing a lower one.

**Still untested:** (a) a strict split topology — production logs do not record
which instance each browser's stream was attached to, so "one browser per
instance" cannot be proven retroactively for this run; force it by deregistering
one ALB target, connecting device 1, swapping, connecting device 2, re-registering
both, then killing the leader. (b) Test 3, the `rejoin-recreate` fallback. (c) The
companion TURN test — kill a relay mid-**relayed** call and expect recovery via
the second relay; this call was P2P, so the relays were bystanders.

### Still not covered

The leader is still a single writer, so a failover costs one lease expiry (≤9s)
of signaling latency. Media is untouched throughout — this round is about the
call being *repairable*, not about the packets.
