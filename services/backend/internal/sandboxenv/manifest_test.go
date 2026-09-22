package sandboxenv

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
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
	if !contains(manifest.Policy.GitReadOnly, "symbolic-ref") {
		t.Fatal("symbolic-ref query support must appear in the published read-only Git set")
	}
	if rules := strings.Join(manifest.Policy.Rules, "\n"); !strings.Contains(rules, "symbolic-ref is query-only") {
		t.Fatalf("published Git rules must describe the symbolic-ref argument guard, got:\n%s", rules)
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
		"sandbox_tools",
		"host_tools",
		"deterministic lockfile",
		"denied_executables",
		"command_timeout_seconds_max",
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

// The observed failure: a generated test called toHaveAttribute, a jest-dom
// matcher, in a project that has never depended on jest-dom. Vitest reports it
// as "Invalid Chai property", which reads like a defect in the change rather
// than a missing capability — and costs a model turn, a container run and the
// whole suite to discover.
func TestProbeTestHarnessesReportsWhatTheProjectActuallyRegisters(t *testing.T) {
	root := t.TempDir()
	frontend := filepath.Join(root, "services", "frontend")
	if err := os.MkdirAll(frontend, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(dir, body string) {
		if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	// Mirrors this repository: vitest and React Testing Library, no jest-dom.
	write(frontend, `{"scripts":{"test":"vitest"},"devDependencies":{"vitest":"3","@testing-library/react":"16"}}`)
	// A package with no test script is not a harness.
	other := filepath.Join(root, "services", "tunnel")
	if err := os.MkdirAll(other, 0o755); err != nil {
		t.Fatal(err)
	}
	write(other, `{"scripts":{"build":"tsc"}}`)

	harnesses := probeTestHarnesses(root)
	if len(harnesses) != 1 {
		t.Fatalf("expected exactly the package that declares a test script, got %+v", harnesses)
	}
	harness := harnesses[0]
	if harness.Package != "services/frontend" || harness.Runner != "vitest" {
		t.Fatalf("unexpected harness: %+v", harness)
	}
	// The empty list is the whole point, and it must be present rather than nil
	// so the published JSON states it instead of omitting it.
	if harness.AssertionExtensions == nil || len(harness.AssertionExtensions) != 0 {
		t.Fatalf("a project without matcher packages must report an empty list, got %+v", harness.AssertionExtensions)
	}
	if len(harness.Libraries) != 1 || harness.Libraries[0] != "@testing-library/react" {
		t.Fatalf("declared testing libraries must be reported, got %+v", harness.Libraries)
	}

	// A project that does register jest-dom must say so, or the section would
	// forbid matchers that genuinely work there.
	write(frontend, `{"scripts":{"test":"vitest"},"devDependencies":{"vitest":"3","@testing-library/jest-dom":"6"}}`)
	harness = probeTestHarnesses(root)[0]
	if len(harness.AssertionExtensions) != 1 || harness.AssertionExtensions[0] != "@testing-library/jest-dom" {
		t.Fatalf("a registered matcher package must be reported, got %+v", harness.AssertionExtensions)
	}
}

// The rendered section must state the consequence, not just the data: a planner
// reading a bare empty list does not know it means "those matchers will throw".
func TestRenderExplainsAnEmptyMatcherInventory(t *testing.T) {
	manifest := Manifest{
		Schema:        SchemaVersion,
		TestHarnesses: []TestHarness{{Package: "services/frontend", Runner: "vitest", AssertionExtensions: []string{}}},
	}
	section := manifest.Render()
	for _, want := range []string{"assertion_extensions", "toHaveAttribute", "Invalid Chai property"} {
		if !strings.Contains(section, want) {
			t.Fatalf("the section must warn about %q, got:\n%s", want, section)
		}
	}
}

func TestManifestPublishesHostAndSandboxToolInventoriesSeparately(t *testing.T) {
	manifest := NewProber("", "docker").Manifest(context.Background(), t.TempDir())
	if manifest.SandboxTools == nil {
		t.Fatal("sandbox_tools must be present even when the runner probe degrades")
	}
	if manifest.HostTools == nil {
		t.Fatal("host_tools must be present")
	}
	for _, tool := range manifest.HostTools {
		if strings.TrimSpace(tool.Version) == "" || tool.Version == "present" {
			t.Fatalf("host tool %s was published without a successful version probe: %+v", tool.Name, tool)
		}
	}
}
