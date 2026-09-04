package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/protocol"
)

// reverifyPendingCandidate replays the complete verified candidate against the
// current host snapshot before a stale-but-disjoint candidate can be applied.
// The caller holds the project mutation lock, closing the reverify/apply race.
func (s *Service) reverifyPendingCandidate(ctx context.Context, sessionID string, item domain.Session, pending []domain.PendingHostChange, baseline string) (domain.Session, error) {
	workspace, err := s.runner.Prepare(ctx, item.ProjectPath)
	if err != nil {
		return item, err
	}
	defer s.runner.Cleanup(workspace)

	next := append([]domain.PendingHostChange(nil), pending...)
	for index := range next {
		plan := next[index].Plan
		if err := protocol.Validate(plan); err != nil {
			return item, fmt.Errorf("plan %s: %w", plan.PlanID, err)
		}
		decision := s.policy.Evaluate(plan)
		if !decision.Allowed {
			return item, fmt.Errorf("plan %s is no longer policy-allowed: %s", plan.PlanID, strings.Join(decision.Reasons, "; "))
		}
		result := domain.ExecutionResult{PlanID: plan.PlanID, StartedAt: time.Now().UTC(), Commands: []domain.CommandResult{}}
		for _, op := range plan.Operations {
			if op.Type == "apply_patch" {
				if err := protocol.ValidatePatchPaths(op.Patch); err != nil {
					return item, err
				}
				run, runErr := s.runner.ApplyPatch(ctx, workspace, op.Patch)
				result.Commands = append(result.Commands, run)
				if runErr != nil || !run.Success {
					if runErr != nil {
						return item, fmt.Errorf("plan %s patch reverify: %w", plan.PlanID, runErr)
					}
					return item, fmt.Errorf("plan %s patch reverify failed: %s", plan.PlanID, strings.TrimSpace(run.Stderr))
				}
				continue
			}
			run, runErr := s.runCommandWithRunner(ctx, sessionID, s.runner, workspace, protectedGitCommand(op.Command), "sandbox-baseline-reverify")
			result.Commands = append(result.Commands, run)
			if runErr != nil || !run.Success {
				if runErr != nil {
					return item, fmt.Errorf("plan %s command reverify: %w", plan.PlanID, runErr)
				}
				return item, fmt.Errorf("plan %s command reverify exited with %d", plan.PlanID, run.ExitCode)
			}
		}
		for _, command := range plan.Verification {
			run, runErr := s.runCommandWithRunner(ctx, sessionID, s.runner, workspace, command, "sandbox-baseline-reverify")
			result.Commands = append(result.Commands, run)
			if runErr != nil || !run.Success {
				if runErr != nil {
					return item, fmt.Errorf("plan %s verification reverify: %w", plan.PlanID, runErr)
				}
				return item, fmt.Errorf("plan %s verification reverify failed: %s", plan.PlanID, commandResultDiagnostic(run))
			}
		}
		result.Success = true
		result.CompletedAt = time.Now().UTC()
		plan.BaseContextSHA256 = baseline
		next[index] = domain.PendingHostChange{Plan: plan, Execution: result, VerifiedAt: result.CompletedAt}
	}

	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.PendingHostChanges = next
		for index := range next {
			if current.Plan != nil && current.Plan.PlanID == next[index].Plan.PlanID {
				plan := next[index].Plan
				current.Plan = &plan
				result := next[index].Execution
				current.LastExecution = &result
			}
		}
		current.State = "verified"
		return nil
	})
	if err != nil {
		return item, err
	}
	s.bus.Publish(sessionID, "baseline.candidate_reverified", map[string]any{"base_context_sha256": baseline, "plan_count": len(next)})
	return updated, nil
}
