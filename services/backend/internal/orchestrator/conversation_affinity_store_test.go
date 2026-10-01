package orchestrator

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"
)

const (
	testConversationURL = "https://chatgpt.com/c/task-affinity"
	testConversationID  = "task-affinity"
)

func TestTaskConversationAffinitySurvivesLifecycleAndMemoryReconstruction(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	base := time.Date(2026, time.September, 28, 15, 0, 0, 0, time.UTC)
	task := Task{
		ID: "task-affinity-memory", ProjectPath: "/project/a", Title: "Affinity",
		Status: TaskDoing, ConversationURL: testConversationURL, ConversationID: testConversationID,
		CreatedAt: base, UpdatedAt: base,
	}
	for index, status := range []TaskStatus{TaskDoing, TaskReview, TaskComplete, TaskArchived} {
		task.Status = status
		if index == 1 {
			task.ConversationURL, task.ConversationID = "", ""
		}
		if index == 2 {
			task.ConversationURL, task.ConversationID = "https://chatgpt.com/c/other", "other"
		}
		task.UpdatedAt = base.Add(time.Duration(index) * time.Minute)
		if err := store.PutTask(ctx, task); err != nil {
			t.Fatal(err)
		}
		stored, err := store.GetTask(ctx, task.ID)
		if err != nil || stored.ConversationURL != testConversationURL || stored.ConversationID != testConversationID {
			t.Fatalf("status=%s affinity=%#v err=%v", status, stored, err)
		}
		task = stored
	}
	payload, err := json.Marshal(task)
	if err != nil {
		t.Fatal(err)
	}
	var restored Task
	if err := json.Unmarshal(payload, &restored); err != nil {
		t.Fatal(err)
	}
	restarted := NewMemoryStore()
	if err := restarted.PutTask(ctx, restored); err != nil {
		t.Fatal(err)
	}
	stored, err := restarted.GetTask(ctx, restored.ID)
	if err != nil || stored.ConversationURL != testConversationURL || stored.ConversationID != testConversationID {
		t.Fatalf("reconstructed affinity=%#v err=%v", stored, err)
	}
}

func TestPostgresTaskConversationAffinitySurvivesReopen(t *testing.T) {
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	schema := fmt.Sprintf("orchestrator_affinity_%d", time.Now().UnixNano())
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`)
		_ = admin.Close()
	})
	testURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := testURL.Query()
	query.Set("search_path", schema)
	testURL.RawQuery = query.Encode()
	ctx := context.Background()
	store, err := NewPostgresStore(ctx, testURL.String())
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, time.September, 28, 16, 0, 0, 0, time.UTC)
	task := Task{
		ID: "task-affinity-postgres", ProjectPath: "/project/a", Title: "Persistent affinity",
		Status: TaskFailed, ConversationURL: testConversationURL, ConversationID: testConversationID,
		CreatedAt: base, UpdatedAt: base,
	}
	if err := store.PutTask(ctx, task); err != nil {
		_ = store.Close()
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewPostgresStore(ctx, testURL.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = restarted.Close() })
	reloaded, err := restarted.GetTask(ctx, task.ID)
	if err != nil || reloaded.ConversationURL != testConversationURL || reloaded.ConversationID != testConversationID {
		t.Fatalf("reopened affinity=%#v err=%v", reloaded, err)
	}
	reloaded.Status = TaskArchived
	reloaded.ConversationURL = "https://chatgpt.com/c/other"
	reloaded.ConversationID = "other"
	reloaded.UpdatedAt = base.Add(time.Hour)
	if err := restarted.PutTask(ctx, reloaded); err != nil {
		t.Fatal(err)
	}
	archived, err := restarted.GetTask(ctx, task.ID)
	if err != nil || archived.ConversationURL != testConversationURL || archived.ConversationID != testConversationID {
		t.Fatalf("archived affinity=%#v err=%v", archived, err)
	}
}
