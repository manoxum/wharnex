package buildhost_test

import (
	"os"
	"path/filepath"
	"testing"
)

func fakeRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for path, content := range map[string]string{
		"Makefile":                      "all:\n\t@true\n",
		"services/backend/go.mod":       "module example.invalid/fake\n",
		"services/desktop/package.json": "{}\n",
		"scripts/self-restart.sh":       "#!/usr/bin/env sh\nexit 0\n",
		"scripts/start.sh":              "#!/usr/bin/env sh\nexit 0\n",
		"scripts/stop.sh":               "#!/usr/bin/env sh\nexit 0\n",
		"scripts/stack.sh":              "#!/usr/bin/env sh\nexit 0\n",
	} {
		mode := os.FileMode(0o644)
		if filepath.Ext(path) == ".sh" {
			mode = 0o755
		}
		mustWrite(t, filepath.Join(root, path), content, mode)
	}
	return root
}

func mustWrite(t *testing.T, path, content string, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatal(err)
	}
}
