package sandbox

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestPrepareNodeDependenciesRejectsPartialTreeForDirectLocalBinary(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	workspace := Workspace{Path: t.TempDir(), SourcePath: root}
	err := prepareNodeDependenciesContext(t.Context(), workspace, domain.CommandSpec{Argv: []string{"./node_modules/.bin/tsc", "--noEmit"}})
	if !errors.Is(err, ErrNodeDependenciesUnavailable) {
		t.Fatalf("partial node_modules must trigger acquisition, got %v", err)
	}
}

func TestRequiresLocalNodeDependenciesRecognizesProjectBinary(t *testing.T) {
	if !requiresLocalNodeDependencies([]string{"./node_modules/.bin/tsc", "--noEmit"}) {
		t.Fatal("project-local binary must be preflighted")
	}
}
