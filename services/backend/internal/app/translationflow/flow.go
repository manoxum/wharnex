package translationflow

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/translation"
	"kernl.local/harness/backend/internal/utility"
)

// WorkerPayload carries a sealed request bundle. The worker transports it
// without composing instructions or reading generated prose.
type WorkerPayload struct {
	Protocol        string `json:"protocol"`
	Task            string `json:"task"`
	TaskID          string `json:"task_id"`
	TargetLanguage  string `json:"target_language"`
	RequestFilename string `json:"request_filename"`
	ResultFilename  string `json:"result_filename"`
	Bootstrap       string `json:"bootstrap"`
	ArchiveBase64   string `json:"archive_base64"`
	ReasoningEffort string `json:"reasoning_effort"`
}

// WorkerResult contains the exact downloaded bytes, unread by the worker.
type WorkerResult struct {
	Protocol     string `json:"protocol"`
	TaskID       string `json:"task_id"`
	Filename     string `json:"filename"`
	BundleBase64 string `json:"bundle_base64"`
}

type TaskStore interface {
	EnqueueChatAgentTask(session.ChatAgentTask) (session.ChatAgentTask, error)
	GetChatAgentTask(string) (session.ChatAgentTask, error)
	CancelChatAgentLineage(string) (int, error)
}

func Translate(ctx context.Context, store TaskStore, sessionID string, currentSession domain.Session, target utility.LanguageCode, markdown string) (utility.Result, error) {
	request := utility.Request{Protocol: utility.ProtocolV1, Task: utility.TaskTranslateMarkdown, TargetLanguage: target, Markdown: markdown}
	if err := utility.ValidateRequest(request); err != nil {
		return utility.Result{}, err
	}
	if markdown == "" {
		return utility.Result{Protocol: utility.ProtocolV1, Task: utility.TaskTranslateMarkdown, TargetLanguage: target}, nil
	}
	// The response filename depends on this id, so mint it before building the bundle.
	taskID := session.NewChatAgentTaskID()
	chatID := currentSession.ChatID
	if chatID == "" {
		chatID = currentSession.ID
	}
	chatHash := currentSession.Context.WorkspaceSHA256
	if chatHash == "" {
		chatHash = currentSession.Context.Manifest.SHA256
	}
	manifest, archive, err := translation.BuildRequestWithMetadata(taskID, string(target), markdown, translation.RequestMetadata{
		ChatTitle: "Document translation", ChatID: chatID, ChatHash: chatHash, RequestedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return utility.Result{}, err
	}
	payload, err := json.Marshal(WorkerPayload{
		Protocol: translation.RequestProtocolV1, Task: translation.TaskTranslateDocument, TaskID: taskID,
		TargetLanguage: manifest.TargetLanguage, RequestFilename: manifest.RequestFilename,
		ResultFilename: manifest.ResultFilename, Bootstrap: translation.RequestBootstrap(manifest),
		ArchiveBase64: base64.StdEncoding.EncodeToString(archive), ReasoningEffort: string(domain.ReasoningEffortInstant),
	})
	if err != nil {
		return utility.Result{}, fmt.Errorf("encode translation task: %w", err)
	}
	task, err := store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "TRANSLATE_MARKDOWN", TaskID: taskID, ChatID: sessionID, SessionID: sessionID,
		RootRequestID: taskID, Payload: payload, MaxAttempts: 1,
	})
	if err != nil {
		return utility.Result{}, fmt.Errorf("enqueue translation worker: %w", err)
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(12 * time.Minute)
	defer timeout.Stop()
	for {
		current, getErr := store.GetChatAgentTask(task.TaskID)
		if getErr != nil {
			return utility.Result{}, fmt.Errorf("read translation worker: %w", getErr)
		}
		switch current.Status {
		case session.ChatAgentTaskDone:
			return Finish(current.Payload, manifest, target)
		case session.ChatAgentTaskFailed, session.ChatAgentTaskAttention, session.ChatAgentTaskCancelled:
			detail := strings.TrimSpace(current.LastError)
			if detail == "" {
				detail = "translation worker did not complete"
			}
			return utility.Result{}, fmt.Errorf("%w: %s", utility.ErrUnavailable, detail)
		}
		select {
		case <-ctx.Done():
			_, _ = store.CancelChatAgentLineage(taskID)
			return utility.Result{}, ctx.Err()
		case <-timeout.C:
			_, _ = store.CancelChatAgentLineage(taskID)
			return utility.Result{}, fmt.Errorf("%w: translation worker timed out", utility.ErrUnavailable)
		case <-ticker.C:
		}
	}
}

// Finish validates the downloaded bundle at the same boundary that authored
// the request contract.
func Finish(raw json.RawMessage, manifest translation.TransportManifest, target utility.LanguageCode) (utility.Result, error) {
	var delivered WorkerResult
	if err := json.Unmarshal(raw, &delivered); err != nil {
		return utility.Result{}, fmt.Errorf("decode translation worker result: %w", err)
	}
	bundle, err := base64.StdEncoding.DecodeString(delivered.BundleBase64)
	if err != nil {
		return utility.Result{}, fmt.Errorf("decode translation bundle bytes: %w", err)
	}
	parsed, err := translation.ParseResult(delivered.Filename, bundle, manifest)
	if err != nil {
		return utility.Result{}, fmt.Errorf("%w: %s", utility.ErrUnavailable, err.Error())
	}
	return utility.Result{
		Protocol: utility.ProtocolV1, Task: utility.TaskTranslateMarkdown,
		TargetLanguage: target, Markdown: parsed.Markdown,
	}, nil
}
