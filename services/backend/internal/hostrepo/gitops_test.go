package hostrepo

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// newBareRemote creates a bare repository usable as a push target, so the push
// path is exercised for real without any network.
func newBareRemote(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "remote.git")
	git(t, t.TempDir(), "init", "-q", "--bare", "-b", "main", dir)
	return dir
}

func TestBranchesReportsLocalRemoteAndTracking(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	remote := newBareRemote(t)
	git(t, root, "remote", "add", "origin", remote)
	git(t, root, "push", "-q", "--set-upstream", "origin", "main")
	git(t, root, "checkout", "-q", "-b", "feature")
	write(t, root, "f.txt", "x\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: add f")

	branches, err := Branches(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]Branch{}
	for _, branch := range branches {
		byName[branch.Name] = branch
	}
	main, ok := byName["main"]
	if !ok {
		t.Fatalf("expected the local main branch, got %+v", branches)
	}
	if !main.HasUpstream || main.Upstream != "origin/main" {
		t.Fatalf("expected main tracking origin/main, got %+v", main)
	}
	feature, ok := byName["feature"]
	if !ok || !feature.Current {
		t.Fatalf("expected feature to be the current branch, got %+v", feature)
	}
	if feature.Subject != "feat: add f" {
		t.Fatalf("expected the tip subject, got %q", feature.Subject)
	}
	tracking, ok := byName["origin/main"]
	if !ok || tracking.Remote != "origin" {
		t.Fatalf("expected the origin/main remote-tracking branch, got %+v", byName)
	}
	// refs/remotes/<remote>/HEAD is a symbolic pointer, not something a human
	// merges; it must not appear as a branch.
	for _, branch := range branches {
		if strings.HasSuffix(branch.Name, "/HEAD") {
			t.Fatalf("remote HEAD must not be listed as a branch: %+v", branch)
		}
	}
}

func TestBranchesReportsAheadAndBehind(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	remote := newBareRemote(t)
	git(t, root, "remote", "add", "origin", remote)
	git(t, root, "push", "-q", "--set-upstream", "origin", "main")
	write(t, root, "local.txt", "local\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "local only")

	branches, err := Branches(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	for _, branch := range branches {
		if branch.Name != "main" {
			continue
		}
		if branch.Ahead != 1 || branch.Behind != 0 {
			t.Fatalf("expected 1 ahead / 0 behind, got %+v", branch)
		}
		return
	}
	t.Fatal("main branch not listed")
}

func TestRedactRemoteURLStripsEmbeddedCredentials(t *testing.T) {
	cases := map[string]string{
		"https://user:ghp_secret@github.com/org/repo.git": "https://***@github.com/org/repo.git",
		"https://token@github.com/org/repo.git":           "https://***@github.com/org/repo.git",
		"https://github.com/org/repo.git":                 "https://github.com/org/repo.git",
		"git@github.com:org/repo.git":                     "git@github.com:org/repo.git",
		"/srv/git/repo.git":                               "/srv/git/repo.git",
	}
	for raw, want := range cases {
		if got := RedactRemoteURL(raw); got != want {
			t.Fatalf("RedactRemoteURL(%q) = %q, want %q", raw, got, want)
		}
		if strings.Contains(RedactRemoteURL(raw), "ghp_secret") {
			t.Fatalf("a credential survived redaction of %q", raw)
		}
	}
}

// A Wharnex-originated commit is identified by its Request-Id trailer, not by
// its author: in manual mode the operator commits Wharnex's change under their
// own identity, and author-based detection would lose exactly those.
func TestLogIdentifiesWharnexCommitsByTrailer(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	write(t, root, "a.txt", "a\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: add a\n\nWhy it matters.\n\nRequest-Id: req_1\nPlan-Id: plan_1")
	write(t, root, "b.txt", "b\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "chore: unrelated human commit")

	commits, err := Log(context.Background(), root, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) < 2 {
		t.Fatalf("expected at least two commits, got %d", len(commits))
	}
	if commits[0].Wharnex {
		t.Fatalf("a commit with no trailer is not Wharnex-originated: %+v", commits[0])
	}
	whx := commits[1]
	if !whx.Wharnex || whx.RequestID != "req_1" || whx.PlanID != "plan_1" {
		t.Fatalf("expected the trailered commit recognised, got %+v", whx)
	}
	if whx.Subject != "feat: add a" || !strings.Contains(whx.Body, "Why it matters.") {
		t.Fatalf("subject/body were not separated correctly: %+v", whx)
	}
	// This repository has no remote-tracking refs, so neither commit is
	// provably pushed.
	if whx.Pushed {
		t.Fatal("with no upstream a commit must not be reported as pushed")
	}
}

func TestLogCarriesParentTopologyForMergeGraph(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	baseSHA := git(t, root, "rev-parse", "HEAD")

	git(t, root, "checkout", "-qb", "feature")
	write(t, root, "feature.txt", "feature\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: feature branch")
	featureSHA := git(t, root, "rev-parse", "HEAD")

	git(t, root, "checkout", "-q", "main")
	write(t, root, "main.txt", "main\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: main branch")
	mainSHA := git(t, root, "rev-parse", "HEAD")
	git(t, root, "merge", "--no-ff", "-q", "-m", "merge feature", "feature")

	commits, err := Log(context.Background(), root, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) < 4 {
		t.Fatalf("expected merge history, got %+v", commits)
	}
	if got := commits[0].Parents; len(got) != 2 || got[0] != mainSHA || got[1] != featureSHA {
		t.Fatalf("merge parents = %v, want [%s %s]", got, mainSHA, featureSHA)
	}
	if got := commits[len(commits)-1].Parents; len(got) != 0 {
		t.Fatalf("root commit must have no parents, got %v (base %s)", got, baseSHA)
	}
}

func TestLogRefsScopesHistoryToSelectedBranchesOrAll(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	git(t, root, "checkout", "-qb", "feature")
	write(t, root, "feature.txt", "feature\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: feature only")
	git(t, root, "checkout", "-q", "main")
	write(t, root, "main.txt", "main\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: main only")

	feature, err := LogRefs(context.Background(), root, []string{"feature"}, false, 20)
	if err != nil {
		t.Fatal(err)
	}
	for _, commit := range feature {
		if commit.Subject == "feat: main only" {
			t.Fatalf("selected feature history leaked a main-only commit: %+v", feature)
		}
	}
	if len(feature) < 2 || feature[0].Subject != "feat: feature only" {
		t.Fatalf("expected feature tip first, got %+v", feature)
	}

	all, err := LogRefs(context.Background(), root, nil, true, 20)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, commit := range all {
		seen[commit.Subject] = true
	}
	if !seen["feat: feature only"] || !seen["feat: main only"] {
		t.Fatalf("all-branch history must include both branch tips, got %+v", all)
	}
}

func TestSwitchBranchChangesOnlyToRequestedLocalBranch(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	git(t, root, "branch", "feature")
	if err := SwitchBranch(context.Background(), root, "feature"); err != nil {
		t.Fatal(err)
	}
	if got := CurrentBranch(context.Background(), root); got != "feature" {
		t.Fatalf("current branch = %q, want feature", got)
	}
	if err := SwitchBranch(context.Background(), root, "--detach"); err == nil {
		t.Fatal("option-shaped branch must be rejected")
	}
}

func TestLogMarksPushedCommits(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	remote := newBareRemote(t)
	git(t, root, "remote", "add", "origin", remote)
	git(t, root, "push", "-q", "--set-upstream", "origin", "main")
	write(t, root, "local.txt", "local\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "chore: local only")

	commits, err := Log(context.Background(), root, 10)
	if err != nil {
		t.Fatal(err)
	}
	if commits[0].Pushed {
		t.Fatalf("the newest local commit is not on the remote: %+v", commits[0])
	}
	if !commits[1].Pushed {
		t.Fatalf("the pushed commit must be marked pushed: %+v", commits[1])
	}
}

func TestCommitPathsCommitsOnlyTheSelectedPaths(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	write(t, root, "wanted.txt", "wanted\n")
	write(t, root, "unrelated.txt", "unrelated\n")

	sha, err := CommitPaths(context.Background(), root, "feat: add wanted", []string{"wanted.txt"})
	if err != nil {
		t.Fatal(err)
	}
	if sha == "" {
		t.Fatal("expected a commit sha")
	}
	files := git(t, root, "show", "--format=", "--name-only", sha)
	if !strings.Contains(files, "wanted.txt") || strings.Contains(files, "unrelated.txt") {
		t.Fatalf("the commit must hold only the selected path, got %q", files)
	}
	if status := git(t, root, "status", "--porcelain"); !strings.Contains(status, "unrelated.txt") {
		t.Fatalf("the unselected file must stay uncommitted, got %q", status)
	}
}

func TestCommitPathsReportsNothingToCommit(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	_, err := CommitPaths(context.Background(), root, "feat: nothing", []string{"README.md"})
	if !errors.Is(err, ErrNothingToCommit) {
		t.Fatalf("expected ErrNothingToCommit, got %v", err)
	}
	if status := git(t, root, "status", "--porcelain"); status != "" {
		t.Fatalf("a commit that did not happen must leave the index alone, got %q", status)
	}
}

// The applied change stays on disk while the history returns to where the
// operator left it — the whole point of the manual commit mode.
func TestUnwindToCommitKeepsFilesAndDropsHistory(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	original := git(t, root, "rev-parse", "HEAD")
	write(t, root, "applied.txt", "applied\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: applied by wharnex")

	if err := UnwindToCommit(context.Background(), root, original); err != nil {
		t.Fatal(err)
	}
	if head := git(t, root, "rev-parse", "HEAD"); head != original {
		t.Fatalf("expected HEAD back at %s, got %s", original, head)
	}
	data, err := os.ReadFile(filepath.Join(root, "applied.txt"))
	if err != nil || string(data) != "applied\n" {
		t.Fatalf("the applied file must survive, got %q err=%v", data, err)
	}
	if status := git(t, root, "status", "--porcelain"); !strings.Contains(status, "applied.txt") {
		t.Fatalf("the change must now read as uncommitted, got %q", status)
	}
}

func TestPushReportsRejectionSeparatelyFromFailure(t *testing.T) {
	requireGit(t)
	remote := newBareRemote(t)
	root := newRepo(t, "README.md", "root\n")
	git(t, root, "remote", "add", "origin", remote)
	if result, err := Push(context.Background(), root, "origin", "main", true); err != nil || !result.Succeeded() {
		t.Fatalf("first push should succeed, got %+v err=%v", result, err)
	}

	// A peer advances the remote behind our back.
	peer := t.TempDir()
	git(t, peer, "clone", "-q", remote, peer+"/clone")
	clone := peer + "/clone"
	write(t, clone, "peer.txt", "peer\n")
	git(t, clone, "add", "-A")
	git(t, clone, "commit", "-qm", "chore: peer work")
	git(t, clone, "push", "-q", "origin", "main")

	write(t, root, "mine.txt", "mine\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "chore: my work")

	result, err := Push(context.Background(), root, "origin", "main", false)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != PushOutcomeRejected {
		t.Fatalf("a non-fast-forward must be classified as rejected, not failed: %+v", result)
	}
}

func TestMergeBranchAbortsOnConflictAndLeavesTheTreeClean(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "f.txt", "base\n")
	git(t, root, "checkout", "-q", "-b", "other")
	write(t, root, "f.txt", "other\n")
	git(t, root, "commit", "-qam", "feat: other side")
	git(t, root, "checkout", "-q", "main")
	write(t, root, "f.txt", "mine\n")
	git(t, root, "commit", "-qam", "feat: my side")
	headBefore := git(t, root, "rev-parse", "HEAD")

	result, err := MergeBranch(context.Background(), root, "other")
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != MergeOutcomeConflict || !contains(result.Paths, "f.txt") {
		t.Fatalf("expected a conflict on f.txt, got %+v", result)
	}
	if result.Sides.BaseSHA == "" || result.Sides.OursSHA != headBefore || result.Sides.TheirsSHA == "" {
		t.Fatalf("the three merge sides must be recorded, got %+v", result.Sides)
	}
	// Wharnex's own integration refuses to act on a repository with unresolved
	// paths, so a conflicted merge left in place would block every Agent
	// request on the project.
	if status := git(t, root, "status", "--porcelain"); status != "" {
		t.Fatalf("a conflicting merge must leave the tree clean, got %q", status)
	}
	if head := git(t, root, "rev-parse", "HEAD"); head != headBefore {
		t.Fatal("an aborted merge must not move HEAD")
	}
}

func TestMergeBranchSucceedsOnDisjointChanges(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "f.txt", "base\n")
	git(t, root, "checkout", "-q", "-b", "other")
	write(t, root, "other.txt", "other\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: other file")
	git(t, root, "checkout", "-q", "main")

	result, err := MergeBranch(context.Background(), root, "other")
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != MergeOutcomeMerged && result.Outcome != MergeOutcomeUpToDate {
		t.Fatalf("expected a clean merge, got %+v", result)
	}
	if _, statErr := os.Stat(filepath.Join(root, "other.txt")); statErr != nil {
		t.Fatalf("the merged file must be present: %v", statErr)
	}
}

// Replaying the merge and patching our own clean version is what lets
// MergeBranch abort without losing anything.
func TestMergeResolutionReplaysAndCommits(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "f.txt", "base\n")
	git(t, root, "checkout", "-q", "-b", "other")
	write(t, root, "f.txt", "other\n")
	git(t, root, "commit", "-qam", "feat: other side")
	git(t, root, "checkout", "-q", "main")
	write(t, root, "f.txt", "mine\n")
	git(t, root, "commit", "-qam", "feat: my side")
	if _, err := MergeBranch(context.Background(), root, "other"); err != nil {
		t.Fatal(err)
	}

	if err := BeginMergeResolution(context.Background(), root, "other", []string{"f.txt"}); err != nil {
		t.Fatal(err)
	}
	// Our own clean version is on disk, with no conflict markers, which is
	// what makes the resolution expressible as an ordinary patch.
	if body := readFile(t, root, "f.txt"); body != "mine\n" {
		t.Fatalf("expected our clean version staged for patching, got %q", body)
	}
	if err := os.WriteFile(filepath.Join(root, "f.txt"), []byte("mine and other\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	sha, err := CompleteMergeResolution(context.Background(), root, []string{"f.txt"}, "merge: reconcile f.txt")
	if err != nil {
		t.Fatal(err)
	}
	if sha == "" {
		t.Fatal("expected a merge commit")
	}
	if body := readFile(t, root, "f.txt"); body != "mine and other\n" {
		t.Fatalf("expected the resolved content, got %q", body)
	}
	if parents := git(t, root, "rev-list", "--parents", "-n", "1", "HEAD"); len(strings.Fields(parents)) != 3 {
		t.Fatalf("the resolution must be a real merge commit with two parents, got %q", parents)
	}
	if status := git(t, root, "status", "--porcelain"); status != "" {
		t.Fatalf("expected a clean tree after concluding the merge, got %q", status)
	}
}

// A resolution that leaves a path conflicted must never be recorded as a
// finished merge.
func TestCompleteMergeResolutionRefusesUnresolvedPaths(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "f.txt", "base\n")
	write(t, root, "g.txt", "base\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "add g")
	git(t, root, "checkout", "-q", "-b", "other")
	write(t, root, "f.txt", "other\n")
	write(t, root, "g.txt", "other\n")
	git(t, root, "commit", "-qam", "feat: other side")
	git(t, root, "checkout", "-q", "main")
	write(t, root, "f.txt", "mine\n")
	write(t, root, "g.txt", "mine\n")
	git(t, root, "commit", "-qam", "feat: my side")

	if err := BeginMergeResolution(context.Background(), root, "other", []string{"f.txt"}); err != nil {
		t.Fatal(err)
	}
	// g.txt is still conflicted because only f.txt was resolved.
	if _, err := CompleteMergeResolution(context.Background(), root, []string{"f.txt"}, "merge: partial"); err == nil {
		t.Fatal("a partial resolution must not conclude the merge")
	}
	AbortMerge(context.Background(), root)
	if status := git(t, root, "status", "--porcelain"); status != "" {
		t.Fatalf("aborting must restore a clean tree, got %q", status)
	}
}

func TestFileAtRefReportsSubmodulePointersAsAbsent(t *testing.T) {
	requireGit(t)
	root, _ := newRepoWithSubmodule(t, "mod/app")
	if _, exists := FileAtRef(context.Background(), root, "HEAD", "mod/app"); exists {
		t.Fatal("a gitlink has no text content and must report as absent")
	}
	content, exists := FileAtRef(context.Background(), root, "HEAD", "README.md")
	if !exists || content != "root\n" {
		t.Fatalf("expected the file content preserved byte-for-byte, got %q exists=%v", content, exists)
	}
}

func TestCommitInternalPathsUsesWharnexIdentityAndLeavesOtherChanges(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	write(t, root, "VERSION", "v1.2.3.4\n")
	write(t, root, "unrelated.txt", "keep me pending\n")

	sha, err := CommitInternalPaths(context.Background(), root, "chore(version): bump project version", []string{"VERSION"})
	if err != nil {
		t.Fatal(err)
	}
	if author := git(t, root, "show", "-s", "--format=%an <%ae>", sha); author != "Wharnex <wharness@localhost>" {
		t.Fatalf("unexpected internal commit identity: %q", author)
	}
	files := git(t, root, "show", "--format=", "--name-only", sha)
	if !strings.Contains(files, "VERSION") || strings.Contains(files, "unrelated.txt") {
		t.Fatalf("internal commit must contain only VERSION, got %q", files)
	}
	if status := git(t, root, "status", "--porcelain"); !strings.Contains(status, "unrelated.txt") {
		t.Fatalf("unrelated work must remain pending, got %q", status)
	}
}

func TestWorktreeDiffIncludesUntrackedFiles(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	write(t, root, "new.txt", "first line\nsecond line\n")

	diff, truncated, err := WorktreeDiff(context.Background(), root, []string{"new.txt"}, 64<<10)
	if err != nil {
		t.Fatal(err)
	}
	if truncated {
		t.Fatal("small untracked diff must not be truncated")
	}
	if !strings.Contains(diff, "+first line") || !strings.Contains(diff, "+second line") {
		t.Fatalf("untracked content missing from worktree diff: %q", diff)
	}
}

func TestUnpushedWithoutUpstreamUsesRemoteReachability(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	remote := newBareRemote(t)
	git(t, root, "remote", "add", "origin", remote)
	git(t, root, "push", "-q", "origin", "main")
	base := git(t, root, "rev-parse", "HEAD")
	git(t, root, "rev-parse", "refs/remotes/origin/main")

	git(t, root, "checkout", "-qb", "feature")
	write(t, root, "local.txt", "local\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: local feature commit")
	local := git(t, root, "rev-parse", "HEAD")

	commits, err := Unpushed(context.Background(), root, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) != 1 || commits[0].SHA != local {
		t.Fatalf("expected only the commit absent from every remote ref, got %+v", commits)
	}

	history, err := Log(context.Background(), root, 10)
	if err != nil {
		t.Fatal(err)
	}
	pushed := map[string]bool{}
	for _, commit := range history {
		pushed[commit.SHA] = commit.Pushed
	}
	if pushed[local] {
		t.Fatal("the feature commit must remain unpublished")
	}
	if !pushed[base] {
		t.Fatal("the base commit reachable from origin/main must be marked published")
	}
}

func TestUnpushedAndPushCommitPublishOnlySelectedTip(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	remote := newBareRemote(t)
	git(t, root, "remote", "add", "origin", remote)
	git(t, root, "push", "-q", "--set-upstream", "origin", "main")

	write(t, root, "one.txt", "one\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: first local commit")
	first := git(t, root, "rev-parse", "HEAD")
	write(t, root, "two.txt", "two\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: second local commit")
	second := git(t, root, "rev-parse", "HEAD")

	commits, err := Unpushed(context.Background(), root, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) != 2 || commits[0].SHA != second || commits[1].SHA != first {
		t.Fatalf("expected newest-first unpushed commits, got %+v", commits)
	}
	result, err := PushCommit(context.Background(), root, "origin", "main", first)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != PushOutcomePushed {
		t.Fatalf("expected selected commit push to succeed, got %+v", result)
	}
	if remoteHead := git(t, remote, "rev-parse", "refs/heads/main"); remoteHead != first {
		t.Fatalf("selective push advanced remote to %s, want %s", remoteHead, first)
	}
	if localHead := git(t, root, "rev-parse", "HEAD"); localHead != second {
		t.Fatalf("selective push must not move local HEAD, got %s want %s", localHead, second)
	}
}

func TestFetchPrunesDeletedRemoteTrackingBranches(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	remote := newBareRemote(t)
	git(t, root, "remote", "add", "origin", remote)
	git(t, root, "push", "-q", "--set-upstream", "origin", "main")
	git(t, root, "branch", "stale")
	git(t, root, "push", "-q", "origin", "stale")
	git(t, remote, "update-ref", "-d", "refs/heads/stale")
	if err := Fetch(context.Background(), root, "origin"); err != nil {
		t.Fatal(err)
	}
	if _, err := run(context.Background(), root, "show-ref", "--verify", "refs/remotes/origin/stale"); err == nil {
		t.Fatal("fetch must prune a remote-tracking branch deleted on the server")
	}
}

func TestBranchesPairsLocalAndRemoteAndMirrorsDivergence(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	remote := newBareRemote(t)
	git(t, root, "remote", "add", "origin", remote)
	git(t, root, "push", "-q", "--set-upstream", "origin", "main")
	write(t, root, "local.txt", "local\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: local")

	branches, err := Branches(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]Branch{}
	for _, branch := range branches {
		byName[branch.Name] = branch
	}
	local, remoteBranch := byName["main"], byName["origin/main"]
	if !local.HasCounterpart || local.Counterpart != "origin/main" || local.Ahead != 1 || local.Behind != 0 {
		t.Fatalf("unexpected local pairing: %+v", local)
	}
	if !remoteBranch.HasCounterpart || remoteBranch.Counterpart != "main" || remoteBranch.Ahead != 1 || remoteBranch.Behind != 0 {
		t.Fatalf("unexpected remote pairing: %+v", remoteBranch)
	}
}

func TestSwitchRemoteBranchCreatesTrackingLocalBranch(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	remote := newBareRemote(t)
	git(t, root, "remote", "add", "origin", remote)
	git(t, root, "push", "-q", "--set-upstream", "origin", "main")
	git(t, root, "branch", "feature")
	git(t, root, "push", "-q", "origin", "feature")
	git(t, root, "branch", "-D", "feature")
	local, err := SwitchRemoteBranch(context.Background(), root, "origin/feature")
	if err != nil {
		t.Fatal(err)
	}
	if local != "feature" || CurrentBranch(context.Background(), root) != "feature" {
		t.Fatalf("remote switch created %q on %q", local, CurrentBranch(context.Background(), root))
	}
	branches, err := Branches(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	for _, branch := range branches {
		if branch.Name == "feature" && branch.Upstream == "origin/feature" {
			return
		}
	}
	t.Fatal("new local branch does not track origin/feature")
}

func TestMergeRemoteBranchesUsesDisposableWorktreeAndPreservesCurrentBranch(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	remote := newBareRemote(t)
	git(t, root, "remote", "add", "origin", remote)
	git(t, root, "push", "-q", "--set-upstream", "origin", "main")
	git(t, root, "checkout", "-qb", "target")
	write(t, root, "target.txt", "target\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: target")
	git(t, root, "push", "-q", "origin", "target")
	git(t, root, "checkout", "-qb", "source", "main")
	write(t, root, "source.txt", "source\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: source")
	git(t, root, "push", "-q", "origin", "source")
	git(t, root, "checkout", "-q", "main")
	before, _ := run(context.Background(), root, "rev-parse", "HEAD")

	result, err := MergeRemoteBranches(context.Background(), root, "origin/target", []string{"origin/source"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "merged" || result.PushOutcome != string(PushOutcomePushed) {
		t.Fatalf("unexpected result: %+v", result)
	}
	if CurrentBranch(context.Background(), root) != "main" {
		t.Fatalf("current branch changed to %q", CurrentBranch(context.Background(), root))
	}
	after, _ := run(context.Background(), root, "rev-parse", "HEAD")
	if before != after {
		t.Fatalf("local HEAD changed from %s to %s", before, after)
	}
	git(t, root, "fetch", "-q", "origin")
	if _, err := run(context.Background(), root, "merge-base", "--is-ancestor", "origin/source", "origin/target"); err != nil {
		t.Fatal("target does not contain source after remote merge")
	}
}

func TestMergeCandidatesOnlyReturnsRefsWithCommitsMissingFromTarget(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	remote := newBareRemote(t)
	git(t, root, "remote", "add", "origin", remote)
	git(t, root, "push", "-q", "--set-upstream", "origin", "main")

	git(t, root, "checkout", "-qb", "integrated")
	write(t, root, "integrated.txt", "integrated\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: integrated")
	git(t, root, "checkout", "-q", "main")
	git(t, root, "merge", "-q", "--ff-only", "integrated")

	git(t, root, "checkout", "-qb", "local-only")
	write(t, root, "local-only.txt", "local\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: local only")
	git(t, root, "checkout", "-q", "main")

	git(t, root, "checkout", "-qb", "remote-only")
	write(t, root, "remote-only.txt", "remote\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: remote only")
	git(t, root, "push", "-q", "origin", "remote-only")
	git(t, root, "checkout", "-q", "main")

	candidates, err := MergeCandidates(context.Background(), root, "main")
	if err != nil {
		t.Fatal(err)
	}
	byName := map[string]Branch{}
	for _, branch := range candidates {
		byName[branch.Name] = branch
	}
	if _, ok := byName["integrated"]; ok {
		t.Fatalf("already integrated branch must not be offered: %+v", candidates)
	}
	if byName["local-only"].UnmergedCommits != 1 {
		t.Fatalf("expected one missing local commit, got %+v", byName["local-only"])
	}
	if byName["origin/remote-only"].UnmergedCommits != 1 {
		t.Fatalf("expected one missing remote commit, got %+v", byName["origin/remote-only"])
	}
}

func TestMergeRemoteBranchesAcceptsLocalSourceRef(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	remote := newBareRemote(t)
	git(t, root, "remote", "add", "origin", remote)
	git(t, root, "push", "-q", "--set-upstream", "origin", "main")
	git(t, root, "branch", "target")
	git(t, root, "push", "-q", "origin", "target")

	git(t, root, "checkout", "-qb", "local-source")
	write(t, root, "local-source.txt", "local source\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: local source")
	git(t, root, "checkout", "-q", "main")

	result, err := MergeRemoteBranches(context.Background(), root, "origin/target", []string{"local-source"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != "merged" || result.PushOutcome != string(PushOutcomePushed) {
		t.Fatalf("unexpected result: %+v", result)
	}
	git(t, root, "fetch", "-q", "origin")
	if _, err := run(context.Background(), root, "merge-base", "--is-ancestor", "local-source", "origin/target"); err != nil {
		t.Fatal("remote target must contain the selected local source")
	}
}

func TestLogPageIncludesLineStatsAndOffset(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	write(t, root, "one.txt", "one\ntwo\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: two lines")
	write(t, root, "one.txt", "one\nchanged\nthree\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "fix: replace and add")

	first, err := LogRefsPage(context.Background(), root, nil, false, 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	second, err := LogRefsPage(context.Background(), root, nil, false, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 1 || len(second) != 1 || first[0].SHA == second[0].SHA {
		t.Fatalf("offset paging did not return distinct commits: first=%+v second=%+v", first, second)
	}
	if first[0].FilesChanged != 1 || first[0].Additions != 2 || first[0].Deletions != 1 {
		t.Fatalf("unexpected numstat for newest commit: %+v", first[0])
	}
}

func TestMergeRemoteBranchesUsesInjectedPushTransport(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	remote := newBareRemote(t)
	git(t, root, "remote", "add", "origin", remote)
	git(t, root, "push", "-q", "--set-upstream", "origin", "main")
	git(t, root, "branch", "target")
	git(t, root, "push", "-q", "origin", "target")

	git(t, root, "checkout", "-qb", "source")
	write(t, root, "source.txt", "source\n")
	git(t, root, "add", "-A")
	git(t, root, "commit", "-qm", "feat: source")
	git(t, root, "push", "-q", "origin", "source")
	git(t, root, "checkout", "-q", "main")

	called := 0
	publisher := func(ctx context.Context, gotRoot, gotRemote, gotBranch, sha string) (PushResult, error) {
		called++
		if gotRoot != root || gotRemote != "origin" || gotBranch != "target" || len(sha) != 40 {
			t.Fatalf("unexpected publish request: root=%q remote=%q branch=%q sha=%q", gotRoot, gotRemote, gotBranch, sha)
		}
		return PushResult{Outcome: PushOutcomePushed, Remote: gotRemote, Branch: gotBranch}, nil
	}
	result, err := MergeRemoteBranchesWithPush(context.Background(), root, "origin/target", []string{"origin/source"}, publisher)
	if err != nil {
		t.Fatal(err)
	}
	if called != 1 {
		t.Fatalf("expected one injected publish, got %d", called)
	}
	if result.Outcome != "merged" || result.PushOutcome != string(PushOutcomePushed) {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestFinishRemoteMergeResolutionUsesInjectedPushTransport(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	head := git(t, root, "rev-parse", "HEAD")
	workspace := RemoteMergeResolutionWorkspace{
		Path:         root,
		TargetRef:    "origin/main",
		TargetRemote: "origin",
		TargetBranch: "main",
		SourceRefs:   []string{"feature"},
	}
	called := 0
	publisher := func(ctx context.Context, gotRoot, gotRemote, gotBranch, sha string) (PushResult, error) {
		called++
		if gotRoot != root || gotRemote != "origin" || gotBranch != "main" || sha != head {
			t.Fatalf("unexpected publish request: root=%q remote=%q branch=%q sha=%q", gotRoot, gotRemote, gotBranch, sha)
		}
		return PushResult{Outcome: PushOutcomePushed, Remote: gotRemote, Branch: gotBranch}, nil
	}
	result, err := FinishRemoteMergeResolutionWithPush(context.Background(), root, workspace, publisher)
	if err != nil {
		t.Fatal(err)
	}
	if called != 1 {
		t.Fatalf("expected one injected publish, got %d", called)
	}
	if result.CommitSHA != head || result.PushOutcome != string(PushOutcomePushed) {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestCreateDeleteBranchAndReleaseTagAreSafeAndIdempotent(t *testing.T) {
	requireGit(t)
	root := newRepo(t, "README.md", "root\n")
	if err := CreateBranch(context.Background(), root, "feature/release", "main"); err != nil {
		t.Fatal(err)
	}
	if got := CurrentBranch(context.Background(), root); got != "main" {
		t.Fatalf("creating a branch changed checkout to %q", got)
	}
	sha, err := CreateTagAtRef(context.Background(), root, "v1.0.0", "feature/release")
	if err != nil {
		t.Fatal(err)
	}
	if again, err := CreateTagAtRef(context.Background(), root, "v1.0.0", "feature/release"); err != nil || again != sha {
		t.Fatalf("idempotent tag retry = %q, %v; want %q", again, err, sha)
	}
	tags, err := Tags(context.Background(), root, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(tags) != 1 || tags[0].Name != "v1.0.0" || tags[0].CommitSHA != sha {
		t.Fatalf("unexpected tag inventory: %+v", tags)
	}
	if err := DeleteBranch(context.Background(), root, "feature/release"); err != nil {
		t.Fatal(err)
	}
	if err := DeleteBranch(context.Background(), root, "main"); err == nil {
		t.Fatal("checked-out branch deletion must be rejected")
	}
}
