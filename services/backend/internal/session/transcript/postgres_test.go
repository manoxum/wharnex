package transcript_test

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
)

func TestPostgresAppendAndStaleReplacementSerialize(t *testing.T) {
	databaseURL := os.Getenv("WHARNEX_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNEX_TEST_DATABASE_URL is not configured")
	}
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("wharnex_transcript_%d", time.Now().UnixNano())
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
	store, err := session.NewPostgresStore(context.Background(), testURL.String(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	entry := domain.WorkspaceChatItem{ID: "api-request", Payload: map[string]any{"role": "user", "text": "input", "_wharnex_transcript_owned": true}}
	var wg sync.WaitGroup
	errors := make(chan error, 20)
	for i := range 10 {
		wg.Add(2)
		go func() {
			defer wg.Done()
			errors <- store.AppendWorkspaceChatItems("chat", []domain.WorkspaceChatItem{entry})
		}()
		go func() {
			defer wg.Done()
			errors <- store.ReplaceWorkspaceChatItems("chat", []domain.WorkspaceChatItem{{ID: fmt.Sprintf("renderer-%d", i), Payload: map[string]any{"text": "cache"}}})
		}()
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	items, err := store.ListWorkspaceChatItems("chat")
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, item := range items {
		if item.ID == entry.ID {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("concurrent stale replacement lost or duplicated backend prompt: %#v", items)
	}
}
