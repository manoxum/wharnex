package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// A context_request is a typed engine read of captured files. It has no shell,
// host mutation, network access, patch authority or execution plan. The
// planner alone decides how many increments it needs: only snapshot
// membership, path safety and the cumulative byte budget bound it.
func (s *Service) acceptContextRequest(ctx context.Context, sessionID string, current domain.Session, turn domain.AgentTurn, info domain.ExecutionBundleInfo) (BundleSubmission, error) {
	if domain.EffectiveContextMode(current.ContextMode) != domain.ContextModePartial {
		return BundleSubmission{}, errors.New("context_request requires Partial context mode")
	}
	if turn.Outcome == nil || turn.Outcome.Status != domain.TurnOutcomeCompleted {
		return BundleSubmission{}, errors.New("context_request must have a completed outcome")
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
		item.ContextIncrements++
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
	ranking := contextMapSelectionRankingMetrics(current.Context.ZipPath, current.Context.Manifest, requestContextMapState{SelectedPaths: current.ContextPaths, RoundsUsed: current.WorkflowRound, Query: current.LastManualPrompt}, turn.ContextPaths)
	s.bus.Publish(sessionID, "context.incremented", map[string]any{
		"request_id": turn.RequestID, "added": len(turn.ContextPaths), "selected": len(paths), "selected_bytes": selectedContextBytes(current.Context.ZipPath, paths), "round": current.WorkflowRound + 1,
		"ranking_candidates": ranking.Candidates, "ranking_requested": ranking.RequestedRanked, "ranking_top10_hits": ranking.TopTenHits, "ranking_request_match_hits": ranking.RequestMatchHits, "ranking_position_sum": ranking.RankPositionSum,
	})
	round := updated.WorkflowRound + 1
	if err := s.prepareWorkflowContinuation(ctx, sessionID, result, round, buildContextIncrementMessage(turn.ContextPaths, round)); err != nil {
		return BundleSubmission{}, err
	}
	continued, err := s.store.Get(sessionID)
	if err != nil {
		return BundleSubmission{}, err
	}
	return BundleSubmission{Session: continued, WorkflowPrepared: true, ContextIncremented: true, WorkflowRound: continued.WorkflowRound}, nil
}

// buildContextIncrementMessage is the continuation prompt for an increment. It
// states no round ceiling, because there is none: stopping is the planner's call.
func buildContextIncrementMessage(added []string, round int) string {
	var out strings.Builder
	fmt.Fprintf(&out, "PARTIAL CONTEXT INCREMENT — round %d\n\n", round)
	out.WriteString("Wharnex validated your context_request against the captured snapshot and added these file bodies to this request archive, together with every file selected earlier:\n")
	for _, path := range added {
		out.WriteString("- " + path + "\n")
	}
	out.WriteString("\nNEXT DECISION:\n- If the selected files and maps suffice, return the terminal answer, investigation, plan, change, clarification or blocked bundle for the ORIGINAL user request.\n- If specific eligible files are still missing, return another context_request naming only files not yet supplied. Wharnex imposes no increment-round limit; you decide when the evidence is enough. Only the cumulative selected-bytes budget is bounded.\n")
	return out.String()
}
