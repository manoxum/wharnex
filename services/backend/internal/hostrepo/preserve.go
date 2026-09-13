package hostrepo

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
)

// BlockedReason is the closed set of host working-tree conditions under which
// Wharnex must refuse to snapshot and merge rather than proceed.
//
// Each of these was previously handled by proceeding anyway, and each produced
// a worse outcome than refusing: committing the operator's conflict markers as
// if resolved, recording a pointer instead of their untracked files, or
// merging a submodule pointer out from under their in-progress work.
type BlockedReason string

const (
	// BlockedOperationInProgress: an unfinished merge/rebase/cherry-pick/am.
	BlockedOperationInProgress BlockedReason = "operation_in_progress"
	// BlockedUnmergedPaths: the index holds unresolved conflict stages.
	BlockedUnmergedPaths BlockedReason = "unmerged_paths"
	// BlockedDirtySubmoduleGitlink: an integration would move the recorded
	// commit of a submodule whose own worktree has uncommitted work.
	BlockedDirtySubmoduleGitlink BlockedReason = "dirty_submodule_gitlink_change"
	// BlockedUnbornHead: the repository has no commit to parent onto.
	BlockedUnbornHead BlockedReason = "unborn_head"
)

// BlockedError reports a host state Wharnex deliberately refuses to mutate.
// It carries the paths involved and the concrete operator action that clears
// it, because the whole point of refusing is that the operator can fix it —
// unlike the silent corruption that proceeding used to cause.
type BlockedError struct {
	Reason BlockedReason
	Detail string
	Paths  []string
	Remedy string
}

func (e *BlockedError) Error() string {
	message := fmt.Sprintf("host working tree is not safe to integrate into (%s): %s", e.Reason, e.Detail)
	if len(e.Paths) > 0 {
		message += ": " + strings.Join(e.Paths, ", ")
	}
	if e.Remedy != "" {
		message += "; " + e.Remedy
	}
	return message
}

// Preservation records what a snapshot actually captured, so a caller can
// report the truth instead of assuming the host tree is now clean.
type Preservation struct {
	// Committed is false when there was nothing a commit could capture. This
	// is a normal outcome, not a failure: a worktree whose only dirt lives
	// inside a submodule has nothing the superproject can commit.
	Committed bool
	// CommitSHA is the snapshot commit, empty when Committed is false.
	CommitSHA string
	// StagedPaths lists what the snapshot captured.
	StagedPaths []string
	// LeftInPlace lists embedded repositories deliberately excluded from the
	// snapshot. Their files stay exactly where they are, untracked; staging
	// them would have recorded a gitlink and lost their content.
	LeftInPlace []string
	// DirtySubmodules lists submodules holding uncommitted content the
	// superproject cannot capture. They are untouched by the integration.
	DirtySubmodules []string
}

// Preserve captures whatever of the host's uncommitted state a superproject
// commit can genuinely hold, and refuses outright when the state is one where
// committing would damage the operator's work.
//
// It never fails merely because there is nothing to commit. That case — a
// worktree Git reports as modified but whose entire dirt is submodule content
// — is the one that made every Apply on such a project fail permanently, since
// `git commit` exits non-zero with "no changes added to commit" and nothing in
// the flow could ever clear the condition.
func Preserve(ctx context.Context, root, message string) (Preservation, error) {
	return PreserveExcept(ctx, root, message, nil)
}

// PreserveExcept is Preserve with paths the snapshot must not capture.
//
// It exists for one case, and that case is load bearing. A unit-aware
// integration merges the submodules first, which moves their gitlinks in the
// superproject; the superproject's own snapshot then ran a moment later and
// dutifully committed those moved pointers as though they were the operator's
// uncommitted work. That is wrong twice over: it writes a Wharnex bookkeeping
// commit into the operator's history describing a change Wharnex had just made
// itself, and it moves the rollback boundary past it, so a revert could not
// return the superproject to where it started (adr/ADR-0050).
func PreserveExcept(ctx context.Context, root, message string, excluded []string) (Preservation, error) {
	topology, err := Inspect(ctx, root)
	if err != nil {
		return Preservation{}, err
	}
	if !topology.HeadBorn {
		return Preservation{}, &BlockedError{
			Reason: BlockedUnbornHead,
			Detail: "the project repository has no commit yet",
			Remedy: "create an initial commit before Protected host integration",
		}
	}
	if topology.InProgress != OperationNone {
		return Preservation{}, &BlockedError{
			Reason: BlockedOperationInProgress,
			Detail: fmt.Sprintf("a %s is in progress", topology.InProgress),
			Remedy: fmt.Sprintf("finish or abort the %s (git %s --abort) and apply again", topology.InProgress, topology.InProgress),
		}
	}
	state, err := Working(ctx, root)
	if err != nil {
		return Preservation{}, err
	}
	if len(state.Unmerged) > 0 {
		return Preservation{}, &BlockedError{
			Reason: BlockedUnmergedPaths,
			Detail: "the index holds unresolved conflicts, which a snapshot would commit as if they were resolved",
			Paths:  state.Unmerged,
			Remedy: "resolve or reset those paths and apply again",
		}
	}
	state = state.without(excluded)
	preservation := Preservation{
		LeftInPlace:     state.EmbeddedRepositories,
		DirtySubmodules: state.DirtySubmodules,
	}
	if !state.Committable() {
		return preservation, nil
	}
	preservation.StagedPaths = append(append([]string(nil), state.Stageable...), state.GitlinkChanges...)
	if output, err := run(ctx, root, StageArgs(append(append([]string(nil), state.EmbeddedRepositories...), excluded...))...); err != nil {
		return Preservation{}, fmt.Errorf("stage host working tree before integration: %s", output)
	}
	commitArgs := append(internalCommitArgs(topology), "commit", "-q", "--no-verify", "-m", message)
	if output, err := run(ctx, root, commitArgs...); err != nil {
		// The classification above says a commit should capture something, but
		// the worktree is live: an operator can revert their own edit between
		// the status read and the commit. An empty commit is then correct and
		// unremarkable, not a reason to abort the operator's Apply.
		if !strings.Contains(output, "nothing to commit") && !strings.Contains(output, "no changes added to commit") {
			return Preservation{}, fmt.Errorf("commit host working tree before integration: %s", output)
		}
		return preservation, nil
	}
	sha, err := run(ctx, root, "rev-parse", "HEAD")
	if err != nil {
		return Preservation{}, fmt.Errorf("resolve host snapshot commit: %s", sha)
	}
	preservation.Committed = true
	preservation.CommitSHA = sha
	return preservation, nil
}

// StageArgs builds `git add -A` with every embedded repository excluded.
//
// Without the exclusions `git add -A` records an untracked nested repository
// as a gitlink: the commit then claims to preserve the operator's files while
// containing only a pointer to a repository the superproject cannot resolve,
// so the revert that is supposed to restore that work silently cannot.
func StageArgs(embedded []string) []string {
	args := []string{"add", "-A", "--", "."}
	for _, path := range embedded {
		args = append(args, ":(exclude)"+path)
	}
	return args
}

// internalCommitArgs configures a commit Wharnex makes on its own behalf: a
// fixed non-human identity, no signing, and no project hooks.
//
// Hooks matter as much as identity here. This commit is Wharnex's internal
// bookkeeping, not the operator's contribution, so a project's own pre-commit
// lint has no authority over it — and a failing hook would otherwise block
// every host integration on any repository that has one.
func internalCommitArgs(topology Topology) []string {
	return []string{
		"-c", "user.name=" + CommitAuthorName,
		"-c", "user.email=" + CommitAuthorEmail,
		"-c", "commit.gpgSign=false",
		"-c", "core.hooksPath=" + disabledHooksPath(topology),
	}
}

// InternalGitArgs exposes internalCommitArgs to other packages performing
// Wharnex-owned commits and merges on a host repository.
func InternalGitArgs(topology Topology) []string { return internalCommitArgs(topology) }

// disabledHooksPath points core.hooksPath at a location guaranteed not to
// contain hooks. A directory that does not exist disables hooks on every Git
// version, unlike `git merge --no-verify`, which older builds reject outright.
func disabledHooksPath(topology Topology) string {
	base := topology.GitDir
	if base == "" {
		base = topology.Root
	}
	return filepath.Join(base, "wharnex-hooks-disabled")
}

// CommitAuthorName/CommitAuthorEmail is the fixed non-human identity for every
// commit Wharnex makes on a host repository, never the operator's own.
const (
	CommitAuthorName  = "Wharnex"
	CommitAuthorEmail = "wharness@localhost"
)
