# This profile is loaded only by the human PTY's Bash login shell. It is part
# of the runner image, never project-controlled input.
if [ -n "${BASH_VERSION:-}" ] && [ -r /usr/share/bash-completion/bash_completion ]; then
  . /usr/share/bash-completion/bash_completion
fi

case $- in
  *i*)
    HISTFILE=/tmp/kernl-home/.bash_history
    HISTSIZE=10000
    HISTFILESIZE=20000
    bind 'set completion-ignore-case on'
    bind 'set show-all-if-ambiguous on'
    ;;
esac
