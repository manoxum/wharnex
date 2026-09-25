package sandbox

import (
	"context"
	"os/exec"
	"strings"
	"testing"
)

// unrelatedWorkspace mirrors a verification sandbox rebuilt from an immutable
// archived base: the same files as the host, under a synthetic root commit
// that shares no history with it.
func unrelatedWorkspace(t *testing.T, files map[string]string) string {
	t.Helper()
	workspace := t.TempDir()
	mustGit(t, workspace, "init", "-q")
	for name, content := range files {
		writeTestFile(t, workspace, name, content)
	}
	mustGit(t, workspace, "add", "-A")
	mustGit(t, workspace, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "synthetic baseline")
	return workspace
}

func candidateCommit(t *testing.T, host, branch string) string {
	t.Helper()
	return mustGit(t, host, "rev-parse", branch)
}

// The workspace holds operator work newer than the candidate's request base
// inside the raw commit diff's context. That diff no longer applies there; the
// three-way replay combines both edits.
func TestThreeWayReplayPatchCombinesWithNewerWorkspaceContent(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "committed\n")
	writeTestFile(t, host, "wip.go", tenLines)
	branch, _ := verifyBaseRootedCandidate(t, host, "req_replay", "wip.go", strings.Replace(tenLines, "l2\n", "candidate\n", 1))
	// l4 sits inside the raw diff's context around l2 but is not adjacent to it.
	operator := strings.Replace(tenLines, "l4\n", "operator\n", 1)
	workspace := unrelatedWorkspace(t, map[string]string{"a.txt": "committed\n", "wip.go": operator})

	patch, err := ThreeWayReplayPatch(context.Background(), workspace, host, branch, candidateCommit(t, host, branch))
	if err != nil {
		t.Fatalf("three-way replay: %v", err)
	}
	applyPatchForTest(t, workspace, patch)
	want := strings.Replace(operator, "l2\n", "candidate\n", 1)
	if got := readTestFile(t, workspace, "wip.go"); got != want {
		t.Fatalf("wip.go = %q, want %q", got, want)
	}
}

// A real collision becomes a structured conflict whose refs all resolve inside
// the workspace, so the caller can build a harness.conflict/v1 capsule from it
// instead of spending a repair round on a failed `git apply`.
func TestThreeWayReplayPatchReportsConflictResolvableInWorkspace(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "committed\n")
	writeTestFile(t, host, "wip.go", tenLines)
	branch, base := verifyBaseRootedCandidate(t, host, "req_replay_conflict", "wip.go", strings.Replace(tenLines, "l5\n", "candidate\n", 1))
	workspace := unrelatedWorkspace(t, map[string]string{"a.txt": "committed\n", "wip.go": strings.Replace(tenLines, "l5\n", "operator\n", 1)})

	_, err := ThreeWayReplayPatch(context.Background(), workspace, host, branch, candidateCommit(t, host, branch))
	var conflict *MergeConflictError
	if !isMergeConflictError(err, &conflict) {
		t.Fatalf("expected *MergeConflictError, got %v", err)
	}
	if conflict.Branch != branch || conflict.MergeBaseSHA != base || strings.Join(conflict.Paths, ",") != "wip.go" {
		t.Fatalf("unexpected conflict %+v", conflict)
	}
	for _, ref := range []string{conflict.Branch, conflict.HostSHA, conflict.MergeBaseSHA} {
		if _, exists, err := ReadFileAtRef(context.Background(), workspace, ref, "wip.go"); err != nil || !exists {
			t.Fatalf("capsule side %s must resolve inside the workspace (exists=%v err=%v)", ref, exists, err)
		}
	}
}

func applyPatchForTest(t *testing.T, dir, patch string) {
	t.Helper()
	cmd := exec.Command("git", "-C", dir, "apply", "--whitespace=nowarn", "-")
	cmd.Stdin = strings.NewReader(patch)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git apply: %v: %s", err, output)
	}
}
