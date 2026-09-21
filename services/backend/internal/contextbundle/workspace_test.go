package contextbundle

import (
	"archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/projectconfig"
)

func TestBuildWorkspaceNamespacesRelatedProjectsAndKeepsPrimaryBaseline(t *testing.T) {
	primary := t.TempDir()
	related := t.TempDir()
	mustWrite(t, filepath.Join(primary, "primary.txt"), "primary\n")
	mustWrite(t, filepath.Join(related, "related.txt"), "related\n")

	builder := NewBuilder(2<<20, 4<<20)
	primaryOnly, err := builder.Build(primary)
	if err != nil {
		t.Fatal(err)
	}
	wantSHA := primaryOnly.Manifest.SHA256
	removeBundleArtifacts(primaryOnly)

	bundle, err := builder.BuildWorkspace(primary, []string{related})
	if err != nil {
		t.Fatal(err)
	}
	if bundle.Manifest.SHA256 != wantSHA {
		t.Fatalf("related context changed primary execution baseline: got %s want %s", bundle.Manifest.SHA256, wantSHA)
	}
	if bundle.WorkspaceSHA256 == "" || bundle.WorkspaceSHA256 == wantSHA {
		t.Fatalf("combined context needs an identity distinct from the primary baseline: %q", bundle.WorkspaceSHA256)
	}
	if len(bundle.RelatedProjects) != 1 || bundle.RelatedProjects[0].ProjectPath != related {
		t.Fatalf("unexpected related project metadata: %#v", bundle.RelatedProjects)
	}

	reader, err := zip.OpenReader(bundle.ZipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	names := map[string]bool{}
	var index map[string]any
	for _, entry := range reader.File {
		names[entry.Name] = true
		if entry.Name == relatedProjectsIndex {
			handle, openErr := entry.Open()
			if openErr != nil {
				t.Fatal(openErr)
			}
			if err := json.NewDecoder(handle).Decode(&index); err != nil {
				t.Fatal(err)
			}
			_ = handle.Close()
		}
	}
	prefix := bundle.RelatedProjects[0].Prefix
	if !names["primary.txt"] || !names[prefix+"related.txt"] || !names[relatedProjectsIndex] {
		t.Fatalf("combined context did not preserve namespaces: %#v", names)
	}
	if index["protocol"] != "harness.related-projects/v1" {
		t.Fatalf("unexpected related context index: %#v", index)
	}
	text, err := os.ReadFile(bundle.TextPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), "RELATED PROJECT 1") || !strings.Contains(string(text), "related.txt") {
		t.Fatalf("planner text omitted related context: %s", text)
	}
}

func TestBuildWorkspaceWithSelectionsAppliesPrimaryRequestOverride(t *testing.T) {
	primary := t.TempDir()
	mustWrite(t, filepath.Join(primary, "src", "app.go"), "package src\n")
	mustWrite(t, filepath.Join(primary, "out", "generated.txt"), "generated\n")

	builder := NewBuilder(2<<20, 4<<20)
	baseline, err := builder.Build(primary)
	if err != nil {
		t.Fatal(err)
	}
	if manifestContainsPath(baseline.Manifest.Files, "out/generated.txt") {
		removeBundleArtifacts(baseline)
		t.Fatal("auto-excluded generated output unexpectedly present in baseline")
	}
	removeBundleArtifacts(baseline)

	selection := projectconfig.Default(primary).Context
	selection.IncludeOverride = []string{"out", "out/**"}
	bundle, err := builder.BuildWorkspaceWithSelections(primary, nil, map[string]projectconfig.ContextConfig{primary: selection}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer removeBundleArtifacts(bundle)
	if !manifestContainsPath(bundle.Manifest.Files, "out/generated.txt") {
		t.Fatalf("request-local primary selection did not restore out/generated.txt: %#v", bundle.Manifest.Files)
	}
}

func manifestContainsPath(files []domain.ContextFile, want string) bool {
	for _, file := range files {
		if file.Path == want {
			return true
		}
	}
	return false
}
