package app

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
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

type memoryArtifactStore struct {
	objects map[string][]byte
}

func (m *memoryArtifactStore) Put(_ context.Context, key, _ string, raw []byte) error {
	m.objects[key] = append([]byte(nil), raw...)
	return nil
}
func (m *memoryArtifactStore) Get(_ context.Context, key string) ([]byte, string, error) {
	raw, ok := m.objects[key]
	if !ok {
		return nil, "", errors.New("missing object")
	}
	return append([]byte(nil), raw...), "application/zip", nil
}
func (m *memoryArtifactStore) Delete(_ context.Context, key string) error {
	delete(m.objects, key)
	return nil
}

func TestArtifactLifecycleExploresAndCleansBundle(t *testing.T) {
	store := session.NewStore()
	if err := store.Put(domain.Session{ID: "ses_artifacts", ProjectPath: t.TempDir(), CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	objects := &memoryArtifactStore{objects: map[string][]byte{}}
	service.SetArtifactStore(objects, 30)

	bundle := testArtifactZIP(t, map[string]string{"prompt/request.md": "pedido", "turn.json": `{"kind":"change"}`})
	record, err := service.PersistArtifact(context.Background(), "ses_artifacts", "req_12345678", "input", "bundle", "input.zip", "application/zip", bundle)
	if err != nil {
		t.Fatal(err)
	}
	if !record.Bundle || record.EntryCount != 2 || record.Size != int64(len(bundle)) {
		t.Fatalf("unexpected bundle metadata: %#v", record)
	}
	entries, err := service.ArtifactEntries(context.Background(), "ses_artifacts", record.ID)
	if err != nil || len(entries) != 2 {
		t.Fatalf("unexpected entries: %#v err=%v", entries, err)
	}
	raw, name, err := service.ReadArtifactEntry(context.Background(), "ses_artifacts", record.ID, "turn.json")
	if err != nil || name != "turn.json" || string(raw) != `{"kind":"change"}` {
		t.Fatalf("unexpected entry: name=%q raw=%q err=%v", name, raw, err)
	}
	if err := service.CleanupArtifacts(context.Background(), time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if artifacts, err := service.ListArtifacts("ses_artifacts"); err != nil || len(artifacts) != 0 {
		t.Fatalf("artifact metadata was not cleaned: %#v err=%v", artifacts, err)
	}
	if len(objects.objects) != 0 {
		t.Fatalf("artifact object was not deleted: %#v", objects.objects)
	}
}

func testArtifactZIP(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, body := range files {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
