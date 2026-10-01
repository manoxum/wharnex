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

func TestHostPTYBridgeKeepsShellAliveAcrossClientDetach(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "terminal.sock")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- ServeHostPTYBridge(ctx, socketPath) }()
	waitForHostPTYSocket(t, socketPath)
	t.Setenv("HARNESS_HOST_PTY_SOCKET", socketPath)
	workspace := Workspace{Path: t.TempDir()}
	const terminalID = "pty_reconnect_bridge"

	first, err := (&HostRunner{}).StartInteractive(workspace, TerminalOptions{ID: terminalID, Cwd: ".", Cols: 80, Rows: 24}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Write([]byte("export WHX_PTY_RECONNECT=preserved\n")); err != nil {
		t.Fatal(err)
	}
	detachable, ok := first.(DetachableTerminal)
	if !ok {
		t.Fatal("bridge-backed terminal is not detachable")
	}
	if err := detachable.Detach(); err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	var output strings.Builder
	exited := make(chan int, 1)
	second, err := (&HostRunner{}).StartInteractive(workspace, TerminalOptions{ID: terminalID, Reconnect: true, Cwd: ".", Cols: 80, Rows: 24}, func(data []byte) {
		mu.Lock()
		output.Write(data)
		mu.Unlock()
	}, func(code int, _ error) { exited <- code })
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if err := second.Write([]byte("printf 'reconnect:%s' \"$WHX_PTY_RECONNECT\"\nexit\n")); err != nil {
		t.Fatal(err)
	}
	select {
	case code := <-exited:
		if code != 0 {
			t.Fatalf("reconnected shell exited with %d", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("reconnected shell did not exit")
	}
	mu.Lock()
	result := output.String()
	mu.Unlock()
	if !strings.Contains(result, "reconnect:preserved") {
		t.Fatalf("shell state was lost across bridge reconnect: %q", result)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("host PTY bridge did not stop")
	}
}

func waitForHostPTYSocket(t *testing.T, socketPath string) {
	t.Helper()
	for deadline := time.Now().Add(2 * time.Second); ; {
		if info, err := os.Stat(socketPath); err == nil && info.Mode()&os.ModeSocket != 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("host PTY bridge socket did not become ready")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
