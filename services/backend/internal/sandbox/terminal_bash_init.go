package sandbox

import (
	"fmt"
	"os"
	"path/filepath"
)

const bashTerminalInitName = "bash-init.sh"

// bashTerminalInit replaces `bash --login`. A login shell cannot take an
// rcfile, and every hook it offers runs before the user's startup files, which
// are free to reassign HISTFILE or overwrite PROMPT_COMMAND (vte.sh does the
// latter). The rcfile sources the same login files in the same order bash
// would, then pins project history and installs Wharnex-only history shortcuts.
const bashTerminalInit = `# Wharnex-owned project terminal init. Regenerated on every terminal start.
if [ -r /etc/profile ]; then . /etc/profile; fi
if [ -r "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile"
elif [ -r "$HOME/.bash_login" ]; then . "$HOME/.bash_login"
elif [ -r "$HOME/.profile" ]; then . "$HOME/.profile"
fi
if [[ -n ${HISTFILE:-} && $HISTFILE != "$WHARNEX_PROJECT_HISTFILE" ]]; then
	WHARNEX_OS_HISTFILE=$HISTFILE
elif [[ -n ${HISTFILE:-} && -z ${WHARNEX_OS_HISTFILE:-} && -n ${HOME:-} ]]; then
	WHARNEX_OS_HISTFILE=$HOME/.bash_history
fi
if [ -n "$WHARNEX_PROJECT_HISTFILE" ]; then
	HISTFILE="$WHARNEX_PROJECT_HISTFILE"
else
	unset HISTFILE
fi
shopt -s histappend

__wharnex_history_mode=
__wharnex_history_index=0
__wharnex_history_last_line=

__wharnex_flush_history_delta() {
	local line
	[[ -n ${WHARNEX_SESSION_HISTFILE:-} ]] || return 0
	: > "$WHARNEX_SESSION_HISTFILE"
	history -a "$WHARNEX_SESSION_HISTFILE"
	[[ -s $WHARNEX_SESSION_HISTFILE ]] || return 0
	while IFS= read -r line || [[ -n $line ]]; do
		printf '%s\n' "$line" >> "$WHARNEX_PROJECT_HISTFILE"
		[[ $line =~ ^#[0-9]+$ ]] && continue
		[[ -z ${line//[[:space:]]/} || -z ${WHARNEX_GLOBAL_HISTFILE:-} ]] || printf '%s\n' "$line" >> "$WHARNEX_GLOBAL_HISTFILE"
	done < "$WHARNEX_SESSION_HISTFILE"
	: > "$WHARNEX_SESSION_HISTFILE"
}

__wharnex_project_history() {
	[ -n "$WHARNEX_PROJECT_HISTFILE" ] || return 0
	HISTFILE="$WHARNEX_PROJECT_HISTFILE"
	__wharnex_flush_history_delta
	history -c
	history -r
}

__wharnex_history_collect_file() {
	local file=$1 line
	[[ -n $file && -r $file ]] || return 0
	while IFS= read -r line || [[ -n $line ]]; do
		[[ $line =~ ^#[0-9]+$ ]] && continue
		[[ -z ${line//[[:space:]]/} ]] && continue
		__wharnex_history_entries+=("$line")
	done < "$file"
}

__wharnex_history_pick() {
	local mode=$1 count position
	local -a __wharnex_history_entries=()
	if [[ $__wharnex_history_mode != "$mode" || $READLINE_LINE != "$__wharnex_history_last_line" ]]; then
		__wharnex_history_mode=$mode
		__wharnex_history_index=0
	else
		((__wharnex_history_index++))
	fi
	if [[ $mode == all ]]; then
		__wharnex_history_collect_file "${WHARNEX_OS_HISTFILE:-}"
	fi
	__wharnex_history_collect_file "${WHARNEX_GLOBAL_HISTFILE:-}"
	count=${#__wharnex_history_entries[@]}
	(( count > 0 )) || return 0
	(( __wharnex_history_index < count )) || __wharnex_history_index=$((count - 1))
	position=$((count - 1 - __wharnex_history_index))
	READLINE_LINE=${__wharnex_history_entries[$position]}
	READLINE_POINT=${#READLINE_LINE}
	__wharnex_history_last_line=$READLINE_LINE
}

__wharnex_history_wharnex() { __wharnex_history_pick wharnex; }
__wharnex_history_all() { __wharnex_history_pick all; }

bind -x '"\e[1;2A":__wharnex_history_wharnex'
bind -x '"\e[1;6A":__wharnex_history_all'

if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
	PROMPT_COMMAND=(__wharnex_project_history "${PROMPT_COMMAND[@]}")
else
	PROMPT_COMMAND="__wharnex_project_history${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
fi
`

func isBashShell(shell string) bool {
	return filepath.Base(shell) == "bash"
}

// bashTerminalArgs keeps GNU long options ahead of single-letter ones: bash
// rejects a long option that follows a short one and exits 2 before any
// prompt, which surfaced as every Host PTY closing immediately.
func bashTerminalArgs(initFile string) []string {
	return []string{"--rcfile", initFile, "-i"}
}

// prepareBashTerminalInit writes the rcfile inside the already-validated
// project terminal directory.
func prepareBashTerminalInit(terminalDir string) (string, error) {
	return installTerminalInitFile(terminalDir, bashTerminalInitName, bashTerminalInit)
}

// installTerminalInitFile regenerates one Wharnex-owned startup file. The
// rename replaces a planted symlink instead of writing through it.
func installTerminalInitFile(dir, name, content string) (string, error) {
	file, err := os.CreateTemp(dir, ".terminal-init-*")
	if err != nil {
		return "", fmt.Errorf("prepare project terminal init: %w", err)
	}
	tempPath := file.Name()
	defer os.Remove(tempPath)
	if _, err := file.WriteString(content); err != nil {
		_ = file.Close()
		return "", fmt.Errorf("write project terminal init: %w", err)
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return "", fmt.Errorf("secure project terminal init: %w", err)
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("close project terminal init: %w", err)
	}
	path := filepath.Join(dir, name)
	if err := os.Rename(tempPath, path); err != nil {
		return "", fmt.Errorf("install project terminal init: %w", err)
	}
	return path, nil
}
