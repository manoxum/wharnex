package remoteinput

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/app"
)

func TestTunnelControlDistinguishesPauseAndPersistedStop(t *testing.T) {
	provider := &fakeChannelProvider{}
	statePath := filepath.Join(t.TempDir(), "state.json")
	manager := NewPool([]Instance{{ID: "edge", Provider: provider}}, statePath)

	if err := manager.ControlRemoteInput(context.Background(), "edge", "pause"); err != nil {
		t.Fatal(err)
	}
	if got := manager.Status().Instances[0].State; got != "paused" {
		t.Fatalf("state after pause = %q", got)
	}
	input := filepath.Join(t.TempDir(), "input.zip")
	if err := os.WriteFile(input, []byte("zip"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Publish(context.Background(), app.RemoteInputObject{ObjectName: "input.zip", FilePath: input, Bytes: 3, FileCount: 1, MaxFileSize: 3}); err == nil {
		t.Fatal("paused tunnel must reject new publications")
	}

	if err := manager.ControlRemoteInput(context.Background(), "edge", "resume"); err != nil {
		t.Fatal(err)
	}
	if got := manager.Status().Instances[0].State; got != "active" {
		t.Fatalf("state after resume = %q", got)
	}

	if err := manager.ControlRemoteInput(context.Background(), "edge", "stop"); err != nil {
		t.Fatal(err)
	}
	if got := manager.Status().Instances[0].State; got != "stopped" {
		t.Fatalf("state after stop = %q", got)
	}

	restarted := NewPool([]Instance{{ID: "edge", Provider: provider}}, statePath)
	if err := restarted.StartRemoteInputSession(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := restarted.Status().Instances[0].State; got != "stopped" {
		t.Fatalf("persisted state after restart = %q", got)
	}
}
