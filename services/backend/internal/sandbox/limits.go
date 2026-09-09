package sandbox

import (
	"os"
	"strconv"
	"strings"
)

// RunnerLimits are the resource controls applied to every Protected runner
// container, in the exact form passed to `docker run`. They are a named,
// exported value because they are published to the planner through the
// environment manifest: a plan that cannot see the memory ceiling or the
// scratch-filesystem size proposes verification work the sandbox cannot
// finish, and the round trip is lost to an infrastructure error rather than a
// source defect.
type RunnerLimits struct {
	Memory    string
	CPUs      string
	Pids      int
	TmpfsSize string
	Env       map[string]string
}

// Defaults are deliberately more generous than the original 2g/512m pair.
// Production evidence: a `go test -race ./...` of this repository exhausted a
// 512 MiB /tmp tmpfs while writing the race-instrumented link output, failing
// the whole request with "no space left on device" — a condition no source
// patch can repair. Raising the scratch size and moving the Go build cache off
// tmpfs (see workspaceGoBuildCache) removes both halves of that failure.
const (
	defaultRunnerMemory    = "4g"
	defaultRunnerCPUs      = "2"
	defaultRunnerPids      = 512
	defaultRunnerTmpfsSize = "1g"

	// workspaceGoBuildCache keeps GOCACHE on the workspace bind mount — real
	// host disk — instead of the size-capped tmpfs. GOMODCACHE already lives
	// there; a race build's object cache is far larger than a module cache
	// and was the actual thing that overflowed.
	workspaceGoBuildCache = "/workspace/.kernl/go-build"
)

// CurrentRunnerLimits returns the limits this process applies, including any
// operator overrides. Overrides exist so a machine with more (or less)
// headroom can be tuned without a rebuild; each is validated and falls back to
// the default rather than passing an unparseable value to Docker.
func CurrentRunnerLimits() RunnerLimits {
	return RunnerLimits{
		Memory:    sizeEnv("WHARNESS_RUNNER_MEMORY", defaultRunnerMemory),
		CPUs:      decimalEnv("WHARNESS_RUNNER_CPUS", defaultRunnerCPUs),
		Pids:      intEnv("WHARNESS_RUNNER_PIDS", defaultRunnerPids),
		TmpfsSize: sizeEnv("WHARNESS_RUNNER_TMPFS", defaultRunnerTmpfsSize),
		Env: map[string]string{
			"GOCACHE":          workspaceGoBuildCache,
			"GOMODCACHE":       "/workspace/.kernl/go-mod",
			"GOPROXY":          "off (unless the command declares network=true)",
			"HOME":             "/tmp/kernl-home",
			"npm_config_cache": "/tmp/npm",
		},
	}
}

// sizeEnv accepts a Docker size string such as 512m, 2g or 1500M.
func sizeEnv(name, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	digits := strings.TrimRight(value, "bBkKmMgG")
	if digits == "" || digits == value {
		if _, err := strconv.ParseInt(value, 10, 64); err != nil {
			return fallback
		}
		return value
	}
	if _, err := strconv.ParseInt(digits, 10, 64); err != nil {
		return fallback
	}
	return value
}

func decimalEnv(name, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return value
}

func intEnv(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
