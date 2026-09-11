package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestStorageUsageCountsAndClearDeletesCompactedArchive(t *testing.T) {
	store := session.NewStore()
	project := t.TempDir()
	const archiveKey = "sessions/ses_archive/archive-package"
	if err := store.Put(domain.Session{
		ID:          "ses_archive",
		ProjectPath: project,
		CreatedAt:   time.Now().UTC(),
		ArchivePackage: &domain.ArchivePackageRecord{
			ObjectKey: archiveKey,
			Size:      321,
		},
	}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	objects := &memoryArtifactStore{objects: map[string][]byte{archiveKey: []byte("archive")}}
	service.SetArtifactStore(objects, 30)

	usage := service.StorageUsage()
	if usage.ArchiveBytes != 321 || len(usage.Projects) != 1 || usage.Projects[0].ArchiveBytes != 321 {
		t.Fatalf("compacted archive was not accounted for: %#v", usage)
	}
	if usage.TotalBytes < 321 || usage.Projects[0].TotalBytes < 321 {
		t.Fatalf("archive bytes missing from totals: %#v", usage)
	}
	if err := service.ClearAllData(); err != nil {
		t.Fatal(err)
	}
	if _, ok := objects.objects[archiveKey]; ok {
		t.Fatal("clear all data left compacted archive object behind")
	}
}

func TestPrunedRequestContextsDeleteOnlyUnreferencedOwnedDirectories(t *testing.T) {
	store := session.NewStore()
	archives := make(map[string]string, 24)
	for i := 0; i < 24; i++ {
		dir, err := os.MkdirTemp("", "wharness-context-*")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.RemoveAll(dir) })
		path := filepath.Join(dir, "context.zip")
		if err := os.WriteFile(path, []byte("old"), 0o600); err != nil {
			t.Fatal(err)
		}
		archives["req-old-"+time.Unix(int64(i), 0).UTC().Format("150405")] = path
	}
	currentDir, err := os.MkdirTemp("", "wharness-context-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(currentDir) })
	currentZip := filepath.Join(currentDir, "context.zip")
	if err := os.WriteFile(currentZip, []byte("current"), 0o600); err != nil {
		t.Fatal(err)
	}
	item := domain.Session{
		ID:                     "ses_context_gc",
		ProjectPath:            t.TempDir(),
		CreatedAt:              time.Now().UTC(),
		LastRequestID:          "req-new",
		Context:                domain.ContextBundle{ZipPath: currentZip},
		RequestContextArchives: archives,
	}
	if err := store.Put(item); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})

	var pruned []string
	updated, err := store.Update(item.ID, func(current *domain.Session) error {
		pruned = append(pruned, recordRequestContext(current, "req-new", current.Context)...)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(pruned) != 1 || len(updated.RequestContextArchives) != 24 {
		t.Fatalf("expected one pruned request context, got pruned=%v count=%d", pruned, len(updated.RequestContextArchives))
	}
	service.cleanupPrunedRequestContexts(pruned)
	if _, err := os.Stat(filepath.Dir(pruned[0])); !os.IsNotExist(err) {
		t.Fatalf("pruned context directory still exists: %v", err)
	}
	if _, err := os.Stat(currentZip); err != nil {
		t.Fatalf("current referenced context was deleted: %v", err)
	}
	for _, path := range updated.RequestContextArchives {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("referenced request context was deleted: %s: %v", path, err)
		}
	}
}

func TestStorageUsageTracksAndClearRemovesRetainedRequestContexts(t *testing.T) {
	store := session.NewStore()
	currentDir, err := os.MkdirTemp("", "wharness-context-*")
	if err != nil {
		t.Fatal(err)
	}
	historyDir, err := os.MkdirTemp("", "wharness-context-*")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(currentDir) })
	t.Cleanup(func() { _ = os.RemoveAll(historyDir) })
	currentZip := filepath.Join(currentDir, "context.zip")
	historyZip := filepath.Join(historyDir, "context.zip")
	if err := os.WriteFile(currentZip, []byte("current"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(historyZip, []byte("history"), 0o600); err != nil {
		t.Fatal(err)
	}
	item := domain.Session{
		ID:          "ses_context_storage",
		ProjectPath: t.TempDir(),
		CreatedAt:   time.Now().UTC(),
		Context:     domain.ContextBundle{ZipPath: currentZip},
		RequestContextArchives: map[string]string{
			"req-current": currentZip,
			"req-history": historyZip,
		},
	}
	if err := store.Put(item); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})

	usage := service.StorageUsage()
	if usage.ContextBytes != int64(len("current")+len("history")) {
		t.Fatalf("retained request contexts were not accounted for exactly once: %#v", usage)
	}
	if err := service.ClearAllData(); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{currentDir, historyDir} {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Fatalf("owned request context directory survived clear-all: %s: %v", dir, err)
		}
	}
}
