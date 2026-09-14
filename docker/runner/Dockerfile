FROM golang:1.23-bookworm AS go

FROM node:22-bookworm
COPY --from=go /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
# The installed set is deliberately narrow and non-privileged: build drivers,
# source control, and the structured-data/search/archive utilities a
# verification step genuinely needs. `jq` and `ripgrep` are here because real
# plans proposed them and lost a full request round trip to exit code 127.
# Network clients (curl, wget, ssh, nc) are deliberately absent — the runner
# has no network by default and those executables are denied by policy anyway.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       bash bash-completion git make ca-certificates build-essential pkg-config \
       jq ripgrep patch diffutils vim-tiny nano less \
       unzip zip xz-utils file tree \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && useradd --create-home --uid 10001 runner
COPY docker/runner/entrypoint.sh /usr/local/bin/kernl-entrypoint
COPY docker/runner/toolchain.sh /usr/local/bin/kernl-toolchain
COPY docker/runner/terminal-profile.sh /etc/profile.d/wharnex-terminal.sh
RUN chmod 0755 /usr/local/bin/kernl-entrypoint /usr/local/bin/kernl-toolchain /etc/profile.d/wharnex-terminal.sh
WORKDIR /workspace
USER runner
ENTRYPOINT ["/usr/local/bin/kernl-entrypoint"]
