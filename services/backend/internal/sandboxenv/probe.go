package sandboxenv

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/protocol"
	"kernl.local/harness/backend/internal/sandbox"
)

// toolchainProbeTimeout bounds the single `docker run` that asks the runner
// image to describe itself. It is short on purpose: an environment section is
// a nice-to-have for the planner, never a reason to delay a request.
const toolchainProbeTimeout = 20 * time.Second

// toolchainCacheTTL re-probes periodically so a rebuilt runner image is picked
// up without restarting the backend, while a burst of requests shares one
// probe.
const toolchainCacheTTL = 30 * time.Minute

// Prober builds environment manifests. It caches the expensive part — asking
// the runner image for its own toolchain inventory — so per-request cost is a
// few cheap /proc reads.
type Prober struct {
	image       string
	sandboxKind string

	mu       sync.Mutex
	tools    []Tool
	toolsErr string
	probedAt time.Time
}

// NewProber returns a prober for the configured runner image. sandboxKind is
// the configured sandbox adapter ("docker" or "local"); a local dev sandbox
// has no container limits to report and says so rather than publishing the
// Docker figures as if they applied.
func NewProber(image, sandboxKind string) *Prober {
	return &Prober{image: strings.TrimSpace(image), sandboxKind: strings.TrimSpace(sandboxKind)}
}

// Manifest measures the current environment. projectPath is the host project
// the request targets; its filesystem is reported alongside the scratch
// filesystem the sandbox workspace is created on, because either running out
// of space fails a verification run in a way no source patch can repair.
//
// Probing never fails the caller: an unreachable Docker daemon or unreadable
// /proc downgrades individual fields and records a warning.
func (p *Prober) Manifest(ctx context.Context, projectPath string) Manifest {
	manifest := Manifest{
		Schema:  SchemaVersion,
		Host:    probeHost(projectPath),
		Sandbox: p.describeSandbox(),
		Policy:  describePolicy(),
		Budgets: describeBudgets(),
	}
	manifest.TestHarnesses = probeTestHarnesses(projectPath)
	tools, warning := p.toolchain(ctx)
	manifest.Tools = tools
	if warning != "" {
		manifest.Warnings = append(manifest.Warnings, warning)
	}
	if p.sandboxKind == "local" {
		manifest.Warnings = append(manifest.Warnings, "the local development sandbox is active: commands run directly on the host toolchain without container isolation or the container resource limits described above")
	}
	return manifest
}

func (p *Prober) describeSandbox() Sandbox {
	limits := sandbox.CurrentRunnerLimits()
	described := Sandbox{
		Mode:           "protected-docker",
		Image:          p.image,
		WorkspacePath:  "/workspace",
		NetworkDefault: "none",
		ReadOnlyRoot:   true,
		MemoryLimit:    limits.Memory,
		CPULimit:       limits.CPUs,
		PidsLimit:      limits.Pids,
		TmpfsSize:      limits.TmpfsSize,
		Env:            limits.Env,
		Notes: []string{
			"the workspace is an isolated copy/clone of the project, mounted read-write at /workspace; the container root filesystem is read-only",
			"all Linux capabilities are dropped and no-new-privileges is set; there is no Docker socket and no host mount",
			"network is disabled for every command unless the plan explicitly sets network=true, which requires approval; with network off GOPROXY=off, so only modules already in the Wharnex-owned cache resolve",
			"GOCACHE and GOMODCACHE live on the workspace volume, not on the /tmp tmpfs, so a large build is bounded by host disk rather than by tmpfs_size",
		},
	}
	if p.sandboxKind == "local" {
		described.Mode = "local-development"
		described.ReadOnlyRoot = false
		described.Notes = []string{"local development sandbox: no container isolation and no resource limits"}
	}
	return described
}

func describePolicy() PolicySummary {
	return PolicySummary{
		DeniedExecutables:   policy.DeniedExecutables(),
		ElevatedExecutables: policy.ElevatedExecutables(),
		GitReadOnly:         policy.GitReadOnlySubcommands(),
		GitMutable:          policy.GitMutableSubcommands(),
		DeniedGitFlags:      policy.DeniedGitFlags(),
		Rules: []string{
			"commands are argv arrays; there is no shell, so pipes, redirects, globbing, command substitution and chaining are unavailable — express them as separate operations or as a tool's own flags",
			"a denied executable rejects the whole plan before anything executes",
			"an elevated executable is allowed but raises plan risk to at least medium",
			"a git subcommand outside the read-only list requires explicit user approval; one outside both lists is denied; dual-mode read-only entries remain argument-checked (symbolic-ref is query-only)",
			"remote git (fetch/pull/push) additionally requires network=true and is high risk",
			"npm install/i/publish require approval; go generate/install/env are denied",
		},
	}
}

func describeBudgets() ProtocolBudgets {
	return ProtocolBudgets{
		CommandTimeoutSecondsMin:     protocol.MinCommandTimeoutSeconds,
		CommandTimeoutSecondsMax:     protocol.MaxCommandTimeoutSeconds,
		CommandTimeoutSecondsDefault: protocol.DefaultCommandTimeoutSeconds,
		MaxOperations:                protocol.MaxOperations,
		MaxVerificationCommands:      protocol.MaxVerificationCommands,
		MaxCommandArgs:               protocol.MaxCommandArgs,
		MaxImpactFiles:               protocol.MaxImpactFiles,
		MaxReadFiles:                 protocol.MaxReadFiles,
		MaxBarrierFiles:              protocol.MaxBarrierFiles,
		MaxPatchBytes:                protocol.MaxPatchBytes,
	}
}

// toolchain returns the runner image's self-declared inventory, probing at
// most once per toolchainCacheTTL. The image describes itself (via the
// kernl-toolchain entrypoint baked into it) rather than Wharnex maintaining a
// parallel list that silently drifts from the Dockerfile.
func (p *Prober) toolchain(ctx context.Context) ([]Tool, string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.probedAt.IsZero() && time.Since(p.probedAt) < toolchainCacheTTL {
		return p.tools, p.toolsErr
	}
	tools, err := probeRunnerToolchain(ctx, p.image)
	p.probedAt = time.Now()
	if err != nil {
		p.tools = nil
		p.toolsErr = "the runner image toolchain inventory could not be read (" + err.Error() + "); assume only git, make, go, node, npm and the standard coreutils are present and prefer verification through the project's own scripts"
		return p.tools, p.toolsErr
	}
	p.tools = tools
	p.toolsErr = ""
	return p.tools, ""
}

func probeRunnerToolchain(ctx context.Context, image string) ([]Tool, error) {
	if strings.TrimSpace(image) == "" {
		return nil, errNoImage
	}
	if _, err := exec.LookPath("docker"); err != nil {
		return nil, err
	}
	runCtx, cancel := context.WithTimeout(ctx, toolchainProbeTimeout)
	defer cancel()
	cmd := exec.CommandContext(runCtx, "docker", "run", "--rm", "--network", "none",
		"--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
		"--tmpfs", "/tmp:rw,nosuid,nodev,size=16m",
		"--entrypoint", "/usr/local/bin/kernl-toolchain", image)
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	var payload struct {
		Tools []Tool `json:"tools"`
	}
	if err := json.Unmarshal(output, &payload); err != nil {
		return nil, err
	}
	return payload.Tools, nil
}

type probeError string

func (e probeError) Error() string { return string(e) }

const errNoImage = probeError("no runner image is configured")

func probeHost(projectPath string) Host {
	host := Host{
		OS:                 osRelease(),
		Kernel:             kernelRelease(),
		Arch:               runtime.GOARCH,
		CPUs:               runtime.NumCPU(),
		ContainerizedAgent: backendRunsInContainer(),
	}
	host.MemoryTotalMB, host.MemoryAvailableMB = memoryMB()
	host.Filesystems = filesystems(projectPath)
	return host
}

func osRelease() string {
	file, err := os.Open("/etc/os-release")
	if err != nil {
		return runtime.GOOS
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if value, ok := strings.CutPrefix(line, "PRETTY_NAME="); ok {
			return strings.Trim(strings.TrimSpace(value), `"`)
		}
	}
	return runtime.GOOS
}

func kernelRelease() string {
	if data, err := os.ReadFile("/proc/sys/kernel/osrelease"); err == nil {
		return strings.TrimSpace(string(data))
	}
	return ""
}

// memoryMB reads /proc/meminfo. MemAvailable is the kernel's own estimate of
// what a new workload can claim without swapping — a far better signal for
// "can this machine run a race build" than MemFree.
func memoryMB() (total, available int64) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		kb, convErr := strconv.ParseInt(fields[1], 10, 64)
		if convErr != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			total = kb / 1024
		case "MemAvailable:":
			available = kb / 1024
		}
	}
	return total, available
}

// filesystems reports the volumes a Protected run actually consumes: the
// project itself, and the scratch directory sandbox workspaces are created in
// (os.MkdirTemp's target — the one that filled up and produced "no space left
// on device" mid-verification in production). Duplicate devices are collapsed
// so a single-disk machine is not reported twice.
func filesystems(projectPath string) []Volume {
	candidates := []struct {
		purpose string
		path    string
	}{
		{"project", strings.TrimSpace(projectPath)},
		{"sandbox-workspace-scratch", os.TempDir()},
	}
	volumes := make([]Volume, 0, len(candidates))
	seen := make(map[uint64]bool, len(candidates))
	for _, candidate := range candidates {
		if candidate.path == "" {
			continue
		}
		var stat syscall.Statfs_t
		if err := syscall.Statfs(candidate.path, &stat); err != nil {
			continue
		}
		device, ok := deviceID(candidate.path)
		if ok {
			if seen[device] {
				// Same underlying device as one already reported; keep the
				// first (more specific) purpose rather than repeating figures.
				continue
			}
			seen[device] = true
		}
		blockSize := int64(stat.Bsize)
		total := int64(stat.Blocks) * blockSize / (1 << 20)
		free := int64(stat.Bavail) * blockSize / (1 << 20)
		volumes = append(volumes, Volume{
			Purpose:  candidate.purpose,
			Path:     filepath.Clean(candidate.path),
			TotalMB:  total,
			FreeMB:   free,
			Critical: free < lowDiskWarningMB,
		})
	}
	return volumes
}

// deviceID identifies the block device backing a path, so two candidate
// directories that live on the same disk are reported once.
func deviceID(path string) (uint64, bool) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, false
	}
	return uint64(stat.Dev), true
}

// backendRunsInContainer reports whether the Wharnex backend itself is
// containerized. It changes what the reported paths mean (the backend's view
// of a path may differ from the operator's), so the planner is told.
func backendRunsInContainer() bool {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	return false
}
