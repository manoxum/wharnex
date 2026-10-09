package postintegration

import (
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

const RequestKind = "post_integration_evidence"

func Validate(item domain.Session, guidance string) error {
	if strings.TrimSpace(guidance) == "" || len(guidance) > 12000 {
		return errors.New("post-integration observation requires bounded runtime-check guidance")
	}
	return ValidateSettled(item)
}

func ValidateSettled(item domain.Session) error {
	if item.ExecutionMode != domain.ExecutionModeProtected || item.State != "applied" || item.Plan == nil ||
		strings.TrimSpace(item.Plan.PlanID) == "" || strings.TrimSpace(item.Plan.RequestID) == "" ||
		item.LastExecution == nil || !item.LastExecution.Success || item.LastExecution.PlanID != item.Plan.PlanID ||
		item.LastRequestID != item.Plan.RequestID || item.InterruptedExecution != nil || item.PlannerInFlight ||
		len(item.PendingManualRequestIDs) != 0 || len(item.PendingHostChanges) != 0 {
		return errors.New("post-integration observation requires the latest settled, verified and applied Protected change")
	}
	for _, change := range item.LastAppliedChanges {
		if change.Plan.PlanID == item.Plan.PlanID && change.Plan.RequestID == item.Plan.RequestID && change.Execution.Success && change.Execution.PlanID == item.Plan.PlanID {
			return nil
		}
	}
	return errors.New("post-integration observation requires the matching applied-candidate receipt")
}

func Prompt(item domain.Session, guidance string) string {
	return fmt.Sprintf(`POST-INTEGRATION RUNTIME OBSERVATION — SAME MAIN REQUEST
Parent request: %s
Integrated plan: %s
Wharnex recorded successful source verification and host integration. Those receipts do not prove the runtime symptom is resolved.
Return a scoped kind=workflow to gather the missing runtime evidence, or kind=context_request/clarification/blocked if prerequisites are missing. This initial observation must contain no patches, no new source plan and no unsupported terminal success answer. Host rollout or modification requires its own exact informed approval. Preserve the accepted source change; use actual workflow observations in the next round to determine acceptance or a necessary correction.

Operator's runtime checks:
%s`, item.Plan.RequestID, item.Plan.PlanID, strings.TrimSpace(guidance))
}

func ValidateFirstTurn(kind domain.TurnKind) error {
	switch kind {
	case domain.TurnKindWorkflow, domain.TurnKindContextRequest, domain.TurnKindClarification, domain.TurnKindBlocked:
		return nil
	default:
		return errors.New("post-integration evidence must first gather runtime observations or identify missing prerequisites")
	}
}
