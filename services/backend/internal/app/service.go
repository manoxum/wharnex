package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/executionbundle"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/projectconfig"
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

type BundleSubmission struct {
	Session        domain.Session          `json:"session"`
	AutoExecuted   bool                    `json:"auto_executed"`
	AutoApplied    bool                    `json:"auto_applied"`
	AutoError      string                  `json:"auto_error,omitempty"`
	Execution      *domain.ExecutionResult `json:"execution,omitempty"`
	PolicyBlocked  bool                    `json:"policy_blocked,omitempty"`
	PolicyReasons  []string                `json:"policy_reasons,omitempty"`
	RepairPrepared bool                    `json:"repair_prepared,omitempty"`
}

const maxAutoRepairAttempts = 3

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
	mode := domain.ExecutionModeProtected
	if len(requestedMode) > 0 && requestedMode[0] != "" {
		mode = requestedMode[0]
	}
	automationMode := domain.AutomationModeAuto
	if mode == domain.ExecutionModeUnprotected {
		automationMode = domain.AutomationModeManual
	}
	return s.StartSessionWithModes(ctx, projectPath, mode, automationMode)
}

func (s *Service) CreateProject(ctx context.Context, parentPath, name string) (string, error) {
	root, err := projectgit.Create(ctx, parentPath, name)
	if err != nil {
		return "", err
	}
	if _, _, err := projectconfig.Ensure(root); err != nil {
		_ = os.RemoveAll(root)
		return "", fmt.Errorf("create %s: %w", projectconfig.FileName, err)
	}
	return root, nil
}

func (s *Service) CloneProject(ctx context.Context, repository, parentPath, directory string) (string, error) {
	root, err := projectgit.Clone(ctx, repository, parentPath, directory)
	if err != nil {
		return "", err
	}
	if _, _, err := projectconfig.Ensure(root); err != nil {
		return "", fmt.Errorf("create %s after clone: %w", projectconfig.FileName, err)
	}
	return root, nil
}

func (s *Service) ProjectConfig(sessionID string) (projectconfig.Config, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return projectconfig.Config{}, err
	}
	cfg, created, err := projectconfig.Ensure(item.ProjectPath)
	if err != nil {
		return projectconfig.Config{}, err
	}
	if created {
		s.bus.Publish(sessionID, "project.config_repaired", map[string]any{"config_file": projectconfig.FileName})
		if _, refreshErr := s.refreshContext(sessionID); refreshErr != nil {
			s.bus.Publish(sessionID, "context.refresh_failed", map[string]any{"error": refreshErr.Error(), "reason": "project_config_repair"})
		}
	}
	return cfg, nil
}

func (s *Service) UpdateProjectConfig(sessionID string, cfg projectconfig.Config) (projectconfig.Config, domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return projectconfig.Config{}, domain.Session{}, err
	}
	if err := projectconfig.Save(item.ProjectPath, cfg); err != nil {
		return projectconfig.Config{}, item, err
	}
	stored, err := projectconfig.Load(item.ProjectPath)
	if err != nil {
		return projectconfig.Config{}, item, err
	}
	updated, err := s.refreshContext(sessionID)
	if err != nil {
		return stored, item, fmt.Errorf("%s saved but context rebuild failed: %w", projectconfig.FileName, err)
	}
	s.bus.Publish(sessionID, "project.config_updated", map[string]any{"config_file": projectconfig.FileName, "include": len(stored.Context.Include), "exclude": len(stored.Context.Exclude), "auto_exclude": stored.Context.AutoExclude})
	return stored, updated, nil
}

func (s *Service) StartSessionWithModes(ctx context.Context, projectPath string, executionMode domain.ExecutionMode, automationMode domain.AutomationMode) (domain.Session, error) {
	id := ids.New("ses")
	if executionMode == "" {
		executionMode = domain.ExecutionModeProtected
	}
	if automationMode == "" {
		automationMode = domain.AutomationModeAuto
	}
	if !domain.ValidExecutionMode(executionMode) {
		return domain.Session{}, fmt.Errorf("unsupported execution mode %q", executionMode)
	}
	if !domain.ValidAutomationMode(automationMode) {
		return domain.Session{}, fmt.Errorf("unsupported automation mode %q", automationMode)
	}
	if automationMode == domain.AutomationModeAuto && executionMode != domain.ExecutionModeProtected {
		return domain.Session{}, errors.New("auto mode requires protected execution mode")
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
	_, configCreated, err := projectconfig.Ensure(projectPath)
	if err != nil {
		return domain.Session{}, fmt.Errorf("prepare project configuration: %w", err)
	}
	s.bus.Publish(id, "project.config_ready", map[string]any{"config_file": projectconfig.FileName, "created": configCreated})
	s.bus.Publish(id, "context.scanning", map[string]any{"project_path": projectPath})
	bundle, err := s.context.Build(projectPath)
	if err != nil {
		s.bus.Publish(id, "context.failed", map[string]any{"error": err.Error()})
		return domain.Session{}, err
	}
	item := domain.Session{ID: id, ProjectPath: bundle.Manifest.ProjectRoot, ExecutionMode: executionMode, AutomationMode: automationMode, State: "ready", CreatedAt: time.Now().UTC(), Context: bundle}
	if err := s.store.Put(item); err != nil {
		return domain.Session{}, fmt.Errorf("persist session: %w", err)
	}
	s.bus.Publish(id, "session.created", map[string]any{"files": len(bundle.Manifest.Files), "snapshot": bundle.Manifest.SHA256, "text_truncated": bundle.Manifest.TextTruncated, "execution_mode": executionMode, "automation_mode": automationMode})
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
		if mode == domain.ExecutionModeUnprotected && current.AutomationMode == domain.AutomationModeAuto {
			return errors.New("disable auto mode before switching to unprotected")
		}
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

func (s *Service) SetAutomationMode(sessionID string, mode domain.AutomationMode) (domain.Session, error) {
	if !domain.ValidAutomationMode(mode) {
		return domain.Session{}, fmt.Errorf("unsupported automation mode %q", mode)
	}
	item, err := s.store.Update(sessionID, func(current *domain.Session) error {
		if mode == domain.AutomationModeAuto && current.ExecutionMode != domain.ExecutionModeProtected {
			return errors.New("auto mode requires protected execution mode")
		}
		current.AutomationMode = mode
		return nil
	})
	if err != nil {
		return domain.Session{}, err
	}
	s.bus.Publish(sessionID, "automation.mode_changed", map[string]any{"automation_mode": mode})
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
	normalizePlanCollections(result.Plan)
	if result.Turn == nil && result.Plan != nil {
		result.Turn = &domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: requestID, Kind: domain.TurnKindChange, Message: result.Plan.Summary}
	}
	if result.Turn != nil {
		if result.Turn.RequestID != requestID {
			return planner.Result{}, item, fmt.Errorf("turn request_id mismatch: expected %s", requestID)
		}
		if err := protocol.ValidateTurn(*result.Turn); err != nil {
			return planner.Result{}, item, err
		}
		if result.Turn.Kind == domain.TurnKindChange && result.Plan == nil {
			return planner.Result{}, item, errors.New("change turn requires an execution plan")
		}
		if result.Turn.Kind != domain.TurnKindChange && result.Plan != nil {
			return planner.Result{}, item, errors.New("non-change turn cannot contain an execution plan")
		}
	}
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.LastManualPrompt = result.ManualPrompt
		current.LastRequestID = requestID
		current.RepairAttempt = 0
		current.RepairParentPlanID = ""
		current.LastRepairError = ""
		current.LastTurn = result.Turn
		if result.Plan == nil && result.ManualPrompt != "" {
			current.PendingManualRequestIDs = []string{requestID}
			current.Plan = nil
			current.Policy = nil
			current.LastExecution = nil
			current.LastBundle = nil
			current.State = "awaiting_plan"
		}
		if result.ProviderResponseID != "" {
			current.LastProviderResponseID = result.ProviderResponseID
		}
		if result.Plan != nil {
			current.LastBundle = nil
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
		} else if result.Turn != nil {
			current.Plan = nil
			current.Policy = nil
			current.LastExecution = nil
			current.LastBundle = nil
			current.State = turnState(result.Turn.Kind)
		}
		return nil
	})
	if err != nil {
		s.bus.Publish(sessionID, "plan.rejected", map[string]any{"error": err.Error()})
		return planner.Result{}, item, err
	}
	if result.Plan != nil {
		s.bus.Publish(sessionID, "plan.received", map[string]any{"plan_id": result.Plan.PlanID, "allowed": updated.Policy.Allowed, "requires_approval": updated.Policy.RequiresApproval, "risk": updated.Policy.Risk})
	} else if result.ManualPrompt != "" {
		s.bus.Publish(sessionID, "manual.prompt_ready", map[string]any{"request_id": requestID})
	} else if result.Turn != nil {
		s.bus.Publish(sessionID, "turn.received", map[string]any{"request_id": requestID, "kind": result.Turn.Kind, "transport": "provider"})
	}
	if result.Plan != nil && updated.AutomationMode == domain.AutomationModeAuto && updated.Policy != nil && result.Plan.Status == "ready" {
		if updated.Policy.Allowed {
			automated := s.runAutomaticPlan(ctx, sessionID, "provider")
			updated = automated.Session
		} else {
			repaired, repairErr := s.preparePolicyRepairRequest(ctx, sessionID, result.Plan.PlanID, updated.Policy.Reasons, "provider")
			if repairErr != nil {
				s.bus.Publish(sessionID, "repair.prepare_failed", map[string]any{"error": repairErr.Error(), "reason": "policy_blocked"})
			} else {
				updated = repaired
			}
		}
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
	normalizePlanCollections(&plan)
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
		current.LastBundle = nil
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

func (s *Service) SubmitExecutionBundle(ctx context.Context, sessionID, filename string, raw []byte) (BundleSubmission, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return BundleSubmission{}, err
	}
	parsed, err := executionbundle.Parse(filename, raw)
	if err != nil {
		return BundleSubmission{}, err
	}
	normalizePlanCollections(parsed.Plan)
	filenameRequestID := bundleFilenameRequestID(filename)
	if filenameRequestID == "" || filenameRequestID != parsed.Turn.RequestID {
		return BundleSubmission{}, errors.New("execution bundle filename/request_id mismatch")
	}
	if !containsString(current.PendingManualRequestIDs, parsed.Turn.RequestID) {
		return BundleSubmission{}, fmt.Errorf("bundle request_id %q is not pending for this chat/session", parsed.Turn.RequestID)
	}
	if parsed.Plan == nil {
		updated, updateErr := s.store.Update(sessionID, func(item *domain.Session) error {
			turn := parsed.Turn
			item.LastTurn = &turn
			item.Plan = nil
			item.Policy = nil
			item.LastExecution = nil
			item.LastBundle = &parsed.Info
			item.State = turnState(turn.Kind)
			item.PendingManualRequestIDs = removeString(item.PendingManualRequestIDs, turn.RequestID)
			return nil
		})
		if updateErr != nil {
			return BundleSubmission{}, updateErr
		}
		s.bus.Publish(sessionID, "turn.received", map[string]any{"request_id": parsed.Turn.RequestID, "kind": parsed.Turn.Kind, "transport": "zip_bundle"})
		return BundleSubmission{Session: updated}, nil
	}
	if err := protocol.Validate(*parsed.Plan); err != nil {
		return BundleSubmission{}, err
	}
	decision := s.policy.Evaluate(*parsed.Plan)
	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		turn := parsed.Turn
		item.LastTurn = &turn
		item.Plan = parsed.Plan
		item.Policy = &decision
		item.LastBundle = &parsed.Info
		item.State = "planned"
		item.LastExecution = nil
		item.PendingManualRequestIDs = removeString(item.PendingManualRequestIDs, parsed.Plan.RequestID)
		return nil
	})
	if err != nil {
		return BundleSubmission{}, err
	}
	s.bus.Publish(sessionID, "bundle.received", map[string]any{"filename": parsed.Info.Filename, "files": len(parsed.Info.Files), "patches": len(parsed.Info.Patches), "sha256": parsed.Info.SHA256})
	s.bus.Publish(sessionID, "plan.received", map[string]any{"plan_id": parsed.Plan.PlanID, "allowed": decision.Allowed, "requires_approval": decision.RequiresApproval, "risk": decision.Risk, "transport": "zip_bundle"})

	submission := BundleSubmission{Session: updated}
	if updated.AutomationMode == domain.AutomationModeAuto && !decision.Allowed && parsed.Plan.Status == "ready" {
		submission.PolicyBlocked = true
		submission.PolicyReasons = append([]string(nil), decision.Reasons...)
		repaired, repairErr := s.preparePolicyRepairRequest(ctx, sessionID, parsed.Plan.PlanID, decision.Reasons, "zip_bundle")
		if repairErr != nil {
			submission.AutoError = repairErr.Error()
			s.bus.Publish(sessionID, "repair.prepare_failed", map[string]any{"error": repairErr.Error(), "reason": "policy_blocked"})
			return submission, nil
		}
		submission.Session = repaired
		submission.RepairPrepared = repaired.State == "repair_pending" && repaired.LastManualPrompt != ""
		return submission, nil
	}
	if updated.AutomationMode != domain.AutomationModeAuto || !decision.Allowed || parsed.Plan.Status != "ready" {
		return submission, nil
	}
	if updated.ExecutionMode != domain.ExecutionModeProtected {
		submission.AutoError = "auto mode requires protected execution mode"
		return submission, nil
	}

	return s.runAutomaticPlan(ctx, sessionID, "zip_bundle"), nil
}

func (s *Service) preparePolicyRepairRequest(ctx context.Context, sessionID, planID string, reasons []string, transport string) (domain.Session, error) {
	detail := strings.Join(reasons, "; ")
	if strings.TrimSpace(detail) == "" {
		detail = "policy denied the execution plan"
	}
	s.bus.Publish(sessionID, "automation.policy_blocked", map[string]any{
		"plan_id": planID, "transport": transport, "reasons": append([]string(nil), reasons...), "error": detail,
	})
	result := domain.ExecutionResult{PlanID: planID, Success: false, Error: "policy denied plan: " + detail, StartedAt: time.Now().UTC(), CompletedAt: time.Now().UTC()}
	return s.prepareRepairRequest(ctx, sessionID, result, errors.New(result.Error))
}

func (s *Service) runAutomaticPlan(ctx context.Context, sessionID, transport string) BundleSubmission {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return BundleSubmission{Session: current, AutoError: err.Error()}
	}
	result := BundleSubmission{Session: current}
	for attempt := 0; attempt <= maxAutoRepairAttempts; attempt++ {
		if current.Plan == nil || current.Policy == nil || !current.Policy.Allowed || current.Plan.Status != "ready" {
			return result
		}
		planID := current.Plan.PlanID
		s.bus.Publish(sessionID, "automation.started", map[string]any{"plan_id": planID, "transport": transport, "attempt": attempt + 1})
		execution, executed, execErr := s.Execute(ctx, sessionID, true)
		result.AutoExecuted = true
		result.Execution = &execution
		result.Session = executed
		if execErr != nil {
			current = executed
			if executed.State == "planned" && executed.Plan != nil && executed.Plan.PlanID != planID {
				continue
			}
			result.AutoError = execErr.Error()
			s.bus.Publish(sessionID, "automation.execution_failed", map[string]any{"error": execErr.Error(), "repair_pending": executed.State == "repair_pending"})
			return result
		}
		applied, applyErr := s.ApplyToHost(ctx, sessionID)
		if applyErr != nil {
			result.AutoError = applyErr.Error()
			result.Session = executed
			s.bus.Publish(sessionID, "automation.apply_failed", map[string]any{"error": applyErr.Error()})
			return result
		}
		result.AutoApplied = true
		result.Session = applied
		s.bus.Publish(sessionID, "automation.completed", map[string]any{"plan_id": planID, "applied": true, "transport": transport})
		return result
	}
	return result
}

func turnState(kind domain.TurnKind) string {
	switch kind {
	case domain.TurnKindAnswer:
		return "answered"
	case domain.TurnKindClarification:
		return "awaiting_clarification"
	case domain.TurnKindInvestigation:
		return "investigated"
	case domain.TurnKindBlocked:
		return "blocked"
	default:
		return "planned"
	}
}

func normalizePlanCollections(plan *domain.ExecutionPlan) {
	if plan == nil {
		return
	}
	if plan.Operations == nil {
		plan.Operations = make([]domain.Operation, 0)
	}
	if plan.Verification == nil {
		plan.Verification = make([]domain.CommandSpec, 0)
	}
}

func bundleFilenameRequestID(filename string) string {
	base := filepath.Base(strings.TrimSpace(filename))
	match := regexp.MustCompile(`^wharness-bundle-(req_[A-Za-z0-9_-]{8,180})\.zip$`).FindStringSubmatch(base)
	if len(match) != 2 {
		return ""
	}
	return match[1]
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
		return s.failExecution(ctx, sessionID, result, err)
	}
	defer runner.Cleanup(workspace)

	for _, op := range item.Plan.Operations {
		if op.Type == "apply_patch" {
			if err := protocol.ValidatePatchPaths(op.Patch); err != nil {
				return s.failExecution(ctx, sessionID, result, err)
			}
			s.bus.Publish(sessionID, "patch.started", map[string]any{"target": executionTarget})
			commandResult, runErr := runner.ApplyPatch(ctx, workspace, op.Patch)
			result.Commands = append(result.Commands, commandResult)
			if runErr != nil || !commandResult.Success {
				if runErr == nil {
					runErr = fmt.Errorf("patch failed: %s", strings.TrimSpace(commandResult.Stderr))
				}
				return s.failExecution(ctx, sessionID, result, runErr)
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
			return s.failExecution(ctx, sessionID, result, runErr)
		}
	}
	var baselineWorkspace *sandbox.Workspace
	defer func() {
		if baselineWorkspace != nil {
			_ = runner.Cleanup(*baselineWorkspace)
		}
	}()
	for _, command := range item.Plan.Verification {
		s.bus.Publish(sessionID, "verification.started", map[string]any{"argv": command.Argv, "target": executionTarget})
		commandResult, runErr := s.runCommandWithRunner(ctx, sessionID, runner, workspace, command, executionTarget)
		if runErr == nil && !commandResult.Success && !unprotected {
			baselineResult, unchanged, baselineErr := s.compareVerificationBaseline(ctx, runner, &baselineWorkspace, item.ProjectPath, command, commandResult)
			if baselineErr == nil && unchanged {
				commandResult.BaselineFailure = true
				commandResult.BaselineExitCode = baselineResult.ExitCode
				commandResult.BaselineOutput = commandResultDiagnostic(baselineResult)
				commandResult.Success = true
				warning := fmt.Sprintf("pre-existing verification failure unchanged: %s (exit %d)", strings.Join(command.Argv, " "), baselineResult.ExitCode)
				result.Warnings = append(result.Warnings, warning)
				s.bus.Publish(sessionID, "verification.baseline_unchanged", map[string]any{"argv": command.Argv, "exit_code": baselineResult.ExitCode, "diagnostic": commandResultDiagnostic(baselineResult)})
			} else if baselineErr == nil && !baselineResult.Success {
				s.bus.Publish(sessionID, "verification.baseline_changed", map[string]any{
					"argv":                command.Argv,
					"baseline_exit_code":  baselineResult.ExitCode,
					"post_exit_code":      commandResult.ExitCode,
					"baseline_diagnostic": commandResultDiagnostic(baselineResult),
					"post_diagnostic":     commandResultDiagnostic(commandResult),
				})
			}
		}
		result.Commands = append(result.Commands, commandResult)
		if runErr != nil || !commandResult.Success {
			if runErr == nil {
				runErr = fmt.Errorf("verification failed: %s (exit %d): %s", strings.Join(command.Argv, " "), commandResult.ExitCode, commandResultDiagnostic(commandResult))
			}
			return s.failExecution(ctx, sessionID, result, runErr)
		}
		s.bus.Publish(sessionID, "verification.completed", map[string]any{"exit_code": commandResult.ExitCode, "target": executionTarget, "baseline_failure": commandResult.BaselineFailure})
	}
	result.Success = true
	result.CompletedAt = time.Now().UTC()
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.LastExecution = &result
		current.RepairAttempt = 0
		current.RepairParentPlanID = ""
		current.LastRepairError = ""
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

func (s *Service) compareVerificationBaseline(ctx context.Context, runner sandbox.Runner, workspace **sandbox.Workspace, projectPath string, command domain.CommandSpec, post domain.CommandResult) (domain.CommandResult, bool, error) {
	if *workspace == nil {
		prepared, err := runner.Prepare(ctx, projectPath)
		if err != nil {
			return domain.CommandResult{}, false, fmt.Errorf("prepare verification baseline: %w", err)
		}
		*workspace = &prepared
	}
	baseline, err := runner.Run(ctx, **workspace, command)
	if err != nil {
		return baseline, false, err
	}
	if baseline.Success || baseline.ExitCode != post.ExitCode {
		return baseline, false, nil
	}
	return baseline, verificationFailureEquivalent(baseline, post), nil
}

func normalizedVerificationOutput(result domain.CommandResult) string {
	stdout := strings.ReplaceAll(strings.TrimSpace(result.Stdout), "\r\n", "\n")
	stderr := strings.ReplaceAll(strings.TrimSpace(result.Stderr), "\r\n", "\n")
	return fmt.Sprintf("stdout:\n%s\nstderr:\n%s", stdout, stderr)
}

var typescriptDiagnosticPattern = regexp.MustCompile(`(?m)^(.+?)\(\d+,\d+\):\s+error\s+(TS\d+):\s+(.+?)\s*$`)

// verificationFailureEquivalent first preserves the original strict byte-level
// comparison. If that differs, it falls back only to structured diagnostics we
// understand. This avoids treating harmless npm/path formatting differences as
// a regression while still rejecting any new TypeScript error introduced by a
// plan.
func verificationFailureEquivalent(baseline, post domain.CommandResult) bool {
	if normalizedVerificationOutput(baseline) == normalizedVerificationOutput(post) {
		return true
	}
	baselineDiagnostics := typescriptDiagnosticFingerprints(baseline)
	postDiagnostics := typescriptDiagnosticFingerprints(post)
	if len(baselineDiagnostics) == 0 || len(postDiagnostics) == 0 {
		return false
	}
	for diagnostic := range postDiagnostics {
		if _, ok := baselineDiagnostics[diagnostic]; !ok {
			return false
		}
	}
	return true
}

func typescriptDiagnosticFingerprints(result domain.CommandResult) map[string]struct{} {
	combined := strings.ReplaceAll(result.Stdout+"\n"+result.Stderr, "\r\n", "\n")
	matches := typescriptDiagnosticPattern.FindAllStringSubmatch(combined, -1)
	out := make(map[string]struct{}, len(matches))
	for _, match := range matches {
		if len(match) != 4 {
			continue
		}
		path := strings.TrimSpace(strings.ReplaceAll(match[1], "\\", "/"))
		code := strings.TrimSpace(match[2])
		message := strings.Join(strings.Fields(match[3]), " ")
		out[path+"|"+code+"|"+message] = struct{}{}
	}
	return out
}

func (s *Service) runCommandWithRunner(ctx context.Context, sessionID string, runner sandbox.Runner, workspace sandbox.Workspace, command domain.CommandSpec, target string) (domain.CommandResult, error) {
	s.bus.Publish(sessionID, "command.started", map[string]any{"argv": command.Argv, "cwd": command.Cwd, "network": command.Network, "target": target})
	result, err := runner.Run(ctx, workspace, command)
	s.bus.Publish(sessionID, "command.completed", map[string]any{"argv": command.Argv, "exit_code": result.ExitCode, "success": result.Success, "stdout": result.Stdout, "stderr": result.Stderr, "target": target})
	return result, err
}

func (s *Service) failExecution(ctx context.Context, sessionID string, result domain.ExecutionResult, cause error) (domain.ExecutionResult, domain.Session, error) {
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
	}

	// A failed plan becomes the input of a bounded repair loop. The planner
	// creates a fresh request_id and file-first delivery prompt; Desktop is
	// responsible only for submitting that prompt to the already-linked ChatGPT
	// conversation. New plans are never auto-approved or auto-executed here.
	if repaired, repairErr := s.prepareRepairRequest(ctx, sessionID, result, cause); repairErr == nil {
		updated = repaired
	} else {
		s.bus.Publish(sessionID, "repair.prepare_failed", map[string]any{"error": repairErr.Error()})
	}

	s.bus.Publish(sessionID, "execution.failed", map[string]any{"error": cause.Error(), "execution_mode": updated.ExecutionMode, "repair_pending": updated.State == "repair_pending", "repair_attempt": updated.RepairAttempt})
	return result, updated, cause
}

func (s *Service) prepareRepairRequest(ctx context.Context, sessionID string, result domain.ExecutionResult, cause error) (domain.Session, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return current, err
	}
	if current.RepairAttempt >= maxAutoRepairAttempts {
		s.bus.Publish(sessionID, "repair.exhausted", map[string]any{"attempts": current.RepairAttempt, "plan_id": result.PlanID})
		return current, nil
	}

	refreshed, err := s.refreshContext(sessionID)
	if err != nil {
		return current, fmt.Errorf("refresh context for repair: %w", err)
	}
	requestID := ids.New("req")
	attempt := refreshed.RepairAttempt + 1
	repairMessage := buildRepairMessage(refreshed, result, cause, attempt)
	s.bus.Publish(sessionID, "repair.started", map[string]any{"request_id": requestID, "attempt": attempt, "failed_plan_id": result.PlanID})

	planned, err := s.planner.Plan(ctx, planner.Request{
		SessionID:          sessionID,
		RequestID:          requestID,
		Message:            repairMessage,
		ContextTextPath:    refreshed.Context.TextPath,
		ContextManifest:    refreshed.Context.Manifest,
		PreviousResponseID: refreshed.LastProviderResponseID,
	})
	if err != nil {
		return refreshed, fmt.Errorf("prepare repair planner request: %w", err)
	}
	normalizePlanCollections(planned.Plan)
	if planned.Turn == nil && planned.Plan != nil {
		planned.Turn = &domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: requestID, Kind: domain.TurnKindChange, Message: planned.Plan.Summary}
	}
	if planned.Turn != nil {
		if planned.Turn.RequestID != requestID {
			return refreshed, fmt.Errorf("repair turn request_id mismatch: expected %s", requestID)
		}
		if err := protocol.ValidateTurn(*planned.Turn); err != nil {
			return refreshed, err
		}
		if planned.Turn.Kind == domain.TurnKindChange && planned.Plan == nil {
			return refreshed, errors.New("repair change turn requires an execution plan")
		}
		if planned.Turn.Kind != domain.TurnKindChange && planned.Plan != nil {
			return refreshed, errors.New("repair non-change turn cannot contain an execution plan")
		}
	}

	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		item.LastRequestID = requestID
		item.LastManualPrompt = planned.ManualPrompt
		item.LastRepairError = cause.Error()
		item.RepairAttempt = attempt
		item.LastTurn = planned.Turn
		if item.RepairParentPlanID == "" {
			item.RepairParentPlanID = result.PlanID
		}
		if planned.ProviderResponseID != "" {
			item.LastProviderResponseID = planned.ProviderResponseID
		}
		if planned.Plan == nil && planned.ManualPrompt != "" {
			item.PendingManualRequestIDs = []string{requestID}
			item.State = "repair_pending"
			return nil
		}
		if planned.Plan == nil && planned.Turn != nil {
			item.PendingManualRequestIDs = nil
			item.Plan = nil
			item.Policy = nil
			item.State = turnState(planned.Turn.Kind)
			return nil
		}
		if planned.Plan.RequestID != requestID {
			return fmt.Errorf("repair planner request_id mismatch: expected %s", requestID)
		}
		if err := protocol.Validate(*planned.Plan); err != nil {
			return err
		}
		decision := s.policy.Evaluate(*planned.Plan)
		item.Plan = planned.Plan
		item.Policy = &decision
		item.State = "planned"
		item.LastExecution = nil
		return nil
	})
	if err != nil {
		return refreshed, err
	}
	if planned.Plan == nil {
		s.bus.Publish(sessionID, "repair.prompt_ready", map[string]any{"request_id": requestID, "attempt": attempt, "failed_plan_id": result.PlanID})
	} else {
		s.bus.Publish(sessionID, "repair.plan_ready", map[string]any{"request_id": requestID, "attempt": attempt, "plan_id": planned.Plan.PlanID})
	}
	return updated, nil
}

func buildRepairMessage(item domain.Session, result domain.ExecutionResult, cause error, attempt int) string {
	if strings.HasPrefix(cause.Error(), "policy denied plan:") {
		return fmt.Sprintf(`AUTOMATIC POLICY REPAIR REQUEST — attempt %d of %d

The previous execution bundle was rejected by the Wharness Policy Engine BEFORE any operation was executed.
Do not ask to relax, bypass, disable, or work around the Policy Engine. Produce a replacement plan for the SAME user intent using only operations and verification commands that are permitted by Wharness policy.

BLOCKED PLAN ID: %s
POLICY REASONS:
%s

Use the current Wharness project context as authoritative. Replace denied commands with safe project-local alternatives where possible. Return the corrected plan through the normal Wharness file-first delivery contract.`, attempt, maxAutoRepairAttempts, result.PlanID, truncateRepairText(strings.TrimPrefix(cause.Error(), "policy denied plan:"), 12000))
	}
	modeNote := "The failed Protected sandbox was discarded. Build the replacement patch against the original host project state represented by the Wharness context."
	if item.ExecutionMode == domain.ExecutionModeUnprotected {
		modeNote = "The failed Unprotected execution may have partially changed the host. Wharness refreshed the project context before creating this repair request; use that current context as authoritative."
	}
	var diagnostics strings.Builder
	for index, command := range result.Commands {
		fmt.Fprintf(&diagnostics, "\n[%d] %s (exit %d, success=%t)\n%s\n", index+1, strings.Join(command.Argv, " "), command.ExitCode, command.Success, truncateRepairText(commandResultDiagnostic(command), 6000))
	}
	return fmt.Sprintf(`AUTOMATIC REPAIR REQUEST — attempt %d of %d

The previous execution plan failed and Wharness captured the failure automatically.
Do not repeat the failed plan unchanged. Produce a corrected replacement plan for the SAME user intent.
%s

FAILED PLAN ID: %s
EXECUTION MODE: %s
FAILURE:
%s

CAPTURED COMMAND / VERIFICATION DIAGNOSTICS:%s

Use the existing project context and the failure evidence above to identify the actual regression or execution problem. Return the corrected plan through the normal Wharness file-first delivery contract.`, attempt, maxAutoRepairAttempts, modeNote, result.PlanID, item.ExecutionMode, truncateRepairText(cause.Error(), 12000), diagnostics.String())
}

func truncateRepairText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "\n...[truncated by Wharness]"
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
		if refreshed, refreshErr := s.refreshContext(sessionID); refreshErr == nil {
			updated = refreshed
		} else {
			s.bus.Publish(sessionID, "context.refresh_after_apply_failed", map[string]any{"error": refreshErr.Error()})
		}
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

func (s *Service) CreateWorkspacePath(sessionID, path, kind string) (*workspacefs.File, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return nil, err
	}
	switch kind {
	case "file":
		file, err := workspacefs.CreateFile(item.ProjectPath, path)
		if err != nil {
			return nil, err
		}
		if workspace, ok := s.devspace(sessionID); ok {
			_, _ = workspacefs.CreateFile(workspace.Path, path)
		}
		s.bus.Publish(sessionID, "editor.file_created", map[string]any{"path": path})
		return &file, nil
	case "directory":
		if err := workspacefs.CreateDirectory(item.ProjectPath, path); err != nil {
			return nil, err
		}
		if workspace, ok := s.devspace(sessionID); ok {
			_ = workspacefs.CreateDirectory(workspace.Path, path)
		}
		s.bus.Publish(sessionID, "editor.directory_created", map[string]any{"path": path})
		return nil, nil
	default:
		return nil, errors.New("workspace path kind must be file or directory")
	}
}

func (s *Service) RenameWorkspacePath(sessionID, from, to string) error {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return err
	}
	if err := workspacefs.Rename(item.ProjectPath, from, to); err != nil {
		return err
	}
	if workspace, ok := s.devspace(sessionID); ok {
		_ = workspacefs.Rename(workspace.Path, from, to)
	}
	s.bus.Publish(sessionID, "editor.path_renamed", map[string]any{"from": from, "to": to})
	return nil
}

func (s *Service) DeleteWorkspacePath(sessionID, path string) error {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return err
	}
	if err := workspacefs.Delete(item.ProjectPath, path); err != nil {
		return err
	}
	if workspace, ok := s.devspace(sessionID); ok {
		_ = workspacefs.Delete(workspace.Path, path)
	}
	s.bus.Publish(sessionID, "editor.path_deleted", map[string]any{"path": path})
	return nil
}

func (s *Service) RunTerminal(ctx context.Context, sessionID string, target domain.TerminalTarget, command domain.CommandSpec) (domain.CommandResult, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.CommandResult{}, err
	}
	if target == "" {
		target = domain.TerminalTargetSandbox
	}
	if !domain.ValidTerminalTarget(target) {
		return domain.CommandResult{}, fmt.Errorf("unsupported terminal target %q", target)
	}
	if target == domain.TerminalTargetHost && command.Network {
		return domain.CommandResult{}, errors.New("host terminal inherits host networking; the sandbox network toggle is unavailable for host commands")
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
	decision := s.policy.EvaluateInteractiveCommand(command)
	if !decision.Allowed {
		return domain.CommandResult{}, fmt.Errorf("terminal policy denied command: %s", strings.Join(decision.Reasons, "; "))
	}
	runner := s.runner
	var workspace sandbox.Workspace
	if target == domain.TerminalTargetHost {
		runner = s.hostRunner
		workspace, err = runner.Prepare(ctx, item.ProjectPath)
	} else {
		workspace, err = s.ensureDevspace(ctx, sessionID, item.ProjectPath)
	}
	if err != nil {
		return domain.CommandResult{}, err
	}
	s.bus.Publish(sessionID, "terminal.command_started", map[string]any{"argv": command.Argv, "cwd": command.Cwd, "network": command.Network, "target": target})
	result, err := runner.Run(ctx, workspace, command)
	s.bus.Publish(sessionID, "terminal.command_completed", map[string]any{"argv": command.Argv, "cwd": command.Cwd, "exit_code": result.ExitCode, "success": result.Success, "stdout": result.Stdout, "stderr": result.Stderr, "target": target})
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

func (s *Service) ContextInspection(sessionID string) (contextbundle.ContextInspection, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return contextbundle.ContextInspection{}, err
	}
	return s.context.Inspect(item.ProjectPath, item.Context.Manifest)
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
