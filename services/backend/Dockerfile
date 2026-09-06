FROM golang:1.23.0-alpine3.20 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/wharness-backend ./cmd/harness

# The backend owns Protected execution and Wharness self-evolution orchestration.
# Keep the build/control toolchain in this container so the host only needs
# Docker + the Desktop runtime; the model runner still never receives the
# Docker socket.
FROM golang:1.23.0-alpine3.20
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
