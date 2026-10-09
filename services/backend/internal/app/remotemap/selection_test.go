package remotemap

import (
	"reflect"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestSelectKeepsSourceNamespacesAndDeduplicatesReferences(t *testing.T) {
	paths := []string{"context/main.txt", "ref-context/core/main.txt"}
	got := Select(paths, []string{"main.txt", "other.txt", "other.txt"})
	want := []string{"context/main.txt", "ref-context/core/main.txt", "context/other.txt"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("selected paths = %#v, want %#v", got, want)
	}
	got[0] = "changed"
	if paths[0] != "context/main.txt" {
		t.Fatal("selection mutated the caller's snapshot")
	}
}

func TestRetainSelectionsUsesOnlySelectedContextEntries(t *testing.T) {
	got := RetainSelections([]string{"context/new.txt"}, []Entry{
		{Role: "context", Path: "main.txt", Selected: true},
		{Role: "context", Path: "unused.txt"},
		{Role: "attachment", Path: "attachments/notes.txt", Selected: true},
	})
	want := []string{"context/new.txt", "context/main.txt"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("retained paths = %#v, want %#v", got, want)
	}
}

func TestFromPromptSelectsOnlyEligibleNamedDescendants(t *testing.T) {
	manifest := domain.ContextManifest{Files: []domain.ContextFile{
		{Path: "src/main.txt"}, {Path: "src/other.txt"}, {Path: "src-extra/main.txt"},
	}}
	got := FromPrompt(nil, "inspect @file:src and @file:missing and @file:/etc/passwd", manifest)
	want := []string{"context/src/main.txt", "context/src/other.txt"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("directive selection = %#v, want %#v", got, want)
	}
}

func TestBuildSelectionUsesExactManifestEntries(t *testing.T) {
	manifest := domain.ContextManifest{SHA256: "snapshot", Files: []domain.ContextFile{
		{Path: "main.txt", SHA256: "main", Size: 5},
		{Path: "other.txt", SHA256: "other", Size: 7},
	}}
	resources, entries, err := Build(t.TempDir(), "snapshot.zip", manifest,
		[]string{"context/main.txt", "ref-context/core/other.txt", "context/missing.txt"}, nil, nil,
		func(path string) string { return "https://test.invalid/" + path })
	if err != nil {
		t.Fatal(err)
	}
	if len(resources) != 2 || len(entries) != 2 {
		t.Fatalf("selection expanded the eligible snapshot: resources=%#v entries=%#v", resources, entries)
	}
	if !entries[0].Selected || entries[1].Selected {
		t.Fatalf("primary and reference namespaces were confused: %#v", entries)
	}
	if resources[0].ArchivePath != "snapshot.zip" || resources[0].ArchiveEntry != "main.txt" {
		t.Fatalf("selected file is no longer snapshot-backed: %#v", resources[0])
	}
}
