package app

import (
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

func TestInputBundleTypeCoversRequestLineages(t *testing.T) {
	tests := []struct {
		lineage string
		want    string
	}{
		{requestKindStandard, bundleTypeMainRequest},
		{requestKindPlanApproval, bundleTypePlanApproval},
		{requestKindPlanCorrection, bundleTypePlanCorrection},
		{requestKindPlanAdjustment, bundleTypePlanAdjustment},
		{requestKindRepair, bundleTypeCorrection},
		{requestKindRevertRestore, bundleTypeRevertRestore},
		{requestKindImprovement, bundleTypeImprovement},
		{requestKindEvidence, bundleTypeDebugPong},
		{requestKindConflict, bundleTypeConflict},
		{requestKindKnowledgeReview, bundleTypeKnowledgeReview},
		{requestKindKnowledgeConsolidation, bundleTypeKnowledgeConsolidation},
		{"future_kind", bundleTypeRequest},
	}
	for _, tt := range tests {
		t.Run(tt.lineage, func(t *testing.T) {
			if got := inputBundleType(tt.lineage); got != tt.want {
				t.Fatalf("inputBundleType(%q) = %q, want %q", tt.lineage, got, tt.want)
			}
		})
	}
}

func TestClassifyTransportBundleTypeUsesResponseTurnKind(t *testing.T) {
	requestID := "req_bundle_types"
	item := domain.Session{RequestLineages: map[string]domain.RequestLineage{
		requestID: {RequestID: requestID, RootRequestID: requestID, Kind: requestKindStandard, CreatedAt: time.Now().UTC()},
	}}
	tests := []struct {
		turnKind domain.TurnKind
		want     string
	}{
		{domain.TurnKindWorkflow, bundleTypeDebugPing},
		{domain.TurnKindPlan, bundleTypePlan},
		{domain.TurnKindClarification, bundleTypeClarification},
		{domain.TurnKindInvestigation, bundleTypeInvestigation},
		{domain.TurnKindBlocked, bundleTypeBlocked},
		{domain.TurnKindAnswer, bundleTypeResponse},
		{domain.TurnKindChange, bundleTypeResponse},
	}
	for _, tt := range tests {
		t.Run(string(tt.turnKind), func(t *testing.T) {
			raw := testArtifactZIP(t, map[string]string{"turn.json": `{"kind":"` + string(tt.turnKind) + `"}`})
			if got := classifyTransportBundleType(item, requestID, "output", "bundle", raw, true); got != tt.want {
				t.Fatalf("classifyTransportBundleType(%q) = %q, want %q", tt.turnKind, got, tt.want)
			}
		})
	}
}

func TestClassifyTransportBundleTypeUsesLineageForInputAndSummary(t *testing.T) {
	item := domain.Session{RequestLineages: map[string]domain.RequestLineage{
		"req_repair":   {RequestID: "req_repair", RootRequestID: "req_root", Kind: requestKindRepair},
		"req_evidence": {RequestID: "req_evidence", RootRequestID: "req_root", Kind: requestKindEvidence},
		"req_review":   {RequestID: "req_review", RootRequestID: "req_root", Kind: requestKindKnowledgeReview},
	}}
	raw := testArtifactZIP(t, map[string]string{"turn.json": `{"kind":"answer"}`})
	if got := classifyTransportBundleType(item, "req_repair", "input", "bundle", raw, true); got != bundleTypeCorrection {
		t.Fatalf("repair input classified as %q", got)
	}
	if got := classifyTransportBundleType(item, "req_evidence", "input", "bundle", raw, true); got != bundleTypeDebugPong {
		t.Fatalf("evidence input classified as %q", got)
	}
	if got := classifyTransportBundleType(item, "req_review", "output", "bundle", raw, true); got != bundleTypeFinalSummary {
		t.Fatalf("knowledge review output classified as %q", got)
	}
	if got := classifyTransportBundleType(item, "req_repair", "input", "attachment", raw, true); got != "" {
		t.Fatalf("non-transport artifact classified as %q", got)
	}
}
