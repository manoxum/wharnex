package sandbox

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/sandbox/terminalinit"
)

// Drives a real zsh through a PTY whose .zshrc points history back at a global
// file. Every user stage must still run, and history must stay in the project.
func TestZshTerminalRunsUserStartupAndKeepsHistoryInTheProject(t *testing.T) {
	zsh, err := exec.LookPath("zsh")
	if err != nil {
		t.Skip("zsh is unavailable")
	}
	home := t.TempDir()
	globalHistory := filepath.Join(home, ".zsh_history")
	if err := os.WriteFile(globalHistory, []byte("echo GLOBAL_ONLY_COMMAND\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	startup := map[string]string{
		".zshenv":   "export WX_STAGES=env\n",
		".zprofile": "WX_STAGES=${WX_STAGES}-profile\n",
		".zshrc":    "WX_STAGES=${WX_STAGES}-rc\nHISTFILE=$HOME/.zsh_history\nSAVEHIST=100\nHISTSIZE=100\nPROMPT='wx%% '\n",
		".zlogin":   "WX_STAGES=${WX_STAGES}-login\n",
	}
	for name, content := range startup {
		if err := os.WriteFile(filepath.Join(home, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("HOME", home)
	t.Setenv("SHELL", zsh)
	t.Setenv("ZDOTDIR", "")
	t.Setenv("HISTFILE", globalHistory)
	project := t.TempDir()

	input := "echo project-marker\necho stages=$WX_STAGES zdotdir=$ZDOTDIR\nfc -l 1\nexit\n"
	output, code := runProjectTerminal(t, project, input)
	if code != 0 {
		t.Fatalf("zsh PTY exited %d, want 0; output:\n%s", code, output)
	}
	if !strings.Contains(output, "stages=env-profile-rc-login zdotdir="+home) {
		t.Fatalf("user startup stages or ZDOTDIR hand-back are wrong:\n%s", output)
	}
	if strings.Contains(output, "GLOBAL_ONLY_COMMAND") {
		t.Fatalf("project terminal loaded the global history:\n%s", output)
	}
	projectHistory, err := os.ReadFile(filepath.Join(project, ".harness", "terminal", "history", "zsh"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(projectHistory), "echo project-marker") {
		t.Fatalf("project history did not record the command: %q", projectHistory)
	}
	globalData, err := os.ReadFile(globalHistory)
	if err != nil {
		t.Fatal(err)
	}
	if string(globalData) != "echo GLOBAL_ONLY_COMMAND\n" {
		t.Fatalf("global history was modified: %q", globalData)
	}
}

func TestZshTerminalInitInstallsScopedHistoryBindings(t *testing.T) {
	terminalDir := t.TempDir()
	zdotdir, err := terminalinit.PrepareZsh(terminalDir)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(zdotdir, ".zshrc"))
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	for _, want := range []string{
		"WHARNEX_OS_HISTFILE",
		"WHARNEX_GLOBAL_HISTFILE",
		"bindkey '^[[1;2A' __wharnex_history_wharnex",
		"bindkey '^[[1;6A' __wharnex_history_all",
	} {
		if !strings.Contains(content, want) {
			t.Fatalf("generated .zshrc is missing %q", want)
		}
	}
}
