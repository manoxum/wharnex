package contextbundle

import (
	"archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildExcludesSecrets(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "main.go"), "package main\n")
	mustWrite(t, filepath.Join(root, ".env"), "TOKEN=secret\n")
	mustWrite(t, filepath.Join(root, "nested", "key.txt"), "-----BEGIN PRIVATE KEY-----\nabc")

	bundle, err := NewBuilder(1024*1024, 1024*1024).Build(root)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.OpenReader(bundle.ZipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	names := make(map[string]bool, len(zr.File))
	for _, file := range zr.File {
		names[file.Name] = true
	}
	if !names["main.go"] || !names["whaness.yml"] || names[".env"] || names["nested/key.txt"] {
		t.Fatalf("unexpected zip files: %#v", names)
	}
}

func TestShouldIgnoreDependencyDirs(t *testing.T) {
	if !ShouldIgnore("services/frontend/node_modules", true) {
		t.Fatal("node_modules should be ignored")
	}
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestHarnessIgnorePatterns(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, ".harnessignore"), "private-notes\n*.cache\n")
	patterns := LoadIgnorePatterns(root)
	if !ShouldIgnoreWithPatterns("private-notes/todo.md", false, patterns) {
		t.Fatal("configured directory should be ignored")
	}
	if !ShouldIgnoreWithPatterns("tmp/foo.cache", false, patterns) {
		t.Fatal("glob should be ignored")
	}
}

func TestBuildUsesWhanessContextConfiguration(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "main.go"), "package main\n")
	mustWrite(t, filepath.Join(root, "docs", "notes.md"), "notes\n")
	mustWrite(t, filepath.Join(root, "src", "generated.log"), "generated\n")
	mustWrite(t, filepath.Join(root, "whaness.yml"), `version: 1
project:
  name: "configured"
context:
  auto_exclude: true
  max_file_bytes: 2097152
  include:
    - "src/**"
  exclude:
    - "src/generated.log"
`)
	bundle, err := NewBuilder(1024*1024, 1024*1024).Build(root)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.OpenReader(bundle.ZipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	if len(zr.File) != 1 || zr.File[0].Name != "src/main.go" {
		t.Fatalf("unexpected configured context files: %#v", zr.File)
	}
}

func TestAutoExcludeRemovesCommonGeneratedArtifacts(t *testing.T) {
	if reason, ignored := autoExclude(".idea", true); !ignored || reason == "" {
		t.Fatal(".idea should be auto-excluded")
	}
	if reason, ignored := autoExclude("coverage/report.log", false); !ignored || reason == "" {
		t.Fatal("log output should be auto-excluded")
	}
	if matchConfiguredPattern("src/pkg/main.go", "src/**") != true {
		t.Fatal("globstar include should match descendants")
	}
}

func TestBuildRecordsStructuredExclusionDetails(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "main.go"), "package main\n")
	mustWrite(t, filepath.Join(root, ".env"), "TOKEN=secret\n")
	bundle, err := NewBuilder(1024*1024, 1024*1024).Build(root)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range bundle.Manifest.ExcludedDetails {
		if item.Path == ".env" && item.Rule == "mandatory" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected structured .env exclusion, got %#v", bundle.Manifest.ExcludedDetails)
	}
}

func TestContextInspectionShowsRootsRulesAndFinalInventory(t *testing.T) {
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "src", "main.go"), "package main\n")
	mustWrite(t, filepath.Join(root, "node_modules", "pkg", "index.js"), "module.exports = {}\n")
	mustWrite(t, filepath.Join(root, "README.md"), "# demo\n")
	builder := NewBuilder(1024*1024, 1024*1024)
	bundle, err := builder.Build(root)
	if err != nil {
		t.Fatal(err)
	}
	inspection, err := builder.Inspect(root, bundle.Manifest)
	if err != nil {
		t.Fatal(err)
	}
	if inspection.IncludedFiles < 2 || len(inspection.Rules) == 0 || len(inspection.Roots) < 3 {
		t.Fatalf("unexpected inspection: %#v", inspection)
	}
	seenIncluded, seenExcludedRoot := false, false
	for _, item := range inspection.Entries {
		if item.Path == "src/main.go" && item.Status == "included" {
			seenIncluded = true
		}
	}
	for _, item := range inspection.Roots {
		if item.Path == "node_modules" && item.Status == "excluded" {
			seenExcludedRoot = true
		}
	}
	if !seenIncluded || !seenExcludedRoot {
		t.Fatalf("inspection does not explain final context: %#v", inspection)
	}
	payload, err := json.Marshal(inspection)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), `"patterns":null`) || strings.Contains(string(payload), `"entries":null`) || strings.Contains(string(payload), `"roots":null`) {
		t.Fatalf("inspection must serialize empty collections as arrays: %s", payload)
	}
}
