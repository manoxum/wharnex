package contextbundle

import (
	"archive/zip"
	"encoding/json"
	"io"
	"os"
	"os/exec"
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
	if !names["EXPORTS.md"] || !names["main.go"] || !names["whaness.yml"] || names[".env"] || names["nested/key.txt"] {
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
	names := make(map[string]bool, len(zr.File))
	for _, file := range zr.File {
		names[file.Name] = true
	}
	if len(zr.File) != 2 || !names["EXPORTS.md"] || !names["src/main.go"] {
		t.Fatalf("unexpected configured context files: %#v", names)
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

func TestBuildExportsGitStatusAndWorktreeMetadata(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	cmd := exec.Command("git", "init", "-q")
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, out)
	}
	mustWrite(t, filepath.Join(root, "tracked.txt"), "one\n")
	cmd = exec.Command("git", "add", "tracked.txt")
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git add: %v: %s", err, out)
	}
	mustWrite(t, filepath.Join(root, "untracked.txt"), "two\n")

	bundle, err := NewBuilder(1024*1024, 1024*1024).Build(root)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := zip.OpenReader(bundle.ZipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	var exports string
	for _, file := range zr.File {
		if file.Name != "EXPORTS.md" {
			continue
		}
		r, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(r)
		_ = r.Close()
		if err != nil {
			t.Fatal(err)
		}
		exports = string(data)
	}
	if !strings.Contains(exports, "## Git status") || !strings.Contains(exports, "untracked.txt") || !strings.Contains(exports, "## Git worktrees") {
		t.Fatalf("unexpected EXPORTS.md:\n%s", exports)
	}
}

func TestContextFingerprintChangesWhenGitWorktreeTopologyChanges(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	root := t.TempDir()
	cmds := [][]string{
		{"git", "init", "-q"},
		{"git", "config", "user.email", "test@example.invalid"},
		{"git", "config", "user.name", "Wharness Test"},
	}
	for _, argv := range cmds {
		cmd := exec.Command(argv[0], argv[1:]...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("%v: %v: %s", argv, err, out)
		}
	}
	mustWrite(t, filepath.Join(root, "main.go"), "package main\n")
	for _, args := range [][]string{{"add", "main.go"}, {"commit", "-qm", "initial"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	builder := NewBuilder(1024*1024, 1024*1024)
	before, err := builder.Build(root)
	if err != nil {
		t.Fatal(err)
	}
	worktree := filepath.Join(t.TempDir(), "analysis-worktree")
	cmd := exec.Command("git", "worktree", "add", "-q", "-b", "analysis-worktree", worktree)
	cmd.Dir = root
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git worktree add: %v: %s", err, out)
	}
	defer func() {
		cleanup := exec.Command("git", "worktree", "remove", "--force", worktree)
		cleanup.Dir = root
		_ = cleanup.Run()
	}()
	after, err := builder.Build(root)
	if err != nil {
		t.Fatal(err)
	}
	if before.Manifest.SHA256 == after.Manifest.SHA256 {
		t.Fatal("context fingerprint must change when git worktree topology changes")
	}
}
