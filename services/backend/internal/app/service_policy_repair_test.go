package app

import (
	"archive/zip"
	"bytes"
	"context"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func makePolicyBlockedBundle(t *testing.T, requestID string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	entries := map[string]string{
		"README.md": "# Denied command attempt\nThis intentionally exercises Policy repair.\n",
		"plan.json": `{"protocol":"harness.execution/v1","plan_id":"blocked-su","request_id":"` + requestID + `","status":"ready","summary":"run a denied identity command","version_increment":{"component":"patch","amount":1},"commit_message":"test(policy): exercise hard denial repair","risk":"high","requires_approval":false,"operations":[{"type":"command","patch":"","command":{"argv":["su","root"],"cwd":".","timeout_seconds":30,"network":false,"expected_exit_codes":[0]}}],"verification":[]}`,
	}
	addV2ResponseArtifacts(entries, "Resumo cumulativo da tentativa bloqueada pela Policy.")
	for name, value := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func newPolicyRepairService(bus *audit.Bus) *Service {
	return NewService(session.NewStore(), bus, contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
}

func TestAutoPolicyBlockedBundleExplainsAndPreparesRepair(t *testing.T) {
	root := t.TempDir()
	bus := audit.NewBus()
	service := newPolicyRepairService(bus)
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "teste a reparação de uma operação proibida")
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+prompted.LastRequestID+".zip", makePolicyBlockedBundle(t, prompted.LastRequestID))
	if err != nil {
		t.Fatal(err)
	}
	if !result.PolicyBlocked || result.AutoExecuted || result.AutoApplied {
		t.Fatalf("blocked policy must not execute: %#v", result)
	}
	if len(result.PolicyReasons) == 0 || !strings.Contains(strings.Join(result.PolicyReasons, " "), `executable "su" is denied`) {
		t.Fatalf("policy reason was not surfaced: %#v", result.PolicyReasons)
	}
	if !result.RepairPrepared || result.Session.State != "repair_pending" || result.Session.LastManualPrompt == "" {
		t.Fatalf("policy block did not prepare repair: %#v", result.Session)
	}
	if !strings.Contains(result.Session.LastManualPrompt, "AUTOMATIC POLICY REPAIR REQUEST") || !strings.Contains(result.Session.LastManualPrompt, "su") {
		t.Fatalf("repair prompt lost policy evidence: %q", result.Session.LastManualPrompt)
	}
	for _, event := range bus.History(started.ID) {
		if event.Type == "automation.policy_blocked" {
			return
		}
	}
	t.Fatal("expected automation.policy_blocked audit event")
}

func TestRetryPolicyRepairPreparesPromptForPreviouslyBlockedManualBundle(t *testing.T) {
	root := t.TempDir()
	service := newPolicyRepairService(audit.NewBus())
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "teste a reparação manual de uma operação proibida")
	if err != nil {
		t.Fatal(err)
	}
	blocked, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+prompted.LastRequestID+".zip", makePolicyBlockedBundle(t, prompted.LastRequestID))
	if err != nil {
		t.Fatal(err)
	}
	if blocked.Session.Policy == nil || blocked.Session.Policy.Allowed {
		t.Fatalf("expected a persisted policy block: %#v", blocked)
	}

	repaired, err := service.RetryPolicyRepair(context.Background(), started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if repaired.State != "repair_pending" || repaired.LastManualPrompt == "" || len(repaired.PendingManualRequestIDs) != 1 {
		t.Fatalf("expected a pending correction prompt: %#v", repaired)
	}
	if !strings.Contains(repaired.LastManualPrompt, "AUTOMATIC POLICY REPAIR REQUEST") || !strings.Contains(repaired.LastManualPrompt, `executable "su" is denied`) {
		t.Fatalf("repair prompt did not retain the policy reason: %q", repaired.LastManualPrompt)
	}
}
