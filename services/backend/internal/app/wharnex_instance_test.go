package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectedWharnexInstanceReadsOnlyTheInstanceLabel(t *testing.T) {
	root := t.TempDir()
	for _, path := range []string{"services/backend/go.mod", "services/desktop/package.json", ".harness/env"} {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(root, path)), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, path), []byte("WHARNESS_INSTANCE_ID=legacy\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if got := detectedWharnexInstance(root); got != "legacy" {
		t.Fatalf("instance = %q", got)
	}
	if !legacySelfOpenForbidden("legacy", true) || legacySelfOpenForbidden("legacy", false) {
		t.Fatal("legacy self-open guard is incorrect")
	}
}
