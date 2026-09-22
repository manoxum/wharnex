#!/usr/bin/env sh
set -eu

# Host-side obsolete-storage reclamation for the Wharnex build/install lifecycle.
#
# The backend's own /api/storage/prune already owns everything it can prove
# ownership of: context directories, sandbox workspaces and unreachable
# per-project dependency caches. This script reclaims what only the host can
# see — settled self-evolution transaction directories, unbounded lifecycle
# logs, and the Docker layer/build-cache garbage every rebuild leaves behind.
#
# Reclamation is obsolescence-proven housekeeping. It never removes a valid
# fingerprinted build/dependency cache, a live workspace, persisted session
# data, or the transaction a recovery still depends on, and it never fails the
# lifecycle command that invoked it: what it could not reclaim is reported.

ROOT=${WHARNESS_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
[ -f "$ROOT/.harness/env" ] && . "$ROOT/.harness/env"

KEEP_HOURS=${WHARNESS_RECLAIM_KEEP_HOURS:-72}
KEEP_TRANSACTIONS=${WHARNESS_RECLAIM_KEEP_TRANSACTIONS:-3}
LOG_MAX_BYTES=${WHARNESS_RECLAIM_LOG_MAX_BYTES:-16777216}
LOG_KEEP_LINES=${WHARNESS_RECLAIM_LOG_KEEP_LINES:-2000}
RECLAIM_DOCKER=${WHARNESS_RECLAIM_DOCKER:-1}
RECLAIM_VOLUMES=${WHARNESS_RECLAIM_VOLUMES:-0}

case "$KEEP_HOURS" in ''|*[!0-9]*) KEEP_HOURS=72 ;; esac
case "$KEEP_TRANSACTIONS" in ''|*[!0-9]*) KEEP_TRANSACTIONS=3 ;; esac
KEEP_MINUTES=$((KEEP_HOURS * 60))

note() { printf '[reclaim] %s\n' "$1"; }
warn() { printf '[reclaim] %s\n' "$1" >&2; }

older_than_retention() {
  [ -n "$(find "$1" -maxdepth 0 -mmin "+$KEEP_MINUTES" -print 2>/dev/null)" ]
}

# A settled self-evolution transaction keeps a full runtime rollback snapshot
# (tens of megabytes each). The transaction the status file still names is the
# one a recovery depends on, and the newest few stay as evidence whatever their
# age; everything older than the retention window is reclaimed.
reclaim_self_evolution() {
  base="$ROOT/.harness/self-evolution"
  [ -d "$base" ] || return 0
  active=''
  if [ -f "$base/status" ]; then
    active=$(sed -n 's/^transaction=//p' "$base/status" | tail -n 1)
  fi
  retained=$(ls -1 "$base" 2>/dev/null | grep '^txn-' | LC_ALL=C sort | tail -n "$KEEP_TRANSACTIONS" || true)
  removed=0
  for entry in "$base"/txn-*; do
    [ -d "$entry" ] || continue
    name=$(basename "$entry")
    if [ "$name" = "$active" ]; then
      continue
    fi
    if printf '%s\n' "$retained" | grep -Fqx "$name"; then
      continue
    fi
    if ! older_than_retention "$entry"; then
      continue
    fi
    if rm -rf "$entry"; then
      removed=$((removed + 1))
    else
      warn "could not remove settled self-evolution transaction $name"
    fi
  done
  [ "$removed" -eq 0 ] || note "reclaimed $removed settled self-evolution transaction(s)"
}

# Lifecycle logs are append-only and grow without bound. Truncation rewrites the
# file in place so an open writer or follower keeps its descriptor.
reclaim_logs() {
  dir="$ROOT/.harness/logs"
  [ -d "$dir" ] || return 0
  truncated=0
  for file in "$dir"/*.log; do
    [ -f "$file" ] || continue
    size=$(wc -c <"$file" 2>/dev/null || echo 0)
    [ "$size" -gt "$LOG_MAX_BYTES" ] || continue
    tmp="$file.reclaim.$$"
    if tail -n "$LOG_KEEP_LINES" "$file" >"$tmp" 2>/dev/null && cat "$tmp" >"$file" 2>/dev/null; then
      # A log whose tail is the whole file — one pathologically long line — is
      # rewritten to the same size. Report what was actually reclaimed.
      if [ "$(wc -c <"$file" 2>/dev/null || echo "$size")" -lt "$size" ]; then
        truncated=$((truncated + 1))
      fi
    else
      warn "could not truncate oversized log $(basename "$file")"
    fi
    rm -f "$tmp"
  done
  [ "$truncated" -eq 0 ] || note "truncated $truncated oversized lifecycle log(s)"
}

docker_available() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

# Every rebuild retags wharness-backend/frontend/tunnel and the Protected
# runner, orphaning the previous layers. Only untagged layers unused for the
# whole retention window are removed, so the image-level rollback path that
# application activation depends on — the immediately previous generation — is
# never the thing being reclaimed.
reclaim_docker() {
  [ "$RECLAIM_DOCKER" = "1" ] || { note 'Docker reclamation disabled by WHARNESS_RECLAIM_DOCKER'; return 0; }
  if ! docker_available; then
    note 'Docker is unavailable; skipped image/build-cache reclamation'
    return 0
  fi
  if ! docker image prune --force --filter "until=${KEEP_HOURS}h" >/dev/null 2>&1; then
    warn 'could not reclaim dangling Docker images'
  fi
  if ! docker builder prune --force --filter "until=${KEEP_HOURS}h" >/dev/null 2>&1; then
    warn 'could not reclaim obsolete Docker build cache'
  fi
  note "reclaimed Docker layers and build cache unused for ${KEEP_HOURS}h"
}

# Anonymous volumes orphaned by removed containers are the largest reclaimable
# class on a long-lived machine, but a third-party image that declares VOLUME
# without a named mapping keeps real data in one. Reclamation is therefore
# opt-in, and never touches a named volume: only 64-hex anonymous names that
# Docker itself reports as attached to no container are removed, so this
# checkout's PostgreSQL/MinIO volumes are out of reach by construction.
reclaim_volumes() {
  [ "$RECLAIM_VOLUMES" = "1" ] || return 0
  docker_available || return 0
  removed=0
  for name in $(docker volume ls --quiet --filter dangling=true 2>/dev/null || true); do
    [ "${#name}" -eq 64 ] || continue
    case "$name" in *[!0-9a-f]*) continue ;; esac
    if docker volume rm "$name" >/dev/null 2>&1; then
      removed=$((removed + 1))
    fi
  done
  [ "$removed" -eq 0 ] || note "reclaimed $removed orphaned anonymous Docker volume(s)"
}

# What remains reclaimable is reported rather than taken: the operator decides
# whether to enable anonymous-volume reclamation for their machine.
report_remaining() {
  docker_available || return 0
  if [ "$RECLAIM_VOLUMES" = "1" ]; then
    return 0
  fi
  reclaimable=$(docker system df --format '{{.Type}}: {{.Reclaimable}}' 2>/dev/null | grep -i '^local volumes' || true)
  [ -n "$reclaimable" ] || return 0
  note "still reclaimable — $reclaimable (set WHARNESS_RECLAIM_VOLUMES=1 to reclaim orphaned anonymous volumes)"
}

reclaim_self_evolution
reclaim_logs
reclaim_docker
reclaim_volumes
report_remaining
note 'host obsolete-storage reclamation complete'
