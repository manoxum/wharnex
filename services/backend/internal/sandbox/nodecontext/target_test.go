package nodecontext

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestPnpmDirectorySelectsPackageLockfileBeforeParent(t *testing.T) {
	root := t.TempDir()
	for _, rel := range []string{"pnpm-lock.yaml", "services/backend/package.json", "services/backend/pnpm-lock.yaml"} {
		path := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, selector := range [][]string{{"--dir", "services/backend"}, {"--dir=services/backend"}, {"-C", "services/backend"}} {
		command := domain.CommandSpec{Cwd: ".", Argv: append(append([]string{"pnpm"}, selector...), "run", "build")}
		before := append([]string(nil), command.Argv...)
		argv, cwd, err := InstallCommand(root, command, validateTestPath)
		if err != nil {
			t.Fatal(err)
		}
		if cwd != "services/backend" || !reflect.DeepEqual(argv, []string{"pnpm", "install", "--frozen-lockfile"}) {
			t.Fatalf("wrong acquisition package: %q %v", cwd, argv)
		}
		if !reflect.DeepEqual(command.Argv, before) || command.Cwd != "." {
			t.Fatal("changed execution contract")
		}
	}
}

func TestPnpmDirectorySelectorsAreBounded(t *testing.T) {
	for _, args := range [][]string{{"--dir"}, {"--dir="}, {"--dir", "/outside"}, {"-C", "../outside"}, {"--dir", "a/../b"}, {"--dir", "a", "-C", "b"}} {
		command := domain.CommandSpec{Argv: append([]string{"pnpm"}, args...)}
		if _, err := TargetCwd(command); err == nil {
			t.Errorf("accepted unsafe selector %v", args)
		}
		if err := Prepare(t.Context(), Paths{}, command, validateTestPath, copyTestTree); !errors.Is(err, ErrAcquisition) {
			t.Errorf("selector failure must remain local infrastructure: %v", err)
		}
	}
	for _, args := range [][]string{{"run", "build", "--dir", "ignored"}, {"--", "--dir", "ignored"}} {
		cwd, err := TargetCwd(domain.CommandSpec{Cwd: "services", Argv: append([]string{"pnpm"}, args...)})
		if err != nil || cwd != "services" {
			t.Fatalf("script argument treated as selector: %q %v", cwd, err)
		}
	}
	cwd, err := TargetCwd(domain.CommandSpec{Cwd: "services", Argv: []string{"pnpm", "-C", "backend", "run", "build"}})
	if err != nil || cwd != "services/backend" {
		t.Fatalf("selector must be cwd-relative: %q %v", cwd, err)
	}
}

func TestPnpmDirectorySymlinkEscapeIsRejectedBeforeHydration(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".pnp.cjs"), []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	command := domain.CommandSpec{Argv: []string{"pnpm", "--dir", "escape", "run", "build"}}
	if _, _, err := InstallCommand(root, command, validateTestPath); err == nil {
		t.Fatal("acquisition escaped workspace")
	}
	if err := Prepare(t.Context(), Paths{Path: root, SourcePath: root}, command, validateTestPath, copyTestTree); err == nil {
		t.Fatal("copy escaped workspace")
	}
}
