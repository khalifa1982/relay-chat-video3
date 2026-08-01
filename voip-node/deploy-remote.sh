#!/usr/bin/env bash
# Runs ON a mediasoup media node, sent by aws-ops.yml's `voip-deploy` action over SSM.
#
# WHY THIS IS A CHECKED-IN FILE rather than a heredoc inside the workflow: a shell script
# embedded in a YAML block scalar is quoted three times over (YAML, the runner's shell, the
# SSM JSON) and cannot be syntax-checked or unit-tested. This one is `bash -n`-clean, its
# properties are pinned by server/voipDeploy.test.ts, and it is the same script whichever
# action sends it.
#
# ── THE LAYOUT IS INFRA'S, NOT OURS ──────────────────────────────────────────────────────
#
# Infra provisions each node with `relay-voip-agent.service` ALREADY ENABLED and held dormant
# by `ConditionPathExists=/opt/relay-voip/agent/index.js`. Four values are therefore a
# contract with a machine that already exists, and every one of them fails SILENTLY when
# wrong — a mismatched entrypoint leaves the condition unsatisfied, which systemd reports as a
# clean "condition failed" and the unit sits inactive looking like nobody started it:
#
#     unit      relay-voip-agent.service
#     entry     /opt/relay-voip/agent/index.js
#     env       /etc/relay-voip/agent.env
#     user      relayvoip
#
# The legacy spellings (`relay-voip.service`, `/etc/relay-voip/env`, user `relay`) are still
# ACCEPTED where accepting them is free, because this script cannot see which vintage a node
# is and refusing the old one would strand a box for a naming difference.
#
# INPUTS, supplied as EARLIER `commands` elements by the caller — SSM concatenates every
# element into ONE shell script, so a plain assignment in an earlier element is in scope here
# (the same mechanism MEDIA_NODE_GUARD already uses):
#
#   VOIP_B64    base64 of a tarball of voip-node/ WITHOUT node_modules
#   VOIP_SHA    sha256 of that tarball, so a truncated arrival is refused rather than
#               extracted over a working agent
#   VOIP_APPLY  1 to write and restart; anything else reports current state and stops
#
# CONTRACT: every exit prints `VOIP_EXIT=<n>` and exits 0, because the caller reads the
# MARKER and not the SSM status — a wrapper or a pipeline can mask a non-zero exit, which is
# the defect v2.99.46 exists to prevent. A non-zero marker means nothing was restarted.

set -u

fail() { echo "$1"; echo "VOIP_EXIT=$2"; exit 0; }

VOIP_B64="${VOIP_B64:-}"
VOIP_SHA="${VOIP_SHA:-}"
VOIP_APPLY="${VOIP_APPLY:-0}"

AGENT_DIR=/opt/relay-voip/agent
ENTRY="$AGENT_DIR/index.js"

echo "HOST=$(hostname)"

# ── MIS-TAG GUARD, INVERTED AND LOUD ────────────────────────────────────────────────────
# Every other aws-ops action targets `tag:Name=relay-app` and carries MEDIA_NODE_GUARD to
# SKIP a media node that happens to be in the set. This script is the mirror image, and the
# asymmetry is deliberate: for an app action a media node costs nothing, so a silent skip is
# right — but an APP SERVER in this action's target set means somebody has tagged a
# production web host as a media node, and installing a systemd unit onto it is not
# something to do quietly.
#
# `/home/relay` is evidence the HOST ITSELF carries (the app's env and release live there)
# and a media node never has it, so unlike a tag list or an instance id it cannot go stale.
if [ -f /home/relay/.env ] || [ -d /home/relay/app ]; then
  fail "REFUSED: this host is an APP server (/home/relay present) — not installing a media agent on it" 90
fi

# ── WHICH VINTAGE IS THIS NODE ──────────────────────────────────────────────────────────
# Resolved once, up front, so the BEFORE report and the APPLY path can never disagree about
# which unit/user/env file they mean.
SVC=relay-voip-agent
systemctl cat relay-voip-agent >/dev/null 2>&1 || \
  { systemctl cat relay-voip >/dev/null 2>&1 && SVC=relay-voip; }

SVC_USER=""
for u in relayvoip relay; do
  if id "$u" >/dev/null 2>&1; then SVC_USER="$u"; break; fi
done

ENV_FILE=""
for f in /etc/relay-voip/agent.env /etc/relay-voip/env; do
  if [ -f "$f" ]; then ENV_FILE="$f"; break; fi
done

echo "--- BEFORE ---"
echo "unit: $SVC ($(systemctl is-active "$SVC" 2>/dev/null || echo absent) / $(systemctl is-enabled "$SVC" 2>/dev/null || echo not-enabled))"
# The condition is what actually gates an ENABLED unit, and an unmet one looks exactly like
# "never started" in `is-active`. Report it explicitly or the single most likely failure of
# this whole exercise is invisible in the log.
if [ -f "$ENTRY" ]; then
  echo "entrypoint: $ENTRY present, sha256 $(sha256sum "$ENTRY" | cut -d' ' -f1)"
else
  echo "entrypoint: $ENTRY ABSENT — the unit's ConditionPathExists is UNMET, so an enabled"
  echo "            unit stays inactive here. This is the expected state before a first apply."
fi
if [ -f /opt/relay-voip/agent.mjs ]; then
  echo "legacy /opt/relay-voip/agent.mjs: present (pre-v2.106.72 layout; harmless, unused)"
fi
for m in "$AGENT_DIR/node_modules/mediasoup/package.json" /opt/relay-voip/node_modules/mediasoup/package.json; do
  if [ -f "$m" ]; then
    echo "mediasoup at ${m%/mediasoup/package.json}: $(node -e "process.stdout.write(require('$m').version)" 2>/dev/null || echo unreadable)"
  fi
done
echo "node: $(node -v 2>/dev/null || echo MISSING)"
echo "pnpm: $(pnpm -v 2>/dev/null || corepack pnpm -v 2>/dev/null || echo MISSING)"
echo "service user: ${SVC_USER:-MISSING (expected relayvoip, or legacy relay)}"

# ── THE ENV FILE IS NEVER WRITTEN BY THIS SCRIPT ─────────────────────────────────────────
# It holds VOIP_NODE_SECRET and REDIS_URL. Both are real secrets, and a workflow_dispatch
# input is visible in run metadata — so they can only be placed by a human following
# voip-node/README.md. We report its PRESENCE (never a value) and decline to START without
# it, rather than enabling a unit that would crash-loop on a missing EnvironmentFile.
#
# The SECRET is checked BY KEY NAME as well, and that is not pedantry: the agent's main()
# throws outright without it ("the internal API is signed"), so a node provisioned with an
# env file that has REDIS_URL and no VOIP_NODE_SECRET would restart-loop every 2s with the
# real reason buried in journald. Grepping for the key name reveals nothing — a name is not a
# value — and turns that loop into one legible line.
HAVE_ENV=0
HAVE_SECRET=0
if [ -n "$ENV_FILE" ]; then
  echo "$ENV_FILE: present ($(grep -c . "$ENV_FILE" 2>/dev/null || echo 0) lines; values NOT read)"
  HAVE_ENV=1
  if grep -q '^[[:space:]]*VOIP_NODE_SECRET=..*' "$ENV_FILE" 2>/dev/null; then
    echo "$ENV_FILE: names VOIP_NODE_SECRET (value NOT read)"
    HAVE_SECRET=1
  else
    echo "$ENV_FILE: does NOT name VOIP_NODE_SECRET — the agent refuses to start without it."
    echo "            Add one line (a shared secret, same on every node and in the app's env):"
    echo "              VOIP_NODE_SECRET=<hex from: openssl rand -hex 32>"
  fi
else
  echo "/etc/relay-voip/agent.env: MISSING — see voip-node/README.md; this script will not create it (it holds real secrets)"
fi

if [ "$VOIP_APPLY" != "1" ]; then
  echo "--- DRY RUN: stopping here, nothing written ---"
  echo "VOIP_EXIT=0"
  exit 0
fi

echo "--- APPLY ---"
command -v node >/dev/null 2>&1 || fail "REFUSED: node is not installed on this host" 91
[ -n "$SVC_USER" ] || fail "REFUSED: neither the 'relayvoip' nor the 'relay' user exists (the unit runs as one of them)" 92
[ -n "$VOIP_B64" ] || fail "REFUSED: no payload was supplied" 93

umask 022
install -d -m 0755 /opt/relay-voip "$AGENT_DIR"
printf '%s' "$VOIP_B64" | base64 -d > /tmp/voip-node.tgz || fail "REFUSED: payload did not decode" 93
GOT=$(sha256sum /tmp/voip-node.tgz | cut -d' ' -f1)
if [ "$GOT" != "$VOIP_SHA" ]; then
  rm -f /tmp/voip-node.tgz
  fail "REFUSED: payload checksum mismatch (got $GOT) — the archive arrived truncated or altered, nothing written" 94
fi

# Fingerprint the dependency manifest BEFORE extracting, so we can tell whether an install is
# actually needed. This matters more than it looks: mediasoup compiles a C++ worker, which
# takes MINUTES, and re-running it for a one-line change would time the SSM command out and
# leave the node mid-install.
DEPS_BEFORE=$(cat "$AGENT_DIR/package.json" "$AGENT_DIR/pnpm-lock.yaml" 2>/dev/null | sha256sum | cut -d' ' -f1)
tar -xzf /tmp/voip-node.tgz -C "$AGENT_DIR" --strip-components=1 || fail "REFUSED: extract failed" 95
rm -f /tmp/voip-node.tgz
chown -R "$SVC_USER:$SVC_USER" "$AGENT_DIR"
DEPS_AFTER=$(cat "$AGENT_DIR/package.json" "$AGENT_DIR/pnpm-lock.yaml" 2>/dev/null | sha256sum | cut -d' ' -f1)
echo "entrypoint now: $(sha256sum "$ENTRY" 2>/dev/null | cut -d' ' -f1 || echo MISSING)"

# `node --check` EVERY shipped module before anything is started. A syntax error would
# otherwise surface as a crash-looping unit whose journal nobody reads until a call fails —
# and it is a mistake already made once in the agent (v2.106.36, caught by `node --check`
# rather than by review).
for f in index.js record.mjs sign.mjs; do
  [ -f "$AGENT_DIR/$f" ] || fail "REFUSED: $f missing from the payload" 96
  node --check "$AGENT_DIR/$f" || fail "REFUSED: $f does not parse — NOT restarting the service" 97
done
echo "syntax: all modules parse"

# ── THE ARTIFACT THAT MATTERS IS THE WORKER BINARY, NOT THE PACKAGE DIRECTORY ────────────
#
# This gate used to be `[ ! -d node_modules/mediasoup ]` — and an install whose build script
# was BLOCKED satisfies that test, because the directory is there and only the binary is
# missing. pnpm 10 blocks dependency lifecycle scripts by default and mediasoup fetches its
# worker from postinstall, so on a node in that state the old gate printed "dependencies
# unchanged" and reported VOIP_EXIT=0 over a node that cannot start a worker at all: a
# successful deploy over a broken node, which is the one outcome this script exists to
# prevent. (`voip-node/package.json`'s `onlyBuiltDependencies` is the other half of the fix.)
#
# TWO LOCATIONS ARE SEARCHED, in Node's own resolution order from $AGENT_DIR/index.js:
# ours at $AGENT_DIR/node_modules, then the PRE-PROVISIONED one at /opt/relay-voip/
# node_modules that infra already compiled. Reusing the pre-built worker is what turns a
# ~2-minute-per-node compile into nothing, and Node finds it by walking up unaided.
#
# It is reused ONLY when its version equals the one we pin. A silent version difference is
# precisely what the exact pin exists to prevent: the worker is a host-specific binary, so a
# mismatch surfaces as one node behaving differently in a call and nothing anywhere saying
# why. `MEDIASOUP_WORKER_BIN` still wins outright, because mediasoup itself honours it.
WANT_VER=$(node -e "process.stdout.write(require('$AGENT_DIR/package.json').dependencies.mediasoup)" 2>/dev/null || echo "")
WORKER_BIN="${MEDIASOUP_WORKER_BIN:-}"
if [ -z "$WORKER_BIN" ]; then
  for root in "$AGENT_DIR" /opt/relay-voip; do
    CAND="$root/node_modules/mediasoup/worker/out/Release/mediasoup-worker"
    [ -x "$CAND" ] || continue
    HAVE_VER=$(node -e "process.stdout.write(require('$root/node_modules/mediasoup/package.json').version)" 2>/dev/null || echo "")
    if [ -n "$WANT_VER" ] && [ "$HAVE_VER" != "$WANT_VER" ]; then
      echo "mediasoup at $root is $HAVE_VER but we pin $WANT_VER — not reusing it"
      continue
    fi
    WORKER_BIN="$CAND"
    echo "worker: reusing $HAVE_VER at $root (no rebuild needed)"
    break
  done
fi

if [ "$DEPS_BEFORE" != "$DEPS_AFTER" ] || [ -z "$WORKER_BIN" ] || [ ! -x "$WORKER_BIN" ]; then
  echo "dependencies changed, or no usable worker binary — installing with the lockfile"
  # --frozen-lockfile is load-bearing rather than tidy: the versions are pinned EXACTLY
  # because the worker is host-specific (a prebuilt binary validated against this host when
  # one matches, a source build otherwise), so a plain install on a box without the lockfile
  # resolves newer ones and the difference is invisible until a call behaves differently on
  # ONE node.
  PNPM=pnpm
  command -v pnpm >/dev/null 2>&1 || PNPM="corepack pnpm"
  ( cd "$AGENT_DIR" && sudo -u "$SVC_USER" env HOME="$AGENT_DIR" $PNPM install --frozen-lockfile ) \
    || fail "REFUSED: dependency install failed — service NOT restarted" 98
  echo "install: ok"
  WORKER_BIN="${MEDIASOUP_WORKER_BIN:-$AGENT_DIR/node_modules/mediasoup/worker/out/Release/mediasoup-worker}"
else
  echo "dependencies unchanged and a usable worker binary is present — skipping the install"
fi

# VERIFY THE BINARY, ALWAYS — on the reuse path too, and whatever the install claimed.
# `pnpm install` EXITS 0 while printing "Ignored build scripts", so its exit code is not
# evidence the worker exists. Without this, a future pnpm change that re-blocks the build
# would put us straight back to a green deploy over a node that dies in createWorker().
if [ ! -x "$WORKER_BIN" ]; then
  echo "expected at: $WORKER_BIN"
  grep -o '"pendingBuilds":[^]]*]' "$AGENT_DIR/node_modules/.modules.yaml" 2>/dev/null || true
  fail "REFUSED: the mediasoup worker binary is missing or not executable — the agent would die in createWorker(). Service NOT restarted." 101
fi
echo "worker binary: $(ls -l "$WORKER_BIN" | awk '{print $5}') bytes, executable"

# The unit we ship OWNS the four contract values, so it is installed under the name the node
# already has enabled. A node carrying the legacy name keeps it — enabling a second unit
# beside a running one is how you get two agents fighting over the same media ports.
install -m 0644 "$AGENT_DIR/relay-voip-agent.service" "/etc/systemd/system/$SVC.service"
systemctl daemon-reload

if [ "$HAVE_ENV" != "1" ] || [ "$HAVE_SECRET" != "1" ]; then
  echo "FILES INSTALLED, SERVICE NOT STARTED: the env file is missing or has no VOIP_NODE_SECRET."
  echo "Create /etc/relay-voip/agent.env per voip-node/README.md (VOIP_NODE_SECRET + REDIS_URL), then:"
  echo "  sudo systemctl enable --now $SVC"
  echo "VOIP_EXIT=0"
  exit 0
fi

systemctl enable "$SVC" >/dev/null 2>&1 || true
systemctl restart "$SVC" || fail "REFUSED: systemctl restart failed" 99

# A deploy that installs and leaves the service DEAD is worse than none, so prove it came
# back rather than assuming. The agent heartbeats every 5s, so 15s is three of them.
sleep 15
if ! systemctl is-active --quiet "$SVC"; then
  echo "--- journal (last 40) ---"
  journalctl -u "$SVC" -n 40 --no-pager 2>/dev/null || true
  fail "STARTED BUT NOT RUNNING: the unit is not active after 15s — see the journal above" 100
fi
echo "service: active"
echo "--- journal (last 20) ---"
journalctl -u "$SVC" -n 20 --no-pager 2>/dev/null | tail -20 || true
echo "VOIP_EXIT=0"
