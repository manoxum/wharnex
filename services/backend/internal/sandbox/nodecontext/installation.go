package nodecontext

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

func InstallCommand(workspacePath string, command domain.CommandSpec, validate ValidatePath) ([]string, string, error) {
	commandCwd, err := TargetCwd(command)
	if err != nil {
		return nil, "", err
	}
	root := filepath.Clean(workspacePath)
	rel := strings.TrimSpace(commandCwd)
	if rel == "" {
		rel = "."
	}
	start, err := validate(root, rel)
	if err != nil {
		return nil, "", err
	}
	current := start
	for {
		if _, err := os.Stat(filepath.Join(current, "pnpm-lock.yaml")); err == nil {
			return []string{"pnpm", "install", "--frozen-lockfile"}, relativeWorkspaceDir(root, current), nil
		}
		if _, err := os.Stat(filepath.Join(current, "yarn.lock")); err == nil {
			return []string{"yarn", "install", "--frozen-lockfile"}, relativeWorkspaceDir(root, current), nil
		}
		if _, err := os.Stat(filepath.Join(current, "package-lock.json")); err == nil {
			return []string{"npm", "ci"}, relativeWorkspaceDir(root, current), nil
		}
		if _, err := os.Stat(filepath.Join(current, "npm-shrinkwrap.json")); err == nil {
			return []string{"npm", "ci"}, relativeWorkspaceDir(root, current), nil
		}
		if current == root {
			break
		}
		parent := filepath.Dir(current)
		if parent == current || !strings.HasPrefix(parent+string(filepath.Separator), root+string(filepath.Separator)) && parent != root {
			break
		}
		current = parent
	}
	return nil, "", errors.New("no supported lockfile found; automatic sandbox acquisition requires pnpm-lock.yaml, yarn.lock, package-lock.json or npm-shrinkwrap.json")
}

func relativeWorkspaceDir(root, path string) string {
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "" {
		return "."
	}
	return filepath.Clean(rel)
}

func TransientFetch(output string) bool {
	lower := strings.ToLower(output)
	for _, marker := range []string{"eai_again", "enotfound", "econnreset", "etimedout", "temporary failure in name resolution", "connection reset by peer", "network is unreachable", "registry.npmjs.org"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}
