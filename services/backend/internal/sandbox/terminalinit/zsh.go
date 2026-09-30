package terminalinit

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const zshTerminalInitDirName = "zsh"

// Every zsh startup stage is looked up under $ZDOTDIR, so Wharnex points
// ZDOTDIR at its own directory and each stage sources the user's file of the
// same name from their real ZDOTDIR (or HOME). ZDOTDIR is swapped back in
// between stages so the next stage still resolves to Wharnex's copy; .zlogin,
// the last stage, hands ZDOTDIR back to the user for the rest of the session.
const zshStageTemplate = `# Wharnex-owned project terminal init. Regenerated on every terminal start.
__wharnex_zdotdir=$ZDOTDIR
ZDOTDIR=${WHARNEX_USER_ZDOTDIR:-$HOME}
[[ -r $ZDOTDIR/%[1]s ]] && builtin source $ZDOTDIR/%[1]s
WHARNEX_USER_ZDOTDIR=${ZDOTDIR:-$HOME}
ZDOTDIR=$__wharnex_zdotdir
unset __wharnex_zdotdir
`

// zshPinHistory runs after the user's .zshrc and .zlogin. It preserves the
// user's real history path for Ctrl+Shift+Up, then pins normal zsh history to
// the current project. Shift+Up and Ctrl+Shift+Up are ZLE-only widgets, so they
// affect the shell prompt and never steal those keys from a foreground TUI.
const zshPinHistory = `if [[ -n ${HISTFILE:-} && $HISTFILE != $WHARNEX_PROJECT_HISTFILE ]]; then
	WHARNEX_OS_HISTFILE=$HISTFILE
fi
if [[ -n $WHARNEX_PROJECT_HISTFILE ]]; then
	HISTFILE=$WHARNEX_PROJECT_HISTFILE
else
	unset HISTFILE
fi
(( ${SAVEHIST:-0} > 0 )) || SAVEHIST=10000
(( ${HISTSIZE:-0} >= SAVEHIST )) || HISTSIZE=$SAVEHIST
setopt APPEND_HISTORY INC_APPEND_HISTORY

if [[ -z ${__WHARNEX_HISTORY_WIDGETS_READY:-} ]]; then
	typeset -g __WHARNEX_HISTORY_WIDGETS_READY=1
	typeset -g __wharnex_history_ready=0
	typeset -g __wharnex_history_synced_histcmd=0
	typeset -g __wharnex_history_mode=
	typeset -gi __wharnex_history_index=0
	typeset -g __wharnex_history_last_line=

	__wharnex_append_global_history() {
		local current_histcmd=$HISTCMD command
		if (( __wharnex_history_ready )) && [[ $current_histcmd != $__wharnex_history_synced_histcmd && -n ${WHARNEX_GLOBAL_HISTFILE:-} ]]; then
			command=$(builtin fc -ln -1 2>/dev/null) || command=
			[[ -z ${command//[[:space:]]/} ]] || print -r -- "$command" >> "$WHARNEX_GLOBAL_HISTFILE"
		fi
	}

	__wharnex_project_history() {
		__wharnex_append_global_history
		[[ -n $WHARNEX_PROJECT_HISTFILE ]] || return 0
		HISTFILE=$WHARNEX_PROJECT_HISTFILE
		__wharnex_history_synced_histcmd=$HISTCMD
		__wharnex_history_ready=1
	}

	__wharnex_history_collect_file() {
		local file=$1 line
		local extended_pattern='^: [0-9]+:[0-9]+;(.*)$'
		local timestamp_pattern='^#[0-9]+$'
		[[ -n $file && -r $file ]] || return 0
		while IFS= read -r line || [[ -n $line ]]; do
			[[ $line =~ $extended_pattern ]] && line=$match[1]
			[[ $line =~ $timestamp_pattern ]] && continue
			[[ -z ${line//[[:space:]]/} ]] && continue
			__wharnex_history_entries+=("$line")
		done < "$file"
	}

	__wharnex_history_pick() {
		local mode=$1 count position
		local -a __wharnex_history_entries=()
		if [[ $__wharnex_history_mode != $mode || $BUFFER != $__wharnex_history_last_line ]]; then
			__wharnex_history_mode=$mode
			__wharnex_history_index=0
		else
			(( __wharnex_history_index++ ))
		fi
		[[ $mode != all ]] || __wharnex_history_collect_file "${WHARNEX_OS_HISTFILE:-}"
		__wharnex_history_collect_file "${WHARNEX_GLOBAL_HISTFILE:-}"
		count=${#__wharnex_history_entries[@]}
		(( count > 0 )) || return 0
		(( __wharnex_history_index < count )) || __wharnex_history_index=$((count - 1))
		position=$((count - __wharnex_history_index))
		BUFFER=${__wharnex_history_entries[$position]}
		CURSOR=${#BUFFER}
		__wharnex_history_last_line=$BUFFER
	}

	__wharnex_history_wharnex() { __wharnex_history_pick wharnex; }
	__wharnex_history_all() { __wharnex_history_pick all; }
	zle -N __wharnex_history_wharnex
	zle -N __wharnex_history_all
	bindkey '^[[1;2A' __wharnex_history_wharnex
	bindkey '^[[1;6A' __wharnex_history_all
	autoload -Uz add-zsh-hook
	add-zsh-hook precmd __wharnex_project_history
fi
`

func IsZshShell(shell string) bool {
	return filepath.Base(shell) == "zsh"
}

// PrepareZsh writes the Wharnex ZDOTDIR and returns it.
func PrepareZsh(terminalDir string) (string, error) {
	dir := filepath.Join(terminalDir, zshTerminalInitDirName)
	if info, err := os.Lstat(dir); err == nil {
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return "", fmt.Errorf("project terminal zsh directory %q must be a real directory", dir)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("inspect project terminal zsh directory: %w", err)
	} else if err := os.Mkdir(dir, 0o700); err != nil {
		return "", fmt.Errorf("prepare project terminal zsh directory: %w", err)
	}
	files := map[string]string{
		".zshenv":   fmt.Sprintf(zshStageTemplate, ".zshenv"),
		".zprofile": fmt.Sprintf(zshStageTemplate, ".zprofile"),
		".zshrc":    fmt.Sprintf(zshStageTemplate, ".zshrc") + zshPinHistory,
		".zlogin":   fmt.Sprintf(zshStageTemplate, ".zlogin") + zshPinHistory + "ZDOTDIR=$WHARNEX_USER_ZDOTDIR\n",
	}
	for name, content := range files {
		if _, err := installTerminalInitFile(dir, name, content); err != nil {
			return "", err
		}
	}
	return dir, nil
}

// ZshEnvironment records the user's own ZDOTDIR before replacing it.
func ZshEnvironment(env []string, zdotdir string) []string {
	env = ReplaceEnvironmentValue(env, "WHARNEX_USER_ZDOTDIR", EnvironmentValue(env, "ZDOTDIR"))
	return ReplaceEnvironmentValue(env, "ZDOTDIR", zdotdir)
}
