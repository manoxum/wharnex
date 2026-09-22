FROM golang:1.23-bookworm AS go

FROM node:22-bookworm
ARG PNPM_VERSION=10.17.1
ARG YARN_VERSION=1.22.22
COPY --from=go /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
# The image serves two different consumers. Agent commands remain constrained by
# the published tool inventory and Policy, while the explicitly human-owned PTY
# should feel like a practical developer shell. Keep the base non-privileged,
# but ship the common compilers, language CLIs, database clients and terminal
# helpers a developer routinely needs. Network clients (curl, wget, ssh, nc)
# deliberately remain absent: the runner has no network by default and those
# executables are denied by Policy regardless.
#
# pnpm/yarn are installed as real pinned binaries rather than Corepack shims,
# because a shim resolves its payload over the network and the runner has none.
# The base image already ships its own yarn under /opt, whose symlinks would
# make the pinned install fail with EEXIST, so they are dropped first: the
# version that ends up on PATH is always YARN_VERSION and never whatever the
# base image happened to bundle. Both are then probed, since kernl-toolchain
# only publishes a tool whose version command actually succeeds.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       bash bash-completion dash zsh git make ca-certificates \
       build-essential pkg-config cmake ninja-build \
       python3 python3-pip python3-venv python-is-python3 \
       php-cli php-curl php-mbstring php-xml php-zip composer \
       sqlite3 postgresql-client redis-tools \
       jq ripgrep patch diffutils shellcheck \
       vim-tiny nano less fzf tmux procps psmisc lsof util-linux \
       unzip zip xz-utils file tree \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v* \
    && npm install --global "pnpm@${PNPM_VERSION}" "yarn@${YARN_VERSION}" \
    && pnpm --version && yarn --version \
    && useradd --create-home --uid 10001 --shell /bin/bash runner
COPY docker/runner/entrypoint.sh /usr/local/bin/kernl-entrypoint
COPY docker/runner/toolchain.sh /usr/local/bin/kernl-toolchain
COPY docker/runner/terminal-profile.sh /etc/profile.d/wharnex-terminal.sh
COPY docker/runner/terminal-zshrc /etc/wharnex/zsh/.zshrc
ENV ZDOTDIR=/etc/wharnex/zsh
RUN chmod 0755 /usr/local/bin/kernl-entrypoint /usr/local/bin/kernl-toolchain /etc/profile.d/wharnex-terminal.sh \
    && chmod 0644 /etc/wharnex/zsh/.zshrc
WORKDIR /workspace
USER runner
ENTRYPOINT ["/usr/local/bin/kernl-entrypoint"]
