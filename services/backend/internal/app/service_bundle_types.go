package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

const (
	bundleTypeMainRequest            = "main_request"
	bundleTypeResponse               = "response"
	bundleTypeCorrection             = "correction"
	bundleTypeDebugPing              = "debug_ping"
	bundleTypeDebugPong              = "debug_pong"
	bundleTypePlan                   = "plan"
	bundleTypePlanApproval           = "plan_approval"
	bundleTypePlanCorrection         = "plan_correction"
	bundleTypePlanAdjustment         = "adjustment"
	bundleTypeRevertRestore          = "revert_restore"
	bundleTypePlanReversal           = "plan_reversal"
	bundleTypeImprovement            = "improvement"
	bundleTypeConflict               = "conflict"
	bundleTypeKnowledgeReview        = "knowledge_review"
	bundleTypeKnowledgeConsolidation = "knowledge_consolidation"
	bundleTypeFinalSummary           = "final_summary"
	bundleTypeClarification          = "clarification"
	bundleTypeInvestigation          = "investigation"
	bundleTypeBlocked                = "blocked"
	bundleTypeRequest                = "request"
)

func classifyTransportBundleType(item domain.Session, requestID, direction, kind string, raw []byte, bundle bool) string {
	if !bundle || kind != "bundle" {
		return ""
	}
	lineageKind := requestKindStandard
	if lineage, ok := item.RequestLineages[strings.TrimSpace(requestID)]; ok && lineage.Kind != "" {
		lineageKind = lineage.Kind
	}
	if direction == "input" {
		return inputBundleType(lineageKind)
	}
	if lineageKind == requestKindKnowledgeReview {
		return bundleTypeFinalSummary
	}
	switch responseBundleTurnKind(raw) {
	case domain.TurnKindWorkflow:
		return bundleTypeDebugPing
	case domain.TurnKindPlan:
		return bundleTypePlan
	case domain.TurnKindClarification:
		return bundleTypeClarification
	case domain.TurnKindInvestigation:
		return bundleTypeInvestigation
	case domain.TurnKindBlocked:
		return bundleTypeBlocked
	default:
		return bundleTypeResponse
	}
}

func inputBundleType(lineageKind string) string {
	switch lineageKind {
	case requestKindStandard:
		return bundleTypeMainRequest
	case requestKindPlanApproval:
		return bundleTypePlanApproval
	case requestKindPlanCorrection:
		return bundleTypePlanCorrection
	case requestKindPlanAdjustment:
		return bundleTypePlanAdjustment
	case requestKindRepair:
		return bundleTypeCorrection
	case requestKindRevertRestore:
		return bundleTypeRevertRestore
	case requestKindPlanReversal:
		return bundleTypePlanReversal
	case requestKindImprovement:
		return bundleTypeImprovement
	case requestKindEvidence:
		return bundleTypeDebugPong
	case requestKindConflict:
		return bundleTypeConflict
	case requestKindKnowledgeReview:
		return bundleTypeKnowledgeReview
	case requestKindKnowledgeConsolidation:
		return bundleTypeKnowledgeConsolidation
	default:
		return bundleTypeRequest
	}
}

func responseBundleTurnKind(raw []byte) domain.TurnKind {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return ""
	}
	for _, file := range reader.File {
		if file.Name != "turn.json" || file.FileInfo().IsDir() || file.UncompressedSize64 > 64<<10 {
			continue
		}
		handle, err := file.Open()
		if err != nil {
			return ""
		}
		var turn struct {
			Kind domain.TurnKind `json:"kind"`
		}
		err = json.NewDecoder(io.LimitReader(handle, (64<<10)+1)).Decode(&turn)
		_ = handle.Close()
		if err != nil {
			return ""
		}
		return turn.Kind
	}
	return ""
}
