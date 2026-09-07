package app

import (
	"archive/zip"
	"bytes"
	"context"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func makeKnowledgeReviewAnswerBundle(t *testing.T, requestID, message, knowledgeMd string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	entries := map[string]string{
		"README.md": "# Knowledge review\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"` + requestID + `","kind":"answer","message":"` + message + `","outcome":{"status":"completed","retryable":false}}`,
	}
	if knowledgeMd != "" {
		entries["knowledge.md"] = knowledgeMd
	}
	for name, value := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestTriggerKnowledgeReviewDoesNotMutateStateOrPlan(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	plan := &domain.ExecutionPlan{PlanID: "plan-untouched", RequestID: "req-untouched", Status: "ready"}
	if _, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "applied"
		item.Plan = plan
		item.LastRequestID = "req-main"
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	service.triggerKnowledgeReview(context.Background(), started.ID)

	after, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.State != "applied" {
		t.Fatalf("triggerKnowledgeReview must not change State, got %q", after.State)
	}
	if after.Plan != plan {
		t.Fatalf("triggerKnowledgeReview must not touch Plan, got %#v", after.Plan)
	}
	if after.PendingKnowledgeReviewRequestID == "" {
		t.Fatal("expected a pending knowledge review request id")
	}
	if !containsString(after.PendingManualRequestIDs, after.PendingKnowledgeReviewRequestID) {
		t.Fatal("expected the knowledge review request id to be pending delivery")
	}
	if !strings.Contains(after.LastManualPrompt, "WHX KNOWLEDGE REVIEW") {
		t.Fatal("expected the manual prompt to be the dedicated knowledge review prompt")
	}
	lineage, ok := after.RequestLineages[after.PendingKnowledgeReviewRequestID]
	if !ok || lineage.Kind != requestKindKnowledgeReview || lineage.ParentRequestID != "req-main" {
		t.Fatalf("expected knowledge_review lineage parented on the main request, got %#v", lineage)
	}
}

func TestIngestKnowledgeReviewResponseUpdatesKnowledgeWithoutTouchingState(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	plan := &domain.ExecutionPlan{PlanID: "plan-untouched", RequestID: "req-untouched", Status: "ready"}
	if _, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "restart_pending"
		item.Plan = plan
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	service.triggerKnowledgeReview(context.Background(), started.ID)
	pending, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	requestID := pending.PendingKnowledgeReviewRequestID
	if requestID == "" {
		t.Fatal("expected a pending knowledge review request")
	}

	bundle := makeKnowledgeReviewAnswerBundle(t, requestID, "Resumo do trabalho.", "# Wharness knowledge\n\n- Node do host tem de ser >=22.12.\n")
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", bundle)
	if err != nil {
		t.Fatal(err)
	}
	if result.Session.State != "restart_pending" {
		t.Fatalf("ingestKnowledgeReviewResponse must not change State, got %q", result.Session.State)
	}
	if result.Session.Plan != plan {
		t.Fatalf("ingestKnowledgeReviewResponse must not touch Plan, got %#v", result.Session.Plan)
	}
	if result.Session.PendingKnowledgeReviewRequestID != "" {
		t.Fatal("expected the pending knowledge review marker to be cleared")
	}
	if containsString(result.Session.PendingManualRequestIDs, requestID) {
		t.Fatal("expected the request id to be removed from pending manual requests")
	}
	if result.Session.LastTurn == nil || result.Session.LastTurn.Message != "Resumo do trabalho." {
		t.Fatalf("expected the summary turn to be retained as LastTurn, got %#v", result.Session.LastTurn)
	}
	saved, ok, err := service.store.GetProjectKnowledge(root)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || !strings.Contains(saved.Content, "Node do host tem de ser >=22.12") || saved.Version != 1 {
		t.Fatalf("expected the knowledge document to be persisted, got %#v", saved)
	}
	if saved.UpdatedByRequestID != requestID {
		t.Fatalf("updated_by_request_id = %q, want %q", saved.UpdatedByRequestID, requestID)
	}
}

func TestIngestKnowledgeReviewResponseWithoutKnowledgeFileLeavesStoreUntouched(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	service.triggerKnowledgeReview(context.Background(), started.ID)
	pending, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	requestID := pending.PendingKnowledgeReviewRequestID

	bundle := makeKnowledgeReviewAnswerBundle(t, requestID, "Nada de novo para reter.", "")
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", bundle); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := service.store.GetProjectKnowledge(root); err != nil {
		t.Fatal(err)
	} else if ok {
		t.Fatal("expected no knowledge to be recorded when ChatGPT declines to update it")
	}
}

func TestKnowledgeMdOutsideTheReviewBranchIsStructurallyIgnored(t *testing.T) {
	// Guards the core invariant: the knowledge source can only change at
	// the end of a task, by construction — a knowledge.md that arrives on
	// an ordinary (non knowledge_review) response must never be read.
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "Que funcionalidade deveríamos adicionar a seguir?")
	if err != nil {
		t.Fatal(err)
	}
	bundle := makeKnowledgeReviewAnswerBundle(t, prompted.LastRequestID, "Resposta normal.", "# Sneaked-in knowledge\n")
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+prompted.LastRequestID+".zip", bundle); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := service.store.GetProjectKnowledge(root); err != nil {
		t.Fatal(err)
	} else if ok {
		t.Fatal("a knowledge.md outside the knowledge_review branch must never be persisted")
	}
}

func TestSubmitMessageIncludesKnowledgeSourceOnlyOnFirstRequestOfChat(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	if _, err := store.AppendProjectKnowledge(root, "- Prior learning from an earlier chat.", "req-earlier"); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}

	first, _, err := service.SubmitMessage(context.Background(), started.ID, "Primeira pergunta neste chat.")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(first.ManualPrompt, "PROJECT KNOWLEDGE") || !strings.Contains(first.ManualPrompt, "Prior learning from an earlier chat") {
		t.Fatalf("expected the first request of a new chat to include the project's knowledge source")
	}

	second, _, err := service.SubmitMessage(context.Background(), started.ID, "Segunda pergunta no mesmo chat.")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(second.ManualPrompt, "PROJECT KNOWLEDGE") {
		t.Fatal("a later request in the same chat must not repeat the knowledge source")
	}
}
