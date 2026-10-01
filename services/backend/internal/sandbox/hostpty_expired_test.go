package sandbox

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestHostPTYRestartRejectsExpiredReconnect(t *testing.T) {
	socketPath := filepath.Join(t.TempDir(), "terminal.sock")
	workspace := Workspace{Path: t.TempDir()}
	t.Setenv("HARNESS_HOST_PTY_SOCKET", socketPath)
	start := func() (context.CancelFunc, <-chan error) {
		ctx, cancel := context.WithCancel(context.Background())
		done := make(chan error, 1)
		go func() { done <- ServeHostPTYBridge(ctx, socketPath) }()
		waitForHostPTYSocket(t, socketPath)
		return cancel, done
	}
	cancel, done := start()
	first, err := (&HostRunner{}).StartInteractive(workspace, TerminalOptions{ID: "pty_expired", Cwd: ".", Cols: 80, Rows: 24}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	firstGeneration := first.(interface{ TerminalGeneration() string }).TerminalGeneration()
	_ = first.(DetachableTerminal).Detach()
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("sidecar did not stop")
	}
	cancel, done = start()
	defer func() { cancel(); <-done }()
	_, err = (&HostRunner{}).StartInteractive(workspace, TerminalOptions{ID: "pty_expired", Reconnect: true, Cwd: ".", Cols: 80, Rows: 24}, nil, nil)
	if !errors.Is(err, ErrTerminalExpired) {
		t.Fatalf("reconnect error = %v", err)
	}
	var expired *TerminalExpiredError
	if !errors.As(err, &expired) || expired.Generation == "" || expired.Generation == firstGeneration {
		t.Fatalf("missing new daemon generation: %v", err)
	}
}
