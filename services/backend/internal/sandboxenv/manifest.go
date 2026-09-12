// Package sandboxenv describes the concrete local execution environment a
// planner's plan will actually run in: the host machine's resources, the
// Protected runner container's limits, the toolchain that container really
// ships, and the closed policy/protocol budgets a plan must respect.
//
// It exists because a remote planner that cannot see any of this guesses:
// observed production failures include proposing `jq` (absent from the runner
// image), `python3` (denied by policy), and `timeout_seconds` outside the
// accepted range — each costing a full request round trip. Publishing the
// environment turns those guesses into knowledge.
//
// The manifest is descriptive only. It never grants a capability: the policy
// engine, protocol validator and runner remain the enforcement points, and
// this package reads their exported constants rather than restating them.
package sandboxenv

import (
	"encoding/json"
	"fmt"
	"strings"
)

// SchemaVersion identifies the manifest wire shape. Bump it when the JSON
// published to the planner changes incompatibly.
const SchemaVersion = "wharness.environment/v1"

// Manifest is the complete environment description attached to a planner
// request. Every field is Wharnex-derived; none of it is planner-supplied.
type Manifest struct {
	Schema   string          `json:"schema"`
	Host     Host            `json:"host"`
	Sandbox  Sandbox         `json:"sandbox"`
	Tools    []Tool          `json:"tools"`
	Policy   PolicySummary   `json:"policy"`
	Budgets  ProtocolBudgets `json:"budgets"`
	Warnings []string        `json:"warnings,omitempty"`
}

// Host describes the operator machine that owns the project and runs the
// containers. RAM/disk figures are the practical ceiling for anything a plan
// asks the sandbox to do, so they belong in the planner's view.
type Host struct {
	OS                 string   `json:"os"`
	Kernel             string   `json:"kernel"`
	Arch               string   `json:"arch"`
	CPUs               int      `json:"cpus"`
	MemoryTotalMB      int64    `json:"memory_total_mb"`
	MemoryAvailableMB  int64    `json:"memory_available_mb"`
	Filesystems        []Volume `json:"filesystems"`
	ContainerizedAgent bool     `json:"containerized_backend"`
}

// Volume is one filesystem the execution path depends on. purpose says why
// Wharnex cares about it, so a planner can tell "the project disk is nearly
// full" apart from "the sandbox scratch disk is nearly full".
type Volume struct {
	Purpose  string `json:"purpose"`
	Path     string `json:"path"`
	TotalMB  int64  `json:"total_mb"`
	FreeMB   int64  `json:"free_mb"`
	Critical bool   `json:"critical,omitempty"`
}

// Sandbox describes the Protected runner container a plan's operations and
// verification commands execute inside.
type Sandbox struct {
	Mode           string            `json:"mode"`
	Image          string            `json:"image"`
	WorkspacePath  string            `json:"workspace_path"`
	NetworkDefault string            `json:"network_default"`
	ReadOnlyRoot   bool              `json:"read_only_root"`
	MemoryLimit    string            `json:"memory_limit"`
	CPULimit       string            `json:"cpu_limit"`
	PidsLimit      int               `json:"pids_limit"`
	TmpfsSize      string            `json:"tmpfs_size"`
	Env            map[string]string `json:"env"`
	Notes          []string          `json:"notes,omitempty"`
}

// Tool is one executable the runner image really ships, with the version it
// really reports. Absent tools are simply not listed: the planner must treat
// this list as the closed set of non-toolchain-builtin executables available.
type Tool struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Path    string `json:"path,omitempty"`
}

// PolicySummary republishes the policy engine's closed decision sets so a plan
// is written against them instead of discovering them through a rejection.
type PolicySummary struct {
	DeniedExecutables   []string `json:"denied_executables"`
	ElevatedExecutables []string `json:"elevated_executables"`
	GitReadOnly         []string `json:"git_read_only_subcommands"`
	GitMutable          []string `json:"git_mutable_subcommands_requiring_approval"`
	DeniedGitFlags      []string `json:"denied_git_flags"`
	Rules               []string `json:"rules"`
}

// ProtocolBudgets republishes the protocol validator's numeric limits. A plan
// that exceeds one of these is rejected wholesale, so the planner must know
// them before it writes the plan rather than after.
type ProtocolBudgets struct {
	CommandTimeoutSecondsMin     int `json:"command_timeout_seconds_min"`
	CommandTimeoutSecondsMax     int `json:"command_timeout_seconds_max"`
	CommandTimeoutSecondsDefault int `json:"command_timeout_seconds_default"`
	MaxOperations                int `json:"max_operations"`
	MaxVerificationCommands      int `json:"max_verification_commands"`
	MaxCommandArgs               int `json:"max_command_args"`
	MaxImpactFiles               int `json:"max_impact_files"`
	MaxReadFiles                 int `json:"max_read_files"`
	MaxBarrierFiles              int `json:"max_barrier_files"`
	MaxPatchBytes                int `json:"max_patch_bytes"`
}

// ToolNames returns the manifest's tool names in listing order. Used by the
// prompt renderer and by tests asserting a specific inventory reached the
// planner.
func (m Manifest) ToolNames() []string {
	names := make([]string, 0, len(m.Tools))
	for _, tool := range m.Tools {
		names = append(names, tool.Name)
	}
	return names
}

// LowDiskVolumes returns the filesystems whose free space is under threshold.
// A caller uses it to warn before a large verification run rather than after
// the runner reports "no space left on device" mid-test.
func (m Manifest) LowDiskVolumes(thresholdMB int64) []Volume {
	low := make([]Volume, 0)
	for _, volume := range m.Host.Filesystems {
		if volume.TotalMB > 0 && volume.FreeMB < thresholdMB {
			low = append(low, volume)
		}
	}
	return low
}

// JSON renders the manifest as the stable indented document embedded in the
// planner prompt. It never fails for a well-formed Manifest; an encoding error
// degrades to an empty document rather than breaking prompt construction,
// because a missing environment section must never block a request.
func (m Manifest) JSON() string {
	encoded, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return ""
	}
	return string(encoded)
}

// Render produces the planner-facing prompt section: a short prose contract
// stating how the environment must be used, followed by the machine-readable
// manifest. Returns "" for a zero Manifest so callers can concatenate
// unconditionally.
func (m Manifest) Render() string {
	if m.Schema == "" {
		return ""
	}
	var b strings.Builder
	b.WriteString("\nLOCAL EXECUTION ENVIRONMENT — AUTHORITATIVE, WHARNEX-MEASURED:\n")
	b.WriteString("- This section describes the real machine and the real Protected container your plan will run in. It is measured by Wharnex, not guessed, and it overrides any assumption you hold about a generic Linux box.\n")
	b.WriteString("- Every operation and verification command MUST use only the executables listed under tools, plus the language toolchains they belong to. An executable that is not listed is NOT installed: proposing it wastes the whole round trip on exit code 127.\n")
	b.WriteString("- policy.denied_executables are rejected before execution. Never propose them, not even inside a verification step. Use the listed equivalents instead.\n")
	b.WriteString("- budgets are hard protocol limits. A command_timeout outside the published range, or a plan over a listed maximum, is rejected as a protocol error and the entire bundle is discarded.\n")
	b.WriteString("- Size verification work against the published sandbox limits and free disk. Prefer targeted package tests over a whole-repository race build when the free space or memory headroom is small.\n")
	if low := m.LowDiskVolumes(lowDiskWarningMB); len(low) > 0 {
		paths := make([]string, 0, len(low))
		for _, volume := range low {
			paths = append(paths, fmt.Sprintf("%s (%d MB free)", volume.Purpose, volume.FreeMB))
		}
		b.WriteString("- DISK PRESSURE WARNING: " + strings.Join(paths, ", ") + ". Keep verification narrow; a full parallel/race build is likely to fail with a device-full error that no source patch can fix.\n")
	}
	for _, warning := range m.Warnings {
		b.WriteString("- NOTE: " + warning + "\n")
	}
	b.WriteString("\n```json\n")
	b.WriteString(m.JSON())
	b.WriteString("\n```\n")
	return b.String()
}

// lowDiskWarningMB is the free-space threshold below which the prompt tells
// the planner to keep verification narrow. Chosen from the observed failure:
// a `go test -race ./...` of this repository exhausted a 512 MB scratch
// filesystem, so a headroom under roughly two of those is worth flagging.
const lowDiskWarningMB = 1536
