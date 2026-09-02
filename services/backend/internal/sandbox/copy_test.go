package sandbox

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestCopyProjectExcludesSecrets(t *testing.T) {
	root := t.TempDir()
	_ = os.WriteFile(filepath.Join(root, "main.txt"), []byte("ok"), 0o600)
	_ = os.WriteFile(filepath.Join(root, ".env"), []byte("secret"), 0o600)
	ws, err := copyProject(root)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(ws.Path)
	if _, err := os.Stat(filepath.Join(ws.Path, "main.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(ws.Path, ".env")); !os.IsNotExist(err) {
		t.Fatal(".env should not be copied")
	}
}

func TestCopyProjectCreatesTrackedGitBaseline(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("before\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ws, err := copyProject(root)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(ws.Path)
	if _, err := os.Stat(filepath.Join(ws.Path, ".git")); err != nil {
		t.Fatalf("sandbox .git missing: %v", err)
	}
	if err := os.WriteFile(filepath.Join(ws.Path, "hello.txt"), []byte("after\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("git", "-C", ws.Path, "diff", "--check")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git diff --check should work in sandbox: %v: %s", err, output)
	}
	cmd = exec.Command("git", "-C", ws.Path, "diff", "--", "hello.txt")
	output, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(output), "-before") || !strings.Contains(string(output), "+after") {
		t.Fatalf("sandbox baseline did not track copied files: %s", output)
	}
}

func TestLocalRunnerApplyPatchFallsBackToRecount(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("a\nb\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := NewLocalRunner()
	workspace, err := runner.Prepare(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Cleanup(workspace)
	patch := "diff --git a/hello.txt b/hello.txt\n--- a/hello.txt\n+++ b/hello.txt\n@@ -1,99 +1,99 @@\n-a\n+A\n b\n"
	result, err := runner.ApplyPatch(context.Background(), workspace, patch)
	if err != nil {
		t.Fatalf("recount fallback failed: %v; stderr=%s", err, result.Stderr)
	}
	data, err := os.ReadFile(filepath.Join(workspace.Path, "hello.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "A\nb\n" {
		t.Fatalf("unexpected patched content: %q", data)
	}
}

func TestLocalRunnerApplyPatchReportsGitDiagnostic(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("actual\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := NewLocalRunner()
	workspace, err := runner.Prepare(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Cleanup(workspace)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-missing\n+new\n"
	_, err = runner.ApplyPatch(context.Background(), workspace, patch)
	if err == nil || !strings.Contains(err.Error(), "patch does not apply cleanly") || !strings.Contains(err.Error(), "hello.txt") {
		t.Fatalf("expected useful git diagnostic, got %v", err)
	}
}
