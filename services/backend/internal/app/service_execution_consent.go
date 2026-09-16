package app

import (
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

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
	return !ok || lineage.Kind == requestKindStandard
}
