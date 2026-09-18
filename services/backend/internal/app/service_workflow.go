package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/protocol"
)

const maxWorkflowRounds = 6
const maxInteractiveWorkflowRounds = maxWorkflowRounds * 4

func workflowRoundLimit(plan *domain.ExecutionPlan) int {
	if plan != nil && plan.Debug != nil && (plan.Debug.Protocol == domain.InteractiveProtocolV1 || plan.Debug.Protocol == domain.InteractiveProtocolV2) {
		return maxInteractiveWorkflowRounds
	}
	return maxWorkflowRounds
}

func (s *Service) runWorkflowLoop(ctx context.Context, sessionID, transport string) (BundleSubmission, error) {
	result := BundleSubmission{}
	for {
		current, err := s.store.Get(sessionID)
		if err != nil {
			return result, err
		}
		result.Session = current
		if current.LastTurn == nil || current.LastTurn.Kind != domain.TurnKindWorkflow || current.Plan == nil {
			return result, errors.New("no workflow step is ready")
		}
		isDebug := current.Plan.Debug != nil
		if !isDebug && current.AutomationMode != domain.AutomationModeAuto {
			result.AutoError = "iterative workflow requires project Auto mode"
			return result, nil
		}
		if isDebug && !debugAuthorized(current) {
			result.AutoError = "debug flow requires one approval for this Main Request"
			return result, nil
		}
		if !isDebug && current.ExecutionMode != domain.ExecutionModeProtected {
			result.AutoError = "iterative workflow requires Protected execution mode"
			return result, nil
		}
		limit := workflowRoundLimit(current.Plan)
		if current.WorkflowRound >= limit {
			result.AutoError = fmt.Sprintf("workflow round limit reached (%d)", limit)
			return result, nil
		}
		if err := protocol.ValidateWorkflowPlan(*current.Plan); err != nil {
			return result, err
		}
		decision := s.policy.Evaluate(*current.Plan)
		if !decision.Allowed {
			execution := domain.ExecutionResult{
				PlanID: current.Plan.PlanID, Success: false,
				StartedAt: time.Now().UTC(), CompletedAt: time.Now().UTC(),
				Error:    "workflow policy denied plan: " + strings.Join(decision.Reasons, "; "),
				Commands: []domain.CommandResult{},
			}
			s.bus.Publish(sessionID, "workflow.policy_blocked", map[string]any{"plan_id": current.Plan.PlanID, "reasons": decision.Reasons, "transport": transport})
			if _, err := s.store.Update(sessionID, func(item *domain.Session) error {
				item.Policy = &decision
				item.LastExecution = &execution
				item.State = "workflow_observed"
				return nil
			}); err != nil {
				return result, err
			}
			result.WorkflowExecuted = false
			result.Execution = &execution
			if err := s.prepareWorkflowContinuation(ctx, sessionID, execution, current.WorkflowRound+1, workflowRoundLimit(current.Plan)); err != nil {
				return result, err
			}
		} else {
			execution, err := s.executeWorkflowPlan(ctx, sessionID, *current.Plan, decision, transport)
			result.WorkflowExecuted = true
			result.Execution = &execution
			if err != nil {
				// Command failure is observation, not an automatic repair trigger.
				s.bus.Publish(sessionID, "workflow.step_failed", map[string]any{"plan_id": current.Plan.PlanID, "error": err.Error(), "transport": transport})
			}
			if err := s.prepareWorkflowContinuation(ctx, sessionID, execution, current.WorkflowRound+1, workflowRoundLimit(current.Plan)); err != nil {
				return result, err
			}
		}

		updated, err := s.store.Get(sessionID)
		if err != nil {
			return result, err
		}
		result.Session = updated
		result.WorkflowRound = updated.WorkflowRound
		if updated.State == "workflow_pending" {
			result.WorkflowPrepared = true
			return result, nil
		}
		if updated.LastTurn != nil && updated.LastTurn.Kind == domain.TurnKindWorkflow && updated.Plan != nil {
			transport = "provider_workflow"
			continue
		}
		if updated.LastTurn != nil && updated.LastTurn.Kind == domain.TurnKindChange && updated.Plan != nil && updated.AutomationMode == domain.AutomationModeAuto && updated.Policy != nil && updated.Plan.Status == "ready" {
			if !updated.Policy.Allowed {
				repaired, repairErr := s.preparePolicyRepairRequest(ctx, sessionID, updated.Plan.PlanID, updated.Policy.Reasons, "provider_workflow")
				if repairErr != nil {
					return result, repairErr
				}
				result.Session = repaired
				result.PolicyBlocked = true
				result.PolicyReasons = append([]string(nil), updated.Policy.Reasons...)
				result.RepairPrepared = repaired.State == "repair_pending"
				return result, nil
			}
			automated := s.runAutomaticPlan(ctx, sessionID, "provider_workflow")
			automated.WorkflowExecuted = result.WorkflowExecuted
			automated.WorkflowRound = result.WorkflowRound
			return automated, nil
		}
		return result, nil
	}
}

func (s *Service) executeWorkflowPlan(ctx context.Context, sessionID string, plan domain.ExecutionPlan, decision domain.PolicyDecision, transport string) (domain.ExecutionResult, error) {
	if plan.Debug != nil && plan.Debug.Protocol == domain.InteractiveProtocolV2 {
		return s.executeInteractiveV2Plan(ctx, sessionID, plan, decision, transport)
	}
	current, err := s.store.Get(sessionID)
	if err != nil {
		return domain.ExecutionResult{}, err
	}
	result := domain.ExecutionResult{PlanID: plan.PlanID, StartedAt: time.Now().UTC(), Commands: []domain.CommandResult{}}
	s.bus.Publish(sessionID, "workflow.started", map[string]any{"plan_id": plan.PlanID, "transport": transport, "round": current.WorkflowRound + 1})
	if plan.Debug != nil && plan.Debug.Query != "" {
		observation, queryErr := s.executeDebugQuery(sessionID, current, plan.Debug.Query)
		result.Commands = append(result.Commands, observation)
		if queryErr != nil {
			result.Error = queryErr.Error()
			result.CompletedAt = time.Now().UTC()
			s.storeWorkflowObservation(sessionID, result, decision)
			return result, queryErr
		}
	}
	runner := s.runner
	target := "workflow-sandbox"
	if plan.Debug != nil && plan.Debug.Target == "host" {
		runner = s.hostRunner
		target = "debug-host"
	}
	// An engine-owned query with no command operations never needs to prepare a
	// sandbox or host workspace. Keeping it in-process is the security boundary.
	if len(plan.Operations) == 0 && len(plan.Verification) == 0 {
		result.Success = true
		result.CompletedAt = time.Now().UTC()
		s.storeWorkflowObservation(sessionID, result, decision)
		s.bus.Publish(sessionID, "workflow.completed", map[string]any{"plan_id": plan.PlanID, "commands": len(result.Commands), "transport": transport, "target": target})
		return result, nil
	}
	workspace, err := runner.Prepare(ctx, current.ProjectPath)
	if err != nil {
		result.Error = err.Error()
		result.CompletedAt = time.Now().UTC()
		return result, err
	}
	defer runner.Cleanup(workspace)

	run := func(command domain.CommandSpec) error {
		commandResult, runErr := s.runCommandWithRunner(ctx, sessionID, runner, workspace, command, target)
		result.Commands = append(result.Commands, commandResult)
		if runErr != nil {
			return runErr
		}
		if !commandResult.Success {
			return fmt.Errorf("workflow command exited with %d", commandResult.ExitCode)
		}
		return nil
	}
	for _, op := range plan.Operations {
		if err := run(op.Command); err != nil {
			result.Error = err.Error()
			result.CompletedAt = time.Now().UTC()
			result.Success = false
			s.storeWorkflowObservation(sessionID, result, decision)
			return result, err
		}
	}
	for _, command := range plan.Verification {
		if err := run(command); err != nil {
			result.Error = err.Error()
			result.CompletedAt = time.Now().UTC()
			result.Success = false
			s.storeWorkflowObservation(sessionID, result, decision)
			return result, err
		}
	}
	result.Success = true
	result.CompletedAt = time.Now().UTC()
	s.storeWorkflowObservation(sessionID, result, decision)
	s.bus.Publish(sessionID, "workflow.completed", map[string]any{"plan_id": plan.PlanID, "commands": len(result.Commands), "transport": transport, "target": target})
	return result, nil
}

func (s *Service) storeWorkflowObservation(sessionID string, result domain.ExecutionResult, decision domain.PolicyDecision) {
	// A workflow round is an execution the operator can inspect, and the next
	// round overwrites LastExecution — so without this the evidence that shaped
	// the answer is gone by the time anyone looks for it.
	s.recordExecutionActivity(sessionID, result.PlanID, result)
	_, _ = s.store.Update(sessionID, func(item *domain.Session) error {
		item.Policy = &decision
		item.LastExecution = &result
		item.State = "workflow_observed"
		return nil
	})
}

func (s *Service) prepareWorkflowContinuation(ctx context.Context, sessionID string, execution domain.ExecutionResult, round, limit int) error {
	refreshed, err := s.refreshContext(sessionID)
	if err != nil {
		return fmt.Errorf("refresh context for workflow continuation: %w", err)
	}
	requestID := ids.New("req")
	s.prepareContinuation(ctx, refreshed, requestID, refreshed.LastRequestID)
	_, _ = s.store.Update(sessionID, func(item *domain.Session) error {
		// Per-plan authorization for a host-modifying debug step is one-shot.
		// Any continuation that wants to touch the host again must present its
		// own exact plan for approval, even when Debug mode is enabled.
		item.DebugApprovedPlanID = ""
		if item.InteractiveGrant != nil && item.InteractiveGrant.OneShot {
			item.InteractiveGrant = nil
		}
		// A workflow round is evidence gathering, not a failure, but it is
		// still a round the planner spent: recording it stops the next round
		// re-running probes whose answers are already in hand.
		recordAttemptRound(item, knowledgeReviewRoot(*item, item.LastRequestID), attemptRoundFromExecution(
			item.LastRequestID, requestKindEvidence, execution, domain.AttemptOutcomeObservation, "workflow observation round completed"))
		return nil
	})
	message := buildWorkflowObservationMessage(execution, round, limit)
	s.bus.Publish(sessionID, "workflow.continuation_started", map[string]any{"request_id": requestID, "round": round, "plan_id": execution.PlanID})
	knowledgeSnapshot, err := s.loadRequestKnowledge(sessionID, refreshed.ProjectPath)
	if err != nil {
		return fmt.Errorf("load knowledge for workflow continuation: %w", err)
	}
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
		return fmt.Errorf("prepare workflow continuation: %w", err)
	}
	enrichPlanConcurrency(planned.Plan, refreshed.Context.Manifest.SHA256)
	if err := normalizePlannerResult(requestID, &planned); err != nil {
		return err
	}
	decision := domain.PolicyDecision{}
	if planned.Plan != nil {
		decision = s.policy.Evaluate(*planned.Plan)
	}
	var prunedContexts []string
	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		recordRequestLineage(item, requestID, refreshed.LastRequestID, requestKindEvidence)
		recordRequestKnowledge(item, requestID, knowledgeSnapshot)
		item.WorkflowRound = round
		item.LastRequestID = requestID
		recordRequestBaseline(item, requestID, refreshed.Context.Manifest.SHA256)
		prunedContexts = append(prunedContexts, recordRequestContext(item, requestID, refreshed.Context)...)
		item.LastManualPrompt = planned.ManualPrompt
		item.LastTurn = planned.Turn
		if planned.ProviderResponseID != "" {
			item.LastProviderResponseID = planned.ProviderResponseID
		}
		if planned.ManualPrompt != "" && planned.Plan == nil && planned.Turn == nil {
			item.PendingManualRequestIDs = []string{requestID}
			item.Plan = nil
			item.Policy = nil
			item.State = "workflow_pending"
			return nil
		}
		item.PendingManualRequestIDs = nil
		if planned.Plan != nil {
			item.Plan = planned.Plan
			item.Policy = &decision
			if planned.Turn != nil && planned.Turn.Kind == domain.TurnKindWorkflow {
				if planned.Plan.Debug != nil && !debugAuthorized(*item) {
					item.State = "debug_approval_required"
				} else {
					item.State = "workflow_planned"
				}
			} else {
				item.State = "planned"
			}
			return nil
		}
		item.Plan = nil
		item.Policy = nil
		item.State = turnState(planned.Turn.Kind)
		return nil
	})
	if err != nil {
		return err
	}
	s.cleanupPrunedRequestContexts(prunedContexts)
	if updated.State == "workflow_pending" {
		s.bus.Publish(sessionID, "workflow.prompt_ready", map[string]any{"request_id": requestID, "round": round, "plan_id": execution.PlanID})
	} else if updated.LastTurn != nil {
		s.bus.Publish(sessionID, "turn.received", map[string]any{"request_id": requestID, "kind": updated.LastTurn.Kind, "transport": "provider_workflow"})
	}
	return nil
}
