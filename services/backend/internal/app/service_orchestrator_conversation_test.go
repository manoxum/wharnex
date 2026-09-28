package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

type conversationTestFixture struct {
	ctx     context.Context
	store   *session.Store
	service *Service
	owner   domain.Session
	task    orchestrator.Task
	claim   *session.ChatAgentTask
}

func newConversationTestFixture(t *testing.T) conversationTestFixture {
	t.Helper()
	ctx := context.Background()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), orchestratorExecutionManualPlanner{}, policy.NewEngine(), fakeRunner{})
	owner, err := service.StartSessionWithModes(ctx, t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	task, err := service.CreateOrchestratorTask(ctx, owner.ID, OrchestratorTaskInput{Title: "One conversation"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionOrchestratorTask(ctx, owner.ID, task.ID, orchestrator.TaskReady); err != nil {
		t.Fatal(err)
	}
	claim, err := store.ClaimChatAgentTaskWithOptions("worker-1", time.Minute, session.ChatAgentClaimOptions{WorkerID: "worker-1", Role: session.ChatAgentRoleWorker})
	if err != nil || claim == nil {
		t.Fatalf("claim=%#v err=%v", claim, err)
	}
	return conversationTestFixture{ctx: ctx, store: store, service: service, owner: owner, task: task, claim: claim}
}

func TestOrchestratorConversationFirstBindIsImmutableAndIdempotent(t *testing.T) {
	fixture := newConversationTestFixture(t)
	if _, err := fixture.service.RecordOrchestratorWorkerConversationAffinity(fixture.ctx, fixture.owner.ID, fixture.task.ID, fixture.claim.TaskID, "worker-1", "https://example.com/c/x"); err == nil {
		t.Fatal("a non-ChatGPT conversation URL was accepted")
	}
	const first = "https://chatgpt.com/c/first"
	bound, err := fixture.service.RecordOrchestratorWorkerConversationAffinity(fixture.ctx, fixture.owner.ID, fixture.task.ID, fixture.claim.TaskID, "worker-1", first)
	if err != nil || bound.ConversationURL != first || bound.ConversationID != "first" {
		t.Fatalf("first bind=%#v err=%v", bound, err)
	}
	again, err := fixture.service.RecordOrchestratorWorkerConversationAffinity(fixture.ctx, fixture.owner.ID, fixture.task.ID, fixture.claim.TaskID, "worker-1", first)
	if err != nil || again != bound {
		t.Fatalf("idempotent bind=%#v err=%v", again, err)
	}
	for _, candidate := range []string{"", "https://chatgpt.com/", "https://chatgpt.com/c/second"} {
		_, err := fixture.service.RecordOrchestratorWorkerConversationAffinity(fixture.ctx, fixture.owner.ID, fixture.task.ID, fixture.claim.TaskID, "worker-1", candidate)
		if err == nil {
			t.Fatalf("rebind %q was accepted", candidate)
		}
		if candidate == "https://chatgpt.com/c/second" && !strings.Contains(err.Error(), "already bound") {
			t.Fatalf("rebind err=%v", err)
		}
	}
	stored, err := fixture.service.orchestrator.GetTask(fixture.ctx, fixture.task.ID)
	if err != nil || stored.ConversationURL != first || stored.ConversationID != "first" {
		t.Fatalf("stored affinity=%#v err=%v", stored, err)
	}
}

func TestOrchestratorConversationRequiresItsExecutionLease(t *testing.T) {
	fixture := newConversationTestFixture(t)
	if _, err := fixture.service.RecordOrchestratorWorkerConversationAffinity(fixture.ctx, fixture.owner.ID, fixture.task.ID, fixture.claim.TaskID, "other-worker", "https://chatgpt.com/c/first"); err == nil {
		t.Fatal("conversation affinity was accepted without the task lease")
	}
	stored, err := fixture.service.orchestrator.GetTask(fixture.ctx, fixture.task.ID)
	if err != nil || stored.ConversationURL != "" || stored.ConversationID != "" {
		t.Fatalf("unauthorized bind changed task=%#v err=%v", stored, err)
	}
}

func TestReclaimedWorkerStartsInTheDefinitiveConversation(t *testing.T) {
	fixture := newConversationTestFixture(t)
	const conversation = "https://chatgpt.com/c/reclaimed"
	if _, err := fixture.service.RecordOrchestratorWorkerConversationAffinity(fixture.ctx, fixture.owner.ID, fixture.task.ID, fixture.claim.TaskID, "worker-1", conversation); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.service.StartOrchestratorWorkerTask(fixture.ctx, fixture.owner.ID, fixture.task.ID, fixture.claim.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.store.WaitChatAgentTask(fixture.claim.TaskID, "worker-1", time.Now().Add(-time.Second), "reclaim", true); err != nil {
		t.Fatal(err)
	}
	reclaimed, err := fixture.store.ClaimChatAgentTaskWithOptions("worker-2", time.Minute, session.ChatAgentClaimOptions{WorkerID: "worker-2", Role: session.ChatAgentRoleWorker})
	if err != nil || reclaimed == nil || reclaimed.TaskID != fixture.claim.TaskID {
		t.Fatalf("reclaimed=%#v err=%v", reclaimed, err)
	}
	request, err := fixture.service.StartOrchestratorWorkerTask(fixture.ctx, fixture.owner.ID, fixture.task.ID, reclaimed.TaskID, "worker-2")
	if err != nil {
		t.Fatal(err)
	}
	if request.ConversationURL != conversation || request.ConversationID != "reclaimed" || request.Task.ConversationID != "reclaimed" {
		t.Fatalf("worker-start affinity=%#v", request)
	}
}
