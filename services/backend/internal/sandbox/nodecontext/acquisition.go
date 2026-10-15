package nodecontext

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

type Limits struct {
	Pids                    int
	Memory, CPUs, TmpfsSize string
}

var ErrAcquisition = errors.New("sandbox node dependency acquisition failed")

func Acquire(ctx context.Context, workspacePath, image string, command domain.CommandSpec, limits Limits, validate ValidatePath) error {
	argv, relCwd, err := InstallCommand(workspacePath, command, validate)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrAcquisition, err)
	}
	if err := os.MkdirAll(filepath.Join(workspacePath, ".kernl", "corepack"), 0o700); err != nil {
		return fmt.Errorf("%w: prepare Corepack cache: %v", ErrAcquisition, err)
	}
	if err := os.MkdirAll(filepath.Join(workspacePath, ".kernl", "npm-cache"), 0o700); err != nil {
		return fmt.Errorf("%w: prepare npm cache: %v", ErrAcquisition, err)
	}
	uid, gid := os.Getuid(), os.Getgid()
	containerCwd := "/workspace"
	if relCwd != "." {
		containerCwd += "/" + filepath.ToSlash(relCwd)
	}
	base := []string{
		"run", "--rm", "--read-only", "--network", "bridge",
		"--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
		"--pids-limit", strconv.Itoa(limits.Pids), "--memory", limits.Memory, "--cpus", limits.CPUs,
		"--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=" + limits.TmpfsSize,
		"--env", "HOME=/tmp/kernl-home", "--env", "XDG_CACHE_HOME=/tmp/cache",
		"--env", "COREPACK_HOME=/workspace/.kernl/corepack", "--env", "npm_config_cache=/workspace/.kernl/npm-cache",
		"--user", strconv.Itoa(uid) + ":" + strconv.Itoa(gid),
		"--volume", workspacePath + ":/workspace:rw",
		"--workdir", containerCwd, image,
	}
	const attempts = 3
	var last string
	for attempt := 1; attempt <= attempts; attempt++ {
		args := append(append([]string(nil), base...), argv...)
		output, runErr := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
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
		if !TransientFetch(last) || attempt == attempts {
			return fmt.Errorf("%w after %d attempt(s) running %s: %s", ErrAcquisition, attempt, strings.Join(argv, " "), last)
		}
		time.Sleep(time.Duration(attempt) * 250 * time.Millisecond)
	}
	return fmt.Errorf("%w: %s", ErrAcquisition, last)
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
