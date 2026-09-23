package sandbox

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestNonBashTerminalKeepsLoginShell(t *testing.T) {
	sh, err := exec.LookPath("sh")
	if err != nil {
		t.Skip("sh is unavailable")
	}
	t.Setenv("SHELL", sh)
	project := t.TempDir()
	cmd, err := localTerminalCommand(Workspace{Path: project, SourcePath: project}, TerminalOptions{Cwd: "."})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(cmd.Args[1:], " "); got != "-l" {
		t.Fatalf("non-bash user shell must retain its login semantics: %q", got)
	}
}

// Regression: `bash -O histappend --login -i` exits 2 before any prompt,
// so every Host PTY closed immediately and the UI reported
// "terminal session is closed". This drives a real bash through a PTY with
// startup files that point history back at a global file and clobber
// PROMPT_COMMAND the way vte.sh does.
func TestBashTerminalStartsAndKeepsHistoryInTheProject(t *testing.T) {
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("bash is unavailable")
	}
	home := t.TempDir()
	globalHistory := filepath.Join(home, ".bash_history")
	if err := os.WriteFile(globalHistory, []byte("echo GLOBAL_ONLY_COMMAND\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	profile := "HISTFILE=\"$HOME/.bash_history\"\nPROMPT_COMMAND=true\nPS1='wx$ '\n"
	if err := os.WriteFile(filepath.Join(home, ".profile"), []byte(profile), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("SHELL", bash)
	t.Setenv("HISTFILE", globalHistory)
	project := t.TempDir()

	output, code := runProjectTerminal(t, project, "echo project-marker\nhistory\nexit\n")
	if code != 0 {
		t.Fatalf("bash PTY exited %d, want 0; output:\n%s", code, output)
	}
	if strings.Contains(output, "GLOBAL_ONLY_COMMAND") {
		t.Fatalf("project terminal loaded the global history:\n%s", output)
	}
	projectHistory, err := os.ReadFile(filepath.Join(project, ".harness", "terminal", "history", "bash"))
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

func runProjectTerminal(t *testing.T, project, input string) (string, int) {
	t.Helper()
	cmd, err := localTerminalCommand(Workspace{Path: project, SourcePath: project}, TerminalOptions{Cwd: "."})
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var output strings.Builder
	exited := make(chan int, 1)
	terminal, err := startProcessTerminal(cmd, TerminalOptions{Cols: 120, Rows: 40}, nil, func(data []byte) {
		mu.Lock()
		output.Write(data)
		mu.Unlock()
	}, func(code int, _ error) { exited <- code })
	if err != nil {
		t.Fatal(err)
	}
	defer terminal.Close()
	if err := terminal.Write([]byte(input)); err != nil {
		t.Fatal(err)
	}
	select {
	case code := <-exited:
		mu.Lock()
		defer mu.Unlock()
		return output.String(), code
	case <-time.After(10 * time.Second):
		mu.Lock()
		defer mu.Unlock()
		t.Fatalf("project PTY did not exit; output:\n%s", output.String())
		return "", -1
	}
}
