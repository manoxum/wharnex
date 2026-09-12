package app

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

func orchestratorBundle(t *testing.T, entries map[string]string) []byte {
	t.Helper()
	buffer := &bytes.Buffer{}
	writer := zip.NewWriter(buffer)
	for name, content := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

const validOrchestratorPlanJSON = `{"protocol":"harness.orchestrator-plan/v1","objective":"ship it","tasks":[]}`

func TestDecodeOrchestratorPlanBundleAcceptsTheStandardResponseBundle(t *testing.T) {
	raw := orchestratorBundle(t, map[string]string{
		"plan.json": validOrchestratorPlanJSON,
		"README.md": "human-readable summary",
	})
	proposal, err := DecodeOrchestratorPlanBundle(raw)
	if err != nil {
		t.Fatal(err)
	}
	if proposal.Protocol != "harness.orchestrator-plan/v1" || proposal.Objective != "ship it" {
		t.Fatalf("unexpected proposal: %#v", proposal)
	}
}

func TestDecodeOrchestratorPlanBundleRejectsUnusableArchives(t *testing.T) {
	cases := []struct {
		name string
		raw  []byte
		want string
	}{
		{"empty", nil, "is empty"},
		{"not a zip", []byte("this is not a zip at all"), "not a readable ZIP"},
		{"no plan", orchestratorBundle(t, map[string]string{"README.md": "x"}), "does not contain plan.json"},
		{
			"traversal",
			orchestratorBundle(t, map[string]string{"../escape.json": "{}", "plan.json": validOrchestratorPlanJSON}),
			"escapes the archive",
		},
		{
			"wrong protocol",
			orchestratorBundle(t, map[string]string{"plan.json": `{"protocol":"harness.execution/v1","tasks":[]}`}),
			"protocol",
		},
		{
			"invalid json",
			orchestratorBundle(t, map[string]string{"plan.json": "{not json"}),
			"decode plan.json",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := DecodeOrchestratorPlanBundle(tc.raw); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want it to contain %q", err, tc.want)
			}
		})
	}
}

// An execution bundle carries operations and patches; a planning bundle must
// never be read as one, so unknown fields are refused rather than ignored.
func TestDecodeOrchestratorPlanBundleRefusesUnknownPlanFields(t *testing.T) {
	raw := orchestratorBundle(t, map[string]string{
		"plan.json": `{"protocol":"harness.orchestrator-plan/v1","tasks":[],"operations":[{"type":"apply_patch"}]}`,
	})
	if _, err := DecodeOrchestratorPlanBundle(raw); err == nil {
		t.Fatal("an execution-shaped field must not be accepted into a planning bundle")
	}
}

func TestSafeOrchestratorBundleEntryNormalizesAndRejects(t *testing.T) {
	if got, err := safeOrchestratorBundleEntry(`plan.json`); err != nil || got != "plan.json" {
		t.Fatalf("plan.json = %q err=%v", got, err)
	}
	// A Windows-authored archive can carry backslash separators.
	if got, err := safeOrchestratorBundleEntry(`nested\plan.json`); err != nil || got != "nested/plan.json" {
		t.Fatalf("nested entry = %q err=%v", got, err)
	}
	for _, bad := range []string{"", "/etc/passwd", "../outside", `..\outside`} {
		if _, err := safeOrchestratorBundleEntry(bad); err == nil {
			t.Fatalf("entry %q must be rejected", bad)
		}
	}
}
