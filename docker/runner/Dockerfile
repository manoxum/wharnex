FROM golang:1.23-bookworm AS go

FROM node:22-bookworm
COPY --from=go /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
RUN apt-get update \
    && apt-get install -y --no-install-recommends git make ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && useradd --create-home --uid 10001 runner
COPY docker/runner/entrypoint.sh /usr/local/bin/kernl-entrypoint
RUN chmod 0755 /usr/local/bin/kernl-entrypoint
WORKDIR /workspace
USER runner
ENTRYPOINT ["/usr/local/bin/kernl-entrypoint"]
