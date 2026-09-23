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

func TestOwnedInteractiveTerminalContainerUsesLabelsAndScopedLegacyMounts(t *testing.T) {
	root := t.TempDir()
	privateTemp := filepath.Join(root, ".harness", "bridge", "tmp")
	legacyWorkspace := filepath.Join(privateTemp, "kernl-workspace-legacy")

	owned := terminalContainerInspectionForTest("/wharnex-terminal-pty_owned", map[string]string{
		"wharness.role": "terminal",
		"wharness.root": root,
	})
	if !ownedInteractiveTerminalContainer(owned, root, privateTemp) {
		t.Fatal("terminal carrying this checkout's ownership labels must be reclaimable")
	}

	foreign := terminalContainerInspectionForTest("/wharnex-terminal-pty_foreign", map[string]string{
		"wharness.role": "terminal",
		"wharness.root": filepath.Join(root, "other-checkout"),
	}, legacyWorkspace)
	if ownedInteractiveTerminalContainer(foreign, root, privateTemp) {
		t.Fatal("an explicitly foreign terminal must never fall back to legacy mount ownership")
	}

	legacy := terminalContainerInspectionForTest("/wharnex-terminal-pty_legacy", nil, legacyWorkspace)
	if !ownedInteractiveTerminalContainer(legacy, root, privateTemp) {
		t.Fatal("legacy terminal inside this checkout's private TMPDIR must be reclaimable")
	}

	outside := terminalContainerInspectionForTest("/wharnex-terminal-pty_outside", nil, filepath.Join(t.TempDir(), "kernl-workspace-other"))
	if ownedInteractiveTerminalContainer(outside, root, privateTemp) {
		t.Fatal("legacy terminal outside this checkout's private TMPDIR must be preserved")
	}

	unscopedTemp := terminalContainerInspectionForTest("/wharnex-terminal-pty_unscoped", nil, legacyWorkspace)
	if ownedInteractiveTerminalContainer(unscopedTemp, root, "/tmp") {
		t.Fatal("a shared TMPDIR outside the checkout must not authorize legacy reclamation")
	}

	unrelated := terminalContainerInspectionForTest("/other-terminal-pty", map[string]string{
		"wharness.role": "terminal",
		"wharness.root": root,
	})
	if ownedInteractiveTerminalContainer(unrelated, root, privateTemp) {
		t.Fatal("ownership labels must not turn an unrelated container into a terminal candidate")
	}
}

func terminalContainerInspectionForTest(name string, labels map[string]string, mounts ...string) dockerContainerInspection {
	var container dockerContainerInspection
	container.ID = strings.TrimPrefix(name, "/")
	container.Name = name
	container.Config.Labels = labels
	container.Mounts = make([]struct {
		Source string `json:"Source"`
	}, len(mounts))
	for index, source := range mounts {
		container.Mounts[index].Source = source
	}
	return container
}
