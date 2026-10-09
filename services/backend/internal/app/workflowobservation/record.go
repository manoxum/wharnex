package workflowobservation

import "kernl.local/harness/backend/internal/domain"

type Store interface {
	Update(string, func(*domain.Session) error) (domain.Session, error)
}

// Record retains the executing request separately from plan and continuation IDs.
func Record(store Store, record func(string, string, domain.ExecutionResult), sessionID, requestID string, result domain.ExecutionResult, decision domain.PolicyDecision) {
	record(sessionID, requestID, result)
	_, _ = store.Update(sessionID, func(item *domain.Session) error {
		item.Policy = &decision
		item.LastExecution = &result
		item.State = "workflow_observed"
		return nil
	})
}
