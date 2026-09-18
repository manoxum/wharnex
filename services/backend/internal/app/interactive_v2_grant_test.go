package app

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func interactiveGrantTestPlan(access string) *domain.ExecutionPlan {
	return &domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "interactive-plan", RequestID: "req_interactive_12345678", Status: "ready", Summary: "inspect live worker", Risk: "medium", RequiresApproval: true,
		Debug:      &domain.DebugSpec{Protocol: domain.InteractiveProtocolV2, Target: "host", Access: access, Rationale: "inspect TODO worker", Capabilities: []string{domain.InteractiveCapabilityLogs}, Scope: domain.InteractiveScope{LogSources: []string{"audit"}}},
		Operations: []domain.Operation{{Type: "logs", Logs: &domain.InteractiveLogsSpec{Source: "audit", Limit: 100}}},
	}
}

func TestInteractiveModifyGrantIsExactPlanDigestAndOneShot(t *testing.T) {
	plan := interactiveGrantTestPlan(domain.DebugAccessModify)
	plan.Risk = "high"
	item := domain.Session{}
	grant, err := interactiveGrantForPlan(item, plan)
	if err != nil {
		t.Fatal(err)
	}
	item.InteractiveGrant = grant
	if !grant.OneShot || grant.PlanID != plan.PlanID || !interactiveGrantCovers(item, plan) {
		t.Fatalf("modify grant must cover only its exact plan: %#v", grant)
	}
	changed := *plan
	changed.Operations = append([]domain.Operation(nil), plan.Operations...)
	changed.Operations[0].Logs = &domain.InteractiveLogsSpec{Source: "audit", Limit: 101}
	if interactiveGrantCovers(item, &changed) {
		t.Fatal("changed operation digest must invalidate modify grant")
	}
}

func TestInteractiveObserveGrantCannotExpandCapabilityOrScope(t *testing.T) {
	plan := interactiveGrantTestPlan(domain.DebugAccessObserve)
	item := domain.Session{}
	grant, err := interactiveGrantForPlan(item, plan)
	if err != nil {
		t.Fatal(err)
	}
	item.InteractiveGrant = grant
	if !interactiveGrantCovers(item, plan) {
		t.Fatal("original observe plan should be covered")
	}

	expanded := *plan
	expanded.Debug = &domain.DebugSpec{Protocol: domain.InteractiveProtocolV2, Target: "host", Access: domain.DebugAccessObserve, Rationale: "expand", Capabilities: []string{domain.InteractiveCapabilityLogs, domain.InteractiveCapabilitySQL}, Scope: domain.InteractiveScope{LogSources: []string{"audit"}, Connections: []string{"wharnex-internal"}}}
	if interactiveGrantCovers(item, &expanded) {
		t.Fatal("observe grant must not expand capabilities or scope")
	}
}
