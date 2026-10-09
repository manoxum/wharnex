//go:build linux

package recovery

import (
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func repository(t *testing.T) (string, string) {
	t.Helper()
	root := t.TempDir()
	cmd := exec.Command("git", "-C", root, "init", "-q")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, out)
	}
	put(t, filepath.Join(root, "file.txt"), "working data\n")
	cmd = exec.Command("git", "-C", root, "add", "file.txt")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git add: %v: %s", err, out)
	}
	lock := filepath.Join(root, ".git", "index.lock")
	put(t, lock, "")
	old := time.Now().Add(-24 * time.Hour)
	if err := os.Chtimes(lock, old, old); err != nil {
		t.Fatal(err)
	}
	return root, lock
}

func put(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestClearAbandonedLockPreservesIndexAndWorktree(t *testing.T) {
	root, lock := repository(t)
	index := filepath.Join(root, ".git", "index")
	before, err := os.ReadFile(index)
	if err != nil {
		t.Fatal(err)
	}
	result := clear(context.Background(), root, func(os.FileInfo) error { return nil })
	if !result.Recovered || result.Reason != "abandoned" || result.Path != lock {
		t.Fatalf("%+v", result)
	}
	if _, err := os.Lstat(lock); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("lock not removed: %v", err)
	}
	after, err := os.ReadFile(index)
	if err != nil || sha256.Sum256(after) != sha256.Sum256(before) {
		t.Fatal("index changed")
	}
	work, _ := os.ReadFile(filepath.Join(root, "file.txt"))
	if string(work) != "working data\n" {
		t.Fatal("worktree changed")
	}
}

func TestClearRefusesUnsafeLocks(t *testing.T) {
	for _, kind := range []string{"fresh", "nonempty", "symlink", "hardlink", "active", "unobservable", "changed", "cancelled", "merge", "symlink-root", "gitdir-symlink", "foreign-gitfile"} {
		t.Run(kind, func(t *testing.T) {
			root, lock := repository(t)
			ctx := context.Background()
			proof := func(os.FileInfo) error { return nil }
			switch kind {
			case "fresh":
				if err := os.Chtimes(lock, time.Now(), time.Now()); err != nil {
					t.Fatal(err)
				}
			case "nonempty":
				put(t, lock, "index being written")
				old := time.Now().Add(-24 * time.Hour)
				if err := os.Chtimes(lock, old, old); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				target := filepath.Join(root, "other.lock")
				put(t, target, "")
				if err := os.Remove(lock); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, lock); err != nil {
					t.Fatal(err)
				}
			case "hardlink":
				if err := os.Link(lock, filepath.Join(root, "other.lock")); err != nil {
					t.Fatal(err)
				}
			case "active":
				proof = func(os.FileInfo) error { return errors.New("git_process_active") }
			case "unobservable":
				proof = func(os.FileInfo) error { return errors.New("process_visibility_incomplete") }
			case "changed":
				proof = func(os.FileInfo) error { put(t, lock, "new live index"); return nil }
			case "cancelled":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				proof = func(os.FileInfo) error { cancel(); return nil }
			case "merge":
				put(t, filepath.Join(root, ".git", "MERGE_HEAD"), strings.Repeat("0", 40))
			case "symlink-root":
				alias := filepath.Join(t.TempDir(), "alias")
				if err := os.Symlink(root, alias); err != nil {
					t.Fatal(err)
				}
				root = alias
			case "gitdir-symlink":
				metadata := filepath.Join(root, ".git")
				moved := filepath.Join(root, "metadata")
				if err := os.Rename(metadata, moved); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(moved, metadata); err != nil {
					t.Fatal(err)
				}
			case "foreign-gitfile":
				foreign := t.TempDir()
				put(t, filepath.Join(foreign, ".git"), "gitdir: "+filepath.Join(root, ".git")+"\n")
				root = foreign
			}
			result := clear(ctx, root, proof)
			if result.Recovered {
				t.Fatalf("unsafe cleanup: %+v", result)
			}
			if _, err := os.Lstat(lock); err != nil {
				t.Fatalf("lock lost: %v", err)
			}
		})
	}
}

func TestQuarantineRestoresReplacedLock(t *testing.T) {
	_, lock := repository(t)
	old, _ := os.Lstat(lock)
	// Rename instead of unlink prevents the filesystem from reusing the inode.
	if err := os.Rename(lock, lock+".original"); err != nil {
		t.Fatal(err)
	}
	put(t, lock, "new live lock")
	if err := quarantine(lock, old); err == nil {
		t.Fatal("replacement accepted")
	}
	content, err := os.ReadFile(lock)
	if err != nil || string(content) != "new live lock" {
		t.Fatalf("replacement lost: %q %v", content, err)
	}
}
