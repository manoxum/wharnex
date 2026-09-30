package sandbox

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

func (r *DockerRunner) acquireNodeDependencies(ctx context.Context, workspace Workspace, command domain.CommandSpec) error {
	argv, relCwd, err := nodeDependencyInstallCommand(workspace.Path, command.Cwd)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrNodeDependencyAcquisition, err)
	}
	for _, cache := range []string{"corepack", "npm-cache"} {
		if err := os.MkdirAll(filepath.Join(workspace.Path, ".kernl", cache), 0o700); err != nil {
			return fmt.Errorf("%w: prepare %s cache: %v", ErrNodeDependencyAcquisition, cache, err)
		}
	}
	base := nodeAcquisitionDockerArgs(workspace.Path, relCwd, r.image)
	const attempts = 3
	var last string
	for attempt := 1; attempt <= attempts; attempt++ {
		output, runErr := exec.CommandContext(ctx, "docker", append(base, argv...)...).CombinedOutput()
		last = strings.TrimSpace(string(output))
		if runErr == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if fallback := npmPeerCompatibilityCommand(argv, last); fallback != nil {
			argv = fallback
			attempt--
			continue
		}
		if !transientNodeDependencyFetch(last) || attempt == attempts {
			return fmt.Errorf("%w after %d attempt(s) running %s: %s", ErrNodeDependencyAcquisition, attempt, strings.Join(argv, " "), last)
		}
		time.Sleep(time.Duration(attempt) * 250 * time.Millisecond)
	}
	return fmt.Errorf("%w: %s", ErrNodeDependencyAcquisition, last)
}

func nodeAcquisitionDockerArgs(workspacePath, relCwd, image string) []string {
	uid, gid := os.Getuid(), os.Getgid()
	limits := CurrentRunnerLimits()
	containerCwd := "/workspace"
	if relCwd != "." {
		containerCwd += "/" + filepath.ToSlash(relCwd)
	}
	return []string{
		"run", "--rm", "--read-only", "--network", "bridge",
		"--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
		"--pids-limit", strconv.Itoa(limits.Pids), "--memory", limits.Memory, "--cpus", limits.CPUs,
		"--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=" + limits.TmpfsSize,
		"--env", "HOME=/tmp/kernl-home", "--env", "XDG_CACHE_HOME=/tmp/cache",
		"--env", "COREPACK_HOME=/workspace/.kernl/corepack", "--env", "npm_config_cache=/workspace/.kernl/npm-cache",
		"--user", strconv.Itoa(uid) + ":" + strconv.Itoa(gid),
		"--volume", workspacePath + ":/workspace:rw", "--workdir", containerCwd, image,
	}
}

func npmPeerCompatibilityCommand(argv []string, output string) []string {
	if len(argv) != 2 || argv[0] != "npm" || argv[1] != "ci" {
		return nil
	}
	lower := strings.ToLower(output)
	if !strings.Contains(lower, "eresolve") ||
		(!strings.Contains(lower, "peer dependency") && !strings.Contains(lower, "could not resolve dependency")) {
		return nil
	}
	return []string{"npm", "ci", "--legacy-peer-deps"}
}

func nodeDependencyInstallCommand(workspacePath, commandCwd string) ([]string, string, error) {
	root := filepath.Clean(workspacePath)
	rel := strings.TrimSpace(commandCwd)
	if rel == "" {
		rel = "."
	}
	current, err := safeWorkspaceCwd(root, rel)
	if err != nil {
		return nil, "", err
	}
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
		if parent == current || (!strings.HasPrefix(parent+string(filepath.Separator), root+string(filepath.Separator)) && parent != root) {
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

func transientNodeDependencyFetch(output string) bool {
	lower := strings.ToLower(output)
	for _, marker := range []string{"eai_again", "enotfound", "econnreset", "etimedout", "temporary failure in name resolution", "connection reset by peer", "network is unreachable", "registry.npmjs.org"} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}
