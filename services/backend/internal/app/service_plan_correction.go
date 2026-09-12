package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
)

// SubmitPlanCorrection creates a planning-only child request rooted in the
// current Main Request. The pending proposal is superseded as soon as the
// child request is created, so it cannot be approved or corrected twice.
func (s *Service) SubmitPlanCorrection(ctx context.Context, sessionID, parentRequestID, guidance string) (planner.Result, domain.Session, error) {
	parentRequestID = strings.TrimSpace(parentRequestID)
	guidance = strings.TrimSpace(guidance)
	if parentRequestID == "" {
		return planner.Result{}, domain.Session{}, errors.New("plan request_id is required")
	}
	if guidance == "" {
		return planner.Result{}, domain.Session{}, errors.New("plan correction guidance is required")
	}
	current, err := s.store.Get(sessionID)
	if err != nil {
		return planner.Result{}, domain.Session{}, err
	}
	if current.LastRequestID != parentRequestID || current.State != "awaiting_plan_approval" || current.LastTurn == nil || current.LastTurn.RequestID != parentRequestID || current.LastTurn.Kind != domain.TurnKindPlan || current.LastTurn.Outcome == nil || current.LastTurn.Outcome.Status != domain.TurnOutcomeCompleted {
		return planner.Result{}, current, errors.New("plan correction requires the latest pending completed plan proposal")
	}
	message := fmt.Sprintf("PLAN CORRECTION CONTINUATION\nParent request: %s\nThe user requested a correction to the current plan proposal. Produce a revised plan only; do not implement anything yet.\n\nUser correction guidance:\n%s\n\nCurrent plan proposal:\n%s", parentRequestID, guidance, current.LastTurn.Message)
	return s.submitPlannerRequest(ctx, sessionID, message, "correct_plan", parentRequestID, requestKindPlanCorrection)
}
