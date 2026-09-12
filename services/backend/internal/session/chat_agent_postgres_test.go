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

	summary, err := store.ChatAgentQueueSummary()
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
