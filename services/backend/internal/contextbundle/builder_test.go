package contextbundle

import (
	"archive/zip"
	"os"
	"path/filepath"
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
	if len(zr.File) != 1 || zr.File[0].Name != "main.go" {
		t.Fatalf("unexpected zip files: %#v", zr.File)
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
