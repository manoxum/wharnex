package sandbox

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocalRunnerTreatsAlreadyAppliedPatchAsSuccess(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("new\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := NewLocalRunner()
	workspace, err := runner.Prepare(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Cleanup(workspace)
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n"
	result, err := runner.ApplyPatch(context.Background(), workspace, patch)
	if err != nil {
		t.Fatalf("already applied patch should be idempotent: %v", err)
	}
	if !result.Success || !strings.Contains(result.Stdout, "already applied") {
		t.Fatalf("expected already-applied success, got %#v", result)
	}
}
