package protocol

import (
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestNormalizeManualPlanAcceptsSchemaAliasAndDefaults(t *testing.T) {
	raw := []byte(`{
      "schema":"harness.execution/v1",
      "request_id":"req_1",
      "status":"ready",
      "summary":"create file",
      "operations":[{
        "type":"apply_patch",
        "cwd":".",
        "patch":"*** Begin Patch\n*** Add File: ola.txt\n+ola mundo\n*** End Patch",
        "command":{"argv":[]}
      }],
      "verification":[{
        "type":"command",
        "cwd":".",
        "command":{"argv":["git","diff","--check"]},
        "patch":""
      }]
    }`)
	plan, err := NormalizeManualPlan(raw, "req_1")
	if err != nil {
		t.Fatal(err)
	}
	if plan.Protocol != domain.ProtocolV1 {
		t.Fatalf("protocol = %q", plan.Protocol)
	}
	if plan.PlanID != "manual-req_1" {
		t.Fatalf("plan id = %q", plan.PlanID)
	}
	if plan.Risk != "medium" {
		t.Fatalf("risk = %q", plan.Risk)
	}
	if len(plan.Verification) != 1 || strings.Join(plan.Verification[0].Argv, " ") != "git diff --check" {
		t.Fatalf("verification not normalized: %#v", plan.Verification)
	}
	if plan.Verification[0].TimeoutSeconds != 60 || len(plan.Verification[0].ExpectedExitCodes) != 1 {
		t.Fatalf("verification defaults missing: %#v", plan.Verification[0])
	}
	if !strings.Contains(plan.Operations[0].Patch, "--- /dev/null\n+++ b/ola.txt") {
		t.Fatalf("patch not converted to unified diff: %q", plan.Operations[0].Patch)
	}
	if err := Validate(plan); err != nil {
		t.Fatalf("normalized plan should validate: %v", err)
	}
}

func TestNormalizeManualPlanDoesNotInventProtocol(t *testing.T) {
	plan, err := NormalizeManualPlan([]byte(`{"request_id":"req_1","status":"ready","summary":"x","operations":[],"verification":[]}`), "req_1")
	if err != nil {
		t.Fatal(err)
	}
	if plan.Protocol != "" {
		t.Fatalf("protocol must remain empty when no recognized protocol/schema exists: %q", plan.Protocol)
	}
	if err := Validate(plan); err == nil || !strings.Contains(err.Error(), "unsupported protocol") {
		t.Fatalf("expected strict protocol rejection, got %v", err)
	}
}

func TestNormalizeManualPlanRejectsUnsafeBeginPatchDirective(t *testing.T) {
	raw := []byte(`{
      "protocol":"harness.execution/v1",
      "request_id":"req_1",
      "status":"ready",
      "risk":"medium",
      "summary":"x",
      "operations":[{"type":"apply_patch","patch":"*** Begin Patch\n*** Update File: x.txt\n@@\n-a\n+b\n*** End Patch","command":{"argv":[]}}],
      "verification":[]
    }`)
	if _, err := NormalizeManualPlan(raw, "req_1"); err == nil || !strings.Contains(err.Error(), "unsupported patch directive") {
		t.Fatalf("expected unsupported directive error, got %v", err)
	}
}

func TestNormalizeManualPlanRepairsUnescapedQuotesInsideUnifiedPatch(t *testing.T) {
	raw := []byte(`{
      "protocol":"harness.execution/v1",
      "plan_id":"plan_1",
      "request_id":"req_1",
      "status":"ready",
      "summary":"remove decoration",
      "risk":"low",
      "requires_approval":false,
      "operations":[{
        "type":"apply_patch",
        "patch":"diff --git a/style.css b/style.css\nnew file mode 100644\n--- /dev/null\n+++ b/style.css\n@@ -0,0 +1 @@\n+.x { content: ""; }\n",
        "command":{"argv":[],"cwd":".","timeout_seconds":60,"network":false,"expected_exit_codes":[0]}
      }],
      "verification":[{"argv":["git","diff","--check"],"cwd":".","timeout_seconds":60,"network":false,"expected_exit_codes":[0]}]
    }`)
	plan, err := NormalizeManualPlan(raw, "req_1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan.Operations[0].Patch, `content: "";`) {
		t.Fatalf("source quotes were not preserved: %q", plan.Operations[0].Patch)
	}
	if err := Validate(plan); err != nil {
		t.Fatalf("repaired plan should validate: %v", err)
	}
}

func TestNormalizeManualPlanStripsMarkdownJSONFence(t *testing.T) {
	raw := []byte("```json\n{\"protocol\":\"harness.execution/v1\",\"plan_id\":\"p\",\"request_id\":\"req_1\",\"status\":\"ready\",\"summary\":\"x\",\"risk\":\"low\",\"requires_approval\":false,\"operations\":[],\"verification\":[]}\n```")
	plan, err := NormalizeManualPlan(raw, "req_1")
	if err != nil {
		t.Fatal(err)
	}
	if plan.Protocol != domain.ProtocolV1 {
		t.Fatalf("protocol = %q", plan.Protocol)
	}
}

func TestNormalizeManualPlanDoesNotRepairMalformedNonPatchJSON(t *testing.T) {
	raw := []byte(`{"protocol":"harness.execution/v1","summary":"bad " quote"}`)
	_, err := NormalizeManualPlan(raw, "req_1")
	if err == nil || !strings.Contains(err.Error(), "invalid JSON execution plan") {
		t.Fatalf("expected actionable JSON error, got %v", err)
	}
}

func TestNormalizeManualPlanRepairsUnescapedQuotesInsideSummaryAndPatch(t *testing.T) {
	raw := []byte(`{
      "protocol":"harness.execution/v1",
      "plan_id":"plan_1",
      "request_id":"req_1",
      "status":"ready",
      "summary":"Replace textual buttons "Baixar novamente" and "Criar molde" with icon actions.",
      "risk":"low",
      "requires_approval":false,
      "operations":[{
        "type":"apply_patch",
        "patch":"diff --git a/x.tsx b/x.tsx\n--- a/x.tsx\n+++ b/x.tsx\n@@ -1 +1 @@\n-const label = "Baixar novamente";\n+const label = "Download";\n",
        "command":{"argv":[],"cwd":".","timeout_seconds":60,"network":false,"expected_exit_codes":[0]}
      }],
      "verification":[{"argv":["git","diff","--check"],"cwd":".","timeout_seconds":60,"network":false,"expected_exit_codes":[0]}]
    }`)
	plan, err := NormalizeManualPlan(raw, "req_1")
	if err != nil {
		t.Fatal(err)
	}
	if plan.Summary != `Replace textual buttons "Baixar novamente" and "Criar molde" with icon actions.` {
		t.Fatalf("summary quotes were not preserved: %q", plan.Summary)
	}
	if !strings.Contains(plan.Operations[0].Patch, `const label = "Baixar novamente";`) {
		t.Fatalf("patch quotes were not preserved: %q", plan.Operations[0].Patch)
	}
	if err := Validate(plan); err != nil {
		t.Fatalf("repaired plan should validate: %v", err)
	}
}

func TestNormalizeManualPlanDoesNotRepairStructuralQuoteInjectionOutsideKnownStringFields(t *testing.T) {
	raw := []byte(`{"protocol":"harness.execution/v1","plan_id":"p" "request_id":"req_1","status":"ready","summary":"x","risk":"low","requires_approval":false,"operations":[],"verification":[]}`)
	_, err := NormalizeManualPlan(raw, "req_1")
	if err == nil || !strings.Contains(err.Error(), "invalid JSON execution plan") {
		t.Fatalf("expected malformed structure to remain rejected, got %v", err)
	}
}

func TestNormalizeManualPlanRepairsUnescapedQuotesInsidePlainUnifiedPatch(t *testing.T) {
	raw := []byte(`{
      "protocol":"harness.execution/v1",
      "plan_id":"plan_plain",
      "request_id":"req_plain_12345678",
      "status":"ready",
      "summary":"icon buttons",
      "risk":"low",
      "requires_approval":false,
      "operations":[{
        "type":"apply_patch",
        "patch":"--- a/src/view.tsx\n+++ b/src/view.tsx\n@@ -1 +1 @@\n-<button title=\"Old\">Old</button>\n+<button title=\"New\" aria-label=\"New\">New</button>\n",
        "command":{"argv":[],"cwd":".","timeout_seconds":60,"network":false,"expected_exit_codes":[0]}
      }],
      "verification":[{"argv":["git","diff","--check"],"cwd":".","timeout_seconds":60,"network":false,"expected_exit_codes":[0]}]
    }`)
	// Simulate ChatGPT/clipboard transport stripping JSON escaping from source quotes.
	raw = []byte(strings.ReplaceAll(string(raw), `\"`, `"`))
	plan, err := NormalizeManualPlan(raw, "req_plain_12345678")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan.Operations[0].Patch, `title="New" aria-label="New"`) {
		t.Fatalf("plain unified patch quotes were not preserved: %q", plan.Operations[0].Patch)
	}
	if err := Validate(plan); err != nil {
		t.Fatalf("repaired plain unified plan should validate: %v", err)
	}
}

func TestNormalizeManualPlanPreservesVersionIncrement(t *testing.T) {
	plan, err := NormalizeManualPlan([]byte(`{"protocol":"harness.execution/v1","request_id":"req_1","status":"ready","summary":"change","version_increment":{"component":"minor","amount":2},"operations":[],"verification":[]}`), "req_1")
	if err != nil {
		t.Fatal(err)
	}
	if plan.VersionIncrement == nil || plan.VersionIncrement.Component != domain.VersionComponentMinor || plan.VersionIncrement.Amount != 2 {
		t.Fatalf("version increment was not normalized: %#v", plan.VersionIncrement)
	}
}
