package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestProjectExecutionQueueIsFIFO(t *testing.T) {
	queue := newProjectExecutionQueue()
	first, err := queue.acquire(context.Background(), "/project", "session-1")
	if err != nil {
		t.Fatal(err)
	}
	type acquired struct {
		session string
		ticket  executionQueueTicket
	}
	results := make(chan acquired, 2)
	for _, sessionID := range []string{"session-2", "session-3"} {
		go func(id string) {
			ticket, acquireErr := queue.acquire(context.Background(), "/project", id)
			if acquireErr == nil {
				results <- acquired{id, ticket}
			}
		}(sessionID)
		time.Sleep(10 * time.Millisecond)
	}
	select {
	case result := <-results:
		t.Fatalf("%s bypassed active execution", result.session)
	default:
	}
	first.release()
	second := <-results
	if second.session != "session-2" {
		t.Fatalf("first waiter = %s, want session-2", second.session)
	}
	second.ticket.release()
	third := <-results
	if third.session != "session-3" {
		t.Fatalf("second waiter = %s, want session-3", third.session)
	}
	third.ticket.release()
}

func TestCancelledQueuedExecutionRemainsRecoverableUntilExplicitDiscard(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "recover-plan", RequestID: "recover-request", Status: "ready", Summary: "recover", Risk: "low", Operations: []domain.Operation{}}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.SubmitMessage(context.Background(), started.ID, "prepare"); err != nil {
		t.Fatal(err)
	}
	blocker, err := service.executionQueue.acquire(context.Background(), root, "blocker")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, _, executeErr := service.Execute(ctx, started.ID, false); done <- executeErr }()
	time.Sleep(20 * time.Millisecond)
	cancel()
	if err := <-done; err == nil {
		t.Fatal("cancelled queued execution should fail")
	}
	blocker.release()
	pending, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if pending.InterruptedExecution == nil || pending.InterruptedExecution.PlanID != plan.PlanID {
		t.Fatalf("execution intent was not retained: %#v", pending.InterruptedExecution)
	}
	discarded, err := service.DiscardInterruptedExecution(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if discarded.InterruptedExecution != nil {
		t.Fatalf("discard did not clear execution intent: %#v", discarded.InterruptedExecution)
	}
}

func TestProjectExecutionQueueAllowsDifferentProjects(t *testing.T) {
	queue := newProjectExecutionQueue()
	first, err := queue.acquire(context.Background(), "/project-a", "session-1")
	if err != nil {
		t.Fatal(err)
	}
	defer first.release()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	second, err := queue.acquire(ctx, "/project-b", "session-2")
	if err != nil {
		t.Fatalf("independent project was blocked: %v", err)
	}
	second.release()
}

func TestProjectExecutionQueueRemovesCancelledWaiter(t *testing.T) {
	queue := newProjectExecutionQueue()
	first, err := queue.acquire(context.Background(), "/project", "session-1")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, acquireErr := queue.acquire(ctx, "/project", "session-2"); done <- acquireErr }()
	time.Sleep(10 * time.Millisecond)
	cancel()
	if err := <-done; err == nil {
		t.Fatal("cancelled waiter acquired queue")
	}
	first.release()
	third, err := queue.acquire(context.Background(), "/project", "session-3")
	if err != nil {
		t.Fatal(err)
	}
	third.release()
}
