package app

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

const approvedChatPlanProtocol = "harness.chat-plan/v1"

func approvedChatPlan(requestID, document string) *domain.ApprovedChatPlan {
	digest := sha256.Sum256([]byte(document))
	return &domain.ApprovedChatPlan{Protocol: approvedChatPlanProtocol, RequestID: strings.TrimSpace(requestID), SHA256: hex.EncodeToString(digest[:]), Document: document}
}

func validateApprovedChatPlanBinding(item domain.Session, plan *domain.ExecutionPlan) error {
	if plan == nil {
		return nil
	}
	lineage, linked := item.RequestLineages[plan.RequestID]
	if !linked || lineage.Kind != requestKindPlanApproval {
		if plan.ApprovedChatPlan != nil {
			return errors.New("approved_chat_plan is allowed only on a linked plan-approval continuation")
		}
		return nil
	}
	if item.ApprovedChatPlan == nil || plan.ApprovedChatPlan == nil {
		return errors.New("approved implementation bundle must carry the exact approved_chat_plan")
	}
	want, got := item.ApprovedChatPlan, plan.ApprovedChatPlan
	if got.Protocol != approvedChatPlanProtocol || got.RequestID != want.RequestID || got.SHA256 != want.SHA256 || got.Document != want.Document {
		return errors.New("approved_chat_plan does not match the exact proposal authorized by the operator")
	}
	return nil
}

func planCoveredByChatApproval(item domain.Session) bool {
	if item.Plan == nil || validateApprovedChatPlanBinding(item, item.Plan) != nil || item.Plan.ApprovedChatPlan == nil {
		return false
	}
	document := strings.ToLower(item.Plan.ApprovedChatPlan.Document)
	for _, dependency := range item.Plan.Dependencies {
		if !strings.Contains(document, strings.ToLower(strings.TrimSpace(dependency.Name))) {
			return false
		}
	}
	for _, tool := range item.Plan.SystemTools {
		if !strings.Contains(document, strings.ToLower(strings.TrimSpace(tool.Name))) {
			return false
		}
	}
	for _, operation := range item.Plan.Operations {
		if operation.Type == "command" && operation.Command.Network && !strings.Contains(document, "network") && !strings.Contains(document, "rede") {
			return false
		}
	}
	return true
}

func executionConsentRoot(item domain.Session, requestID string) string {
	if lineage, ok := item.RequestLineages[strings.TrimSpace(requestID)]; ok && strings.TrimSpace(lineage.RootRequestID) != "" {
		return lineage.RootRequestID
	}
	return strings.TrimSpace(requestID)
}

func executionBoundaryKeys(plan *domain.ExecutionPlan) []string {
	if plan == nil {
		return nil
	}
	keys := make([]string, 0)
	for _, dependency := range plan.Dependencies {
		keys = append(keys, "dependency:"+dependency.Action+":"+dependency.Manager+":"+dependency.Name)
	}
	for _, tool := range plan.SystemTools {
		keys = append(keys, "tool:"+tool.Target+":"+tool.Action+":"+tool.Name)
	}
	for _, operation := range plan.Operations {
		if operation.Type == "command" && operation.Command.Network {
			keys = append(keys, "network")
		}
	}
	sort.Strings(keys)
	return keys
}

func priorExecutionConsentCovers(item domain.Session) bool {
	if item.Plan == nil || item.ExecutionApprovedRootID == "" || item.ExecutionApprovedRootID != executionConsentRoot(item, item.Plan.RequestID) {
		return false
	}
	approved := make(map[string]bool, len(item.ApprovedBoundaryKeys))
	for _, key := range item.ApprovedBoundaryKeys {
		approved[key] = true
	}
	for _, key := range executionBoundaryKeys(item.Plan) {
		if !approved[key] {
			return false
		}
	}
	return true
}

// planNeedsInitialConsent is the single decision seam for the Main Request
// execution gate. Protected Auto may complete later repair/evidence rounds,
// but the first directly-authored change waits for one informed operator
// decision. A plan_approval continuation is already covered by the approval
// that created it. Missing legacy lineage fails safe and asks once.
func planNeedsInitialConsent(item domain.Session) bool {
	if item.ExecutionMode != domain.ExecutionModeProtected || item.Plan == nil {
		return false
	}
	// Plans persisted before the execution-contract extension have no document.
	// Keep those in-flight v1 plans on their historical path; every newly
	// requested bundle is instructed to include the document.
	if strings.TrimSpace(item.Plan.Document) == "" {
		return false
	}
	requestID := strings.TrimSpace(item.Plan.RequestID)
	lineage, ok := item.RequestLineages[requestID]
	return (!ok || lineage.Kind == requestKindStandard) && !priorExecutionConsentCovers(item)
}
