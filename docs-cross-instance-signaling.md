# Cross-instance call signaling (phase-2)

**Goal:** calls ring and connect between two users no matter which app instance
each is connected to — with NO ALB pinning of `/api/relay/*`. This replaces the
"pin signaling to one instance" workaround (docs-aws-scale-out.md) with an
in-app solution so the fleet can scale horizontally and still place calls.

**Status:** design + scaffold. Flag-gated, OFF by default. When off (or single
instance / no Redis), behavior is byte-identical to today.

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

- **Leader dies.** Lease expires (≤9s) → new leader elected. In-flight call state
  (held only on the dead leader) is lost — active calls drop, exactly like a
  single-instance restart today, except fleet-wide. Proxies re-forward `register`
  for their still-open SSE connections to the new leader, so presence/dialing
  recovers within seconds; the client's existing auto-rejoin handles the media
  side. (Hardening — persist `pinRoom`/`roomMeta` to Redis for warm failover —
  is a later step, out of scope for v1.)
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
