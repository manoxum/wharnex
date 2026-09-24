#!/usr/bin/env sh

ensure_terminal_service() {
  # Host PTYs live outside the backend/frontend rollout. Reuse the existing
  # sidecar unless terminal-specific code explicitly requests replacement.
  compose up -d --no-recreate terminal
  wait_service terminal 120
}
