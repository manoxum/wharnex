package app

import (
	"encoding/json"
	"log"

	"kernl.local/harness/backend/internal/domain"
)

// Durable plan/execution ledger.
//
// The session snapshot keeps one current plan and one last execution, and
// several lifecycle transitions clear both outright, so every intermediate plan
// and every intermediate execution — repair rounds, workflow rounds, failed
// verifications — was gone the moment the next one started. Restarting Wharnex
// simply made that visible: the Plans and Executions views are built from the
// snapshot, so they showed whatever the session happened to be holding.
//
// The audit stream is the durable record that already survives restart and is
// already packed into a chat archive, but its plan/execution events carried only
// metadata — `execution.completed` was `{execution_mode, success, target}` — so
// the history could never be rebuilt from it. These two events carry the bodies,
// which makes the ledger durable and exportable without a second store.
const (
	EventPlanRecorded      = "plan.recorded"
	EventExecutionRecorded = "execution.recorded"
)

// structuredEventData renders a domain value as the generic map the audit bus
// knows how to sanitize.
//
// The round trip is the point, not an inconvenience: the bus redacts
// credential-shaped keys and bounds long strings only as it walks maps and
// slices, so handing it a struct directly would store the body verbatim.
func structuredEventData(value any) (map[string]any, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		return nil, err
	}
	return decoded, nil
}

// recordPlanActivity appends one AI-authored plan to the durable ledger.
func (s *Service) recordPlanActivity(sessionID string, plan *domain.ExecutionPlan) {
	if s.bus == nil || plan == nil {
		return
	}
	data, err := structuredEventData(plan)
	if err != nil {
		log.Printf("record plan activity for session %s: %v", sessionID, err)
		return
	}
	s.bus.Publish(sessionID, EventPlanRecorded, map[string]any{
		"plan_id": plan.PlanID, "request_id": plan.RequestID, "plan": data,
	})
}

// recordExecutionActivity appends one execution result to the durable ledger.
//
// Recorded for failures too, and deliberately so: a failed verification is the
// evidence that explains why the next round exists, which is exactly what the
// snapshot threw away when it set LastExecution back to nil.
func (s *Service) recordExecutionActivity(sessionID, requestID string, result domain.ExecutionResult) {
	if s.bus == nil {
		return
	}
	data, err := structuredEventData(result)
	if err != nil {
		log.Printf("record execution activity for session %s: %v", sessionID, err)
		return
	}
	s.bus.Publish(sessionID, EventExecutionRecorded, map[string]any{
		"plan_id": result.PlanID, "request_id": requestID, "success": result.Success, "execution": data,
	})
}
