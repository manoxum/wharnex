package session

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/oplog"
)

func operationalLogTestStore(t *testing.T) *Store {
	t.Helper()
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	schema := fmt.Sprintf("oplog_test_%d", time.Now().UnixNano())
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Close() })
	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`) })
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
	t.Cleanup(func() { store.Close() })
	return store
}

func TestOperationalLogPersistsQueriesAndExpiresByRetention(t *testing.T) {
	store := operationalLogTestStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	records := []oplog.Record{
		{Event: "execution.failed", RequestID: "req_1", ChatID: "chat_1", OccurredAt: now.Add(-time.Hour)},
		{Event: "command.output", RequestID: "req_1", OccurredAt: now.Add(-4 * 24 * time.Hour)},
		{Event: "host.apply_started", RequestID: "req_2", OccurredAt: now.Add(-16 * 24 * time.Hour)},
		{Source: oplog.SourceDesktop, Event: "chatgpt-upload", Level: oplog.LevelWarning, Message: "slow upload", OccurredAt: now.Add(-time.Minute)},
	}
	for i := range records {
		records[i].Normalize(now)
	}
	if err := store.AppendOperationalLog(ctx, records); err != nil {
		t.Fatal(err)
	}
	failures, err := store.QueryOperationalLog(ctx, oplog.Filter{RequestID: "req_1", MinLevel: oplog.LevelWarning})
	if err != nil || len(failures) != 1 || failures[0].Event != "execution.failed" {
		t.Fatalf("request/level filter failed: %#v err=%v", failures, err)
	}
	desktop, err := store.QueryOperationalLog(ctx, oplog.Filter{Source: oplog.SourceDesktop, Search: "slow"})
	if err != nil || len(desktop) != 1 {
		t.Fatalf("source/search filter failed: %#v err=%v", desktop, err)
	}

	for _, event := range []domain.Event{
		{ID: "evt_noise_old", SessionID: "ses", Type: "command.output", Timestamp: now.Add(-16 * 24 * time.Hour)},
		{ID: "evt_ledger_old", SessionID: "ses", Type: "execution.recorded", Timestamp: now.Add(-16 * 24 * time.Hour)},
		{ID: "evt_noise_new", SessionID: "ses", Type: "command.output", Timestamp: now.Add(-time.Hour)},
	} {
		if err := store.AppendEvent(event); err != nil {
			t.Fatal(err)
		}
	}
	removedLogs, removedEvents, err := store.PruneOperationalLog(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if removedLogs != 2 || removedEvents != 1 {
		t.Fatalf("retention removed logs=%d events=%d, want 2 (debug >3d, any >15d) and 1 (old ledger noise)", removedLogs, removedEvents)
	}
	history, err := store.EventHistory("ses")
	if err != nil || len(history) != 2 {
		t.Fatalf("the plan/execution ledger must survive age-based sweeping: %#v err=%v", history, err)
	}
}
