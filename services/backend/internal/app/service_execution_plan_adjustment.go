package app

import (
	"context"
	"errors"
	"strings"

	"kernl.local/harness/backend/internal/app/planadjustment"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
)

// SubmitExecutionPlanAdjustment starts a derived planner request for the
// currently pending executable plan, or a failed Protected candidate without
// pending host integration. No execution may be in flight;
// the derived request supersedes it and returns through the normal executable
// plan flow.
func (s *Service) SubmitExecutionPlanAdjustment(ctx context.Context, sessionID, guidance string) (planner.Result, domain.Session, error) {
	guidance = strings.TrimSpace(guidance)
	if guidance == "" {
		return planner.Result{}, domain.Session{}, errors.New("execution plan adjustment guidance is required")
	}
	current, err := s.store.Get(sessionID)
	if err != nil {
		return planner.Result{}, domain.Session{}, err
	}
	if current.Plan == nil || (current.State != "planned" && !planadjustment.FailedProtected(current)) {
		return planner.Result{}, current, errors.New("execution plan adjustment requires an unexecuted plan or a failed Protected candidate without pending integration")
	}
	if current.InterruptedExecution != nil || planExecutionAlreadyCompleted(current, current.Plan.PlanID) {
		return planner.Result{}, current, errors.New("the plan already started and cannot be adjusted as an unexecuted proposal")
	}
	parentRequestID := strings.TrimSpace(current.Plan.RequestID)
	if parentRequestID == "" {
		return planner.Result{}, current, errors.New("execution plan adjustment requires a plan request_id")
	}
	return s.submitPlannerRequest(ctx, sessionID, guidance, "adjust_plan", parentRequestID, "execution_plan_adjustment")
}

func recordExecutionPlanAdjustment(item *domain.Session, requestID, message, kind string) {
	if kind != requestKindPlanAdjustment {
		return
	}
	planadjustment.ResetConsent(item)
	recordRequestSupportArtifact(item, requestID, adjustmentRequestArtifactPath, []byte(message))
}
