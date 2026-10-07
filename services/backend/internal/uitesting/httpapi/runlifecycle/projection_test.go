package runlifecycle_test

import (
	"testing"
	"time"

	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/httpapi/runlifecycle"
)

type taskSet map[string]session.ChatAgentTask

func (tasks taskSet) GetChatAgentTask(id string) (session.ChatAgentTask, error) {
	if task, ok := tasks[id]; ok {
		return task, nil
	}
	return session.ChatAgentTask{}, session.ErrChatAgentTaskNotFound
}
func projectionStore(t *testing.T) (*uitesting.Store, string) {
	t.Helper()
	store, err := uitesting.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	project := t.TempDir()
	_, err = store.SaveDiscovery(project, uitesting.Discovery{Environments: []uitesting.Environment{{ID: "web", Name: "Web"}}, Tests: []uitesting.TestCase{{ID: "open", Title: "Open", Goal: "Open", EnvironmentID: "web", Access: "public"}}})
	if err != nil {
		t.Fatal(err)
	}
	return store, project
}

func TestOldCancelledRunDoesNotOverwriteNewSuccessfulOutcome(t *testing.T) {
	store, project := projectionStore(t)
	now := time.Now().UTC()
	_, err := store.BeginRun(project, uitesting.Run{ID: "run_old", TaskID: "old", TestID: "open", Status: "queued", StartedAt: now.Add(-time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.BeginRun(project, uitesting.Run{ID: "run_new", TaskID: "new", TestID: "open", Status: "queued", StartedAt: now})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.CompleteRun(project, uitesting.Run{ID: "run_new"}, uitesting.RunResult{Status: "passed"})
	if err != nil {
		t.Fatal(err)
	}
	tasks := taskSet{"old": {Status: session.ChatAgentTaskCancelled}, "new": {Status: session.ChatAgentTaskDone}}
	for i := 0; i < 2; i++ {
		doc, err := store.Load(project)
		if err != nil {
			t.Fatal(err)
		}
		doc, err = runlifecycle.Reconcile(project, doc, tasks, store, now)
		if err != nil {
			t.Fatal(err)
		}
		if doc.Tests[0].Status != "passed" || doc.Tests[0].LastRunID != "run_new" {
			t.Fatalf("refresh %d resurrected old outcome: %#v", i, doc.Tests[0])
		}
	}
}

func TestExpiredWorkerLeaseIsNotRunning(t *testing.T) {
	store, project := projectionStore(t)
	now := time.Now().UTC()
	expired := now.Add(-time.Second)
	doc, err := store.BeginRun(project, uitesting.Run{ID: "run_expired", TaskID: "expired", TestID: "open", Status: "queued", StartedAt: now})
	if err != nil {
		t.Fatal(err)
	}
	tasks := taskSet{"expired": {Status: session.ChatAgentTaskRunning, LeaseOwner: "worker-1", LeaseExpiresAt: &expired}}
	doc, err = runlifecycle.Reconcile(project, doc, tasks, store, now)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Tests[0].Status == "running" || doc.Runs[0].Status == "running" {
		t.Fatal("expired lease is shown as active")
	}
}

func TestTrimmedRunHistoryDoesNotLeaveCatalogRunning(t *testing.T) {
	store, project := projectionStore(t)
	now := time.Now().UTC()
	doc, err := store.Load(project)
	if err != nil {
		t.Fatal(err)
	}
	doc.Tests[0].Status, doc.Tests[0].LastRunID = "running", "run_trimmed"
	doc, err = runlifecycle.Reconcile(project, doc, taskSet{}, store, now)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Tests[0].Status == "running" {
		t.Fatal("trimmed history left stale running status")
	}
}

func TestCompletionWithEqualTimestampKeepsNewestRun(t *testing.T) {
	store, project := projectionStore(t)
	now := time.Now().UTC()
	_, err := store.BeginRun(project,
		uitesting.Run{ID: "run_old", TestID: "open", Status: "queued", StartedAt: now},
		uitesting.Run{ID: "run_new", TestID: "open", Status: "queued", StartedAt: now})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CompleteRun(project, uitesting.Run{ID: "run_new"}, uitesting.RunResult{Status: "passed"}); err != nil {
		t.Fatal(err)
	}
	doc, err := store.CompleteRun(project, uitesting.Run{ID: "run_old"}, uitesting.RunResult{Status: "failed"})
	if err != nil {
		t.Fatal(err)
	}
	if doc.Tests[0].Status != "passed" || doc.Tests[0].LastRunID != "run_new" {
		t.Fatalf("old completion replaced the newest outcome: %#v", doc.Tests[0])
	}
}
