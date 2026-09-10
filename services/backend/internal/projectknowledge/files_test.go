package projectknowledge

import (
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestSaveAndLoadSeparateKnowledgeFiles(t *testing.T) {
	root := t.TempDir()
	entries := []domain.ProjectKnowledgeEntry{
		{ID: "desktop-upload", Content: "Use the dedicated file input."},
		{ID: "apply-order", Content: "Persist knowledge after host Apply."},
	}
	if err := Save(root, entries); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"apply-order.md", "desktop-upload.md", "catalog.json"} {
		if _, err := os.Stat(filepath.Join(root, ".wharnex", "knowledge", name)); err != nil {
			t.Fatalf("missing %s: %v", name, err)
		}
	}
	loaded, present, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if !present || len(loaded) != 2 || loaded[0].ID != "apply-order" || loaded[1].ID != "desktop-upload" {
		t.Fatalf("unexpected catalog: present=%v entries=%#v", present, loaded)
	}
}

func TestSaveRemovesSupersededMarkdownAndKeepsEmptyCatalogMarker(t *testing.T) {
	root := t.TempDir()
	if err := Save(root, []domain.ProjectKnowledgeEntry{{ID: "old-learning", Content: "old"}}); err != nil {
		t.Fatal(err)
	}
	if err := Save(root, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, ".wharnex", "knowledge", "old-learning.md")); !os.IsNotExist(err) {
		t.Fatalf("superseded knowledge must be removed, stat err=%v", err)
	}
	loaded, present, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if !present || len(loaded) != 0 {
		t.Fatalf("empty managed catalog must remain representable: present=%v entries=%#v", present, loaded)
	}
}

func TestLoadIgnoresBareManagedDirectoryWithoutCatalog(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".wharnex", "knowledge"), 0o755); err != nil {
		t.Fatal(err)
	}
	entries, present, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if present || len(entries) != 0 {
		t.Fatalf("bare directory must not erase database knowledge: present=%v entries=%#v", present, entries)
	}
}

func TestLoadRejectsSymlinkManagedParent(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Mkdir(filepath.Join(outside, "knowledge"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, ".wharnex")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := Load(root); err == nil {
		t.Fatal("expected symlinked .wharnex parent to be rejected")
	}
}

func TestLoadRejectsSymlinkKnowledgeEntry(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, ".wharnex", "knowledge")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(root, "target.md")
	if err := os.WriteFile(target, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(dir, "unsafe.md")); err != nil {
		t.Fatal(err)
	}
	if _, _, err := Load(root); err == nil {
		t.Fatal("expected symlink knowledge file to be rejected")
	}
}

func TestIsManagedPathNormalizesProtocolAndGitForms(t *testing.T) {
	for _, path := range []string{
		".wharnex/knowledge",
		".wharnex/knowledge/catalog.json",
		"a/.wharnex/knowledge/topic.md",
		"b/.wharnex/knowledge/nested/topic.md",
	} {
		if !IsManagedPath(path) {
			t.Fatalf("expected %q to be managed", path)
		}
	}
	for _, path := range []string{".wharnex/config.json", "knowledge/topic.md", "src/.wharnex/knowledge/topic.md"} {
		if IsManagedPath(path) {
			t.Fatalf("expected %q not to be managed", path)
		}
	}
}
