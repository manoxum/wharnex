package sessionvault

import (
	"context"
	"os"
	"testing"
	"time"
)

func exerciseVault(t *testing.T, vault Vault, project string) {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	first, err := vault.Save(ctx, Snapshot{Project: project, EnvironmentID: "web", TestID: "login", ProfileID: "admin", Origin: "https://app.test",
		Covers: []string{"login"}, Digests: map[string]string{"login": "d1"}, Sealed: "sealed-1", CapturedAt: now, ExpiresAt: now.Add(TTL)})
	if err != nil || first.SID == "" {
		t.Fatalf("first=%#v err=%v", first, err)
	}
	second, err := vault.Save(ctx, Snapshot{Project: project, EnvironmentID: "web", TestID: "login", ProfileID: "admin", Origin: "https://app.test",
		Covers: []string{"login"}, Digests: map[string]string{"login": "d2"}, Sealed: "sealed-2", CapturedAt: now.Add(time.Second), ExpiresAt: now.Add(TTL)})
	if err != nil || second.SID != first.SID {
		t.Fatalf("replacement must keep identity: first=%s second=%s err=%v", first.SID, second.SID, err)
	}
	got, err := vault.Get(ctx, project, first.SID)
	if err != nil || got.Sealed != "sealed-2" || got.Digests["login"] != "d2" {
		t.Fatalf("got=%#v err=%v", got, err)
	}
	if _, err := vault.Get(ctx, "/other", first.SID); err != ErrNotFound {
		t.Fatalf("snapshot leaked across projects: %v", err)
	}
	if _, err := vault.Save(ctx, Snapshot{Project: project, EnvironmentID: "web", TestID: "stale", Origin: "https://app.test",
		Sealed: "old", CapturedAt: now.Add(-2 * TTL), ExpiresAt: now.Add(-TTL)}); err != nil {
		t.Fatal(err)
	}
	listed, err := vault.List(ctx, project, now)
	if err != nil || len(listed) != 1 || listed[0].TestID != "login" {
		t.Fatalf("expired snapshots must not be listed: %#v err=%v", listed, err)
	}
	if err := vault.Prune(ctx, now); err != nil {
		t.Fatal(err)
	}
	if removed, err := vault.Delete(ctx, project, Filter{EnvironmentID: "web", ProfileID: "admin"}); err != nil || removed != 1 {
		t.Fatalf("removed=%d err=%v", removed, err)
	}
	if _, err := vault.Get(ctx, project, first.SID); err != ErrNotFound {
		t.Fatalf("deleted snapshot still readable: %v", err)
	}
}

func TestMemoryVault(t *testing.T) { exerciseVault(t, NewMemory(), "/workspace/demo") }

func TestPostgresVault(t *testing.T) {
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	vault, err := OpenPostgres(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	project := "/workspace/vault-" + NewSID()
	t.Cleanup(func() { _, _ = vault.Delete(context.Background(), project, Filter{}) })
	exerciseVault(t, vault, project)
	assertIdentityColumns(t, vault)
}

// assertIdentityColumns proves the table follows SoT/DATABASE_IDENTIFIERS.md:
// id bigint is the sole primary key, sid text and uid uuid are non-null unique.
func assertIdentityColumns(t *testing.T, vault *Postgres) {
	t.Helper()
	var primary string
	if err := vault.db.QueryRow(`SELECT string_agg(a.attname, ',') FROM pg_index i
		JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
		WHERE i.indrelid='wharnex_ui_test_sessions'::regclass AND i.indisprimary`).Scan(&primary); err != nil || primary != "id" {
		t.Fatalf("primary key=%q err=%v", primary, err)
	}
	for column, kind := range map[string]string{"id": "bigint", "sid": "text", "uid": "uuid"} {
		var dataType, nullable string
		var unique bool
		err := vault.db.QueryRow(`SELECT c.data_type, c.is_nullable, EXISTS (SELECT 1 FROM pg_index i
			JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
			WHERE i.indrelid='wharnex_ui_test_sessions'::regclass AND i.indisunique AND i.indnatts=1 AND a.attname=c.column_name)
			FROM information_schema.columns c WHERE c.table_name='wharnex_ui_test_sessions' AND c.column_name=$1`, column).Scan(&dataType, &nullable, &unique)
		if err != nil || dataType != kind || nullable != "NO" || !unique {
			t.Fatalf("%s: type=%s nullable=%s unique=%v err=%v", column, dataType, nullable, unique, err)
		}
	}
}
