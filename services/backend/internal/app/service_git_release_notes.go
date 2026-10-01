package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/releasenotes"
	"kernl.local/harness/backend/internal/session"
)

type gitReleaseNotesWorkerPayload struct {
	Protocol        string `json:"protocol"`
	Task            string `json:"task"`
	TaskID          string `json:"task_id"`
	Branch          string `json:"branch"`
	RequestFilename string `json:"request_filename"`
	ResultFilename  string `json:"result_filename"`
	Bootstrap       string `json:"bootstrap"`
	ArchiveBase64   string `json:"archive_base64"`
	ReasoningEffort string `json:"reasoning_effort"`
}

type gitReleaseNotesWorkerResult struct {
	Protocol     string `json:"protocol"`
	TaskID       string `json:"task_id"`
	Filename     string `json:"filename"`
	BundleBase64 string `json:"bundle_base64"`
}

// Three bounded Worker attempts each have a four-minute response window.
// Claim, navigation and pacing happen before that window begins, so the
// synchronous caller must outlive the complete durable task budget.
const gitReleaseNotesAwaitTimeout = 18 * time.Minute

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
	lines := []string{"# Release source", "", "Remote branch: `" + branch + "`", "", "## Recent commits"}
	for _, commit := range commits {
		lines = append(lines, "- `"+commit.ShortSHA+"` "+commit.Subject)
	}
	taskID := session.NewChatAgentTaskID()
	chatID := strings.TrimSpace(item.ChatID)
	if chatID == "" {
		chatID = item.ID
	}
	chatHash := strings.TrimSpace(item.Context.WorkspaceSHA256)
	if chatHash == "" {
		chatHash = strings.TrimSpace(item.Context.Manifest.SHA256)
	}
	manifest, archive, err := releasenotes.BuildRequest(taskID, branch, strings.Join(lines, "\n")+"\n", releasenotes.RequestMetadata{
		ChatTitle: "Git release notes · " + branch, ChatID: chatID, ChatHash: chatHash,
		RequestedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return GitReleaseNotesResult{}, fmt.Errorf("build release-notes bundle: %w", err)
	}
	payload, err := json.Marshal(gitReleaseNotesWorkerPayload{
		Protocol: releasenotes.RequestProtocolV1, Task: releasenotes.TaskGenerate, TaskID: taskID, Branch: branch,
		RequestFilename: manifest.RequestFilename, ResultFilename: manifest.ResultFilename,
		Bootstrap: releasenotes.RequestBootstrap(manifest), ArchiveBase64: base64.StdEncoding.EncodeToString(archive), ReasoningEffort: "instant",
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
	return s.awaitGitReleaseNotes(ctx, task.TaskID, manifest, len(commits))
}

func (s *Service) awaitGitReleaseNotes(ctx context.Context, taskID string, request releasenotes.TransportManifest, commitCount int) (GitReleaseNotesResult, error) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(gitReleaseNotesAwaitTimeout)
	defer timeout.Stop()
	for {
		current, err := s.store.GetChatAgentTask(taskID)
		if err != nil {
			return GitReleaseNotesResult{}, fmt.Errorf("read release-notes worker: %w", err)
		}
		switch current.Status {
		case session.ChatAgentTaskDone:
			var delivered gitReleaseNotesWorkerResult
			if err := json.Unmarshal(current.Payload, &delivered); err != nil {
				return GitReleaseNotesResult{}, fmt.Errorf("decode release-notes worker: %w", err)
			}
			if delivered.Protocol != releasenotes.ResultProtocolV1 || delivered.TaskID != taskID {
				return GitReleaseNotesResult{}, errors.New("release-notes worker returned a foreign result")
			}
			bundle, err := base64.StdEncoding.DecodeString(delivered.BundleBase64)
			if err != nil {
				return GitReleaseNotesResult{}, fmt.Errorf("decode release-notes bundle bytes: %w", err)
			}
			parsed, err := releasenotes.ParseResult(delivered.Filename, bundle, request)
			if err != nil {
				return GitReleaseNotesResult{}, err
			}
			return GitReleaseNotesResult{Body: parsed.Body, CommitCount: commitCount}, nil
		case session.ChatAgentTaskFailed, session.ChatAgentTaskAttention, session.ChatAgentTaskCancelled:
			detail := strings.TrimSpace(current.LastError)
			if detail == "" {
				detail = "release-notes worker did not complete"
			}
			return GitReleaseNotesResult{}, errors.New(detail)
		}
		select {
		case <-ctx.Done():
			_, _ = s.store.CancelChatAgentLineage(taskID)
			return GitReleaseNotesResult{}, ctx.Err()
		case <-timeout.C:
			_, _ = s.store.CancelChatAgentLineage(taskID)
			return GitReleaseNotesResult{}, errors.New("release-notes worker timed out")
		case <-ticker.C:
		}
	}
}
