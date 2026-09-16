package app

import (
	"context"
	"fmt"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
)

// GitPushResult reports a push, including the case where the remote had work
// that had to be integrated first.
type GitPushResult struct {
	Outcome string `json:"outcome"`
	Remote  string `json:"remote"`
	Branch  string `json:"branch"`
	Detail  string `json:"detail,omitempty"`
	// Integrated is true when the remote's work was merged locally before a
	// second, successful push attempt.
	Integrated bool `json:"integrated,omitempty"`
	// ConflictID is set when integrating the remote's work conflicted and a
	// planner resolution was requested.
	ConflictID string `json:"conflict_id,omitempty"`
}

// PushBranch sends a branch to a remote on the operator's explicit instruction.
//
// A rejected push is not a failure to report and stop at: it means the remote
// holds commits this branch does not, which is an ordinary merge. Wharnex
// fetches, merges, and pushes again — and when that merge conflicts, routes it
// to the same bounded planner resolution a Wharnex integration conflict uses.
//
// It never force-pushes and never pushes again on its own after an
// AI-assisted resolution: publishing reconciled code is the operator's call,
// made once they have seen the merge commit.
func (s *Service) PushBranch(ctx context.Context, sessionID, remote, branch string, setUpstream bool) (GitPushResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitPushResult{}, err
	}
	lock := s.projectApplyLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()

	s.bus.Publish(sessionID, "git.push_started", map[string]any{"remote": remote, "branch": branch})
	push, err := hostrepo.Push(ctx, item.ProjectPath, remote, branch, setUpstream)
	if err != nil {
		return GitPushResult{}, err
	}
	result := GitPushResult{Outcome: string(push.Outcome), Remote: push.Remote, Branch: push.Branch, Detail: push.Detail}
	if push.Outcome != hostrepo.PushOutcomeRejected {
		s.bus.Publish(sessionID, "git.push_completed", map[string]any{"remote": remote, "branch": branch, "outcome": string(push.Outcome)})
		return result, nil
	}

	if err := hostrepo.Fetch(ctx, item.ProjectPath, remote); err != nil {
		result.Detail = err.Error()
		return result, nil
	}
	trackingRef := remote + "/" + branch
	merge, mergeErr := hostrepo.MergeBranch(ctx, item.ProjectPath, trackingRef)
	if mergeErr != nil {
		result.Detail = mergeErr.Error()
		return result, nil
	}
	if merge.Outcome == hostrepo.MergeOutcomeConflict {
		updated, conflictID, prepareErr := s.prepareGitConflictResolution(ctx, sessionID, item, gitConflictRequest{
			origin: domain.GitConflictOriginPush, ref: trackingRef, remote: remote, remoteBranch: branch,
			targetBranch: branch, sides: merge.Sides, paths: merge.Paths,
		})
		if prepareErr != nil {
			return result, prepareErr
		}
		_ = updated
		result.Outcome = "conflict"
		result.ConflictID = conflictID
		return result, nil
	}

	result.Integrated = true
	retry, err := hostrepo.Push(ctx, item.ProjectPath, remote, branch, setUpstream)
	if err != nil {
		return result, err
	}
	result.Outcome, result.Detail = string(retry.Outcome), retry.Detail
	s.bus.Publish(sessionID, "git.push_completed", map[string]any{"remote": remote, "branch": branch, "outcome": string(retry.Outcome), "integrated": true})
	return result, nil
}

// GitMergeResult reports an explicit branch merge.
type GitMergeResult struct {
	Outcome    string   `json:"outcome"`
	Ref        string   `json:"ref"`
	CommitSHA  string   `json:"commit_sha,omitempty"`
	Paths      []string `json:"paths,omitempty"`
	ConflictID string   `json:"conflict_id,omitempty"`
}

// MergeBranchIntoCurrent merges another branch into the checked-out one on the
// operator's explicit instruction, routing a conflict to planner resolution.
func (s *Service) MergeBranchIntoCurrent(ctx context.Context, sessionID, ref string) (GitMergeResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitMergeResult{}, err
	}
	lock := s.projectApplyLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()

	s.bus.Publish(sessionID, "git.merge_started", map[string]any{"ref": ref})
	merge, err := hostrepo.MergeBranch(ctx, item.ProjectPath, ref)
	if err != nil {
		return GitMergeResult{}, err
	}
	result := GitMergeResult{Outcome: string(merge.Outcome), Ref: ref, CommitSHA: merge.CommitSHA, Paths: merge.Paths}
	if merge.Outcome != hostrepo.MergeOutcomeConflict {
		s.bus.Publish(sessionID, "git.merge_completed", map[string]any{"ref": ref, "outcome": string(merge.Outcome)})
		return result, nil
	}
	_, conflictID, prepareErr := s.prepareGitConflictResolution(ctx, sessionID, item, gitConflictRequest{
		origin: domain.GitConflictOriginBranchMerge, ref: ref,
		targetBranch: hostrepo.CurrentBranch(ctx, item.ProjectPath), sides: merge.Sides, paths: merge.Paths,
	})
	if prepareErr != nil {
		return result, prepareErr
	}
	result.ConflictID = conflictID
	return result, nil
}

// GitBranchActionResult reports local branch synchronization actions.
type GitBranchActionResult struct {
	Outcome    string   `json:"outcome"`
	Remote     string   `json:"remote,omitempty"`
	Branch     string   `json:"branch,omitempty"`
	Ref        string   `json:"ref,omitempty"`
	CommitSHA  string   `json:"commit_sha,omitempty"`
	Paths      []string `json:"paths,omitempty"`
	ConflictID string   `json:"conflict_id,omitempty"`
}

// FetchRemote refreshes one remote without changing the current branch.
func (s *Service) FetchRemote(ctx context.Context, sessionID, remote string) (GitBranchActionResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitBranchActionResult{}, err
	}
	lock := s.projectApplyLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	if err := hostrepo.Fetch(ctx, item.ProjectPath, remote); err != nil {
		return GitBranchActionResult{}, err
	}
	s.bus.Publish(sessionID, "git.fetch_completed", map[string]any{"remote": remote})
	return GitBranchActionResult{Outcome: "fetched", Remote: remote}, nil
}

// SwitchBranch changes to an existing local branch. Wharnex refuses to switch
// across uncommitted work so the branch picker cannot silently carry edits to
// another line of development.
func (s *Service) SwitchBranch(ctx context.Context, sessionID, branch string) (GitBranchActionResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitBranchActionResult{}, err
	}
	lock := s.projectApplyLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	state, err := hostrepo.Working(ctx, item.ProjectPath)
	if err != nil {
		return GitBranchActionResult{}, err
	}
	if !state.Clean() {
		return GitBranchActionResult{}, fmt.Errorf("commit or discard local changes before switching branches")
	}
	branches, err := hostrepo.Branches(ctx, item.ProjectPath)
	if err != nil {
		return GitBranchActionResult{}, err
	}
	found := false
	for _, candidate := range branches {
		if candidate.Remote == "" && candidate.Name == branch {
			found = true
			break
		}
	}
	if !found {
		return GitBranchActionResult{}, fmt.Errorf("unknown local branch %q", branch)
	}
	if hostrepo.CurrentBranch(ctx, item.ProjectPath) == branch {
		return GitBranchActionResult{Outcome: "unchanged", Branch: branch}, nil
	}
	if err := hostrepo.SwitchBranch(ctx, item.ProjectPath, branch); err != nil {
		return GitBranchActionResult{}, err
	}
	s.bus.Publish(sessionID, "git.branch_switched", map[string]any{"branch": branch})
	return GitBranchActionResult{Outcome: "switched", Branch: branch}, nil
}

// PullBranch fetches then merges the selected remote branch into the checked
// out local branch. A content conflict is converted to Wharnex's existing
// three-way conflict workspace rather than leaving Git in a conflicted state.
func (s *Service) PullBranch(ctx context.Context, sessionID, remote, branch string) (GitBranchActionResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitBranchActionResult{}, err
	}
	lock := s.projectApplyLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	current := hostrepo.CurrentBranch(ctx, item.ProjectPath)
	if current == "" || current != branch {
		return GitBranchActionResult{}, fmt.Errorf("pull is available only for the checked-out branch")
	}
	if err := hostrepo.Fetch(ctx, item.ProjectPath, remote); err != nil {
		return GitBranchActionResult{}, err
	}
	ref := remote + "/" + branch
	merge, err := hostrepo.MergeBranch(ctx, item.ProjectPath, ref)
	if err != nil {
		return GitBranchActionResult{}, err
	}
	result := GitBranchActionResult{Outcome: string(merge.Outcome), Remote: remote, Branch: branch, Ref: ref, CommitSHA: merge.CommitSHA, Paths: merge.Paths}
	if merge.Outcome != hostrepo.MergeOutcomeConflict {
		s.bus.Publish(sessionID, "git.pull_completed", map[string]any{"remote": remote, "branch": branch, "outcome": string(merge.Outcome)})
		return result, nil
	}
	_, conflictID, prepareErr := s.prepareGitConflictResolution(ctx, sessionID, item, gitConflictRequest{
		origin: domain.GitConflictOriginPull, ref: ref, remote: remote, remoteBranch: branch,
		targetBranch: branch, sides: merge.Sides, paths: merge.Paths,
	})
	if prepareErr != nil {
		return result, prepareErr
	}
	result.ConflictID = conflictID
	return result, nil
}
