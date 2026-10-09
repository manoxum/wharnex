package requeststrategy

import (
	"errors"

	"kernl.local/harness/backend/internal/app/postintegration"
	"kernl.local/harness/backend/internal/domain"
)

func ValidateResult(item domain.Session, turn *domain.AgentTurn, plan *domain.ExecutionPlan) error {
	if turn.RequestID == item.LastRequestID {
		switch item.LastRequestMode {
		case "plan_first":
			if plan != nil || turn.Kind != domain.TurnKindPlan {
				return errors.New("plan-first request must return kind=plan without plan.json; implementation requires explicit user approval")
			}
		case "correct_plan":
			if plan != nil || turn.Kind != domain.TurnKindPlan {
				return errors.New("correct_plan request must return kind=plan without plan.json; implementation requires explicit user approval")
			}
		case "adjust_plan":
			if turn.Kind == domain.TurnKindPlan {
				return errors.New("adjust_plan request must return a revised executable result, not a planning-only proposal")
			}
		}
	}
	if item.RequestLineages[turn.RequestID].Kind == postintegration.RequestKind {
		return postintegration.ValidateFirstTurn(turn.Kind)
	}
	return nil
}

// PrepareSubmission rechecks settled receipts atomically before a derived request owns the session.
func PrepareSubmission(item *domain.Session, kind, parent string) error {
	if kind != postintegration.RequestKind {
		return nil
	}
	if err := postintegration.ValidateSettled(*item); err != nil {
		return err
	}
	if item.Plan.RequestID != parent {
		return errors.New("integrated source changed before runtime observation")
	}
	item.ExecutionApprovedRootID = ""
	item.ApprovedBoundaryKeys = nil
	item.ApprovedChatPlan = nil
	return nil
}

// Manual transport has no turn yet; provider adapters must honor the same observation boundary.
func ValidateProviderResult(item domain.Session, turn *domain.AgentTurn, plan *domain.ExecutionPlan) error {
	if turn == nil || item.RequestLineages[turn.RequestID].Kind != postintegration.RequestKind {
		return nil
	}
	return ValidateResult(item, turn, plan)
}
