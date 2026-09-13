package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/sandbox"
)

func (s *Service) runHostDependencyRepairCommand(ctx context.Context, sessionID string, workspace sandbox.Workspace, command domain.CommandSpec) (domain.CommandResult, error) {
	runID := ids.New("run")
	s.bus.Publish(sessionID, "host_dependency_repair.command_started", map[string]any{
		"run_id": runID, "argv": command.Argv, "cwd": command.Cwd,
	})
	var result domain.CommandResult
	var runErr error
	if streaming, ok := s.hostRunner.(sandbox.StreamingRunner); ok {
		result, runErr = streaming.RunStreaming(ctx, workspace, command, func(stream, text string) {
			s.bus.Publish(sessionID, "host_dependency_repair.command_output", map[string]any{
				"run_id": runID, "stream": stream, "text": text, "argv": command.Argv, "cwd": command.Cwd,
			})
		})
	} else {
		result, runErr = s.hostRunner.Run(ctx, workspace, command)
	}
	result = normalizePreflightCommandFailure(command, result, runErr)
	s.bus.Publish(sessionID, "host_dependency_repair.command_completed", map[string]any{
		"run_id": runID, "argv": command.Argv, "cwd": command.Cwd, "exit_code": result.ExitCode, "success": result.Success,
		"stdout": result.Stdout, "stderr": result.Stderr, "duration_ms": result.DurationMS,
	})
	return result, runErr
}

// RetryHostDependencyRepair is an explicit human-approved recovery for a
// narrowly classified host-only npm/node dependency defect (see
// domain.FailureKindHostDependencyState and hostDependencyRemediationCommands).
// It never asks the planner for commands and never runs anything outside the
// fixed remediation recipe: it removes node_modules/package-lock.json and
// reinstalls, directly against the host project directory, then reruns the
// exact verification commands ApplyToHost already reran post-merge. On
// success it chains straight into ApplyToHost so the human does not need a
// second click; on failure the session keeps its failure state for review.
func (s *Service) RetryHostDependencyRepair(ctx context.Context, sessionID string, approved bool) (domain.Session, error) {
	if !approved {
		return domain.Session{}, ErrApprovalRequired
	}
	current, err := s.store.Get(sessionID)
	if err != nil {
		return current, err
	}
	if current.ExecutionMode != domain.ExecutionModeProtected {
		return current, errors.New("host dependency repair requires Protected execution")
	}
	// An ApplyToHost (post-merge) failure never sets Session.State to
	// "failed" — it stays "verified" with FailureKind set by
	// prepareRepairRequest. So this checks FailureKind directly, and reads
	// verification commands from PendingHostChanges (what ApplyToHost
	// itself reruns), not current.Plan.
	if sessionFailureKind(current) != domain.FailureKindHostDependencyState {
		return current, errors.New("no host dependency failure is available to repair")
	}
	pending := hostApplicablePendingChanges(pendingHostChanges(current))
	if len(pending) == 0 {
		return current, errors.New("no pending host change is available to repair")
	}
	cwd, ok := hostDependencyRemediationSite(pending)
	if !ok {
		return current, errors.New("pending change has no eligible npm/node command to repair")
	}

	workspace, err := s.hostRunner.Prepare(ctx, current.ProjectPath)
	if err != nil {
		return current, fmt.Errorf("prepare host workspace for dependency repair: %w", err)
	}
	defer s.hostRunner.Cleanup(workspace)

	s.bus.Publish(sessionID, "host_dependency_repair.started", map[string]any{"cwd": cwd})
	for _, command := range hostDependencyRemediationCommands(cwd) {
		decision := s.policy.EvaluateInteractiveCommand(command)
		if !decision.Allowed {
			err := fmt.Errorf("host dependency repair command denied by policy: %s", strings.Join(decision.Reasons, "; "))
			s.bus.Publish(sessionID, "host_dependency_repair.failed", map[string]any{"argv": command.Argv, "error": err.Error()})
			return current, err
		}
		result, runErr := s.runHostDependencyRepairCommand(ctx, sessionID, workspace, command)
		if runErr != nil || !result.Success {
			detail := runErr
			if detail == nil {
				detail = errors.New(strings.TrimSpace(result.Stderr))
			}
			err := fmt.Errorf("host dependency repair failed: %s: %w", strings.Join(command.Argv, " "), detail)
			s.bus.Publish(sessionID, "host_dependency_repair.failed", map[string]any{"argv": command.Argv, "error": err.Error()})
			return current, err
		}
	}

	for _, run := range dedupedIntegrationVerifications(pending) {
		result, runErr := s.hostRunner.Run(ctx, workspace, run.command)
		if runErr != nil || !result.Success {
			// A gate this environment cannot run at all is the same
			// infrastructure fault ApplyToHost records rather than fails on.
			// Reporting it here as "the reinstall did not fix the build" would
			// blame the remediation for a toolchain gap it never touched.
			if gate, unsupported := classifyUnsupportedHostGate(run.command, result); runErr == nil && unsupported {
				s.bus.Publish(sessionID, "integration.verification_unsupported", gate.event(""))
				continue
			}
			// The reinstall ran clean but did not actually fix the build:
			// this is no longer the known npm optional-deps pattern, so
			// clear the (now-misleading) host_dependency_state label and
			// surface the concrete new error instead of re-blocking under
			// a reason that no longer applies. This never re-enters the
			// ChatGPT repair loop on its own — the next Apply attempt does
			// its own classification.
			diagnostic := commandResultDiagnostic(result)
			verifyErr := runErr
			if verifyErr == nil {
				verifyErr = fmt.Errorf("exit %d: %s", result.ExitCode, diagnostic)
			}
			failure := fmt.Errorf("host dependency repair reinstalled cleanly but verification still fails: %s: %w", strings.Join(run.command.Argv, " "), verifyErr)
			updated, updateErr := s.store.Update(sessionID, func(item *domain.Session) error {
				clearSessionFailure(item)
				item.LastRepairError = failure.Error()
				return nil
			})
			if updateErr != nil {
				return current, fmt.Errorf("%w; also failed to persist repair state: %v", failure, updateErr)
			}
			s.bus.Publish(sessionID, "host_dependency_repair.reverify_failed", map[string]any{"argv": run.command.Argv, "error": failure.Error()})
			return updated, failure
		}
	}

	if _, err := s.store.Update(sessionID, func(item *domain.Session) error {
		clearSessionFailure(item)
		return nil
	}); err != nil {
		return current, err
	}
	s.bus.Publish(sessionID, "host_dependency_repair.completed", map[string]any{"cwd": cwd})
	return s.ApplyToHost(ctx, sessionID)
}
