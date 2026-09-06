package main

import (
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/config"
)

func TestTunnelInputManagerBuildsSeveralInstancesInPriorityOrder(t *testing.T) {
	root := t.TempDir()
	configFile := filepath.Join(root, "tunnel-providers.json")
	raw := []byte(`{"version":1,"instances":[{"id":"backup","provider":"tailscale_funnel","priority":20,"public_url":"https://backup.example.ts.net","local_port":8443},{"id":"primary","provider":"tailscale_funnel","priority":10,"public_url":"https://primary.example.ts.net","local_port":10000}]}`)
	if err := os.WriteFile(configFile, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := tunnelInputManager(config.TunnelConfig{ConfigFile: configFile, IndexFile: filepath.Join(root, "state.json")})
	if err != nil {
		t.Fatal(err)
	}
	status := manager.Status()
	if len(status.Instances) != 2 || status.Instances[0].ID != "primary" || status.Instances[1].ID != "backup" {
		t.Fatalf("unexpected pool order: %#v", status.Instances)
	}
}
