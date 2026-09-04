package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestHostRunnerExecutesArgvInsideRealProject(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "visible.txt"), []byte("ok\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := NewHostRunner()
	workspace, err := runner.Prepare(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	result, err := runner.Run(context.Background(), workspace, domain.CommandSpec{Argv: []string{"ls"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || !strings.Contains(result.Stdout, "visible.txt") {
		t.Fatalf("host argv did not execute in project root: %#v", result)
	}
}

func TestHostRunnerReversePatchValidatesAndReverts(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "hello.txt")
	if err := os.WriteFile(path, []byte("new\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runner := NewHostRunner()
	workspace, err := runner.Prepare(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	patch := "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n"
	result, err := runner.ReversePatch(context.Background(), workspace, patch)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success {
		t.Fatalf("reverse patch failed: %#v", result)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "old\n" {
		t.Fatalf("reverse patch produced %q", contents)
	}
}
