FROM golang:1.23-alpine3.21 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/wharness-backend ./cmd/harness

# The backend owns Protected execution and Wharness self-evolution orchestration.
# Keep the build/control toolchain in this container so the host only needs
# Docker + the Desktop runtime; the model runner still never receives the
# Docker socket.
#
# The Alpine release is load-bearing, not cosmetic: `make build-stage` for a
# self-evolution host build runs with THIS container's Node, not the
# operator's. Alpine 3.20 ships Node 20.15, below the >=22.12 that the
# pinned Electron's postinstall requires, so every self-evolution apply died
# with ERR_REQUIRE_ESM while the operator's own `make build` (on a newer host
# Node) succeeded — an inconsistency that is invisible from the outside and
# that no source patch can fix. Alpine 3.21 ships Node 22.23. Keep this base
# at or above whatever the desktop's pinned Electron requires.
FROM golang:1.23-alpine3.21
ARG WHARNESS_UID=1000
ARG WHARNESS_GID=1000
ARG PNPM_VERSION=10.17.1
ARG YARN_VERSION=1.22.22
#
# `build-base` is load-bearing for the same reason: post-merge verification
# re-runs a plan's own gates HERE, against the merged host tree, while those
# gates were authored and verified against the runner image (which installs
# build-essential). Without a C compiler this container reports CGO_ENABLED=0,
# so `go test -race ./...` dies in milliseconds with "-race requires cgo" —
# a verified candidate reverted over a toolchain gap no patch can close.
# Wharnex now records such a gate as unverified-on-host rather than failing,
# but skipping real verification is a fallback, not the intent: keep the
# toolchain here wide enough that the gates actually run.
RUN apk add --no-cache \
      ca-certificates curl git make nodejs npm zip \
      bash bash-completion \
      build-base \
      docker-cli docker-cli-compose docker-cli-buildx \
 && npm install --global "pnpm@${PNPM_VERSION}" "yarn@${YARN_VERSION}" \
 && addgroup -g "${WHARNESS_GID}" wharness \
 && adduser -D -u "${WHARNESS_UID}" -G wharness wharness
COPY --from=build /out/wharness-backend /usr/local/bin/wharness-backend
# The build stage already downloaded every module in go.sum. Discarding that
# cache made each self-evolution host build re-fetch the identical bytes from
# the network, so a transient DNS or proxy fault reverted a candidate that had
# already passed verification — a build failing on the one input that is
# provably unrelated to the change. Carrying the cache forward makes the
# common case (go.sum unchanged since the image was built) need no network at
# all. It is owned by the build user because that is who runs the build.
COPY --from=build --chown=${WHARNESS_UID}:${WHARNESS_GID} /go/pkg/mod /go/pkg/mod
USER wharness
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/wharness-backend"]
