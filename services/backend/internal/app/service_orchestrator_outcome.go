package app

import "kernl.local/harness/backend/internal/domain"

// An Agent may be verified before Protected host integration has finished.
// Dependents can run only after that integration has succeeded.
//
// A task is one Main Request with nobody reading its chat. A Main Request that
// ends in a report (an answer or an investigation, with no change) has
// finished, so the report goes to review. One that stops to ask a person
// (clarification, plan approval) cannot go on by itself, so the run fails with
// that question and can be retried with context. Without these outcomes the
// task stayed DOING indefinitely: a barrier task that concluded "no change
// needed" held its six dependents for five hours.
func orchestratorAgentOutcome(agent domain.Session) string {
	switch agent.State {
	case "applied", "restart_pending":
		return "review"
	case "failed", "blocked", "cancelled":
		return "failed"
	}
	if containsString(agent.PendingManualRequestIDs, agent.LastRequestID) {
		return ""
	}
	switch agent.State {
	case "answered", "investigated":
		return "review"
	case "awaiting_clarification", "awaiting_plan_approval":
		return "failed"
	}
	return ""
}

// orchestratorAgentOutcomeError is the run error for a failed outcome.
func orchestratorAgentOutcomeError(agent domain.Session) string {
	if agent.LastRepairError != "" {
		return agent.LastRepairError
	}
	if agent.LastTurn != nil && (agent.State == "awaiting_clarification" || agent.State == "awaiting_plan_approval") {
		return "Agent stopped to ask a person (" + agent.State + "): " + truncateRepairText(agent.LastTurn.Message, 2000)
	}
	return ""
}
