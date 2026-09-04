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
	"kernl.local/harness/backend/internal/selfevolution"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/workspacefs"
)

var (
	ErrApprovalRequired                  = errors.New("explicit approval required")
	ErrExecutionRequired                 = errors.New("successful sandbox execution required before host apply")
	ErrRemoteStorageConnectorUnavailable = errors.New("remote storage connector is unavailable")
)

type BundleSubmission struct {
	Session          domain.Session          `json:"session"`
	AutoExecuted     bool                    `json:"auto_executed"`
	AutoApplied      bool                    `json:"auto_applied"`
	AutoError        string                  `json:"auto_error,omitempty"`
	Execution        *domain.ExecutionResult `json:"execution,omitempty"`
	PolicyBlocked    bool                    `json:"policy_blocked,omitempty"`
	PolicyReasons    []string                `json:"policy_reasons,omitempty"`
	RepairPrepared   bool                    `json:"repair_prepared,omitempty"`
	WorkflowExecuted bool                    `json:"workflow_executed,omitempty"`
	WorkflowPrepared bool                    `json:"workflow_prepared,omitempty"`
	WorkflowRound    int                     `json:"workflow_round,omitempty"`
	RestartScheduled bool                    `json:"restart_scheduled,omitempty"`
	RestartRequired  bool                    `json:"restart_required,omitempty"`
}

const maxAutoRepairAttempts = 3

type Service struct {
	store                  *session.Store
	bus                    *audit.Bus
	context                *contextbundle.Builder
	planner                planner.Planner
	policy                 *policy.Engine
	runner                 sandbox.Runner
	hostRunner             sandbox.Runner
	selfEvolution          *selfevolution.Manager
	remoteInputs           RemoteInputStore
	remoteStorageConnector RemoteStorageConnector
	devMu                  sync.Mutex
	devspaces              map[string]sandbox.Workspace
	applyMu                sync.Mutex
	projectApplyLocks      map[string]*sync.Mutex
}

func (s *Service) SetRemoteInputStore(store RemoteInputStore) {
	s.remoteInputs = store
}

func (s *Service) RemoteInputStatus() RemoteInputStatus {
	if s.remoteInputs == nil {
		return RemoteInputStatus{Mode: "local_attachments"}
	}
	return s.remoteInputs.Status()
}

func NewService(store *session.Store, bus *audit.Bus, builder *contextbundle.Builder, planner planner.Planner, policies *policy.Engine, runner sandbox.Runner) *Service {
	manager := selfevolution.New(selfevolution.DiscoverRoot())
	service := &Service{store: store, bus: bus, context: builder, planner: planner, policy: policies, runner: runner, hostRunner: sandbox.NewHostRunner(), selfEvolution: manager, devspaces: make(map[string]sandbox.Workspace), projectApplyLocks: make(map[string]*sync.Mutex)}
	service.normalizeBaselineConcurrencySessions()
	service.normalizeSelfEvolutionSessions()
	service.reconcileSelfEvolutionStatus()
	return service
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
	selfEvolution := s.selfEvolution.IsProject(projectPath)
	if selfEvolution && executionMode == domain.ExecutionModeUnprotected {
		executionMode = domain.ExecutionModeProtected
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
	item := domain.Session{ID: id, ProjectPath: bundle.Manifest.ProjectRoot, ExecutionMode: executionMode, AutomationMode: automationMode, SelfEvolution: selfEvolution, State: "ready", CreatedAt: time.Now().UTC(), Context: bundle}
	if err := s.store.Put(item); err != nil {
		return domain.Session{}, fmt.Errorf("persist session: %w", err)
	}
	s.bus.Publish(id, "session.created", map[string]any{"files": len(bundle.Manifest.Files), "snapshot": bundle.Manifest.SHA256, "text_truncated": bundle.Manifest.TextTruncated, "execution_mode": executionMode, "automation_mode": automationMode, "self_evolution": selfEvolution})
	return item, nil
}

func (s *Service) GetSession(sessionID string) (domain.Session, error) {
	s.reconcileSelfEvolutionStatus()
	return s.store.Get(sessionID)
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
		if mode == domain.ExecutionModeUnprotected && s.isSelfEvolution(*current) {
			return errors.New("Wharness self-evolution is locked to Protected execution mode")
		}
		if mode == domain.ExecutionModeUnprotected && len(pendingHostChanges(*current)) > 0 {
			return errors.New("apply or reject the pending Protected changes before switching to Unprotected mode")
		}
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
	return s.SubmitMessageWithMode(ctx, sessionID, message, "direct")
}

func (s *Service) SubmitMessageWithMode(ctx context.Context, sessionID, message, planningMode string) (planner.Result, domain.Session, error) {
	planningMode = strings.ToLower(strings.TrimSpace(planningMode))
	if planningMode == "" {
		planningMode = "direct"
	}
	if planningMode != "direct" && planningMode != "plan_first" {
		return planner.Result{}, domain.Session{}, fmt.Errorf("unsupported planning mode %q", planningMode)
	}
	item, err := s.refreshContext(sessionID)
	if err != nil {
		return planner.Result{}, domain.Session{}, err
	}
	message = messageWithPendingHostChanges(message, item.PendingHostChanges, item.LastRepairError)
	requestID := ids.New("req")
	requestBaselineSHA := strings.TrimSpace(item.Context.Manifest.SHA256)
	if _, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.LastRequestID = requestID
		current.LastRequestMode = planningMode
		current.PlannerInFlight = true
		recordRequestBaseline(current, requestID, requestBaselineSHA)
		return nil
	}); err != nil {
		return planner.Result{}, item, err
	}
	s.bus.Publish(sessionID, "planner.started", map[string]any{"request_id": requestID, "base_context_sha256": requestBaselineSHA})
	result, err := s.planner.Plan(ctx, planner.Request{SessionID: sessionID, RequestID: requestID, Message: message, ContextTextPath: item.Context.TextPath, ContextManifest: item.Context.Manifest, PreviousResponseID: item.LastProviderResponseID, AutomationMode: item.AutomationMode, SelfEvolution: s.isSelfEvolution(item), PlanningMode: planningMode})
	if err != nil {
		_, _ = s.store.Update(sessionID, func(current *domain.Session) error {
			if current.LastRequestID == requestID {
				current.PlannerInFlight = false
			}
			return nil
		})
		s.bus.Publish(sessionID, "planner.failed", map[string]any{"error": err.Error()})
		return planner.Result{}, item, err
	}
	if result.ManualPrompt != "" {
		if latest, latestErr := s.store.Get(sessionID); latestErr == nil && latest.Context.Manifest.SHA256 != requestBaselineSHA {
			requestBaselineSHA = latest.Context.Manifest.SHA256
			result.ManualPrompt = planner.BuildManualPrompt(planner.Request{SessionID: sessionID, RequestID: requestID, Message: message, ContextTextPath: latest.Context.TextPath, ContextManifest: latest.Context.Manifest, PreviousResponseID: latest.LastProviderResponseID, AutomationMode: latest.AutomationMode, SelfEvolution: s.isSelfEvolution(latest), PlanningMode: planningMode})
		}
	}
	enrichPlanConcurrency(result.Plan, requestBaselineSHA)
	if err := normalizePlannerResult(requestID, &result); err != nil {
		_, _ = s.store.Update(sessionID, func(current *domain.Session) error {
			if current.LastRequestID == requestID {
				current.PlannerInFlight = false
			}
			return nil
		})
		return planner.Result{}, item, err
	}
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.LastManualPrompt = result.ManualPrompt
		current.LastRequestID = requestID
		current.PlannerInFlight = false
		recordRequestBaseline(current, requestID, requestBaselineSHA)
		current.RepairAttempt = 0
		current.RepairParentPlanID = ""
		current.LastRepairError = ""
		current.WorkflowRound = 0
		current.LastRequestMode = planningMode
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
			decision := s.policy.Evaluate(*result.Plan)
			current.Plan = result.Plan
			current.Policy = &decision
			if result.Turn != nil && result.Turn.Kind == domain.TurnKindWorkflow {
				current.State = "workflow_planned"
			} else {
				current.State = "planned"
			}
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
	if result.Plan != nil && result.Turn != nil && result.Turn.Kind == domain.TurnKindWorkflow {
		if updated.AutomationMode != domain.AutomationModeAuto {
			return planner.Result{}, updated, errors.New("workflow turn requires project Auto mode; return a terminal answer/investigation or enable Auto")
		}
		workflow, workflowErr := s.runWorkflowLoop(ctx, sessionID, "provider")
		if workflowErr != nil {
			return planner.Result{}, updated, workflowErr
		}
		updated = workflow.Session
	} else if result.Plan != nil && updated.AutomationMode == domain.AutomationModeAuto && updated.Policy != nil && result.Plan.Status == "ready" {
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
	enrichPlanConcurrency(&plan, requestBaseline(current, plan.RequestID))
	currentSHA := strings.TrimSpace(current.Context.Manifest.SHA256)
	if plan.BaseContextSHA256 != "" && currentSHA != "" && plan.BaseContextSHA256 != currentSHA {
		if canFastForwardBaseline(current, plan.BaseContextSHA256, currentSHA, planTouchedFiles(&plan)) {
			s.bus.Publish(sessionID, "baseline.plan_fast_forwarded", map[string]any{"request_id": plan.RequestID, "from_sha256": plan.BaseContextSHA256, "to_sha256": currentSHA})
			plan.BaseContextSHA256 = currentSHA
		} else {
			return domain.Session{}, fmt.Errorf("manual plan baseline %s is superseded by current baseline %s", plan.BaseContextSHA256, currentSHA)
		}
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
	if parsed.Plan != nil {
		enrichPlanConcurrency(parsed.Plan, requestBaseline(current, parsed.Plan.RequestID))
	}
	filenameRequestID := bundleFilenameRequestID(filename)
	if filenameRequestID == "" || filenameRequestID != parsed.Turn.RequestID {
		return BundleSubmission{}, errors.New("execution bundle filename/request_id mismatch")
	}
	if !containsString(current.PendingManualRequestIDs, parsed.Turn.RequestID) {
		return BundleSubmission{}, fmt.Errorf("bundle request_id %q is not pending for this chat/session", parsed.Turn.RequestID)
	}
	if requestSupersededByBaselineContinuation(current, parsed.Turn.RequestID) {
		updated, updateErr := s.store.Update(sessionID, func(item *domain.Session) error {
			item.PendingManualRequestIDs = removeString(item.PendingManualRequestIDs, parsed.Turn.RequestID)
			return nil
		})
		if updateErr != nil {
			return BundleSubmission{}, updateErr
		}
		s.bus.Publish(sessionID, "baseline.bundle_superseded", map[string]any{"request_id": parsed.Turn.RequestID, "replacement_request_id": current.LastRequestID, "current_sha256": current.Context.Manifest.SHA256})
		return BundleSubmission{Session: updated, AutoError: fmt.Sprintf("ignored superseded bundle for request %s; concurrent baseline adaptation continues as request %s", parsed.Turn.RequestID, current.LastRequestID)}, nil
	}
	if parsed.Plan != nil {
		expected := strings.TrimSpace(parsed.Plan.BaseContextSHA256)
		currentSHA := strings.TrimSpace(current.Context.Manifest.SHA256)
		if expected != "" && currentSHA != "" && expected != currentSHA {
			if canFastForwardBaseline(current, expected, currentSHA, planTouchedFiles(parsed.Plan)) {
				parsed.Plan.BaseContextSHA256 = currentSHA
				s.bus.Publish(sessionID, "baseline.bundle_fast_forwarded", map[string]any{"request_id": parsed.Turn.RequestID, "from_sha256": expected, "to_sha256": currentSHA})
			} else {
				updated, updateErr := s.store.Update(sessionID, func(item *domain.Session) error {
					item.PendingManualRequestIDs = removeString(item.PendingManualRequestIDs, parsed.Turn.RequestID)
					return nil
				})
				if updateErr != nil {
					return BundleSubmission{}, updateErr
				}
				s.bus.Publish(sessionID, "baseline.bundle_superseded", map[string]any{"request_id": parsed.Turn.RequestID, "expected_sha256": expected, "current_sha256": currentSHA})
				return BundleSubmission{Session: updated, AutoError: fmt.Sprintf("ignored superseded bundle for baseline %s; current baseline is %s", expected, currentSHA)}, nil
			}
		}
	}
	if current.LastRequestMode == "plan_first" && parsed.Turn.RequestID == current.LastRequestID {
		if parsed.Plan != nil || parsed.Turn.Kind == domain.TurnKindChange || parsed.Turn.Kind == domain.TurnKindWorkflow {
			return BundleSubmission{}, errors.New("plan-first request must return a terminal proposal without plan.json; implementation requires explicit user approval")
		}
	}
	if parsed.Turn.Kind == domain.TurnKindWorkflow {
		if current.AutomationMode != domain.AutomationModeAuto {
			return BundleSubmission{}, errors.New("workflow bundle requires project Auto mode; return a terminal answer/investigation bundle or enable Auto")
		}
		if current.ExecutionMode != domain.ExecutionModeProtected {
			return BundleSubmission{}, errors.New("workflow bundle requires Protected execution mode")
		}
		if current.WorkflowRound >= maxWorkflowRounds {
			return BundleSubmission{}, fmt.Errorf("workflow round limit reached (%d); return a terminal answer, investigation, clarification, change, or blocked bundle for request %s", maxWorkflowRounds, parsed.Turn.RequestID)
		}
		if parsed.Plan == nil {
			return BundleSubmission{}, errors.New("workflow bundle requires plan.json")
		}
		if err := protocol.ValidateWorkflowPlan(*parsed.Plan); err != nil {
			return BundleSubmission{}, err
		}
		decision := s.policy.Evaluate(*parsed.Plan)
		_, updateErr := s.store.Update(sessionID, func(item *domain.Session) error {
			turn := parsed.Turn
			item.LastTurn = &turn
			item.Plan = parsed.Plan
			item.Policy = &decision
			item.LastExecution = nil
			item.LastBundle = &parsed.Info
			item.State = "workflow_planned"
			item.PendingManualRequestIDs = removeString(item.PendingManualRequestIDs, parsed.Turn.RequestID)
			return nil
		})
		if updateErr != nil {
			return BundleSubmission{}, updateErr
		}
		s.bus.Publish(sessionID, "workflow.received", map[string]any{"plan_id": parsed.Plan.PlanID, "request_id": parsed.Turn.RequestID, "allowed": decision.Allowed, "transport": "zip_bundle"})
		return s.runWorkflowLoop(ctx, sessionID, "zip_bundle")
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
	result := domain.ExecutionResult{PlanID: planID, Success: false, Error: "policy denied plan: " + detail, StartedAt: time.Now().UTC(), CompletedAt: time.Now().UTC(), Commands: []domain.CommandResult{}}
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
		if current.Policy.RequiresApproval {
			reason := strings.Join(current.Policy.Reasons, "; ")
			if strings.TrimSpace(reason) == "" {
				reason = "policy requires explicit approval"
			}
			result.AutoError = "automatic execution paused because this plan still requires explicit approval: " + reason
			s.bus.Publish(sessionID, "automation.approval_required", map[string]any{"plan_id": planID, "transport": transport, "risk": current.Policy.Risk, "reasons": current.Policy.Reasons, "error": result.AutoError})
			result.Session = current
			return result
		}
		s.bus.Publish(sessionID, "automation.started", map[string]any{"plan_id": planID, "transport": transport, "attempt": attempt + 1})
		execution, executed, execErr := s.Execute(ctx, sessionID, false)
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
			if repaired, repairErr := s.prepareRepairRequest(ctx, sessionID, execution, applyErr); repairErr == nil {
				result.Session = repaired
				result.RepairPrepared = repaired.State == "repair_pending" && repaired.LastManualPrompt != ""
			}
			return result
		}
		result.AutoApplied = true
		result.RestartRequired = applied.SelfEvolution && applied.State == "restart_pending" && planHasPatch(current.Plan)
		result.RestartScheduled = false
		result.Session = applied
		s.bus.Publish(sessionID, "automation.completed", map[string]any{"plan_id": planID, "applied": true, "transport": transport, "restart_required": result.RestartRequired})
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
	case domain.TurnKindWorkflow:
		return "workflow_planned"
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
	if planExecutionAlreadyCompleted(item, item.Plan.PlanID) {
		s.bus.Publish(sessionID, "execution.duplicate_blocked", map[string]any{"plan_id": item.Plan.PlanID, "state": item.State})
		return domain.ExecutionResult{}, item, fmt.Errorf("plan %s already executed successfully; submit a new change request instead of executing it again", item.Plan.PlanID)
	}
	if !item.Policy.Allowed {
		return domain.ExecutionResult{}, item, errors.New("policy denied plan")
	}
	unprotected := item.ExecutionMode == domain.ExecutionModeUnprotected
	if unprotected && s.isSelfEvolution(item) {
		return domain.ExecutionResult{}, item, errors.New("Wharness self-evolution cannot execute in Unprotected mode")
	}
	if (item.Policy.RequiresApproval || unprotected) && !approved {
		return domain.ExecutionResult{}, item, ErrApprovalRequired
	}

	if unprotected {
		directApplyLock := s.projectApplyLock(item.ProjectPath)
		directApplyLock.Lock()
		defer directApplyLock.Unlock()
	}

	expected := planBaseline(item, item.Plan)
	refreshed, refreshErr := s.refreshContext(sessionID)
	if refreshErr != nil {
		return domain.ExecutionResult{}, item, refreshErr
	}
	item = refreshed
	currentBaseline := strings.TrimSpace(item.Context.Manifest.SHA256)
	if expected != "" && currentBaseline != expected {
		if canFastForwardBaseline(item, expected, currentBaseline, planTouchedFiles(item.Plan)) {
			advanced, updateErr := s.store.Update(sessionID, func(current *domain.Session) error {
				if current.Plan != nil && current.Plan.PlanID == item.Plan.PlanID {
					current.Plan.BaseContextSHA256 = currentBaseline
				}
				return nil
			})
			if updateErr != nil {
				return domain.ExecutionResult{}, item, updateErr
			}
			item = advanced
			s.bus.Publish(sessionID, "baseline.execution_fast_forwarded", map[string]any{"plan_id": item.Plan.PlanID, "from_sha256": expected, "to_sha256": currentBaseline})
		} else {
			cause := fmt.Errorf("stale context baseline: plan %s was prepared on %s but the current project baseline is %s", item.Plan.PlanID, expected, currentBaseline)
			s.bus.Publish(sessionID, "baseline.stale", map[string]any{"plan_id": item.Plan.PlanID, "expected_sha256": expected, "current_sha256": currentBaseline, "impact_files": item.Plan.ImpactFiles})
			result := domain.ExecutionResult{PlanID: item.Plan.PlanID, StartedAt: time.Now().UTC(), Commands: []domain.CommandResult{}}
			return s.failExecution(ctx, sessionID, result, cause)
		}
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

	result := domain.ExecutionResult{PlanID: item.Plan.PlanID, StartedAt: time.Now().UTC(), Commands: []domain.CommandResult{}}
	s.bus.Publish(sessionID, "execution.started", map[string]any{"plan_id": item.Plan.PlanID, "execution_mode": item.ExecutionMode, "target": executionTarget})
	workspace, err := runner.Prepare(ctx, item.ProjectPath)
	if err != nil {
		return s.failExecution(ctx, sessionID, result, err)
	}
	defer runner.Cleanup(workspace)
	if !unprotected {
		for _, pending := range item.PendingHostChanges {
			if pending.Plan.PlanID == item.Plan.PlanID {
				continue
			}
			for _, patch := range planPatches(&pending.Plan) {
				if err := protocol.ValidatePatchPaths(patch); err != nil {
					return s.failExecution(ctx, sessionID, result, fmt.Errorf("replay pending plan %s: %w", pending.Plan.PlanID, err))
				}
				commandResult, runErr := runner.ApplyPatch(ctx, workspace, patch)
				result.Commands = append(result.Commands, commandResult)
				if runErr != nil || !commandResult.Success {
					if runErr == nil {
						runErr = fmt.Errorf("patch failed: %s", strings.TrimSpace(commandResult.Stderr))
					}
					return s.failExecution(ctx, sessionID, result, fmt.Errorf("replay pending plan %s: %w", pending.Plan.PlanID, runErr))
				}
				s.bus.Publish(sessionID, "patch.applied", map[string]any{"target": "sandbox-pending", "plan_id": pending.Plan.PlanID, "files": patchPaths(patch), "duration_ms": commandResult.DurationMS})
			}
		}
	}

	for _, op := range item.Plan.Operations {
		if op.Type == "apply_patch" {
			if err := protocol.ValidatePatchPaths(op.Patch); err != nil {
				return s.failExecution(ctx, sessionID, result, err)
			}
			runID := ids.New("patch")
			s.bus.Publish(sessionID, "patch.started", map[string]any{"run_id": runID, "target": executionTarget, "files": patchPaths(op.Patch)})
			commandResult, runErr := runner.ApplyPatch(ctx, workspace, op.Patch)
			result.Commands = append(result.Commands, commandResult)
			if runErr != nil || !commandResult.Success {
				if runErr == nil {
					runErr = fmt.Errorf("patch failed: %s", strings.TrimSpace(commandResult.Stderr))
				}
				return s.failExecution(ctx, sessionID, result, runErr)
			}
			s.bus.Publish(sessionID, "patch.applied", map[string]any{"run_id": runID, "target": executionTarget, "files": patchPaths(op.Patch), "duration_ms": commandResult.DurationMS})
			continue
		}
		command := op.Command
		if !unprotected {
			command = protectedGitCommand(command)
		}
		commandResult, runErr := s.runCommandWithRunner(ctx, sessionID, runner, workspace, command, executionTarget)
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
			baselineResult, unchanged, baselineErr := s.compareVerificationBaseline(ctx, runner, &baselineWorkspace, item.ProjectPath, item.PendingHostChanges, command, commandResult)
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
			current.PendingHostChanges = upsertPendingHostChange(current.PendingHostChanges, domain.PendingHostChange{
				Plan: *item.Plan, Execution: result, VerifiedAt: result.CompletedAt,
			})
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
			changedFiles := actualPatchFiles(item.Plan)
			if planHasCommandOperation(item.Plan) {
				changedFiles = nil
			}
			s.publishBaselineUpdate(ctx, updated, currentBaseline, refreshed.Context.Manifest.SHA256, item.Plan.PlanID, changedFiles)
		} else {
			s.bus.Publish(sessionID, "context.refresh_after_apply_failed", map[string]any{"error": refreshErr.Error()})
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

func (s *Service) compareVerificationBaseline(ctx context.Context, runner sandbox.Runner, workspace **sandbox.Workspace, projectPath string, pending []domain.PendingHostChange, command domain.CommandSpec, post domain.CommandResult) (domain.CommandResult, bool, error) {
	if *workspace == nil {
		prepared, err := runner.Prepare(ctx, projectPath)
		if err != nil {
			return domain.CommandResult{}, false, fmt.Errorf("prepare verification baseline: %w", err)
		}
		for index := range pending {
			for _, patch := range planPatches(&pending[index].Plan) {
				result, applyErr := runner.ApplyPatch(ctx, prepared, patch)
				if applyErr != nil || !result.Success {
					_ = runner.Cleanup(prepared)
					if applyErr != nil {
						return domain.CommandResult{}, false, fmt.Errorf("prepare pending verification baseline: %w", applyErr)
					}
					return domain.CommandResult{}, false, fmt.Errorf("prepare pending verification baseline: %s", strings.TrimSpace(result.Stderr))
				}
			}
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
	runID := ids.New("run")
	s.bus.Publish(sessionID, "command.started", map[string]any{"run_id": runID, "argv": command.Argv, "cwd": command.Cwd, "network": command.Network, "target": target})
	var result domain.CommandResult
	var err error
	if streaming, ok := runner.(sandbox.StreamingRunner); ok {
		result, err = streaming.RunStreaming(ctx, workspace, command, func(stream, text string) {
			s.bus.Publish(sessionID, "command.output", map[string]any{"run_id": runID, "stream": stream, "text": text, "target": target})
		})
	} else {
		result, err = runner.Run(ctx, workspace, command)
	}
	s.bus.Publish(sessionID, "command.completed", map[string]any{"run_id": runID, "argv": command.Argv, "cwd": command.Cwd, "exit_code": result.ExitCode, "success": result.Success, "stdout": result.Stdout, "stderr": result.Stderr, "duration_ms": result.DurationMS, "target": target})
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
		AutomationMode:     refreshed.AutomationMode,
		SelfEvolution:      s.isSelfEvolution(refreshed),
	})
	if err != nil {
		return refreshed, fmt.Errorf("prepare repair planner request: %w", err)
	}
	enrichPlanConcurrency(planned.Plan, refreshed.Context.Manifest.SHA256)
	if err := normalizePlannerResult(requestID, &planned); err != nil {
		return refreshed, err
	}
	if planned.Turn != nil && planned.Turn.Kind == domain.TurnKindWorkflow {
		return refreshed, errors.New("workflow turns are not allowed inside automatic repair; return a corrected change or terminal result")
	}

	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		item.LastRequestID = requestID
		recordRequestBaseline(item, requestID, refreshed.Context.Manifest.SHA256)
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
	if len(item.PendingHostChanges) > 0 {
		modeNote = "Verified host-pending changes are retained. Build the correction incrementally against the candidate state produced by the pending patches listed below; Wharness will replay and verify the complete chain in a fresh Protected sandbox before offering Apply again."
	}
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

%s

Use the existing project context and the failure evidence above to identify the actual regression or execution problem. Return the corrected plan through the normal Wharness file-first delivery contract.`, attempt, maxAutoRepairAttempts, modeNote, result.PlanID, item.ExecutionMode, truncateRepairText(cause.Error(), 12000), diagnostics.String(), pendingHostChangePrompt(item.PendingHostChanges))
}

func truncateRepairText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "\n...[truncated by Wharness]"
}

func patchPaths(patch string) []string {
	seen := map[string]bool{}
	paths := []string{}
	for _, line := range strings.Split(patch, "\n") {
		if !strings.HasPrefix(line, "+++ ") {
			continue
		}
		value := strings.TrimSpace(strings.TrimPrefix(line, "+++ "))
		value = strings.TrimPrefix(value, "b/")
		if value == "" || value == "/dev/null" || seen[value] {
			continue
		}
		seen[value] = true
		paths = append(paths, value)
	}
	return paths
}

func protectedGitCommand(command domain.CommandSpec) domain.CommandSpec {
	if len(command.Argv) < 2 || strings.ToLower(filepath.Base(command.Argv[0])) != "git" || strings.ToLower(command.Argv[1]) != "push" {
		return command
	}
	for _, arg := range command.Argv[2:] {
		if arg == "--dry-run" || arg == "-n" {
			return command
		}
	}
	clone := command
	clone.Argv = append([]string{"git", "push", "--dry-run"}, command.Argv[2:]...)
	return clone
}

func (s *Service) ApplyToHost(ctx context.Context, sessionID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	applyLock := s.projectApplyLock(item.ProjectPath)
	applyLock.Lock()
	defer applyLock.Unlock()
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
	pending := pendingHostChanges(item)
	if len(pending) == 0 {
		return item, ErrExecutionRequired
	}
	if pendingHostResolutionBlocked(item) {
		return item, errors.New("finish the active planner/repair turn before applying pending host changes")
	}
	expectedBaselines := make([]string, len(pending))
	for index := range pending {
		expectedBaselines[index] = planBaseline(item, &pending[index].Plan)
	}

	refreshedBeforeApply, refreshErr := s.refreshContext(sessionID)
	if refreshErr != nil {
		return item, fmt.Errorf("refresh baseline before host apply: %w", refreshErr)
	}
	item = refreshedBeforeApply
	currentBaseline := strings.TrimSpace(item.Context.Manifest.SHA256)
	reverify := false
	for index := range pending {
		expected := strings.TrimSpace(expectedBaselines[index])
		if expected == "" || expected == currentBaseline {
			continue
		}
		if canFastForwardBaseline(item, expected, currentBaseline, planTouchedFiles(&pending[index].Plan)) {
			reverify = true
			continue
		}
		s.bus.Publish(sessionID, "baseline.apply_blocked", map[string]any{"plan_id": pending[index].Plan.PlanID, "expected_sha256": expected, "current_sha256": currentBaseline, "impact_files": pending[index].Plan.ImpactFiles})
		return item, fmt.Errorf("host apply blocked by stale baseline: plan %s was verified on %s but current baseline is %s", pending[index].Plan.PlanID, expected, currentBaseline)
	}
	if reverify {
		reverified, reverifyErr := s.reverifyPendingCandidate(ctx, sessionID, item, pending, currentBaseline)
		if reverifyErr != nil {
			s.bus.Publish(sessionID, "baseline.reverify_failed", map[string]any{"current_sha256": currentBaseline, "error": reverifyErr.Error()})
			return item, fmt.Errorf("reverify pending candidate on current baseline: %w", reverifyErr)
		}
		item = reverified
		pending = pendingHostChanges(item)
	}

	patches := make([]string, 0)
	for index := range pending {
		patches = append(patches, planPatches(&pending[index].Plan)...)
	}
	changedFiles := make([]string, 0)
	for _, patch := range patches {
		if err := protocol.ValidatePatchPaths(patch); err != nil {
			return item, err
		}
		changedFiles = append(changedFiles, patchTouchedPaths(patch)...)
	}
	changedFiles = normalizedPaths(changedFiles)
	latestPlanID := pending[len(pending)-1].Plan.PlanID
	selfEvolution := s.isSelfEvolution(item) && len(patches) > 0
	var transaction selfevolution.Transaction
	if selfEvolution {
		transaction, err = s.selfEvolution.Prepare(sessionID, latestPlanID, patches)
		if err != nil {
			return item, fmt.Errorf("prepare Wharness self-evolution transaction: %w", err)
		}
		s.bus.Publish(sessionID, "self_evolution.transaction_started", map[string]any{"plan_id": latestPlanID, "transaction_id": transaction.ID})
	}
	rollback := func(cause error) error {
		if !selfEvolution {
			return cause
		}
		if rollbackErr := transaction.Rollback(); rollbackErr != nil {
			_ = s.selfEvolution.RecordStatus(transaction, sessionID, latestPlanID, "rollback_failed", rollbackErr.Error())
			s.updateSelfEvolutionBatchSessions(transaction, "restart_pending", rollbackErr.Error())
			transaction.ReleaseStage()
			return fmt.Errorf("%w; automatic self-evolution rollback also failed: %v", cause, rollbackErr)
		}
		_ = s.selfEvolution.RecordStatus(transaction, sessionID, latestPlanID, "rolled_back", cause.Error())
		s.updateSelfEvolutionBatchSessions(transaction, "verified", cause.Error())
		transaction.Release()
		s.bus.Publish(sessionID, "self_evolution.rolled_back", map[string]any{"plan_id": latestPlanID, "error": cause.Error()})
		return cause
	}

	s.bus.Publish(sessionID, "host.apply_started", map[string]any{"plan_id": latestPlanID, "plan_count": len(pending), "patch_count": len(patches)})
	workspace, err := s.hostRunner.Prepare(ctx, item.ProjectPath)
	if err != nil {
		if selfEvolution {
			return item, rollback(err)
		}
		return item, err
	}
	defer s.hostRunner.Cleanup(workspace)
	appliedPatches := make([]string, 0, len(patches))
	failApply := func(cause error) error {
		var failure error
		if selfEvolution {
			failure = rollback(cause)
		} else {
			failure = s.rollbackHostPatches(ctx, item.ProjectPath, appliedPatches, cause)
		}
		_, _ = s.store.Update(sessionID, func(current *domain.Session) error {
			current.LastRepairError = failure.Error()
			return nil
		})
		s.bus.Publish(sessionID, "host.apply_failed", map[string]any{"plan_id": latestPlanID, "error": failure.Error(), "rolled_back_patch_count": len(appliedPatches)})
		return failure
	}
	for _, change := range pending {
		for _, op := range change.Plan.Operations {
			if op.Type == "apply_patch" {
				if err := protocol.ValidatePatchPaths(op.Patch); err != nil {
					return item, failApply(err)
				}
				runID := ids.New("host-patch")
				s.bus.Publish(sessionID, "patch.started", map[string]any{"run_id": runID, "target": "host", "files": patchPaths(op.Patch)})
				patchResult, applyErr := s.hostRunner.ApplyPatch(ctx, workspace, op.Patch)
				if applyErr != nil || !patchResult.Success {
					if applyErr != nil {
						return item, failApply(fmt.Errorf("host apply failed: %w", applyErr))
					}
					return item, failApply(fmt.Errorf("host apply failed: %s", strings.TrimSpace(patchResult.Stderr)))
				}
				appliedPatches = append(appliedPatches, op.Patch)
				s.bus.Publish(sessionID, "patch.applied", map[string]any{"run_id": runID, "target": "host", "files": patchPaths(op.Patch), "duration_ms": patchResult.DurationMS})
				continue
			}
			if op.Type == "command" && policy.HostReplayGitCommand(op.Command) {
				result, runErr := s.runCommandWithRunner(ctx, sessionID, s.hostRunner, workspace, op.Command, "host")
				if runErr != nil || !result.Success {
					if runErr != nil {
						return item, failApply(fmt.Errorf("host git operation failed: %w", runErr))
					}
					return item, failApply(fmt.Errorf("host git operation failed: %s", strings.TrimSpace(result.Stderr)))
				}
			}
		}
	}

	if selfEvolution {
		_ = s.selfEvolution.RecordStatus(transaction, sessionID, latestPlanID, "building", "verified patch applied; building real Wharness host runtime")
		s.bus.Publish(sessionID, "self_evolution.host_build_started", map[string]any{"plan_id": latestPlanID, "transaction_id": transaction.ID})
		output, buildErr := s.selfEvolution.BuildHost(ctx, transaction)
		if buildErr != nil {
			detail := truncateRepairText(output, 12000)
			if detail != "" {
				buildErr = fmt.Errorf("%w\n%s", buildErr, detail)
			}
			s.bus.Publish(sessionID, "self_evolution.host_build_failed", map[string]any{"plan_id": latestPlanID, "error": buildErr.Error()})
			return item, failApply(buildErr)
		}
		_ = s.selfEvolution.RecordStatus(transaction, sessionID, latestPlanID, "restart_pending", "host build passed; explicit restart confirmation pending")
		s.bus.Publish(sessionID, "self_evolution.host_build_completed", map[string]any{"plan_id": latestPlanID, "transaction_id": transaction.ID})
	}

	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		if selfEvolution {
			current.State = "restart_pending"
			current.SelfEvolutionActivation = "restart_pending"
		} else {
			current.State = "applied"
		}
		current.SelfEvolution = current.SelfEvolution || selfEvolution
		current.LastAppliedChanges = append([]domain.PendingHostChange(nil), pending...)
		current.PendingHostChanges = nil
		current.LastRepairError = ""
		return nil
	})
	if err != nil {
		return item, rollback(err)
	}

	if selfEvolution {
		transaction.ReleaseStage()
		s.resetDevspace(sessionID)
		s.bus.Publish(sessionID, "host.applied", map[string]any{"plan_id": latestPlanID, "self_evolution": true, "restart_required": true})
		s.bus.Publish(sessionID, "self_evolution.restart_pending", map[string]any{"plan_id": latestPlanID, "transaction_id": transaction.ID})
		if refreshed, refreshErr := s.refreshContext(sessionID); refreshErr == nil {
			updated = refreshed
			s.publishBaselineUpdate(ctx, updated, currentBaseline, refreshed.Context.Manifest.SHA256, latestPlanID, changedFiles)
		} else {
			s.bus.Publish(sessionID, "context.refresh_after_apply_failed", map[string]any{"error": refreshErr.Error()})
		}
		return updated, nil
	}

	s.resetDevspace(sessionID)
	s.bus.Publish(sessionID, "host.applied", map[string]any{"plan_id": latestPlanID, "plan_count": len(pending)})
	if refreshed, refreshErr := s.refreshContext(sessionID); refreshErr == nil {
		updated = refreshed
		s.publishBaselineUpdate(ctx, updated, currentBaseline, refreshed.Context.Manifest.SHA256, latestPlanID, changedFiles)
	} else {
		s.bus.Publish(sessionID, "context.refresh_after_apply_failed", map[string]any{"error": refreshErr.Error()})
	}
	return updated, nil
}

func (s *Service) RevertHostChange(ctx context.Context, sessionID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	applyLock := s.projectApplyLock(item.ProjectPath)
	applyLock.Lock()
	defer applyLock.Unlock()
	refreshedBeforeRevert, refreshErr := s.refreshContext(sessionID)
	if refreshErr != nil {
		return item, fmt.Errorf("refresh baseline before host revert: %w", refreshErr)
	}
	item = refreshedBeforeRevert
	previousBaseline := strings.TrimSpace(item.Context.Manifest.SHA256)
	if item.ExecutionMode != domain.ExecutionModeProtected {
		return item, errors.New("revert is available only for Protected host apply")
	}
	if item.State != "applied" && item.State != "restart_pending" {
		return item, errors.New("there is no applied change available to revert")
	}
	applied := append([]domain.PendingHostChange(nil), item.LastAppliedChanges...)
	if len(applied) == 0 && item.Plan != nil && item.LastExecution != nil && item.LastExecution.Success && item.LastExecution.PlanID == item.Plan.PlanID {
		applied = []domain.PendingHostChange{{Plan: *item.Plan, Execution: *item.LastExecution, VerifiedAt: item.LastExecution.CompletedAt}}
	}
	if len(applied) == 0 {
		return item, ErrExecutionRequired
	}
	for _, change := range applied {
		for _, op := range change.Plan.Operations {
			if op.Type == "command" && policy.HostReplayGitCommand(op.Command) {
				return item, errors.New("deterministic revert is unavailable for plans containing host git mutation commands")
			}
		}
	}
	patches := make([]string, 0)
	for index := range applied {
		patches = append(patches, planPatches(&applied[index].Plan)...)
	}
	if len(patches) == 0 {
		return item, errors.New("the current plan has no patch changes to revert")
	}
	changedFiles := make([]string, 0)
	for _, patch := range patches {
		changedFiles = append(changedFiles, patchTouchedPaths(patch)...)
	}
	changedFiles = normalizedPaths(changedFiles)
	latestPlanID := applied[len(applied)-1].Plan.PlanID
	s.bus.Publish(sessionID, "host.revert_started", map[string]any{"plan_id": latestPlanID, "plan_count": len(applied), "patch_count": len(patches)})

	if s.isSelfEvolution(item) && item.State == "restart_pending" {
		transaction, pendingErr := s.selfEvolution.ClaimPendingTransaction(sessionID, latestPlanID)
		if pendingErr != nil {
			return item, fmt.Errorf("recover self-evolution transaction for revert: %w", pendingErr)
		}
		if rollbackErr := transaction.Rollback(); rollbackErr != nil {
			transaction.ReleaseStage()
			return item, fmt.Errorf("revert self-evolution transaction: %w", rollbackErr)
		}
		_ = s.selfEvolution.RecordStatus(transaction, sessionID, latestPlanID, "rolled_back", "user requested rollback of the pending self-evolution batch before restart")
		s.updateSelfEvolutionBatchSessions(transaction, "reverted", "")
		transaction.Release()
		transaction.Finalize()
	} else {
		workspace, prepareErr := s.hostRunner.Prepare(ctx, item.ProjectPath)
		if prepareErr != nil {
			return item, prepareErr
		}
		defer s.hostRunner.Cleanup(workspace)
		reverse, ok := s.hostRunner.(sandbox.ReversePatchRunner)
		if !ok {
			return item, errors.New("host runner does not support deterministic patch revert")
		}
		reverted := []string{}
		for index := len(patches) - 1; index >= 0; index-- {
			patch := patches[index]
			if validateErr := protocol.ValidatePatchPaths(patch); validateErr != nil {
				return item, validateErr
			}
			runID := ids.New("host-revert")
			s.bus.Publish(sessionID, "patch.started", map[string]any{"run_id": runID, "target": "host-revert", "files": patchPaths(patch)})
			result, reverseErr := reverse.ReversePatch(ctx, workspace, patch)
			if reverseErr != nil || !result.Success {
				for restoreIndex := len(reverted) - 1; restoreIndex >= 0; restoreIndex-- {
					_, _ = s.hostRunner.ApplyPatch(ctx, workspace, reverted[restoreIndex])
				}
				if reverseErr != nil {
					return item, fmt.Errorf("host revert failed: %w", reverseErr)
				}
				return item, fmt.Errorf("host revert failed: %s", strings.TrimSpace(result.Stderr))
			}
			reverted = append(reverted, patch)
			s.bus.Publish(sessionID, "patch.applied", map[string]any{"run_id": runID, "target": "host-revert", "files": patchPaths(patch), "duration_ms": result.DurationMS})
		}
	}

	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.State = "reverted"
		current.LastAppliedChanges = nil
		return nil
	})
	if err != nil {
		return item, err
	}
	s.resetDevspace(sessionID)
	s.bus.Publish(sessionID, "host.reverted", map[string]any{"plan_id": latestPlanID, "plan_count": len(applied)})
	if refreshed, refreshErr := s.refreshContext(sessionID); refreshErr == nil {
		updated = refreshed
		s.publishBaselineUpdate(ctx, updated, previousBaseline, refreshed.Context.Manifest.SHA256, latestPlanID, changedFiles)
	} else {
		s.bus.Publish(sessionID, "context.refresh_after_revert_failed", map[string]any{"error": refreshErr.Error()})
	}
	return updated, nil
}

func (s *Service) RestartSelfEvolution(sessionID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	if !s.isSelfEvolution(item) || (item.SelfEvolutionActivation != "restart_pending" && item.State != "restart_pending") {
		return item, errors.New("no Wharness self-evolution restart is pending confirmation")
	}
	transaction, pending, err := s.selfEvolution.ClaimPendingForSession(sessionID)
	if err != nil {
		return item, fmt.Errorf("recover pending Wharness self-evolution transaction: %w", err)
	}
	if err := s.selfEvolution.ScheduleRestart(transaction, sessionID, pending.PlanID); err != nil {
		_ = s.selfEvolution.RecordStatus(transaction, sessionID, pending.PlanID, "restart_pending", "restart confirmation accepted but detached handoff failed: "+err.Error())
		transaction.ReleaseStage()
		return item, fmt.Errorf("schedule Wharness restart: %w", err)
	}
	_ = s.selfEvolution.RecordStatus(transaction, sessionID, pending.PlanID, "restart_scheduled", "detached restart supervisor accepted the pending self-evolution batch")
	s.updateSelfEvolutionBatchSessions(transaction, "restart_scheduled", "")
	transaction.ReleaseStage()
	updated, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	s.bus.Publish(sessionID, "self_evolution.restart_scheduled", map[string]any{"plan_id": pending.PlanID, "transaction_id": transaction.ID})
	return updated, nil
}

func (s *Service) isSelfEvolution(item domain.Session) bool {
	return item.SelfEvolution || (s.selfEvolution != nil && s.selfEvolution.IsProject(item.ProjectPath))
}

func (s *Service) normalizeSelfEvolutionSessions() {
	if s.selfEvolution == nil || !s.selfEvolution.Enabled() {
		return
	}
	for _, item := range s.store.List() {
		if !s.selfEvolution.IsProject(item.ProjectPath) {
			continue
		}
		_, _ = s.store.Update(item.ID, func(current *domain.Session) error {
			current.SelfEvolution = true
			if current.ExecutionMode == domain.ExecutionModeUnprotected {
				current.ExecutionMode = domain.ExecutionModeProtected
			}
			return nil
		})
	}
}

func (s *Service) updateSelfEvolutionBatchSessions(transaction selfevolution.Transaction, state, detail string) int {
	plans, err := transaction.PendingPlans()
	if err != nil {
		return 0
	}
	activationState := ""
	if state == "restart_pending" || state == "restart_scheduled" {
		activationState = state
	}
	seen := map[string]struct{}{}
	updatedCount := 0
	for index := len(plans) - 1; index >= 0; index-- {
		pending := plans[index]
		if _, ok := seen[pending.SessionID]; ok {
			continue
		}
		seen[pending.SessionID] = struct{}{}
		matchedPlan := false
		updated, updateErr := s.store.Update(pending.SessionID, func(current *domain.Session) error {
			if !s.isSelfEvolution(*current) {
				return nil
			}
			current.SelfEvolution = true
			current.SelfEvolutionActivation = activationState
			matchedPlan = current.Plan != nil && current.Plan.PlanID == pending.PlanID
			batchOwnsVisibleState := matchedPlan || current.State == "restart_pending" || current.State == "restart_scheduled"
			if batchOwnsVisibleState {
				current.State = state
				if detail != "" {
					current.LastRepairError = detail
				} else if state == "applied" || state == "restart_scheduled" || state == "reverted" {
					current.LastRepairError = ""
				}
			}
			return nil
		})
		if updateErr == nil && updated.ID != "" {
			updatedCount++
			s.bus.Publish(pending.SessionID, "self_evolution.batch_state", map[string]any{"plan_id": pending.PlanID, "state": state, "transaction_id": transaction.ID, "current_plan_matched": matchedPlan})
		}
	}
	return updatedCount
}

func (s *Service) reconcileSelfEvolutionStatus() {
	if s.selfEvolution == nil || !s.selfEvolution.Enabled() {
		return
	}
	status, err := s.selfEvolution.LastStatus()
	if err != nil || status.SessionID == "" {
		return
	}
	state := ""
	finalize := false
	switch status.Phase {
	case "rollback_restored", "rolled_back_runtime":
		state = "verified"
		finalize = true
	case "restart_pending", "restart_failed":
		state = "restart_pending"
	case "restart_scheduled", "restarting":
		state = "restart_scheduled"
	case "restarted":
		state = "applied"
		finalize = true
	default:
		return
	}
	if transaction, txErr := s.selfEvolution.TransactionForStatus(status); txErr == nil {
		detail := status.Detail
		if status.Phase == "restarted" {
			detail = ""
		}
		if s.updateSelfEvolutionBatchSessions(transaction, state, detail) > 0 {
			if finalize {
				transaction.Finalize()
			}
			return
		}
	}
	updated, err := s.store.Update(status.SessionID, func(current *domain.Session) error {
		if !s.isSelfEvolution(*current) || current.Plan == nil || current.Plan.PlanID != status.PlanID {
			return nil
		}
		current.SelfEvolution = true
		if state == "restart_pending" || state == "restart_scheduled" {
			current.SelfEvolutionActivation = state
		} else {
			current.SelfEvolutionActivation = ""
		}
		current.State = state
		if status.Phase == "restarted" {
			current.LastRepairError = ""
		} else if status.Detail != "" {
			current.LastRepairError = status.Detail
		}
		return nil
	})
	if err == nil && updated.ID != "" {
		s.bus.Publish(status.SessionID, "self_evolution.status_reconciled", map[string]any{"plan_id": status.PlanID, "phase": status.Phase, "state": state, "detail": status.Detail})
	}
}

func planPatches(plan *domain.ExecutionPlan) []string {
	if plan == nil {
		return nil
	}
	patches := make([]string, 0)
	for _, op := range plan.Operations {
		if op.Type == "apply_patch" && strings.TrimSpace(op.Patch) != "" {
			patches = append(patches, op.Patch)
		}
	}
	return patches
}

func planHasPatch(plan *domain.ExecutionPlan) bool { return len(planPatches(plan)) > 0 }

func planExecutionAlreadyCompleted(item domain.Session, planID string) bool {
	if strings.TrimSpace(planID) == "" {
		return false
	}
	if item.LastExecution != nil && item.LastExecution.Success && item.LastExecution.PlanID == planID {
		return true
	}
	for _, change := range item.PendingHostChanges {
		if change.Plan.PlanID == planID && change.Execution.Success {
			return true
		}
	}
	for _, change := range item.LastAppliedChanges {
		if change.Plan.PlanID == planID && change.Execution.Success {
			return true
		}
	}
	return false
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
