package translationflow

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/utility"
)

type cancellationStore struct {
	task      session.ChatAgentTask
	cancelled string
}

func (s *cancellationStore) EnqueueChatAgentTask(task session.ChatAgentTask) (session.ChatAgentTask, error) {
	s.task = task
	return task, nil
}

func (s *cancellationStore) GetChatAgentTask(string) (session.ChatAgentTask, error) {
	return s.task, nil
}

func (s *cancellationStore) CancelChatAgentLineage(id string) (int, error) {
	s.cancelled = id
	return 1, nil
}

func TestTranslateCancellationCancelsOnlyItsWorkerLineage(t *testing.T) {
	store := &cancellationStore{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Translate(ctx, store, "ses_translation", domain.Session{ID: "ses_translation"}, utility.LanguagePortuguese, "# Hello")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Translate error = %v, want context.Canceled", err)
	}
	if store.task.TaskID == "" || store.cancelled != store.task.TaskID {
		t.Fatalf("cancelled lineage = %q, worker task = %q", store.cancelled, store.task.TaskID)
	}
	if store.task.ChatID != "ses_translation" || store.task.SessionID != "ses_translation" {
		t.Fatalf("task routed to wrong session: chat=%q session=%q", store.task.ChatID, store.task.SessionID)
	}
	var payload WorkerPayload
	if err := json.Unmarshal(store.task.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.TaskID != store.task.TaskID || payload.RequestFilename == "" || payload.ResultFilename == "" {
		t.Fatalf("worker payload does not match queued task: %+v", payload)
	}
}
