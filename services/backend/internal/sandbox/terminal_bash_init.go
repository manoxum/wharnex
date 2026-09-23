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
// would, and only then pins the project history, so nothing loaded earlier can
// point the shell back at the user's global history. Bash reads HISTFILE after
// the rcfile, so the first history it loads is already the project's.
const bashTerminalInit = `# Wharnex-owned project terminal init. Regenerated on every terminal start.
if [ -r /etc/profile ]; then . /etc/profile; fi
if [ -r "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile"
elif [ -r "$HOME/.bash_login" ]; then . "$HOME/.bash_login"
elif [ -r "$HOME/.profile" ]; then . "$HOME/.profile"
fi
if [ -n "$WHARNEX_PROJECT_HISTFILE" ]; then
	HISTFILE="$WHARNEX_PROJECT_HISTFILE"
else
	unset HISTFILE
fi
shopt -s histappend
__wharnex_project_history() {
	[ -n "$WHARNEX_PROJECT_HISTFILE" ] || return 0
	HISTFILE="$WHARNEX_PROJECT_HISTFILE"
	history -a
	history -c
	history -r
}
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
