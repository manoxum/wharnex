package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadReadsVersionFromProjectRoot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "VERSION"), []byte("v9.8.7\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("WHARNESS_ROOT", root)

	cfg := Load()
	if cfg.Version != "v9.8.7" {
		t.Fatalf("version = %q, want v9.8.7", cfg.Version)
	}
}
