package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestHostInteractiveTerminalProvidesARealPersistentPTY(t *testing.T) {
	t.Setenv("HARNESS_HOST_PTY_SOCKET", "")
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

func TestHostInteractiveTerminalDelegatesToLoggedInUserBridgeWhenConfigured(t *testing.T) {
	bridgeDir := t.TempDir()
	socketPath := filepath.Join(bridgeDir, "host-pty.sock")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	bridgeDone := make(chan error, 1)
	go func() { bridgeDone <- ServeHostPTYBridge(ctx, socketPath) }()
	for deadline := time.Now().Add(2 * time.Second); ; {
		if info, err := os.Stat(socketPath); err == nil && info.Mode()&os.ModeSocket != 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("host PTY bridge socket did not become ready")
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Setenv("HARNESS_HOST_PTY_SOCKET", socketPath)
	t.Setenv("WHARNEX_HOST_SESSION_TEST", "logged-in-user-session")

	workspace := Workspace{Path: t.TempDir()}
	var mu sync.Mutex
	var output strings.Builder
	exited := make(chan int, 1)
	terminal, err := (&HostRunner{}).StartInteractive(workspace, TerminalOptions{ID: "bridge-test", Cwd: ".", Cols: 100, Rows: 30}, func(data []byte) {
		mu.Lock()
		output.Write(data)
		mu.Unlock()
	}, func(code int, _ error) { exited <- code })
	if err != nil {
		t.Fatal(err)
	}
	defer terminal.Close()
	if err := terminal.Write([]byte("printf 'bridge:%s:%s' \"$WHARNEX_HOST_SESSION_TEST\" \"$PWD\"\nexit\n")); err != nil {
		t.Fatal(err)
	}
	select {
	case code := <-exited:
		if code != 0 {
			t.Fatalf("bridged shell exited with %d", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("bridged interactive shell did not execute input and exit")
	}
	mu.Lock()
	result := output.String()
	mu.Unlock()
	if !strings.Contains(result, "bridge:logged-in-user-session:"+workspace.Path) {
		t.Fatalf("host PTY bridge did not preserve host session environment/project cwd: %q", result)
	}
	cancel()
	select {
	case err := <-bridgeDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("host PTY bridge did not stop")
	}
}

func TestHostInteractiveTerminalDoesNotFallBackWhenConfiguredBridgeIsUnavailable(t *testing.T) {
	t.Setenv("HARNESS_HOST_PTY_SOCKET", filepath.Join(t.TempDir(), "missing.sock"))
	workspace := Workspace{Path: t.TempDir()}
	_, err := (&HostRunner{}).StartInteractive(workspace, TerminalOptions{ID: "missing", Cwd: ".", Cols: 80, Rows: 24}, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "connect host PTY bridge") {
		t.Fatalf("configured Host PTY must fail closed when bridge is unavailable, got %v", err)
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
