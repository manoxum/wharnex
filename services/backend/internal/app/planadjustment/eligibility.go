package planadjustment

import "kernl.local/harness/backend/internal/domain"

// FailedProtected permits review of an unsuccessful candidate without
// conflating operator guidance with automatic infrastructure repair.
func FailedProtected(item domain.Session) bool {
	return item.State == "failed" && item.ExecutionMode == domain.ExecutionModeProtected &&
		item.Plan != nil && item.LastExecution != nil && !item.LastExecution.Success &&
		item.LastExecution.PlanID == item.Plan.PlanID &&
		item.InterruptedExecution == nil && len(item.PendingHostChanges) == 0
}

// ResetConsent makes every adjusted source proposal a fresh informed decision.
func ResetConsent(item *domain.Session) {
	item.ExecutionApprovedRootID = ""
	item.ApprovedBoundaryKeys = nil
	item.ApprovedChatPlan = nil
}
