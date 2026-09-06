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
	tx, err := manager.Prepare("ses-test", "plan-test", []string{patch})
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
	first, err := manager.Prepare("ses-one", "plan-one", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()
	if _, err := manager.Prepare("ses-two", "plan-two", []string{patch}); !errors.Is(err, ErrBusy) {
		t.Fatalf("expected ErrBusy, got %v", err)
	}
}

func TestPendingBatchAcceptsSequentialHostChangesAndKeepsOriginalRollbackBaseline(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	manager := New(root)
	firstPatch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after-one\n"
	first, err := manager.Prepare("ses-one", "plan-one", []string{firstPatch})
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()
	mustWrite(t, filepath.Join(root, "hello.txt"), "after-one\n", 0o644)
	if err := manager.RecordStatus(first, "ses-one", "plan-one", "restart_pending", "first build ready"); err != nil {
		t.Fatal(err)
	}
	first.ReleaseStage()

	secondPatch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-after-one\n+after-two\n"
	second, err := manager.Prepare("ses-two", "plan-two", []string{secondPatch})
	if err != nil {
		t.Fatalf("expected pending batch extension, got %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("expected one atomic pending batch, got %s then %s", first.ID, second.ID)
	}
	mustWrite(t, filepath.Join(root, "hello.txt"), "after-two\n", 0o644)
	if err := manager.RecordStatus(second, "ses-two", "plan-two", "restart_pending", "second build ready"); err != nil {
		t.Fatal(err)
	}
	second.ReleaseStage()
	plans, err := second.PendingPlans()
	if err != nil {
		t.Fatal(err)
	}
	if len(plans) != 2 || plans[0].PlanID != "plan-one" || plans[1].PlanID != "plan-two" {
		t.Fatalf("unexpected pending plans: %#v", plans)
	}
	if _, err := manager.PendingTransaction("ses-one", "plan-one"); err != nil {
		t.Fatalf("first plan should remain a member of the pending batch: %v", err)
	}
	if _, err := manager.PendingTransaction("ses-two", "plan-two"); err != nil {
		t.Fatalf("second plan should be a member of the pending batch: %v", err)
	}
	if err := second.Rollback(); err != nil {
		t.Fatal(err)
	}
	assertFile(t, filepath.Join(root, "hello.txt"), "before\n")
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
	mustWrite(t, filepath.Join(root, "scripts", "stack.sh"), "#!/usr/bin/env sh\nexit 0\n", 0o755)
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
	mustWrite(t, filepath.Join(root, "Makefile"), "build-stage:\n\t@mkdir -p services/frontend\n\t@printf 'unexpected\\n' > services/frontend/package-lock.json\n", 0o644)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := New(root)
	tx, err := manager.Prepare("ses-build-guard", "plan-build-guard", []string{patch})
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
	if _, err := manager.Prepare("ses-runtime-owned", "plan-runtime-owned", []string{patch}); err == nil || !strings.Contains(err.Error(), "runtime-owned path .harness/state/poison.json") {
		t.Fatalf("expected runtime-owned path rejection, got %v", err)
	}
}

func TestRestartFailureKeepsPendingBatchExtendable(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	manager := New(root)
	first, err := manager.Prepare("ses-one", "plan-one", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after-one\n"})
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()
	mustWrite(t, filepath.Join(root, "hello.txt"), "after-one\n", 0o644)
	if err := manager.RecordStatus(first, "ses-one", "plan-one", "restart_failed", "coordinator stop failed"); err != nil {
		t.Fatal(err)
	}
	first.ReleaseStage()

	second, err := manager.Prepare("ses-two", "plan-two", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-after-one\n+after-two\n"})
	if err != nil {
		t.Fatalf("expected failed restart to retain an extendable batch, got %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("expected restart retry extension to reuse transaction %s, got %s", first.ID, second.ID)
	}
}

func TestPendingPlanForSessionReturnsLatestMemberAfterSameSessionExtension(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	manager := New(root)
	first, err := manager.Prepare("ses-one", "plan-one", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after-one\n"})
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()
	mustWrite(t, filepath.Join(root, "hello.txt"), "after-one\n", 0o644)
	if err := manager.RecordStatus(first, "ses-one", "plan-one", "restart_pending", "first build ready"); err != nil {
		t.Fatal(err)
	}
	first.ReleaseStage()

	second, err := manager.Prepare("ses-one", "plan-two", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-after-one\n+after-two\n"})
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "hello.txt"), "after-two\n", 0o644)
	if err := manager.RecordStatus(second, "ses-one", "plan-two", "restart_pending", "second build ready"); err != nil {
		t.Fatal(err)
	}
	second.ReleaseStage()

	recovered, pending, err := manager.PendingPlanForSession("ses-one")
	if err != nil {
		t.Fatal(err)
	}
	if recovered.ID != first.ID || pending.PlanID != "plan-two" {
		t.Fatalf("expected latest same-session member plan-two in transaction %s, got transaction=%s pending=%#v", first.ID, recovered.ID, pending)
	}
}

func TestPendingTransactionRecoversRestartConfirmationHandoff(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	manager := New(root)
	tx, err := manager.Prepare("ses-confirm", "plan-confirm", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()
	if err := manager.RecordStatus(tx, "ses-confirm", "plan-confirm", "restart_pending", "awaiting user confirmation"); err != nil {
		t.Fatal(err)
	}
	tx.ReleaseStage()
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

func TestScheduleRestartStackUsesDetachedSupervisorContainer(t *testing.T) {
	root := fakeRoot(t)
	worker := filepath.Join(root, ".harness", "self-evolution", "txn-stack", "worker.sh")
	mustWrite(t, worker, "#!/bin/sh\nexit 0\n", 0o700)
	argsFile := filepath.Join(t.TempDir(), "docker-args.txt")
	binDir := t.TempDir()
	fakeDocker := filepath.Join(binDir, "docker")
	mustWrite(t, fakeDocker, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$DOCKER_ARGS_FILE\"\n", 0o700)

	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("DOCKER_ARGS_FILE", argsFile)
	t.Setenv("WHARNESS_SERVICES_MODE", "stack")
	t.Setenv("WHARNESS_BACKEND_IMAGE", "wharness-backend:test")
	t.Setenv("WHARNESS_DOCKER_GID", "998")
	t.Setenv("HOME", root)

	manager := New(root)
	tx := Transaction{ID: "stack", Root: root, Dir: filepath.Dir(worker), Worker: worker}
	if err := manager.ScheduleRestart(tx, "ses-stack", "plan-stack"); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatal(err)
	}
	args := string(raw)
	for _, expected := range []string{"run\n-d\n--rm\n", "--network\nhost\n", "--entrypoint\n" + worker + "\n", "wharness-backend:test\n", "ses-stack\nplan-stack\n"} {
		if !strings.Contains(args, expected) {
			t.Fatalf("missing stack supervisor args %q in:\n%s", expected, args)
		}
	}
}
