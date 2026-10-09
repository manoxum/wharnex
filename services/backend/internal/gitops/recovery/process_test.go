//go:build linux

package recovery

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func process(t *testing.T, proc, id, name string) string {
	t.Helper()
	path := filepath.Join(proc, id)
	if err := os.MkdirAll(filepath.Join(path, "fd"), 0o700); err != nil {
		t.Fatal(err)
	}
	put(t, filepath.Join(path, "comm"), name+"\n")
	put(t, filepath.Join(path, "status"), "State:\tS (sleeping)\n")
	return path
}

func TestZombieGitCannotHoldALock(t *testing.T) {
	_, lock := repository(t)
	info, _ := os.Lstat(lock)
	proc := t.TempDir()
	process(t, proc, "1", "init")
	zombie := process(t, proc, "2", "git")
	put(t, filepath.Join(zombie, "status"), "State:\tZ (zombie)\n")
	if err := os.RemoveAll(filepath.Join(zombie, "fd")); err != nil {
		t.Fatal(err)
	}
	if err := processProof(context.Background(), proc, info); err != nil {
		t.Fatalf("exited Git must not prevent abandoned-lock recovery: %v", err)
	}
}

func TestHostProcessProof(t *testing.T) {
	for _, kind := range []string{"clear", "git", "git-helper", "open-lock", "incomplete", "container", "cancelled"} {
		t.Run(kind, func(t *testing.T) {
			_, lock := repository(t)
			info, _ := os.Lstat(lock)
			proc := t.TempDir()
			process(t, proc, "1", "init")
			other := process(t, proc, "2", "editor")
			ctx := context.Background()
			switch kind {
			case "git":
				put(t, filepath.Join(other, "comm"), "git\n")
			case "git-helper":
				put(t, filepath.Join(other, "comm"), "git-remote-http\n")
			case "open-lock":
				file, err := os.Open(lock)
				if err != nil {
					t.Fatal(err)
				}
				defer file.Close()
			case "incomplete":
				if err := os.Remove(filepath.Join(other, "comm")); err != nil {
					t.Fatal(err)
				}
				// A directory is an unreadable comm, even when tests run as root.
				if err := os.Mkdir(filepath.Join(other, "comm"), 0o700); err != nil {
					t.Fatal(err)
				}
			case "container":
				put(t, filepath.Join(proc, "1", "comm"), "backend\n")
			case "cancelled":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			var err error
			if kind == "open-lock" {
				lease, proofErr := exclusiveLock(lock, info)
				err = proofErr
				if lease != nil {
					lease.Close()
				}
			} else {
				err = processProof(ctx, proc, info)
			}
			if (err == nil) != (kind == "clear") {
				t.Fatalf("%s: %v", kind, err)
			}
		})
	}
}

func TestClearWithHostProcessProof(t *testing.T) {
	root, lock := repository(t)
	proc := t.TempDir()
	process(t, proc, "1", "init")
	process(t, proc, "2", "editor")
	result := clear(context.Background(), root, func(info os.FileInfo) error {
		return processProof(context.Background(), proc, info)
	})
	if !result.Recovered {
		t.Fatalf("%+v", result)
	}
	if _, err := os.Stat(lock); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("lock remains")
	}
}
