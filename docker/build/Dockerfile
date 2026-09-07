# Shared pre-flight build image for `make build-stage`'s host-native
# build-backend/build-frontend/build-desktop targets. Pins the exact same Go
# and Node major versions the real service images already use (see
# services/backend/Dockerfile, services/frontend/Dockerfile,
# services/tunnel/Dockerfile), so these steps run against a controlled
# toolchain via `docker run` instead of whatever Go/Node happens to be
# installed on the host or the self-evolution backend container — see
# AGENTS.md §11 (host-independence / containerized tooling invariant) and
# TODO.md §13/§17 (the host/container Node-version mismatch this replaces).
#
# This image never runs long-lived: it is invoked once per build step via
# `docker run --rm`, with the real project directory bind-mounted at its own
# host-visible absolute path (mirroring the pattern selfevolution/manager.go
# already uses for scheduleStackRestart) and the caller's own numeric
# uid:gid, so build output lands back on the host owned by the invoking
# user, not root.
ARG GO_VERSION=1.23
FROM golang:${GO_VERSION}-bookworm

# NodeSource's setup script is the same mechanism already implicitly trusted
# by every `npm install`/`npm ci` in this repo (it only configures apt to
# pull from nodejs.org's own repository); pin the major version to match
# services/frontend/Dockerfile and services/desktop/package.json's Electron
# engine requirement.
ARG NODE_MAJOR=22
RUN curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

RUN node --version && npm --version && go version
