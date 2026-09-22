package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/projectversion"
	"kernl.local/harness/backend/internal/session"
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

type gitReleaseNotesWorkerPayload struct {
	Protocol        string `json:"protocol"`
	Task            string `json:"task"`
	TaskID          string `json:"task_id"`
	Prompt          string `json:"prompt"`
	ReasoningEffort string `json:"reasoning_effort"`
}

type gitReleaseNotesWorkerResult struct {
	Protocol string `json:"protocol"`
	TaskID   string `json:"task_id"`
	Body     string `json:"body"`
}

// GenerateGitReleaseNotes delegates prose generation to the Desktop ChatGPT
// Worker pool, matching the existing translation/TODO utility pattern instead
// of requiring an API-backed planner provider.
func (s *Service) GenerateGitReleaseNotes(ctx context.Context, sessionID, branch string) (GitReleaseNotesResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitReleaseNotesResult{}, err
	}
	repoRoot, repoPath, _, err := s.gitRepositoryRoot(ctx, item.ProjectPath)
	if err != nil {
		return GitReleaseNotesResult{}, err
	}
	branch = strings.TrimSpace(branch)
	if branch == "" || strings.HasPrefix(branch, "-") {
		return GitReleaseNotesResult{}, errors.New("select a remote branch before generating release notes")
	}
	branches, err := hostrepo.Branches(ctx, repoRoot)
	if err != nil {
		return GitReleaseNotesResult{}, err
	}
	valid := false
	for _, candidate := range branches {
		if candidate.Remote != "" && candidate.Name == branch {
			valid = true
			break
		}
	}
	if !valid {
		return GitReleaseNotesResult{}, fmt.Errorf("unknown remote branch %q", branch)
	}
	commits, err := hostrepo.LogRefs(ctx, repoRoot, []string{branch}, false, 30)
	if err != nil {
		return GitReleaseNotesResult{}, err
	}
	lines := make([]string, 0, len(commits))
	for _, commit := range commits {
		lines = append(lines, "- "+commit.ShortSHA+" "+commit.Subject)
	}
	prompt := "Escreve notas de release concisas em Markdown para a branch remota '" + branch + "'. " +
		"Agrupa mudanças materiais por tema, evita inventar factos e responde apenas com o texto final das notas de release.\n\nCommits recentes:\n" + strings.Join(lines, "\n")
	taskID := session.NewChatAgentTaskID()
	payload, err := json.Marshal(gitReleaseNotesWorkerPayload{
		Protocol: "wharness.release-notes-input/v1", Task: "generate_release_notes", TaskID: taskID,
		Prompt: prompt, ReasoningEffort: "instant",
	})
	if err != nil {
		return GitReleaseNotesResult{}, fmt.Errorf("encode release-notes worker: %w", err)
	}
	task, err := s.store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "RELEASE_NOTES", TaskID: taskID, ProjectID: item.ProjectPath, ChatID: sessionID, SessionID: sessionID,
		RequestID: taskID, RootRequestID: taskID, DedupeKey: "release-notes:" + sessionID + ":" + repoPath + ":" + branch,
		Payload: payload, MaxAttempts: 3,
	})
	if err != nil {
		return GitReleaseNotesResult{}, fmt.Errorf("enqueue release-notes worker: %w", err)
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(5 * time.Minute)
	defer timeout.Stop()
	for {
		current, getErr := s.store.GetChatAgentTask(task.TaskID)
		if getErr != nil {
			return GitReleaseNotesResult{}, fmt.Errorf("read release-notes worker: %w", getErr)
		}
		switch current.Status {
		case session.ChatAgentTaskDone:
			var result gitReleaseNotesWorkerResult
			if err := json.Unmarshal(current.Payload, &result); err != nil {
				return GitReleaseNotesResult{}, fmt.Errorf("decode release-notes worker: %w", err)
			}
			if result.Protocol != "harness.release-notes/v1" || result.TaskID != task.TaskID || strings.TrimSpace(result.Body) == "" {
				return GitReleaseNotesResult{}, errors.New("release-notes worker returned an invalid result")
			}
			return GitReleaseNotesResult{Body: strings.TrimSpace(result.Body), CommitCount: len(commits)}, nil
		case session.ChatAgentTaskFailed, session.ChatAgentTaskAttention, session.ChatAgentTaskCancelled:
			detail := strings.TrimSpace(current.LastError)
			if detail == "" {
				detail = "release-notes worker did not complete"
			}
			return GitReleaseNotesResult{}, errors.New(detail)
		}
		select {
		case <-ctx.Done():
			_, _ = s.store.CancelChatAgentLineage(task.TaskID)
			return GitReleaseNotesResult{}, ctx.Err()
		case <-timeout.C:
			_, _ = s.store.CancelChatAgentLineage(task.TaskID)
			return GitReleaseNotesResult{}, errors.New("release-notes worker timed out")
		case <-ticker.C:
		}
	}
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
