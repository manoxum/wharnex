FROM golang:1.23-bookworm AS go

FROM node:22-bookworm
COPY --from=go /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
# The image serves two different consumers. Agent commands remain constrained by
# the published tool inventory and Policy, while the explicitly human-owned PTY
# should feel like a practical developer shell. Keep the base non-privileged,
# but ship the common compilers, language CLIs, database clients and terminal
# helpers a developer routinely needs. Network clients (curl, wget, ssh, nc)
# deliberately remain absent: the runner has no network by default and those
# executables are denied by Policy regardless.
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
    && corepack enable \
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
