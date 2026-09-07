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
RUN apk add --no-cache \
      ca-certificates curl git make nodejs npm zip \
      docker-cli docker-cli-compose docker-cli-buildx \
 && addgroup -g "${WHARNESS_GID}" wharness \
 && adduser -D -u "${WHARNESS_UID}" -G wharness wharness
COPY --from=build /out/wharness-backend /usr/local/bin/wharness-backend
USER wharness
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/wharness-backend"]
