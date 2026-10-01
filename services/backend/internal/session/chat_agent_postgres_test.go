package session

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"
)

func TestChatAgentAffinityClaimsMatchMemoryAndPostgres(t *testing.T) {
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	schema := fmt.Sprintf("chat_agent_affinity_%d", time.Now().UnixNano())
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`)
	testURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := testURL.Query()
	query.Set("search_path", schema)
	testURL.RawQuery = query.Encode()

	postgres, err := NewPostgresStore(context.Background(), testURL.String(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	memory := NewStore()
	stores := []*Store{memory, postgres}
	for _, store := range stores {
		if _, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:a")); err != nil {
			t.Fatal(err)
		}
		if _, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-b", "conv-b", "await:b")); err != nil {
			t.Fatal(err)
		}
	}
	options := ChatAgentClaimOptions{PreferredLane: "c:conv-b", FallbackMode: ChatAgentClaimResidentOnly}
	var expected string
	for index, store := range stores {
		claimed, err := store.ClaimChatAgentTaskWithOptions(fmt.Sprintf("worker-%d", index+1), 30*time.Second, options)
		if err != nil {
			t.Fatal(err)
		}
		if claimed == nil {
			t.Fatal("affinity claim returned nil")
		}
		if index == 0 {
			expected = claimed.ConversationID
		} else if claimed.ConversationID != expected {
			t.Fatalf("postgres claim=%q memory=%q", claimed.ConversationID, expected)
		}
	}
}

func TestPostgresChatAgentSummaryUsesConversationClaimGuard(t *testing.T) {
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	schema := fmt.Sprintf("chat_agent_summary_%d", time.Now().UnixNano())
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`)
	testURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := testURL.Query()
	query.Set("search_path", schema)
	testURL.RawQuery = query.Encode()

	store, err := NewPostgresStore(context.Background(), testURL.String(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	supervision := testChatAgentTask("AWAIT_RESPONSE", "chat-a", "conv-a", "await:req-1")
	supervision.NotBefore = time.Now().UTC().Add(30 * time.Second)
	if _, err := store.EnqueueChatAgentTask(supervision); err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueChatAgentTask(testChatAgentTask("TITLE_DISCOVER", "chat-a", "conv-a", "title:conv-a")); err != nil {
		t.Fatal(err)
	}

	summary, err := store.ChatAgentQueueSummary("")
	if err != nil {
		t.Fatal(err)
	}
	if summary.Due != 0 || summary.Scheduled != 1 || summary.Guarded != 1 {
		t.Fatalf("due=%d scheduled=%d guarded=%d want 0/1/1", summary.Due, summary.Scheduled, summary.Guarded)
	}
	if summary.OldestDueCreatedAt != nil {
		t.Fatalf("oldest_due_created_at=%v want none", summary.OldestDueCreatedAt)
	}
	claimed, err := store.ClaimChatAgentTask("worker-1", 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if claimed != nil {
		t.Fatalf("guarded title must not be claimed while supervision is deferred: %+v", claimed)
	}
}

func TestPostgresRecordChatAgentValidBundlePersistsProviderTimestamp(t *testing.T) {
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	schema := fmt.Sprintf("chat_agent_valid_bundle_%d", time.Now().UnixNano())
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`)
	testURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := testURL.Query()
	query.Set("search_path", schema)
	testURL.RawQuery = query.Encode()

	store, err := NewPostgresStore(context.Background(), testURL.String(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	state, err := store.RecordChatAgentValidBundle("req-valid-bundle", "conv-valid-bundle", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if state.LastValidBundleAt == nil {
		t.Fatal("last_valid_bundle_at was not persisted")
	}
}

// Translation, planning and release notes belong to the ephemeral pool in both
// stores: Workers never see them, and the summary counts them as its demand.
func TestPostgresEphemeralPoolPartitionMatchesMemory(t *testing.T) {
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	schema := fmt.Sprintf("chat_agent_ephemeral_%d", time.Now().UnixNano())
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`)
	testURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := testURL.Query()
	query.Set("search_path", schema)
	testURL.RawQuery = query.Encode()
	postgres, err := NewPostgresStore(context.Background(), testURL.String(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	for name, store := range map[string]*Store{"memory": NewStore(), "postgres": postgres} {
		for _, taskType := range []string{"ORCHESTRATOR_EXECUTE", "ORCHESTRATOR_PLAN", "RELEASE_NOTES", "TRANSLATE_MARKDOWN"} {
			if _, err := store.EnqueueChatAgentTask(testChatAgentTask(taskType, "chat-"+taskType, "", "ephemeral:"+taskType)); err != nil {
				t.Fatal(err)
			}
		}
		summary, err := store.ChatAgentQueueSummary("")
		if err != nil {
			t.Fatal(err)
		}
		if summary.DueWorker != 1 || summary.DueTranslator != 3 {
			t.Fatalf("%s due_worker=%d due_translator=%d want 1/3", name, summary.DueWorker, summary.DueTranslator)
		}
		worker := ChatAgentClaimOptions{Role: ChatAgentRoleWorker, WorkerID: "worker-1"}
		if claimed, err := store.ClaimChatAgentTaskWithOptions("worker-owner", time.Minute, worker); err != nil || claimed == nil || claimed.Type != "ORCHESTRATOR_EXECUTE" {
			t.Fatalf("%s Worker claim=%#v err=%v", name, claimed, err)
		}
		if claimed, err := store.ClaimChatAgentTaskWithOptions("worker-owner", time.Minute, worker); err != nil || claimed != nil {
			t.Fatalf("%s Worker claimed ephemeral work %#v err=%v", name, claimed, err)
		}
		ephemeral := ChatAgentClaimOptions{Role: ChatAgentRoleTranslator, WorkerID: "translator-1"}
		for range 3 {
			claimed, err := store.ClaimChatAgentTaskWithOptions("translator-owner", time.Minute, ephemeral)
			if err != nil || claimed == nil || !chatAgentTaskEphemeral(claimed.Type) {
				t.Fatalf("%s ephemeral claim=%#v err=%v", name, claimed, err)
			}
		}
	}
}

func TestPostgresOrchestratorTaskChatLaneMatchesMemory(t *testing.T) {
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	schema := fmt.Sprintf("chat_agent_task_chat_%d", time.Now().UnixNano())
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`)
	testURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := testURL.Query()
	query.Set("search_path", schema)
	testURL.RawQuery = query.Encode()
	postgres, err := NewPostgresStore(context.Background(), testURL.String(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	for name, store := range map[string]*Store{"memory": NewStore(), "postgres": postgres} {
		if _, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "otk_20260928T000000_bbbbbbbbbbbbbbbb", "conv-x", "task-await")); err != nil {
			t.Fatal(err)
		}
		if _, err := store.EnqueueChatAgentTask(testChatAgentTask("AWAIT_RESPONSE", "chat-person", "conv-y", "person-await")); err != nil {
			t.Fatal(err)
		}
		summary, err := store.ChatAgentQueueSummary("")
		if err != nil {
			t.Fatal(err)
		}
		if summary.DueSupervisorLanes != 1 || summary.DueWorker != 1 {
			t.Fatalf("%s supervisor_lanes=%d due_worker=%d want 1/1", name, summary.DueSupervisorLanes, summary.DueWorker)
		}
		supervisor, err := store.ClaimChatAgentTaskWithOptions("s", time.Minute, ChatAgentClaimOptions{Role: ChatAgentRoleSupervisor, WorkerID: "supervisor-1"})
		if err != nil || supervisor == nil || supervisor.ChatID != "chat-person" {
			t.Fatalf("%s Supervisor claim=%#v err=%v", name, supervisor, err)
		}
		worker, err := store.ClaimChatAgentTaskWithOptions("w", time.Minute, ChatAgentClaimOptions{Role: ChatAgentRoleWorker, WorkerID: "worker-1", PreferredLane: "h:otk_20260928T000000_bbbbbbbbbbbbbbbb", FallbackMode: ChatAgentClaimResidentOnly})
		if err != nil || worker == nil || worker.ChatID != "otk_20260928T000000_bbbbbbbbbbbbbbbb" {
			t.Fatalf("%s pinned Worker claim=%#v err=%v", name, worker, err)
		}
	}
}
