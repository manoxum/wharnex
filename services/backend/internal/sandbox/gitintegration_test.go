package sandbox

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func mustGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
	return strings.TrimSpace(string(output))
}

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
}

// newTestHostRepo creates a real Git repository with one commit, mirroring
// what every Wharnex project already guarantees (internal/projectgit.Ensure).
func newTestHostRepo(t *testing.T, fileName, content string) string {
	t.Helper()
	root := t.TempDir()
	mustGit(t, root, "init", "-q")
	if err := os.WriteFile(filepath.Join(root, fileName), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, root, "add", fileName)
	mustGit(t, root, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "initial")
	return root
}

// cloneSandbox mirrors cloneGitBaseline: a real local clone preserving host
// history, which is exactly what copyProject already produces today.
func cloneSandbox(t *testing.T, hostPath string) string {
	t.Helper()
	dest := t.TempDir() + "-sandbox"
	if err := cloneGitBaseline(hostPath, dest); err != nil {
		t.Fatal(err)
	}
	return dest
}

func TestCommitVerifiedPatchCreatesRealCommitOnNewBranch(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "hello.txt", "before\n")
	sandbox := cloneSandbox(t, host)
	if err := os.WriteFile(filepath.Join(sandbox, "hello.txt"), []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	sha, err := CommitVerifiedPatch(context.Background(), sandbox, "whx/req-1", "fix: update hello.txt", []string{"hello.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if sha == "" {
		t.Fatal("expected a non-empty commit sha")
	}
	branch := mustGit(t, sandbox, "rev-parse", "--abbrev-ref", "HEAD")
	if branch != "whx/req-1" {
		t.Fatalf("expected to be on the new branch, got %q", branch)
	}
	author := mustGit(t, sandbox, "log", "-1", "--format=%an <%ae>")
	if author != "Wharnex <wharness@localhost>" {
		t.Fatalf("unexpected commit author: %q", author)
	}
	message := mustGit(t, sandbox, "log", "-1", "--format=%s")
	if message != "fix: update hello.txt" {
		t.Fatalf("unexpected commit message: %q", message)
	}
}

func TestCommitVerifiedPatchAllowEmptyKeepsLegacyCandidateTraceable(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "hello.txt", "already present\n")
	workspace := cloneSandbox(t, host)
	before := mustGit(t, workspace, "rev-parse", "HEAD")
	sha, err := CommitVerifiedPatchAllowEmpty(context.Background(), workspace, "whx/req-legacy-noop", "fix: retain legacy candidate", []string{"hello.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if sha == "" || sha == before {
		t.Fatalf("expected a distinct traceable commit, before=%s after=%s", before, sha)
	}
	if changed := mustGit(t, workspace, "diff", "--name-only", before, sha); changed != "" {
		t.Fatalf("the compatibility commit must stay content-empty, got %q", changed)
	}
}

// TestCommitVerifiedPatchToleratesNoopAfterVerification reproduces a real
// production incident: a focused conflict-resolution round replays a
// resolution patch that, once applied on top of the tree the new integration
// branch is being extended from, reproduces content the branch already
// carries for those exact paths — verification (patch application + every
// gate) already ran successfully against this workspace before commit is
// ever reached, so this can only mean the target already holds the resolved
// content, never that the patch failed to apply. The strict CommitVerifiedPatch
// used to hard-fail here with Git's own "nothing to commit, working tree
// clean", which discarded an already-verified candidate and reproduced
// identically on every retry because no further source mutation could ever
// change the outcome. It must now record a traceable empty commit instead,
// exactly like CommitVerifiedPatchAllowEmpty already does for a legacy
// candidate.
func TestCommitVerifiedPatchToleratesNoopAfterVerification(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "TODO.md", "- resolved entry\n")
	workspace := cloneSandbox(t, host)
	before := mustGit(t, workspace, "rev-parse", "HEAD")
	// The workspace's TODO.md already matches the branch's own history byte
	// for byte, mirroring a resolution patch that reproduces what "ours"
	// already carries after BeginMergeResolution's checkout --ours.
	sha, err := CommitVerifiedPatch(context.Background(), workspace, "whx/req-conflict-noop", "fix: reconcile TODO.md", []string{"TODO.md"})
	if err != nil {
		t.Fatalf("expected a verified no-op to be tolerated, got error: %v", err)
	}
	if sha == "" || sha == before {
		t.Fatalf("expected a distinct traceable commit, before=%s after=%s", before, sha)
	}
	if changed := mustGit(t, workspace, "diff", "--name-only", before, sha); changed != "" {
		t.Fatalf("the tolerated no-op commit must stay content-empty, got %q", changed)
	}
	branch := mustGit(t, workspace, "rev-parse", "--abbrev-ref", "HEAD")
	if branch != "whx/req-conflict-noop" {
		t.Fatalf("expected to be on the new branch, got %q", branch)
	}
}

// TestCommitVerifiedPatchIgnoresUnrelatedDirtyFiles reproduces a real
// production incident: copyProject overlays the host's current on-disk
// content onto the sandbox's working tree (so it matches the content-hash
// baseline the plan was verified against), which means any of the
// operator's OWN unrelated uncommitted edits to other files ride along in
// that same working tree, untracked by the sandbox's cloned git history.
// CommitVerifiedPatch must stage only the plan's own declared paths, never
// "whatever is dirty" — otherwise that unrelated drift gets folded into the
// "verified patch" commit and collides with the host's own pre-merge dirty
// snapshot (snapshotUncommittedHostState) as a spurious merge conflict on
// a file the plan never touched.
func TestCommitVerifiedPatchIgnoresUnrelatedDirtyFiles(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "hello.txt", "before\n")
	if err := os.WriteFile(filepath.Join(host, "unrelated.txt"), []byte("committed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", "unrelated.txt")
	mustGit(t, host, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "add unrelated file")
	sandbox := cloneSandbox(t, host)
	// Mirrors copyProject's disk overlay: the sandbox's working tree carries
	// operator drift the sandbox's git history knows nothing about.
	if err := os.WriteFile(filepath.Join(sandbox, "unrelated.txt"), []byte("operator's own uncommitted edit\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sandbox, "hello.txt"), []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := CommitVerifiedPatch(context.Background(), sandbox, "whx/req-unrelated", "fix: update hello.txt", []string{"hello.txt"}); err != nil {
		t.Fatal(err)
	}
	status := mustGit(t, sandbox, "status", "--porcelain")
	if !strings.HasSuffix(status, "unrelated.txt") {
		t.Fatalf("expected the unrelated drift to remain uncommitted in the sandbox working tree, got %q", status)
	}
	committed := mustGit(t, sandbox, "show", "HEAD:unrelated.txt")
	if committed != "committed" {
		t.Fatalf("expected the integration commit to retain the original committed content, got %q", committed)
	}
	changedFiles := mustGit(t, sandbox, "diff", "--name-only", "HEAD~1", "HEAD")
	if changedFiles != "hello.txt" {
		t.Fatalf("expected only hello.txt in the verified commit, got %q", changedFiles)
	}
}

func TestPushAndMergeIntegratesCleanlyWithoutTouchingAnyRemote(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "hello.txt", "before\n")
	sandbox := cloneSandbox(t, host)
	if err := os.WriteFile(filepath.Join(sandbox, "hello.txt"), []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := CommitVerifiedPatch(context.Background(), sandbox, "whx/req-2", "fix: update hello.txt", []string{"hello.txt"}); err != nil {
		t.Fatal(err)
	}
	remotes := mustGit(t, sandbox, "remote")
	if strings.TrimSpace(remotes) != "origin" {
		t.Fatalf("expected only the clone's own local 'origin' remote, got %q", remotes)
	}

	if err := PushBranchToHost(context.Background(), sandbox, host, "whx/req-2"); err != nil {
		t.Fatal(err)
	}
	merge, err := MergeBranchOnHost(context.Background(), host, "whx/req-2")
	if err != nil {
		t.Fatal(err)
	}
	if merge.PreMergeSHA == "" {
		t.Fatal("expected a non-empty pre-merge sha")
	}
	data, err := os.ReadFile(filepath.Join(host, "hello.txt"))
	if err != nil || string(data) != "after\n" {
		t.Fatalf("expected the host working tree to contain the merged change, got %q err=%v", data, err)
	}
	head, err := CurrentHeadSHA(context.Background(), host)
	if err != nil {
		t.Fatal(err)
	}
	if head == merge.PreMergeSHA {
		t.Fatal("expected HEAD to advance past the pre-merge commit")
	}

	if err := DeleteHostBranch(context.Background(), host, "whx/req-2"); err != nil {
		t.Fatal(err)
	}
	branches := mustGit(t, host, "branch", "--list", "whx/req-2")
	if branches != "" {
		t.Fatalf("expected the integration branch to be deleted, got %q", branches)
	}
	// The merge commit itself must survive branch deletion.
	data, err = os.ReadFile(filepath.Join(host, "hello.txt"))
	if err != nil || string(data) != "after\n" {
		t.Fatalf("expected the merged change to persist after branch cleanup, got %q err=%v", data, err)
	}
}

func TestMergeConflictLeavesHostUntouchedAndReportsStructuredPaths(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "hello.txt", "before\n")
	sandbox := cloneSandbox(t, host)
	if err := os.WriteFile(filepath.Join(sandbox, "hello.txt"), []byte("sandbox-version\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := CommitVerifiedPatch(context.Background(), sandbox, "whx/req-3", "fix: sandbox edit", []string{"hello.txt"}); err != nil {
		t.Fatal(err)
	}
	if err := PushBranchToHost(context.Background(), sandbox, host, "whx/req-3"); err != nil {
		t.Fatal(err)
	}
	// Simulate a peer edit landing on host after the sandbox branched off:
	// same line, different content — a genuine, unresolvable conflict.
	if err := os.WriteFile(filepath.Join(host, "hello.txt"), []byte("host-version\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, host, "add", "hello.txt")
	mustGit(t, host, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "peer edit")
	hostHeadBeforeMerge, err := CurrentHeadSHA(context.Background(), host)
	if err != nil {
		t.Fatal(err)
	}

	_, err = MergeBranchOnHost(context.Background(), host, "whx/req-3")
	var conflict *MergeConflictError
	if err == nil {
		t.Fatal("expected a merge conflict")
	}
	if !isMergeConflictError(err, &conflict) {
		t.Fatalf("expected *MergeConflictError, got %v", err)
	}
	if len(conflict.Paths) != 1 || conflict.Paths[0] != "hello.txt" {
		t.Fatalf("expected the conflicting path to be reported, got %v", conflict.Paths)
	}
	// The host must be left exactly as it was: no merge in progress, no
	// content change, HEAD unchanged.
	status := mustGit(t, host, "status", "--porcelain")
	if status != "" {
		t.Fatalf("expected a clean host working tree after aborted merge, got %q", status)
	}
	head, err := CurrentHeadSHA(context.Background(), host)
	if err != nil {
		t.Fatal(err)
	}
	if head != hostHeadBeforeMerge {
		t.Fatalf("expected HEAD to be unchanged after aborted merge, got %q want %q", head, hostHeadBeforeMerge)
	}
	data, err := os.ReadFile(filepath.Join(host, "hello.txt"))
	if err != nil || string(data) != "host-version\n" {
		t.Fatalf("expected the host's own content to survive untouched, got %q err=%v", data, err)
	}

	// The conflict must carry enough for a BASE/CURRENT/RESULT capsule
	// without any further merge attempt or working-tree checkout.
	if conflict.Branch != "whx/req-3" || conflict.HostSHA != hostHeadBeforeMerge || conflict.MergeBaseSHA == "" {
		t.Fatalf("incomplete conflict metadata: %#v", conflict)
	}
	base, baseExists, err := ReadFileAtRef(context.Background(), host, conflict.MergeBaseSHA, "hello.txt")
	if err != nil || !baseExists || base != "before\n" {
		t.Fatalf("expected the merge-base content to read back as the common ancestor, got %q exists=%v err=%v", base, baseExists, err)
	}
	current, currentExists, err := ReadFileAtRef(context.Background(), host, conflict.HostSHA, "hello.txt")
	if err != nil || !currentExists || current != "host-version\n" {
		t.Fatalf("expected the host's ref content, got %q exists=%v err=%v", current, currentExists, err)
	}
	result, resultExists, err := ReadFileAtRef(context.Background(), host, conflict.Branch, "hello.txt")
	if err != nil || !resultExists || result != "sandbox-version\n" {
		t.Fatalf("expected the candidate branch's content, got %q exists=%v err=%v", result, resultExists, err)
	}
	if _, exists, err := ReadFileAtRef(context.Background(), host, conflict.HostSHA, "does-not-exist.txt"); err != nil || exists {
		t.Fatalf("expected a missing path to read back as not-exists, got exists=%v err=%v", exists, err)
	}
}

func TestRevertHostMergeRestoresExactPreMergeState(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "hello.txt", "before\n")
	sandbox := cloneSandbox(t, host)
	if err := os.WriteFile(filepath.Join(sandbox, "hello.txt"), []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := CommitVerifiedPatch(context.Background(), sandbox, "whx/req-4", "fix: update hello.txt", []string{"hello.txt"}); err != nil {
		t.Fatal(err)
	}
	if err := PushBranchToHost(context.Background(), sandbox, host, "whx/req-4"); err != nil {
		t.Fatal(err)
	}
	merge, err := MergeBranchOnHost(context.Background(), host, "whx/req-4")
	if err != nil {
		t.Fatal(err)
	}
	preMergeSHA := merge.PreMergeSHA
	// Simulate a post-merge verification failure on host: revert.
	if _, err := RevertHostMerge(context.Background(), host, preMergeSHA); err != nil {
		t.Fatal(err)
	}
	head, err := CurrentHeadSHA(context.Background(), host)
	if err != nil {
		t.Fatal(err)
	}
	if head != preMergeSHA {
		t.Fatalf("expected HEAD to be restored to %q, got %q", preMergeSHA, head)
	}
	data, err := os.ReadFile(filepath.Join(host, "hello.txt"))
	if err != nil || string(data) != "before\n" {
		t.Fatalf("expected the pre-merge content to be restored, got %q err=%v", data, err)
	}
}

func isMergeConflictError(err error, target **MergeConflictError) bool {
	conflict, ok := err.(*MergeConflictError)
	if ok {
		*target = conflict
	}
	return ok
}

// A commit a person made on the branch after the integration merged is not the
// integration's to discard: a failed integration's revert keeps it.
func TestRevertHostMergeKeepsACommitMadeAfterTheIntegration(t *testing.T) {
	requireGit(t)
	host := newTestHostRepo(t, "hello.txt", "before\n")
	sandbox := cloneSandbox(t, host)
	if err := os.WriteFile(filepath.Join(sandbox, "hello.txt"), []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := CommitVerifiedPatch(context.Background(), sandbox, "whx/req-5", "fix: update hello.txt", []string{"hello.txt"}); err != nil {
		t.Fatal(err)
	}
	if err := PushBranchToHost(context.Background(), sandbox, host, "whx/req-5"); err != nil {
		t.Fatal(err)
	}
	merge, err := MergeBranchOnHost(context.Background(), host, "whx/req-5")
	if err != nil {
		t.Fatal(err)
	}
	tip, err := CurrentHeadSHA(context.Background(), host)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, host, "notes.txt", "a person's work\n")
	mustGit(t, host, "add", "notes.txt")
	mustGit(t, host, "-c", "user.name=Person", "-c", "user.email=p@example.invalid", "commit", "-qm", "docs: a person's commit")
	if _, err := RevertHostMergeKeepingLater(context.Background(), host, merge.PreMergeSHA, tip); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(host, "hello.txt")); err != nil || string(data) != "before\n" {
		t.Fatalf("the integration must be undone, got %q err=%v", data, err)
	}
	if data, err := os.ReadFile(filepath.Join(host, "notes.txt")); err != nil || string(data) != "a person's work\n" {
		t.Fatalf("the later commit must be kept, got %q err=%v", data, err)
	}
	if parent := mustGit(t, host, "rev-parse", "HEAD^"); parent != merge.PreMergeSHA {
		t.Fatalf("the kept commit must sit on the restored base, parent=%s want %s", parent, merge.PreMergeSHA)
	}
	if subject := mustGit(t, host, "log", "-1", "--format=%s"); subject != "docs: a person's commit" {
		t.Fatalf("HEAD subject=%q", subject)
	}
}
