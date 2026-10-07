package gitops

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func repo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if out, err := exec.Command("git", "-C", root, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	return root
}

func TestIndexLockRetryIsBoundedAndDoesNotMaskOtherFailures(t *testing.T) {
	for _, kind := range []string{"recovered", "replay-fails", "blocked", "transient", "other-error", "foreign-index", "private-index", "cancelled"} {
		t.Run(kind, func(t *testing.T) {
			root := repo(t)
			lock := filepath.Join(root, ".git", "index.lock")
			if kind == "foreign-index" {
				lock = filepath.Join(root, "foreign", "index.lock")
			}
			if kind == "private-index" {
				t.Setenv("GIT_INDEX_FILE", filepath.Join(root, "private"))
			}
			diagnostic := "fatal: Unable to create '" + lock + "': File exists."
			if kind == "other-error" {
				diagnostic = "hook failed"
			}
			calls, recoveries := 0, 0
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			_, err := retry(ctx, root, func() (string, string, error) {
				calls++
				if calls > 1 && (kind == "recovered" || kind == "transient") {
					return "ok", "", nil
				}
				return "original diagnostic", diagnostic, errors.New("git failure")
			}, func(context.Context, string) bool {
				recoveries++
				if kind == "cancelled" {
					cancel()
				}
				return kind == "recovered" || kind == "replay-fails" || kind == "cancelled"
			})
			expectedCalls, expectedRecoveries := 4, 1
			switch kind {
			case "recovered", "replay-fails", "transient":
				expectedCalls = 2
			case "other-error":
				expectedCalls, expectedRecoveries = 1, 0
			case "foreign-index", "private-index":
				expectedRecoveries = 0
			case "cancelled":
				expectedCalls = 1
			}
			if calls != expectedCalls || recoveries != expectedRecoveries {
				t.Fatalf("calls=%d recoveries=%d", calls, recoveries)
			}
			if (err == nil) != (kind == "recovered" || kind == "transient") {
				t.Fatalf("unexpected result: %v", err)
			}
		})
	}
}

func TestObservationDoesNotRefreshHostIndex(t *testing.T) {
	root := repo(t)
	if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("content\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Combined(context.Background(), root, "add", "file.txt"); err != nil {
		t.Fatal(err)
	}
	index := filepath.Join(root, ".git", "index")
	before, err := os.ReadFile(index)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(filepath.Join(root, "file.txt"), time.Now(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := Combined(context.Background(), root, "status", "--porcelain"); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(index)
	if string(before) != string(after) {
		t.Fatal("read-only status refreshed the index")
	}
}
