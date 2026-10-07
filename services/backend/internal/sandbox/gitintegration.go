package sandbox

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/gitops"
	"kernl.local/harness/backend/internal/hostrepo"
)

// gitCommitAuthor* are reserved for Wharnex-internal synthetic commits such
// as request-base snapshots. User-visible integration commits resolve their
// identity through hostrepo.CommitIdentity instead of reusing these values.
const (
	gitCommitAuthorName  = "Wharnex"
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
	return gitops.Combined(ctx, dir, args...)
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
func CommitVerifiedPatch(ctx context.Context, workspacePath, branch, message string, paths []string, identities ...hostrepo.CommitIdentity) (commitSHA string, err error) {
	// This function is called only after the candidate patch and every declared
	// verification gate have succeeded against this exact workspace. Therefore
	// an empty staged diff is a valid idempotent outcome (for example, a focused
	// conflict resolution whose bytes are already present after replay), not
	// evidence that verification failed. Allow the empty commit up front instead
	// of first relying on Git's human-readable, locale-dependent no-op message.
	return commitVerifiedPatch(ctx, workspacePath, branch, message, paths, true, identityOrDefault(identities))
}

// CommitVerifiedPatchAllowEmpty is retained as the explicit compatibility
// entry point for legacy callers. Verified commits are idempotent by default,
// so both entry points now share the same traceable empty-commit behavior.
func CommitVerifiedPatchAllowEmpty(ctx context.Context, workspacePath, branch, message string, paths []string, identities ...hostrepo.CommitIdentity) (commitSHA string, err error) {
	return commitVerifiedPatch(ctx, workspacePath, branch, message, paths, true, identityOrDefault(identities))
}

func commitVerifiedPatch(ctx context.Context, workspacePath, branch, message string, paths []string, allowEmpty bool, identity hostrepo.CommitIdentity) (commitSHA string, err error) {
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
	return commitStagedVerifiedPatch(ctx, workspacePath, message, allowEmpty, identity)
}

// commitStagedVerifiedPatch records an already-staged, already-verified patch.
//
// It is the single implementation of this step for every candidate, whether
// its branch was just created here or was already rooted at the request base
// by CheckoutRequestBase (see CommitBaseRootedPatch). Carrying two copies is
// what let a fix applied to one of them leave the other — the base-rooted
// path, which is the normal path for every new request — still failing.
func commitStagedVerifiedPatch(ctx context.Context, workspacePath, message string, allowEmpty bool, identities ...hostrepo.CommitIdentity) (string, error) {
	identity := identityOrDefault(identities)
	commitArgs := []string{
		"-c", "user.name=" + identity.Name,
		"-c", "user.email=" + identity.Email,
		"-c", "commit.gpgSign=false",
		"commit", "-q",
	}
	if allowEmpty {
		commitArgs = append(commitArgs, "--allow-empty")
	}
	commitArgs = append(commitArgs, "-m", message)
	output, commitErr := runGit(ctx, workspacePath, commitArgs...)
	if commitErr != nil && !allowEmpty && isNothingToCommitOutput(output) {
		// A base-rooted replay can legitimately stage bytes already present on
		// its request base. Record that verified candidate as an empty commit
		// instead of discarding it because Git reported a benign no-op.
		output, commitErr = runGit(ctx, workspacePath, append(commitArgs, "--allow-empty")...)
	}
	if commitErr != nil {
		return "", fmt.Errorf("commit verified changes: %s", output)
	}
	sha, err := CurrentHeadSHA(ctx, workspacePath)
	if err != nil {
		return "", fmt.Errorf("resolve integration commit: %w", err)
	}
	return sha, nil
}

func isNothingToCommitOutput(output string) bool {
	return strings.Contains(output, "nothing to commit") || strings.Contains(output, "no changes added to commit")
}

func identityOrDefault(identities []hostrepo.CommitIdentity) hostrepo.CommitIdentity {
	if len(identities) > 0 {
		return identities[0].Normalized()
	}
	return hostrepo.DefaultCommitIdentity()
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

// hostSnapshotMessage labels the commit that preserves an operator's
// uncommitted host work before an integration merges on top of it.
const hostSnapshotMessage = "Wharnex host snapshot before integration"

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

// CommitSummary is one integrated change's own description of what it was
// for. Subject is the planner-authored Conventional Commits line the protocol
// already requires on every change plan (see AI_PROTOCOL "Commit-history
// communication"). Body and RequestID retain bounded provenance that can link a
// Wharnex commit back to the durable user request without guessing.
type CommitSummary struct {
	SHA       string
	Subject   string
	Body      string
	RequestID string
}

// CommitsTouching lists the commits reachable from toSHA but not fromSHA that
// modified any of the given paths, newest first.
//
// This is what turns a conflict capsule from "here are three versions of a
// file" into "here is what the change you are colliding with was trying to
// achieve". Resolving a conflict semantically requires knowing the other
// side's purpose, and for a Wharnex-integrated change that purpose is already
// recorded — as the commit message the protocol obliges the planner to write.
func CommitsTouching(ctx context.Context, repoPath, fromSHA, toSHA string, paths []string) ([]CommitSummary, error) {
	fromSHA = strings.TrimSpace(fromSHA)
	toSHA = strings.TrimSpace(toSHA)
	if toSHA == "" || len(paths) == 0 {
		return nil, nil
	}
	rangeSpec := toSHA
	if fromSHA != "" && fromSHA != toSHA {
		rangeSpec = fromSHA + ".." + toSHA
	}
	args := append([]string{"log", "--no-merges", "--format=%H%x1f%s%x1f%b%x1e", "--max-count=20", rangeSpec, "--"}, paths...)
	output, err := runGit(ctx, repoPath, args...)
	if err != nil {
		return nil, fmt.Errorf("list commits touching %s: %s", strings.Join(paths, ", "), output)
	}
	summaries := make([]CommitSummary, 0)
	for _, record := range strings.Split(output, "\x1e") {
		record = strings.TrimSpace(record)
		if record == "" {
			continue
		}
		parts := strings.SplitN(record, "\x1f", 3)
		if len(parts) < 2 {
			continue
		}
		body := ""
		if len(parts) == 3 {
			body = strings.TrimSpace(parts[2])
		}
		summaries = append(summaries, CommitSummary{
			SHA: strings.TrimSpace(parts[0]), Subject: strings.TrimSpace(parts[1]), Body: body,
			RequestID: commitTrailer(body, "Request-Id"),
		})
	}
	return summaries, nil
}

func commitTrailer(body, key string) string {
	prefix := strings.ToLower(strings.TrimSpace(key)) + ":"
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if len(line) <= len(prefix) || !strings.EqualFold(line[:len(prefix)], prefix) {
			continue
		}
		return strings.TrimSpace(line[len(prefix):])
	}
	return ""
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

// CommitDiff returns a verified integration commit's own change as a raw
// unified diff, taken against its first parent.
//
// It exists for the one case the Git-native integration path cannot use a
// merge: a verification sandbox rebuilt from an immutable archived request
// base has a synthetic root commit and therefore shares NO ancestry with the
// host. Fetching a pending candidate's branch into such a workspace and
// merging it fails with "refusing to merge unrelated histories" — a real
// production failure that stranded a session in an unrecoverable repair loop.
// Replaying that candidate as its own diff reproduces the same content
// without requiring a common ancestor.
//
// A root commit (no parent) is diffed against the empty tree, so a repository
// whose only commit is the candidate still replays correctly.
func CommitDiff(ctx context.Context, repoPath, commitSHA string) (string, error) {
	return CommitDiffPaths(ctx, repoPath, commitSHA, nil)
}

// CommitDiffPaths is CommitDiff restricted to an exact allowlist of project
// paths. It is used when a focused conflict bundle supersedes only the
// colliding portion of an earlier Git-native candidate: all other verified
// files remain part of the cumulative candidate, but the conflicting files
// must not be replayed a second time underneath their replacement.
func CommitDiffPaths(ctx context.Context, repoPath, commitSHA string, paths []string) (string, error) {
	commitSHA = strings.TrimSpace(commitSHA)
	if commitSHA == "" {
		return "", errors.New("commit sha is required")
	}
	args := []string{"-C", repoPath, "show", "--format=", "--no-color", "--patch", "--first-parent", commitSHA}
	if len(paths) > 0 {
		args = append(args, "--")
		for _, path := range paths {
			clean := filepath.ToSlash(filepath.Clean(strings.TrimSpace(path)))
			if clean == "." || clean != strings.TrimSpace(path) || filepath.IsAbs(path) || strings.HasPrefix(clean, "../") || strings.Contains(path, "\\") {
				return "", fmt.Errorf("invalid commit diff path %q", path)
			}
			args = append(args, clean)
		}
	}
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return "", fmt.Errorf("read commit %s as diff: %s", commitSHA, strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("read commit %s as diff: %w", commitSHA, err)
	}
	return string(output), nil
}

// CommitIsAncestorOfHead reports whether a commit is already contained in the
// repository's current HEAD.
//
// This is what makes Apply idempotent. A candidate whose integration commit is
// already an ancestor of HEAD has nothing left to integrate: merging it again
// is a no-op at best, and at worst — for a self-evolution candidate — it
// re-runs a full host rebuild for work the host already carries. A real chat
// stalled exactly there: its merge had succeeded, the rebuild that follows was
// OOM-killed, and the candidate stayed pending forever, so every later Apply
// would have repeated the same expensive no-op.
func CommitIsAncestorOfHead(ctx context.Context, repoPath, commitSHA string) bool {
	commitSHA = strings.TrimSpace(commitSHA)
	if commitSHA == "" || !HasCommit(ctx, repoPath, commitSHA) {
		return false
	}
	_, err := runGit(ctx, repoPath, "merge-base", "--is-ancestor", commitSHA, "HEAD")
	return err == nil
}

// ResolveRef returns the commit a ref currently points at.
//
// A conflict record outlives the branch that produced it — a superseded
// candidate's integration branch is deleted on retirement — so a path's RESULT
// version must be remembered as a commit, never as a branch name that will
// stop resolving.
func ResolveRef(ctx context.Context, repoPath, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", errors.New("a ref is required")
	}
	output, err := runGit(ctx, repoPath, "rev-parse", "--verify", "-q", ref+"^{commit}")
	if err != nil {
		return "", fmt.Errorf("resolve ref %s: %s", ref, output)
	}
	return output, nil
}

// HasCommit reports whether repoPath's object database contains commitSHA.
// Used to decide whether a pending candidate can be replayed from the host's
// own history at all before attempting either integration strategy.
func HasCommit(ctx context.Context, repoPath, commitSHA string) bool {
	if strings.TrimSpace(commitSHA) == "" {
		return false
	}
	_, err := runGit(ctx, repoPath, "cat-file", "-e", commitSHA+"^{commit}")
	return err == nil
}
