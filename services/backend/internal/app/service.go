package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/projectgit"
	"kernl.local/harness/backend/internal/protocol"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/workspacefs"
)

var (
	ErrApprovalRequired  = errors.New("explicit approval required")
	ErrExecutionRequired = errors.New("successful sandbox execution required before host apply")
)

type Service struct {
	store      *session.Store
	bus        *audit.Bus
	context    *contextbundle.Builder
	planner    planner.Planner
	policy     *policy.Engine
	runner     sandbox.Runner
	hostRunner sandbox.Runner
	devMu      sync.Mutex
	devspaces  map[string]sandbox.Workspace
}

func NewService(store *session.Store, bus *audit.Bus, builder *contextbundle.Builder, planner planner.Planner, policies *policy.Engine, runner sandbox.Runner) *Service {
	return &Service{store: store, bus: bus, context: builder, planner: planner, policy: policies, runner: runner, hostRunner: sandbox.NewHostRunner(), devspaces: make(map[string]sandbox.Workspace)}
}

func (s *Service) StartSession(ctx context.Context, projectPath string, requestedMode ...domain.ExecutionMode) (domain.Session, error) {
	id := ids.New("ses")
	mode := domain.ExecutionModeProtected
	if len(requestedMode) > 0 && requestedMode[0] != "" {
		mode = requestedMode[0]
	}
	if !domain.ValidExecutionMode(mode) {
		return domain.Session{}, fmt.Errorf("unsupported execution mode %q", mode)
	}
	initialized, err := projectgit.Ensure(ctx, projectPath)
	if err != nil {
		s.bus.Publish(id, "project.git_failed", map[string]any{"project_path": projectPath, "error": err.Error()})
		return domain.Session{}, fmt.Errorf("prepare project git repository: %w", err)
	}
	if initialized {
		s.bus.Publish(id, "project.git_initialized", map[string]any{"project_path": projectPath})
	} else {
		s.bus.Publish(id, "project.git_ready", map[string]any{"project_path": projectPath})
	}
	s.bus.Publish(id, "context.scanning", map[string]any{"project_path": projectPath})
	bundle, err := s.context.Build(projectPath)
	if err != nil {
		s.bus.Publish(id, "context.failed", map[string]any{"error": err.Error()})
		return domain.Session{}, err
	}
	item := domain.Session{ID: id, ProjectPath: bundle.Manifest.ProjectRoot, ExecutionMode: mode, State: "ready", CreatedAt: time.Now().UTC(), Context: bundle}
	s.store.Put(item)
	s.bus.Publish(id, "session.created", map[string]any{"files": len(bundle.Manifest.Files), "snapshot": bundle.Manifest.SHA256, "text_truncated": bundle.Manifest.TextTruncated, "execution_mode": mode})
	return item, nil
}

func (s *Service) DeleteSession(sessionID string) error {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return err
	}
	s.resetDevspace(sessionID)
	if err := s.store.Delete(sessionID); err != nil {
		return err
	}
	if dir := filepath.Dir(item.Context.ZipPath); dir != "" && dir != "." && strings.HasPrefix(filepath.Base(dir), "wharness-context-") {
		_ = os.RemoveAll(dir)
	}
	s.bus.Publish(sessionID, "session.deleted", map[string]any{})
	return nil
}

func (s *Service) SetExecutionMode(sessionID string, mode domain.ExecutionMode) (domain.Session, error) {
	if !domain.ValidExecutionMode(mode) {
		return domain.Session{}, fmt.Errorf("unsupported execution mode %q", mode)
	}
	item, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.ExecutionMode = mode
		return nil
	})
	if err != nil {
		return domain.Session{}, err
	}
	s.resetDevspace(sessionID)
	s.bus.Publish(sessionID, "execution.mode_changed", map[string]any{"execution_mode": mode})
	return item, nil
}

func (s *Service) SubmitMessage(ctx context.Context, sessionID, message string) (planner.Result, domain.Session, error) {
	item, err := s.refreshContext(sessionID)
	if err != nil {
		return planner.Result{}, domain.Session{}, err
	}
	requestID := ids.New("req")
	s.bus.Publish(sessionID, "planner.started", map[string]any{"request_id": requestID})
	result, err := s.planner.Plan(ctx, planner.Request{SessionID: sessionID, RequestID: requestID, Message: message, ContextTextPath: item.Context.TextPath, ContextManifest: item.Context.Manifest, PreviousResponseID: item.LastProviderResponseID})
	if err != nil {
		s.bus.Publish(sessionID, "planner.failed", map[string]any{"error": err.Error()})
		return planner.Result{}, item, err
	}
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.LastManualPrompt = result.ManualPrompt
		current.LastRequestID = requestID
		if result.Plan == nil && result.ManualPrompt != "" {
			current.PendingManualRequestIDs = appendPendingManualRequest(current.PendingManualRequestIDs, requestID)
		}
		if result.ProviderResponseID != "" {
			current.LastProviderResponseID = result.ProviderResponseID
		}
		if result.Plan != nil {
			if result.Plan.RequestID != requestID {
				return fmt.Errorf("planner request_id mismatch: expected %s", requestID)
			}
			if err := protocol.Validate(*result.Plan); err != nil {
				return err
			}
			decision := s.policy.Evaluate(*result.Plan)
			current.Plan = result.Plan
			current.Policy = &decision
			current.State = "planned"
			current.LastExecution = nil
		}
		return nil
	})
	if err != nil {
		s.bus.Publish(sessionID, "plan.rejected", map[string]any{"error": err.Error()})
		return planner.Result{}, item, err
	}
	if result.Plan != nil {
		s.bus.Publish(sessionID, "plan.received", map[string]any{"plan_id": result.Plan.PlanID, "allowed": updated.Policy.Allowed, "requires_approval": updated.Policy.RequiresApproval, "risk": updated.Policy.Risk})
	} else {
		s.bus.Publish(sessionID, "manual.prompt_ready", map[string]any{"request_id": requestID})
	}
	return result, updated, nil
}

func (s *Service) SubmitManualPlan(sessionID string, raw []byte) (domain.Session, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return domain.Session{}, err
	}
	plan, err := protocol.NormalizeManualPlan(raw, current.LastRequestID)
	if err != nil {
		return domain.Session{}, fmt.Errorf("decode manual plan: %w", err)
	}
	if err := protocol.Validate(plan); err != nil {
		return domain.Session{}, err
	}
	if !containsString(current.PendingManualRequestIDs, plan.RequestID) {
		return domain.Session{}, fmt.Errorf("manual plan request_id %q is not pending for this chat/session", plan.RequestID)
	}
	decision := s.policy.Evaluate(plan)
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.Plan = &plan
		current.Policy = &decision
		current.State = "planned"
		current.LastExecution = nil
		current.PendingManualRequestIDs = removeString(current.PendingManualRequestIDs, plan.RequestID)
		return nil
	})
	if err == nil {
		s.bus.Publish(sessionID, "plan.received", map[string]any{"plan_id": plan.PlanID, "allowed": decision.Allowed, "requires_approval": decision.RequiresApproval, "risk": decision.Risk})
	}
	return updated, err
}

func (s *Service) Execute(ctx context.Context, sessionID string, approved bool) (domain.ExecutionResult, domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.ExecutionResult{}, item, err
	}
	if item.Plan == nil || item.Policy == nil {
		return domain.ExecutionResult{}, item, errors.New("no plan available")
	}
	if !item.Policy.Allowed {
		return domain.ExecutionResult{}, item, errors.New("policy denied plan")
	}
	unprotected := item.ExecutionMode == domain.ExecutionModeUnprotected
	if (item.Policy.RequiresApproval || unprotected) && !approved {
		return domain.ExecutionResult{}, item, ErrApprovalRequired
	}

	runner := s.runner
	executionTarget := "sandbox"
	if unprotected {
		runner = s.hostRunner
		executionTarget = "host"
		if _, err := projectgit.Ensure(ctx, item.ProjectPath); err != nil {
			return domain.ExecutionResult{}, item, fmt.Errorf("prepare host git repository: %w", err)
		}
	}

	result := domain.ExecutionResult{PlanID: item.Plan.PlanID, StartedAt: time.Now().UTC()}
	s.bus.Publish(sessionID, "execution.started", map[string]any{"plan_id": item.Plan.PlanID, "execution_mode": item.ExecutionMode, "target": executionTarget})
	workspace, err := runner.Prepare(ctx, item.ProjectPath)
	if err != nil {
		return s.failExecution(sessionID, result, err)
	}
	defer runner.Cleanup(workspace)

	for _, op := range item.Plan.Operations {
		if op.Type == "apply_patch" {
			if err := protocol.ValidatePatchPaths(op.Patch); err != nil {
				return s.failExecution(sessionID, result, err)
			}
			s.bus.Publish(sessionID, "patch.started", map[string]any{"target": executionTarget})
			commandResult, runErr := runner.ApplyPatch(ctx, workspace, op.Patch)
			result.Commands = append(result.Commands, commandResult)
			if runErr != nil || !commandResult.Success {
				if runErr == nil {
					runErr = fmt.Errorf("patch failed: %s", strings.TrimSpace(commandResult.Stderr))
				}
				return s.failExecution(sessionID, result, runErr)
			}
			s.bus.Publish(sessionID, "patch.applied", map[string]any{"target": executionTarget})
			continue
		}
		commandResult, runErr := s.runCommandWithRunner(ctx, sessionID, runner, workspace, op.Command, executionTarget)
		result.Commands = append(result.Commands, commandResult)
		if runErr != nil || !commandResult.Success {
			if runErr == nil {
				runErr = fmt.Errorf("command exited with %d", commandResult.ExitCode)
			}
			return s.failExecution(sessionID, result, runErr)
		}
	}
	for _, command := range item.Plan.Verification {
		s.bus.Publish(sessionID, "verification.started", map[string]any{"argv": command.Argv, "target": executionTarget})
		commandResult, runErr := s.runCommandWithRunner(ctx, sessionID, runner, workspace, command, executionTarget)
		result.Commands = append(result.Commands, commandResult)
		if runErr != nil || !commandResult.Success {
			if runErr == nil {
				runErr = fmt.Errorf("verification failed: %s (exit %d): %s", strings.Join(command.Argv, " "), commandResult.ExitCode, commandResultDiagnostic(commandResult))
			}
			return s.failExecution(sessionID, result, runErr)
		}
		s.bus.Publish(sessionID, "verification.completed", map[string]any{"exit_code": commandResult.ExitCode, "target": executionTarget})
	}
	result.Success = true
	result.CompletedAt = time.Now().UTC()
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.LastExecution = &result
		if unprotected {
			current.State = "applied"
		} else {
			current.State = "verified"
		}
		return nil
	})
	if err != nil {
		return result, item, err
	}
	if unprotected {
		s.resetDevspace(sessionID)
		if refreshed, refreshErr := s.refreshContext(sessionID); refreshErr == nil {
			updated = refreshed
		}
	}
	s.bus.Publish(sessionID, "execution.completed", map[string]any{"success": true, "execution_mode": item.ExecutionMode, "target": executionTarget})
	return result, updated, nil
}

func (s *Service) runCommand(ctx context.Context, sessionID string, workspace sandbox.Workspace, command domain.CommandSpec) (domain.CommandResult, error) {
	return s.runCommandWithRunner(ctx, sessionID, s.runner, workspace, command, "sandbox")
}

func appendPendingManualRequest(values []string, requestID string) []string {
	const maxPending = 32
	values = removeString(values, requestID)
	values = append(values, requestID)
	if len(values) > maxPending {
		values = append([]string(nil), values[len(values)-maxPending:]...)
	}
	return values
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func removeString(values []string, target string) []string {
	out := values[:0]
	for _, value := range values {
		if value != target {
			out = append(out, value)
		}
	}
	return out
}

func commandResultDiagnostic(result domain.CommandResult) string {
	if text := strings.TrimSpace(result.Stderr); text != "" {
		return text
	}
	if text := strings.TrimSpace(result.Stdout); text != "" {
		return text
	}
	return "no stdout/stderr"
}

func (s *Service) runCommandWithRunner(ctx context.Context, sessionID string, runner sandbox.Runner, workspace sandbox.Workspace, command domain.CommandSpec, target string) (domain.CommandResult, error) {
	s.bus.Publish(sessionID, "command.started", map[string]any{"argv": command.Argv, "cwd": command.Cwd, "network": command.Network, "target": target})
	result, err := runner.Run(ctx, workspace, command)
	s.bus.Publish(sessionID, "command.completed", map[string]any{"argv": command.Argv, "exit_code": result.ExitCode, "success": result.Success, "stdout": result.Stdout, "stderr": result.Stderr, "target": target})
	return result, err
}

func (s *Service) failExecution(sessionID string, result domain.ExecutionResult, cause error) (domain.ExecutionResult, domain.Session, error) {
	result.Success = false
	result.Error = cause.Error()
	result.CompletedAt = time.Now().UTC()
	updated, _ := s.store.Update(sessionID, func(current *domain.Session) error {
		current.LastExecution = &result
		current.State = "failed"
		return nil
	})
	if updated.ExecutionMode == domain.ExecutionModeUnprotected {
		s.resetDevspace(sessionID)
		if refreshed, err := s.refreshContext(sessionID); err == nil {
			updated = refreshed
		}
	}
	s.bus.Publish(sessionID, "execution.failed", map[string]any{"error": cause.Error(), "execution_mode": updated.ExecutionMode})
	return result, updated, cause
}

func (s *Service) ApplyToHost(ctx context.Context, sessionID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	if item.ExecutionMode == domain.ExecutionModeUnprotected {
		return item, errors.New("apply is unavailable in unprotected mode because execution already targets the host")
	}
	initialized, err := projectgit.Ensure(ctx, item.ProjectPath)
	if err != nil {
		return item, fmt.Errorf("prepare project git repository before host apply: %w", err)
	}
	if initialized {
		s.bus.Publish(sessionID, "project.git_initialized", map[string]any{"project_path": item.ProjectPath, "reason": "host_apply"})
	}
	if item.Plan == nil || item.LastExecution == nil || !item.LastExecution.Success || item.LastExecution.PlanID != item.Plan.PlanID {
		return item, ErrExecutionRequired
	}
	workspace, err := s.hostRunner.Prepare(ctx, item.ProjectPath)
	if err != nil {
		return item, err
	}
	defer s.hostRunner.Cleanup(workspace)
	for _, op := range item.Plan.Operations {
		if op.Type != "apply_patch" {
			continue
		}
		if err := protocol.ValidatePatchPaths(op.Patch); err != nil {
			return item, err
		}
		if result, err := s.hostRunner.ApplyPatch(ctx, workspace, op.Patch); err != nil || !result.Success {
			if err != nil {
				return item, fmt.Errorf("host apply failed: %w", err)
			}
			return item, fmt.Errorf("host apply failed: %s", strings.TrimSpace(result.Stderr))
		}
	}
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error { current.State = "applied"; return nil })
	if err == nil {
		s.resetDevspace(sessionID)
		s.bus.Publish(sessionID, "host.applied", map[string]any{"plan_id": item.Plan.PlanID})
	}
	return updated, err
}

func (s *Service) ListFiles(sessionID string) ([]workspacefs.Entry, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return nil, err
	}
	return workspacefs.List(item.ProjectPath)
}

func (s *Service) ReadFile(sessionID, path string) (workspacefs.File, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return workspacefs.File{}, err
	}
	return workspacefs.Read(item.ProjectPath, path)
}

func (s *Service) WriteFile(sessionID, path, content, expectedSHA string) (workspacefs.File, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return workspacefs.File{}, err
	}
	file, err := workspacefs.Write(item.ProjectPath, path, content, expectedSHA)
	if err != nil {
		return workspacefs.File{}, err
	}
	if workspace, ok := s.devspace(sessionID); ok {
		_, _ = workspacefs.Write(workspace.Path, path, content, "")
	}
	s.bus.Publish(sessionID, "editor.file_saved", map[string]any{"path": path, "sha256": file.SHA256})
	return file, nil
}

func (s *Service) RunTerminal(ctx context.Context, sessionID string, command domain.CommandSpec) (domain.CommandResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.CommandResult{}, err
	}
	if command.Cwd == "" {
		command.Cwd = "."
	}
	if command.TimeoutSeconds == 0 {
		command.TimeoutSeconds = 300
	}
	if len(command.ExpectedExitCodes) == 0 {
		command.ExpectedExitCodes = []int{0}
	}
	plan := domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: ids.New("terminal"), RequestID: ids.New("terminal_req"), Status: "ready", Summary: "interactive terminal command", Risk: "low", Operations: []domain.Operation{{Type: "command", Command: command}}}
	decision := s.policy.Evaluate(plan)
	if !decision.Allowed {
		return domain.CommandResult{}, fmt.Errorf("terminal policy denied command: %s", strings.Join(decision.Reasons, "; "))
	}
	workspace, err := s.ensureDevspace(ctx, sessionID, item.ProjectPath)
	if err != nil {
		return domain.CommandResult{}, err
	}
	s.bus.Publish(sessionID, "terminal.command_started", map[string]any{"argv": command.Argv, "cwd": command.Cwd, "network": command.Network})
	result, err := s.runner.Run(ctx, workspace, command)
	s.bus.Publish(sessionID, "terminal.command_completed", map[string]any{"argv": command.Argv, "cwd": command.Cwd, "exit_code": result.ExitCode, "success": result.Success, "stdout": result.Stdout, "stderr": result.Stderr})
	return result, err
}

func (s *Service) ResetTerminal(ctx context.Context, sessionID string) error {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return err
	}
	s.resetDevspace(sessionID)
	_, err = s.ensureDevspace(ctx, sessionID, item.ProjectPath)
	if err == nil {
		s.bus.Publish(sessionID, "terminal.reset", map[string]any{})
	}
	return err
}

func (s *Service) RefreshContext(sessionID string) (domain.Session, error) {
	return s.refreshContext(sessionID)
}

func (s *Service) refreshContext(sessionID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.Session{}, err
	}
	bundle, err := s.context.Build(item.ProjectPath)
	if err != nil {
		return domain.Session{}, fmt.Errorf("refresh project context: %w", err)
	}
	oldDir := filepath.Dir(item.Context.ZipPath)
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error { current.Context = bundle; return nil })
	if err != nil {
		return domain.Session{}, err
	}
	if oldDir != "" && oldDir != "." && oldDir != filepath.Dir(bundle.ZipPath) {
		_ = os.RemoveAll(oldDir)
	}
	s.bus.Publish(sessionID, "context.refreshed", map[string]any{"files": len(bundle.Manifest.Files), "snapshot": bundle.Manifest.SHA256})
	return updated, nil
}

func (s *Service) ensureDevspace(ctx context.Context, sessionID, projectPath string) (sandbox.Workspace, error) {
	s.devMu.Lock()
	defer s.devMu.Unlock()
	if workspace, ok := s.devspaces[sessionID]; ok {
		return workspace, nil
	}
	workspace, err := s.runner.Prepare(ctx, projectPath)
	if err != nil {
		return sandbox.Workspace{}, err
	}
	s.devspaces[sessionID] = workspace
	return workspace, nil
}

func (s *Service) devspace(sessionID string) (sandbox.Workspace, bool) {
	s.devMu.Lock()
	defer s.devMu.Unlock()
	workspace, ok := s.devspaces[sessionID]
	return workspace, ok
}

func (s *Service) resetDevspace(sessionID string) {
	s.devMu.Lock()
	workspace, ok := s.devspaces[sessionID]
	if ok {
		delete(s.devspaces, sessionID)
	}
	s.devMu.Unlock()
	if ok {
		_ = s.runner.Cleanup(workspace)
	}
}
