package hostrepo

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
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
	// BlockedIndexLocked: another Git process holds the repository index, or a
	// crashed one left its lock behind.
	BlockedIndexLocked BlockedReason = "index_locked"
)

// IndexLockBlocked classifies a Git failure caused by the repository index
// lock, returning nil for any other failure.
//
// It exists because this condition is indistinguishable, to every layer above,
// from a defect in the generated change — and it is the opposite of one. No
// patch a planner can write will remove a lock file, so letting it fall through
// to the generic error path spends an automatic AI repair round on a question
// the planner cannot be asked, and the next Apply reproduces it exactly. It
// belongs with the other host working-tree refusals: name the condition, name
// the file, name the action that clears it, and keep the verified candidate.
//
// The lock's age is reported because it is what decides the operator's action.
// A lock a few seconds old is a real concurrent Git process and the answer is
// to wait; one hours old is a crashed process's leftover and the answer is to
// delete it. Git's own message cannot tell them apart.
func IndexLockBlocked(ctx context.Context, root, output string) *BlockedError {
	lowered := strings.ToLower(output)
	if !strings.Contains(lowered, "index.lock") && !strings.Contains(lowered, "another git process seems to be running") {
		return nil
	}
	lockPath := filepath.Join(root, ".git", "index.lock")
	if topology, err := Inspect(ctx, root); err == nil && topology.GitDir != "" {
		lockPath = filepath.Join(topology.GitDir, "index.lock")
	}
	detail := "another Git process holds this repository's index lock"
	remedy := "wait for that process to finish and apply again"
	if info, err := os.Stat(lockPath); err == nil {
		age := time.Since(info.ModTime()).Round(time.Second)
		detail = fmt.Sprintf("the repository index is locked (lock created %s ago)", age)
		if age > staleIndexLockAge {
			detail += "; no Git command should hold it for that long, so it is most likely left over from a process that crashed"
			remedy = "confirm no Git process is running against this repository, then remove " + lockPath + " and apply again"
		}
	}
	return &BlockedError{
		Reason: BlockedIndexLocked,
		Detail: detail,
		Paths:  []string{lockPath},
		Remedy: remedy,
	}
}

// staleIndexLockAge is the point past which an index lock is reported as a
// probable crash leftover rather than live contention. Wharnex never removes it
// itself: deleting a lock a live process still holds corrupts that process's
// write, and the operator is the only one who can tell.
const staleIndexLockAge = 5 * time.Minute

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
	preservation := Preservation{
		LeftInPlace:     state.EmbeddedRepositories,
		DirtySubmodules: state.DirtySubmodules,
	}
	if !state.Committable() {
		return preservation, nil
	}
	preservation.StagedPaths = append(append([]string(nil), state.Stageable...), state.GitlinkChanges...)
	if output, err := run(ctx, root, StageArgs(state.EmbeddedRepositories)...); err != nil {
		if blocked := IndexLockBlocked(ctx, root, output); blocked != nil {
			return Preservation{}, blocked
		}
		return Preservation{}, fmt.Errorf("stage host working tree before integration: %s", output)
	}
	commitArgs := append(internalCommitArgs(topology), "commit", "-q", "--no-verify", "-m", message)
	if output, err := run(ctx, root, commitArgs...); err != nil {
		// The classification above says a commit should capture something, but
		// the worktree is live: an operator can revert their own edit between
		// the status read and the commit. An empty commit is then correct and
		// unremarkable, not a reason to abort the operator's Apply.
		if !strings.Contains(output, "nothing to commit") && !strings.Contains(output, "no changes added to commit") {
			if blocked := IndexLockBlocked(ctx, root, output); blocked != nil {
				return Preservation{}, blocked
			}
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
