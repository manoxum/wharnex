package app

import (
	"context"
	"fmt"
	"strings"

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
	push, err := gitRemotePush(ctx, item.ProjectPath, remote, branch, setUpstream)
	if err != nil {
		return GitPushResult{}, err
	}
	result := GitPushResult{Outcome: string(push.Outcome), Remote: push.Remote, Branch: push.Branch, Detail: push.Detail}
	if push.Outcome != hostrepo.PushOutcomeRejected {
		s.bus.Publish(sessionID, "git.push_completed", map[string]any{"remote": remote, "branch": branch, "outcome": string(push.Outcome)})
		return result, nil
	}

	if err := gitRemoteFetch(ctx, item.ProjectPath, remote); err != nil {
		result.Detail = err.Error()
		return result, nil
	}
	trackingRef := remote + "/" + branch
	merge, mergeErr := hostrepo.MergeBranch(ctx, item.ProjectPath, trackingRef, s.projectCommitIdentity(ctx, item.ProjectPath))
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
	retry, err := gitRemotePush(ctx, item.ProjectPath, remote, branch, setUpstream)
	if err != nil {
		return result, err
	}
	result.Outcome, result.Detail = string(retry.Outcome), retry.Detail
	s.bus.Publish(sessionID, "git.push_completed", map[string]any{"remote": remote, "branch": branch, "outcome": string(retry.Outcome), "integrated": true})
	return result, nil
}

// PushSelectedCommits publishes the oldest contiguous prefix of commits that
// are ahead of the current branch upstream. Git cannot publish an arbitrary
// middle commit to the same branch without also publishing all of its
// ancestors, so the service rejects non-contiguous selections instead of
// pretending that checkbox selection can rewrite remote history.
func (s *Service) PushSelectedCommits(ctx context.Context, sessionID string, commitSHAs []string) (GitPushResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitPushResult{}, err
	}
	lock := s.projectApplyLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()

	branches, err := hostrepo.Branches(ctx, item.ProjectPath)
	if err != nil {
		return GitPushResult{}, err
	}
	active, ok := currentLocalBranch(branches)
	if !ok || !active.HasUpstream || active.Gone {
		return GitPushResult{}, fmt.Errorf("selective push requires a current branch with a valid upstream")
	}
	if active.Ahead <= 0 {
		return GitPushResult{}, fmt.Errorf("there are no commits pending publication")
	}
	remote, remoteBranch := splitUpstream(active.Upstream)
	if remote == "" || remoteBranch == "" {
		return GitPushResult{}, fmt.Errorf("cannot resolve upstream %q", active.Upstream)
	}
	commits, err := hostrepo.Unpushed(ctx, item.ProjectPath, active.Ahead)
	if err != nil {
		return GitPushResult{}, err
	}
	selected := make(map[string]bool, len(commitSHAs))
	for _, sha := range commitSHAs {
		sha = strings.TrimSpace(sha)
		if sha != "" {
			selected[sha] = true
		}
	}
	if len(selected) == 0 {
		return GitPushResult{}, fmt.Errorf("select at least one commit to publish")
	}
	known := make(map[string]bool, len(commits))
	for _, commit := range commits {
		known[commit.SHA] = true
	}
	for sha := range selected {
		if !known[sha] {
			return GitPushResult{}, fmt.Errorf("selected commit %s is no longer pending publication", sha)
		}
	}

	// hostrepo.Unpushed is newest first. The only publishable partial set is a
	// prefix when read oldest first: commit 1, then 2, never only commit 2.
	oldestFirst := make([]hostrepo.Commit, len(commits))
	for index := range commits {
		oldestFirst[len(commits)-1-index] = commits[index]
	}
	count := len(selected)
	if count > len(oldestFirst) {
		return GitPushResult{}, fmt.Errorf("selected commit set is invalid")
	}
	for index, commit := range oldestFirst {
		want := index < count
		if selected[commit.SHA] != want {
			return GitPushResult{}, fmt.Errorf("selective push must choose the oldest contiguous commits")
		}
	}
	target := oldestFirst[count-1]
	s.bus.Publish(sessionID, "git.push_selected_started", map[string]any{"remote": remote, "branch": remoteBranch, "commits": count, "target": target.SHA})
	push, err := gitRemotePushCommit(ctx, item.ProjectPath, remote, remoteBranch, target.SHA)
	if err != nil {
		return GitPushResult{}, err
	}
	result := GitPushResult{Outcome: string(push.Outcome), Remote: push.Remote, Branch: push.Branch, Detail: push.Detail}
	s.bus.Publish(sessionID, "git.push_selected_completed", map[string]any{"remote": remote, "branch": remoteBranch, "commits": count, "outcome": string(push.Outcome)})
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
	merge, err := hostrepo.MergeBranch(ctx, item.ProjectPath, ref, s.projectCommitIdentity(ctx, item.ProjectPath))
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
	if err := gitRemoteFetch(ctx, item.ProjectPath, remote); err != nil {
		return GitBranchActionResult{}, err
	}
	s.bus.Publish(sessionID, "git.fetch_completed", map[string]any{"remote": remote})
	return GitBranchActionResult{Outcome: "fetched", Remote: remote}, nil
}

// SwitchBranch changes to an existing local branch or creates a local tracking
// branch from a selected remote ref. Wharnex refuses to switch across
// uncommitted work so the branch picker cannot silently carry edits to another
// line of development.
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
	var local *hostrepo.Branch
	var remote *hostrepo.Branch
	for i := range branches {
		candidate := &branches[i]
		if candidate.Remote == "" && candidate.Name == branch {
			local = candidate
		}
		if candidate.Remote != "" && candidate.Name == branch {
			remote = candidate
		}
	}
	if local == nil && remote == nil {
		return GitBranchActionResult{}, fmt.Errorf("unknown branch %q", branch)
	}
	if remote != nil {
		if remote.HasCounterpart {
			branch = remote.Counterpart
		} else {
			localName, switchErr := hostrepo.SwitchRemoteBranch(ctx, item.ProjectPath, remote.Name)
			if switchErr != nil {
				return GitBranchActionResult{}, switchErr
			}
			s.bus.Publish(sessionID, "git.branch_switched", map[string]any{"branch": localName, "ref": remote.Name})
			return GitBranchActionResult{Outcome: "tracked", Branch: localName, Ref: remote.Name}, nil
		}
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

// MergeRemoteBranches integrates remote-tracking branches in a disposable
// worktree and publishes only the resulting target ref. The checked-out local
// branch and worktree remain untouched.
func (s *Service) MergeRemoteBranches(ctx context.Context, sessionID, targetRef string, sourceRefs []string) (hostrepo.RemoteBranchMergeResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return hostrepo.RemoteBranchMergeResult{}, err
	}
	lock := s.projectApplyLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	targetRef = strings.TrimSpace(targetRef)
	cleanSources := make([]string, 0, len(sourceRefs))
	seenSources := make(map[string]bool, len(sourceRefs))
	for _, ref := range sourceRefs {
		ref = strings.TrimSpace(ref)
		if ref == "" {
			return hostrepo.RemoteBranchMergeResult{}, fmt.Errorf("remote source is required")
		}
		if ref == targetRef {
			return hostrepo.RemoteBranchMergeResult{}, fmt.Errorf("remote target cannot also be a source")
		}
		if !seenSources[ref] {
			seenSources[ref] = true
			cleanSources = append(cleanSources, ref)
		}
	}
	if len(cleanSources) == 0 {
		return hostrepo.RemoteBranchMergeResult{}, fmt.Errorf("at least one merge source is required")
	}
	sourceRefs = cleanSources
	branches, err := hostrepo.Branches(ctx, item.ProjectPath)
	if err != nil {
		return hostrepo.RemoteBranchMergeResult{}, err
	}
	allRefs := make(map[string]hostrepo.Branch, len(branches))
	for _, branch := range branches {
		allRefs[branch.Name] = branch
	}
	target, ok := allRefs[targetRef]
	if !ok || target.Remote == "" {
		return hostrepo.RemoteBranchMergeResult{}, fmt.Errorf("unknown remote target %q", targetRef)
	}
	remotes := map[string]struct{}{target.Remote: {}}
	for _, ref := range sourceRefs {
		source, exists := allRefs[ref]
		if !exists {
			return hostrepo.RemoteBranchMergeResult{}, fmt.Errorf("unknown merge source %q", ref)
		}
		if source.Remote != "" {
			remotes[source.Remote] = struct{}{}
		}
	}
	for remote := range remotes {
		if err := gitRemoteFetch(ctx, item.ProjectPath, remote); err != nil {
			return hostrepo.RemoteBranchMergeResult{}, err
		}
	}
	// Fetch may prune remote refs, so validate the selected set again. Local
	// sources remain valid without being forced through a remote-only map.
	refreshed, err := hostrepo.Branches(ctx, item.ProjectPath)
	if err != nil {
		return hostrepo.RemoteBranchMergeResult{}, err
	}
	available := make(map[string]hostrepo.Branch, len(refreshed))
	for _, branch := range refreshed {
		available[branch.Name] = branch
	}
	if current, exists := available[targetRef]; !exists || current.Remote == "" {
		return hostrepo.RemoteBranchMergeResult{}, fmt.Errorf("remote target %q no longer exists after fetch", targetRef)
	}
	for _, ref := range sourceRefs {
		if _, exists := available[ref]; !exists {
			return hostrepo.RemoteBranchMergeResult{}, fmt.Errorf("merge source %q no longer exists after fetch", ref)
		}
	}
	candidates, err := hostrepo.MergeCandidates(ctx, item.ProjectPath, targetRef)
	if err != nil {
		return hostrepo.RemoteBranchMergeResult{}, err
	}
	eligible := make(map[string]bool, len(candidates))
	for _, candidate := range candidates {
		eligible[candidate.Name] = true
	}
	for _, ref := range sourceRefs {
		if !eligible[ref] {
			return hostrepo.RemoteBranchMergeResult{}, fmt.Errorf("merge source %q has no commits missing from %s", ref, targetRef)
		}
	}
	s.bus.Publish(sessionID, "git.remote_merge_started", map[string]any{"target": targetRef, "sources": sourceRefs})
	result, err := hostrepo.MergeRemoteBranches(ctx, item.ProjectPath, targetRef, sourceRefs, s.projectCommitIdentity(ctx, item.ProjectPath))
	if err != nil {
		return result, err
	}
	if result.Outcome == "conflict" {
		_, conflictID, prepareErr := s.prepareGitConflictResolution(ctx, sessionID, item, gitConflictRequest{
			origin: domain.GitConflictOriginRemoteMerge, ref: result.ConflictRef, remote: target.Remote, remoteBranch: strings.TrimPrefix(targetRef, target.Remote+"/"),
			targetBranch: targetRef, sourceRefs: append([]string(nil), sourceRefs...), sides: result.Sides, paths: result.Paths,
		})
		if prepareErr != nil {
			return result, prepareErr
		}
		result.ConflictID = conflictID
	}
	s.bus.Publish(sessionID, "git.remote_merge_completed", map[string]any{"target": targetRef, "sources": sourceRefs, "outcome": result.Outcome, "push_outcome": result.PushOutcome})
	return result, nil
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
	if err := gitRemoteFetch(ctx, item.ProjectPath, remote); err != nil {
		return GitBranchActionResult{}, err
	}
	ref := remote + "/" + branch
	merge, err := hostrepo.MergeBranch(ctx, item.ProjectPath, ref, s.projectCommitIdentity(ctx, item.ProjectPath))
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
