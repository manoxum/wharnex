package app

import (
	"context"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
)

// repositoryTreeCommand makes a path-scoped Git check inspect the repository
// that actually owns its paths. Git treats a submodule as one gitlink in the
// superproject, so `git grep -- services/admin/file.ts` silently searches no
// file at all. That can turn a required assertion into a false baseline
// failure during sandbox verification and a later host-Apply rollback.
//
// The rewrite is deliberately narrow: only read-only Git commands whose final
// operands are pathspecs are eligible, every path must live in the same
// initialized submodule, and the command remains argv-only. Other commands
// preserve the planner's explicit cwd and arguments unchanged.
func repositoryTreeCommand(ctx context.Context, workspaceRoot string, command domain.CommandSpec) domain.CommandSpec {
	if command.Cwd != "." || len(command.Argv) < 3 || command.Argv[0] != "git" || !repositoryScopedGitCommand(command.Argv[1]) {
		return command
	}
	separator := -1
	for index, arg := range command.Argv {
		if arg == "--" {
			separator = index
			break
		}
	}
	if separator < 0 || separator == len(command.Argv)-1 {
		return command
	}
	topology, err := hostrepo.Inspect(ctx, workspaceRoot)
	if err != nil {
		// The original command will report its own useful Git error. A topology
		// probe is an optimization for submodule correctness, never a new gate.
		return command
	}
	owner := ""
	paths := command.Argv[separator+1:]
	for _, path := range paths {
		path = strings.TrimPrefix(strings.TrimSpace(path), "./")
		if path == "" || strings.HasPrefix(path, ":(") {
			return command
		}
		submodule, ok := deepestInitializedSubmodule(topology, path)
		if !ok {
			return command
		}
		if owner != "" && owner != submodule.Path {
			return command
		}
		owner = submodule.Path
	}
	if owner == "" {
		return command
	}
	normalized := command
	normalized.Cwd = owner
	normalized.Argv = append([]string(nil), command.Argv...)
	for index := separator + 1; index < len(normalized.Argv); index++ {
		normalized.Argv[index] = strings.TrimPrefix(strings.TrimPrefix(normalized.Argv[index], "./"), owner+"/")
	}
	return normalized
}

func repositoryScopedGitCommand(verb string) bool {
	switch verb {
	case "grep", "diff", "diff-files", "diff-index", "log", "ls-files", "status":
		return true
	default:
		return false
	}
}

func deepestInitializedSubmodule(topology hostrepo.Topology, path string) (hostrepo.Submodule, bool) {
	var match hostrepo.Submodule
	for _, submodule := range topology.Submodules {
		if !submodule.Initialized || (path != submodule.Path && !strings.HasPrefix(path, submodule.Path+"/")) {
			continue
		}
		if len(submodule.Path) > len(match.Path) {
			match = submodule
		}
	}
	return match, match.Path != ""
}
