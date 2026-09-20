package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/protocol"
	"kernl.local/harness/backend/internal/sandbox"
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
		verificationErr := func() error {
			var baselineWorkspace *sandbox.Workspace
			defer func() {
				if baselineWorkspace != nil {
					_ = s.runner.Cleanup(*baselineWorkspace)
				}
			}()
			for _, command := range plan.Verification {
				run, runErr := s.runCommandWithRunner(ctx, sessionID, s.runner, workspace, command, "sandbox-baseline-reverify")
				result.Commands = append(result.Commands, run)
				if runErr != nil {
					return fmt.Errorf("plan %s verification reverify: %w", plan.PlanID, runErr)
				}
				if run.Success {
					continue
				}
				baselineResult, unchanged, baselineErr := s.compareVerificationBaseline(ctx, s.runner, &baselineWorkspace, item.ProjectPath, next[:index], command, run)
				if baselineErr == nil && unchanged {
					s.bus.Publish(sessionID, "baseline.reverify_failure_unchanged", map[string]any{
						"plan_id": plan.PlanID, "argv": command.Argv, "exit_code": baselineResult.ExitCode,
						"diagnostic": commandResultDiagnostic(baselineResult),
					})
					continue
				}
				if baselineErr != nil {
					s.bus.Publish(sessionID, "baseline.reverify_compare_failed", map[string]any{"plan_id": plan.PlanID, "argv": command.Argv, "error": baselineErr.Error()})
				}
				return fmt.Errorf("plan %s verification reverify failed: %s", plan.PlanID, commandResultDiagnostic(run))
			}
			return nil
		}()
		if verificationErr != nil {
			return item, verificationErr
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

// promoteLegacyPatchBranches upgrades pre-Git-native pending patches while
// their immutable request-base refs are still retained. Reapplying such a
// patch to today's host is neither a rebase nor a safety check: it loses the
// three-way ancestor that Git needs to reconcile ordinary drift. The upgrade
// writes only a private integration ref; host content is still untouched until
// the normal Apply merge transaction and its verification gates succeed.
func (s *Service) promoteLegacyPatchBranches(ctx context.Context, sessionID string, item domain.Session, pending []domain.PendingHostChange) ([]domain.PendingHostChange, bool, error) {
	upgraded := append([]domain.PendingHostChange(nil), pending...)
	changed := false
	for index := range upgraded {
		if upgraded[index].ChangeSet != nil || strings.TrimSpace(upgraded[index].IntegrationBranch) != "" || len(actualPatchFiles(&upgraded[index].Plan)) == 0 {
			continue
		}
		workspace, err := s.runner.Prepare(ctx, item.ProjectPath)
		if err != nil {
			return pending, false, err
		}
		branch, _, rooted := s.prepareBaseRootedWorkspace(ctx, sessionID, item, &upgraded[index].Plan, workspace.Path)
		if !rooted {
			_ = s.runner.Cleanup(workspace)
			return pending, false, fmt.Errorf("legacy pending plan %s has no recoverable immutable request base", upgraded[index].Plan.PlanID)
		}
		result := domain.ExecutionResult{PlanID: upgraded[index].Plan.PlanID}
		replayErr := s.replayPlanPatches(ctx, s.runner, workspace, upgraded[index], &result)
		if replayErr != nil {
			_ = s.runner.Cleanup(workspace)
			return pending, false, replayErr
		}
		commit, submodules, commitErr := sandbox.CommitVerifiedRepositoryTree(ctx, workspace.Path, item.ProjectPath, branch, commitMessageForPlan(&upgraded[index].Plan), actualPatchFiles(&upgraded[index].Plan), true)
		_ = s.runner.Cleanup(workspace)
		if commitErr != nil {
			return pending, false, fmt.Errorf("commit promoted legacy plan %s: %w", upgraded[index].Plan.PlanID, commitErr)
		}
		upgraded[index].IntegrationBranch = branch
		upgraded[index].IntegrationCommit = commit
		upgraded[index].SubmoduleIntegrations = submodules
		changed = true
		s.bus.Publish(sessionID, "integration.legacy_patch_promoted", map[string]any{"plan_id": upgraded[index].Plan.PlanID, "branch": branch, "commit": commit})
	}
	return upgraded, changed, nil
}
