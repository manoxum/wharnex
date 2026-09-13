package app

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

func TestReclaimObsoleteStorageRemovesOnlyUnreferencedManagedData(t *testing.T) {
	tempRoot := t.TempDir()
	cacheRoot := t.TempDir()
	project := t.TempDir()
	cutoff := time.Now().Add(-time.Hour)
	old := cutoff.Add(-time.Hour)

	makeDir := func(root, name string, modified time.Time) string {
		t.Helper()
		dir := filepath.Join(root, name)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "payload"), []byte("cache"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(dir, modified, modified); err != nil {
			t.Fatal(err)
		}
		return dir
	}

	referenced := makeDir(tempRoot, "wharness-context-referenced", old)
	activeWorkspace := makeDir(tempRoot, "kernl-workspace-active", old)
	orphanContext := makeDir(tempRoot, "wharness-context-orphan", old)
	orphanWorkspace := makeDir(tempRoot, "kernl-workspace-orphan", old)
	recentContext := makeDir(tempRoot, "wharness-context-recent", time.Now())
	foreign := makeDir(tempRoot, "unrelated-cache", old)

	activeKey := fmt.Sprintf("%x", sha256.Sum256([]byte(filepath.Clean(project))))
	activeCache := makeDir(filepath.Join(cacheRoot, "go-mod"), activeKey, old)
	staleCache := makeDir(filepath.Join(cacheRoot, "go-mod"), strings.Repeat("a", 64), old)
	recentStaleCache := makeDir(filepath.Join(cacheRoot, "go-mod"), strings.Repeat("b", 64), time.Now())

	store := session.NewStore()
	if err := store.Put(domain.Session{
		ID:          "ses_storage_reclaim",
		ProjectPath: project,
		CreatedAt:   time.Now().UTC(),
		Context:     domain.ContextBundle{ZipPath: filepath.Join(referenced, "payload")},
	}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	service.devspaces["ses_storage_reclaim"] = sandbox.Workspace{Path: activeWorkspace}

	result, err := service.ReclaimObsoleteStorage(tempRoot, cacheRoot, cutoff)
	if err != nil {
		t.Fatal(err)
	}
	if result.TempDirectories != 2 || result.DependencyCacheDirectories != 1 || result.ReclaimedBytes == 0 {
		t.Fatalf("unexpected reclaim result: %#v", result)
	}
	for _, removed := range []string{orphanContext, orphanWorkspace, staleCache} {
		if _, err := os.Stat(removed); !os.IsNotExist(err) {
			t.Fatalf("obsolete managed directory survived: %s: %v", removed, err)
		}
	}
	for _, kept := range []string{referenced, activeWorkspace, recentContext, foreign, activeCache, recentStaleCache} {
		if _, err := os.Stat(kept); err != nil {
			t.Fatalf("protected or recent directory was removed: %s: %v", kept, err)
		}
	}
}

func TestCheckoutTemporaryRootRejectsSharedOperatingSystemTemp(t *testing.T) {
	root := t.TempDir()
	stateFile := filepath.Join(root, ".harness", "state", "sessions.json")
	owned := filepath.Join(root, ".harness", "bridge", "tmp")
	if got := CheckoutTemporaryRoot(stateFile, owned); got != filepath.Clean(owned) {
		t.Fatalf("checkout temp root was not recognized: %q", got)
	}
	if got := CheckoutTemporaryRoot(stateFile, os.TempDir()); got != "" {
		t.Fatalf("shared operating-system temp was accepted: %q", got)
	}
}

func TestDeleteSessionRemovesCurrentAndRetainedContextDirectories(t *testing.T) {
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

	store := session.NewStore()
	if err := store.Put(domain.Session{
		ID:          "ses_delete_contexts",
		ProjectPath: t.TempDir(),
		CreatedAt:   time.Now().UTC(),
		Context:     domain.ContextBundle{ZipPath: filepath.Join(currentDir, "current.zip")},
		RequestContextArchives: map[string]string{
			"req_history": filepath.Join(historyDir, "history.zip"),
		},
	}); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	if err := service.DeleteSession("ses_delete_contexts"); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{currentDir, historyDir} {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Fatalf("deleted session left context directory behind: %s: %v", dir, err)
		}
	}
}

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
