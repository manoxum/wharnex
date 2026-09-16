package app

import (
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func TestPlanNeedsInitialConsentOnlyForProtectedRootChange(t *testing.T) {
	base := domain.Session{
		ExecutionMode: domain.ExecutionModeProtected,
		Plan:          &domain.ExecutionPlan{RequestID: "req-root", Document: "# Complete execution plan"},
		RequestLineages: map[string]domain.RequestLineage{
			"req-root": {RequestID: "req-root", RootRequestID: "req-root", Kind: requestKindStandard},
		},
	}
	if !planNeedsInitialConsent(base) {
		t.Fatal("protected root change must wait for informed consent")
	}

	repair := base
	repair.Plan = &domain.ExecutionPlan{RequestID: "req-repair", Document: "# Repair"}
	repair.RequestLineages["req-repair"] = domain.RequestLineage{RequestID: "req-repair", RootRequestID: "req-root", Kind: requestKindRepair}
	if planNeedsInitialConsent(repair) {
		t.Fatal("derived repair must inherit the root approval")
	}

	direct := base
	direct.ExecutionMode = domain.ExecutionModeUnprotected
	if planNeedsInitialConsent(direct) {
		t.Fatal("unprotected consent remains enforced by the per-execution gate")
	}
}

func TestPlanNeedsInitialConsentKeepsLegacyPlanCompatible(t *testing.T) {
	item := domain.Session{ExecutionMode: domain.ExecutionModeProtected, Plan: &domain.ExecutionPlan{RequestID: "legacy"}}
	if planNeedsInitialConsent(item) {
		t.Fatal("persisted pre-contract plan must retain its historical behavior")
	}
}

func TestDebugAuthorizationIsInheritedOnlyInsideOneMainRequestCycle(t *testing.T) {
	item := domain.Session{
		Plan:                &domain.ExecutionPlan{RequestID: "req-debug-2", Debug: &domain.DebugSpec{Protocol: domain.DebugProtocolV1, Target: "host", Rationale: "inspect live state"}},
		DebugApprovedRootID: "req-root",
		RequestLineages: map[string]domain.RequestLineage{
			"req-debug-2": {RequestID: "req-debug-2", RootRequestID: "req-root", ParentRequestID: "req-debug-1", Kind: requestKindEvidence},
		},
	}
	if !debugAuthorized(item) {
		t.Fatal("a later debug wave in the approved Main Request must inherit consent")
	}

	item.Plan.RequestID = "req-other-root"
	item.RequestLineages["req-other-root"] = domain.RequestLineage{RequestID: "req-other-root", RootRequestID: "req-other-root", Kind: requestKindStandard}
	if debugAuthorized(item) {
		t.Fatal("a new Main Request must not inherit the previous debug consent")
	}

	item.DebugEnabled = true
	if !debugAuthorized(item) {
		t.Fatal("enabled Debug mode should authorize a valid debug plan")
	}
}
