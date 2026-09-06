ARG GO_VERSION=1.23
FROM golang:${GO_VERSION}-bookworm AS build
WORKDIR /src
COPY services/backend/go.mod services/backend/go.sum ./
RUN go mod download
COPY services/backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/wharness-tunnel ./cmd/tunnel

FROM cloudflare/cloudflared:2026.8.3 AS cloudflared
FROM tailscale/tailscale:stable AS tailscale

FROM debian:bookworm-slim AS runtime
ARG TARGETARCH
ARG WHARNESS_UID=1000
ARG WHARNESS_GID=1000
ARG NGROK_VERSION=3
ARG ZROK_VERSION=1.1.11
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl openssh-client unzip \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/wharness-tunnel /usr/local/bin/wharness-tunnel
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscale
COPY --from=tailscale /usr/local/bin/tailscaled /usr/local/bin/tailscaled

RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) ngrok_arch=amd64; zrok_arch=amd64; loclx_arch=amd64 ;; \
      arm64) ngrok_arch=arm64; zrok_arch=arm64; loclx_arch=arm64 ;; \
      *) echo "unsupported tunnel runtime architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://bin.ngrok.com/c/bNyj1mQVY4c/ngrok-v${NGROK_VERSION}-stable-linux-${ngrok_arch}.tgz" -o /tmp/ngrok.tgz; \
    tar -xzf /tmp/ngrok.tgz -C /usr/local/bin ngrok; \
    curl -fsSL "https://github.com/openziti/zrok/releases/download/v${ZROK_VERSION}/zrok_${ZROK_VERSION}_linux_${zrok_arch}.tar.gz" -o /tmp/zrok.tgz; \
    tar -xzf /tmp/zrok.tgz -C /usr/local/bin zrok; \
    curl -fsSL "https://api.localxpose.io/api/v2/downloads/loclx-linux-${loclx_arch}.zip" -o /tmp/loclx.zip; \
    unzip -q /tmp/loclx.zip -d /tmp/loclx; \
    install -m 0755 "$(find /tmp/loclx -type f -name loclx -print -quit)" /usr/local/bin/loclx; \
    chmod 0755 /usr/local/bin/wharness-tunnel /usr/local/bin/cloudflared /usr/local/bin/tailscale /usr/local/bin/tailscaled /usr/local/bin/ngrok /usr/local/bin/zrok /usr/local/bin/loclx; \
    rm -rf /tmp/ngrok.tgz /tmp/zrok.tgz /tmp/loclx.zip /tmp/loclx

RUN groupadd --gid "${WHARNESS_GID}" wharness \
 && useradd --uid "${WHARNESS_UID}" --gid "${WHARNESS_GID}" --create-home --home-dir /var/lib/wharness-tunnel/home --shell /usr/sbin/nologin wharness \
 && mkdir -p /var/lib/wharness-tunnel \
 && chown -R wharness:wharness /var/lib/wharness-tunnel

USER wharness
ENV HOME=/var/lib/wharness-tunnel/home
EXPOSE 8090
ENTRYPOINT ["/usr/local/bin/wharness-tunnel"]
