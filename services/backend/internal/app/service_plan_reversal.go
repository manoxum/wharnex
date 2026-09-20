package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
)

type planReversalCapsule struct {
	Protocol             string                           `json:"protocol"`
	SessionID            string                           `json:"session_id"`
	Plan                 domain.ExecutionPlan             `json:"applied_plan"`
	Execution            domain.ExecutionResult           `json:"applied_execution"`
	LastExecution        *domain.ExecutionResult          `json:"last_execution,omitempty"`
	LastAppliedChanges   []domain.PendingHostChange       `json:"last_applied_changes"`
	LastRevertedChanges  []domain.PendingHostChange       `json:"last_reverted_changes,omitempty"`
	HostCommands         []domain.CommandResult           `json:"host_commands,omitempty"`
	RequestLineages      map[string]domain.RequestLineage `json:"request_lineages,omitempty"`
	CurrentContextSHA256 string                           `json:"current_context_sha256"`
	LastRequestID        string                           `json:"last_request_id,omitempty"`
	LastTurn             *domain.AgentTurn                `json:"last_turn,omitempty"`
}

// PrepareExecutionPlanReversal creates a derived planner request instead of
// mutating the host with a mechanical inverse patch. The planner receives the
// exact applied plan/execution plus the current repository snapshot; the
// continuation transport adds the Main Request, attempt events and prior
// response bundles so it can calculate a safe inverse around parallel work.
func (s *Service) PrepareExecutionPlanReversal(ctx context.Context, sessionID string) (planner.Result, domain.Session, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return planner.Result{}, current, err
	}
	if current.ExecutionMode != domain.ExecutionModeProtected {
		return planner.Result{}, current, errors.New("GPT-calculated reversal is available only for Protected host applies")
	}
	if len(hostApplicablePendingChanges(pendingHostChanges(current))) > 0 {
		return planner.Result{}, current, errors.New("resolve or reject pending host changes before preparing a reversal")
	}
	if len(current.LastAppliedChanges) == 0 {
		return planner.Result{}, current, errors.New("no applied plan is available for reversal")
	}
	latest := current.LastAppliedChanges[len(current.LastAppliedChanges)-1]
	parentRequestID := strings.TrimSpace(latest.Plan.RequestID)
	if parentRequestID == "" {
		return planner.Result{}, current, errors.New("the applied plan has no request lineage for a safe reversal")
	}
	if current.PlannerInFlight || len(current.PendingManualRequestIDs) > 0 {
		return planner.Result{}, current, errors.New("another planner request is already in flight")
	}
	refreshed, err := s.refreshContext(sessionID)
	if err != nil {
		return planner.Result{}, current, fmt.Errorf("refresh context before reversal: %w", err)
	}
	capsule := planReversalCapsule{
		Protocol: "harness.plan-reversal/v1", SessionID: sessionID,
		Plan: latest.Plan, Execution: latest.Execution, LastExecution: refreshed.LastExecution,
		LastAppliedChanges:  append([]domain.PendingHostChange(nil), refreshed.LastAppliedChanges...),
		LastRevertedChanges: append([]domain.PendingHostChange(nil), refreshed.LastRevertedChanges...),
		HostCommands:        append([]domain.CommandResult(nil), refreshed.LastHostCommands...),
		RequestLineages:     refreshed.RequestLineages, CurrentContextSHA256: refreshed.Context.Manifest.SHA256,
		LastRequestID: refreshed.LastRequestID, LastTurn: refreshed.LastTurn,
	}
	raw, err := json.MarshalIndent(capsule, "", "  ")
	if err != nil {
		return planner.Result{}, refreshed, fmt.Errorf("encode reversal capsule: %w", err)
	}
	message := "PLAN REVERSAL REQUEST\n\nCalculate a safe reversal of the applied plan below against the CURRENT repository state. Preserve unrelated and parallel work. Never use git reset, checkout, hard reset, broad file replacement, or any operation that can discard concurrent changes. Reconstruct the inverse as a normal executable change plan and verify it before host apply. The file-first continuation bundle also carries the original Main Request, attempts/events, prior response bundles, context delta, plans, diffs, commands and logs from the request lineage.\n\nreversal/capsule.json:\n" + string(raw)
	result, updated, err := s.submitPlannerRequest(ctx, sessionID, message, "direct", parentRequestID, requestKindPlanReversal)
	if err != nil {
		return result, updated, err
	}
	reversalRequestID := ""
	if result.Plan != nil {
		reversalRequestID = strings.TrimSpace(result.Plan.RequestID)
	} else if result.Turn != nil {
		reversalRequestID = strings.TrimSpace(result.Turn.RequestID)
	} else {
		reversalRequestID = strings.TrimSpace(updated.LastRequestID)
	}
	if reversalRequestID != "" {
		if persisted, updateErr := s.store.Update(sessionID, func(item *domain.Session) error {
			recordRequestSupportArtifact(item, reversalRequestID, planReversalArtifactPath, raw)
			return nil
		}); updateErr == nil {
			updated = persisted
		} else {
			return result, updated, fmt.Errorf("persist reversal evidence: %w", updateErr)
		}
	}
	s.bus.Publish(sessionID, "plan.reversal_requested", map[string]any{"plan_id": latest.Plan.PlanID, "parent_request_id": parentRequestID, "request_id": reversalRequestID})
	return result, updated, nil
}
