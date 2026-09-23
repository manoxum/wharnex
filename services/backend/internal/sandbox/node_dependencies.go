package sandbox

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

// prepareNodeDependenciesContext copies only a usable host dependency tree.
// A directory named node_modules is not evidence of a runnable toolchain: a
// partial copy (or a tree produced for a different platform) used to reach the
// command runner and fail as an avoidable exit 127.
func prepareNodeDependenciesContext(ctx context.Context, workspace Workspace, command domain.CommandSpec) error {
	if !requiresLocalNodeDependencies(command.Argv) {
		return nil
	}
	if _, err := os.Stat(filepath.Join(workspace.Path, ".pnp.cjs")); err == nil {
		return nil
	}
	relCwd := command.Cwd
	if relCwd == "" {
		relCwd = "."
	}
	if _, err := safeRelativePath(workspace.SourcePath, relCwd); err != nil {
		return err
	}
	if _, err := safeRelativePath(workspace.Path, relCwd); err != nil {
		return err
	}
	candidates := [][2]string{{workspace.SourcePath, workspace.Path}}
	if relCwd != "." {
		candidates = append(candidates, [2]string{filepath.Join(workspace.SourcePath, filepath.Clean(relCwd)), filepath.Join(workspace.Path, filepath.Clean(relCwd))})
	}
	for _, candidate := range candidates {
		source, target := filepath.Join(candidate[0], "node_modules"), filepath.Join(candidate[1], "node_modules")
		if nodeModulesUsable(target) {
			continue
		}
		if err := os.RemoveAll(target); err != nil {
			return fmt.Errorf("clear incomplete sandbox node dependencies: %w", err)
		}
		if !nodeModulesUsable(source) {
			continue
		}
		if err := copyDependencyTreeContext(ctx, source, target, workspace.SourcePath, workspace.Path); err != nil {
			return fmt.Errorf("prepare sandbox node dependencies: %w", err)
		}
		if !nodeModulesUsable(target) {
			return fmt.Errorf("%w: copied node_modules is incomplete", ErrNodeDependenciesUnavailable)
		}
	}
	for _, candidate := range candidates {
		if nodeModulesUsable(filepath.Join(candidate[1], "node_modules")) {
			return nil
		}
	}
	return fmt.Errorf("%w: usable node_modules was not found in the project workspace or host tree", ErrNodeDependenciesUnavailable)
}

func nodeModulesUsable(path string) bool {
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return false
	}
	entries, err := os.ReadDir(filepath.Join(path, ".bin"))
	return err == nil && len(entries) > 0
}

func requiresLocalNodeDependencies(argv []string) bool {
	if len(argv) == 0 {
		return false
	}
	tool := filepath.ToSlash(argv[0])
	if strings.HasPrefix(tool, "./node_modules/.bin/") || strings.HasPrefix(tool, "node_modules/.bin/") {
		return true
	}
	switch filepath.Base(tool) {
	case "npx":
		return true
	case "npm":
		return len(argv) >= 2 && (argv[1] == "run" || argv[1] == "run-script" || argv[1] == "test" || argv[1] == "start" || argv[1] == "exec")
	case "pnpm", "yarn", "bun":
		if len(argv) < 2 {
			return false
		}
		switch argv[1] {
		case "install", "add", "remove", "update", "config", "cache", "--version", "-v":
			return false
		}
		return true
	}
	return false
}
