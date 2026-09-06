package contextbundle

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/projectconfig"
)

func TestSourceProbeChangesForEligibleFileMetadataAndIgnoresPrunedDependencies(t *testing.T) {
	root := t.TempDir()
	if err := projectconfig.Save(root, projectconfig.Default(root)); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root, "main.txt")
	if err := os.WriteFile(file, []byte("one"), 0o600); err != nil {
		t.Fatal(err)
	}
	first, err := SourceProbe(root)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(2 * time.Millisecond)
	if err := os.WriteFile(file, []byte("two-two"), 0o600); err != nil {
		t.Fatal(err)
	}
	second, err := SourceProbe(root)
	if err != nil {
		t.Fatal(err)
	}
	if second == first {
		t.Fatal("eligible file change did not alter source probe")
	}
	dependencyDir := filepath.Join(root, "node_modules", "pkg")
	if err := os.MkdirAll(dependencyDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dependencyDir, "index.js"), []byte("ignored"), 0o600); err != nil {
		t.Fatal(err)
	}
	third, err := SourceProbe(root)
	if err != nil {
		t.Fatal(err)
	}
	if third != second {
		t.Fatalf("mandatory excluded dependency changed source probe: %s != %s", third, second)
	}
}
