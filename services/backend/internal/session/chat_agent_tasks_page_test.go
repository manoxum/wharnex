package session

import (
	"testing"
	"time"
)

func TestUnifiedTaskPageContractMemory(t *testing.T) {
	runUnifiedTaskPageContract(t, NewStore())
}

func runUnifiedTaskPageContract(t *testing.T, store *Store) {
	t.Helper()
	base := time.Date(2026, time.September, 28, 3, 0, 0, 0, time.UTC)
	seed := []ChatAgentTask{
		{TaskID: "active-pending", ProjectID: "/project/a", Status: ChatAgentTaskPending, UpdatedAt: base.Add(9 * time.Hour)},
		{TaskID: "active-attention", ProjectID: "/project/a", Status: ChatAgentTaskAttention, UpdatedAt: base.Add(8 * time.Hour)},
		{TaskID: "active-failed", ProjectID: "/project/a", Status: ChatAgentTaskFailed, UpdatedAt: base.Add(7 * time.Hour)},
		{TaskID: "hist-new", ProjectID: "/project/a", Status: "COMPLETE", UpdatedAt: base.Add(6 * time.Hour)},
		{TaskID: "hist-tie-z", ProjectID: "/project/a", Status: ChatAgentTaskDone, UpdatedAt: base.Add(5 * time.Hour)},
		{TaskID: "hist-tie-a", ProjectID: "/project/a", Status: "ARCHIVED", UpdatedAt: base.Add(5 * time.Hour)},
		{TaskID: "hist-old", ProjectID: "/project/a", Status: ChatAgentTaskCancelled, UpdatedAt: base.Add(4 * time.Hour)},
		{TaskID: "other-project", ProjectID: "/project/b", Status: ChatAgentTaskAttention, UpdatedAt: base.Add(10 * time.Hour)},
	}
	seedUnifiedTaskPageStore(t, store, seed)

	active, err := store.ListUnifiedTaskPage(UnifiedTaskPageFilter{ProjectID: "/project/a", Scope: UnifiedTaskScopeActive})
	if err != nil {
		t.Fatal(err)
	}
	if len(active.Tasks) != 3 || active.HasMore || active.NextCursor != "" {
		t.Fatalf("active page=%#v", active)
	}
	wantActive := []string{"active-pending", "active-attention", "active-failed"}
	for index, id := range wantActive {
		if active.Tasks[index].TaskID != id {
			t.Fatalf("active[%d]=%s want %s", index, active.Tasks[index].TaskID, id)
		}
	}

	attention, err := store.ListUnifiedTaskPage(UnifiedTaskPageFilter{ProjectID: "/project/a", Scope: UnifiedTaskScopeActive, Status: ChatAgentTaskAttention})
	if err != nil {
		t.Fatal(err)
	}
	if len(attention.Tasks) != 1 || attention.Tasks[0].TaskID != "active-attention" {
		t.Fatalf("attention page=%#v", attention)
	}

	first, err := store.ListUnifiedTaskPage(UnifiedTaskPageFilter{ProjectID: "/project/a", Scope: UnifiedTaskScopeHistory, Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Tasks) != 2 || !first.HasMore || first.NextCursor == "" {
		t.Fatalf("first history page=%#v", first)
	}
	if first.Tasks[0].TaskID != "hist-new" || first.Tasks[1].TaskID != "hist-tie-z" {
		t.Fatalf("first history order=%#v", first.Tasks)
	}

	seedUnifiedTaskPageStore(t, store, []ChatAgentTask{{TaskID: "hist-concurrent", ProjectID: "/project/a", Status: "COMPLETE", UpdatedAt: base.Add(11 * time.Hour)}})
	second, err := store.ListUnifiedTaskPage(UnifiedTaskPageFilter{ProjectID: "/project/a", Scope: UnifiedTaskScopeHistory, Limit: 2, Cursor: first.NextCursor})
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Tasks) != 2 || second.Tasks[0].TaskID != "hist-tie-a" || second.Tasks[1].TaskID != "hist-old" {
		t.Fatalf("second history page=%#v", second)
	}
	seen := map[string]bool{}
	for _, task := range append(append([]ChatAgentTask(nil), first.Tasks...), second.Tasks...) {
		if seen[task.TaskID] {
			t.Fatalf("task %s duplicated across pages", task.TaskID)
		}
		seen[task.TaskID] = true
	}
	if seen["hist-concurrent"] {
		t.Fatalf("newer concurrent task leaked behind cursor: %#v", second.Tasks)
	}

	archived, err := store.ListUnifiedTaskPage(UnifiedTaskPageFilter{ProjectID: "/project/a", Scope: UnifiedTaskScopeHistory, Status: "ARCHIVED", Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(archived.Tasks) != 1 || archived.Tasks[0].TaskID != "hist-tie-a" {
		t.Fatalf("archived page=%#v", archived)
	}
}

func TestUnifiedTaskPageFilterValidation(t *testing.T) {
	if _, _, err := normalizeUnifiedTaskPageFilter(UnifiedTaskPageFilter{ProjectID: "/project/a", Scope: UnifiedTaskScopeHistory}); err == nil {
		t.Fatal("history without an explicit limit was accepted")
	}
	if _, _, err := normalizeUnifiedTaskPageFilter(UnifiedTaskPageFilter{ProjectID: "/project/a", Scope: UnifiedTaskScopeActive, Status: "COMPLETE"}); err == nil {
		t.Fatal("history status was accepted in active scope")
	}
	if _, _, err := normalizeUnifiedTaskPageFilter(UnifiedTaskPageFilter{ProjectID: "/project/a", Scope: UnifiedTaskScopeActive, Cursor: "not-a-cursor"}); err == nil {
		t.Fatal("invalid cursor was accepted")
	}
	filter, _, err := normalizeUnifiedTaskPageFilter(UnifiedTaskPageFilter{ProjectID: "/project/a", Scope: UnifiedTaskScopeActive, Limit: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if filter.Limit != maxUnifiedTaskPageLimit {
		t.Fatalf("limit=%d want %d", filter.Limit, maxUnifiedTaskPageLimit)
	}
}

func seedUnifiedTaskPageStore(t *testing.T, store *Store, tasks []ChatAgentTask) {
	t.Helper()
	if store.db != nil {
		for _, task := range tasks {
			_, err := store.db.Exec(`INSERT INTO harness_tasks (task_id,type,source,project_id,chat_id,status,not_before,payload,created_at,updated_at)
				VALUES ($1,'BOT_WRITE','chat',$2,$3,$4,$5,'{}'::jsonb,$5,$5)`, task.TaskID, task.ProjectID, task.TaskID, task.Status, task.UpdatedAt)
			if err != nil {
				t.Fatal(err)
			}
		}
		return
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	fallback := store.chatAgentFallback()
	for _, task := range tasks {
		fallback[task.TaskID] = task
	}
}
