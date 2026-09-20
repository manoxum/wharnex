package hostrepo

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
)

// RemoteMergeResolutionWorkspace is a disposable detached worktree used to
// replay an isolated remote-target merge while a human/GPT resolution patch is
// applied. The caller must always CleanupRemoteMergeResolution.
type RemoteMergeResolutionWorkspace struct {
	Path             string
	TargetRef        string
	TargetRemote     string
	TargetBranch     string
	SourceRefs       []string
	ConflictRef      string
	RemainingSources []string
}

func PrepareRemoteMergeResolution(ctx context.Context, root, targetRef string, sourceRefs []string, conflictRef string, conflictPaths []string, identities ...CommitIdentity) (RemoteMergeResolutionWorkspace, error) {
	targetRef = strings.TrimSpace(targetRef)
	conflictRef = strings.TrimSpace(conflictRef)
	remote, branch, err := splitRemoteBranchRef(targetRef)
	if err != nil {
		return RemoteMergeResolutionWorkspace{}, err
	}
	if conflictRef == "" {
		return RemoteMergeResolutionWorkspace{}, errors.New("remote merge conflict ref is required")
	}
	worktree, err := os.MkdirTemp("", "wharnex-remote-resolution-")
	if err != nil {
		return RemoteMergeResolutionWorkspace{}, fmt.Errorf("create remote resolution workspace: %w", err)
	}
	cleanup := func() {
		AbortMerge(context.Background(), worktree)
		_, _ = run(context.Background(), root, "worktree", "remove", "--force", worktree)
		_ = os.RemoveAll(worktree)
	}
	if output, addErr := run(ctx, root, "worktree", "add", "--detach", worktree, targetRef); addErr != nil {
		cleanup()
		return RemoteMergeResolutionWorkspace{}, fmt.Errorf("prepare remote resolution workspace: %s", RedactRemoteURL(output))
	}
	found := false
	remaining := []string{}
	for index, sourceRef := range sourceRefs {
		sourceRef = strings.TrimSpace(sourceRef)
		if sourceRef == conflictRef {
			found = true
			if err := BeginMergeResolution(ctx, worktree, sourceRef, conflictPaths); err != nil {
				cleanup()
				return RemoteMergeResolutionWorkspace{}, err
			}
			remaining = append(remaining, sourceRefs[index+1:]...)
			break
		}
		merge, mergeErr := MergeBranch(ctx, worktree, sourceRef, identities...)
		if mergeErr != nil {
			cleanup()
			return RemoteMergeResolutionWorkspace{}, mergeErr
		}
		if merge.Outcome == MergeOutcomeConflict {
			cleanup()
			return RemoteMergeResolutionWorkspace{}, fmt.Errorf("remote merge now conflicts earlier on %s", sourceRef)
		}
	}
	if !found {
		cleanup()
		return RemoteMergeResolutionWorkspace{}, fmt.Errorf("conflict ref %s is not in the remote merge source set", conflictRef)
	}
	return RemoteMergeResolutionWorkspace{Path: worktree, TargetRef: targetRef, TargetRemote: remote, TargetBranch: branch, SourceRefs: append([]string(nil), sourceRefs...), ConflictRef: conflictRef, RemainingSources: remaining}, nil
}

func CleanupRemoteMergeResolution(root string, workspace RemoteMergeResolutionWorkspace) {
	if strings.TrimSpace(workspace.Path) == "" {
		return
	}
	AbortMerge(context.Background(), workspace.Path)
	_, _ = run(context.Background(), root, "worktree", "remove", "--force", workspace.Path)
	_ = os.RemoveAll(workspace.Path)
}

// FinishRemoteMergeResolution continues the original ordered source list after
// the resolved conflict and pushes the final detached HEAD to the target. A
// second independent conflict is reported without publishing a partial merge;
// the operator can retry with a narrower source set if necessary.
func FinishRemoteMergeResolution(ctx context.Context, root string, workspace RemoteMergeResolutionWorkspace, identities ...CommitIdentity) (RemoteBranchMergeResult, error) {
	for _, sourceRef := range workspace.RemainingSources {
		merge, err := MergeBranch(ctx, workspace.Path, sourceRef, identities...)
		if err != nil {
			return RemoteBranchMergeResult{}, err
		}
		if merge.Outcome == MergeOutcomeConflict {
			return RemoteBranchMergeResult{}, fmt.Errorf("an additional conflict occurred while merging %s; no remote update was published", sourceRef)
		}
	}
	head, err := run(ctx, workspace.Path, "rev-parse", "HEAD")
	if err != nil {
		return RemoteBranchMergeResult{}, fmt.Errorf("resolve remote merge result: %s", head)
	}
	push, err := PushCommit(ctx, root, workspace.TargetRemote, workspace.TargetBranch, head)
	if err != nil {
		return RemoteBranchMergeResult{}, err
	}
	result := RemoteBranchMergeResult{Outcome: "merged", TargetRef: workspace.TargetRef, SourceRefs: append([]string(nil), workspace.SourceRefs...), CommitSHA: head, PushOutcome: string(push.Outcome), Detail: push.Detail}
	if !push.Succeeded() {
		result.Outcome = string(push.Outcome)
	}
	return result, nil
}
