package nodecontext

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestPrepareNodeDependenciesRejectsPartialTreeForDirectLocalBinary(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	workspace := Paths{Path: t.TempDir(), SourcePath: root}
	err := Prepare(t.Context(), workspace, domain.CommandSpec{Argv: []string{"./node_modules/.bin/tsc", "--noEmit"}}, validateTestPath, copyTestTree)
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("partial node_modules must trigger acquisition, got %v", err)
	}
}

func TestRequiresLocalNodeDependenciesRecognizesProjectBinary(t *testing.T) {
	if !RequiresDependencies([]string{"./node_modules/.bin/tsc", "--noEmit"}) {
		t.Fatal("project-local binary must be preflighted")
	}
}

func TestPrepareNodeDependenciesCopiesPnpmDirectoryPackage(t *testing.T) {
	root := t.TempDir()
	target := "services/drcae-backend"
	binary := filepath.Join(root, target, "node_modules", ".bin", "nest")
	if err := os.MkdirAll(filepath.Dir(binary), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(binary, []byte("test tool"), 0o700); err != nil {
		t.Fatal(err)
	}
	workspace := Paths{Path: t.TempDir(), SourcePath: root}
	command := domain.CommandSpec{Cwd: ".", Argv: []string{"pnpm", "--dir", target, "run", "be:build"}}
	// A context snapshot retains the package directory but excludes node_modules.
	if err := os.MkdirAll(filepath.Join(workspace.Path, target), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := Prepare(t.Context(), workspace, command, validateTestPath, copyTestTree); err != nil {
		t.Fatalf("pnpm directory target must hydrate its own dependencies: %v", err)
	}
	if _, err := os.Stat(filepath.Join(workspace.Path, target, "node_modules", ".bin", "nest")); err != nil {
		t.Fatal(err)
	}
}

func validateTestPath(root, rel string) (string, error) {
	p := filepath.Join(root, rel)
	r, err := filepath.Rel(root, p)
	if err != nil || r == ".." || strings.HasPrefix(r, "../") {
		return "", errors.New("outside root")
	}
	if _, err := os.Stat(p); err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(p)
	if err != nil {
		return "", err
	}
	r, err = filepath.Rel(root, resolved)
	if err != nil || r == ".." || strings.HasPrefix(r, "../") {
		return "", errors.New("symlink outside root")
	}
	return p, nil
}

func copyTestTree(ctx context.Context, source, target, _, _ string) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		dst := filepath.Join(target, rel)
		if entry.IsDir() {
			return os.MkdirAll(dst, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(dst, data, 0o600)
	})
}
