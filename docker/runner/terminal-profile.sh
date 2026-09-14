# This profile is loaded only by the human PTY's Bash login shell. It is part
# of the runner image, never project-controlled input.
if [ -n "${BASH_VERSION:-}" ] && [ -r /usr/share/bash-completion/bash_completion ]; then
  . /usr/share/bash-completion/bash_completion
fi

case $- in
  *i*)
    # The container HOME lives on tmpfs. Keep user/config caches there while
    # preserving command history across reconnects in the sandbox workspace.
    mkdir -p "${HOME:-/tmp/kernl-home}" /workspace/.kernl 2>/dev/null || true
    HISTFILE=/workspace/.kernl/terminal-bash-history
    HISTSIZE=20000
    HISTFILESIZE=40000
    HISTCONTROL=ignoreboth:erasedups
    HISTTIMEFORMAT='%F %T  '
    shopt -s histappend checkwinsize cmdhist globstar

    # Sync history after every command so reconnecting the PTY does not throw
    # away the previous session. Preserve any prompt hook installed upstream.
    __wharnex_history_sync() {
      builtin history -a
      builtin history -n
    }
    case ";${PROMPT_COMMAND:-};" in
      *';__wharnex_history_sync;'*) ;;
      *) PROMPT_COMMAND="__wharnex_history_sync${PROMPT_COMMAND:+; ${PROMPT_COMMAND}}" ;;
    esac

    # Readline completion/history behaviour closer to a full IDE terminal.
    bind 'set completion-ignore-case on'
    bind 'set completion-map-case on'
    bind 'set show-all-if-ambiguous on'
    bind 'set menu-complete-display-prefix on'
    bind 'set colored-stats on'
    bind '"\e[A": history-search-backward'
    bind '"\e[B": history-search-forward'

    # Prefer project-local executables and writable per-session user installs.
    export PATH="/workspace/node_modules/.bin:${HOME:-/tmp/kernl-home}/.local/bin:/tmp/pnpm:${PATH}"
    export EDITOR="${EDITOR:-nano}"
    export VISUAL="${VISUAL:-$EDITOR}"
    export PAGER="${PAGER:-less}"
    export PIP_CACHE_DIR="${PIP_CACHE_DIR:-/tmp/pip}"
    export COMPOSER_HOME="${COMPOSER_HOME:-/tmp/composer}"
    export PNPM_HOME="${PNPM_HOME:-/tmp/pnpm}"

    alias ll='ls -alF --color=auto'
    alias la='ls -A --color=auto'
    alias l='ls -CF --color=auto'
    alias grep='grep --color=auto'

    # Debian packages fzf's Bash integration as examples. Loading it here adds
    # fuzzy Ctrl+R history search and path completion without changing xterm.
    if [ -r /usr/share/doc/fzf/examples/key-bindings.bash ]; then
      . /usr/share/doc/fzf/examples/key-bindings.bash
    fi
    if [ -r /usr/share/doc/fzf/examples/completion.bash ]; then
      . /usr/share/doc/fzf/examples/completion.bash
    fi
    ;;
esac
