package app

import (
	"context"
	"net/url"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestManagedArtifactCatalogSearchAndDelete(t *testing.T) {
	store := session.NewStore()
	if err := store.Put(domain.Session{ID: "ses_tools", ProjectPath: "/workspace/alpha", ChatID: "chat_alpha", CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	objects := &memoryArtifactStore{objects: map[string][]byte{}}
	service.SetArtifactStore(objects, 30)

	record, err := service.PersistArtifact(context.Background(), "ses_tools", "req_catalog", "output", "bundle", "alpha-result.zip", "application/zip", testArtifactZIP(t, map[string]string{"turn.json": `{"kind":"change"}`}))
	if err != nil {
		t.Fatal(err)
	}
	items := service.ListManagedArtifacts("alpha-result", true)
	if len(items) != 1 || items[0].SessionID != "ses_tools" || items[0].Artifact.ID != record.ID {
		t.Fatalf("unexpected catalog result: %#v", items)
	}
	if err := service.DeleteManagedArtifact(context.Background(), "ses_tools", record.ID); err != nil {
		t.Fatal(err)
	}
	if got := service.ListManagedArtifacts("", true); len(got) != 0 {
		t.Fatalf("deleted artifact remained in catalog: %#v", got)
	}
	if len(objects.objects) != 0 {
		t.Fatalf("deleted artifact remained in object store: %#v", objects.objects)
	}
}

func TestPostgresDSNValidatesAndEscapesConnection(t *testing.T) {
	dsn, err := postgresDSN(PostgresConnection{Host: "db.internal", Port: 5544, Database: "app data", User: "user@example", Password: "p:/?#", SSLMode: "require"})
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	password, _ := parsed.User.Password()
	if parsed.Host != "db.internal:5544" || parsed.User.Username() != "user@example" || password != "p:/?#" || parsed.Path != "/app data" || parsed.Query().Get("sslmode") != "require" {
		t.Fatalf("unexpected PostgreSQL DSN: %s", dsn)
	}
	if _, err := postgresDSN(PostgresConnection{Host: "db", Port: 70000, Database: "app", User: "user"}); err == nil {
		t.Fatal("expected invalid port to fail")
	}
	if _, err := postgresDSN(PostgresConnection{Host: "db", Database: "app", User: "user", SSLMode: "surprise"}); err == nil {
		t.Fatal("expected invalid sslmode to fail")
	}
}
