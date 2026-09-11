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
