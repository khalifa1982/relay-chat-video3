#!/usr/bin/env bash
# Runs ON a mediasoup media node, sent by aws-ops.yml's `voip-deploy` action over SSM.
#
# WHY THIS IS A CHECKED-IN FILE rather than a heredoc inside the workflow: a shell script
# embedded in a YAML block scalar is quoted three times over (YAML, the runner's shell, the
# SSM JSON) and cannot be syntax-checked or unit-tested. This one is `bash -n`-clean, its
# properties are pinned by server/awsOps.test.ts, and it is the same script whichever action
# sends it.
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

echo "--- BEFORE ---"
echo "service: $(systemctl is-active relay-voip 2>/dev/null || echo absent) / $(systemctl is-enabled relay-voip 2>/dev/null || echo not-enabled)"
if [ -f /opt/relay-voip/agent.mjs ]; then
  echo "agent.mjs: $(sha256sum /opt/relay-voip/agent.mjs | cut -d' ' -f1)"
else
  echo "agent.mjs: ABSENT — this node has never had the agent installed"
fi
if [ -f /opt/relay-voip/node_modules/mediasoup/package.json ]; then
  echo "mediasoup installed: $(node -e 'process.stdout.write(require("/opt/relay-voip/node_modules/mediasoup/package.json").version)' 2>/dev/null || echo unreadable)"
else
  echo "mediasoup installed: ABSENT"
fi
echo "node: $(node -v 2>/dev/null || echo MISSING)"
echo "pnpm: $(pnpm -v 2>/dev/null || corepack pnpm -v 2>/dev/null || echo MISSING)"

# ── THE ENV FILE IS NEVER WRITTEN BY THIS SCRIPT ─────────────────────────────────────────
# It holds VOIP_NODE_SECRET and REDIS_URL. Both are real secrets, and a workflow_dispatch
# input is visible in run metadata — so they can only be placed by a human following
# voip-node/README.md. We report its PRESENCE (never a value) and decline to START without
# it, rather than enabling a unit that would crash-loop on a missing EnvironmentFile.
if [ -f /etc/relay-voip/env ]; then
  echo "/etc/relay-voip/env: present ($(grep -c . /etc/relay-voip/env 2>/dev/null || echo 0) lines; values NOT read)"
  HAVE_ENV=1
else
  echo "/etc/relay-voip/env: MISSING — see voip-node/README.md; this script will not create it (it holds real secrets)"
  HAVE_ENV=0
fi
if id relay >/dev/null 2>&1; then echo "user relay: present"; else echo "user relay: MISSING (the unit runs as it)"; fi

if [ "$VOIP_APPLY" != "1" ]; then
  echo "--- DRY RUN: stopping here, nothing written ---"
  echo "VOIP_EXIT=0"
  exit 0
fi

echo "--- APPLY ---"
command -v node >/dev/null 2>&1 || fail "REFUSED: node is not installed on this host" 91
id relay >/dev/null 2>&1 || fail "REFUSED: the 'relay' user does not exist (the unit runs as it)" 92
[ -n "$VOIP_B64" ] || fail "REFUSED: no payload was supplied" 93

umask 022
install -d -m 0755 /opt/relay-voip
printf '%s' "$VOIP_B64" | base64 -d > /tmp/voip-node.tgz || fail "REFUSED: payload did not decode" 93
GOT=$(sha256sum /tmp/voip-node.tgz | cut -d' ' -f1)
if [ "$GOT" != "$VOIP_SHA" ]; then
  rm -f /tmp/voip-node.tgz
  fail "REFUSED: payload checksum mismatch (got $GOT) — the archive arrived truncated or altered, nothing written" 94
fi

# Fingerprint the dependency manifest BEFORE extracting, so we can tell whether an install is
# actually needed. This matters more than it looks: mediasoup compiles a C++ worker, which
# takes MINUTES, and re-running it for an agent.mjs one-liner would time the SSM command out
# and leave the node mid-install.
DEPS_BEFORE=$(cat /opt/relay-voip/package.json /opt/relay-voip/pnpm-lock.yaml 2>/dev/null | sha256sum | cut -d' ' -f1)
tar -xzf /tmp/voip-node.tgz -C /opt/relay-voip --strip-components=1 || fail "REFUSED: extract failed" 95
rm -f /tmp/voip-node.tgz
chown -R relay:relay /opt/relay-voip
DEPS_AFTER=$(cat /opt/relay-voip/package.json /opt/relay-voip/pnpm-lock.yaml 2>/dev/null | sha256sum | cut -d' ' -f1)
echo "agent.mjs now: $(sha256sum /opt/relay-voip/agent.mjs | cut -d' ' -f1)"

# `node --check` EVERY shipped module before anything is started. A syntax error would
# otherwise surface as a crash-looping unit whose journal nobody reads until a call fails —
# and it is a mistake already made once in agent.mjs (v2.106.36, caught by `node --check`
# rather than by review).
for f in agent.mjs record.mjs sign.mjs; do
  [ -f "/opt/relay-voip/$f" ] || fail "REFUSED: $f missing from the payload" 96
  node --check "/opt/relay-voip/$f" || fail "REFUSED: $f does not parse — NOT restarting the service" 97
done
echo "syntax: all modules parse"

# THE ARTIFACT THAT MATTERS IS THE WORKER BINARY, NOT THE PACKAGE DIRECTORY.
#
# This gate used to be `[ ! -d node_modules/mediasoup ]` — and an install whose build script
# was BLOCKED satisfies that test, because the directory is there and only the binary is
# missing. pnpm 10 blocks dependency lifecycle scripts by default and mediasoup fetches its
# worker from postinstall, so on a node in that state the old gate printed "dependencies
# unchanged" and reported VOIP_EXIT=0 over a node that cannot start a worker at all: a
# successful deploy over a broken node, which is the one outcome this script exists to
# prevent. (`voip-node/package.json`'s `onlyBuiltDependencies` is the other half of the fix.)
#
# `MEDIASOUP_WORKER_BIN` is honoured because mediasoup itself honours it — an operator who
# has placed the binary elsewhere must not be forced into a reinstall.
WORKER_BIN="${MEDIASOUP_WORKER_BIN:-/opt/relay-voip/node_modules/mediasoup/worker/out/Release/mediasoup-worker}"
if [ "$DEPS_BEFORE" != "$DEPS_AFTER" ] || [ ! -x "$WORKER_BIN" ]; then
  echo "dependencies changed, or the worker binary is missing — installing with the lockfile"
  # --frozen-lockfile is load-bearing rather than tidy: the versions are pinned EXACTLY
  # because the worker is host-specific (a prebuilt binary validated against this host when
  # one matches, a source build otherwise), so a plain install on a box without the lockfile
  # resolves newer ones and the difference is invisible until a call behaves differently on
  # ONE node.
  PNPM=pnpm
  command -v pnpm >/dev/null 2>&1 || PNPM="corepack pnpm"
  ( cd /opt/relay-voip && sudo -u relay env HOME=/opt/relay-voip $PNPM install --frozen-lockfile ) \
    || fail "REFUSED: dependency install failed — service NOT restarted" 98
  echo "install: ok"
else
  echo "dependencies unchanged and the worker binary is present — skipping the install"
fi

# VERIFY THE BINARY, ALWAYS — on the skip path too, and whatever the install claimed.
# `pnpm install` EXITS 0 while printing "Ignored build scripts", so its exit code is not
# evidence the worker exists. Without this, a future pnpm change that re-blocks the build
# would put us straight back to a green deploy over a node that dies in createWorker().
if [ ! -x "$WORKER_BIN" ]; then
  echo "expected at: $WORKER_BIN"
  grep -o '"pendingBuilds":[^]]*]' /opt/relay-voip/node_modules/.modules.yaml 2>/dev/null || true
  fail "REFUSED: the mediasoup worker binary is missing or not executable — the agent would die in createWorker(). Service NOT restarted." 101
fi
echo "worker binary: $(ls -l "$WORKER_BIN" | awk '{print $5}') bytes, executable"

install -m 0644 /opt/relay-voip/relay-voip.service /etc/systemd/system/relay-voip.service
systemctl daemon-reload

if [ "$HAVE_ENV" != "1" ]; then
  echo "FILES INSTALLED, SERVICE NOT STARTED: /etc/relay-voip/env is missing."
  echo "Create it per voip-node/README.md (VOIP_NODE_SECRET + REDIS_URL), then:"
  echo "  sudo systemctl enable --now relay-voip"
  echo "VOIP_EXIT=0"
  exit 0
fi

systemctl enable relay-voip >/dev/null 2>&1 || true
systemctl restart relay-voip || fail "REFUSED: systemctl restart failed" 99

# A deploy that installs and leaves the service DEAD is worse than none, so prove it came
# back rather than assuming. The agent heartbeats every 5s, so 15s is three of them.
sleep 15
if ! systemctl is-active --quiet relay-voip; then
  echo "--- journal (last 40) ---"
  journalctl -u relay-voip -n 40 --no-pager 2>/dev/null || true
  fail "STARTED BUT NOT RUNNING: the unit is not active after 15s — see the journal above" 100
fi
echo "service: active"
echo "--- journal (last 20) ---"
journalctl -u relay-voip -n 20 --no-pager 2>/dev/null | tail -20 || true
echo "VOIP_EXIT=0"
