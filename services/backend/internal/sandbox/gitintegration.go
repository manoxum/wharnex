package sandbox

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// gitCommitAuthor* mirror the identity already used for the synthetic
// sandbox baseline commit (see cloneGitBaseline/initializeWorkspaceGit in
// copy.go): a fixed, non-human identity for commits Wharness itself makes,
// never the operator's own configured Git identity.
const (
	gitCommitAuthorName  = "Wharness"
	gitCommitAuthorEmail = "wharness@localhost"
)

// MergeConflictError reports a real Git merge conflict encountered while
// integrating a verified sandbox branch into the host. The host is always
// left exactly as it was before the merge attempt was made: the caller
// aborts the merge before returning this error. HostSHA/Branch/MergeBaseSHA
// carry enough for the caller to build a BASE/CURRENT/RESULT conflict
// capsule via ReadFileAtRef without any further merge attempt.
type MergeConflictError struct {
	Paths        []string
	Branch       string
	HostSHA      string
	MergeBaseSHA string
}

func (e *MergeConflictError) Error() string {
	return fmt.Sprintf("merge conflict on %s", strings.Join(e.Paths, ", "))
}

func runGit(ctx context.Context, dir string, args ...string) (string, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return "", errors.New("git executable not found")
	}
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(output)), err
}

// CurrentHeadSHA returns the commit SHA a repository's HEAD currently
// resolves to. Used to capture the host's pre-merge position so a failed
// post-merge verification can be reverted precisely.
func CurrentHeadSHA(ctx context.Context, repoPath string) (string, error) {
	output, err := runGit(ctx, repoPath, "rev-parse", "HEAD")
	if err != nil {
		return "", fmt.Errorf("resolve HEAD: %s", output)
	}
	return output, nil
}

// CommitVerifiedPatch commits the sandbox workspace's currently-applied,
// verified working-tree changes onto a new branch. The sandbox workspace is
// already a real local clone of the host's own repository history (see
// cloneGitBaseline in copy.go), so this is a normal commit against real
// history, not a synthetic snapshot. message is used verbatim: sanitizing
// planner-supplied text and adding Request-Id/Plan-Id trailers is the
// caller's responsibility (internal/app knows those identifiers; this
// package deliberately does not).
//
// paths MUST be exactly the plan's own declared write set (the same
// actualPatchFiles(plan) list the caller uses everywhere else), never "add
// everything". copyProject overlays the host's real current on-disk content
// (including any of the operator's own unrelated uncommitted edits) onto the
// sandbox's working tree so it matches the content-hash baseline the plan was
// verified against — but that overlay is not part of the sandbox's cloned
// git history. A wildcard `git add -A` here would silently fold the
// operator's unrelated dirty files into this "verified patch" commit,
// alongside whatever the host's own pre-merge dirty-tree snapshot
// (snapshotUncommittedHostState) commits separately for the exact same
// paths — producing a spurious merge conflict on files the plan never
// touched.
func CommitVerifiedPatch(ctx context.Context, workspacePath, branch, message string, paths []string) (commitSHA string, err error) {
	if strings.TrimSpace(branch) == "" {
		return "", errors.New("branch name is required")
	}
	if strings.TrimSpace(message) == "" {
		return "", errors.New("commit message is required")
	}
	if len(paths) == 0 {
		return "", errors.New("at least one changed path is required")
	}
	if output, err := runGit(ctx, workspacePath, "checkout", "-b", branch); err != nil {
		return "", fmt.Errorf("create integration branch %s: %s", branch, output)
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
	sha, err := CurrentHeadSHA(ctx, workspacePath)
	if err != nil {
		return "", fmt.Errorf("resolve integration commit: %w", err)
	}
	return sha, nil
}

// PushBranchToHost transfers commits from a sandbox clone's branch into the
// host's own .git as a new branch ref, via a local (no-network) git push:
// the destination is always an absolute filesystem path, never a URL, and
// nothing here ever touches any remote the operator configured.
func PushBranchToHost(ctx context.Context, sandboxPath, hostPath, branch string) error {
	if output, err := runGit(ctx, sandboxPath, "push", "--no-verify", "--", hostPath, branch+":refs/heads/"+branch); err != nil {
		return fmt.Errorf("push integration branch to host: %s", output)
	}
	return nil
}

// snapshotUncommittedHostState commits any modified/untracked files
// currently sitting in the host's working tree, so a merge always starts
// from a clean tree. Without this, a completely unrelated untracked file
// (e.g. one created after the project's own baseline commit but never
// staged — whaness.yml on a freshly opened project is the case that
// surfaced this) makes Git refuse the merge outright with "untracked
// working tree files would be overwritten", which is not a real conflict
// at all. A no-op when the tree is already clean. The commit lands BEFORE
// preMergeSHA is captured, so RevertHostMerge on a later failure never
// discards a human's own pre-existing uncommitted edits — only the merge
// this request made on top of them.
func snapshotUncommittedHostState(ctx context.Context, hostPath string) error {
	status, err := runGit(ctx, hostPath, "status", "--porcelain")
	if err != nil {
		return fmt.Errorf("inspect host working tree: %s", status)
	}
	if strings.TrimSpace(status) == "" {
		return nil
	}
	if output, err := runGit(ctx, hostPath, "add", "-A"); err != nil {
		return fmt.Errorf("stage host working tree before merge: %s", output)
	}
	commitArgs := []string{
		"-c", "user.name=" + gitCommitAuthorName,
		"-c", "user.email=" + gitCommitAuthorEmail,
		"-c", "commit.gpgSign=false",
		"commit", "-q", "-m", "Wharness host snapshot before integration",
	}
	if output, err := runGit(ctx, hostPath, commitArgs...); err != nil {
		return fmt.Errorf("commit host working tree before merge: %s", output)
	}
	return nil
}

// FetchBranchFromHost pulls one branch from the host's own .git directly
// into repoPath as a plain local branch of the same name (not a
// remote-tracking ref) — a local (no-network) git fetch by absolute path,
// independent of whatever remotes repoPath has configured.
//
// This is deliberately NOT "rely on the clone's own origin remote already
// having fetched it": configureSandboxGitRemotes (copy.go) reconciles a
// freshly cloned sandbox's remotes to mirror the real project's configured
// remotes, removing the clone's own transient "origin" when the real
// project has none — which deletes that remote's tracking refs as a side
// effect. Fetching explicitly by path here has no such dependency.
func FetchBranchFromHost(ctx context.Context, repoPath, hostPath, branch string) error {
	if output, err := runGit(ctx, repoPath, "fetch", "-q", "--no-tags", "--", hostPath, branch+":"+branch); err != nil {
		return fmt.Errorf("fetch branch %s from host: %s", branch, output)
	}
	return nil
}

// MergeBranchOnHost merges branch (already pushed into the host's own repo
// by PushBranchToHost) into the host's currently checked-out branch, and
// returns the exact pre-merge HEAD so a failed post-merge verification can
// be reverted with RevertHostMerge. On a real conflict, the merge is
// aborted before returning *MergeConflictError — the host working tree is
// left exactly as it was.
func MergeBranchOnHost(ctx context.Context, hostPath, branch string) (preMergeSHA string, err error) {
	if err := snapshotUncommittedHostState(ctx, hostPath); err != nil {
		return "", err
	}
	preMergeSHA, err = CurrentHeadSHA(ctx, hostPath)
	if err != nil {
		return "", err
	}
	mergeArgs := []string{
		"-c", "user.name=" + gitCommitAuthorName,
		"-c", "user.email=" + gitCommitAuthorEmail,
		"-c", "commit.gpgSign=false",
		"merge", "--no-ff", "--no-edit", branch,
	}
	if output, mergeErr := runGit(ctx, hostPath, mergeArgs...); mergeErr != nil {
		conflicted, conflictErr := runGit(ctx, hostPath, "diff", "--name-only", "--diff-filter=U")
		_, _ = runGit(ctx, hostPath, "merge", "--abort")
		if conflictErr == nil && strings.TrimSpace(conflicted) != "" {
			mergeBase, _ := runGit(ctx, hostPath, "merge-base", preMergeSHA, branch)
			return preMergeSHA, &MergeConflictError{Paths: strings.Fields(conflicted), Branch: branch, HostSHA: preMergeSHA, MergeBaseSHA: mergeBase}
		}
		return preMergeSHA, fmt.Errorf("merge integration branch: %s", output)
	}
	return preMergeSHA, nil
}

// ChangedPathsBetween returns the paths that differ between two commits,
// without touching the working tree. Used to detect whether unrelated
// commits landed on the host between two points in time and, if so, exactly
// which paths they touched — e.g. self-evolution's rollback uses this to
// refuse silently overwriting a file an unrelated integration merge changed
// after the rollback's own pre-transaction baseline.
func ChangedPathsBetween(ctx context.Context, repoPath, fromSHA, toSHA string) ([]string, error) {
	fromSHA = strings.TrimSpace(fromSHA)
	toSHA = strings.TrimSpace(toSHA)
	if fromSHA == "" || toSHA == "" || fromSHA == toSHA {
		return nil, nil
	}
	output, err := runGit(ctx, repoPath, "diff", "--name-only", fromSHA, toSHA)
	if err != nil {
		return nil, fmt.Errorf("diff %s..%s: %s", fromSHA, toSHA, output)
	}
	if strings.TrimSpace(output) == "" {
		return nil, nil
	}
	return strings.Split(strings.TrimSpace(output), "\n"), nil
}

// RevertHostMerge resets the host's checked-out branch back to preMergeSHA.
// Safe because preMergeSHA is always the tip this exact request's own merge
// moved away from, moments earlier — used when post-merge verification
// fails, so the host is never left in a state that failed its own build.
func RevertHostMerge(ctx context.Context, hostPath, preMergeSHA string) error {
	if output, err := runGit(ctx, hostPath, "reset", "--hard", preMergeSHA); err != nil {
		return fmt.Errorf("revert host merge to %s: %s", preMergeSHA, output)
	}
	return nil
}

// ReadFileAtRef returns a path's content as of a specific commit/ref,
// without touching the working tree. Used to build a BASE/CURRENT/RESULT
// conflict capsule from a *MergeConflictError's HostSHA/MergeBaseSHA/Branch
// — no working tree ever needs to be checked out to gather this.
func ReadFileAtRef(ctx context.Context, repoPath, ref, path string) (content string, exists bool, err error) {
	cmd := exec.CommandContext(ctx, "git", "-C", repoPath, "show", ref+":"+path)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			// git show exits non-zero both for "path does not exist at ref"
			// and for a corrupt ref; the former is routine (create/delete
			// side of a conflict) and must not surface as an error.
			return "", false, nil
		}
		return "", false, fmt.Errorf("read %s at %s: %w", path, ref, err)
	}
	return string(output), true, nil
}

// DeleteHostBranch removes an integration branch from the host repo once it
// has been successfully merged — the merge commit itself remains in the
// host's log regardless; only the now-redundant branch ref is removed.
func DeleteHostBranch(ctx context.Context, hostPath, branch string) error {
	if output, err := runGit(ctx, hostPath, "branch", "-D", branch); err != nil {
		return fmt.Errorf("delete integration branch %s: %s", branch, output)
	}
	return nil
}
