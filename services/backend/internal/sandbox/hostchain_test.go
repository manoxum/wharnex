package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Two candidates that each merge cleanly into the host alone but collide with
// each other: only simulating the batch in order sees it before the first
// merge.
func TestPreflightIntegrationChainFindsCollisionBetweenCandidatesOfOneBatch(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "committed\n")
	writeTestFile(t, host, "wip.go", tenLines)
	first, _ := verifyBaseRootedCandidate(t, host, "req_first", "wip.go", strings.Replace(tenLines, "l5\n", "first\n", 1))
	second, secondBase := verifyBaseRootedCandidate(t, host, "req_second", "wip.go", strings.Replace(tenLines, "l5\n", "second\n", 1))
	ctx := context.Background()
	for _, branch := range []string{first, second} {
		if conflict, err := PreflightMergeIntoHost(ctx, host, branch); err != nil || conflict != nil {
			t.Fatalf("%s alone must merge cleanly: conflict=%v err=%v", branch, conflict, err)
		}
	}
	headBefore := mustGit(t, host, "rev-parse", "HEAD")

	failed, conflict, supported, err := PreflightIntegrationChain(ctx, host, []ChainCandidate{{Branch: first}, {Branch: second}})
	if err != nil || !supported {
		t.Fatalf("chain preflight: supported=%v err=%v", supported, err)
	}
	if failed != 1 || conflict == nil || conflict.Branch != second || conflict.MergeBaseSHA != secondBase {
		t.Fatalf("expected the second candidate to stop the batch, got failed=%d conflict=%+v", failed, conflict)
	}
	if current, _, _ := ReadFileAtRef(ctx, host, conflict.HostSHA, "wip.go"); !strings.Contains(current, "first") {
		t.Fatalf("the conflict must show the tree the second candidate meets, including the first: %q", current)
	}
	if head := mustGit(t, host, "rev-parse", "HEAD"); head != headBefore {
		t.Fatal("a batch preflight must not move HEAD")
	}
}

// An editor polling `git status` holds the index lock for an instant. A revert
// that meets that lock must wait it out instead of silently not happening.
func TestRevertHostMergeWaitsOutTransientIndexLock(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "a.txt", "committed\n")
	base := mustGit(t, host, "rev-parse", "HEAD")
	writeTestFile(t, host, "a.txt", "merged\n")
	mustGit(t, host, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qam", "merge stand-in")
	lock := filepath.Join(host, ".git", "index.lock")
	if err := os.WriteFile(lock, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	go func() {
		time.Sleep(600 * time.Millisecond)
		_ = os.Remove(lock)
	}()
	if _, err := RevertHostMerge(context.Background(), host, base); err != nil {
		t.Fatalf("revert must wait out a transient lock: %v", err)
	}
	if head := mustGit(t, host, "rev-parse", "HEAD"); head != base {
		t.Fatalf("HEAD = %s, want %s", head, base)
	}
}
