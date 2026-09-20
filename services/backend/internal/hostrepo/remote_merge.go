package hostrepo

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
)

// RemoteBranchMergeResult is a disposable-worktree merge result. It never
// changes the caller's checked-out branch or worktree.
type RemoteBranchMergeResult struct {
	Outcome     string   `json:"outcome"`
	TargetRef   string   `json:"target_ref"`
	SourceRefs  []string `json:"source_refs"`
	CommitSHA   string   `json:"commit_sha,omitempty"`
	PushOutcome string   `json:"push_outcome,omitempty"`
	ConflictRef string   `json:"conflict_ref,omitempty"`
	Paths       []string `json:"paths,omitempty"`
	Detail      string   `json:"detail,omitempty"`
}

func splitRemoteBranchRef(ref string) (remote, branch string, err error) {
	ref = strings.TrimSpace(ref)
	remote, branch, ok := strings.Cut(ref, "/")
	if !ok || remote == "" || branch == "" || strings.HasPrefix(ref, "-") {
		return "", "", errors.New("a remote branch ref is required")
	}
	return remote, branch, nil
}

// MergeRemoteBranches merges one or more remote-tracking refs into a target
// remote-tracking ref in a temporary Git worktree, then fast-forward-pushes the
// resulting commit to the target remote branch. The operator's local checkout
// is never switched or modified.
func MergeRemoteBranches(ctx context.Context, root, targetRef string, sourceRefs []string) (RemoteBranchMergeResult, error) {
	targetRef = strings.TrimSpace(targetRef)
	targetRemote, targetBranch, err := splitRemoteBranchRef(targetRef)
	if err != nil {
		return RemoteBranchMergeResult{}, err
	}
	if len(sourceRefs) == 0 {
		return RemoteBranchMergeResult{}, errors.New("at least one source remote branch is required")
	}
	cleanSources := make([]string, 0, len(sourceRefs))
	for _, ref := range sourceRefs {
		ref = strings.TrimSpace(ref)
		if _, _, refErr := splitRemoteBranchRef(ref); refErr != nil {
			return RemoteBranchMergeResult{}, fmt.Errorf("invalid source %q: %w", ref, refErr)
		}
		if ref == targetRef {
			return RemoteBranchMergeResult{}, errors.New("target branch cannot also be a merge source")
		}
		cleanSources = append(cleanSources, ref)
	}
	sourceRefs = cleanSources

	worktree, err := os.MkdirTemp("", "wharnex-remote-merge-")
	if err != nil {
		return RemoteBranchMergeResult{}, fmt.Errorf("create remote merge workspace: %w", err)
	}
	defer os.RemoveAll(worktree)
	if output, addErr := run(ctx, root, "worktree", "add", "--detach", worktree, targetRef); addErr != nil {
		return RemoteBranchMergeResult{}, fmt.Errorf("prepare remote merge workspace: %s", RedactRemoteURL(output))
	}
	defer func() {
		AbortMerge(ctx, worktree)
		_, _ = run(context.Background(), root, "worktree", "remove", "--force", worktree)
	}()

	outcome := "up_to_date"
	for _, sourceRef := range sourceRefs {
		merge, mergeErr := MergeBranch(ctx, worktree, sourceRef)
		if mergeErr != nil {
			return RemoteBranchMergeResult{}, mergeErr
		}
		if merge.Outcome == MergeOutcomeConflict {
			return RemoteBranchMergeResult{Outcome: "conflict", TargetRef: targetRef, SourceRefs: append([]string(nil), sourceRefs...), ConflictRef: sourceRef, Paths: merge.Paths}, nil
		}
		if merge.Outcome == MergeOutcomeMerged {
			outcome = "merged"
		}
	}
	head, err := run(ctx, worktree, "rev-parse", "HEAD")
	if err != nil {
		return RemoteBranchMergeResult{}, fmt.Errorf("resolve remote merge result: %s", head)
	}
	push, err := PushCommit(ctx, root, targetRemote, targetBranch, head)
	if err != nil {
		return RemoteBranchMergeResult{}, err
	}
	result := RemoteBranchMergeResult{Outcome: outcome, TargetRef: targetRef, SourceRefs: append([]string(nil), sourceRefs...), CommitSHA: head, PushOutcome: string(push.Outcome), Detail: push.Detail}
	if !push.Succeeded() {
		result.Outcome = string(push.Outcome)
	}
	return result, nil
}
