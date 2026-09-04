package selfevolution

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManagerDetectsOnlyExactCanonicalRoot(t *testing.T) {
	root := fakeRoot(t)
	manager := New(root)
	if !manager.IsProject(root) {
		t.Fatal("expected exact root to be self-evolution")
	}
	if manager.IsProject(filepath.Join(root, "services", "backend")) {
		t.Fatal("subdirectory must not be treated as self-evolution root")
	}
	link := filepath.Join(t.TempDir(), "wharness-link")
	if err := os.Symlink(root, link); err != nil {
		t.Fatal(err)
	}
	if !manager.IsProject(link) {
		t.Fatal("canonical symlink to the same root should be detected")
	}
}

func TestTransactionRollbackRestoresTouchedSourceAndRuntime(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	mustWrite(t, filepath.Join(root, "dist", "bin", "wharness-backend"), "old-backend\n", 0o755)
	mustWrite(t, filepath.Join(root, "services", "frontend", "dist", "index.html"), "old-frontend\n", 0o644)
	mustWrite(t, filepath.Join(root, ".harness", "build-success"), "", 0o600)

	patch := strings.Join([]string{
		"diff --git a/hello.txt b/hello.txt",
		"--- a/hello.txt",
		"+++ b/hello.txt",
		"@@ -1 +1 @@",
		"-before",
		"+after",
		"diff --git a/new.txt b/new.txt",
		"--- /dev/null",
		"+++ b/new.txt",
		"@@ -0,0 +1 @@",
		"+new",
	}, "\n")

	manager := New(root)
	tx, err := manager.Prepare("plan-test", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()

	mustWrite(t, filepath.Join(root, "hello.txt"), "after\n", 0o644)
	mustWrite(t, filepath.Join(root, "new.txt"), "new\n", 0o644)
	mustWrite(t, filepath.Join(root, "dist", "bin", "wharness-backend"), "new-backend\n", 0o755)
	mustWrite(t, filepath.Join(root, "services", "frontend", "dist", "index.html"), "new-frontend\n", 0o644)
	_ = os.Remove(filepath.Join(root, ".harness", "build-success"))

	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	assertFile(t, filepath.Join(root, "hello.txt"), "before\n")
	if _, err := os.Stat(filepath.Join(root, "new.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("new file should be removed, got %v", err)
	}
	assertFile(t, filepath.Join(root, "dist", "bin", "wharness-backend"), "old-backend\n")
	assertFile(t, filepath.Join(root, "services", "frontend", "dist", "index.html"), "old-frontend\n")
	if _, err := os.Stat(filepath.Join(root, ".harness", "build-success")); err != nil {
		t.Fatalf("build stamp should be restored: %v", err)
	}
}

func TestTransactionLockRejectsConcurrentSelfEvolution(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := New(root)
	first, err := manager.Prepare("plan-one", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()
	if _, err := manager.Prepare("plan-two", []string{patch}); !errors.Is(err, ErrBusy) {
		t.Fatalf("expected ErrBusy, got %v", err)
	}
}

func fakeRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "Makefile"), "all:\n\t@true\n", 0o644)
	mustWrite(t, filepath.Join(root, "services", "backend", "go.mod"), "module example.invalid/fake\n", 0o644)
	mustWrite(t, filepath.Join(root, "services", "desktop", "package.json"), "{}\n", 0o644)
	mustWrite(t, filepath.Join(root, "scripts", "self-restart.sh"), "#!/usr/bin/env sh\nexit 0\n", 0o755)
	mustWrite(t, filepath.Join(root, "scripts", "start.sh"), "#!/usr/bin/env sh\nexit 0\n", 0o755)
	mustWrite(t, filepath.Join(root, "scripts", "stop.sh"), "#!/usr/bin/env sh\nexit 0\n", 0o755)
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

func assertFile(t *testing.T, path, expected string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != expected {
		t.Fatalf("%s = %q, expected %q", path, string(data), expected)
	}
}

func TestBuildHostRejectsDependencyMetadataMutation(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	mustWrite(t, filepath.Join(root, "Makefile"), "build:\n\t@mkdir -p services/frontend\n\t@printf 'unexpected\\n' > services/frontend/package-lock.json\n", 0o644)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := New(root)
	tx, err := manager.Prepare("plan-build-guard", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()
	if _, err := manager.BuildHost(context.Background(), tx); err == nil || !strings.Contains(err.Error(), "mutated source dependency metadata") {
		t.Fatalf("expected build guard rejection, got %v", err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "services", "frontend", "package-lock.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("rollback should remove build-created lockfile, got %v", err)
	}
}

func TestTransactionRejectsHarnessRuntimePaths(t *testing.T) {
	root := fakeRoot(t)
	manager := New(root)
	patch := "--- /dev/null\n+++ b/.harness/state/poison.json\n@@ -0,0 +1 @@\n+{}\n"
	if _, err := manager.Prepare("plan-runtime-owned", []string{patch}); err == nil || !strings.Contains(err.Error(), "runtime-owned path .harness/state/poison.json") {
		t.Fatalf("expected runtime-owned path rejection, got %v", err)
	}
}

func TestPendingTransactionRecoversRestartConfirmationHandoff(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	manager := New(root)
	tx, err := manager.Prepare("plan-confirm", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()
	if err := manager.RecordStatus(tx, "ses-confirm", "plan-confirm", "restart_pending", "awaiting user confirmation"); err != nil {
		t.Fatal(err)
	}
	recovered, err := manager.PendingTransaction("ses-confirm", "plan-confirm")
	if err != nil {
		t.Fatal(err)
	}
	if recovered.ID != tx.ID || recovered.Dir != tx.Dir || recovered.Worker != tx.Worker {
		t.Fatalf("unexpected recovered transaction: %#v", recovered)
	}
	if _, err := manager.PendingTransaction("ses-other", "plan-confirm"); err == nil {
		t.Fatal("pending transaction must be scoped to the originating session")
	}
}
