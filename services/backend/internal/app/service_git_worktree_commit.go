package app

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
)

// GitWorktreeCommitResult reports an explicit operator commit made from the
// files currently shown by the Git surface.
type GitWorktreeCommitResult struct {
	CommitSHA string   `json:"commit_sha"`
	Paths     []string `json:"paths"`
}

// CommitWorkingFiles commits an explicit subset of the current worktree.
//
// This action is deliberately independent of the project's commit mode. Auto
// mode controls how Wharnex records applied changes, but it must not prevent an
// operator from committing their own local files through the Git surface.
func (s *Service) CommitWorkingFiles(ctx context.Context, sessionID, message string, paths []string) (GitWorktreeCommitResult, error) {
	return s.commitWorkingFiles(ctx, sessionID, message, paths, false)
}

// CommitAllWorkingFiles commits every currently committable path in the
// selected repository. It is used by collective submodule actions, where the
// same project-relative filenames cannot be assumed to exist in every repo.
func (s *Service) CommitAllWorkingFiles(ctx context.Context, sessionID, message string) (GitWorktreeCommitResult, error) {
	return s.commitWorkingFiles(ctx, sessionID, message, nil, true)
}

func (s *Service) commitWorkingFiles(ctx context.Context, sessionID, message string, paths []string, all bool) (GitWorktreeCommitResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitWorktreeCommitResult{}, err
	}
	message = strings.TrimSpace(message)
	if message == "" {
		return GitWorktreeCommitResult{}, fmt.Errorf("a commit message is required")
	}
	repoRoot, repoPath, _, err := s.gitRepositoryRoot(ctx, item.ProjectPath)
	if err != nil {
		return GitWorktreeCommitResult{}, err
	}
	lock := s.projectApplyLock(item.ProjectPath)
	lock.Lock()
	defer lock.Unlock()

	state, err := hostrepo.Working(ctx, repoRoot)
	if err != nil {
		return GitWorktreeCommitResult{}, err
	}
	allowed := make(map[string]bool, len(state.Stageable)+len(state.GitlinkChanges))
	for _, path := range state.Stageable {
		allowed[path] = true
	}
	for _, path := range state.GitlinkChanges {
		allowed[path] = true
	}
	selected := make([]string, 0, len(paths)+len(allowed))
	if all {
		for path := range allowed {
			selected = append(selected, path)
		}
	} else {
		seen := make(map[string]bool, len(paths))
		for _, rawPath := range paths {
			path := strings.TrimSpace(rawPath)
			if path == "" || seen[path] {
				continue
			}
			if !allowed[path] {
				return GitWorktreeCommitResult{}, fmt.Errorf("path is not a committable worktree file: %s", path)
			}
			seen[path] = true
			selected = append(selected, path)
		}
	}
	if len(selected) == 0 {
		return GitWorktreeCommitResult{}, fmt.Errorf("select at least one changed file to commit")
	}
	sort.Strings(selected)

	sha, err := hostrepo.CommitPaths(ctx, repoRoot, message, selected)
	if err != nil {
		return GitWorktreeCommitResult{}, err
	}
	s.bus.Publish(sessionID, "git.worktree_committed", map[string]any{
		"commit": sha, "paths": selected, "subject": firstLineOf(message), "repository": repoPath,
	})
	return GitWorktreeCommitResult{CommitSHA: sha, Paths: selected}, nil
}
