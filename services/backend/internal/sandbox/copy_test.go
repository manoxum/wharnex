package sandbox

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCopyProjectExcludesSecrets(t *testing.T) {
	root := t.TempDir()
	_ = os.WriteFile(filepath.Join(root, "main.txt"), []byte("ok"), 0o600)
	_ = os.WriteFile(filepath.Join(root, ".env"), []byte("secret"), 0o600)
	ws, err := copyProject(root)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(ws.Path)
	if _, err := os.Stat(filepath.Join(ws.Path, "main.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(ws.Path, ".env")); !os.IsNotExist(err) {
		t.Fatal(".env should not be copied")
	}
}
