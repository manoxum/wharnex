package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
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

// flakyArtifactStore wraps memoryArtifactStore to make Delete fail exactly
// once for a chosen key, exercising the crash-safety retry path.
type flakyArtifactStore struct {
	*memoryArtifactStore
	failDeleteOnce map[string]bool
}

func (f *flakyArtifactStore) Delete(ctx context.Context, key string) error {
	if f.failDeleteOnce[key] {
		delete(f.failDeleteOnce, key)
		return errors.New("simulated delete failure")
	}
	return f.memoryArtifactStore.Delete(ctx, key)
}

func newChatArchiveTestService(t *testing.T) (*Service, *session.Store, *memoryArtifactStore) {
	t.Helper()
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	objects := &memoryArtifactStore{objects: map[string][]byte{}}
	service.SetArtifactStore(objects, 30)
	return service, store, objects
}

func TestArchiveChatIsInstantIdempotentStateFlip(t *testing.T) {
	service, store, _ := newChatArchiveTestService(t)
	if err := store.Put(domain.Session{ID: "ses_1", ProjectPath: t.TempDir(), CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	updated, err := service.ArchiveChat("ses_1")
	if err != nil {
		t.Fatal(err)
	}
	if updated.ArchivedAt == nil {
		t.Fatal("expected ArchivedAt to be set")
	}
	first := *updated.ArchivedAt
	again, err := service.ArchiveChat("ses_1")
	if err != nil {
		t.Fatal(err)
	}
	if again.ArchivedAt == nil || !again.ArchivedAt.Equal(first) {
		t.Fatalf("expected archiving an already-archived chat to be a no-op, got %#v", again.ArchivedAt)
	}
}

func TestRestoreChatFastPathClearsArchivedAt(t *testing.T) {
	service, store, objects := newChatArchiveTestService(t)
	if err := store.Put(domain.Session{ID: "ses_1", ProjectPath: t.TempDir(), CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	bundle := testArtifactZIP(t, map[string]string{"input.txt": "hello"})
	record, err := service.PersistArtifact(context.Background(), "ses_1", "req_1", "input", "bundle", "input.zip", "application/zip", bundle)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ArchiveChat("ses_1"); err != nil {
		t.Fatal(err)
	}
	restored, err := service.RestoreChat(context.Background(), "ses_1")
	if err != nil {
		t.Fatal(err)
	}
	if restored.ArchivedAt != nil || restored.CompactedAt != nil {
		t.Fatalf("expected a fully restored session, got %#v / %#v", restored.ArchivedAt, restored.CompactedAt)
	}
	if len(restored.Artifacts) != 1 || restored.Artifacts[0].ID != record.ID {
		t.Fatalf("fast-path restore must never touch artifacts: %#v", restored.Artifacts)
	}
	if _, ok := objects.objects[record.ObjectKey]; !ok {
		t.Fatal("fast-path restore must never delete the original artifact object")
	}
}

func TestCompactArchivedChatsSkipsSessionsArchivedWithinGracePeriod(t *testing.T) {
	service, store, _ := newChatArchiveTestService(t)
	if err := store.Put(domain.Session{ID: "ses_1", ProjectPath: t.TempDir(), CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ArchiveChat("ses_1"); err != nil {
		t.Fatal(err)
	}
	cutoff := time.Now().UTC().Add(-72 * time.Hour)
	if err := service.CompactArchivedChats(context.Background(), cutoff); err != nil {
		t.Fatal(err)
	}
	item, err := store.Get("ses_1")
	if err != nil {
		t.Fatal(err)
	}
	if item.CompactedAt != nil {
		t.Fatalf("a recently archived session must not be compacted yet: %#v", item.CompactedAt)
	}
}

func TestCompactArchivedChatsPacksUploadsAndDeletesOriginals(t *testing.T) {
	service, store, objects := newChatArchiveTestService(t)
	contextPath := filepath.Join(t.TempDir(), "context.zip")
	if err := os.WriteFile(contextPath, []byte("context-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := store.Put(domain.Session{ID: "ses_1", ProjectPath: t.TempDir(), CreatedAt: time.Now().UTC(), RequestContextArchives: map[string]string{"req_1": contextPath}}); err != nil {
		t.Fatal(err)
	}
	bundle := testArtifactZIP(t, map[string]string{"input.txt": "hello"})
	record, err := service.PersistArtifact(context.Background(), "ses_1", "req_1", "input", "bundle", "input.zip", "application/zip", bundle)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ArchiveChat("ses_1"); err != nil {
		t.Fatal(err)
	}
	backdated := time.Now().UTC().Add(-100 * time.Hour)
	if _, err := store.Update("ses_1", func(item *domain.Session) error {
		item.ArchivedAt = &backdated
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if err := service.CompactArchivedChats(context.Background(), time.Now().UTC().Add(-72*time.Hour)); err != nil {
		t.Fatal(err)
	}

	item, err := store.Get("ses_1")
	if err != nil {
		t.Fatal(err)
	}
	if item.CompactedAt == nil {
		t.Fatal("expected the session to be compacted")
	}
	if len(item.Artifacts) != 0 {
		t.Fatalf("expected Artifacts to be cleared, got %#v", item.Artifacts)
	}
	if len(item.RequestContextArchives) != 0 {
		t.Fatalf("expected RequestContextArchives to be cleared, got %#v", item.RequestContextArchives)
	}
	if item.ArchivePackage == nil || item.ArchivePackage.EntryCount == 0 {
		t.Fatalf("expected a populated archive package record, got %#v", item.ArchivePackage)
	}
	if _, ok := objects.objects[record.ObjectKey]; ok {
		t.Fatal("original artifact object must be deleted after compaction")
	}
	if _, ok := objects.objects[item.ArchivePackage.ObjectKey]; !ok {
		t.Fatal("compacted package must exist in the object store")
	}
	if _, err := os.Stat(contextPath); !os.IsNotExist(err) {
		t.Fatalf("expected the on-disk context archive to be removed, stat err=%v", err)
	}
}

func TestCompactArchivedChatsIsRetriableAfterPartialFailure(t *testing.T) {
	service, store, objects := newChatArchiveTestService(t)
	flaky := &flakyArtifactStore{memoryArtifactStore: objects, failDeleteOnce: map[string]bool{}}
	service.SetArtifactStore(flaky, 30)

	if err := store.Put(domain.Session{ID: "ses_1", ProjectPath: t.TempDir(), CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	bundle := testArtifactZIP(t, map[string]string{"input.txt": "hello"})
	record, err := service.PersistArtifact(context.Background(), "ses_1", "req_1", "input", "bundle", "input.zip", "application/zip", bundle)
	if err != nil {
		t.Fatal(err)
	}
	flaky.failDeleteOnce[record.ObjectKey] = true

	if _, err := service.ArchiveChat("ses_1"); err != nil {
		t.Fatal(err)
	}
	backdated := time.Now().UTC().Add(-100 * time.Hour)
	if _, err := store.Update("ses_1", func(item *domain.Session) error {
		item.ArchivedAt = &backdated
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	cutoff := time.Now().UTC().Add(-72 * time.Hour)

	if err := service.CompactArchivedChats(context.Background(), cutoff); err == nil {
		t.Fatal("expected the first sweep pass to surface the simulated delete failure")
	}
	parked, err := store.Get("ses_1")
	if err != nil {
		t.Fatal(err)
	}
	if parked.CompactedAt != nil {
		t.Fatal("a failed Phase 2 must leave CompactedAt unset")
	}
	if parked.ArchivePackage == nil {
		t.Fatal("a failed Phase 2 must keep the Phase 1 checkpoint so it is not rebuilt")
	}
	packageObjectCount := len(flaky.objects)

	if err := service.CompactArchivedChats(context.Background(), cutoff); err != nil {
		t.Fatalf("expected the retried sweep pass to succeed, got %v", err)
	}
	done, err := store.Get("ses_1")
	if err != nil {
		t.Fatal(err)
	}
	if done.CompactedAt == nil {
		t.Fatal("expected the retried sweep to finish compaction")
	}
	if len(flaky.objects) >= packageObjectCount {
		t.Fatalf("expected the original artifact object to finally be deleted, objects=%#v", flaky.objects)
	}
}

func TestRestoreCompactedChatRebuildsArtifacts(t *testing.T) {
	service, store, _ := newChatArchiveTestService(t)
	if err := store.Put(domain.Session{ID: "ses_1", ProjectPath: t.TempDir(), CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
	bundle := testArtifactZIP(t, map[string]string{"input.txt": "hello"})
	original, err := service.PersistArtifact(context.Background(), "ses_1", "req_1", "input", "bundle", "input.zip", "application/zip", bundle)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.ArchiveChat("ses_1"); err != nil {
		t.Fatal(err)
	}
	backdated := time.Now().UTC().Add(-100 * time.Hour)
	if _, err := store.Update("ses_1", func(item *domain.Session) error {
		item.ArchivedAt = &backdated
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := service.CompactArchivedChats(context.Background(), time.Now().UTC().Add(-72*time.Hour)); err != nil {
		t.Fatal(err)
	}

	restored, err := service.RestoreChat(context.Background(), "ses_1")
	if err != nil {
		t.Fatal(err)
	}
	if restored.ArchivedAt != nil || restored.CompactedAt != nil || restored.ArchivePackage != nil {
		t.Fatalf("expected every archive field cleared after restore, got %#v", restored)
	}
	if len(restored.Artifacts) != 1 {
		t.Fatalf("expected exactly one restored artifact, got %#v", restored.Artifacts)
	}
	_, raw, err := service.ReadArtifact(context.Background(), "ses_1", restored.Artifacts[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(bundle) {
		t.Fatalf("restored artifact bytes do not match the original: got %d bytes, want %d", len(raw), len(bundle))
	}
	if restored.Artifacts[0].SHA256 != original.SHA256 {
		t.Fatalf("restored artifact digest mismatch: got %s, want %s", restored.Artifacts[0].SHA256, original.SHA256)
	}
}
