package selfevolution

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

// integrateOwnPlan lands a verified candidate for planID the way host
// integration does: a candidate commit carrying the Plan-Id trailer on its own
// branch, merged into the checked-out branch as a real two-parent merge.
func integrateOwnPlan(t *testing.T, root, planID, content string) {
	t.Helper()
	mustGitCommand(t, root, "checkout", "-qb", "whx/"+planID)
	mustWrite(t, filepath.Join(root, "hello.txt"), content, 0o644)
	mustGitCommand(t, root, "add", "hello.txt")
	mustGitCommand(t, root, "-c", "user.name=Wharnex", "-c", "user.email=wharness@localhost", "commit", "-qm", "feat: candidate\n\nPlan-Id: "+planID)
	mustGitCommand(t, root, "checkout", "-q", "-")
	mustGitCommand(t, root, "-c", "user.name=WHX - Operator", "-c", "user.email=op@example.invalid", "merge", "--no-ff", "--no-edit", "-q", "whx/"+planID)
}

// Reproduces txn-20260929T093927: a batch whose host build failed while the
// transaction's own merge was still on HEAD. That merge is the change the
// rollback exists to undo, not unrelated host history.
func TestRollbackUndoesItsOwnMergedPlanInsteadOfCallingItUnrelated(t *testing.T) {
	root := fakeGitRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	mustGitCommand(t, root, "add", "hello.txt")
	mustGitCommand(t, root, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline")

	tx, err := New(root).Prepare("ses-own-merge", "plan-own-merge", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()
	integrateOwnPlan(t, root, "plan-own-merge", "after\n")

	if err := tx.Rollback(context.Background()); err != nil {
		t.Fatalf("the transaction's own merge must not block its rollback: %v", err)
	}
	assertFile(t, filepath.Join(root, "hello.txt"), "before\n")
}

func TestRollbackStillRefusesAMergeOfAnotherPlanOnItsPaths(t *testing.T) {
	root := fakeGitRoot(t)
	mustWrite(t, filepath.Join(root, "hello.txt"), "before\n", 0o644)
	mustGitCommand(t, root, "add", "hello.txt")
	mustGitCommand(t, root, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline")

	tx, err := New(root).Prepare("ses-mine", "plan-mine", []string{"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-before\n+after\n"})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Release()
	integrateOwnPlan(t, root, "plan-someone-else", "theirs\n")

	err = tx.Rollback(context.Background())
	if !errors.Is(err, ErrRollbackUnsafe) {
		t.Fatalf("a merge of a plan outside the transaction must stay protected, got %v", err)
	}
	assertFile(t, filepath.Join(root, "hello.txt"), "theirs\n")
}
