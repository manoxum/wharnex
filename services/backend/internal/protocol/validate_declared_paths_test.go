package protocol

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func planWith(impact []string, read []string) domain.ExecutionPlan {
	return domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "plan_1", RequestID: "req_1",
		Status: "ready", Risk: "low", ImpactFiles: impact, ReadFiles: read,
	}
}

// Wharnex materializes project knowledge itself at the commit boundary, so a
// plan forecasting that it changes is accurate. Rejecting that forecast
// discarded whole verified bundles.
func TestDeclaredPathsAllowWharnexManagedKnowledge(t *testing.T) {
	for _, path := range []string{".wharnex/knowledge/brand-identity-system.md", ".wharnex/knowledge/catalog.json"} {
		if err := Validate(planWith([]string{path}, nil)); err != nil {
			t.Fatalf("expected impact_files %q to be accepted, got %v", path, err)
		}
		if err := Validate(planWith(nil, []string{path})); err != nil {
			t.Fatalf("expected read_files %q to be accepted, got %v", path, err)
		}
	}
}

// The carve-out is for declarations only. Writing that subtree stays refused,
// because Wharnex owns it.
func TestPatchingWharnexManagedKnowledgeStaysDenied(t *testing.T) {
	patch := "--- a/.wharnex/knowledge/catalog.json\n+++ b/.wharnex/knowledge/catalog.json\n"
	err := ValidatePatchPaths(patch)
	if err == nil || !strings.Contains(err.Error(), "sensitive patch path denied") {
		t.Fatalf("expected a patch against managed knowledge to be denied, got %v", err)
	}
}

// Declaring a secret-like path is itself the signal to refuse, so the carve-out
// must not have widened into one.
func TestDeclaredPathsStillDenySecretLikePaths(t *testing.T) {
	for _, path := range []string{".env", ".ssh/id_rsa", "config/secrets/token.json", ".git-credentials"} {
		if err := Validate(planWith([]string{path}, nil)); err == nil {
			t.Fatalf("expected impact_files %q to be denied", path)
		}
		if err := Validate(planWith(nil, []string{path})); err == nil {
			t.Fatalf("expected read_files %q to be denied", path)
		}
	}
}

// Structural rules apply to every declared path regardless of the carve-out.
func TestDeclaredPathsRejectTraversalAndAbsolutePaths(t *testing.T) {
	for _, path := range []string{"../outside.txt", "/etc/passwd", ""} {
		if err := Validate(planWith([]string{path}, nil)); err == nil {
			t.Fatalf("expected impact_files %q to be rejected", path)
		}
	}
}
