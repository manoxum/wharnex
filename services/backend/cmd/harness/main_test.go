package main

import (
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/config"
)

func TestRemoteInputManagerBuildsSeveralInstancesInPriorityOrder(t *testing.T) {
	root := t.TempDir()
	configFile := filepath.Join(root, "remote-storage.json")
	raw := []byte(`{"version":1,"instances":[{"id":"backup","provider":"http","priority":20,"upload_url":"https://upload-two.example/","public_url":"https://files-two.example/"},{"id":"primary","provider":"http","priority":10,"upload_url":"https://upload-one.example/","public_url":"https://files-one.example/"}]}`)
	if err := os.WriteFile(configFile, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	manager, err := remoteInputManager(config.RemoteStorageConfig{ConfigFile: configFile, IndexFile: filepath.Join(root, "state.json")})
	if err != nil {
		t.Fatal(err)
	}
	status := manager.Status()
	if len(status.Instances) != 2 || status.Instances[0].ID != "primary" || status.Instances[1].ID != "backup" {
		t.Fatalf("unexpected pool order: %#v", status.Instances)
	}
}
