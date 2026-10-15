package residency_test

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
)

func TestOversizedStoreSessionRemainsWholeOnReadAndWriteWithoutRetention(t *testing.T) {
	databaseURL := os.Getenv("WHARNESS_TEST_DATABASE_URL") // Existing test compatibility boundary.
	if databaseURL == "" {
		t.Skip("WHARNESS_TEST_DATABASE_URL is not configured")
	}
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("residency_test_%d", time.Now().UnixNano())
	t.Cleanup(func() { admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`); admin.Close() })
	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}
	connection, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := connection.Query()
	query.Set("search_path", schema)
	connection.RawQuery = query.Encode()
	store, err := session.NewPostgresStore(context.Background(), connection.String(), "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	item := domain.Session{ID: "ses_oversized", ProjectPath: "/tmp/fixture", State: "ready", CreatedAt: time.Now().UTC()}
	// One synthetic entry isolates payload admission from map cardinality and
	// requires no filesystem or command execution. The persisted value stays intact.
	item.Context.Manifest.Files = []domain.ContextFile{{Path: strings.Repeat("x", 17<<20)}}
	item.RequestSupportArtifacts = map[string][]domain.RequestSupportArtifact{
		"req": {{Path: "conflict/capsule.json", Content: []byte("fixture capsule")}},
	}
	if err := store.Put(item); err != nil {
		t.Fatal(err)
	}
	assertSlim := func() {
		t.Helper()
		if got := store.List(); len(got) != 1 || len(got[0].Context.Manifest.Files) != 0 {
			t.Fatal("oversized aggregate stayed resident whole")
		}
		if store.List()[0].RequestSupportArtifacts != nil {
			t.Fatal("cold scan view retained support artifact bytes")
		}
	}
	assertSlim()
	full, err := store.Get(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(full.Context.Manifest.Files) != 1 || full.Context.Manifest.Files[0].Path != item.Context.Manifest.Files[0].Path {
		t.Fatal("hydration lost persisted context")
	}
	assertSlim()
	if string(full.RequestSupportArtifacts["req"][0].Content) != "fixture capsule" {
		t.Fatal("hydration lost support artifact bytes")
	}
	updated, err := store.Update(item.ID, func(current *domain.Session) error { current.State = "applied"; return nil })
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Context.Manifest.Files) != 1 {
		t.Fatal("update returned a slim view")
	}
	assertSlim()
	full, err = store.Get(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if full.State != "applied" || full.Context.Manifest.Files[0].Path != item.Context.Manifest.Files[0].Path {
		t.Fatal("update persisted the slim projection over the durable aggregate")
	}
	if string(full.RequestSupportArtifacts["req"][0].Content) != "fixture capsule" {
		t.Fatal("update lost durable support artifact bytes")
	}
	reopened, err := session.NewPostgresStore(context.Background(), connection.String(), "")
	if err != nil { t.Fatal(err) }
	defer reopened.Close()
	if reopened.List()[0].RequestSupportArtifacts != nil {
		t.Fatal("startup SQL projection decoded historical support artifacts")
	}
}
