// Package workflowbudget owns the bound on engine-executed workflow steps of
// one Main Request.
//
// Partial context increments are engine reads of the captured snapshot, not
// executed steps: the planner alone decides when it has read enough, so they
// never spend this budget even though they share the request's round counter.
package workflowbudget

import "kernl.local/harness/backend/internal/domain"

// OrdinaryLimit bounds executed workflow steps of an ordinary or legacy debug
// plan; interactive protocols get a wider budget for their typed probes.
const OrdinaryLimit = 6

const interactiveLimit = OrdinaryLimit * 4

// Limit is the executed-step budget that applies to plan.
func Limit(plan *domain.ExecutionPlan) int {
	if plan != nil && plan.Debug != nil && (plan.Debug.Protocol == domain.InteractiveProtocolV1 || plan.Debug.Protocol == domain.InteractiveProtocolV2) {
		return interactiveLimit
	}
	return OrdinaryLimit
}

// StepsUsed counts the executed workflow steps of the current Main Request:
// every round it has taken except the context increments.
func StepsUsed(item domain.Session) int {
	steps := item.WorkflowRound - item.ContextIncrements
	if steps < 0 {
		return 0
	}
	return steps
}

// Exhausted reports whether item may not execute another step of plan, and
// the limit that decided it.
func Exhausted(item domain.Session, plan *domain.ExecutionPlan) (int, bool) {
	limit := Limit(plan)
	return limit, StepsUsed(item) >= limit
}
