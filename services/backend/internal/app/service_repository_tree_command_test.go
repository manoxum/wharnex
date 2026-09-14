package app

import (
	"context"
	"reflect"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox"
)

func TestRepositoryTreeCommandRunsGitPathChecksInsideInitializedSubmodule(t *testing.T) {
	requireGitForApp(t)
	child := gitRepo(t, "ride.ts", "const message = 'Saldo atual: STN'\n")
	root := gitRepo(t, "README.md", "root\n")
	runGitForApp(t, root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", child, "services/admin")
	runGitForApp(t, root, "commit", "-qm", "add admin")

	command := domain.CommandSpec{
		Argv: []string{"git", "grep", "-n", "Saldo atual: STN", "--", "services/admin/ride.ts"},
		Cwd:  ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0},
	}
	normalized := repositoryTreeCommand(context.Background(), root, command)
	if normalized.Cwd != "services/admin" {
		t.Fatalf("cwd = %q, want submodule root", normalized.Cwd)
	}
	wantArgv := []string{"git", "grep", "-n", "Saldo atual: STN", "--", "ride.ts"}
	if !reflect.DeepEqual(normalized.Argv, wantArgv) {
		t.Fatalf("argv = %#v, want %#v", normalized.Argv, wantArgv)
	}
	result, err := sandbox.NewLocalRunner().Run(context.Background(), sandbox.Workspace{Path: root}, normalized)
	if err != nil || !result.Success {
		t.Fatalf("normalized check did not inspect submodule: result=%+v err=%v", result, err)
	}
}

func TestRepositoryTreeCommandDoesNotRewriteMixedRepositoryPaths(t *testing.T) {
	requireGitForApp(t)
	child := gitRepo(t, "child.txt", "child\n")
	root := gitRepo(t, "root.txt", "root\n")
	runGitForApp(t, root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", child, "services/admin")
	runGitForApp(t, root, "commit", "-qm", "add admin")

	command := domain.CommandSpec{Argv: []string{"git", "grep", "-n", "value", "--", "root.txt", "services/admin/child.txt"}, Cwd: "."}
	if got := repositoryTreeCommand(context.Background(), root, command); !reflect.DeepEqual(got, command) {
		t.Fatalf("mixed-root command was rewritten: %#v", got)
	}
}
