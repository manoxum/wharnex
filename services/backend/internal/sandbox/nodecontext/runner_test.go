package nodecontext_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox"
)

func TestNestedPnpmVerificationUsesRealSandboxDependencyPreparation(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"services/backend/package.json":            `{"scripts":{"be:build":"node verify.mjs"}}`,
		"services/backend/verify.mjs":              `import fs from 'node:fs'; console.log(fs.readFileSync('node_modules/.bin/probe','utf8'));`,
		"services/backend/node_modules/.bin/probe": "nested-dependencies-ready",
	}
	for rel, content := range files {
		path := filepath.Join(root, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	runner := sandbox.NewLocalRunner()
	workspace, err := runner.Prepare(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runner.Cleanup(workspace) })
	if _, err := os.Stat(filepath.Join(workspace.Path, "services/backend/node_modules")); !os.IsNotExist(err) {
		t.Fatal("initial context must exclude dependency trees")
	}
	command := domain.CommandSpec{
		Argv: []string{"pnpm", "--dir", "services/backend", "run", "be:build"},
		Cwd:  ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0},
	}
	result, err := runner.Run(t.Context(), workspace, command)
	if err != nil || !result.Success || !strings.Contains(result.Stdout, "nested-dependencies-ready") {
		t.Fatalf("real nested-package verification failed: %+v; %v", result, err)
	}
	if _, err := os.Stat(filepath.Join(root, ".kernl")); !os.IsNotExist(err) {
		t.Fatal("hydration modified the host project")
	}
}
