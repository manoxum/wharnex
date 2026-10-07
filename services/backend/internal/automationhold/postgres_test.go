package automationhold

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestPostgresHoldsKeepIdentityAcrossUpserts(t *testing.T) {
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	ctx := context.Background()
	store, err := OpenPostgres(ctx, databaseURL, testCatalog)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = store.Set(ctx, Hold{Name: ChatGPTUpload}) })
	until := time.Now().UTC().Add(time.Hour).Truncate(time.Microsecond)
	first, err := store.Set(ctx, Hold{Name: ChatGPTUpload, Active: true, Until: &until, Level: 2, Reason: "consecutive-not-started", Source: "desktop"})
	if err != nil {
		t.Fatal(err)
	}
	if !first.InForce(time.Now()) || first.Level != 2 || first.Until == nil || !first.Until.Equal(until) || first.UID == "" {
		t.Fatalf("unexpected stored hold %+v", first)
	}
	released, err := store.Set(ctx, Hold{Name: ChatGPTUpload, Active: false, Reason: "ignored"})
	if err != nil {
		t.Fatal(err)
	}
	if released.Active || released.Until != nil || released.Reason != "" || released.UID != first.UID {
		t.Fatalf("an upsert must update content in place and keep identity: first=%+v released=%+v", first, released)
	}
	t.Cleanup(func() { _, _ = store.Set(ctx, Hold{Name: TaskHold("RENAME_CHAT")}) })
	if _, err := store.Set(ctx, Hold{Name: TaskHold("RENAME_CHAT"), Active: false}); err != nil {
		t.Fatal(err)
	}
	holds, err := TaskHolds(ctx, store, testCatalog)
	if err != nil || holds["RENAME_CHAT"].Active || holds["RENAME_CHAT"].Default || !holds["BOT_WRITE"].Default {
		t.Fatalf("stored task holds must replace defaults: %+v err=%v", holds, err)
	}
	assertIdentityColumns(t, store)
}

// assertIdentityColumns proves the table follows SoT/DATABASE_IDENTIFIERS.md:
// id bigint is the sole primary key, sid text and uid uuid are non-null unique.
func assertIdentityColumns(t *testing.T, store *Postgres) {
	t.Helper()
	var primary string
	if err := store.db.QueryRow(`SELECT string_agg(a.attname, ',') FROM pg_index i
		JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
		WHERE i.indrelid='wharnex_automation_holds'::regclass AND i.indisprimary`).Scan(&primary); err != nil || primary != "id" {
		t.Fatalf("primary key=%q err=%v", primary, err)
	}
	for column, kind := range map[string]string{"id": "bigint", "sid": "text", "uid": "uuid"} {
		var dataType, nullable string
		var unique bool
		err := store.db.QueryRow(`SELECT c.data_type, c.is_nullable, EXISTS (SELECT 1 FROM pg_index i
			JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
			WHERE i.indrelid='wharnex_automation_holds'::regclass AND i.indisunique AND i.indnatts=1 AND a.attname=c.column_name)
			FROM information_schema.columns c WHERE c.table_name='wharnex_automation_holds' AND c.column_name=$1`, column).
			Scan(&dataType, &nullable, &unique)
		if err != nil || dataType != kind || nullable != "NO" || !unique {
			t.Fatalf("%s: type=%s nullable=%s unique=%v err=%v", column, dataType, nullable, unique, err)
		}
	}
}
