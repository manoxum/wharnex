package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/protocol"
	"kernl.local/harness/backend/internal/sandbox"
)

// replayIntegrationCommitAsPatch reproduces a pending Git-native candidate
// inside a workspace that shares no history with the host. The candidate's
// commit still lives in the host's own object database (PushBranchToHost put
// it there at verification time), so it is fetched from there, merged
// three-way from its own request base onto the workspace's current tree, and
// the result applied through the runner's normal patch strategy.
//
// A real collision with what the workspace holds now — typically operator
// work that kept changing after the candidate was verified — is a
// pendingIntegrationReplayConflict, exactly like a failed branch merge on the
// shared-history path, so it reaches a focused conflict capsule. It used to be
// a raw `git apply` failure here: a generic error the repair loop handed to a
// planner that cannot patch anything this early, so the round was spent and
// the next one failed identically. The raw commit diff is kept only for a Git
// build that cannot merge from an explicit base.
//
// A candidate whose commit the host no longer has — the branch was pruned, or
// the pending record predates the Git-native path — falls back to the plan's
// own recorded patches, which is exactly what the legacy replay tail does.
func (s *Service) replayIntegrationCommitAsPatch(ctx context.Context, sessionID, hostProjectPath string, runner sandbox.Runner, workspace sandbox.Workspace, change domain.PendingHostChange, result *domain.ExecutionResult) error {
	commit := strings.TrimSpace(change.IntegrationCommit)
	if commit == "" || !sandbox.HasCommit(ctx, hostProjectPath, commit) {
		s.bus.Publish(sessionID, "integration.branch_replay_downgraded", map[string]any{
			"branch": change.IntegrationBranch, "plan_id": change.Plan.PlanID,
			"reason": "the verified integration commit is no longer present in the host repository; replaying the plan's own patches instead",
		})
		return s.replayPlanPatches(ctx, runner, workspace, change, result)
	}
	strategy := "three_way"
	patch, err := sandbox.ThreeWayReplayPatch(ctx, workspace.Path, hostProjectPath, change.IntegrationBranch, commit)
	var conflict *sandbox.MergeConflictError
	switch {
	case errors.As(err, &conflict):
		return &pendingIntegrationReplayConflict{workspacePath: workspace.Path, conflict: conflict}
	case errors.Is(err, sandbox.ErrThreeWayReplayUnavailable):
		strategy = "commit_diff"
		if patch, err = sandbox.CommitDiff(ctx, hostProjectPath, commit); err != nil {
			return fmt.Errorf("read pending integration commit %s as patch: %w", commit, err)
		}
	case err != nil:
		return fmt.Errorf("replay pending integration commit %s: %w", commit, err)
	}
	if strings.TrimSpace(patch) == "" {
		// An empty diff means the candidate changed nothing reachable from
		// this base; there is nothing to replay and nothing to fail on.
		return nil
	}
	if err := protocol.ValidatePatchPaths(patch); err != nil {
		return fmt.Errorf("replay pending integration commit %s: %w", commit, err)
	}
	commandResult, runErr := runner.ApplyPatch(ctx, workspace, patch)
	result.Commands = append(result.Commands, commandResult)
	if runErr != nil || !commandResult.Success {
		if runErr == nil {
			runErr = fmt.Errorf("patch failed: %s", strings.TrimSpace(commandResult.Stderr))
		}
		return fmt.Errorf("replay pending integration commit %s: %w", commit, runErr)
	}
	s.bus.Publish(sessionID, "integration.branch_replayed", map[string]any{
		"branch": change.IntegrationBranch, "plan_id": change.Plan.PlanID,
		"commit": commit, "target": "sandbox-pending", "strategy": strategy,
	})
	return nil
}

// replayPlanPatches is the legacy replay tail, extracted so the Git-native
// downgrade path above can reuse it verbatim instead of duplicating it.
func (s *Service) replayPlanPatches(ctx context.Context, runner sandbox.Runner, workspace sandbox.Workspace, change domain.PendingHostChange, result *domain.ExecutionResult) error {
	for _, patch := range planPatches(&change.Plan) {
		if err := protocol.ValidatePatchPaths(patch); err != nil {
			return fmt.Errorf("replay pending plan %s: %w", change.Plan.PlanID, err)
		}
		commandResult, runErr := runner.ApplyPatch(ctx, workspace, patch)
		result.Commands = append(result.Commands, commandResult)
		if runErr != nil || !commandResult.Success {
			if runErr == nil {
				runErr = fmt.Errorf("patch failed: %s", strings.TrimSpace(commandResult.Stderr))
			}
			return fmt.Errorf("replay pending plan %s: %w", change.Plan.PlanID, runErr)
		}
	}
	return nil
}
