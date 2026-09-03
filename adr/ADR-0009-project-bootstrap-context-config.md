# ADR-0009 — Native project bootstrap and per-project context configuration

## Status
Accepted — 2026-09-03

## Context
Typing absolute project paths is error-prone, Git projects may depend on recursive submodules, and sending every local artifact in the project makes AI context unnecessarily large. Context choices also need to travel with the project instead of living only in browser state.

## Decision
Wharness Desktop uses a narrow Electron directory-picker capability for project selection and destination selection. The local backend owns explicit create and clone operations; clone uses `git clone --recurse-submodules` and refuses an existing destination.

Every project owns `whaness.yml`. Wharness creates a default file when absent. Its v1 schema contains project identity plus context auto-pruning, maximum per-file size, include patterns, and exclude patterns. Saving through the workspace settings API atomically writes the file and rebuilds the active context.

Automatic context pruning recognizes common VCS/dependency/IDE/cache/build/test/temp/binary/archive/media outputs and generated context snapshots. Mandatory secret, symlink, VCS-internal, and protected-path exclusions remain stronger than project configuration.

## Consequences
Project opening becomes discoverable and clone can reproduce repositories with nested submodules. Context ZIPs are smaller by default and tuning is versionable with the project. The bootstrap API performs explicit host mutations, so it remains a human-only surface and is not exposed to planner protocols.
