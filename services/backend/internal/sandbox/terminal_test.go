package sandbox

import (
	"strings"
	"sync"
	"testing"
	"time"
)

func TestHostInteractiveTerminalProvidesARealPersistentPTY(t *testing.T) {
	workspace := Workspace{Path: t.TempDir()}
	var mu sync.Mutex
	var output strings.Builder
	exited := make(chan int, 1)
	terminal, err := (&HostRunner{}).StartInteractive(workspace, TerminalOptions{ID: "test", Cwd: ".", Cols: 80, Rows: 24}, func(data []byte) {
		mu.Lock()
		output.Write(data)
		mu.Unlock()
	}, func(code int, _ error) { exited <- code })
	if err != nil {
		t.Fatal(err)
	}
	defer terminal.Close()
	if err := terminal.Write([]byte("cd /\nprintf 'wharnex-pty:%s' \"$PWD\"\nexit\n")); err != nil {
		t.Fatal(err)
	}
	select {
	case code := <-exited:
		if code != 0 {
			t.Fatalf("shell exited with %d", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("interactive shell did not execute input and exit")
	}
	mu.Lock()
	result := output.String()
	mu.Unlock()
	if !strings.Contains(result, "wharnex-pty:/") {
		t.Fatalf("PTY did not preserve shell state across commands: %q", result)
	}
}

func TestInteractiveBashUsesAnExplicitLoginShell(t *testing.T) {
	if got := interactiveShellArgs("/bin/bash"); !strings.EqualFold(strings.Join(got, " "), "--login -i") {
		t.Fatalf("bash must start as the interactive login shell for completion: %q", got)
	}
	if got := interactiveShellArgs("/bin/zsh"); !strings.EqualFold(strings.Join(got, " "), "-l") {
		t.Fatalf("non-bash user shell must retain its login semantics: %q", got)
	}
}
