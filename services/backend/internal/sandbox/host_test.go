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
