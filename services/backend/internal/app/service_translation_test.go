package app

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/utility"
)

func TestTranslateMarkdownUsesDurablePriorityWorker(t *testing.T) {
	store := session.NewStore()
	if err := store.Put(domain.Session{ID: "ses_translation", State: "ready"}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	type outcome struct {
		result utility.Result
		err    error
	}
	resultCh := make(chan outcome, 1)
	go func() {
		result, err := service.TranslateMarkdown(ctx, "ses_translation", utility.LanguagePortuguese, "# Hello")
		resultCh <- outcome{result: result, err: err}
	}()

	var task *session.ChatAgentTask
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		items, err := store.ListChatAgentTasks(session.ChatAgentTaskFilter{ActiveOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		if len(items) > 0 {
			candidate := items[0]
			task = &candidate
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if task == nil {
		t.Fatal("translation task was not enqueued")
	}
	if task.Type != "TRANSLATE_MARKDOWN" || task.Priority != -1 {
		t.Fatalf("translation task=%#v", task)
	}
	var request utility.Request
	if err := json.Unmarshal(task.Payload, &request); err != nil {
		t.Fatal(err)
	}
	if request.Markdown != "# Hello" || request.TargetLanguage != utility.LanguagePortuguese {
		t.Fatalf("worker request=%#v", request)
	}

	claimed, err := store.ClaimChatAgentTask("worker-1", 30*time.Second)
	if err != nil || claimed == nil || claimed.TaskID != task.TaskID {
		t.Fatalf("claim translation=%#v err=%v", claimed, err)
	}
	payload, err := json.Marshal(utility.Result{
		Protocol: utility.ProtocolV1, Task: utility.TaskTranslateMarkdown,
		TargetLanguage: utility.LanguagePortuguese, Markdown: "# Olá",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CompleteChatAgentTaskWithPayload(task.TaskID, "worker-1", payload); err != nil {
		t.Fatal(err)
	}

	select {
	case got := <-resultCh:
		if got.err != nil {
			t.Fatal(got.err)
		}
		if got.result.Markdown != "# Olá" || got.result.TargetLanguage != utility.LanguagePortuguese {
			t.Fatalf("translation result=%#v", got.result)
		}
	case <-ctx.Done():
		t.Fatal("TranslateMarkdown did not observe the completed worker task")
	}
}
