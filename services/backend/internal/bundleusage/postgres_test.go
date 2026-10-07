package bundleusage_test

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/bundleusage"
	"kernl.local/harness/backend/internal/oplog"
	"kernl.local/harness/backend/internal/session"
)

func TestPersistedTransportWindowIncludesMoreThanOneLogPageAndSurvivesRestart(t *testing.T) {
	dsn := os.Getenv("WHARNESS_TEST_DATABASE_URL") // Existing test environment boundary.
	if dsn == "" {
		t.Skip("database integration configuration is absent")
	}
	ctx := context.Background()
	admin, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Close() })
	schema := fmt.Sprintf("bundle_usage_test_%d", time.Now().UnixNano())
	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`) })
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	store, err := session.NewPostgresStore(ctx, parsed.String(), "")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	task, err := store.EnqueueChatAgentTask(session.ChatAgentTask{Type: "UI_TEST_RUN", Source: "ui-testing", ProjectID: "project", ChatID: "ui-test-chat"})
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	records := make([]oplog.Record, 1205)
	for i := range records {
		records[i] = oplog.Record{Source: "desktop", Component: "chatgpt-upload", Event: "chatgpt-upload", TaskID: task.TaskID, Message: "confirmed wc=1 file=1/1 observed=true", OccurredAt: now.Add(-time.Minute), Data: map[string]any{"observed": true}}
		records[i].Normalize(now)
	}
	if err := store.AppendOperationalLog(ctx, records); err != nil {
		store.Close()
		t.Fatal(err)
	}
	store.Close()
	store, err = session.NewPostgresStore(ctx, parsed.String(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	got, persisted, err := store.BundleTransportUsage(ctx, now.Add(-3*time.Hour), now)
	if err != nil || !persisted || len(got) != 1 || got[0] != (bundleusage.Counts{Type: "UI_TEST_RUN", Sent: 1205, Total: 1205}) {
		t.Fatalf("persisted unpaginated window after restart = %#v, persisted=%v, error=%v", got, persisted, err)
	}
}
