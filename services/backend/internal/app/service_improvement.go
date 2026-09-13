package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/protocol"
)

// prepareImprovementRequest spends one effort-budget attempt after a
// successful host integration. It is enabled only for Extra High and above.
// The planner is explicitly allowed to stop with a terminal answer when the
// current result is already the best cost/benefit tradeoff; effort is a
// ceiling, never a quota that must be consumed.
func (s *Service) prepareImprovementRequest(ctx context.Context, sessionID string, current domain.Session, appliedPlanID string) (domain.Session, error) {
	if !shouldContinueImprovement(current) {
		return current, nil
	}
	refreshed, err := s.refreshContext(sessionID)
	if err != nil {
		return current, fmt.Errorf("refresh context for continuous improvement: %w", err)
	}
	if !shouldContinueImprovement(refreshed) {
		return refreshed, nil
	}

	requestID := ids.New("req")
	s.prepareContinuation(ctx, refreshed, requestID, refreshed.LastRequestID)
	nextAttempt := automaticAttemptsSpent(refreshed) + 1
	nextRound := refreshed.ImprovementAttempt + 1
	message := buildImprovementMessage(refreshed, appliedPlanID, nextAttempt, nextRound)
	knowledgeSnapshot, err := s.loadRequestKnowledge(sessionID, refreshed.ProjectPath)
	if err != nil {
		return refreshed, err
	}
	s.bus.Publish(sessionID, "improvement.started", map[string]any{
		"request_id": requestID, "attempt": nextAttempt, "round": nextRound,
		"effort_level": normalizeEffortLevel(refreshed.EffortLevel), "applied_plan_id": appliedPlanID,
	})

	planned, err := s.planner.Plan(ctx, s.plannerRequest(ctx, planner.Request{
		SessionID:              sessionID,
		RequestID:              requestID,
		ParentRequestID:        refreshed.LastRequestID,
		Message:                message,
		ContextTextPath:        refreshed.Context.TextPath,
		ContextManifest:        refreshed.Context.Manifest,
		PreviousResponseID:     refreshed.LastProviderResponseID,
		AutomationMode:         refreshed.AutomationMode,
		SelfEvolution:          s.isSelfEvolution(refreshed),
		ExpectedBundleFilename: expectedResponseBundleFilenameForDerivedRequest(refreshed, requestID, refreshed.LastRequestID),
	}, knowledgeSnapshot, refreshed.ProjectPath))
	if err != nil {
		return refreshed, fmt.Errorf("prepare continuous-improvement planner request: %w", err)
	}
	enrichPlanConcurrency(planned.Plan, refreshed.Context.Manifest.SHA256)
	if err := normalizePlannerResult(requestID, &planned); err != nil {
		return refreshed, err
	}
	if planned.Turn != nil && planned.Turn.Kind == domain.TurnKindWorkflow {
		return refreshed, errors.New("workflow turns are not allowed inside continuous improvement; return a focused change or terminal answer")
	}

	var prunedContexts []string
	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		recordRequestLineage(item, requestID, refreshed.LastRequestID, requestKindImprovement)
		recordRequestKnowledge(item, requestID, knowledgeSnapshot)
		item.LastRequestID = requestID
		recordRequestBaseline(item, requestID, refreshed.Context.Manifest.SHA256)
		prunedContexts = append(prunedContexts, recordRequestContext(item, requestID, refreshed.Context)...)
		item.LastManualPrompt = planned.ManualPrompt
		item.LastRepairError = ""
		item.AutomationAttempt = nextAttempt
		item.ImprovementAttempt = nextRound
		item.LastTurn = planned.Turn
		if planned.ProviderResponseID != "" {
			item.LastProviderResponseID = planned.ProviderResponseID
		}
		if planned.Plan == nil && planned.ManualPrompt != "" {
			item.PendingManualRequestIDs = []string{requestID}
			item.State = "repair_pending"
			return nil
		}
		if planned.Plan == nil && planned.Turn != nil {
			item.PendingManualRequestIDs = nil
			item.Plan = nil
			item.Policy = nil
			item.State = turnState(planned.Turn.Kind)
			return nil
		}
		if planned.Plan == nil {
			return errors.New("continuous-improvement planner returned neither a plan, turn, nor manual prompt")
		}
		if planned.Plan.RequestID != requestID {
			return fmt.Errorf("continuous-improvement request_id mismatch: expected %s", requestID)
		}
		if err := protocol.ValidateChangePlan(*planned.Plan); err != nil {
			return err
		}
		decision := s.policy.Evaluate(*planned.Plan)
		item.Plan = planned.Plan
		item.Policy = &decision
		item.State = "planned"
		item.LastExecution = nil
		return nil
	})
	if err != nil {
		return refreshed, err
	}
	s.cleanupPrunedRequestContexts(prunedContexts)
	if planned.Plan == nil {
		s.bus.Publish(sessionID, "improvement.prompt_ready", map[string]any{"request_id": requestID, "attempt": nextAttempt, "round": nextRound})
	} else {
		s.bus.Publish(sessionID, "improvement.plan_ready", map[string]any{"request_id": requestID, "attempt": nextAttempt, "round": nextRound, "plan_id": planned.Plan.PlanID})
	}
	return updated, nil
}

func buildImprovementMessage(item domain.Session, appliedPlanID string, attempt, round int) string {
	goal := strings.TrimSpace(item.LastMainRequestSummary)
	if goal == "" {
		goal = "the original user request for this request chain"
	}
	return fmt.Sprintf(`CONTINUOUS IMPROVEMENT REQUEST — %s · effort %s · improvement round %d

The previous change was implemented, verified, and integrated successfully on the host.
Now inspect the CURRENT project context and decide whether there is another MATERIAL, SAFE, scope-aligned improvement worth making for the same original goal.

ORIGINAL GOAL:
%s

LAST APPLIED PLAN: %s

Cost/benefit rule: the effort budget is a ceiling, not a quota. Do not create cosmetic churn, speculative rewrites, unrelated refactors, or changes whose expected benefit is weaker than their risk/cost. If no meaningful automated improvement remains, or no safe automated solution exists, STOP by returning a terminal kind=answer with no plan. If a worthwhile improvement remains, return one focused kind=change bundle through the normal Wharnex contract.`, effortAttemptLabel(item, attempt), normalizeEffortLevel(item.EffortLevel), round, truncateRepairText(goal, 6000), appliedPlanID)
}
