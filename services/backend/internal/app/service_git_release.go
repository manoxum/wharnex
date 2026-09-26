package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/projectversion"
)

type GitBranchMutationResult struct {
	Outcome string `json:"outcome"`
	Branch  string `json:"branch"`
}

type GitReleaseNotesResult struct {
	Body        string `json:"body"`
	CommitCount int    `json:"commit_count"`
}

type GitReleaseResult struct {
	Outcome    string `json:"outcome"`
	Remote     string `json:"remote"`
	Branch     string `json:"branch"`
	Tag        string `json:"tag"`
	CommitSHA  string `json:"commit_sha"`
	ReleaseURL string `json:"release_url"`
}

func (s *Service) CreateBranch(ctx context.Context, sessionID, branch, startPoint string) (GitBranchMutationResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitBranchMutationResult{}, err
	}
	repoRoot, repoPath, _, err := s.gitRepositoryRoot(ctx, item.ProjectPath)
	if err != nil {
		return GitBranchMutationResult{}, err
	}
	lock := s.projectApplyLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	if err := hostrepo.CreateBranch(ctx, repoRoot, branch, startPoint); err != nil {
		return GitBranchMutationResult{}, err
	}
	branch = strings.TrimSpace(branch)
	s.bus.Publish(sessionID, "git.branch_created", map[string]any{"branch": branch, "start_point": strings.TrimSpace(startPoint), "repository": repoPath})
	return GitBranchMutationResult{Outcome: "created", Branch: branch}, nil
}

func (s *Service) DeleteBranch(ctx context.Context, sessionID, branch string) (GitBranchMutationResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitBranchMutationResult{}, err
	}
	repoRoot, repoPath, _, err := s.gitRepositoryRoot(ctx, item.ProjectPath)
	if err != nil {
		return GitBranchMutationResult{}, err
	}
	lock := s.projectApplyLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	branch = strings.TrimSpace(branch)
	branches, err := hostrepo.Branches(ctx, repoRoot)
	if err != nil {
		return GitBranchMutationResult{}, err
	}
	var target *hostrepo.Branch
	for i := range branches {
		if branches[i].Name == branch {
			target = &branches[i]
			break
		}
	}
	if target == nil {
		return GitBranchMutationResult{}, fmt.Errorf("unknown branch %q", branch)
	}
	if target.Remote == "" {
		if err := hostrepo.DeleteBranch(ctx, repoRoot, branch); err != nil {
			return GitBranchMutationResult{}, err
		}
	} else {
		remoteBranch := strings.TrimPrefix(branch, target.Remote+"/")
		push, err := gitRemoteDeleteBranch(ctx, repoRoot, target.Remote, remoteBranch)
		if err != nil {
			return GitBranchMutationResult{}, err
		}
		if !push.Succeeded() {
			detail := strings.TrimSpace(push.Detail)
			if detail == "" {
				detail = string(push.Outcome)
			}
			return GitBranchMutationResult{}, fmt.Errorf("delete remote branch %s: %s", branch, detail)
		}
		_ = gitRemoteFetch(ctx, repoRoot, target.Remote)
	}
	s.bus.Publish(sessionID, "git.branch_deleted", map[string]any{"branch": branch, "repository": repoPath})
	return GitBranchMutationResult{Outcome: "deleted", Branch: branch}, nil
}

func composeReleaseTag(version, suffix string) (string, error) {
	version = strings.TrimSpace(version)
	if version == "" {
		return "", errors.New("project VERSION is empty")
	}
	suffix = strings.TrimLeft(strings.TrimSpace(suffix), "-")
	if suffix == "" {
		return version, nil
	}
	return version + "-" + suffix, nil
}

func (s *Service) CreateGitRelease(ctx context.Context, sessionID, branch, tagSuffix, title, body string) (GitReleaseResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitReleaseResult{}, err
	}
	repoRoot, repoPath, _, err := s.gitRepositoryRoot(ctx, item.ProjectPath)
	if err != nil {
		return GitReleaseResult{}, err
	}
	branch, tagSuffix, title, body = strings.TrimSpace(branch), strings.TrimSpace(tagSuffix), strings.TrimSpace(title), strings.TrimSpace(body)
	if branch == "" {
		return GitReleaseResult{}, errors.New("select a remote branch before creating a tag and release")
	}
	if body == "" {
		return GitReleaseResult{}, errors.New("release notes are required")
	}
	lock := s.projectApplyLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	branches, err := hostrepo.Branches(ctx, repoRoot)
	if err != nil {
		return GitReleaseResult{}, err
	}
	remote := ""
	for _, candidate := range branches {
		if candidate.Remote != "" && candidate.Name == branch {
			remote = candidate.Remote
			break
		}
	}
	if remote == "" {
		return GitReleaseResult{}, fmt.Errorf("unknown remote branch %q", branch)
	}
	version, _, err := projectversion.Ensure(item.ProjectPath)
	if err != nil {
		return GitReleaseResult{}, fmt.Errorf("read project VERSION: %w", err)
	}
	tag, err := composeReleaseTag(version, tagSuffix)
	if err != nil {
		return GitReleaseResult{}, err
	}
	if title == "" {
		title = tag
	}
	sha, err := hostrepo.CreateTagAtRef(ctx, repoRoot, tag, branch)
	if err != nil {
		return GitReleaseResult{}, err
	}
	push, err := gitRemotePushTag(ctx, repoRoot, remote, tag)
	if err != nil {
		return GitReleaseResult{}, err
	}
	if !push.Succeeded() {
		detail := strings.TrimSpace(push.Detail)
		if detail == "" {
			detail = string(push.Outcome)
		}
		return GitReleaseResult{}, fmt.Errorf("publish tag %s: %s", tag, detail)
	}
	releaseURL, err := gitRemoteCreateGitHubRelease(ctx, repoRoot, remote, tag, title, body)
	if err != nil {
		return GitReleaseResult{}, err
	}
	result := GitReleaseResult{Outcome: "published", Remote: remote, Branch: branch, Tag: tag, CommitSHA: sha, ReleaseURL: releaseURL}
	s.bus.Publish(sessionID, "git.release_created", map[string]any{"remote": remote, "branch": branch, "tag": tag, "commit_sha": sha, "release_url": releaseURL, "repository": repoPath})
	return result, nil
}
