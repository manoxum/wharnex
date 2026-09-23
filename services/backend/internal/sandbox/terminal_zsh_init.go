package sandbox

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

// zshPinHistory runs after the user's .zshrc and .zlogin. zsh reads HISTFILE
// once startup files finish, so the first history it loads is the project's.
// zsh saves nothing while SAVEHIST is 0, which is its default.
const zshPinHistory = `if [[ -n $WHARNEX_PROJECT_HISTFILE ]]; then
	HISTFILE=$WHARNEX_PROJECT_HISTFILE
else
	unset HISTFILE
fi
(( ${SAVEHIST:-0} > 0 )) || SAVEHIST=10000
(( ${HISTSIZE:-0} >= SAVEHIST )) || HISTSIZE=$SAVEHIST
setopt APPEND_HISTORY INC_APPEND_HISTORY
__wharnex_project_history() {
	[[ -n $WHARNEX_PROJECT_HISTFILE ]] && HISTFILE=$WHARNEX_PROJECT_HISTFILE
	return 0
}
autoload -Uz add-zsh-hook && add-zsh-hook precmd __wharnex_project_history
`

func isZshShell(shell string) bool {
	return filepath.Base(shell) == "zsh"
}

// prepareZshTerminalInit writes the Wharnex ZDOTDIR and returns it.
func prepareZshTerminalInit(terminalDir string) (string, error) {
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

// zshTerminalEnvironment records the user's own ZDOTDIR before replacing it.
func zshTerminalEnvironment(env []string, zdotdir string) []string {
	env = replaceEnvironmentValue(env, "WHARNEX_USER_ZDOTDIR", environmentValue(env, "ZDOTDIR"))
	return replaceEnvironmentValue(env, "ZDOTDIR", zdotdir)
}
