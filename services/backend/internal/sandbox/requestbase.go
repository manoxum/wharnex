package sandbox

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/projectknowledge"
)

// requestBaseRefPrefix namespaces the refs Wharnex anchors a request's base
// tree under. Refs outside refs/heads/* and refs/tags/* are invisible to
// `git branch`, `git tag` and a default `git log`, so anchoring here keeps a
// project's ordinary Git UX unchanged while still protecting the commit
// object from garbage collection for as long as the request can execute.
const requestBaseRefPrefix = "refs/wharnex/base/"

// RequestBaseRef is the full ref name anchoring one request's base tree.
func RequestBaseRef(requestID string) string {
	return requestBaseRefPrefix + strings.TrimSpace(requestID)
}

// CaptureRequestBase records the exact host tree a planner request is being
// snapshotted against, as a real commit object in the host's own repository,
// and anchors it under refs/wharnex/base/<request_id>.
//
// This is the counterpart to the context bundle: the bundle is what the model
// reads, this commit is what the model's patch is authored against. Recording
// it is what later lets Wharnex apply that patch to the tree it was actually
// written for instead of to whatever the host has drifted to since, turning a
// dead-end "patch does not apply cleanly" into an ordinary three-way merge.
//
// It is deliberately non-invasive. All staging happens in a private temporary
// index file, so the host's own index, HEAD, current branch and working tree
// are never touched — an operator with a half-staged change in progress is
// completely unaffected. The commit's parent is the host's current HEAD, which
// is what gives it real shared ancestry with the host for a later merge.
//
// Content is what `git add -A` stages for planner-visible project state:
// tracked files plus untracked files, minus gitignored content and the
// Wharnex-managed knowledge subtree. Knowledge is transported separately from
// project context and planners cannot patch it, so recording its volatile
// working-tree version in the request-base ancestry falsely makes it look like
// candidate-owned source during a later three-way merge.
func CaptureRequestBase(ctx context.Context, hostPath, requestID string) (commitSHA string, err error) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return "", errors.New("request id is required")
	}
	commit, err := captureWorkingTreeCommit(ctx, hostPath, "Wharnex request base "+requestID, []string{projectknowledge.DirectoryName})
	if err != nil {
		return "", err
	}
	if output, err := runGit(ctx, hostPath, "update-ref", RequestBaseRef(requestID), commit); err != nil {
		return "", fmt.Errorf("anchor request base ref: %s", output)
	}
	return commit, nil
}

// CaptureWorkingTreeCommit records a repository's current working tree as a
// real commit object parented on its HEAD, without touching that repository's
// index, HEAD, branch or working tree. Staging happens in a private temporary
// index, so an operator's in-progress work — including a half-staged change —
// is completely unaffected.
//
// The commit is returned unreferenced. Callers that need it to survive beyond
// the immediate operation must anchor it under a ref themselves
// (CaptureRequestBase does); callers using it for a read-only comparison can
// use it directly.
func CaptureWorkingTreeCommit(ctx context.Context, repoPath, message string) (commitSHA string, err error) {
	return captureWorkingTreeCommit(ctx, repoPath, message, nil)
}

func captureWorkingTreeCommit(ctx context.Context, repoPath, message string, excludedPaths []string) (commitSHA string, err error) {
	head, err := CurrentHeadSHA(ctx, repoPath)
	if err != nil {
		// A repository with no commit yet has no tree to parent onto; the
		// caller degrades rather than failing the operation outright.
		return "", err
	}
	topology, err := hostrepo.Inspect(ctx, repoPath)
	if err != nil {
		return "", err
	}
	state, err := hostrepo.Working(ctx, repoPath)
	if err != nil {
		return "", err
	}
	// The temporary index goes in the repository's REAL Git directory, which
	// is not always <repoPath>/.git: a linked worktree (git worktree add) and
	// a project root that is itself a submodule both use a `.git` FILE. Writing
	// through that path failed with "not a directory", and because both callers
	// treat capture as best effort, the failure was silent — it disabled
	// request-base rooting and the merge preflight outright on exactly the
	// repository shapes that need them most.
	indexPath, err := os.CreateTemp(topology.GitDir, "wharnex-tmp-index-*")
	if err != nil {
		return "", fmt.Errorf("create temporary index: %w", err)
	}
	indexName := indexPath.Name()
	_ = indexPath.Close()
	// git refuses to read an existing zero-length index file, so the reserved
	// name is released and only used as a path from here on.
	_ = os.Remove(indexName)
	defer func() { _ = os.Remove(indexName) }()

	env := append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_INDEX_FILE="+indexName)
	runIsolated := func(args ...string) (string, error) {
		cmd := exec.CommandContext(ctx, "git", append([]string{"-C", repoPath}, args...)...)
		cmd.Env = env
		output, runErr := cmd.CombinedOutput()
		return strings.TrimSpace(string(output)), runErr
	}
	if output, err := runIsolated("read-tree", head); err != nil {
		return "", fmt.Errorf("seed temporary index: %s", output)
	}
	// Embedded repositories are excluded for the same reason the pre-merge
	// snapshot excludes them: `git add -A` records one as a gitlink, so the
	// base tree would claim a submodule where the model was shown files, and
	// a sandbox checked out at that base would find the directory empty.
	stageArgs := hostrepo.StageArgs(state.EmbeddedRepositories)
	for _, path := range excludedPaths {
		path = filepath.ToSlash(filepath.Clean(strings.TrimSpace(path)))
		if path != "." && path != "" {
			stageArgs = append(stageArgs, ":(exclude)"+path)
		}
	}
	if output, err := runIsolated(stageArgs...); err != nil {
		return "", fmt.Errorf("stage working tree: %s", output)
	}
	tree, err := runIsolated("write-tree")
	if err != nil {
		return "", fmt.Errorf("write tree: %s", tree)
	}
	commit, err := runIsolated(
		"-c", "user.name="+gitCommitAuthorName,
		"-c", "user.email="+gitCommitAuthorEmail,
		"-c", "commit.gpgSign=false",
		"commit-tree", tree, "-p", head, "-m", message,
	)
	if err != nil {
		return "", fmt.Errorf("record working tree commit: %s", commit)
	}
	return commit, nil
}

// PreflightMergeIntoHost answers whether merging branch into the host would
// conflict, against the host's real current content — committed and
// uncommitted alike — while leaving the host completely untouched.
//
// It compares against a throwaway commit of the working tree rather than bare
// HEAD because the real merge commits that same dirty state first
// (snapshotUncommittedHostState); preflighting against HEAD alone would miss a
// conflict with an operator's uncommitted edit and report a false "clean".
//
// A nil error with a nil conflict means the merge is expected to succeed, the
// only predicted conflicts are Wharnex-managed knowledge (which the real merge
// preserves from the host locally), or this Git build cannot answer. The real
// merge stays authoritative: this exists so a merge already known to be doomed
// on planner-resolvable paths never reaches the host and never leaves a
// pre-merge snapshot commit behind for nothing.
func PreflightMergeIntoHost(ctx context.Context, hostPath, branch string) (*MergeConflictError, error) {
	return PreflightMergeIntoHostExcept(ctx, hostPath, branch, nil)
}

// PreflightMergeIntoHostExcept is PreflightMergeIntoHost with the gitlinks of
// the submodules this same integration is about to merge treated as
// already-decided rather than as conflicts.
//
// The superproject's branch records each submodule at the commit the SANDBOX
// made; the host records wherever its own copy is. A dry-run merge of the
// superproject alone therefore reports a gitlink conflict whenever a submodule
// moved on either side — which is exactly the case this whole mechanism exists
// to handle, and which the real integration resolves by merging that submodule
// first and then recording where it landed. Counting it as an ordinary
// conflict would abort a legitimate integration and hand a planner a commit id
// to patch (adr/ADR-0050).
func PreflightMergeIntoHostExcept(ctx context.Context, hostPath, branch string, integratingUnits []string) (*MergeConflictError, error) {
	comparison, err := CaptureWorkingTreeCommit(ctx, hostPath, "Wharnex merge preflight")
	if err != nil {
		return nil, err
	}
	preflight, err := PreflightMerge(ctx, hostPath, comparison, branch)
	if err != nil || !preflight.Supported || preflight.Clean {
		return nil, err
	}
	_, ordinary := partitionManagedMergePaths(preflight.ConflictPaths)
	ordinary = withoutIntegratingUnits(ordinary, integratingUnits)
	if len(ordinary) == 0 {
		return nil, nil
	}
	mergeBase, _ := runGit(ctx, hostPath, "merge-base", comparison, branch)
	return &MergeConflictError{Paths: ordinary, Branch: branch, HostSHA: comparison, MergeBaseSHA: mergeBase}, nil
}

// withoutIntegratingUnits removes only the gitlink paths for submodules that
// this same host integration is already merging independently. A nested file
// path is not equivalent to the gitlink itself and must remain an ordinary
// conflict for the caller to resolve.
func withoutIntegratingUnits(paths, integratingUnits []string) []string {
	if len(paths) == 0 || len(integratingUnits) == 0 {
		return paths
	}
	integrating := make(map[string]struct{}, len(integratingUnits))
	for _, unit := range integratingUnits {
		unit = filepath.ToSlash(filepath.Clean(strings.TrimSpace(unit)))
		unit = strings.TrimPrefix(unit, "./")
		if unit == "" || unit == "." {
			continue
		}
		integrating[unit] = struct{}{}
	}
	out := make([]string, 0, len(paths))
	for _, path := range paths {
		normalized := filepath.ToSlash(filepath.Clean(strings.TrimSpace(path)))
		normalized = strings.TrimPrefix(normalized, "./")
		if _, ignored := integrating[normalized]; ignored {
			continue
		}
		out = append(out, path)
	}
	return out
}

// DeleteRequestBaseRef releases a request's anchored base tree once no
// execution can still need it. The commit object itself becomes unreachable
// and is reclaimed by Git's own garbage collection; nothing in the host's
// visible history is affected because the ref never lived under refs/heads.
func DeleteRequestBaseRef(ctx context.Context, hostPath, requestID string) error {
	if output, err := runGit(ctx, hostPath, "update-ref", "-d", RequestBaseRef(requestID)); err != nil {
		return fmt.Errorf("release request base ref: %s", output)
	}
	return nil
}

// FetchRefFromHost copies one arbitrary ref from the host's own .git into
// repoPath under the same name, by absolute filesystem path and with no
// network involved. FetchBranchFromHost covers the refs/heads case; a request
// base lives outside refs/heads and a local clone does not carry it (clone
// negotiates refs/heads/* only), so a fresh verification sandbox must ask for
// it explicitly even though the object itself already arrived with the clone.
func FetchRefFromHost(ctx context.Context, repoPath, hostPath, ref string) error {
	if output, err := runGit(ctx, repoPath, "fetch", "-q", "--no-tags", "--", hostPath, ref+":"+ref); err != nil {
		return fmt.Errorf("fetch %s from host: %s", ref, output)
	}
	return nil
}

// CheckoutRequestBase repoints a verification sandbox's working tree at the
// exact tree a request was planned against and opens the integration branch
// there, so the plan's patch applies to the content the model actually read.
//
// git clean removes files that only exist because the sandbox was populated
// from the host's newer state; it deliberately runs without -x so lazily
// hydrated, gitignored dependency trees (node_modules, the private Go module
// cache) survive and do not have to be copied again.
func CheckoutRequestBase(ctx context.Context, workspacePath, branch, baseCommitSHA string) error {
	if strings.TrimSpace(branch) == "" {
		return errors.New("branch name is required")
	}
	if strings.TrimSpace(baseCommitSHA) == "" {
		return errors.New("base commit is required")
	}
	if output, err := runGit(ctx, workspacePath, "checkout", "-q", "--force", "-B", branch, baseCommitSHA); err != nil {
		return fmt.Errorf("check out request base %s: %s", baseCommitSHA, output)
	}
	if output, err := runGit(ctx, workspacePath, "clean", "-q", "-fd"); err != nil {
		return fmt.Errorf("clean sandbox worktree to request base: %s", output)
	}
	return nil
}

// CommitBaseRootedPatch commits an applied, verified patch on a branch that is
// already rooted at the request's own base (CheckoutRequestBase created it),
// so the resulting commit's parent is the base rather than the host's newer
// tip. That parentage is what makes the later host merge a real three-way
// merge with a meaningful merge-base instead of a same-tip fast-forward.
//
// paths is the plan's own declared write set, for the same reason
// CommitVerifiedPatch documents: a wildcard add would fold unrelated content
// into a commit presented as one verified change.
func CommitBaseRootedPatch(ctx context.Context, workspacePath, message string, paths []string) (commitSHA string, err error) {
	if strings.TrimSpace(message) == "" {
		return "", errors.New("commit message is required")
	}
	if len(paths) == 0 {
		return "", errors.New("at least one changed path is required")
	}
	addArgs := append([]string{"add", "--"}, paths...)
	if output, err := runGit(ctx, workspacePath, addArgs...); err != nil {
		return "", fmt.Errorf("stage verified changes: %s", output)
	}
	commitArgs := []string{
		"-c", "user.name=" + gitCommitAuthorName,
		"-c", "user.email=" + gitCommitAuthorEmail,
		"-c", "commit.gpgSign=false",
		"commit", "-q", "-m", message,
	}
	if output, err := runGit(ctx, workspacePath, commitArgs...); err != nil {
		return "", fmt.Errorf("commit verified changes: %s", output)
	}
	return CurrentHeadSHA(ctx, workspacePath)
}
