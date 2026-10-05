package httpapi

import (
	"testing"
	"time"

	"kernl.local/harness/backend/internal/session"
)

func TestReconcileSyncTaskSurfacesTerminalFailureAndAllowsRetry(t *testing.T) {
	sessions := session.NewStore()
	routes, err := New(sessions, t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	project := "/workspace/demo"
	taskID := session.NewChatAgentTaskID()
	queued, err := sessions.EnqueueChatAgentTask(session.ChatAgentTask{
		TaskID: taskID, Type: "UI_TEST_DISCOVER", ProjectID: project,
		ChatID: taskID, MaxAttempts: 1, NotBefore: time.Now().UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := routes.store.SetSyncing(project, queued.TaskID); err != nil {
		t.Fatal(err)
	}
	claimed, err := sessions.ClaimChatAgentTask("worker-1", time.Minute)
	if err != nil || claimed == nil {
		t.Fatalf("claim=%#v err=%v", claimed, err)
	}
	if _, err := sessions.StartChatAgentTask(claimed.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := sessions.FailChatAgentTask(claimed.TaskID, "worker-1", "provider response timed out", false); err != nil {
		t.Fatal(err)
	}

	current, err := routes.store.Load(project)
	if err != nil {
		t.Fatal(err)
	}
	reconciled, err := routes.reconcileSyncTask(project, current)
	if err != nil {
		t.Fatal(err)
	}
	if reconciled.SyncStatus != "failed" || reconciled.SyncError != "provider response timed out" {
		t.Fatalf("reconciled=%#v", reconciled)
	}

	retry, err := routes.store.SetSyncing(project, "cat_retry")
	if err != nil {
		t.Fatal(err)
	}
	if retry.SyncStatus != "syncing" || retry.SyncError != "" {
		t.Fatalf("retry=%#v", retry)
	}
	stale, err := routes.store.FailSync(project, queued.TaskID, "late failure")
	if err != nil {
		t.Fatal(err)
	}
	if stale.SyncStatus != "syncing" || stale.SyncTaskID != "cat_retry" {
		t.Fatalf("stale failure changed newer sync: %#v", stale)
	}
}

func TestReconcileSyncTaskRecoversOrphanedPersistedSync(t *testing.T) {
	sessions := session.NewStore()
	routes, err := New(sessions, t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	project := "/workspace/demo"
	current, err := routes.store.SetSyncing(project, "cat_missing")
	if err != nil {
		t.Fatal(err)
	}
	reconciled, err := routes.reconcileSyncTask(project, current)
	if err != nil {
		t.Fatal(err)
	}
	if reconciled.SyncStatus != "failed" || reconciled.SyncError == "" {
		t.Fatalf("reconciled=%#v", reconciled)
	}
}
