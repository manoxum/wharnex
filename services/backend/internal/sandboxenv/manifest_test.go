package sandboxenv

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/protocol"
)

func TestManifestPublishesPolicyAndBudgetsTheEngineActuallyEnforces(t *testing.T) {
	manifest := NewProber("kernl-runner:test", "docker").Manifest(context.Background(), t.TempDir())

	if manifest.Schema != SchemaVersion {
		t.Fatalf("schema = %q, want %q", manifest.Schema, SchemaVersion)
	}
	// The published sets must be the engine's own, never a hand-copied list:
	// the whole point is that the planner sees exactly what will be enforced.
	if got, want := strings.Join(manifest.Policy.DeniedExecutables, ","), strings.Join(policy.DeniedExecutables(), ","); got != want {
		t.Fatalf("denied executables drifted from the policy engine:\n got %s\nwant %s", got, want)
	}
	// python3 was proposed by a real plan and blocked; it must be discoverable.
	if !contains(manifest.Policy.DeniedExecutables, "python3") {
		t.Fatal("python3 must appear in the published denied set")
	}
	if manifest.Budgets.CommandTimeoutSecondsMax != protocol.MaxCommandTimeoutSeconds {
		t.Fatalf("timeout ceiling = %d, want %d", manifest.Budgets.CommandTimeoutSecondsMax, protocol.MaxCommandTimeoutSeconds)
	}
	if manifest.Budgets.CommandTimeoutSecondsMin != protocol.MinCommandTimeoutSeconds {
		t.Fatalf("timeout floor = %d, want %d", manifest.Budgets.CommandTimeoutSecondsMin, protocol.MinCommandTimeoutSeconds)
	}
}

func TestManifestMeasuresHostResources(t *testing.T) {
	manifest := NewProber("", "docker").Manifest(context.Background(), t.TempDir())
	if manifest.Host.CPUs < 1 {
		t.Fatal("cpu count must be measured")
	}
	if manifest.Host.MemoryTotalMB <= 0 {
		t.Fatalf("memory must be measured, got %d MB", manifest.Host.MemoryTotalMB)
	}
	if len(manifest.Host.Filesystems) == 0 {
		t.Fatal("at least the project filesystem must be reported")
	}
	for _, volume := range manifest.Host.Filesystems {
		if volume.TotalMB <= 0 {
			t.Fatalf("filesystem %q reported no capacity", volume.Purpose)
		}
	}
}

// An unreachable Docker daemon or unbuilt image must degrade the section,
// never fail the request that carries it.
func TestManifestDegradesWhenToolchainCannotBeProbed(t *testing.T) {
	manifest := NewProber("", "docker").Manifest(context.Background(), t.TempDir())
	if len(manifest.Warnings) == 0 {
		t.Fatal("an unprobeable toolchain must be reported as a warning")
	}
	if rendered := manifest.Render(); rendered == "" {
		t.Fatal("the section must still render without a toolchain inventory")
	}
}

func TestRenderEmbedsValidJSONAndTheUsageContract(t *testing.T) {
	manifest := NewProber("kernl-runner:test", "docker").Manifest(context.Background(), t.TempDir())
	rendered := manifest.Render()
	for _, required := range []string{
		"LOCAL EXECUTION ENVIRONMENT",
		"denied_executables",
		"command_timeout_seconds_max",
		"exit code 127",
	} {
		if !strings.Contains(rendered, required) {
			t.Fatalf("rendered section is missing %q", required)
		}
	}
	start := strings.Index(rendered, "```json\n")
	end := strings.LastIndex(rendered, "\n```")
	if start < 0 || end <= start {
		t.Fatal("rendered section must embed a fenced JSON document")
	}
	var decoded Manifest
	if err := json.Unmarshal([]byte(rendered[start+len("```json\n"):end]), &decoded); err != nil {
		t.Fatalf("embedded document is not valid JSON: %v", err)
	}
	if decoded.Schema != SchemaVersion {
		t.Fatalf("round-tripped schema = %q", decoded.Schema)
	}
}

func TestRenderWarnsAboutDiskPressure(t *testing.T) {
	manifest := Manifest{Schema: SchemaVersion, Host: Host{Filesystems: []Volume{
		{Purpose: "sandbox-workspace-scratch", TotalMB: 40000, FreeMB: 200},
	}}}
	rendered := manifest.Render()
	if !strings.Contains(rendered, "DISK PRESSURE WARNING") {
		t.Fatalf("a nearly full scratch filesystem must be flagged, got:\n%s", rendered)
	}
	if len(manifest.LowDiskVolumes(lowDiskWarningMB)) != 1 {
		t.Fatal("the low-disk volume must be reported")
	}
}

func TestZeroManifestRendersNothing(t *testing.T) {
	if got := (Manifest{}).Render(); got != "" {
		t.Fatalf("a zero manifest must render empty, got %q", got)
	}
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
