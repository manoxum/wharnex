package selfevolution

import (
	"context"
	"errors"
	"os"
	"os/exec"
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

	if err := tx.Rollback(context.Background()); err != nil {
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

func TestPrepareRepairsVerifiedPendingTransactionMetadataIdentity(t *testing.T) {
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

	metadata, err := first.readMetadataUnchecked()
	if err != nil {
		t.Fatal(err)
	}
	metadata.TransactionID = "stale-transaction-id"
	if err := first.saveMetadata(metadata); err != nil {
		t.Fatal(err)
	}

	secondPatch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-after-one\n+after-two\n"
	second, err := manager.Prepare("ses-two", "plan-two", []string{secondPatch})
	if err != nil {
		t.Fatalf("verified pending metadata should repair conservatively, got %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("expected repaired batch %s, got %s", first.ID, second.ID)
	}
	repaired, err := second.readMetadata()
	if err != nil {
		t.Fatal(err)
	}
	if repaired.TransactionID != first.ID || repaired.Root != manager.Root() {
		t.Fatalf("unexpected repaired metadata: %#v", repaired)
	}
	log, err := os.ReadFile(filepath.Join(root, ".harness", "logs", "self-evolution.log"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(log), "metadata_repaired") || !strings.Contains(string(log), first.ID) {
		t.Fatalf("expected metadata repair audit line, got %q", string(log))
	}
}

func TestPrepareRepairsPendingMetadataAfterProjectRootMove(t *testing.T) {
	root := fakeGitRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	mustGitCommand(t, root, "add", "hello.txt")
	mustGitCommand(t, root, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "tracked source")
	manager := New(root)
	first, err := manager.Prepare("ses-one", "plan-one", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after-one\n"})
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "hello.txt"), "after-one\n", 0o644)
	if err := manager.RecordStatus(first, "ses-one", "plan-one", "restart_pending", "first build ready"); err != nil {
		t.Fatal(err)
	}
	first.ReleaseStage()

	movedParent := t.TempDir()
	movedRoot := filepath.Join(movedParent, "wharnex")
	if err := os.Rename(root, movedRoot); err != nil {
		t.Fatal(err)
	}
	movedManager := New(movedRoot)
	second, err := movedManager.Prepare("ses-two", "plan-two", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-after-one\n+after-two\n"})
	if err != nil {
		t.Fatalf("a moved checkout with the captured Git baseline should repair its stale root, got %v", err)
	}
	defer second.Release()
	if second.ID != first.ID {
		t.Fatalf("expected moved batch %s to be retained, got %s", first.ID, second.ID)
	}
	repaired, err := second.readMetadata()
	if err != nil {
		t.Fatal(err)
	}
	if repaired.Root != movedManager.Root() {
		t.Fatalf("expected repaired root %q, got %q", movedManager.Root(), repaired.Root)
	}
}

func TestPrepareRefusesMovedMetadataWithoutGitLineageProof(t *testing.T) {
	outer := t.TempDir()
	mustGitCommand(t, outer, "init", "-q")
	mustWrite(t, filepath.Join(outer, "host.txt"), "host\n", 0o644)
	mustGitCommand(t, outer, "add", "host.txt")
	mustGitCommand(t, outer, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "outer repository")

	root := filepath.Join(outer, "nested-wharness")
	populateFakeRoot(t, root)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	manager := New(root)
	first, err := manager.Prepare("ses-one", "plan-one", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after-one\n"})
	if err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "hello.txt"), "after-one\n", 0o644)
	if err := manager.RecordStatus(first, "ses-one", "plan-one", "restart_pending", "first build ready"); err != nil {
		t.Fatal(err)
	}
	first.ReleaseStage()

	movedRoot := filepath.Join(outer, "moved-wharness")
	if err := os.Rename(root, movedRoot); err != nil {
		t.Fatal(err)
	}
	_, err = New(movedRoot).Prepare("ses-two", "plan-two", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-after-one\n+after-two\n"})
	if !errors.Is(err, ErrTransactionMetadataMismatch) {
		t.Fatalf("expected fail-closed metadata mismatch without Git lineage proof, got %v", err)
	}
}

func TestPrepareRefusesUnsafePendingTransactionMetadataRepair(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	manager := New(root)
	first, err := manager.Prepare("ses-one", "plan-one", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after-one\n"})
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()
	if err := manager.RecordStatus(first, "ses-one", "plan-one", "restart_pending", "first build ready"); err != nil {
		t.Fatal(err)
	}
	first.ReleaseStage()

	metadata, err := first.readMetadataUnchecked()
	if err != nil {
		t.Fatal(err)
	}
	metadata.TransactionID = "wrong-id"
	metadata.Root = t.TempDir()
	if err := first.saveMetadata(metadata); err != nil {
		t.Fatal(err)
	}

	_, err = manager.Prepare("ses-two", "plan-two", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after-two\n"})
	if !errors.Is(err, ErrTransactionMetadataMismatch) {
		t.Fatalf("expected fail-closed metadata mismatch, got %v", err)
	}
	retained, readErr := first.readMetadataUnchecked()
	if readErr != nil {
		t.Fatal(readErr)
	}
	if retained.TransactionID != "wrong-id" || retained.Root == manager.Root() {
		t.Fatalf("unsafe metadata must not be rewritten: %#v", retained)
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
	if err := second.Rollback(context.Background()); err != nil {
		t.Fatal(err)
	}
	assertFile(t, filepath.Join(root, "hello.txt"), "before\n")
}

// TestRollbackRefusesWhenUnrelatedGitMergeOverlapsBackupPaths reproduces a
// real production incident (documented in VALIDATION.md): Rollback restores
// files by raw copy, bypassing Git entirely. If an unrelated integration
// merge lands on one of this transaction's own backed-up paths after
// Prepare captured its baseline but before Rollback runs, a blind raw-copy
// restore would silently discard that unrelated merge with no error
// anywhere — git HEAD would still claim the merge succeeded while the file
// on disk reverted underneath it. Rollback must refuse instead.
func TestRollbackRefusesWhenUnrelatedGitMergeOverlapsBackupPaths(t *testing.T) {
	root := fakeGitRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	mustGitCommand(t, root, "add", "hello.txt")
	mustGitCommand(t, root, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline")

	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := New(root)
	tx, err := manager.Prepare("ses-race", "plan-race", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()
	if tx.PreTransactionSHA == "" {
		t.Fatal("expected PreTransactionSHA to be captured for a real Git root")
	}
	mustWrite(t, filepath.Join(root, "hello.txt"), "after\n", 0o644)

	// Simulate an unrelated integration merge landing on the SAME path this
	// transaction is about to roll back, after Prepare's baseline.
	mustWrite(t, filepath.Join(root, "hello.txt"), "merged-by-someone-else\n", 0o644)
	mustGitCommand(t, root, "add", "hello.txt")
	mustGitCommand(t, root, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "unrelated integration merge")

	err = tx.Rollback(context.Background())
	if err == nil {
		t.Fatal("expected Rollback to refuse")
	}
	if !errors.Is(err, ErrRollbackUnsafe) {
		t.Fatalf("expected ErrRollbackUnsafe, got %v", err)
	}
	assertFile(t, filepath.Join(root, "hello.txt"), "merged-by-someone-else\n")
}

// TestRollbackAllowsHostSnapshotOfCapturedSource reproduces the false-positive
// that parked txn-20260913T111106-6127f80c0211 in rollback_failed. Prepare
// captured an operator-dirty file, then the integration path preserved those
// exact bytes in its host snapshot commit before a later step failed. The path
// therefore appeared in Git's baseline..HEAD diff even though restoring its
// transaction backup was a byte-for-byte no-op.
func TestRollbackAllowsHostSnapshotOfCapturedSource(t *testing.T) {
	root := fakeGitRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "operator state\n", 0o644)

	manager := New(root)
	tx, err := manager.Prepare("ses-snapshot", "plan-snapshot", []string{
		"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-operator state\n+candidate\n",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()

	// MergeBranchOnHost performs this preservation commit after Prepare. Its
	// content is the transaction's captured pre-change state, not a concurrent
	// edit that rollback must protect.
	mustGitCommand(t, root, "add", "hello.txt")
	mustGitCommand(t, root, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "Wharnex host snapshot before integration")

	if err := tx.Rollback(context.Background()); err != nil {
		t.Fatalf("a host snapshot containing the captured bytes must be rollback-safe, got %v", err)
	}
	assertFile(t, filepath.Join(root, "hello.txt"), "operator state\n")
}

// TestRollbackProceedsWhenUnrelatedGitCommitsDoNotOverlapBackupPaths confirms
// the safety check above is narrow: unrelated commits that land on OTHER
// paths must not block a legitimate rollback of this transaction's own
// files.
func TestRollbackProceedsWhenUnrelatedGitCommitsDoNotOverlapBackupPaths(t *testing.T) {
	root := fakeGitRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	mustGitCommand(t, root, "add", "hello.txt")
	mustGitCommand(t, root, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline")

	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := New(root)
	tx, err := manager.Prepare("ses-safe", "plan-safe", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()
	mustWrite(t, filepath.Join(root, "hello.txt"), "after\n", 0o644)

	mustWrite(t, filepath.Join(root, "unrelated.txt"), "unrelated\n", 0o644)
	mustGitCommand(t, root, "add", "unrelated.txt")
	mustGitCommand(t, root, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "unrelated, non-overlapping commit")

	if err := tx.Rollback(context.Background()); err != nil {
		t.Fatalf("expected rollback to proceed when no overlap exists, got %v", err)
	}
	assertFile(t, filepath.Join(root, "hello.txt"), "before\n")
}

// fakeGitRoot mirrors fakeRoot but as a real Git repository, so
// PreTransactionSHA is actually captured — every real Wharnex project has
// one (projectgit.Ensure).
func fakeGitRoot(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root := fakeRoot(t)
	mustGitCommand(t, root, "init", "-q")
	mustGitCommand(t, root, "add", "-A")
	mustGitCommand(t, root, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "scaffold")
	return root
}

func mustGitCommand(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
}

func fakeRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	populateFakeRoot(t, root)
	return root
}

func populateFakeRoot(t *testing.T, root string) {
	t.Helper()
	mustWrite(t, filepath.Join(root, "Makefile"), "all:\n\t@true\n", 0o644)
	mustWrite(t, filepath.Join(root, "services", "backend", "go.mod"), "module example.invalid/fake\n", 0o644)
	mustWrite(t, filepath.Join(root, "services", "desktop", "package.json"), "{}\n", 0o644)
	mustWrite(t, filepath.Join(root, "scripts", "self-restart.sh"), "#!/usr/bin/env sh\nexit 0\n", 0o755)
	mustWrite(t, filepath.Join(root, "scripts", "start.sh"), "#!/usr/bin/env sh\nexit 0\n", 0o755)
	mustWrite(t, filepath.Join(root, "scripts", "stop.sh"), "#!/usr/bin/env sh\nexit 0\n", 0o755)
	mustWrite(t, filepath.Join(root, "scripts", "stack.sh"), "#!/usr/bin/env sh\nexit 0\n", 0o755)
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
	if _, err := manager.BuildHost(context.Background(), tx, nil); err == nil || !strings.Contains(err.Error(), "mutated source dependency metadata") {
		t.Fatalf("expected build guard rejection, got %v", err)
	}
	if err := tx.Rollback(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "services", "frontend", "package-lock.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("rollback should remove build-created lockfile, got %v", err)
	}
}

func TestBuildHostClassifiesHostToolchainMismatchAsUnrepairable(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	// Reproduces the real failure observed in production: a pinned Electron
	// version whose postinstall requires a newer Node than the host has,
	// surfacing as ERR_REQUIRE_ESM. No patch to project source can fix this,
	// so BuildHost must mark it distinctly from an ordinary build failure.
	mustWrite(t, filepath.Join(root, "Makefile"), "build-stage:\n"+
		"\t@printf 'Error [ERR_REQUIRE_ESM]: require() of ES Module not supported\\n' >&2\n"+
		"\t@printf 'Error: Electron failed to install correctly.\\n' >&2\n"+
		"\t@exit 2\n", 0o644)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := New(root)
	tx, err := manager.Prepare("ses-toolchain-guard", "plan-toolchain-guard", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()
	_, err = manager.BuildHost(context.Background(), tx, nil)
	if err == nil {
		t.Fatal("expected BuildHost to fail")
	}
	if !errors.Is(err, ErrHostBuildToolchainMismatch) {
		t.Fatalf("expected ErrHostBuildToolchainMismatch, got %v", err)
	}
}

func TestBuildHostClassifiesUnsupportedBusyBoxFlockAsLocalInfrastructure(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	mustWrite(t, filepath.Join(root, "Makefile"), "build-stage:\n"+
		"\t@printf 'flock: unrecognized option: w\\n' >&2\n"+
		"\t@exit 2\n", 0o644)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := New(root)
	tx, err := manager.Prepare("ses-busybox-flock", "plan-busybox-flock", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()

	_, err = manager.BuildHost(context.Background(), tx, nil)
	if !errors.Is(err, ErrHostBuildToolchainMismatch) {
		t.Fatalf("unsupported host flock must remain local infrastructure, got %v", err)
	}
}

func TestBuildHostStreamsOutputAsItArrivesInsteadOfOnlyAtCompletion(t *testing.T) {
	// A host build can run for minutes; without incremental delivery it
	// looks hung until it finally succeeds or fails. onOutput must fire
	// for each chunk as it is produced, not just once at the end.
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	mustWrite(t, filepath.Join(root, "Makefile"), "build-stage:\n"+
		"\t@printf 'first line\\n'\n"+
		"\t@printf 'second line\\n' >&2\n", 0o644)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := New(root)
	tx, err := manager.Prepare("ses-stream", "plan-stream", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()

	type chunk struct{ stream, text string }
	var chunks []chunk
	full, err := manager.BuildHost(context.Background(), tx, func(stream, text string) {
		chunks = append(chunks, chunk{stream, text})
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(chunks) == 0 {
		t.Fatal("expected at least one streamed chunk")
	}
	var streamedStdout, streamedStderr strings.Builder
	for _, c := range chunks {
		switch c.stream {
		case "stdout":
			streamedStdout.WriteString(c.text)
		case "stderr":
			streamedStderr.WriteString(c.text)
		default:
			t.Fatalf("unexpected stream label %q", c.stream)
		}
	}
	if !strings.Contains(streamedStdout.String(), "first line") {
		t.Fatalf("expected streamed stdout to contain the stdout line, got %q", streamedStdout.String())
	}
	if !strings.Contains(streamedStderr.String(), "second line") {
		t.Fatalf("expected streamed stderr to contain the stderr line, got %q", streamedStderr.String())
	}
	// The streamed chunks must be a live view of the SAME output BuildHost
	// still accumulates and returns whole, not a separate/lossy channel.
	if !strings.Contains(full, "first line") || !strings.Contains(full, "second line") {
		t.Fatalf("accumulated output missing streamed content: %q", full)
	}
}

func TestBuildHostRetainsTerminalFailureAfterVerboseBuildOutput(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	// More than the bounded capture limit precedes the actual failure. The
	// terminal diagnostic must remain available for classification/recovery.
	mustWrite(t, filepath.Join(root, "Makefile"), "build-stage:\n"+
		"\t@yes x | head -c 600000\n"+
		"\t@printf 'TERMINAL BUILD FAILURE: missing generated symbol\\n' >&2\n"+
		"\t@exit 2\n", 0o644)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := New(root)
	tx, err := manager.Prepare("ses-terminal-output", "plan-terminal-output", []string{patch})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()

	output, err := manager.BuildHost(context.Background(), tx, nil)
	if err == nil {
		t.Fatal("expected build failure")
	}
	if !strings.Contains(output, "TERMINAL BUILD FAILURE: missing generated symbol") {
		t.Fatalf("terminal build diagnostic was discarded: %q", output[len(output)-min(len(output), 512):])
	}
	if !strings.Contains(output, "middle build output truncated") {
		t.Fatalf("expected bounded-output truncation marker, got %q", output[:min(len(output), 512)])
	}
}

func TestIsHostToolchainMismatchIsNarrow(t *testing.T) {
	positive := []string{
		"Error [ERR_REQUIRE_ESM]: require() of ES Module ... not supported",
		"Error: Electron failed to install correctly. Please delete `node_modules/electron`",
		"flock: unrecognized option: w",
	}
	for _, output := range positive {
		if !IsHostToolchainMismatch(output) {
			t.Fatalf("expected match for output: %s", output)
		}
	}
	negative := []string{
		"",
		"npm warn EBADENGINE Unsupported engine { package: 'eslint-visitor-keys@5.0.1' }",
		"FAIL services/frontend/src/App.test.ts\nExpected 2 but received 3",
		"go build failed: undefined: foo",
	}
	for _, output := range negative {
		if IsHostToolchainMismatch(output) {
			t.Fatalf("expected no match for output: %s", output)
		}
	}
}

func TestPrepareReclaimsAnOrphanedStageLockFromAPreviousRuntime(t *testing.T) {
	// The exact production deadlock: a stage.lock left behind by a backend
	// that died mid-apply, holding `pid=1` because the backend is PID 1 in
	// its own container. Every later backend is also PID 1, so a liveness
	// probe answered "alive" forever and every self-evolution apply failed
	// with ErrBusy — which each time asked ChatGPT for a correction that
	// could not possibly release a local lock file.
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	base := filepath.Join(root, ".harness", "self-evolution")
	mustWrite(t, filepath.Join(base, "stage.lock"), "pid=1\ncreated=2026-09-06T21:54:25.645751593Z\n", 0o600)
	mustWrite(t, filepath.Join(base, "status"), "phase=prepared\nsession_id=ses-old\nplan_id=plan-old\ntransaction=txn-old\nupdated_at=2026-09-06T21:54:25Z\n", 0o600)

	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := New(root)
	tx, err := manager.Prepare("ses-reclaim", "plan-reclaim", []string{patch})
	if err != nil {
		t.Fatalf("orphaned stage lock must be reclaimed, got %v", err)
	}
	defer tx.Release()
	if data, readErr := os.ReadFile(filepath.Join(base, "stage.lock")); readErr != nil {
		t.Fatal(readErr)
	} else if !strings.Contains(string(data), "run_id="+runtimeInstanceID) {
		t.Fatalf("reclaimed stage lock must record this runtime instance, got %q", string(data))
	}
}

func TestPrepareReclaimsAFailClosedLockWhoseTransactionDirectoryIsGone(t *testing.T) {
	// Real production deadlock: a self-evolution rollback finished with
	// rollback_failed, which is deliberately fail-closed (ADR-0016) so the
	// batch lock survives for manual recovery. But the transaction directory
	// it points to was separately removed (operator cleanup, disk pressure,
	// or any other reason), leaving nothing left to protect: no rollback
	// baseline, no source backup, no pending-plan list. Refusing forever at
	// that point only deadlocks every future self-evolution apply behind
	// ErrBusy — self_evolution_transaction_busy — with no ChatGPT-side
	// correction able to release a local lock file. Once the referenced
	// transaction directory is verifiably absent, Prepare must reclaim.
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	base := filepath.Join(root, ".harness", "self-evolution")
	mustWrite(t, filepath.Join(base, "active.lock"), "pid=1\nrun_id=0000000000000000\ncreated=2026-09-07T12:10:45Z\n", 0o600)
	mustWrite(t, filepath.Join(base, "status"), "phase=rollback_failed\nsession_id=ses-old\nplan_id=plan-old\ntransaction=txn-gone\nupdated_at=2026-09-07T12:13:14Z\ndetail=previous application containers could not be restored\n", 0o600)

	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := New(root)
	tx, err := manager.Prepare("ses-reclaim", "plan-reclaim", []string{patch})
	if err != nil {
		t.Fatalf("a fail-closed lock with no transaction directory left must be reclaimed, got %v", err)
	}
	defer tx.Release()
	log, readErr := os.ReadFile(filepath.Join(root, ".harness", "logs", "self-evolution.log"))
	if readErr != nil {
		t.Fatal(readErr)
	}
	if !strings.Contains(string(log), "lock_reclaimed") || !strings.Contains(string(log), "txn-gone") {
		t.Fatalf("expected an audit trail of the automatic reclaim in self-evolution.log, got %q", string(log))
	}
}

func TestPrepareKeepsFailClosedLockWhenTransactionDirectoryStillExists(t *testing.T) {
	// The reclaim above must not weaken the documented fail-closed guarantee
	// for the common case: a rollback failure whose transaction directory
	// (rollback baseline, source backups) is still on disk stays busy so a
	// human can inspect it before anything touches the host again.
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	base := filepath.Join(root, ".harness", "self-evolution")
	mustWrite(t, filepath.Join(base, "active.lock"), "pid=1\nrun_id=0000000000000000\ncreated=2026-09-07T12:10:45Z\n", 0o600)
	if err := os.MkdirAll(filepath.Join(base, "txn-present"), 0o700); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(base, "status"), "phase=rollback_failed\nsession_id=ses-old\nplan_id=plan-old\ntransaction=txn-present\nupdated_at=2026-09-07T12:13:14Z\n", 0o600)

	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"
	manager := New(root)
	if _, err := manager.Prepare("ses-reclaim", "plan-reclaim", []string{patch}); !errors.Is(err, ErrBusy) {
		t.Fatalf("expected ErrBusy while the rollback-failed transaction directory still exists, got %v", err)
	}
}

func TestLockHeldByThisRuntimeStillBlocksConcurrentPreparation(t *testing.T) {
	// The reclaim above must not weaken real mutual exclusion: a lock this
	// runtime instance still holds keeps reporting busy.
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
		t.Fatalf("expected ErrBusy while this runtime still holds the batch, got %v", err)
	}
}

func TestActiveLockOwnerAliveIgnoresUntrustworthyPidOnlyLocks(t *testing.T) {
	dir := t.TempDir()
	stale := filepath.Join(dir, "stale.lock")
	mustWrite(t, stale, "pid=1\ncreated=2026-09-06T21:54:25Z\n", 0o600)
	if activeLockOwnerAlive(stale) {
		t.Fatal("a pid-only lock predates run-id stamping and must never be reported alive")
	}
	mine := filepath.Join(dir, "mine.lock")
	mustWrite(t, mine, "pid=1\nrun_id="+runtimeInstanceID+"\ncreated=2026-09-06T21:54:25Z\n", 0o600)
	if !activeLockOwnerAlive(mine) {
		t.Fatal("a lock stamped with this runtime instance must be reported alive")
	}
	foreign := filepath.Join(dir, "foreign.lock")
	mustWrite(t, foreign, "pid=1\nrun_id=0000000000000000\ncreated=2026-09-06T21:54:25Z\n", 0o600)
	if activeLockOwnerAlive(foreign) {
		t.Fatal("a lock from a different runtime instance must be reclaimable")
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

func TestFailedPreMutationExtensionCanRetainPreviousPendingBatch(t *testing.T) {
	root := fakeRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	manager := New(root)
	first, err := manager.Prepare("ses-one", "plan-one", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after-one\n"})
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()
	if err := manager.RecordStatus(first, "ses-one", "plan-one", "restart_pending", "first build ready"); err != nil {
		t.Fatal(err)
	}
	first.ReleaseStage()

	extended, err := manager.Prepare("ses-two", "plan-two", []string{"--- a/extra.txt\n+++ b/extra.txt\n@@ -0,0 +1 @@\n+extra\n"})
	if err != nil {
		t.Fatal(err)
	}
	if !extended.Extended || !extended.ExtensionAddedPlan || extended.PreviousPending.PlanID != "plan-one" {
		t.Fatalf("extension checkpoint was not retained: %#v", extended)
	}
	if err := extended.RemoveExtensionPlan("ses-two", "plan-two"); err != nil {
		t.Fatal(err)
	}
	if err := manager.RecordStatus(extended, extended.PreviousPending.SessionID, extended.PreviousPending.PlanID, "restart_pending", "extension failed before mutation"); err != nil {
		t.Fatal(err)
	}
	extended.ReleaseStage()
	if _, err := os.Stat(first.Dir); err != nil {
		t.Fatalf("prior transaction directory was destroyed: %v", err)
	}
	plans, err := first.PendingPlans()
	if err != nil {
		t.Fatal(err)
	}
	if len(plans) != 1 || plans[0].SessionID != "ses-one" || plans[0].PlanID != "plan-one" {
		t.Fatalf("failed extension polluted prior pending membership: %#v", plans)
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

// A fail-closed phase deliberately holds the global batch lock so a human can
// recover. That only works if the human is told what is waiting for them and
// has a way to end it: before this, every later self-evolution was refused with
// "another transaction is already active", naming no phase, no cause and no
// action, and no endpoint could release it.
func TestBlockedTransactionIsExplainedAndReleasable(t *testing.T) {
	root := t.TempDir()
	manager := New(root)
	base := filepath.Join(root, ".harness", "self-evolution")
	if err := os.MkdirAll(filepath.Join(base, "txn-held"), 0o700); err != nil {
		t.Fatal(err)
	}
	status := Status{
		Phase: "rollback_failed", SessionID: "ses_x", PlanID: "plan_x",
		Transaction: "txn-held", Detail: "host git history advanced with overlapping unrelated changes",
	}
	if err := manager.recordReleasedStatus(status); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, "active.lock"), []byte("pid=1\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	blocked := manager.BlockedStatus(status)
	if blocked == nil {
		t.Fatal("a fail-closed phase must be reported as blocking")
	}
	if !errors.Is(blocked, ErrBusy) {
		t.Fatal("the typed refusal must still satisfy errors.Is(err, ErrBusy) for existing callers")
	}
	for _, want := range []string{"rollback_failed", "txn-held", "plan_x", "overlapping unrelated changes"} {
		if !strings.Contains(blocked.Error(), want) {
			t.Fatalf("the refusal must name %q, got %q", want, blocked.Error())
		}
	}
	if blocked.Remedy == "" {
		t.Fatal("the refusal must carry the action that releases it")
	}

	// Releasing must name the exact transaction, so it is never accidental.
	if _, err := manager.ReleaseBlockedTransaction("txn-other"); err == nil {
		t.Fatal("releasing a transaction that does not hold the lock must be refused")
	}
	released, err := manager.ReleaseBlockedTransaction("txn-held")
	if err != nil {
		t.Fatalf("the operator must be able to release a fail-closed transaction: %v", err)
	}
	if released.Phase != "released" {
		t.Fatalf("unexpected phase after release: %q", released.Phase)
	}
	if _, statErr := os.Stat(filepath.Join(base, "active.lock")); !os.IsNotExist(statErr) {
		t.Fatal("the batch lock must be gone after an explicit release")
	}
	// The evidence the operator may still need is deliberately kept.
	if _, statErr := os.Stat(filepath.Join(base, "txn-held")); statErr != nil {
		t.Fatal("the transaction directory holds the rollback baseline and must survive the release")
	}
}

// Active work must never be freed from under itself.
func TestReleaseRefusesATransactionThatIsStillWorking(t *testing.T) {
	root := t.TempDir()
	manager := New(root)
	status := Status{Phase: "restart_pending", Transaction: "txn-live", PlanID: "plan_y"}
	if err := manager.recordReleasedStatus(status); err != nil {
		t.Fatal(err)
	}
	if manager.BlockedStatus(status) != nil {
		t.Fatal("a pending restart is extendable work, not a fail-closed block")
	}
	if _, err := manager.ReleaseBlockedTransaction("txn-live"); err == nil {
		t.Fatal("a live transaction must not be releasable")
	}
}
