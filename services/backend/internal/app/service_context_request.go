package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// A context_request is a typed engine read of captured files. It has no shell,
// host mutation, network access, patch authority or execution plan.
func (s *Service) acceptContextRequest(ctx context.Context, sessionID string, current domain.Session, turn domain.AgentTurn, info domain.ExecutionBundleInfo) (BundleSubmission, error) {
	if domain.EffectiveContextMode(current.ContextMode) != domain.ContextModePartial {
		return BundleSubmission{}, errors.New("context_request requires Partial context mode")
	}
	if turn.Outcome == nil || turn.Outcome.Status != domain.TurnOutcomeCompleted {
		return BundleSubmission{}, errors.New("context_request must have a completed outcome")
	}
	if current.WorkflowRound >= maxWorkflowRounds {
		return BundleSubmission{}, fmt.Errorf("context increment limit reached (%d)", maxWorkflowRounds)
	}
	paths, err := selectContextPaths(current.Context.ZipPath, current.ContextPaths, turn.ContextPaths)
	if err != nil {
		return BundleSubmission{}, err
	}
	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		if item.LastRequestID != turn.RequestID || !containsString(item.PendingManualRequestIDs, turn.RequestID) {
			return errors.New("context request is no longer pending")
		}
		item.ContextPaths = paths
		item.LastTurn = &turn
		item.LastBundle = &info
		item.PendingManualRequestIDs = removeString(item.PendingManualRequestIDs, turn.RequestID)
		item.State = "workflow_observed"
		return nil
	})
	if err != nil {
		return BundleSubmission{}, err
	}
	s.releaseRemoteInputLease(sessionID, turn.RequestID)
	now := time.Now().UTC()
	result := domain.ExecutionResult{PlanID: "context-" + turn.RequestID, StartedAt: now, CompletedAt: now, Success: true}
	for _, path := range turn.ContextPaths {
		result.Commands = append(result.Commands, domain.CommandResult{Argv: []string{"context.read", path}, Cwd: ".", ExitCode: 0, Success: true, Stdout: "Added captured file to the next request bundle."})
	}
	// An increment is a round like a workflow step: its body belongs in the
	// durable ledger, or the history of what the planner was shown is lost.
	s.recordExecutionActivity(sessionID, turn.RequestID, result)
	s.bus.Publish(sessionID, "context.incremented", map[string]any{"request_id": turn.RequestID, "added": len(turn.ContextPaths), "selected": len(paths)})
	if err := s.prepareWorkflowContinuation(ctx, sessionID, result, updated.WorkflowRound+1, maxWorkflowRounds); err != nil {
		return BundleSubmission{}, err
	}
	continued, err := s.store.Get(sessionID)
	if err != nil {
		return BundleSubmission{}, err
	}
	return BundleSubmission{Session: continued, WorkflowPrepared: true, ContextIncremented: true, WorkflowRound: continued.WorkflowRound}, nil
}
