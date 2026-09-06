package workspacefs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadWriteAndConflict(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "src", "hello.txt")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	current, err := Read(root, "src/hello.txt")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := Write(root, "src/hello.txt", "new\n", current.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Content != "new\n" {
		t.Fatalf("content=%q", saved.Content)
	}
	if _, err := Write(root, "src/hello.txt", "stale\n", current.SHA256); err == nil {
		t.Fatal("expected optimistic-lock conflict")
	}
}

func TestTraversalAndSecretsDenied(t *testing.T) {
	root := t.TempDir()
	if _, err := Write(root, "../escape.txt", "x", ""); err == nil {
		t.Fatal("expected traversal rejection")
	}
	if _, err := Write(root, ".env", "TOKEN=x", ""); err == nil {
		t.Fatal("expected secret path rejection")
	}
}

func TestOpenPreviewStreamsBinaryAndKeepsContainment(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "sample.pdf"), []byte("%PDF-binary\x00"), 0o600); err != nil {
		t.Fatal(err)
	}
	handle, info, err := OpenPreview(root, "sample.pdf")
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()
	if info.Size() != 12 {
		t.Fatalf("size=%d", info.Size())
	}
	if _, _, err := OpenPreview(root, "../sample.pdf"); err == nil {
		t.Fatal("expected traversal rejection")
	}
}

func TestListOmitsIgnored(t *testing.T) {
	root := t.TempDir()
	_ = os.MkdirAll(filepath.Join(root, "node_modules", "x"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "node_modules", "x", "a.js"), []byte("x"), 0o600)
	_ = os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n"), 0o600)
	entries, err := List(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Path != "main.go" {
		t.Fatalf("entries=%#v", entries)
	}
}

func TestWriteRejectsSymlinkParentEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if _, err := Write(root, "link/escape.txt", "x", ""); err == nil {
		t.Fatal("expected symlink-parent rejection")
	}
	if _, err := os.Stat(filepath.Join(outside, "escape.txt")); !os.IsNotExist(err) {
		t.Fatal("outside file must not be created")
	}
}

func TestWriteRejectsSymlinkFile(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.txt")
	if err := os.WriteFile(outside, []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "link.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := Write(root, "link.txt", "overwrite", ""); err == nil {
		t.Fatal("expected symlink-file rejection")
	}
	data, _ := os.ReadFile(outside)
	if string(data) != "secret" {
		t.Fatal("outside file must remain unchanged")
	}
}

func TestWritePreservesExecutableMode(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "script.sh")
	if err := os.WriteFile(path, []byte("#!/bin/sh\necho old\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	current, err := Read(root, "script.sh")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Write(root, "script.sh", "#!/bin/sh\necho new\n", current.SHA256); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o755 {
		t.Fatalf("mode changed to %o", info.Mode().Perm())
	}
}

func TestWorkspaceMutations(t *testing.T) {
	root := t.TempDir()
	if err := CreateDirectory(root, "src"); err != nil {
		t.Fatal(err)
	}
	created, err := CreateFile(root, "src/new.txt")
	if err != nil {
		t.Fatal(err)
	}
	if created.Path != "src/new.txt" {
		t.Fatalf("created path=%q", created.Path)
	}
	if err := Rename(root, "src/new.txt", "src/renamed.txt"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "src", "renamed.txt")); err != nil {
		t.Fatal(err)
	}
	if err := Delete(root, "src"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "src")); !os.IsNotExist(err) {
		t.Fatalf("expected directory to be removed, err=%v", err)
	}
}

func TestWorkspaceMutationsRejectExcludedAndTraversal(t *testing.T) {
	root := t.TempDir()
	if _, err := CreateFile(root, "../escape.txt"); err == nil {
		t.Fatal("expected traversal rejection")
	}
	if err := CreateDirectory(root, ".git"); err == nil {
		t.Fatal("expected protected directory rejection")
	}
	if _, err := CreateFile(root, ".env"); err == nil {
		t.Fatal("expected protected file rejection")
	}
}

func TestWorkspaceRenameRejectsSymlink(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if err := Rename(root, "link", "renamed"); err == nil {
		t.Fatal("expected symlink rename rejection")
	}
}
