package app

import (
	"sync"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// A task's effort level bounds its autonomous attempts exactly as it bounds an
// agentic Main Request: a failed execution with budget left becomes one more
// repair round, not the end of the run. The engine records "failed" first and
// only then prepares the repair (a planner round), so a reconciliation in that
// window read the transient state as final: a task at effort 20 failed after
// its second attempt while its Agent went on to "repair_pending".
const orchestratorRepairStartGrace = 3 * time.Minute

// orchestratorRepairWatch remembers when a task's Agent was first seen failed
// with budget left, per request, so a repair that never starts still ends.
var orchestratorRepairWatch sync.Map

// orchestratorNow is the clock of the repair window; tests replace it.
var orchestratorNow = time.Now

func orchestratorAgentMayRepair(agent domain.Session) bool {
	return agent.State == "failed" && agent.FailureKind == "" &&
		domain.AutomationModeIsAutomatic(agent.AutomationMode) && effortAttemptAvailable(agent)
}

// orchestratorRepairStillExpected reports whether a failed Agent with budget
// left is still inside the window in which its repair round starts.
func orchestratorRepairStillExpected(agent domain.Session, now time.Time) bool {
	key := agent.ID + "|" + agent.LastRequestID
	first, _ := orchestratorRepairWatch.LoadOrStore(key, now)
	return now.Sub(first.(time.Time)) < orchestratorRepairStartGrace
}

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
	case "failed":
		if orchestratorAgentMayRepair(agent) && orchestratorRepairStillExpected(agent, orchestratorNow()) {
			return ""
		}
		return "failed"
	case "blocked", "cancelled":
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
