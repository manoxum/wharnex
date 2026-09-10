package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/protocol"
	"kernl.local/harness/backend/internal/sandbox"
)

// RestoreRevertedHostChange reapplies the exact patch batch retained by a
// successful RevertHostChange. If the current host has drifted and the exact
// replay no longer applies, Wharnex leaves/returns the host to its reverted
// state and opens a dedicated ChatGPT reconciliation request.
func (s *Service) RestoreRevertedHostChange(ctx context.Context, sessionID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	applyLock := s.projectApplyLock(item.ProjectPath)
	applyLock.Lock()
	defer applyLock.Unlock()

	item, err = s.refreshContext(sessionID)
	if err != nil {
		return item, fmt.Errorf("refresh baseline before reverted-change restore: %w", err)
	}
	if item.ExecutionMode != domain.ExecutionModeProtected {
		return item, errors.New("restore is available only for Protected host changes")
	}
	if item.State != "reverted" || len(item.LastRevertedChanges) == 0 {
		return item, errors.New("there is no reverted change available to restore")
	}
	changes := append([]domain.PendingHostChange(nil), item.LastRevertedChanges...)
	latestPlanID := changes[len(changes)-1].Plan.PlanID
	previousBaseline := strings.TrimSpace(item.Context.Manifest.SHA256)

	if s.isSelfEvolution(item) {
		return s.prepareRevertRestoreRecovery(ctx, item, errors.New("self-evolution restore requires a new verified transactional change instead of direct host patch replay"))
	}
	patches, changedFiles, collectErr := restorePatchBatch(changes)
	if collectErr != nil {
		return s.prepareRevertRestoreRecovery(ctx, item, collectErr)
	}
	for _, patch := range patches {
		if validateErr := protocol.ValidatePatchPaths(patch); validateErr != nil {
			return s.prepareRevertRestoreRecovery(ctx, item, fmt.Errorf("validate restored patch: %w", validateErr))
		}
	}

	s.bus.Publish(sessionID, "host.restore_started", map[string]any{"plan_id": latestPlanID, "plan_count": len(changes), "patch_count": len(patches)})
	workspace, err := s.hostRunner.Prepare(ctx, item.ProjectPath)
	if err != nil {
		return s.prepareRevertRestoreRecovery(ctx, item, fmt.Errorf("prepare host restore: %w", err))
	}
	defer s.hostRunner.Cleanup(workspace)
	reverse, ok := s.hostRunner.(sandbox.ReversePatchRunner)
	if !ok {
		return s.prepareRevertRestoreRecovery(ctx, item, errors.New("host runner cannot roll back a partial reverted-change restore"))
	}

	applied := make([]string, 0, len(patches))
	for _, patch := range patches {
		runID := ids.New("host-restore")
		s.bus.Publish(sessionID, "patch.started", map[string]any{"run_id": runID, "target": "host-restore", "files": patchPaths(patch)})
		result, applyErr := s.hostRunner.ApplyPatch(ctx, workspace, patch)
		if applyErr != nil || !result.Success {
			cause := applyErr
			if cause == nil {
				cause = errors.New(strings.TrimSpace(result.Stderr))
			}
			cause = rollbackRestoredPatches(ctx, reverse, workspace, applied, cause)
			s.bus.Publish(sessionID, "host.restore_failed", map[string]any{"plan_id": latestPlanID, "error": cause.Error(), "rolled_back_patch_count": len(applied)})
			return s.prepareRevertRestoreRecovery(ctx, item, cause)
		}
		applied = append(applied, patch)
		s.bus.Publish(sessionID, "patch.applied", map[string]any{"run_id": runID, "target": "host-restore", "files": patchPaths(patch), "duration_ms": result.DurationMS})
	}

	restoredAt := time.Now().UTC()
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.State = "applied"
		current.LastAppliedChanges = append([]domain.PendingHostChange(nil), changes...)
		current.LastRevertedChanges = nil
		current.LastHostCommands = nil
		current.LastHostAppliedAt = restoredAt
		clearSessionFailure(current)
		return nil
	})
	if err != nil {
		return item, err
	}
	s.resetDevspace(sessionID)
	s.bus.Publish(sessionID, "host.restored", map[string]any{"plan_id": latestPlanID, "plan_count": len(changes)})
	if refreshed, refreshErr := s.refreshContext(sessionID); refreshErr == nil {
		updated = refreshed
		s.publishBaselineUpdate(ctx, updated, previousBaseline, refreshed.Context.Manifest.SHA256, latestPlanID, changedFiles)
	} else {
		s.bus.Publish(sessionID, "context.refresh_after_restore_failed", map[string]any{"error": refreshErr.Error()})
	}
	return updated, nil
}

func restorePatchBatch(changes []domain.PendingHostChange) ([]string, []string, error) {
	patches := make([]string, 0)
	files := make([]string, 0)
	for index := range changes {
		for _, op := range changes[index].Plan.Operations {
			if op.Type == "command" && policy.HostReplayGitCommand(op.Command) {
				return nil, nil, errors.New("direct restore is unavailable for reverted plans containing host git mutation commands")
			}
		}
		for _, patch := range planPatches(&changes[index].Plan) {
			patches = append(patches, patch)
			files = append(files, patchTouchedPaths(patch)...)
		}
	}
	if len(patches) == 0 {
		return nil, nil, errors.New("the reverted change has no deterministic patch batch to restore")
	}
	return patches, normalizedPaths(files), nil
}

func rollbackRestoredPatches(ctx context.Context, reverse sandbox.ReversePatchRunner, workspace sandbox.Workspace, patches []string, cause error) error {
	if cause == nil {
		cause = errors.New("host restore failed")
	}
	for index := len(patches) - 1; index >= 0; index-- {
		result, err := reverse.ReversePatch(ctx, workspace, patches[index])
		if err != nil {
			return fmt.Errorf("restore failed: %w; rollback failed: %v", cause, err)
		}
		if !result.Success {
			return fmt.Errorf("restore failed: %w; rollback failed: %s", cause, strings.TrimSpace(result.Stderr))
		}
	}
	return fmt.Errorf("restore failed: %w; applied restore patches were rolled back", cause)
}

func (s *Service) prepareRevertRestoreRecovery(ctx context.Context, item domain.Session, cause error) (domain.Session, error) {
	changes := item.LastRevertedChanges
	if len(changes) == 0 {
		return item, cause
	}
	result := changes[len(changes)-1].Execution
	s.bus.Publish(item.ID, "host.restore_recovery_started", map[string]any{"plan_id": changes[len(changes)-1].Plan.PlanID, "error": cause.Error()})
	return s.prepareRepairRequestWithKind(ctx, item.ID, result, cause, true, "", requestKindRevertRestore)
}

func buildRevertRestoreMessage(item domain.Session, result domain.ExecutionResult, cause error) string {
	var intended strings.Builder
	for index, change := range item.LastRevertedChanges {
		fmt.Fprintf(&intended, "\nReverted plan %d: %s — %s\n", index+1, change.Plan.PlanID, change.Plan.Summary)
		for patchIndex, patch := range planPatches(&change.Plan) {
			fmt.Fprintf(&intended, "Intended patch %d:\n--- BEGIN INTENDED PATCH ---\n%s\n--- END INTENDED PATCH ---\n", patchIndex+1, truncateRepairText(patch, 24000))
		}
		if intended.Len() > 60000 {
			intended.WriteString("\n...[reverted change truncated by Wharnex]\n")
			break
		}
	}
	return fmt.Sprintf(`REVERT RESTORE RECOVERY REQUEST

The user asked Wharnex to restore a previously reverted, verified host change. Exact forward replay could not be completed safely. Wharnex attempted to roll back any patches applied by that restore attempt; use the CURRENT attached project context as authoritative in case the host changed independently or rollback itself reported a problem.

Do not reuse the reverted plan's old baseline or request id. Reconcile the current project to the intended post-apply behavior represented below, preserving unrelated current work. Return a fresh protocol-valid change through the normal Wharnex file-first contract.

RESTORE FAILURE:
%s

ORIGINAL APPLIED PLAN ID: %s
INTENDED REVERTED CHANGE:%s`, truncateRepairText(cause.Error(), 12000), result.PlanID, intended.String())
}
