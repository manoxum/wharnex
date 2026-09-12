package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
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

func TestExecuteRejectsDuplicateWhileSamePlanIsAlreadyPending(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "single-flight-plan", RequestID: "single-flight-request", Status: "ready", Summary: "single flight", Risk: "low", Operations: []domain.Operation{}}
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
	done := make(chan error, 1)
	go func() {
		_, _, executeErr := service.Execute(context.Background(), started.ID, false)
		done <- executeErr
	}()
	deadline := time.Now().Add(time.Second)
	for {
		current, getErr := service.store.Get(started.ID)
		if getErr != nil {
			t.Fatal(getErr)
		}
		if current.InterruptedExecution != nil && current.InterruptedExecution.PlanID == plan.PlanID {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("first execution did not record its durable intent")
		}
		time.Sleep(5 * time.Millisecond)
	}

	if _, _, err = service.Execute(context.Background(), started.ID, false); err == nil || !strings.Contains(err.Error(), "already has an execution in progress or pending recovery") {
		t.Fatalf("duplicate execution error = %v", err)
	}
	blocker.release()
	if err := <-done; err != nil {
		t.Fatalf("first execution failed after duplicate was rejected: %v", err)
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

func TestInterruptedExecutionResumeIsAsyncAndIdempotent(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "resume-plan", RequestID: "resume-request", Status: "ready", Summary: "resume", Risk: "low", Operations: []domain.Operation{}}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.SubmitMessage(context.Background(), started.ID, "prepare"); err != nil {
		t.Fatal(err)
	}

	blocker, err := service.executionQueue.acquire(context.Background(), root, "initial-blocker")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { _, _, executeErr := service.Execute(ctx, started.ID, false); done <- executeErr }()
	time.Sleep(20 * time.Millisecond)
	cancel()
	if err := <-done; err == nil {
		t.Fatal("cancelled execution should leave an interrupted intent")
	}
	blocker.release()

	resumeBlocker, err := service.executionQueue.acquire(context.Background(), root, "resume-blocker")
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.ResumeInterruptedExecution(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != domain.InterruptedExecutionResuming || first.Session.InterruptedExecution == nil || first.Session.InterruptedExecution.Status != domain.InterruptedExecutionResuming {
		t.Fatalf("resume was not acknowledged immediately: %#v", first)
	}
	deadline := time.Now().Add(time.Second)
	for {
		service.executionQueue.mu.Lock()
		waiters := len(service.executionQueue.projects[filepath.Clean(root)].waiters)
		service.executionQueue.mu.Unlock()
		if waiters == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("asynchronous resume did not enter the project queue")
		}
		time.Sleep(5 * time.Millisecond)
	}
	second, err := service.ResumeInterruptedExecution(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if second.Status != domain.InterruptedExecutionResuming {
		t.Fatalf("duplicate resume status = %q", second.Status)
	}
	time.Sleep(10 * time.Millisecond)
	service.executionQueue.mu.Lock()
	waiters := len(service.executionQueue.projects[filepath.Clean(root)].waiters)
	service.executionQueue.mu.Unlock()
	if waiters != 1 {
		t.Fatalf("duplicate resume queued %d workers, want 1", waiters)
	}
	if _, err := service.DiscardInterruptedExecution(started.ID); !errors.Is(err, ErrExecutionRecoveryInProgress) {
		t.Fatalf("discard while resuming error = %v, want ErrExecutionRecoveryInProgress", err)
	}

	resumeBlocker.release()
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		current, getErr := service.store.Get(started.ID)
		if getErr != nil {
			t.Fatal(getErr)
		}
		if current.InterruptedExecution == nil {
			if current.LastExecution == nil || !current.LastExecution.Success {
				t.Fatalf("resume cleared without successful execution: %#v", current.LastExecution)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("asynchronous resume did not complete")
}
