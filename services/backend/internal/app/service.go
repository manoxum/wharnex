package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/bundlename"
	"kernl.local/harness/backend/internal/changeset"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/crossproject"
	"kernl.local/harness/backend/internal/directives"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/executionbundle"
	"kernl.local/harness/backend/internal/gitsettings"
	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/pendingcommit"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/projectconfig"
	"kernl.local/harness/backend/internal/projectgit"
	"kernl.local/harness/backend/internal/protocol"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/sandboxenv"
	"kernl.local/harness/backend/internal/selfevolution"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/translation"
	"kernl.local/harness/backend/internal/utility"
	"kernl.local/harness/backend/internal/workspacefs"
)

var (
	ErrApprovalRequired                   = errors.New("explicit approval required")
	ErrExecutionRequired                  = errors.New("successful sandbox execution required before host apply")
	ErrExecutionInProgress                = errors.New("execution already in progress or pending recovery")
	ErrRemoteStorageConnectorUnavailable  = errors.New("remote storage connector is unavailable")
	ErrTunnelProviderConnectorUnavailable = errors.New("tunnel provider connector is unavailable")
	ErrExecutionBundleRequestMismatch     = errors.New("execution bundle filename/request_id mismatch")
	ErrExecutionBundleNotPending          = errors.New("execution bundle request_id is not pending for this chat/session")
	ErrIntegrationConflict                = errors.New("verified changes require focused conflict resolution")
	// A conflict confined to Wharnex-managed project state. It is terminal and
	// local: no planner bundle can resolve it, because the patch validator
	// refuses that subtree before conflict-specific validation runs. Reporting it
	// as ErrIntegrationConflict offered a resolution path that cannot exist.
	ErrManagedStateConflict = errors.New("integration conflict is confined to Wharnex-managed project state and is reconciled locally")
	ErrStaleHostBaseline    = errors.New("verified candidate requires host baseline revalidation")
	ErrHostIntegrationRace  = errors.New("host changed repeatedly during ChangeSet integration")
)

type BundleSubmission struct {
	Session      domain.Session `json:"session"`
	AutoExecuted bool           `json:"auto_executed"`
	AutoApplied  bool           `json:"auto_applied"`
	// CrossProject reports what happened to each project this response was
	// granted authority over, including the units that were never attempted.
	CrossProject           []CrossProjectOutcome   `json:"cross_project,omitempty"`
	AutoError              string                  `json:"auto_error,omitempty"`
	Execution              *domain.ExecutionResult `json:"execution,omitempty"`
	PolicyBlocked          bool                    `json:"policy_blocked,omitempty"`
	PolicyReasons          []string                `json:"policy_reasons,omitempty"`
	RepairPrepared         bool                    `json:"repair_prepared,omitempty"`
	ConflictPrepared       bool                    `json:"conflict_prepared,omitempty"`
	WorkflowExecuted       bool                    `json:"workflow_executed,omitempty"`
	WorkflowPrepared       bool                    `json:"workflow_prepared,omitempty"`
	WorkflowRound          int                     `json:"workflow_round,omitempty"`
	RestartScheduled       bool                    `json:"restart_scheduled,omitempty"`
	RestartRequired        bool                    `json:"restart_required,omitempty"`
	RemoteRecoveryPrepared bool                    `json:"remote_recovery_prepared,omitempty"`
}

// maxRetainedProjectRevisions bounds the self-observed baseline history a
// session keeps (domain.Session.ProjectRevisions). canFastForwardBaseline
// walks this history to reconcile a pending plan against external filesystem
// changes it never saw applied through Wharnex's own Host Apply pipeline —
// a co-editing tool, a manual git operation, another IDE. A long-pending plan
// under active concurrent development needs a window wide enough to still
// find an unbroken chain back to the SHA it was verified against; 64 was
// observed to be exhausted within a single active editing session.
const maxRetainedProjectRevisions = 512

// maxRetainedBaselineNotices bounds the peer-apply-notified baseline history
// a session keeps (domain.Session.BaselineNotices) — the other of the two
// sources canFastForwardBaseline walks. See maxRetainedProjectRevisions.
const maxRetainedBaselineNotices = 200

type Service struct {
	store                   *session.Store
	bus                     *audit.Bus
	context                 *contextbundle.Builder
	planner                 planner.Planner
	policy                  *policy.Engine
	runner                  sandbox.Runner
	hostRunner              sandbox.Runner
	selfEvolution           *selfevolution.Manager
	remoteInputs            RemoteInputStore
	remoteStorageConnector  RemoteStorageConnector
	tunnelProviders         []TunnelProviderDescriptor
	tunnelProviderConnector TunnelProviderConnector
	remoteLeaseMu           sync.Mutex
	remoteLeases            map[string]map[string]remoteInputLease
	remoteChannels          map[string]*remoteInputChannelState
	devMu                   sync.Mutex
	devspaces               map[string]sandbox.Workspace
	terminalMu              sync.Mutex
	terminals               map[string]*terminalSessionState
	applyMu                 sync.Mutex
	projectApplyLocks       map[string]*sync.Mutex
	executionQueue          *projectExecutionQueue
	orchestrator            *orchestrator.Store
	orchestratorMu          sync.Mutex
	orchestratorLocks       map[string]*sync.Mutex
	artifactStore           ArtifactObjectStore
	environment             *sandboxenv.Prober
	artifactRetentionDays   atomic.Int64
	bundleWindowLimit       atomic.Int64
	runtimeInstanceID       string
	gitSettingsFile         string
	gitSettingsMu           sync.Mutex
	pendingCommits          *pendingcommit.Store
	interactiveDBMu         sync.RWMutex
	interactiveDB           map[string]PostgresConnection
	interactiveCancelMu     sync.Mutex
	interactiveCancels      map[string]context.CancelFunc
}

func (s *Service) SetRuntimeInstanceID(id string) { s.runtimeInstanceID = strings.TrimSpace(id) }

// translationWorkerPayload is what the Desktop worker is handed.
//
// It carries the request bundle itself, already built and already sealed by the
// engine that will validate the answer. The worker's job is reduced to
// transport: upload this archive, ask for exactly this filename back, and
// return the bytes. It composes no instruction and reads no prose, so there is
// nothing left for it to get subtly wrong.
type translationWorkerPayload struct {
	Protocol        string `json:"protocol"`
	Task            string `json:"task"`
	TaskID          string `json:"task_id"`
	TargetLanguage  string `json:"target_language"`
	RequestFilename string `json:"request_filename"`
	ResultFilename  string `json:"result_filename"`
	Bootstrap       string `json:"bootstrap"`
	ArchiveBase64   string `json:"archive_base64"`
	ReasoningEffort string `json:"reasoning_effort"`
}

// translationWorkerResult is what the worker returns on completion: the exact
// bytes it downloaded, unread and uninterpreted.
type translationWorkerResult struct {
	Protocol     string `json:"protocol"`
	TaskID       string `json:"task_id"`
	Filename     string `json:"filename"`
	BundleBase64 string `json:"bundle_base64"`
}

func (s *Service) TranslateMarkdown(ctx context.Context, sessionID string, target utility.LanguageCode, markdown string) (utility.Result, error) {
	currentSession, err := s.GetSession(sessionID)
	if err != nil {
		return utility.Result{}, err
	}
	request := utility.Request{Protocol: utility.ProtocolV1, Task: utility.TaskTranslateMarkdown, TargetLanguage: target, Markdown: markdown}
	if err := utility.ValidateRequest(request); err != nil {
		return utility.Result{}, err
	}
	if markdown == "" {
		return utility.Result{Protocol: utility.ProtocolV1, Task: utility.TaskTranslateMarkdown, TargetLanguage: target}, nil
	}
	// The id is minted here because the protocol's filenames are derived from
	// it: the request bundle cannot be built without knowing what the answer
	// will be called.
	taskID := session.NewChatAgentTaskID()
	chatID := currentSession.ChatID
	if chatID == "" {
		chatID = currentSession.ID
	}
	chatHash := currentSession.Context.WorkspaceSHA256
	if chatHash == "" {
		chatHash = currentSession.Context.Manifest.SHA256
	}
	manifest, archive, err := translation.BuildRequestWithMetadata(taskID, string(target), markdown, translation.RequestMetadata{
		ChatTitle: "Document translation", ChatID: chatID, ChatHash: chatHash, RequestedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return utility.Result{}, err
	}
	payload, err := json.Marshal(translationWorkerPayload{
		Protocol: translation.RequestProtocolV1, Task: translation.TaskTranslateDocument, TaskID: taskID,
		TargetLanguage: manifest.TargetLanguage, RequestFilename: manifest.RequestFilename,
		ResultFilename: manifest.ResultFilename, Bootstrap: translation.RequestBootstrap(manifest),
		ArchiveBase64: base64.StdEncoding.EncodeToString(archive), ReasoningEffort: string(domain.ReasoningEffortInstant),
	})
	if err != nil {
		return utility.Result{}, fmt.Errorf("encode translation task: %w", err)
	}
	task, err := s.store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "TRANSLATE_MARKDOWN", TaskID: taskID, ChatID: sessionID, SessionID: sessionID,
		RootRequestID: taskID, Payload: payload, MaxAttempts: 1,
	})
	if err != nil {
		return utility.Result{}, fmt.Errorf("enqueue translation worker: %w", err)
	}
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(12 * time.Minute)
	defer timeout.Stop()
	for {
		current, getErr := s.store.GetChatAgentTask(task.TaskID)
		if getErr != nil {
			return utility.Result{}, fmt.Errorf("read translation worker: %w", getErr)
		}
		switch current.Status {
		case session.ChatAgentTaskDone:
			return s.finishTranslation(current.Payload, manifest, target)
		case session.ChatAgentTaskFailed, session.ChatAgentTaskAttention, session.ChatAgentTaskCancelled:
			detail := strings.TrimSpace(current.LastError)
			if detail == "" {
				detail = "translation worker did not complete"
			}
			return utility.Result{}, fmt.Errorf("%w: %s", utility.ErrUnavailable, detail)
		}
		select {
		case <-ctx.Done():
			_, _ = s.store.CancelChatAgentLineage(taskID)
			return utility.Result{}, ctx.Err()
		case <-timeout.C:
			_, _ = s.store.CancelChatAgentLineage(taskID)
			return utility.Result{}, fmt.Errorf("%w: translation worker timed out", utility.ErrUnavailable)
		case <-ticker.C:
		}
	}
}

// finishTranslation validates the downloaded bundle against the request it
// answers. Validation lives here, not in the worker, so the side that authored
// the contract is the side that enforces it.
func (s *Service) finishTranslation(raw json.RawMessage, manifest translation.TransportManifest, target utility.LanguageCode) (utility.Result, error) {
	var delivered translationWorkerResult
	if err := json.Unmarshal(raw, &delivered); err != nil {
		return utility.Result{}, fmt.Errorf("decode translation worker result: %w", err)
	}
	bundle, err := base64.StdEncoding.DecodeString(delivered.BundleBase64)
	if err != nil {
		return utility.Result{}, fmt.Errorf("decode translation bundle bytes: %w", err)
	}
	parsed, err := translation.ParseResult(delivered.Filename, bundle, manifest)
	if err != nil {
		return utility.Result{}, fmt.Errorf("%w: %s", utility.ErrUnavailable, err.Error())
	}
	return utility.Result{
		Protocol: utility.ProtocolV1, Task: utility.TaskTranslateMarkdown,
		TargetLanguage: target, Markdown: parsed.Markdown,
	}, nil
}

func (s *Service) SetOrchestratorStore(store *orchestrator.Store) {
	if store != nil {
		s.orchestrator = store
	}
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

func (s *Service) SetTunnelProviders(providers []TunnelProviderDescriptor) {
	s.tunnelProviders = append([]TunnelProviderDescriptor(nil), providers...)
}

func (s *Service) TunnelProviders() []TunnelProviderDescriptor {
	return append([]TunnelProviderDescriptor(nil), s.tunnelProviders...)
}

func NewService(store *session.Store, bus *audit.Bus, builder *contextbundle.Builder, planner planner.Planner, policies *policy.Engine, runner sandbox.Runner) *Service {
	manager := selfevolution.New(selfevolution.DiscoverRoot())
	service := &Service{store: store, bus: bus, context: builder, planner: planner, policy: policies, runner: runner, hostRunner: sandbox.NewHostRunner(), selfEvolution: manager, devspaces: make(map[string]sandbox.Workspace), terminals: make(map[string]*terminalSessionState), projectApplyLocks: make(map[string]*sync.Mutex), executionQueue: newProjectExecutionQueue(), orchestrator: orchestrator.NewMemoryStore(), orchestratorLocks: make(map[string]*sync.Mutex), remoteLeases: make(map[string]map[string]remoteInputLease), remoteChannels: make(map[string]*remoteInputChannelState), interactiveDB: make(map[string]PostgresConnection), interactiveCancels: make(map[string]context.CancelFunc)}
	service.normalizeBaselineConcurrencySessions()
	service.normalizeSelfEvolutionSessions()
	service.normalizeKnowledgeReviewSessions()
	service.normalizeOrphanedManualRequests()
	service.normalizeFailureKinds()
	service.normalizePendingHostChanges()
	service.reconcileSelfEvolutionStatus()
	service.reconcileStrandedHostApplies()
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
	if err := s.ensureProjectVersion("", root); err != nil {
		_ = os.RemoveAll(root)
		return "", fmt.Errorf("create project VERSION: %w", err)
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
	if err := s.ensureProjectVersion("", root); err != nil {
		return "", fmt.Errorf("create project VERSION after clone: %w", err)
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

func (s *Service) StartSessionWithModes(ctx context.Context, projectPath string, executionMode domain.ExecutionMode, automationMode domain.AutomationMode, requestedEffort ...domain.EffortLevel) (domain.Session, error) {
	id := ids.New("ses")
	effortLevel := domain.EffortLevelMedium
	if len(requestedEffort) > 0 && requestedEffort[0] != "" {
		effortLevel = requestedEffort[0]
	}
	if executionMode == "" {
		executionMode = domain.ExecutionModeProtected
	}
	if automationMode == "" {
		automationMode = domain.AutomationModeAuto
	}
	selfEvolution := s.selfEvolution.IsProject(projectPath)
	if statableSelfOpenForbidden(s.runtimeInstanceID, selfEvolution) {
		return domain.Session{}, errors.New("the statable Wharnex instance cannot open itself as a project")
	}
	if selfEvolution && executionMode == domain.ExecutionModeUnprotected {
		executionMode = domain.ExecutionModeProtected
	}
	if !domain.ValidExecutionMode(executionMode) {
		return domain.Session{}, fmt.Errorf("unsupported execution mode %q", executionMode)
	}
	if !domain.ValidAutomationMode(automationMode) {
		return domain.Session{}, fmt.Errorf("unsupported automation mode %q", automationMode)
	}
	if !domain.ValidEffortLevel(effortLevel) {
		return domain.Session{}, fmt.Errorf("unsupported effort level %q", effortLevel)
	}
	if domain.AutomationModeIsAutomatic(automationMode) && executionMode != domain.ExecutionModeProtected {
		return domain.Session{}, errors.New("automatic modes require protected execution mode")
	}
	if err := s.ensureProjectVersion(id, projectPath); err != nil {
		return domain.Session{}, fmt.Errorf("prepare project VERSION: %w", err)
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
	bundle, err := s.context.BuildWorkspace(projectPath, nil)
	if err != nil {
		s.bus.Publish(id, "context.failed", map[string]any{"error": err.Error()})
		return domain.Session{}, err
	}
	knowledgeSharing := true
	item := domain.Session{ID: id, ProjectPath: bundle.Manifest.ProjectRoot, ExecutionMode: executionMode, AutomationMode: automationMode, EffortLevel: effortLevel, ReasoningEffort: domain.ReasoningEffortHigh, ChatTransportMode: domain.ChatTransportModeScraper, KnowledgeSharingEnabled: &knowledgeSharing, SelfEvolution: selfEvolution, WharnexInstanceID: detectedWharnexInstance(bundle.Manifest.ProjectRoot), State: "ready", CreatedAt: time.Now().UTC(), Context: bundle}
	if selfEvolution {
		item.WharnexInstanceID = ""
	}
	if err := s.store.Put(item); err != nil {
		if dir := ownedContextArchiveDir(bundle.ZipPath); dir != "" {
			_ = os.RemoveAll(dir)
		}
		return domain.Session{}, fmt.Errorf("persist session: %w", err)
	}
	s.bus.Publish(id, "session.created", map[string]any{"files": len(bundle.Manifest.Files), "snapshot": bundle.Manifest.SHA256, "text_truncated": bundle.Manifest.TextTruncated, "execution_mode": executionMode, "automation_mode": automationMode, "effort_level": effortLevel, "self_evolution": selfEvolution})
	return item, nil
}

func (s *Service) GetSession(sessionID string) (domain.Session, error) {
	s.reconcileSelfEvolutionStatus()
	item, err := s.store.Get(sessionID)
	return item, err
}

const maxRelatedProjects = 11

// SetRelatedProjects records the additional project roots explicitly bound by
// the user to this Agent workspace. They are rebuilt as namespaced context and
// never change this session's primary execution/apply root.
func (s *Service) SetRelatedProjects(ctx context.Context, sessionID string, projectPaths []string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.Session{}, err
	}
	if len(projectPaths) > maxRelatedProjects {
		return item, fmt.Errorf("related projects exceed the limit of %d", maxRelatedProjects)
	}
	primary, err := canonicalProjectPath(item.ProjectPath)
	if err != nil {
		return item, fmt.Errorf("resolve primary project: %w", err)
	}
	seen := map[string]bool{primary: true}
	canonical := make([]string, 0, len(projectPaths))
	for _, candidate := range projectPaths {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if !filepath.IsAbs(candidate) {
			return item, fmt.Errorf("related project path must be absolute: %s", candidate)
		}
		resolved, resolveErr := canonicalProjectPath(candidate)
		if resolveErr != nil {
			return item, fmt.Errorf("resolve related project %s: %w", candidate, resolveErr)
		}
		if seen[resolved] {
			continue
		}
		if _, ensureErr := projectgit.Ensure(ctx, resolved); ensureErr != nil {
			return item, fmt.Errorf("prepare related project git repository %s: %w", resolved, ensureErr)
		}
		seen[resolved] = true
		canonical = append(canonical, resolved)
	}
	if stringSlicesEqual(item.RelatedProjectPaths, canonical) {
		return item, nil
	}
	bundle, err := s.context.BuildWorkspace(item.ProjectPath, canonical)
	if err != nil {
		return item, fmt.Errorf("build multi-project context: %w", err)
	}
	oldDir := filepath.Dir(item.Context.ZipPath)
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.RelatedProjectPaths = append([]string(nil), canonical...)
		current.Context = bundle
		return nil
	})
	if err != nil {
		removeContextDirectory(bundle.ZipPath)
		return item, err
	}
	if oldDir != "" && oldDir != "." && oldDir != filepath.Dir(bundle.ZipPath) && !contextDirectoryReferenced(updated, oldDir) {
		_ = os.RemoveAll(oldDir)
	}
	s.bus.Publish(sessionID, "context.related_projects_changed", map[string]any{"project_paths": canonical, "projects": len(canonical), "snapshot": bundle.Manifest.SHA256})
	return updated, nil
}

func canonicalProjectPath(value string) (string, error) {
	abs, err := filepath.Abs(value)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", errors.New("project path must be an existing directory")
	}
	return filepath.Clean(resolved), nil
}

func stringSlicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func removeContextDirectory(zipPath string) {
	directory := filepath.Dir(zipPath)
	if strings.HasPrefix(filepath.Base(directory), "wharness-context-") {
		_ = os.RemoveAll(directory)
	}
}

// chatIDPattern is deliberately stricter than the desktop's own cacheKey
// pattern (which allows '_'): '_' is the field separator in the
// whx_bundle_<req|res>_<chatid>_<request_id>[_<subrequest_id>].zip naming
// scheme, so a chat id containing one would make the name ambiguous to
// parse. Every real chat id is a crypto.randomUUID() (hex and hyphens only),
// so this never rejects an actual chat in practice.
var chatIDPattern = regexp.MustCompile(`^[A-Za-z0-9-]{1,128}$`)

// SetChatID records the frontend's chat identifier against a session so
// bundle filenames can be scoped to it. It is validated, not trusted: a
// value containing '_' would make whx_bundle_* names ambiguous to parse.
func (s *Service) SetChatID(sessionID, chatID string) (domain.Session, error) {
	chatID = strings.TrimSpace(chatID)
	if chatID == "" {
		return s.store.Get(sessionID)
	}
	if !chatIDPattern.MatchString(chatID) {
		return domain.Session{}, fmt.Errorf("invalid chat_id %q", chatID)
	}
	return s.store.Update(sessionID, func(item *domain.Session) error {
		if item.ChatID != "" && item.ChatID != chatID {
			return fmt.Errorf("session is already owned by chat_id %q", item.ChatID)
		}
		item.ChatID = chatID
		return nil
	})
}

func (s *Service) DeleteSession(sessionID string) error {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return err
	}
	s.resetDevspace(sessionID)
	if s.artifactStore != nil {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		for _, artifact := range item.Artifacts {
			if artifact.ObjectKey != "" {
				if err := s.artifactStore.Delete(ctx, artifact.ObjectKey); err != nil {
					return fmt.Errorf("delete artifact %s: %w", artifact.ID, err)
				}
			}
		}
		// An already-compacted chat has no per-artifact objects left (see
		// chat_archive_compaction.go) — only its single package remains.
		if item.ArchivePackage != nil {
			if err := s.artifactStore.Delete(ctx, item.ArchivePackage.ObjectKey); err != nil {
				return fmt.Errorf("delete chat archive package: %w", err)
			}
		}
	}
	if err := s.store.Delete(sessionID); err != nil {
		return err
	}
	// Deleting a chat explicitly cancels any pending remote request, so it is a
	// terminal lifecycle event for its transient tunnel leases.
	s.releaseSupersededRemoteInputLeases(sessionID, nil)
	s.closeRemoteInputChannel(sessionID, "request.cancelled")
	for _, dir := range ownedContextDirs(item) {
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
			return errors.New("Wharnex self-evolution is locked to Protected execution mode")
		}
		if mode == domain.ExecutionModeUnprotected && len(pendingHostChanges(*current)) > 0 {
			return errors.New("apply or reject the pending Protected changes before switching to Unprotected mode")
		}
		if mode == domain.ExecutionModeUnprotected && domain.AutomationModeIsAutomatic(current.AutomationMode) {
			return errors.New("disable automatic mode before switching to unprotected")
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

func (s *Service) SetEffortLevel(sessionID string, level domain.EffortLevel) (domain.Session, error) {
	if !domain.ValidEffortLevel(level) {
		return domain.Session{}, fmt.Errorf("unsupported effort level %q", level)
	}
	item, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.EffortLevel = level
		return nil
	})
	if err != nil {
		return domain.Session{}, err
	}
	s.bus.Publish(sessionID, "effort.level_changed", map[string]any{"effort_level": level})
	return item, nil
}

func (s *Service) SetReasoningEffort(sessionID string, effort domain.ReasoningEffort) (domain.Session, error) {
	if !domain.ValidReasoningEffort(effort) {
		return domain.Session{}, fmt.Errorf("unsupported reasoning effort %q", effort)
	}
	item, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.ReasoningEffort = effort
		return nil
	})
	if err != nil {
		return domain.Session{}, err
	}
	s.bus.Publish(sessionID, "reasoning.effort_changed", map[string]any{"reasoning_effort": effort})
	return item, nil
}

func (s *Service) SetAutomationMode(sessionID string, mode domain.AutomationMode) (domain.Session, error) {
	if !domain.ValidAutomationMode(mode) {
		return domain.Session{}, fmt.Errorf("unsupported automation mode %q", mode)
	}
	item, err := s.store.Update(sessionID, func(current *domain.Session) error {
		if domain.AutomationModeIsAutomatic(mode) && current.ExecutionMode != domain.ExecutionModeProtected {
			return errors.New("automatic modes require protected execution mode")
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

// SetChatTransportMode switches this chat between Scraper (Desktop drives
// the embedded ChatGPT DOM, as it always has) and Manual (Desktop never
// touches that DOM; the prompt is only ever shown for the human to
// copy/paste, and a response bundle is only ever imported by explicit
// human upload). No invariant with AutomationMode/ExecutionMode: Manual
// transport combines validly with any of them, including Auto — Wharnex
// still decides execute/apply automatically, only the conversation
// transport is human-driven.
func (s *Service) SetChatTransportMode(sessionID string, mode domain.ChatTransportMode) (domain.Session, error) {
	if !domain.ValidChatTransportMode(mode) {
		return domain.Session{}, fmt.Errorf("unsupported chat transport mode %q", mode)
	}
	item, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.ChatTransportMode = mode
		return nil
	})
	if err != nil {
		return domain.Session{}, err
	}
	s.bus.Publish(sessionID, "chat_transport.mode_changed", map[string]any{"chat_transport_mode": mode})
	return item, nil
}

func (s *Service) SubmitMessage(ctx context.Context, sessionID, message string) (planner.Result, domain.Session, error) {
	return s.SubmitMessageWithMode(ctx, sessionID, message, "direct")
}

func (s *Service) SubmitMessageWithMode(ctx context.Context, sessionID, message, planningMode string) (planner.Result, domain.Session, error) {
	return s.submitPlannerRequest(ctx, sessionID, message, planningMode, "", requestKindStandard)
}

func (s *Service) SubmitPlanApproval(ctx context.Context, sessionID, parentRequestID string) (planner.Result, domain.Session, error) {
	parentRequestID = strings.TrimSpace(parentRequestID)
	if parentRequestID == "" {
		return planner.Result{}, domain.Session{}, errors.New("plan request_id is required")
	}
	current, err := s.store.Get(sessionID)
	if err != nil {
		return planner.Result{}, domain.Session{}, err
	}
	if current.LastRequestID != parentRequestID || current.State != "awaiting_plan_approval" || current.LastTurn == nil || current.LastTurn.RequestID != parentRequestID || current.LastTurn.Kind != domain.TurnKindPlan || current.LastTurn.Outcome == nil || current.LastTurn.Outcome.Status != domain.TurnOutcomeCompleted {
		return planner.Result{}, current, errors.New("plan approval requires the latest pending completed plan proposal")
	}
	approved := approvedChatPlan(parentRequestID, current.LastTurn.Message)
	if current, err = s.store.Update(sessionID, func(item *domain.Session) error { item.ApprovedChatPlan = approved; return nil }); err != nil {
		return planner.Result{}, current, err
	}
	message := fmt.Sprintf("PLAN APPROVAL CONTINUATION\nParent request: %s\nApproved plan protocol: %s\nApproved plan SHA-256: %s\nThe user approved the following plan proposal. Implement exactly this approved scope now and echo it unchanged in plan.approved_chat_plan.\n\n%s", parentRequestID, approved.Protocol, approved.SHA256, approved.Document)
	return s.submitPlannerRequest(ctx, sessionID, message, "approve_plan", parentRequestID, requestKindPlanApproval)
}

func (s *Service) RejectPlan(sessionID, requestID string) (domain.Session, error) {
	requestID = strings.TrimSpace(requestID)
	current, err := s.store.Get(sessionID)
	if err != nil {
		return domain.Session{}, err
	}
	if requestID == "" || current.LastRequestID != requestID || current.State != "awaiting_plan_approval" || current.LastTurn == nil || current.LastTurn.RequestID != requestID || current.LastTurn.Kind != domain.TurnKindPlan {
		return domain.Session{}, errors.New("plan rejection requires the latest pending plan proposal")
	}
	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		item.State = "plan_rejected"
		return nil
	})
	if err != nil {
		return domain.Session{}, err
	}
	s.closeRemoteInputChannel(sessionID, "plan.rejected")
	s.bus.Publish(sessionID, "plan.proposal_rejected", map[string]any{"request_id": requestID})
	if committed, commitErr := s.commitPendingKnowledge(sessionID, requestID); commitErr == nil {
		updated = committed
	}
	return updated, nil
}

func (s *Service) submitPlannerRequest(ctx context.Context, sessionID, message, planningMode, parentRequestID, requestKind string) (planner.Result, domain.Session, error) {
	planningMode = strings.ToLower(strings.TrimSpace(planningMode))
	if planningMode == "" {
		planningMode = "direct"
	}
	if planningMode != "direct" && planningMode != "plan_first" && planningMode != "approve_plan" && planningMode != "correct_plan" && planningMode != "adjust_plan" {
		return planner.Result{}, domain.Session{}, fmt.Errorf("unsupported planning mode %q", planningMode)
	}
	message = directives.Canonicalize(message)
	operatorMessage := message
	// Attachments are resolved before the context is built, because they are
	// part of it: an `@attach` marker that arrives after the snapshot points at
	// material the model was never sent.
	attachments, refusedAttachments := s.resolveMessageAttachments(sessionID, message)
	item, err := s.refreshContextWithDirectiveSelections(sessionID, attachments, message)
	if err != nil {
		return planner.Result{}, domain.Session{}, err
	}
	requestID := ids.New("req")
	linkedTodos, err := s.resolveProjectTodos(item.ProjectPath, projectTodoIDsFromMessage(message))
	if err != nil {
		return planner.Result{}, item, err
	}
	message = messageWithProjectTodos(message, linkedTodos)
	// Normalize the operator's own directives first, so every later reader —
	// the grant resolver, the legend, the model, and this prompt re-parsed on a
	// continuation — sees one spelling. The markers stay where they were
	// written; only how they are spelled changes.
	message = directives.Canonicalize(message)
	legend := directiveLegendWithContext(message, item.Context)
	// The `@ref:` directives in this prompt are the only place a request can
	// acquire authority over another project, and it is resolved before the
	// planner is asked — so what comes back is checked against what the operator
	// actually wrote, never the other way round. It is resolved from the
	// operator's own text, before Wharnex appends any scope metadata of its own.
	crossGrant, unresolvedRefs := s.crossProjectGrantForRequest(item, message, requestID, parentRequestID)
	// A reference may name a project Wharnex knows but this session has not
	// attached. Bringing its context in is what makes the reference mean
	// anything: without it the prompt names a project the model cannot see.
	if attached, changed := s.attachGrantedProjectContexts(ctx, sessionID, item, crossGrant); changed {
		item = attached
		// SetRelatedProjects rebuilds with project defaults. Restore this
		// request's external attachments and per-@ref selections before the
		// prompt or transport observes the snapshot.
		if refreshed, refreshErr := s.refreshContextWithDirectiveSelections(sessionID, attachments, message); refreshErr == nil {
			item = refreshed
		}
		legend = directiveLegendWithContext(message, item.Context)
	}
	message += legend
	message = messageWithRelatedProjects(message, item.ProjectPath, item.Context.RelatedProjects, crossproject.GrantedPaths(crossGrant))
	message = messageWithCrossProjectGrant(message, crossGrant, unresolvedRefs, s.openGrantedProjects(crossGrant))
	message = messageWithAttachments(message, item.Context.Attachments, refusedAttachments)
	message = messageWithPendingHostChanges(message, item.PendingHostChanges, item.LastRepairError)
	requestBaselineSHA := strings.TrimSpace(item.Context.Manifest.SHA256)
	if parentRequestID == "" {
		if refreshed, clearErr := s.store.Update(sessionID, func(current *domain.Session) error {
			current.PendingKnowledgeRootRequestID = ""
			current.PendingKnowledgeCandidateRequestID = ""
			current.PendingKnowledgeCandidate = nil
			current.PendingKnowledgeSummary = ""
			current.LastMainRequestSummary = ""
			// The attempt ledger has exactly the lifetime of one Main Request:
			// it records what worked and failed while pursuing THIS goal, so
			// carrying it into the next goal would have the planner excluding
			// approaches for a problem nobody asked about.
			resetAttemptLedger(current, requestID)
			current.AutomationAttempt = 1
			current.ImprovementAttempt = 0
			current.DebugApprovedRootID = ""
			current.ApprovedChatPlan = nil
			current.ExecutionApprovedRootID = ""
			current.ApprovedBoundaryKeys = nil
			return nil
		}); clearErr == nil {
			item = refreshed
		}
	}
	// Capture one immutable knowledge identity for this request. Transport
	// materialization later reuses this exact snapshot instead of reading the
	// mutable project knowledge again.
	knowledgeSnapshot, err := s.loadRequestKnowledge(sessionID, item.ProjectPath)
	if err != nil {
		return planner.Result{}, item, err
	}
	// Anchor the exact host tree this request is planned against, alongside the
	// context snapshot that describes it. A patch the model writes from here is
	// authored for this tree, so recording it now is what lets execution apply
	// that patch to the tree it was written for however far the host advances
	// before the plan comes back.
	baseCommit := s.captureRequestBase(ctx, sessionID, item.ProjectPath, requestID)
	// A granted project needs the same immutable base, for the same reason: the
	// patch this request comes back with was authored against the tree it is
	// being shown now.
	s.captureCrossProjectBases(ctx, sessionID, requestID, crossGrant)
	// A plan-approval continuation stays inside the same Main Request, so it is
	// entitled to the same divergence report every other continuation gets. A
	// brand-new Main Request has no earlier snapshot to diverge from and the
	// computation returns nothing.
	contextDelta := s.computeContextDelta(ctx, item, knowledgeReviewRoot(item, parentRequestID), requestID, baseCommit)
	var releasedBases []string
	var prunedContexts []string
	trackedItem, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.LastRequestID = requestID
		current.LastRequestMode = planningMode
		current.PlannerInFlight = true
		// A continuation inherits the grant unchanged; a new Main Request
		// replaces it, including replacing it with nothing.
		if strings.TrimSpace(parentRequestID) == "" {
			current.CrossProjectGrant = crossGrant
		}
		current.RemoteRecoveryAttempt = 0
		recordRequestLineage(current, requestID, parentRequestID, requestKind)
		if parentRequestID == "" && requestKind == requestKindStandard {
			recordRequestSupportArtifact(current, requestID, mainRequestArtifactPath, []byte(operatorMessage))
		}
		if requestKind == requestKindPlanAdjustment {
			recordRequestSupportArtifact(current, requestID, adjustmentRequestArtifactPath, []byte(operatorMessage))
		}
		recordRequestBaseline(current, requestID, requestBaselineSHA)
		prunedContexts = append(prunedContexts, recordRequestContext(current, requestID, item.Context)...)
		releasedBases = recordRequestBaseCommit(current, requestID, baseCommit)
		recordRequestContextDelta(current, requestID, contextDelta)
		recordRequestKnowledge(current, requestID, knowledgeSnapshot)
		return nil
	})
	if err != nil {
		return planner.Result{}, item, err
	}
	item = trackedItem
	s.cleanupPrunedRequestContexts(prunedContexts)
	s.releaseRequestBaseRefs(ctx, sessionID, item.ProjectPath, releasedBases)
	if err := s.linkProjectTodos(linkedTodos, item, requestID, "chat"); err != nil {
		s.setProjectTodosByRequestLineage(item, requestID, domain.ProjectTodoExecutionFailed, err.Error())
		return planner.Result{}, item, err
	}
	s.bus.Publish(sessionID, "planner.started", map[string]any{"request_id": requestID, "base_context_sha256": requestBaselineSHA, "planning_mode": planningMode, "parent_request_id": parentRequestID})
	expectedFilename := expectedResponseBundleFilename(item, requestID)
	if parentRequestID != "" {
		expectedFilename = expectedResponseBundleFilenameForDerivedRequest(item, requestID, parentRequestID)
	}
	result, err := s.planner.Plan(ctx, s.plannerRequest(ctx, planner.Request{SessionID: sessionID, RequestID: requestID, ParentRequestID: parentRequestID, Message: message, ContextTextPath: item.Context.TextPath, ContextManifest: item.Context.Manifest, PreviousResponseID: item.LastProviderResponseID, AutomationMode: item.AutomationMode, SelfEvolution: s.isSelfEvolution(item), PlanningMode: planningMode, ExpectedBundleFilename: expectedFilename}, knowledgeSnapshot, item.ProjectPath))
	if err != nil {
		_, _ = s.store.Update(sessionID, func(current *domain.Session) error {
			if current.LastRequestID == requestID {
				current.PlannerInFlight = false
			}
			return nil
		})
		s.bus.Publish(sessionID, "planner.failed", map[string]any{"error": err.Error()})
		s.setProjectTodosByRequestLineage(item, requestID, domain.ProjectTodoExecutionFailed, err.Error())
		return planner.Result{}, item, err
	}
	if result.ManualPrompt != "" {
		if latest, latestErr := s.store.Get(sessionID); latestErr == nil && latest.Context.Manifest.SHA256 != requestBaselineSHA {
			requestBaselineSHA = latest.Context.Manifest.SHA256
			result.ManualPrompt = planner.BuildManualPrompt(s.plannerRequest(ctx, planner.Request{SessionID: sessionID, RequestID: requestID, Message: message, ContextTextPath: latest.Context.TextPath, ContextManifest: latest.Context.Manifest, PreviousResponseID: latest.LastProviderResponseID, AutomationMode: latest.AutomationMode, SelfEvolution: s.isSelfEvolution(latest), PlanningMode: planningMode, ExpectedBundleFilename: expectedResponseBundleFilename(latest, requestID)}, knowledgeSnapshot, latest.ProjectPath))
		}
	}
	enrichPlanConcurrency(result.Plan, requestBaselineSHA)
	if err := normalizePlannerResult(requestID, &result); err != nil {
		s.setProjectTodosByRequestLineage(item, requestID, domain.ProjectTodoExecutionFailed, err.Error())
		_, _ = s.store.Update(sessionID, func(current *domain.Session) error {
			if current.LastRequestID == requestID {
				current.PlannerInFlight = false
			}
			return nil
		})
		return planner.Result{}, item, err
	}
	prunedContexts = nil
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.LastManualPrompt = result.ManualPrompt
		current.LastRequestID = requestID
		current.PlannerInFlight = false
		recordRequestBaseline(current, requestID, requestBaselineSHA)
		prunedContexts = append(prunedContexts, recordRequestContext(current, requestID, item.Context)...)
		current.RepairAttempt = 0
		current.RepairParentPlanID = ""
		clearSessionFailure(current)
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
				if result.Plan.Debug != nil && !debugAuthorized(*current) {
					current.State = "debug_approval_required"
				} else {
					current.State = "workflow_planned"
				}
			} else {
				current.State = "planned"
			}
			current.LastExecution = nil
		} else if result.Turn != nil {
			current.LastBundle = nil
			if result.Turn.Outcome != nil && result.Turn.Outcome.Status != domain.TurnOutcomeCompleted {
				applyPlannerFailure(current, result.Turn.Outcome)
			} else {
				current.Plan = nil
				current.Policy = nil
				current.LastExecution = nil
				current.State = turnState(result.Turn.Kind)
			}
		}
		return nil
	})
	if err != nil {
		s.bus.Publish(sessionID, "plan.rejected", map[string]any{"error": err.Error()})
		return planner.Result{}, item, err
	}
	s.cleanupPrunedRequestContexts(prunedContexts)
	s.releaseSupersededRemoteInputLeases(sessionID, updated.PendingManualRequestIDs)
	if parentRequestID == "" {
		s.closeSupersededRemoteInputChannel(sessionID, requestID)
	}
	if result.Plan != nil {
		s.recordPlanActivity(sessionID, result.Plan)
		s.bus.Publish(sessionID, "plan.received", map[string]any{"plan_id": result.Plan.PlanID, "allowed": updated.Policy.Allowed, "requires_approval": updated.Policy.RequiresApproval, "risk": updated.Policy.Risk})
	} else if result.ManualPrompt != "" {
		s.bus.Publish(sessionID, "manual.prompt_ready", map[string]any{"request_id": requestID})
	} else if result.Turn != nil {
		if result.Turn.Outcome != nil && result.Turn.Outcome.Status != domain.TurnOutcomeCompleted {
			s.bus.Publish(sessionID, "turn.failed", map[string]any{"request_id": requestID, "outcome": result.Turn.Outcome.Status, "reason_code": result.Turn.Outcome.ReasonCode, "retryable": result.Turn.Outcome.Retryable, "transport": "provider", "failure_kind": updated.FailureKind})
			if updated.FailureKind == domain.FailureKindOfflineGoModuleCache {
				s.bus.Publish(sessionID, "sandbox.dependency_network_approval_required", map[string]any{"plan_id": requestID, "error": updated.LastRepairError, "scope": "go_dependency_commands"})
			}
		} else {
			s.bus.Publish(sessionID, "turn.received", map[string]any{"request_id": requestID, "kind": result.Turn.Kind, "transport": "provider"})
		}
	}
	if result.Plan != nil && result.Turn != nil && result.Turn.Kind == domain.TurnKindWorkflow {
		isDebug := result.Plan.Debug != nil
		if isDebug && !debugAuthorized(updated) {
			s.bus.Publish(sessionID, "debug.approval_required", map[string]any{"plan_id": result.Plan.PlanID, "request_id": result.Plan.RequestID, "target": result.Plan.Debug.Target})
			return result, updated, nil
		}
		if !isDebug && !domain.AutomationModeIsAutomatic(updated.AutomationMode) {
			return planner.Result{}, updated, errors.New("workflow turn requires a project automatic mode; return a terminal answer/investigation or enable Auto/Auto + Approve")
		}
		workflow, workflowErr := s.runWorkflowLoop(ctx, sessionID, "provider")
		if workflowErr != nil {
			return planner.Result{}, updated, workflowErr
		}
		updated = workflow.Session
	} else if result.Plan != nil && domain.AutomationModeIsAutomatic(updated.AutomationMode) && updated.Policy != nil && result.Plan.Status == "ready" {
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
	if len(linkedTodos) > 0 {
		switch {
		case updated.State == "applied" || updated.State == "restart_pending":
			s.setProjectTodosByRequestLineage(updated, requestID, domain.ProjectTodoExecutionDone, "")
		case updated.State == "failed":
			s.setProjectTodosByRequestLineage(updated, requestID, domain.ProjectTodoExecutionFailed, updated.LastRepairError)
		case result.Turn != nil && result.Turn.Outcome != nil && result.Turn.Outcome.Status != domain.TurnOutcomeCompleted:
			s.setProjectTodosByRequestLineage(updated, requestID, domain.ProjectTodoExecutionFailed, result.Turn.Outcome.Message)
		case result.Turn != nil && result.Turn.Kind == domain.TurnKindBlocked:
			s.setProjectTodosByRequestLineage(updated, requestID, domain.ProjectTodoExecutionFailed, "request blocked")
		case result.Plan == nil && result.Turn != nil && (result.Turn.Kind == domain.TurnKindAnswer || result.Turn.Kind == domain.TurnKindInvestigation):
			s.setProjectTodosByRequestLineage(updated, requestID, domain.ProjectTodoExecutionDone, "")
		}
	}
	// v2 knowledge is carried inside every ordinary response bundle and no
	// longer schedules a post-terminal knowledge_review. Provider-only turns
	// have no file bundle, so there is nothing to stage/commit here.
	return result, updated, nil
}

func messageWithRelatedProjects(message, primary string, related []domain.RelatedProjectContext, granted []string) string {
	if len(related) == 0 {
		return message
	}
	var builder strings.Builder
	builder.WriteString(message)
	builder.WriteString("\n\nMULTI-PROJECT WORKSPACE (Wharnex-owned scope metadata):\n")
	builder.WriteString("Primary project and execution root: ")
	builder.WriteString(primary)
	builder.WriteString("\nRelated project contexts are available under ref-context/ namespaces in the request bundle:\n")
	for _, project := range related {
		fmt.Fprintf(&builder, "- %s (%s): %s\n", project.Name, project.ProjectPath, requestArchiveRelatedPrefix(project.Prefix))
	}
	builder.WriteString("Analyze cross-project contracts and dependencies as needed.")
	// Which of these contexts may be changed is decided by the request's own
	// `@ref:` grant, stated immediately below. Repeating the old blanket "only
	// the primary project" rule here would contradict that grant in the same
	// prompt, so this block stops at describing the contexts.
	if len(granted) == 0 {
		builder.WriteString(" This response's executable plan may mutate only the primary project. When a related project also needs changes, name that project and the required follow-up clearly; Wharnex will execute it through that project's own session, Policy check, Protected sandbox, verification, and explicit Apply.")
	} else {
		builder.WriteString(" Which of these projects this response may change is stated in the cross-project write grant below; every project not listed there is reference material only.")
	}
	return builder.String()
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
	if notes := protocol.NormalizeCommandBudgets(&plan); len(notes) > 0 {
		s.bus.Publish(sessionID, "plan.budgets_normalized", map[string]any{"request_id": plan.RequestID, "adjustments": notes})
	}
	enrichPlanConcurrency(&plan, requestBaseline(current, plan.RequestID))
	currentSHA := strings.TrimSpace(current.Context.Manifest.SHA256)
	if plan.BaseContextSHA256 != "" && currentSHA != "" && plan.BaseContextSHA256 != currentSHA {
		if canFastForwardPlanBaseline(current, &plan, plan.BaseContextSHA256, currentSHA) {
			s.bus.Publish(sessionID, "baseline.plan_fast_forwarded", map[string]any{"request_id": plan.RequestID, "from_sha256": plan.BaseContextSHA256, "to_sha256": currentSHA})
			plan.BaseContextSHA256 = currentSHA
		} else {
			return domain.Session{}, fmt.Errorf("manual plan baseline %s is superseded by current baseline %s", plan.BaseContextSHA256, currentSHA)
		}
	}
	if err := augmentConflictResolutionPlan(current, &plan); err != nil {
		return domain.Session{}, fmt.Errorf("conflict resolution protocol: %w", err)
	}
	if err := protocol.ValidateChangePlan(plan); err != nil {
		return domain.Session{}, err
	}
	if err := validateConflictResolutionPlan(current, &plan); err != nil {
		return domain.Session{}, fmt.Errorf("conflict resolution protocol: %w", err)
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
		s.releaseRemoteInputLease(sessionID, plan.RequestID)
		s.recordPlanActivity(sessionID, &plan)
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
	// A command timeout that is missing, zero or above the accepted ceiling
	// is a pure transport mistake: rejecting the bundle over it discards a
	// correct patch and costs a full round trip (observed twice in a row in
	// production). Repair it narrowly here, before validation, and record
	// exactly what changed rather than reinterpreting the plan silently.
	if notes := protocol.NormalizeCommandBudgets(parsed.Plan); len(notes) > 0 {
		s.bus.Publish(sessionID, "plan.budgets_normalized", map[string]any{"request_id": parsed.Turn.RequestID, "adjustments": notes})
	}
	if parsed.Plan != nil {
		enrichPlanConcurrency(parsed.Plan, requestBaseline(current, parsed.Plan.RequestID))
	}
	filenameRequestID := bundleFilenameRequestID(filename)
	if filenameRequestID == "" || filenameRequestID != parsed.Turn.RequestID {
		return BundleSubmission{}, ErrExecutionBundleRequestMismatch
	}
	if filepath.Base(filename) != expectedResponseBundleFilename(current, parsed.Turn.RequestID) {
		return BundleSubmission{}, fmt.Errorf("%w: expected %q", ErrExecutionBundleRequestMismatch, expectedResponseBundleFilename(current, parsed.Turn.RequestID))
	}
	// Renderer/network acknowledgement can be lost after the bundle has been
	// committed. The retained Desktop inbox must be able to replay the exact
	// bytes without executing or applying the plan twice.
	if current.LastBundle != nil && bundleFilenameRequestID(current.LastBundle.Filename) == parsed.Turn.RequestID && current.LastBundle.SHA256 == parsed.Info.SHA256 {
		s.bus.Publish(sessionID, "bundle.duplicate_acknowledged", map[string]any{"request_id": parsed.Turn.RequestID, "sha256": parsed.Info.SHA256})
		return BundleSubmission{Session: current}, nil
	}
	if !containsString(current.PendingManualRequestIDs, parsed.Turn.RequestID) {
		return BundleSubmission{}, fmt.Errorf("%w: %q", ErrExecutionBundleNotPending, parsed.Turn.RequestID)
	}
	for _, evidenceID := range parsed.Turn.ResolvedEvidenceIDs {
		if !containsString(current.EvidenceReviewIDs, evidenceID) {
			return BundleSubmission{}, fmt.Errorf("resolved evidence %q was not part of the active self-evolution review", evidenceID)
		}
	}
	if s.artifactStore != nil {
		// Archiving the response bundle is bookkeeping for the chat file
		// library, not a precondition for executing a verified plan. A full
		// or unreachable object store used to reject the bundle outright,
		// throwing away a complete, valid change (observed in production as
		// XMinioStorageFull). Record the archival failure, classify it so the
		// operator sees the real remedy, and continue ingesting the plan.
		if _, err := s.PersistArtifact(ctx, sessionID, parsed.Turn.RequestID, "output", "bundle", filename, "application/zip", raw); err != nil {
			degraded := "persist execution bundle: " + err.Error()
			s.bus.Publish(sessionID, "artifact.persist_degraded", map[string]any{
				"request_id": parsed.Turn.RequestID, "name": filename, "error": degraded,
				"storage_full": isArtifactStorageFullDiagnostic(err.Error()),
				"impact":       "the bundle was accepted and will execute; only its archived copy is missing",
			})
		}
	}
	// A knowledge_review response never carries a plan and is never subject
	// to the baseline/workflow/repair machinery below (there is nothing to
	// repair: the apply that triggered this round already succeeded). It is
	// also the ONLY place ProjectKnowledgeUpdate is ever read — see
	// ingestKnowledgeReviewResponse.
	if lineage, ok := current.RequestLineages[parsed.Turn.RequestID]; ok && lineage.Kind == requestKindKnowledgeReview {
		return s.ingestKnowledgeReviewResponse(ctx, sessionID, parsed)
	}
	// A consolidation round has no execution to succeed or fail, so it has no
	// later terminal boundary to stage against: it commits the reorganized
	// catalog directly and leaves the task's own state untouched.
	if lineage, ok := current.RequestLineages[parsed.Turn.RequestID]; ok && lineage.Kind == requestKindKnowledgeConsolidation {
		return s.ingestKnowledgeConsolidationResponse(sessionID, parsed)
	}
	// Project knowledge is auxiliary learning metadata staged alongside the
	// result; it is committed only at the real terminal boundary. Its most
	// common failure is a pure concurrency artefact — a peer chat advanced the
	// catalog revision while this request was in flight, so the returned
	// candidate declares a base_revision that no longer matches. Rejecting the
	// whole bundle for that discarded a complete verified change over a
	// bookkeeping mismatch. Skip the staging instead and keep the payload.
	if err := s.stageResponseKnowledge(sessionID, parsed); err != nil {
		var revisionConflict *knowledgeRevisionConflictError
		s.bus.Publish(sessionID, "knowledge.stage_skipped", map[string]any{
			"request_id": parsed.Turn.RequestID, "error": err.Error(),
			"reason": knowledgeStageSkipReason(errors.As(err, &revisionConflict)),
			"impact": "the response bundle was accepted; only its knowledge candidate and cumulative summary were not staged for this round",
		})
	}
	// The attempt ledger is staged on its own path, deliberately independent of
	// knowledge staging above. A catalog revision race must not also cost this
	// Main Request the record of what it has already proven cannot work locally
	// — that record is the only thing keeping the next round from repeating it.
	s.stageResponseAttemptLedger(sessionID, parsed)
	if refreshed, getErr := s.store.Get(sessionID); getErr == nil {
		current = refreshed
	}
	if parsed.Turn.Outcome != nil && parsed.Turn.Outcome.Status != domain.TurnOutcomeCompleted {
		outcome := parsed.Turn.Outcome
		var failureKind string
		updated, updateErr := s.store.Update(sessionID, func(item *domain.Session) error {
			turn := parsed.Turn
			item.LastTurn = &turn
			item.LastBundle = &parsed.Info
			failureKind = applyPlannerFailure(item, outcome)
			item.PendingManualRequestIDs = removeString(item.PendingManualRequestIDs, parsed.Turn.RequestID)
			return nil
		})
		if updateErr != nil {
			return BundleSubmission{}, updateErr
		}
		detail := updated.LastRepairError
		s.releaseRemoteInputLease(sessionID, parsed.Turn.RequestID)
		s.closeRemoteInputChannel(sessionID, "request.failed")
		s.bus.Publish(sessionID, "turn.failed", map[string]any{"request_id": parsed.Turn.RequestID, "outcome": outcome.Status, "reason_code": outcome.ReasonCode, "retryable": outcome.Retryable, "transport": "zip_bundle", "failure_kind": failureKind})
		// A classified infrastructure fault uses its dedicated local recovery;
		// a planner_guidance_required outcome needs new operator evidence. Both
		// make an automatic fresh request invalid, so neither spends an attempt.
		blocksAutomaticRepair := failureKind != ""
		if failureKind == domain.FailureKindOfflineGoModuleCache {
			s.bus.Publish(sessionID, "sandbox.dependency_network_approval_required", map[string]any{"plan_id": parsed.Turn.RequestID, "error": detail, "scope": "go_dependency_commands"})
		}
		if !blocksAutomaticRepair && outcome.Retryable && domain.AutomationModeIsAutomatic(updated.AutomationMode) && updated.RemoteRecoveryAttempt < 1 {
			if recovered, retryErr := s.retryFailedRequest(ctx, sessionID, true); retryErr == nil {
				s.bus.Publish(sessionID, "turn.auto_recovery_prepared", map[string]any{"request_id": recovered.LastRequestID, "replaces_request_id": parsed.Turn.RequestID, "reason_code": outcome.ReasonCode})
				return BundleSubmission{Session: recovered, AutoError: detail, RemoteRecoveryPrepared: true}, nil
			} else {
				s.bus.Publish(sessionID, "turn.auto_recovery_failed", map[string]any{"replaces_request_id": parsed.Turn.RequestID, "reason_code": outcome.ReasonCode, "error": retryErr.Error()})
			}
		}
		return BundleSubmission{Session: updated, AutoError: updated.LastRepairError}, nil
	}
	supersededByContinuation := requestSupersededByBaselineContinuation(current, parsed.Turn.RequestID)
	baselineCompatible := false
	archiveReconcilable := false
	legacyPatchRebase := false
	if parsed.Plan != nil {
		expected := strings.TrimSpace(parsed.Plan.BaseContextSHA256)
		currentSHA := strings.TrimSpace(current.Context.Manifest.SHA256)
		baselineCompatible = expected != "" && currentSHA != "" && expected != currentSHA && canFastForwardPlanBaseline(current, parsed.Plan, expected, currentSHA)
		archiveReconcilable = expected != "" && currentSHA != "" && expected != currentSHA && canReconcilePlanFromArchive(current, parsed.Plan)
		legacyPatchRebase = expected != "" && currentSHA != "" && expected != currentSHA && canLegacyRebasePlan(current, parsed.Plan)
	}
	if supersededByContinuation && !baselineCompatible && !archiveReconcilable && !legacyPatchRebase {
		updated, updateErr := s.store.Update(sessionID, func(item *domain.Session) error {
			item.PendingManualRequestIDs = removeString(item.PendingManualRequestIDs, parsed.Turn.RequestID)
			return nil
		})
		if updateErr != nil {
			return BundleSubmission{}, updateErr
		}
		s.releaseRemoteInputLease(sessionID, parsed.Turn.RequestID)
		s.bus.Publish(sessionID, "baseline.bundle_superseded", map[string]any{"request_id": parsed.Turn.RequestID, "replacement_request_id": current.LastRequestID, "current_sha256": current.Context.Manifest.SHA256})
		return BundleSubmission{Session: updated, AutoError: fmt.Sprintf("ignored superseded bundle for request %s; concurrent baseline adaptation continues as request %s", parsed.Turn.RequestID, current.LastRequestID)}, nil
	}
	if parsed.Plan != nil {
		expected := strings.TrimSpace(parsed.Plan.BaseContextSHA256)
		currentSHA := strings.TrimSpace(current.Context.Manifest.SHA256)
		if expected != "" && currentSHA != "" && expected != currentSHA {
			if baselineCompatible {
				parsed.Plan.BaseContextSHA256 = currentSHA
				if supersededByContinuation {
					replacementRequestID := current.LastRequestID
					current, err = s.store.Update(sessionID, func(item *domain.Session) error {
						item.PendingManualRequestIDs = removeString(item.PendingManualRequestIDs, replacementRequestID)
						item.LastRequestID = parsed.Turn.RequestID
						return nil
					})
					if err != nil {
						return BundleSubmission{}, err
					}
					s.releaseRemoteInputLease(sessionID, replacementRequestID)
					s.bus.Publish(sessionID, "baseline.continuation_retired", map[string]any{"request_id": parsed.Turn.RequestID, "replacement_request_id": replacementRequestID, "current_sha256": currentSHA})
				}
				s.bus.Publish(sessionID, "baseline.bundle_fast_forwarded", map[string]any{"request_id": parsed.Turn.RequestID, "from_sha256": expected, "to_sha256": currentSHA})
			} else if archiveReconcilable {
				s.bus.Publish(sessionID, "changeset.bundle_accepted_on_immutable_base", map[string]any{"request_id": parsed.Turn.RequestID, "from_sha256": expected, "current_sha256": currentSHA})
			} else if legacyPatchRebase {
				// Sessions created before immutable request archives existed cannot
				// reconstruct their historical tree. A validated patch-only plan can
				// still be conservatively reapplied and verified on the current copied
				// sandbox. This is a one-pass compatibility adapter, never a reason to
				// create another baseline request.
				parsed.Plan.BaseContextSHA256 = currentSHA
				s.bus.Publish(sessionID, "changeset.legacy_rebase", map[string]any{"request_id": parsed.Turn.RequestID, "from_sha256": expected, "to_sha256": currentSHA})
			} else {
				return BundleSubmission{}, fmt.Errorf("stale command plan cannot be reconciled without its immutable request base; submit one fresh request")
			}
		}
	}
	if current.LastRequestMode == "plan_first" && parsed.Turn.RequestID == current.LastRequestID {
		if parsed.Plan != nil || parsed.Turn.Kind != domain.TurnKindPlan {
			return BundleSubmission{}, errors.New("plan-first request must return kind=plan without plan.json; implementation requires explicit user approval")
		}
	}
	if current.LastRequestMode == "correct_plan" && parsed.Turn.RequestID == current.LastRequestID {
		if parsed.Plan != nil || parsed.Turn.Kind != domain.TurnKindPlan {
			return BundleSubmission{}, errors.New("correct_plan request must return kind=plan without plan.json; implementation requires explicit user approval")
		}
	}
	if current.LastRequestMode == "adjust_plan" && parsed.Turn.RequestID == current.LastRequestID && parsed.Turn.Kind == domain.TurnKindPlan {
		return BundleSubmission{}, errors.New("adjust_plan request must return a revised executable result, not a planning-only proposal")
	}
	if parsed.Turn.Kind == domain.TurnKindWorkflow {
		isDebug := parsed.Plan != nil && parsed.Plan.Debug != nil
		if !isDebug && !domain.AutomationModeIsAutomatic(current.AutomationMode) {
			return BundleSubmission{}, errors.New("workflow bundle requires a project automatic mode; return a terminal answer/investigation bundle or enable Auto/Auto + Approve")
		}
		if !isDebug && current.ExecutionMode != domain.ExecutionModeProtected {
			return BundleSubmission{}, errors.New("workflow bundle requires Protected execution mode")
		}
		if parsed.Plan == nil {
			return BundleSubmission{}, errors.New("workflow bundle requires plan.json")
		}
		limit := workflowRoundLimit(parsed.Plan)
		if current.WorkflowRound >= limit {
			return BundleSubmission{}, fmt.Errorf("workflow round limit reached (%d); return a terminal answer, investigation, clarification, change, or blocked bundle for request %s", limit, parsed.Turn.RequestID)
		}
		if err := protocol.ValidateWorkflowPlan(*parsed.Plan); err != nil {
			return BundleSubmission{}, err
		}
		decision := s.policy.Evaluate(*parsed.Plan)
		debugApproved := debugPlanAuthorized(current, parsed.Plan)
		updated, updateErr := s.store.Update(sessionID, func(item *domain.Session) error {
			turn := parsed.Turn
			item.LastTurn = &turn
			item.Plan = parsed.Plan
			item.Policy = &decision
			item.LastExecution = nil
			item.LastBundle = &parsed.Info
			if isDebug && !debugApproved {
				item.State = "debug_approval_required"
			} else {
				item.State = "workflow_planned"
			}
			item.PendingManualRequestIDs = removeString(item.PendingManualRequestIDs, parsed.Turn.RequestID)
			return nil
		})
		if updateErr != nil {
			return BundleSubmission{}, updateErr
		}
		s.releaseRemoteInputLease(sessionID, parsed.Turn.RequestID)
		s.recordPlanActivity(sessionID, parsed.Plan)
		s.bus.Publish(sessionID, "workflow.received", map[string]any{"plan_id": parsed.Plan.PlanID, "request_id": parsed.Turn.RequestID, "allowed": decision.Allowed, "transport": "zip_bundle"})
		if isDebug && !debugApproved {
			s.bus.Publish(sessionID, "debug.approval_required", map[string]any{"plan_id": parsed.Plan.PlanID, "request_id": parsed.Turn.RequestID, "target": parsed.Plan.Debug.Target})
			return BundleSubmission{Session: updated, AutoError: "debug flow requires one approval for this Main Request"}, nil
		}
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
		s.releaseRemoteInputLease(sessionID, parsed.Turn.RequestID)
		if parsed.Turn.Kind != domain.TurnKindPlan {
			s.closeRemoteInputChannel(sessionID, "request.terminal")
		}
		s.bus.Publish(sessionID, "turn.received", map[string]any{"request_id": parsed.Turn.RequestID, "kind": parsed.Turn.Kind, "transport": "zip_bundle"})
		if parsed.Turn.Kind != domain.TurnKindPlan {
			if committed, commitErr := s.commitPendingKnowledge(sessionID, parsed.Turn.RequestID); commitErr != nil {
				return BundleSubmission{}, commitErr
			} else {
				updated = committed
			}
		}
		return BundleSubmission{Session: updated}, nil
	}
	if err := augmentConflictResolutionPlan(current, parsed.Plan); err != nil {
		return BundleSubmission{}, fmt.Errorf("conflict resolution protocol: %w", err)
	}
	if err := protocol.ValidateChangePlan(*parsed.Plan); err != nil {
		return BundleSubmission{}, err
	}
	if err := validateApprovedChatPlanBinding(current, parsed.Plan); err != nil {
		return BundleSubmission{}, err
	}
	// The summary is the one sentence a human reads to learn what this bundle
	// did — in the transcript, and in the self-evolution activation dialog where
	// it is the only prose between the operator and a decision to restart the
	// runtime. It is checked at the same seam as the commit message, and for the
	// same reason: a placeholder rejected here costs one re-request, while
	// discovering it after verification would leave that dialog unable to say
	// what it is activating. It is deliberately not enforced inside
	// protocol.Validate, which also re-validates already-stored plans that
	// predate this contract.
	if err := protocol.ValidatePlanSummary(parsed.Plan.Summary); err != nil {
		return BundleSubmission{}, err
	}
	// A change plan's commit_message becomes permanent project history, so its
	// quality is part of the wire contract rather than a style preference.
	// Checking it here — at ingestion, before policy and sandbox verification —
	// means a rejected message costs one re-request; the same rejection at
	// commit time would discard a fully verified candidate over prose.
	if parsed.Turn.Kind == domain.TurnKindChange {
		if err := protocol.ValidateCommitMessage(parsed.Plan.CommitMessage); err != nil {
			return BundleSubmission{}, err
		}
		// A patch writing inside a submodule is routed at the same seam to the
		// repository that owns it, and refused only when no repository there
		// can receive it — the same reasoning as the commit message: the cost
		// is not the error text, it is the round spent before reaching it.
		// See rejectSubmoduleWrites and adr/ADR-0039.
		if err := s.rejectSubmoduleWrites(ctx, sessionID, current.ProjectPath, parsed.Plan); err != nil {
			return BundleSubmission{}, err
		}
		// A change that declares a file it neither writes nor can find is
		// incomplete before anything runs: the definition its own patch
		// references will exist nowhere. Caught here it costs one re-request;
		// caught by the compiler it costs a sandbox run and a repair round whose
		// diagnostic points at source that was never at fault.
		if err := s.rejectUndeliverableImpactFiles(sessionID, current.ProjectPath, parsed.Plan); err != nil {
			return BundleSubmission{}, err
		}
	}
	// Work aimed at another project is authorized against this request's own
	// `@ref:` grant, at the same seam and for the same reason as the contracts
	// above: before Policy, before any sandbox, so a response that reaches past
	// its authority costs one re-request rather than a discarded candidate.
	if _, err := s.authorizeCrossProjectUnits(current, parsed.Plan); err != nil {
		return BundleSubmission{}, err
	}
	if err := validateConflictResolutionPlan(current, parsed.Plan); err != nil {
		return BundleSubmission{}, fmt.Errorf("conflict resolution protocol: %w", err)
	}
	// A Git-origin conflict resolves into the very merge it was asked about,
	// not into a new verified candidate: there is nothing to plan, execute or
	// apply, only a merge to conclude. Intercepting here — before the plan is
	// stored as the session's pending work — is what keeps the two paths from
	// interleaving, since a half-stored candidate for a merge that has already
	// been committed would have nowhere left to go.
	if current.IntegrationConflict != nil && current.IntegrationConflict.Git != nil &&
		parsed.Plan.RequestID == current.IntegrationConflict.RequestID {
		resolved, resolveErr := s.concludeGitConflict(ctx, sessionID, current, parsed.Plan)
		if resolveErr != nil {
			return BundleSubmission{}, resolveErr
		}
		s.releaseRemoteInputLease(sessionID, parsed.Plan.RequestID)
		return BundleSubmission{Session: resolved}, nil
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
	s.releaseRemoteInputLease(sessionID, parsed.Plan.RequestID)
	s.bus.Publish(sessionID, "bundle.received", map[string]any{"filename": parsed.Info.Filename, "files": len(parsed.Info.Files), "patches": len(parsed.Info.Patches), "sha256": parsed.Info.SHA256})
	s.recordPlanActivity(sessionID, parsed.Plan)
	s.bus.Publish(sessionID, "plan.received", map[string]any{"plan_id": parsed.Plan.PlanID, "allowed": decision.Allowed, "requires_approval": decision.RequiresApproval, "risk": decision.Risk, "transport": "zip_bundle"})

	submission := BundleSubmission{Session: updated}
	if domain.AutomationModeIsAutomatic(updated.AutomationMode) && !decision.Allowed && parsed.Plan.Status == "ready" {
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
	if !domain.AutomationModeIsAutomatic(updated.AutomationMode) || !decision.Allowed || parsed.Plan.Status != "ready" {
		return submission, nil
	}
	if updated.ExecutionMode != domain.ExecutionModeProtected {
		submission.AutoError = "automatic modes require protected execution mode"
		return submission, nil
	}

	return s.runAutomaticPlan(ctx, sessionID, "zip_bundle"), nil
}

func plannerOutcomeFailureDetail(outcome *domain.TurnOutcome) string {
	detail := strings.TrimSpace(outcome.Message)
	if detail == "" {
		detail = "the planner did not complete the request"
	}
	if code := strings.TrimSpace(outcome.ReasonCode); code != "" {
		detail = code + ": " + detail
	}
	return "Planner reported " + outcome.Status + ": " + detail
}

// applyPlannerFailure records a non-completed planner turn outcome on a
// session. When the outcome classifies as a locally-diagnosed infrastructure
// fault (e.g. offline_go_module_cache), the failed plan, its policy decision
// and its execution result are preserved rather than wiped: they are exactly
// the inputs the human dependency-network recovery needs, and the spent
// repair attempt is refunded since it diagnosed a host problem, not a code
// defect. A planner-guidance block is classified for the UI but still clears
// stale executable state like an ordinary terminal planner failure.
func applyPlannerFailure(item *domain.Session, outcome *domain.TurnOutcome) string {
	kind := classifyPlannerOutcomeFailure(outcome)
	item.State = "failed"
	item.FailureKind = kind
	item.LastRepairError = plannerOutcomeFailureDetail(outcome)
	if kind == "" || kind == domain.FailureKindPlannerGuidanceRequired {
		item.Plan = nil
		item.Policy = nil
		item.LastExecution = nil
		return kind
	}
	item.RepairAttempt = 0
	item.RepairParentPlanID = ""
	return kind
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

// RetryPolicyRepair recreates (or returns) the correction prompt for a plan
// previously rejected by Policy. It also recovers a pending manual request
// whose downloaded bundle did not reach the backend. It never executes the
// rejected plan.
func (s *Service) RetryPolicyRepair(ctx context.Context, sessionID string) (domain.Session, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return domain.Session{}, err
	}
	if current.State == "repair_pending" && strings.TrimSpace(current.LastManualPrompt) != "" {
		return current, nil
	}
	if current.State == "awaiting_plan" && strings.TrimSpace(current.LastManualPrompt) != "" && strings.TrimSpace(current.LastRequestID) != "" {
		s.bus.Publish(sessionID, "manual.prompt_reprocess_ready", map[string]any{"request_id": current.LastRequestID, "reason": "bundle_not_persisted"})
		return current, nil
	}
	if current.Plan == nil || current.Policy == nil || current.Policy.Allowed {
		return domain.Session{}, errors.New("no policy-blocked plan is available to reprocess")
	}
	return s.preparePolicyRepairRequest(ctx, sessionID, current.Plan.PlanID, current.Policy.Reasons, "user_retry")
}

// RetryFailedRequest starts a genuinely new correlated request from current
// context after a terminal transport/protocol failure. It does not reuse the
// stale plan, but it carries the concrete failure evidence and lineage so the
// next planner turn cannot mistake a correction for an unrelated new task.
func (s *Service) RetryFailedRequest(ctx context.Context, sessionID string) (domain.Session, error) {
	return s.retryFailedRequest(ctx, sessionID, false)
}

// RetryFailedRequestWithGuidance is RetryFailedRequest's operator-guided form,
// exposed over HTTP so a chat blocked on a failure the planner declared
// non-retryable — see plannerDeclaredNonRetryable — can be unblocked once an
// operator confirms the named condition changed, without that guidance
// having to travel through any other endpoint. An empty guidance behaves
// exactly like RetryFailedRequest.
func (s *Service) RetryFailedRequestWithGuidance(ctx context.Context, sessionID, guidance string) (domain.Session, error) {
	return s.retryFailedRequestWithGuidance(ctx, sessionID, false, guidance)
}

func (s *Service) retryFailedRequest(ctx context.Context, sessionID string, automatic bool) (domain.Session, error) {
	return s.retryFailedRequestWithGuidance(ctx, sessionID, automatic, "")
}

func (s *Service) retryFailedRequestWithGuidance(ctx context.Context, sessionID string, automatic bool, guidance string) (domain.Session, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return domain.Session{}, err
	}
	// conflict_resolution_exhausted is a spent safety budget (the session's own
	// effort-level attempt cap), not a structural blocker the planner named —
	// see conflictResolutionExhausted/exhaustConflictResolution. It used to be
	// a genuine dead end: neither this path nor any dedicated endpoint accepted
	// it, so a session that ran out of automatic rounds chasing a real Engine
	// defect had no published way back once the defect was fixed. Treat it the
	// same shape as "failed" here, but require guidance unconditionally —
	// resuming after the budget is spent must always be an explicit human
	// decision, never inferred from an empty retry.
	exhaustedConflict := current.State == "conflict_resolution_exhausted"
	// A host Apply failure leaves the session `verified` with a successful
	// LastExecution — the sandbox run really did succeed; Apply is what failed —
	// so it matched none of the shapes below and the operator was told there was
	// nothing to repair while the failure sat on screen. That left a chat with no
	// correction reachable at all: none started on its own, and none could be
	// started by hand.
	applyFailure := !exhaustedConflict && current.State != "failed" &&
		strings.TrimSpace(current.LastRepairError) != "" &&
		len(hostApplicablePendingChanges(pendingHostChanges(current))) > 0
	if !exhaustedConflict && !applyFailure && (current.State != "failed" || strings.TrimSpace(current.LastRepairError) == "") {
		return domain.Session{}, errors.New("no terminal failed request is available to retry")
	}
	if exhaustedConflict || applyFailure {
		if strings.TrimSpace(current.LastRepairError) == "" {
			return domain.Session{}, errors.New("no terminal failed request is available to retry")
		}
		if strings.TrimSpace(guidance) == "" {
			if applyFailure {
				return current, errors.New("host apply failed with the verified candidate retained; retrying requires explicit operator guidance stating what changed on the host")
			}
			return current, errors.New("automatic conflict resolution already spent its attempt budget; resuming requires explicit operator guidance stating what changed")
		}
	}
	if kind := sessionFailureKind(current); kind != "" && kind != domain.FailureKindRemoteInputTransport && kind != domain.FailureKindPlannerGuidanceRequired {
		return current, fmt.Errorf("failure %s is terminal for fresh GPT retry and requires its dedicated recovery action", kind)
	}
	// The planner's own outcome is authoritative about whether another identical
	// request could change anything. retryable=false means it cannot: the blocker
	// is structural or needs an operator action. The automatic recovery path
	// already honours this, but the manual one did not, so a failure the planner
	// had declared unsolvable was sent straight back to it and answered
	// identically every round. That is a real observed loop — three chained
	// requests reporting stale_pending_candidate_requires_operator_rebase against
	// a candidate whose patch no longer applied to the host. The dedicated
	// planner_guidance_required kind makes that state visible without admitting
	// arbitrary reason codes into the infrastructure allowlist.
	//
	// Operator guidance is the deliberate escape: supplying it is the operator
	// stating that something outside the planner's view has changed.
	if reason, blocked := plannerDeclaredNonRetryable(current); blocked && strings.TrimSpace(guidance) == "" {
		return current, fmt.Errorf("the planner reported this failure as not retryable (%s); resolve the blocker it named, or retry with explicit operator guidance", reason)
	}
	if len(current.PendingManualRequestIDs) > 0 || current.PlannerInFlight {
		return domain.Session{}, errors.New("another request is already pending")
	}
	failedRequestID := current.LastRequestID
	failureKind := sessionFailureKind(current)
	if failureKind == "" {
		failureKind = "unclassified_planner_failure"
		if exhaustedConflict {
			failureKind = "conflict_resolution_exhausted"
		}
	}
	message := fmt.Sprintf(`FRESH REQUEST RECOVERY

Retry the most recent failed task from the current project context. Preserve the original user goal, but treat the previous result only as diagnostic history: do not reuse its stale baseline or request id.

PREVIOUS TERMINAL FAILURE — AUTHORITATIVE EVIDENCE:
REQUEST ID: %s
FAILURE KIND: %s
FAILURE REASON:
%s

RECOVERY STRATEGY RULES:
- Address the failure reason above directly. Do not repeat a semantically equivalent plan, the same blocked project/root/path strategy, the same unsupported command approach, or merely restate the same blocker.
- Before returning a new executable result, choose a materially different strategy and make sure it removes the named failure condition.
- If the blocker cannot be overcome inside the current project root, policy, execution environment, or available evidence, stop and return a terminal blocked result with retryable=false plus the concrete operator action required. Do not ask Wharnex to send the same task around again.
- Set retryable=true only when another future request could materially change evidence, strategy, or a transient capability.`, failedRequestID, failureKind, truncateRepairText(current.LastRepairError, 12000))
	if clean := truncateRepairText(guidance, 4000); clean != "" {
		message += "\n\nOPTIONAL OPERATOR GUIDANCE:\n" + clean
	}
	_, updated, err := s.submitPlannerRequest(ctx, sessionID, message, current.LastRequestMode, failedRequestID, requestKindRepair)
	if err != nil {
		return updated, err
	}
	updated, err = s.store.Update(sessionID, func(item *domain.Session) error {
		if automatic {
			item.RemoteRecoveryAttempt = current.RemoteRecoveryAttempt + 1
		} else {
			item.RemoteRecoveryAttempt = 0
		}
		if exhaustedConflict {
			// An explicit human authorization to resume after the automatic
			// effort budget was spent starts that budget fresh for this one
			// resumed round, exactly like RemoteRecoveryAttempt already does
			// for a manual retry above. Without this the very next automatic
			// round would immediately re-trip the same exhaustion check this
			// call just overrode, making the override a no-op.
			item.ConflictAttempt = 0
			item.AutomationAttempt = 0
		}
		return nil
	})
	if err != nil {
		return updated, err
	}
	s.bus.Publish(sessionID, "request.failure_retried", map[string]any{"request_id": updated.LastRequestID, "replaces_request_id": failedRequestID, "automatic": automatic, "failure_kind": failureKind, "failure_reason": truncateRepairText(current.LastRepairError, 512)})
	return updated, nil
}

func (s *Service) runAutomaticPlan(ctx context.Context, sessionID, transport string) BundleSubmission {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return BundleSubmission{Session: current, AutoError: err.Error()}
	}
	result := BundleSubmission{Session: current}
	for attempt := 0; ; attempt++ {
		if current.Plan == nil || current.Policy == nil || !current.Policy.Allowed || current.Plan.Status != "ready" {
			return result
		}
		planID := current.Plan.PlanID
		if planExecutionHeld(current, planID) {
			result.Session = current
			result.AutoError = "automatic execution is paused before host apply"
			s.bus.Publish(sessionID, "automation.paused", map[string]any{"plan_id": planID, "transport": transport, "state": planControlState(current, planID)})
			return result
		}
		autoApprove := domain.AutomationModeApproves(current.AutomationMode)
		initialConsentRequired := planNeedsInitialConsent(current)
		coveredByPriorConsent := planCoveredByChatApproval(current) || priorExecutionConsentCovers(current)
		if initialConsentRequired && !autoApprove {
			result.AutoError = "automatic execution paused for the Main Request execution-contract consent"
			s.bus.Publish(sessionID, "automation.approval_required", map[string]any{"plan_id": planID, "transport": transport, "risk": current.Policy.Risk, "reasons": []string{"initial Main Request execution contract requires consent"}, "error": result.AutoError})
			result.Session = current
			return result
		}
		policyApprovalRequired := current.Policy.RequiresApproval && !coveredByPriorConsent
		if policyApprovalRequired && !autoApprove {
			reason := strings.Join(current.Policy.Reasons, "; ")
			if strings.TrimSpace(reason) == "" {
				reason = "policy requires explicit approval"
			}
			result.AutoError = "automatic execution paused because this plan still requires explicit approval: " + reason
			s.bus.Publish(sessionID, "automation.approval_required", map[string]any{"plan_id": planID, "transport": transport, "risk": current.Policy.Risk, "reasons": current.Policy.Reasons, "error": result.AutoError})
			result.Session = current
			return result
		}
		approved := autoApprove || coveredByPriorConsent
		if autoApprove && (initialConsentRequired || policyApprovalRequired) {
			s.bus.Publish(sessionID, "automation.approval_auto_granted", map[string]any{"plan_id": planID, "transport": transport, "risk": current.Policy.Risk, "reasons": current.Policy.Reasons})
		}
		s.bus.Publish(sessionID, "automation.started", map[string]any{"plan_id": planID, "transport": transport, "attempt": attempt + 1})
		execution, executed, execErr := s.Execute(ctx, sessionID, approved)
		result.AutoExecuted = true
		result.Execution = &execution
		result.Session = executed
		if execErr != nil {
			current = executed
			if errors.Is(execErr, ErrExecutionInProgress) {
				// Bundle delivery and renderer recovery may converge on the same
				// automatic execution. The durable execution intent is the owner;
				// a second trigger joins it instead of recording a false failure
				// and starting another repair round.
				result.AutoExecuted = false
				result.Execution = nil
				result.Session = executed
				s.bus.Publish(sessionID, "automation.execution_joined", map[string]any{"plan_id": planID, "transport": transport})
				return result
			}
			if executed.State == "planned" && executed.Plan != nil && executed.Plan.PlanID != planID {
				continue
			}
			// Execute also performs the already-authorized Protected host Apply.
			// A candidate defect discovered there therefore returns through this
			// execution-error branch, not through the explicit Apply block below.
			// Route the marked failure through the same bounded repair transition
			// so a rolled-back self-evolution build cannot remain stranded as a
			// verified candidate waiting for an operator to rediscover the error.
			if isPlannerRepairableApplyFailure(execErr) {
				if repaired, repairErr := s.TriggerApplyFailureRepair(ctx, sessionID, execErr); repairErr == nil {
					result.Session = repaired
					result.RepairPrepared = repaired.State == "repair_pending" && repaired.LastManualPrompt != ""
				}
			}
			result.AutoError = execErr.Error()
			s.bus.Publish(sessionID, "automation.execution_failed", map[string]any{"error": execErr.Error(), "repair_pending": result.Session.State == "repair_pending"})
			return result
		}
		if executed.Plan != nil && planExecutionHeld(executed, executed.Plan.PlanID) {
			result.Session = executed
			result.AutoError = "automatic host apply is paused by the operator"
			s.bus.Publish(sessionID, "automation.paused", map[string]any{"plan_id": executed.Plan.PlanID, "transport": transport, "state": planControlState(executed, executed.Plan.PlanID)})
			return result
		}
		if len(executed.LastAppliedChanges) > 0 && (executed.State == "applied" || executed.State == "restart_pending") {
			result.AutoApplied = true
			result.RestartRequired = executed.SelfEvolution && executed.State == "restart_pending" && planHasPatch(current.Plan)
			result.Session = executed
			s.bus.Publish(sessionID, "automation.completed", map[string]any{"plan_id": planID, "applied": true, "transport": transport, "restart_required": result.RestartRequired})
			return result
		}
		if len(hostApplicablePendingChanges(pendingHostChanges(executed))) == 0 {
			result.Session = executed
			s.bus.Publish(sessionID, "automation.completed", map[string]any{"plan_id": planID, "applied": false, "sandbox_only": true, "transport": transport})
			result.CrossProject = s.maybeRunCrossProjectUnits(ctx, sessionID, transport)
			return result
		}
		applied, applyErr := s.applyToHostWithLocalRetry(ctx, sessionID)
		if applyErr != nil {
			result.AutoError = applyErr.Error()
			result.Session = executed
			s.bus.Publish(sessionID, "automation.apply_failed", map[string]any{"error": applyErr.Error()})
			if errors.Is(applyErr, ErrIntegrationConflict) {
				if conflicted, getErr := s.store.Get(sessionID); getErr == nil {
					result.Session = conflicted
					result.ConflictPrepared = conflicted.State == "conflict_resolution_pending" && conflicted.LastManualPrompt != ""
				}
				return result
			}
			if errors.Is(applyErr, sandbox.ErrOfflineDependenciesUnavailable) {
				s.bus.Publish(sessionID, "automation.infrastructure_blocked", map[string]any{"error": applyErr.Error(), "kind": "offline_dependencies"})
				return result
			}
			if repaired, repairErr := s.TriggerApplyFailureRepair(ctx, sessionID, applyErr); repairErr == nil {
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
		// The primary project has the change. Only now do the granted projects
		// get theirs: a cross-project set whose own project failed verification
		// is a set the operator has not yet seen fail, and writing further
		// hosts on top of that is the one ordering that cannot be undone by
		// looking at it afterwards.
		result.CrossProject = s.maybeRunCrossProjectUnits(ctx, sessionID, transport)
		if !result.RestartRequired && shouldContinueImprovement(applied) {
			improved, improveErr := s.prepareImprovementRequest(ctx, sessionID, applied, planID)
			if improveErr != nil {
				result.AutoError = improveErr.Error()
				return result
			}
			result.Session = improved
			if improved.State == "planned" && improved.Plan != nil && improved.Plan.PlanID != planID {
				current = improved
				continue
			}
			result.RepairPrepared = improved.State == "repair_pending" && improved.LastManualPrompt != ""
		}
		return result
	}
}

func turnState(kind domain.TurnKind) string {
	switch kind {
	case domain.TurnKindAnswer:
		return "answered"
	case domain.TurnKindClarification:
		return "awaiting_clarification"
	case domain.TurnKindInvestigation:
		return "investigated"
	case domain.TurnKindPlan:
		return "awaiting_plan_approval"
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
	parsed, ok := bundlename.Parse(base)
	if !ok || parsed.Kind != bundlename.KindResponse {
		return ""
	}
	return bundlename.RequestIDFromFilename(base)
}

func (s *Service) Execute(ctx context.Context, sessionID string, approved bool) (result domain.ExecutionResult, item domain.Session, err error) {
	item, err = s.store.Get(sessionID)
	if err != nil {
		return result, item, err
	}
	if item.Plan == nil || item.Policy == nil {
		return result, item, errors.New("no plan available")
	}
	if planExecutionAlreadyCompleted(item, item.Plan.PlanID) {
		if item.InterruptedExecution != nil && item.InterruptedExecution.PlanID == item.Plan.PlanID && item.LastExecution != nil {
			cleared, clearErr := s.clearInterruptedExecution(sessionID, item.Plan.PlanID)
			if clearErr != nil {
				return result, item, clearErr
			}
			s.bus.Publish(sessionID, "execution.recovery_reconciled", map[string]any{"plan_id": item.Plan.PlanID})
			return *item.LastExecution, cleared, nil
		}
		return result, item, fmt.Errorf("plan %s already executed successfully; submit a new change request instead of executing it again", item.Plan.PlanID)
	}
	if !item.Policy.Allowed {
		return result, item, errors.New("policy denied plan")
	}
	if planExecutionHeld(item, item.Plan.PlanID) {
		return result, item, errors.New("execution plan is paused or suspended")
	}
	unprotected := item.ExecutionMode == domain.ExecutionModeUnprotected
	if unprotected && s.isSelfEvolution(item) {
		return result, item, errors.New("Wharnex self-evolution cannot execute in Unprotected mode")
	}
	if (item.Policy.RequiresApproval || unprotected) && !approved {
		return result, item, ErrApprovalRequired
	}
	planID := item.Plan.PlanID
	updated, updateErr := s.store.Update(sessionID, func(current *domain.Session) error {
		if current.Plan == nil || current.Plan.PlanID != planID {
			return errors.New("plan changed before execution intent could be recorded")
		}
		if planExecutionAlreadyCompleted(*current, planID) {
			return fmt.Errorf("plan %s already executed successfully; submit a new change request instead of executing it again", planID)
		}
		if current.InterruptedExecution != nil && current.InterruptedExecution.PlanID == planID {
			return fmt.Errorf("plan %s already has an execution in progress or pending recovery: %w", planID, ErrExecutionInProgress)
		}
		current.InterruptedExecution = &domain.InterruptedExecution{PlanID: planID, RequestedAt: time.Now().UTC(), Approved: approved, Status: domain.InterruptedExecutionRunning}
		if approved && current.ExecutionMode == domain.ExecutionModeProtected {
			current.ExecutionApprovedRootID = executionConsentRoot(*current, current.Plan.RequestID)
			current.ApprovedBoundaryKeys = executionBoundaryKeys(current.Plan)
		}
		return nil
	})
	if updateErr != nil {
		if current, getErr := s.store.Get(sessionID); getErr == nil {
			item = current
		}
		return result, item, updateErr
	}
	item = updated

	result, item, err = s.executeRecorded(ctx, sessionID, approved)
	// Cancellation is ambiguous: the frontend, Desktop, backend, or runner may
	// have disappeared mid-flight. Keep the durable intent for startup recovery.
	if ctx.Err() != nil {
		if marked, markErr := s.markInterruptedExecutionAwaitingDecision(sessionID, planID); markErr == nil {
			item = marked
		}
		return result, item, err
	}
	cleared, clearErr := s.clearInterruptedExecution(sessionID, planID)
	if clearErr != nil {
		if err == nil {
			err = fmt.Errorf("clear completed execution recovery intent: %w", clearErr)
		}
		return result, item, err
	}
	if err == nil && approved && cleared.ExecutionMode == domain.ExecutionModeProtected && len(hostApplicablePendingChanges(pendingHostChanges(cleared))) > 0 {
		if planExecutionHeld(cleared, planID) {
			s.bus.Publish(sessionID, "host.apply_paused", map[string]any{"plan_id": planID, "state": planControlState(cleared, planID)})
			return result, cleared, nil
		}
		applied, applyErr := s.applyToHostWithLocalRetry(ctx, sessionID)
		if applyErr != nil {
			return result, applied, applyErr
		}
		return result, applied, nil
	}
	return result, cleared, err
}

func (s *Service) clearInterruptedExecution(sessionID, planID string) (domain.Session, error) {
	return s.store.Update(sessionID, func(current *domain.Session) error {
		if current.InterruptedExecution != nil && current.InterruptedExecution.PlanID == planID {
			current.InterruptedExecution = nil
		}
		return nil
	})
}

func (s *Service) DiscardInterruptedExecution(sessionID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	if item.InterruptedExecution == nil {
		return item, errors.New("no interrupted execution is pending")
	}
	if executionRecoveryActive(item.InterruptedExecution.Status) {
		return item, ErrExecutionRecoveryInProgress
	}
	planID := item.InterruptedExecution.PlanID
	updated, err := s.clearInterruptedExecution(sessionID, planID)
	if err == nil {
		s.bus.Publish(sessionID, "execution.recovery_discarded", map[string]any{"plan_id": planID})
	}
	return updated, err
}

func (s *Service) executeRecorded(ctx context.Context, sessionID string, approved bool) (domain.ExecutionResult, domain.Session, error) {
	return s.executeRecordedForPlan(ctx, sessionID, approved, "")
}

func (s *Service) executeRecordedForPlan(ctx context.Context, sessionID string, approved bool, expectedPlanID string) (domain.ExecutionResult, domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.ExecutionResult{}, item, err
	}
	if err := s.ensureWorkspaceChatExecutable(item); err != nil {
		s.bus.Publish(sessionID, "execution.standby", map[string]any{"chat_id": item.ChatID})
		return domain.ExecutionResult{}, item, err
	}
	if item.Plan == nil || item.Policy == nil {
		return domain.ExecutionResult{}, item, errors.New("no plan available")
	}
	if expectedPlanID != "" && item.Plan.PlanID != expectedPlanID {
		return domain.ExecutionResult{}, item, fmt.Errorf("interrupted plan %s is no longer the active plan", expectedPlanID)
	}
	queuedPlanID := item.Plan.PlanID
	ticket, err := s.executionQueue.acquire(ctx, item.ProjectPath, sessionID, func(position int) {
		s.bus.Publish(sessionID, "execution.queued", map[string]any{"plan_id": queuedPlanID, "position": position})
	})
	if err != nil {
		return domain.ExecutionResult{}, item, fmt.Errorf("wait for project execution queue: %w", err)
	}
	if ticket.queued {
		s.bus.Publish(sessionID, "execution.dequeued", map[string]any{"plan_id": queuedPlanID, "position": ticket.position})
	}
	defer ticket.release()
	item, err = s.store.Get(sessionID)
	if err != nil {
		return domain.ExecutionResult{}, item, err
	}
	if err := s.ensureWorkspaceChatExecutable(item); err != nil {
		s.bus.Publish(sessionID, "execution.standby", map[string]any{"chat_id": item.ChatID})
		return domain.ExecutionResult{}, item, err
	}
	if item.Plan == nil || item.Policy == nil {
		return domain.ExecutionResult{}, item, errors.New("no plan available after leaving project execution queue")
	}
	if expectedPlanID != "" && item.Plan.PlanID != expectedPlanID {
		return domain.ExecutionResult{}, item, fmt.Errorf("interrupted plan %s changed while waiting for the project execution queue", expectedPlanID)
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
		return domain.ExecutionResult{}, item, errors.New("Wharnex self-evolution cannot execute in Unprotected mode")
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
	reconcileFromArchive := false
	if expected != "" && currentBaseline != expected {
		if canFastForwardPlanBaseline(item, item.Plan, expected, currentBaseline) {
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
		} else if !unprotected && canReconcilePlanFromArchive(item, item.Plan) {
			reconcileFromArchive = true
			s.bus.Publish(sessionID, "changeset.base_restored", map[string]any{"plan_id": item.Plan.PlanID, "base_context_sha256": expected, "current_context_sha256": currentBaseline})
		} else if !unprotected && canLegacyRebasePlan(item, item.Plan) {
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
			s.bus.Publish(sessionID, "changeset.execution_legacy_rebase", map[string]any{"plan_id": item.Plan.PlanID, "from_sha256": expected, "to_sha256": currentBaseline, "reason": "immutable context archive is not execution-complete"})
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
	executionStartedData := requestEventLineage(item, item.Plan.RequestID)
	executionStartedData["plan_id"] = item.Plan.PlanID
	executionStartedData["execution_mode"] = item.ExecutionMode
	executionStartedData["target"] = executionTarget
	s.bus.Publish(sessionID, "execution.started", executionStartedData)
	executionRoot, cleanupExecutionBase, err := executionBase(item, item.Plan, reconcileFromArchive)
	if err != nil {
		return s.failExecution(ctx, sessionID, result, fmt.Errorf("prepare immutable task base: %w", err))
	}
	defer cleanupExecutionBase()
	// executionRoot is the project itself for an ordinary run and a temporary
	// extraction when the request is rooted at its own immutable base. Project
	// scoped resources — the private Go module cache above all — must follow the
	// project, never that temporary directory (see adr/ADR-0045).
	workspace, err := sandbox.PrepareExecutionWorkspace(ctx, runner, executionRoot, item.ProjectPath)
	if err != nil {
		return s.failExecution(ctx, sessionID, result, err)
	}
	bindExecutionDependencySource(&workspace, item, reconcileFromArchive)
	defer runner.Cleanup(workspace)
	// Root this candidate's integration branch at the tree its patch was
	// actually authored against, before anything is applied. Without this the
	// patch is applied to whatever the host has drifted to since the request
	// was planned, and an ordinary concurrent edit anywhere in the same file
	// makes `git apply` fail outright — a dead end that consumed an AI repair
	// round and could not be recovered by retrying. Rooted here the patch
	// applies by construction, and genuine divergence surfaces later as a
	// normal three-way merge, which Git resolves without a model turn whenever
	// the changes are actually compatible.
	baseRootedBranch := ""
	if !unprotected && !reconcileFromArchive {
		if branch, _, rooted := s.prepareBaseRootedWorkspace(ctx, sessionID, item, item.Plan, workspace.Path); rooted {
			baseRootedBranch = branch
		}
	}
	pendingForExecution := item.PendingHostChanges
	var retiredConflictBranches []string
	if item.IntegrationConflict != nil && item.IntegrationConflict.RequestID == item.Plan.RequestID {
		// Preserve the original conflicted mutations durably until the focused
		// replacement has itself passed sandbox verification. Only the private
		// execution candidate omits those superseded paths.
		pendingForExecution, retiredConflictBranches, err = retireConflictingMutations(ctx, item.ProjectPath, item.Plan.BaseContextSHA256, pendingForExecution, item.IntegrationConflict)
		if err != nil {
			return s.failExecution(ctx, sessionID, result, fmt.Errorf("compose focused conflict candidate: %w", err))
		}
	}
	if !unprotected {
		if replayErr := s.replayPendingChangeSets(ctx, sessionID, item.ProjectPath, runner, workspace, pendingForExecution, item.Plan.PlanID, !reconcileFromArchive, &result); replayErr != nil {
			return s.failExecution(ctx, sessionID, result, replayErr)
		}
	}
	var changeBaseRoot string
	var cleanupChangeBase func()
	if !unprotected && reconcileFromArchive {
		// Snapshot the plan's write set BEFORE any patch is applied below —
		// materializePlanChangeSet needs the pre-patch content to diff
		// against, and workspace.Path is mutated in place by the operations
		// loop that follows.
		changeBasePaths := append(actualPatchFiles(item.Plan), item.Plan.ReadFiles...)
		changeBasePaths = append(changeBasePaths, item.Plan.BarrierFiles...)
		root, cleanup, snapshotErr := changeset.SnapshotPaths(workspace.Path, changeBasePaths)
		if snapshotErr != nil {
			return s.failExecution(ctx, sessionID, result, fmt.Errorf("snapshot plan write set: %w", snapshotErr))
		}
		changeBaseRoot = root
		cleanupChangeBase = cleanup
		defer cleanupChangeBase()
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
			baselineResult, unchanged, baselineErr := s.compareVerificationBaseline(ctx, runner, &baselineWorkspace, item.ProjectPath, pendingForExecution, command, commandResult)
			if baselineErr == nil && unchanged {
				commandResult.BaselineFailure = true
				commandResult.BaselineExitCode = baselineResult.ExitCode
				commandResult.BaselineOutput = commandResultDiagnostic(baselineResult)
				commandResult.Success = true
				warning := fmt.Sprintf("pre-existing verification failure unchanged: %s (exit %d)", strings.Join(command.Argv, " "), baselineResult.ExitCode)
				result.Warnings = append(result.Warnings, warning)
				s.bus.Publish(sessionID, "verification.baseline_unchanged", map[string]any{"argv": command.Argv, "exit_code": baselineResult.ExitCode, "diagnostic": commandResultDiagnostic(baselineResult)})
			} else if baselineErr == nil {
				// Attribution is useful even when the baseline passed. In that
				// case every structured failure is introduced by the candidate,
				// and saying so explicitly gives the repair round a compact cause
				// instead of a wall of test-runner output. When the baseline also
				// failed, the same report separates candidate regressions from
				// repository debt.
				commandResult.BaselineExitCode = baselineResult.ExitCode
				commandResult.BaselineOutput = describeVerificationAttribution(baselineResult, commandResult)
				s.bus.Publish(sessionID, "verification.baseline_changed", map[string]any{
					"argv":                command.Argv,
					"baseline_exit_code":  baselineResult.ExitCode,
					"post_exit_code":      commandResult.ExitCode,
					"introduced":          newVerificationFailures(baselineResult, commandResult),
					"pre_existing":        preExistingVerificationFailures(baselineResult, commandResult),
					"baseline_diagnostic": commandResultDiagnostic(baselineResult),
					"post_diagnostic":     commandResultDiagnostic(commandResult),
				})
			}
		}
		result.Commands = append(result.Commands, commandResult)
		if runErr != nil || !commandResult.Success {
			if runErr == nil {
				// The attribution leads the message, because this string is what
				// the repair prompt is built from: the raw suite output lists
				// every failure the command produced and gives the planner no
				// way to tell which of them its own patch caused.
				runErr = fmt.Errorf("verification failed: %s (exit %d): %s", strings.Join(command.Argv, " "), commandResult.ExitCode, commandResultDiagnostic(commandResult))
				if attribution := strings.TrimSpace(commandResult.BaselineOutput); attribution != "" {
					runErr = fmt.Errorf("verification failed: %s (exit %d).\n%s\n\nFull output:\n%s",
						strings.Join(command.Argv, " "), commandResult.ExitCode, attribution, commandResultDiagnostic(commandResult))
				}
			}
			return s.failExecution(ctx, sessionID, result, runErr)
		}
		s.bus.Publish(sessionID, "verification.completed", map[string]any{"exit_code": commandResult.ExitCode, "target": executionTarget, "baseline_failure": commandResult.BaselineFailure})
	}
	result.Success = true
	result.CompletedAt = time.Now().UTC()
	var integrationBranch, integrationCommit string
	var submoduleIntegrations []domain.RepositoryIntegration
	var canonicalChangeSet *domain.ChangeSet
	if !unprotected {
		if reconcileFromArchive {
			// This sandbox was reconstructed from an immutable request-base
			// archive (see executionBase), not cloned from the live host —
			// it has no real Git ancestry in common with item.ProjectPath at
			// all, so there is no shared history to commit a branch onto or
			// later merge. Fall back to the same CAS-based ChangeSet this
			// path has always used, diffing against the pre-patch snapshot
			// taken above (before the operations loop mutated workspace.Path).
			canonicalChangeSet, err = materializePlanChangeSet(*item.Plan, changeBaseRoot, workspace.Path)
			if err != nil {
				return s.failExecution(ctx, sessionID, result, fmt.Errorf("materialize verified ChangeSet: %w", err))
			}
			if canonicalChangeSet != nil {
				s.bus.Publish(sessionID, "changeset.verified", map[string]any{"changeset_id": canonicalChangeSet.ID, "plan_id": item.Plan.PlanID, "files": changeSetPaths(*canonicalChangeSet)})
			}
		} else {
			integrationBranch, integrationCommit, submoduleIntegrations, err = s.commitVerifiedPatchToBranch(ctx, sessionID, item.Plan, item.ProjectPath, workspace.Path, baseRootedBranch)
			if err != nil {
				return s.failExecution(ctx, sessionID, result, fmt.Errorf("commit verified patch to integration branch: %w", err))
			}
		}
	}
	retiredRequestIDs := make([]string, 0)
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.LastExecution = &result
		current.RepairAttempt = 0
		current.RepairParentPlanID = ""
		clearSessionFailure(current)
		for _, requestID := range current.PendingManualRequestIDs {
			if requestID != item.Plan.RequestID {
				retiredRequestIDs = append(retiredRequestIDs, requestID)
			}
		}
		current.PendingManualRequestIDs = nil
		current.LastRequestID = item.Plan.RequestID
		current.LastManualPrompt = ""
		if unprotected {
			current.State = "applied"
			current.LastHostCommands = append([]domain.CommandResult(nil), result.Commands...)
			current.LastHostAppliedAt = result.CompletedAt
		} else {
			pendingBase := current.PendingHostChanges
			if current.IntegrationConflict != nil && current.IntegrationConflict.RequestID == item.Plan.RequestID {
				// Persist the exact cumulative candidate that passed verification;
				// recomputing the retirement here used to discard every Git-native
				// predecessor because those records have no legacy ChangeSet.
				pendingBase = append([]domain.PendingHostChange(nil), pendingForExecution...)
				current.IntegrationConflict = nil
			}
			if planRequiresHostApply(item.Plan) {
				current.PendingHostChanges = upsertPendingHostChange(pendingBase, domain.PendingHostChange{
					Plan: *item.Plan, Execution: result, VerifiedAt: result.CompletedAt, ChangeSet: canonicalChangeSet, IntegrationBranch: integrationBranch, IntegrationCommit: integrationCommit, SubmoduleIntegrations: submoduleIntegrations,
				})
			} else {
				// Verification-only/no-op plans are allowed to validate an existing
				// cumulative candidate, but they must never poison the host-apply
				// chain with a nil ChangeSet and stale baseline metadata.
				current.PendingHostChanges = hostApplicablePendingChanges(pendingBase)
			}
			current.State = "verified"
		}
		return nil
	})
	if err != nil {
		return result, item, err
	}
	if len(retiredConflictBranches) > 0 {
		s.deleteIntegrationBranches(ctx, sessionID, item.ProjectPath, retiredConflictBranches)
	}
	for _, requestID := range retiredRequestIDs {
		s.releaseRemoteInputLease(sessionID, requestID)
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
		s.closeRemoteInputChannel(sessionID, "request.completed")
		if committed, commitErr := s.commitPendingKnowledge(sessionID, item.Plan.RequestID); commitErr == nil {
			updated = committed
		} else {
			s.bus.Publish(sessionID, "knowledge.commit_failed", map[string]any{"error": commitErr.Error(), "request_id": item.Plan.RequestID})
		}
	}
	s.recordExecutionActivity(sessionID, item.Plan.RequestID, result)
	s.resolveExecutionFailuresWithGPT(sessionID, item, *item.Plan)
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

func (s *Service) runCommandWithRunner(ctx context.Context, sessionID string, runner sandbox.Runner, workspace sandbox.Workspace, command domain.CommandSpec, target string) (domain.CommandResult, error) {
	command = repositoryTreeCommand(ctx, workspace.Path, command)
	runID := ids.New("run")
	rationale := executionCommandRationale(command, target)
	s.bus.Publish(sessionID, "command.started", map[string]any{"run_id": runID, "argv": command.Argv, "cwd": command.Cwd, "network": command.Network, "timeout_seconds": command.TimeoutSeconds, "target": target, "rationale": rationale})
	var result domain.CommandResult
	var err error
	if streaming, ok := runner.(sandbox.StreamingRunner); ok {
		result, err = streaming.RunStreaming(ctx, workspace, command, func(stream, text string) {
			s.bus.Publish(sessionID, "command.output", map[string]any{"run_id": runID, "stream": stream, "text": text, "target": target, "rationale": rationale})
		})
	} else {
		result, err = runner.Run(ctx, workspace, command)
	}
	result = normalizePreflightCommandFailure(command, result, err)
	if err == nil && !result.Success && result.ExitCode == -1 && ctx.Err() != nil {
		// exec.CommandContext commonly reports a killed child as exit -1. Some
		// runner adapters intentionally normalize ordinary non-zero exits to a nil
		// Go error, so recover the parent cancellation here before it can be
		// mistaken for a source regression and routed into the GPT repair loop.
		err = ctx.Err()
	}
	s.bus.Publish(sessionID, "command.completed", map[string]any{"run_id": runID, "argv": command.Argv, "cwd": command.Cwd, "exit_code": result.ExitCode, "success": result.Success, "stdout": result.Stdout, "stderr": result.Stderr, "duration_ms": result.DurationMS, "target": target, "rationale": rationale})
	return result, err
}

func executionCommandRationale(command domain.CommandSpec, target string) string {
	if rationale := strings.TrimSpace(command.Rationale); rationale != "" {
		return rationale
	}
	if strings.HasPrefix(target, "interactive-") {
		return "Executar esta etapa interativa local e devolver stdout, stderr e exit code para decidir o próximo passo."
	}
	return "Executar esta etapa local do plano e usar stdout, stderr e exit code para validar o resultado antes de continuar."
}

func normalizePreflightCommandFailure(command domain.CommandSpec, result domain.CommandResult, runErr error) domain.CommandResult {
	if runErr == nil || len(result.Argv) > 0 {
		return result
	}
	result.Argv = append([]string(nil), command.Argv...)
	result.Cwd = command.Cwd
	result.ExitCode = -1
	result.Success = false
	if strings.TrimSpace(result.Stderr) == "" {
		result.Stderr = runErr.Error()
	}
	return result
}

func (s *Service) failExecution(ctx context.Context, sessionID string, result domain.ExecutionResult, cause error) (domain.ExecutionResult, domain.Session, error) {
	result.Success = false
	result.Error = cause.Error()
	result.CompletedAt = time.Now().UTC()
	// Recorded before the session state moves, because every branch below
	// rewrites LastExecution or clears it, and the failed run is the evidence
	// that explains why the next round exists.
	s.recordExecutionFailure(sessionID, result, cause)
	s.recordExecutionActivity(sessionID, "", result)
	updated, _ := s.store.Update(sessionID, func(current *domain.Session) error {
		current.LastExecution = &result
		current.State = "failed"
		current.LastRepairError = cause.Error()
		current.FailureKind = classifyExecutionFailure(cause)
		return nil
	})
	s.setProjectTodosByRequestLineage(updated, updated.LastRequestID, domain.ProjectTodoExecutionFailed, cause.Error())
	if updated.ExecutionMode == domain.ExecutionModeUnprotected {
		s.resetDevspace(sessionID)
	}
	if errors.Is(cause, sandbox.ErrOfflineDependenciesUnavailable) {
		s.bus.Publish(sessionID, "sandbox.dependency_network_approval_required", map[string]any{"plan_id": result.PlanID, "error": cause.Error(), "scope": "go_dependency_commands"})
		s.bus.Publish(sessionID, "execution.failed", map[string]any{"error": cause.Error(), "execution_mode": updated.ExecutionMode, "repair_pending": false, "dependency_network_approval": true})
		return result, updated, cause
	}

	// The sandbox ran out of disk, memory or file descriptors. The generated
	// source is not implicated and a repair round provably cannot help (the
	// retry fails identically), so classify it, keep the verified-so-far
	// candidate, and hand the operator a host-side remedy instead.
	if evidence, exhausted := detectResourceExhaustion(result); exhausted {
		updated, _ = s.store.Update(sessionID, func(current *domain.Session) error {
			current.FailureKind = domain.FailureKindSandboxResourceExhausted
			current.LastRepairError = "sandbox resource exhausted while running " + evidence.commandLine() + ": " + evidence.Diagnostic
			return nil
		})
		s.bus.Publish(sessionID, "sandbox.resource_exhausted", map[string]any{
			"plan_id": result.PlanID, "argv": evidence.Argv, "cwd": evidence.Cwd,
			"exit_code": evidence.ExitCode, "diagnostic": evidence.Diagnostic,
		})
		s.bus.Publish(sessionID, "execution.failed", map[string]any{"error": cause.Error(), "execution_mode": updated.ExecutionMode, "repair_pending": false, "failure_kind": domain.FailureKindSandboxResourceExhausted})
		return result, updated, cause
	}

	var replayConflict *pendingChangeSetReplayConflict
	if errors.As(cause, &replayConflict) {
		conflicted, conflictErr := s.prepareConflictResolution(ctx, sessionID, updated, updated.PendingHostChanges, replayConflict.conflicts)
		if conflictErr != nil {
			s.bus.Publish(sessionID, "conflict.prepare_failed", map[string]any{"error": conflictErr.Error(), "source": "pending_changeset_replay"})
		} else {
			updated = conflicted
		}
		s.bus.Publish(sessionID, "execution.failed", map[string]any{
			"error": cause.Error(), "execution_mode": updated.ExecutionMode,
			"conflict_resolution_pending": updated.State == "conflict_resolution_pending",
			"conflict_source":             "pending_changeset_replay", "changeset_id": replayConflict.changeSetID,
		})
		return result, updated, cause
	}

	var replayIntegrationConflict *pendingIntegrationReplayConflict
	if errors.As(cause, &replayIntegrationConflict) {
		conflict := replayIntegrationConflict.conflict
		failedPlanID := planIDForIntegrationBranch(updated.PendingHostChanges, conflict.Branch)
		conflicted, conflictErr := s.prepareConflictResolutionFromMerge(ctx, sessionID, updated, replayIntegrationConflict.workspacePath, failedPlanID, conflict)
		if conflictErr != nil {
			s.bus.Publish(sessionID, "conflict.prepare_failed", map[string]any{"error": conflictErr.Error(), "source": "pending_integration_branch_replay"})
		} else {
			updated = conflicted
		}
		s.bus.Publish(sessionID, "execution.failed", map[string]any{
			"error": cause.Error(), "execution_mode": updated.ExecutionMode,
			"conflict_resolution_pending": updated.State == "conflict_resolution_pending",
			"conflict_source":             "pending_integration_branch_replay", "branch": conflict.Branch,
		})
		return result, updated, cause
	}

	if updated.IntegrationConflict != nil && updated.Plan != nil && updated.IntegrationConflict.RequestID == updated.Plan.RequestID {
		if effortAttemptAvailable(updated) {
			// A replay this late in the flow can fail on paths the open
			// conflict's capsule never authorized — the same candidate commit
			// drifting further out of sync with the host between rounds, not a
			// fresh collision. An offline merge-tree preflight against the
			// live host HEAD (never planner prose or a patch tool's stdout,
			// which do not exist for every failure shape here) is the ground
			// truth for whether that happened; extending the thread and
			// resending a full capsule for that case is what stops the plain
			// retry below from resending byte-identical content the planner
			// already rejected as incomplete. See ADR-0065.
			if s.conflictNeedsCapsuleExtension(ctx, updated) {
				if renewed, renewErr := s.refreshConflictCapsule(ctx, sessionID, updated); renewErr == nil {
					updated = renewed
					updated, _ = s.store.Update(sessionID, func(current *domain.Session) error {
						current.RepairAttempt++
						current.RepairParentPlanID = result.PlanID
						current.LastRepairError = cause.Error()
						return nil
					})
				} else {
					s.bus.Publish(sessionID, "conflict.retry_prepare_failed", map[string]any{"error": renewErr.Error()})
				}
			} else if retried, retryErr := s.prepareConflictResolutionRetry(ctx, sessionID, updated, cause); retryErr == nil {
				updated = retried
				updated, _ = s.store.Update(sessionID, func(current *domain.Session) error {
					current.RepairAttempt++
					current.RepairParentPlanID = result.PlanID
					current.LastRepairError = cause.Error()
					return nil
				})
			} else {
				s.bus.Publish(sessionID, "conflict.retry_prepare_failed", map[string]any{"error": retryErr.Error()})
			}
		}
		s.bus.Publish(sessionID, "execution.failed", map[string]any{"error": cause.Error(), "execution_mode": updated.ExecutionMode, "conflict_resolution_pending": updated.State == "conflict_resolution_pending", "repair_attempt": updated.RepairAttempt})
		return result, updated, cause
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

// plannerRepairableApplyError is an internal capability marker. Apply starts a
// new planner request only when the local integration path reached a concrete
// candidate defect after doing its own rollback/recovery. Preconditions,
// coordination locks, persistence failures and unknown local plumbing errors
// are deliberately unmarked and therefore cannot spend a GPT round.
type plannerRepairableApplyError struct{ cause error }

func (e *plannerRepairableApplyError) Error() string { return e.cause.Error() }
func (e *plannerRepairableApplyError) Unwrap() error { return e.cause }

// localApplyRecoveryError overrides a nested candidate-defect marker when the
// integration engine itself could not finish rollback/recovery. A planner may
// repair source, but it cannot repair Wharnex's transaction or Git machinery.
type localApplyRecoveryError struct{ cause error }

func (e *localApplyRecoveryError) Error() string { return e.cause.Error() }
func (e *localApplyRecoveryError) Unwrap() error { return e.cause }

func localApplyRecoveryFailure(cause error) error {
	if cause == nil {
		return nil
	}
	var local *localApplyRecoveryError
	if errors.As(cause, &local) {
		return cause
	}
	return &localApplyRecoveryError{cause: cause}
}

func plannerRepairableApplyFailure(cause error) error {
	if cause == nil {
		return nil
	}
	var marked *plannerRepairableApplyError
	if errors.As(cause, &marked) {
		return cause
	}
	return &plannerRepairableApplyError{cause: cause}
}

func isPlannerRepairableApplyFailure(cause error) bool {
	var local *localApplyRecoveryError
	if errors.As(cause, &local) {
		return false
	}
	var marked *plannerRepairableApplyError
	return errors.As(cause, &marked)
}

func (s *Service) TriggerApplyFailureRepair(ctx context.Context, sessionID string, cause error) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	if !isPlannerRepairableApplyFailure(cause) {
		planID := ""
		if item.LastExecution != nil {
			planID = item.LastExecution.PlanID
		}
		s.bus.Publish(sessionID, "automation.local_recovery_retained", map[string]any{"error": cause.Error(), "plan_id": planID})
		return item, nil
	}
	if item.LastExecution != nil {
		repaired, repairErr := s.prepareRepairRequest(ctx, sessionID, *item.LastExecution, cause)
		if repairErr == nil {
			return repaired, nil
		}
		s.bus.Publish(sessionID, "repair.prepare_failed", map[string]any{"error": repairErr.Error()})
	}
	return item, nil
}

// RequestFailureRepair is the explicit operator fallback for a repairable
// execution or planner failure. It can resend an already prepared repair after
// Desktop transport failed, or start a fresh manual repair cycle after the
// bounded automatic attempts were exhausted. A planner guidance block requires
// new evidence; infrastructure failures stay on their dedicated local recovery
// paths and never become source-patch requests.
func (s *Service) RequestFailureRepair(ctx context.Context, sessionID, guidance string) (domain.Session, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return domain.Session{}, err
	}
	if kind := sessionFailureKind(current); kind != "" && kind != domain.FailureKindPlannerGuidanceRequired {
		return current, fmt.Errorf("failure %s requires its dedicated local recovery action", kind)
	}
	cleanGuidance := truncateRepairText(guidance, 4000)
	if current.State == "repair_pending" && strings.TrimSpace(current.LastManualPrompt) != "" {
		updated, updateErr := s.store.Update(sessionID, func(item *domain.Session) error {
			item.LastManualPrompt = appendOperatorRepairGuidance(item.LastManualPrompt, cleanGuidance)
			return nil
		})
		if updateErr != nil {
			return current, updateErr
		}
		s.bus.Publish(sessionID, "repair.manual_prompt_ready", map[string]any{"request_id": updated.LastRequestID, "reused": true, "has_guidance": cleanGuidance != ""})
		return updated, nil
	}
	if current.State != "failed" || current.LastExecution == nil || current.LastExecution.Success {
		if current.State == "failed" && strings.TrimSpace(current.LastRepairError) != "" && current.LastExecution == nil {
			return s.retryFailedRequestWithGuidance(ctx, sessionID, false, cleanGuidance)
		}
		// conflict_resolution_exhausted has no LastExecution of its own (it is
		// set from the Git-merge conflict path, never from a run
		// execution), so it can never reach the "failed" branch above — it
		// used to fall straight through to the generic "no repairable
		// failure" refusal below with no way back at all. Route it through
		// the same guided-retry path, which requires guidance unconditionally
		// for this state and resets the spent attempt budget on success.
		if current.State == "conflict_resolution_exhausted" {
			return s.retryFailedRequestWithGuidance(ctx, sessionID, false, cleanGuidance)
		}
		// A host Apply failure keeps its verified candidate and a successful
		// LastExecution, so it reached this refusal too — the operator was told
		// nothing was repairable while looking straight at the failure.
		if strings.TrimSpace(current.LastRepairError) != "" && len(hostApplicablePendingChanges(pendingHostChanges(current))) > 0 {
			return s.retryFailedRequestWithGuidance(ctx, sessionID, false, cleanGuidance)
		}
		return current, errors.New("no repairable failure is available")
	}
	if current.PlannerInFlight || len(current.PendingManualRequestIDs) > 0 {
		return current, errors.New("another planner request is already pending")
	}
	cause := strings.TrimSpace(current.LastRepairError)
	if cause == "" {
		cause = strings.TrimSpace(current.LastExecution.Error)
	}
	if cause == "" {
		cause = "execution failed without a diagnostic message"
	}
	return s.prepareRepairRequestWithOptions(ctx, sessionID, *current.LastExecution, errors.New(cause), true, cleanGuidance)
}

func appendOperatorRepairGuidance(prompt, guidance string) string {
	if guidance == "" {
		return prompt
	}
	addition := "OPTIONAL OPERATOR GUIDANCE:\n" + guidance
	if strings.Contains(prompt, addition) {
		return prompt
	}
	return strings.TrimSpace(prompt) + "\n\n" + addition
}

func (s *Service) prepareRepairRequest(ctx context.Context, sessionID string, result domain.ExecutionResult, cause error) (domain.Session, error) {
	return s.prepareRepairRequestWithOptions(ctx, sessionID, result, cause, false, "")
}

func (s *Service) prepareRepairRequestWithOptions(ctx context.Context, sessionID string, result domain.ExecutionResult, cause error, manual bool, guidance string) (domain.Session, error) {
	return s.prepareRepairRequestWithKind(ctx, sessionID, result, cause, manual, guidance, requestKindRepair)
}

func (s *Service) prepareRepairRequestWithKind(ctx context.Context, sessionID string, result domain.ExecutionResult, cause error, manual bool, guidance, lineageKind string) (domain.Session, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return current, err
	}
	// An infrastructure failure (host toolchain mismatch, offline Go module
	// cache, ...) is never fixable by a source patch, so routing it into the
	// ChatGPT repair loop only spends a bounded repair attempt on a request
	// the model cannot satisfy. Classify first and short-circuit before any
	// attempt-count bookkeeping: this must block the very first repair
	// round, not just the ones after RepairAttempt is exhausted.
	if lineageKind != requestKindRevertRestore {
		if kind := classifyExecutionFailure(cause); kind != "" {
			updated, updateErr := s.store.Update(sessionID, func(item *domain.Session) error {
				item.FailureKind = kind
				item.LastRepairError = cause.Error()
				// An infrastructure block still costs the operator a round of
				// wall-clock time, and the next planner round must know the
				// approach reached this wall rather than a source defect.
				recordAttemptRound(item, knowledgeReviewRoot(*item, item.LastRequestID), attemptRoundFromExecution(
					item.LastRequestID, lineageKind, result, domain.AttemptOutcomeInfrastructure, kind+": "+executionFailureCauseSummary(result, cause)))
				return nil
			})
			if updateErr != nil {
				return current, updateErr
			}
			s.bus.Publish(sessionID, "automation.infrastructure_blocked", map[string]any{"error": cause.Error(), "kind": kind, "plan_id": result.PlanID})
			return updated, nil
		}
	}
	if !manual && !effortAttemptAvailable(current) {
		s.bus.Publish(sessionID, "repair.exhausted", map[string]any{"attempts": automaticAttemptsSpent(current), "plan_id": result.PlanID, "effort_level": normalizeEffortLevel(current.EffortLevel)})
		return current, nil
	}

	// Record the round that just failed BEFORE preparing its correction, so the
	// repair request carries the complete measured history including the
	// failure it is answering. Without this the planner sees only the latest
	// diagnostics and keeps rediscovering that round two already failed the
	// same way.
	_, _ = s.store.Update(sessionID, func(item *domain.Session) error {
		recordAttemptRound(item, knowledgeReviewRoot(*item, item.LastRequestID), attemptRoundFromExecution(
			item.LastRequestID, lineageKind, result, repairAttemptOutcome(cause), executionFailureCauseSummary(result, cause)))
		return nil
	})
	refreshed, err := s.refreshContext(sessionID)
	if err != nil {
		return current, fmt.Errorf("refresh context for repair: %w", err)
	}
	requestID := ids.New("req")
	// Anchor this correction's own base tree and measure how the local project
	// diverged from the snapshot the planner already holds. Only the Main
	// Request used to do this, which left every repair round producing a plan
	// with no anchored base and no statement of what had actually changed.
	s.prepareContinuation(ctx, refreshed, requestID, refreshed.LastRequestID)
	attempt := refreshed.RepairAttempt + 1
	automationAttempt := automaticAttemptsSpent(refreshed)
	if !manual {
		automationAttempt++
	}
	repairMessage := buildRepairMessage(refreshed, result, cause, attempt, automationAttempt, manual, guidance)
	if lineageKind == requestKindRevertRestore {
		repairMessage = buildRevertRestoreMessage(refreshed, result, cause)
	}
	s.bus.Publish(sessionID, "repair.started", map[string]any{"request_id": requestID, "attempt": attempt, "automation_attempt": automationAttempt, "failed_plan_id": result.PlanID, "manual": manual, "effort_level": normalizeEffortLevel(refreshed.EffortLevel), "iteration_kind": lineageKind})
	knowledgeSnapshot, err := s.loadRequestKnowledge(sessionID, refreshed.ProjectPath)
	if err != nil {
		return refreshed, err
	}

	planned, err := s.planner.Plan(ctx, s.plannerRequest(ctx, planner.Request{
		SessionID:              sessionID,
		RequestID:              requestID,
		ParentRequestID:        refreshed.LastRequestID,
		Message:                repairMessage,
		ContextTextPath:        refreshed.Context.TextPath,
		ContextManifest:        refreshed.Context.Manifest,
		PreviousResponseID:     refreshed.LastProviderResponseID,
		AutomationMode:         refreshed.AutomationMode,
		SelfEvolution:          s.isSelfEvolution(refreshed),
		ExpectedBundleFilename: expectedResponseBundleFilenameForDerivedRequest(refreshed, requestID, refreshed.LastRequestID),
	}, knowledgeSnapshot, refreshed.ProjectPath))
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

	var prunedContexts []string
	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		recordRequestLineage(item, requestID, refreshed.LastRequestID, lineageKind)
		recordRequestKnowledge(item, requestID, knowledgeSnapshot)
		item.LastRequestID = requestID
		recordRequestBaseline(item, requestID, refreshed.Context.Manifest.SHA256)
		prunedContexts = append(prunedContexts, recordRequestContext(item, requestID, refreshed.Context)...)
		item.LastManualPrompt = planned.ManualPrompt
		item.LastRepairError = cause.Error()
		item.RepairAttempt = attempt
		if !manual {
			item.AutomationAttempt = automationAttempt
		}
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
		if err := protocol.ValidateChangePlan(*planned.Plan); err != nil {
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
	s.cleanupPrunedRequestContexts(prunedContexts)
	switch {
	case planned.Turn != nil && planned.Turn.Outcome != nil && planned.Turn.Outcome.Status != domain.TurnOutcomeCompleted:
		s.setProjectTodosByRequestLineage(updated, requestID, domain.ProjectTodoExecutionFailed, planned.Turn.Outcome.Message)
	case planned.Turn != nil && planned.Turn.Kind == domain.TurnKindBlocked:
		s.setProjectTodosByRequestLineage(updated, requestID, domain.ProjectTodoExecutionFailed, "request blocked")
	case planned.Plan == nil && planned.Turn != nil && (planned.Turn.Kind == domain.TurnKindAnswer || planned.Turn.Kind == domain.TurnKindInvestigation):
		s.setProjectTodosByRequestLineage(updated, requestID, domain.ProjectTodoExecutionDone, "")
	default:
		s.setProjectTodosByRequestLineage(updated, requestID, domain.ProjectTodoExecutionProcessing, "")
	}
	if planned.Plan == nil {
		s.bus.Publish(sessionID, "repair.prompt_ready", map[string]any{"request_id": requestID, "attempt": attempt, "failed_plan_id": result.PlanID, "iteration_kind": lineageKind})
	} else {
		s.bus.Publish(sessionID, "repair.plan_ready", map[string]any{"request_id": requestID, "attempt": attempt, "plan_id": planned.Plan.PlanID, "iteration_kind": lineageKind})
	}
	return updated, nil
}

func buildRepairMessage(item domain.Session, result domain.ExecutionResult, cause error, attempt, automationAttempt int, manual bool, guidance string) string {
	requestHeading := "AUTOMATIC REPAIR REQUEST — " + effortAttemptLabel(item, automationAttempt) + " · effort " + string(normalizeEffortLevel(item.EffortLevel))
	if manual {
		requestHeading = fmt.Sprintf("MANUAL GPT REPAIR REQUEST — operator requested after %d autonomous attempt(s)", automaticAttemptsSpent(item))
	}
	operatorGuidance := ""
	if clean := truncateRepairText(guidance, 4000); clean != "" {
		operatorGuidance = "\n\nOPTIONAL OPERATOR GUIDANCE:\n" + clean
	}
	if strings.HasPrefix(cause.Error(), "policy denied plan:") {
		if !manual {
			requestHeading = "AUTOMATIC POLICY REPAIR REQUEST — " + effortAttemptLabel(item, automationAttempt) + " · effort " + string(normalizeEffortLevel(item.EffortLevel))
		}
		return fmt.Sprintf(`%s

The previous execution bundle was rejected by the Wharnex Policy Engine BEFORE any operation was executed.
Do not ask to relax, bypass, disable, or work around the Policy Engine. Produce a replacement plan for the SAME user intent using only operations and verification commands that are permitted by Wharnex policy.

BLOCKED PLAN ID: %s
POLICY REASONS:
%s

Use the current Wharnex project context as authoritative. Replace denied commands with safe project-local alternatives where possible. Return the corrected plan through the normal Wharnex file-first delivery contract.%s`, requestHeading, result.PlanID, truncateRepairText(strings.TrimPrefix(cause.Error(), "policy denied plan:"), 12000), operatorGuidance)
	}
	modeNote := "The failed Protected sandbox was discarded. Build the replacement patch against the original host project state represented by the Wharnex context."
	if len(item.PendingHostChanges) > 0 {
		modeNote = "Verified host-pending changes are retained. Build the correction incrementally against the candidate state produced by the pending patches listed below; Wharnex will replay and verify the complete chain in a fresh Protected sandbox before offering Apply again."
	}
	if item.ExecutionMode == domain.ExecutionModeUnprotected {
		modeNote = "The failed Unprotected execution may have partially changed the host. Wharnex refreshed the project context before creating this repair request; use that current context as authoritative."
	}
	failureText := truncateRepairText(cause.Error(), 12000)
	if strings.Contains(cause.Error(), "self-evolution host build failed") {
		failureText = truncateBuildFailureText(cause.Error(), 12000)
	}
	var diagnostics strings.Builder
	for index, command := range result.Commands {
		fmt.Fprintf(&diagnostics, "\n[%d] %s (exit %d, success=%t)\n%s\n", index+1, strings.Join(command.Argv, " "), command.ExitCode, command.Success, truncateRepairText(commandResultDiagnostic(command), 6000))
	}
	// A missing executable reads like an ordinary failure in raw output, and
	// a planner handed only that output tends to re-read the source instead of
	// swapping the tool. Name the real cause so the repair targets it.
	if evidence, missing := detectMissingExecutable(result); missing {
		modeNote += fmt.Sprintf("\n\nROOT CAUSE — MISSING EXECUTABLE: %q is NOT installed in the Protected runner image, so %q exited 127 before doing any work. This is not a source defect: do not modify project code to chase it. Replace that command with one built from the executables listed in the request's LOCAL EXECUTION ENVIRONMENT tools inventory, or drop the check.", evidence.executableName(), evidence.commandLine())
	}
	return fmt.Sprintf(`%s

The previous execution plan failed and Wharnex captured the failure automatically.
Do not repeat the failed plan unchanged or submit a semantically equivalent strategy. Produce a corrected replacement plan for the SAME user intent, and make the new approach directly eliminate the named failure cause. If the cause cannot be fixed inside the current project/policy/environment, stop with a terminal blocked result using retryable=false and name the operator action required instead of starting another loop.
%s

FAILED PLAN ID: %s
EXECUTION MODE: %s
FAILURE:
%s

ROOT-CAUSE SUMMARY:
%s

CAPTURED COMMAND / VERIFICATION DIAGNOSTICS:%s

%s

KNOWLEDGE PROMOTION:
This repair response may be the last planner turn before verification and host Apply. If the failure exposed a reusable operational cause, fixture invariant, verification pattern, environment constraint, or repair strategy, update or consolidate the relevant knowledge/<id>.md record NOW in this response. Do not defer learning until after success because there is no post-Apply planner round. Prefer editing/merging an existing record on the same topic over creating a duplicate. Keep transient one-off details only in attempts/ledger.md.

Use the existing project context and the failure evidence above to identify the actual regression or execution problem. Return the corrected plan through the normal Wharnex file-first delivery contract.%s`, requestHeading, modeNote, result.PlanID, item.ExecutionMode, failureText, truncateRepairText(executionFailureCauseSummary(result, cause), 4000), diagnostics.String(), pendingHostChangePrompt(item.PendingHostChanges), operatorGuidance)
}

func truncateRepairText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "\n...[truncated by Wharnex]"
}

// truncateBuildFailureText keeps the beginning and end of verbose host-build
// output. The beginning identifies the phase that ran; the end contains the
// exit diagnostic that decides whether a candidate needs source repair or a
// local infrastructure action.
func truncateBuildFailureText(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	head := limit / 3
	tail := limit - head
	return value[:head] + "\n...[middle build output truncated by Wharnex; terminal output retained]...\n" + value[len(value)-tail:]
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

// ApplyToHost integrates this session's verified candidate into its host, and
// then — only on success — dispatches whatever the same response was granted to
// change in other projects.
//
// The dispatch happens outside the apply lock deliberately. That lock
// serializes one project's host integration, and a cross-project run is a full
// pipeline in another project: holding the primary project's lock across it
// would stall every other request on this project for the duration of work that
// does not touch it.
func (s *Service) ApplyToHost(ctx context.Context, sessionID string) (domain.Session, error) {
	applied, err := s.applyToHostLocked(ctx, sessionID)
	if err != nil {
		return applied, err
	}
	s.maybeRunCrossProjectUnits(ctx, sessionID, "apply")
	if refreshed, getErr := s.store.Get(sessionID); getErr == nil {
		return refreshed, nil
	}
	return applied, nil
}

func (s *Service) applyToHostLocked(ctx context.Context, sessionID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	applyLock := s.projectApplyLock(item.ProjectPath)
	applyLock.Lock()
	defer applyLock.Unlock()
	// The caller may have read the session while another Apply for the same
	// project was still running. The project lock serializes host mutation, but
	// it does not make that pre-lock snapshot current: using it here replayed an
	// integration branch that the first Apply had already merged and deleted.
	// Reload under the lock so candidate consumption is an atomic precondition.
	item, err = s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	if item.ExecutionMode == domain.ExecutionModeUnprotected {
		return item, errors.New("apply is unavailable in unprotected mode because execution already targets the host")
	}
	if item.Plan != nil && planExecutionHeld(item, item.Plan.PlanID) {
		s.bus.Publish(sessionID, "host.apply_paused", map[string]any{"plan_id": item.Plan.PlanID, "state": planControlState(item, item.Plan.PlanID)})
		return item, errors.New("host apply is paused or suspended for the active plan")
	}
	initialized, err := projectgit.Ensure(ctx, item.ProjectPath)
	if err != nil {
		return item, fmt.Errorf("prepare project git repository before host apply: %w", err)
	}
	if initialized {
		s.bus.Publish(sessionID, "project.git_initialized", map[string]any{"project_path": item.ProjectPath, "reason": "host_apply"})
	}
	pending := hostApplicablePendingChanges(pendingHostChanges(item))
	if len(pending) == 0 {
		s.bus.Publish(sessionID, "host.apply_duplicate_blocked", map[string]any{"state": item.State, "reason": "no unconsumed verified candidate remains after acquiring the project apply lock"})
		return item, ErrExecutionRequired
	}
	// Retire what later rounds already superseded and release a conflict record
	// whose round can no longer arrive, before the guard below reads either.
	// Both are states earlier rounds left behind, and both otherwise park
	// verified work permanently: the guard refuses every Apply while a record
	// exists, and nothing else ever clears an orphaned one.
	pending, item, err = s.healPendingIntegrationState(ctx, sessionID, item, pending)
	if err != nil {
		return item, err
	}
	if len(pending) == 0 {
		// Nothing is left to integrate because the host already carries it, or
		// because later rounds superseded it. Settling here is what keeps the
		// chat from asking for an Apply it can never complete: returning an
		// error instead left a session holding work the host demonstrably had.
		return s.settleAlreadyIntegratedApply(sessionID, item)
	}
	if pendingHostResolutionBlocked(item) {
		return item, errors.New("finish the active planner/repair turn before applying pending host changes")
	}
	pending, legacyRepositoriesUpgraded, err := upgradeLegacyRepositoryIntegrations(ctx, item.ProjectPath, pending)
	if err != nil {
		return item, fmt.Errorf("recover legacy submodule candidate: %w", err)
	}
	if legacyRepositoriesUpgraded {
		updated, persistErr := s.store.Update(sessionID, func(current *domain.Session) error {
			for index := range pending {
				current.PendingHostChanges = upsertPendingHostChange(current.PendingHostChanges, pending[index])
			}
			return nil
		})
		if persistErr != nil {
			return item, fmt.Errorf("persist recovered legacy submodule candidate: %w", persistErr)
		}
		item = updated
		s.bus.Publish(sessionID, "integration.legacy_units_upgraded", map[string]any{"plan_count": len(pending)})
	}
	pending, legacyPatchesPromoted, err := s.promoteLegacyPatchBranches(ctx, sessionID, item, pending)
	if err != nil {
		return item, fmt.Errorf("promote legacy candidate: %w", err)
	}
	if legacyPatchesPromoted {
		updated, persistErr := s.store.Update(sessionID, func(current *domain.Session) error {
			for index := range pending {
				current.PendingHostChanges = upsertPendingHostChange(current.PendingHostChanges, pending[index])
			}
			clearSessionFailure(current)
			current.State = "verified"
			return nil
		})
		if persistErr != nil {
			return item, fmt.Errorf("persist promoted legacy candidate: %w", persistErr)
		}
		item = updated
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
	// Candidates created before Git-native integration carry ChangeSets. They
	// are promoted below to real integration branches before any host file is
	// changed, so commit mode and rollback have one contract regardless of the
	// version that originally verified the candidate.
	useIntegrationBranches := allPendingHaveIntegrationBranches(pending)
	useChangeSets := !useIntegrationBranches && allPendingHaveChangeSets(pending)
	var stagedIntegration stagedHostIntegration
	stagedIntegrationCleaned := true
	if useChangeSets {
		stagedIntegration, err = s.stageHostIntegration(ctx, sessionID, item, pending)
		if err != nil {
			// Staging never touched the host, so the candidate is intact and
			// the failure describes a concrete divergence between it and the
			// project. Marking it repairable is what lets the automatic path
			// dispatch a correction instead of leaving a verified bundle
			// parked on an error nobody owns.
			failure := plannerRepairableApplyFailure(fmt.Errorf("%w: %v", ErrIntegrationStaging, err))
			s.bus.Publish(sessionID, "integration.staging_failed", map[string]any{"error": err.Error(), "plan_count": len(pending)})
			return item, fmt.Errorf("stage ChangeSet integration: %w", failure)
		}
		if stagedIntegration.prepared.Outcome == domain.IntegrationConflict {
			updated, prepareErr := s.prepareConflictResolution(ctx, sessionID, item, pending, stagedIntegration.prepared.Conflicts)
			if errors.Is(prepareErr, ErrManagedStateConflict) {
				return updated, prepareErr
			}
			if prepareErr != nil {
				return item, fmt.Errorf("prepare focused conflict resolution: %w", prepareErr)
			}
			return updated, fmt.Errorf("%w: %s", ErrIntegrationConflict, strings.Join(conflictPaths(stagedIntegration.prepared.Conflicts), ", "))
		}
		stagedIntegrationCleaned = false
		defer func() {
			if !stagedIntegrationCleaned {
				_ = s.runner.Cleanup(stagedIntegration.workspace)
			}
		}()
		pending = stagedIntegration.pending
		promoted, persistErr := s.store.Update(sessionID, func(current *domain.Session) error {
			for index := range pending {
				current.PendingHostChanges = upsertPendingHostChange(current.PendingHostChanges, pending[index])
			}
			return nil
		})
		if persistErr != nil {
			return item, fmt.Errorf("persist promoted legacy integration branches: %w", persistErr)
		}
		item = promoted
		useIntegrationBranches = allPendingHaveIntegrationBranches(pending)
		useChangeSets = false
		if !useIntegrationBranches {
			return item, errors.New("promoted legacy candidates did not produce a complete Git integration chain")
		}
		_ = s.runner.Cleanup(stagedIntegration.workspace)
		stagedIntegrationCleaned = true
	}
	reverify := false
	for index := range pending {
		if useChangeSets || useIntegrationBranches {
			// A real Git merge resolves host drift natively (clean merge or
			// a genuine conflict) — the custom baseline-staleness pre-check
			// below exists only for the legacy per-patch path.
			break
		}
		expected := strings.TrimSpace(expectedBaselines[index])
		if expected == "" || expected == currentBaseline {
			continue
		}
		if canFastForwardPlanBaseline(item, &pending[index].Plan, expected, currentBaseline) || canLegacyRebasePlan(item, &pending[index].Plan) {
			reverify = true
			continue
		}
		s.bus.Publish(sessionID, "baseline.apply_blocked", map[string]any{"plan_id": pending[index].Plan.PlanID, "expected_sha256": expected, "current_sha256": currentBaseline, "impact_files": pending[index].Plan.ImpactFiles})
		failure := fmt.Errorf("%w: host apply blocked by stale baseline: plan %s was verified on %s but current baseline is %s", ErrStaleHostBaseline, pending[index].Plan.PlanID, expected, currentBaseline)
		updated, persistErr := s.recordHostApplyFailure(sessionID, pending[index].Plan.PlanID, failure, 0)
		if persistErr != nil {
			return item, fmt.Errorf("%w; retain host apply failure for correction: %v", failure, persistErr)
		}
		return updated, failure
	}
	if reverify {
		reverified, reverifyErr := s.reverifyPendingCandidate(ctx, sessionID, item, pending, currentBaseline)
		if reverifyErr != nil {
			s.bus.Publish(sessionID, "baseline.reverify_failed", map[string]any{"current_sha256": currentBaseline, "error": reverifyErr.Error()})
			return item, baselineReverifyCandidateFailure(reverifyErr)
		}
		item = reverified
		pending = hostApplicablePendingChanges(pendingHostChanges(item))
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
	// Resolved once, here, for the whole Apply: reading the setting again later
	// would let a toggle flipped mid-Apply commit half a batch and leave the
	// rest uncommitted. Self-evolution always commits — its transaction
	// rollback, activation and lineage all anchor on real commits, so an
	// uncommitted self-evolution has nothing to roll back to.
	commitMode := s.projectCommitMode(item.ProjectPath)
	if selfEvolution && commitMode != gitsettings.CommitModeAuto {
		commitMode = gitsettings.CommitModeAuto
		s.bus.Publish(sessionID, "git.commit_mode_overridden", map[string]any{
			"plan_id": latestPlanID, "mode": string(gitsettings.CommitModeAuto),
			"reason": "self-evolution rollback and activation anchor on real commits",
		})
	}
	var transaction selfevolution.Transaction
	if selfEvolution {
		transaction, err = s.selfEvolution.Prepare(sessionID, latestPlanID, patches)
		if err != nil {
			return item, fmt.Errorf("prepare Wharnex self-evolution transaction: %w", err)
		}
		s.bus.Publish(sessionID, "self_evolution.transaction_started", map[string]any{"plan_id": latestPlanID, "transaction_id": transaction.ID})
	}
	abortPreparedTransaction := func(cause error) error {
		if !selfEvolution {
			return cause
		}
		if transaction.Extended {
			if removeErr := transaction.RemoveExtensionPlan(sessionID, latestPlanID); removeErr != nil {
				cause = fmt.Errorf("%w; retain pending self-evolution membership after failed extension: %v", cause, removeErr)
			}
			previous := transaction.PreviousPending
			_ = s.selfEvolution.RecordStatus(transaction, previous.SessionID, previous.PlanID, "restart_pending", "previous pending batch retained after extension failed before host mutation: "+cause.Error())
			transaction.ReleaseStage()
			s.bus.Publish(sessionID, "self_evolution.extension_aborted_retained", map[string]any{"plan_id": latestPlanID, "transaction_id": transaction.ID, "error": cause.Error()})
			return cause
		}
		_ = s.selfEvolution.RecordStatus(transaction, sessionID, latestPlanID, "aborted", cause.Error())
		transaction.Release()
		transaction.Finalize()
		s.bus.Publish(sessionID, "self_evolution.transaction_aborted", map[string]any{"plan_id": latestPlanID, "error": cause.Error()})
		return cause
	}

	rollback := func(cause error) error {
		if !selfEvolution {
			return cause
		}
		if rollbackErr := transaction.Rollback(ctx); rollbackErr != nil {
			_ = s.selfEvolution.RecordStatus(transaction, sessionID, latestPlanID, "rollback_failed", rollbackErr.Error())
			s.updateSelfEvolutionBatchSessions(transaction, "restart_pending", rollbackErr.Error())
			transaction.ReleaseStage()
			return localApplyRecoveryFailure(fmt.Errorf("%w; automatic self-evolution rollback also failed: %v", cause, rollbackErr))
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
		return item, abortPreparedTransaction(err)
	}
	defer s.hostRunner.Cleanup(workspace)
	appliedPatches := make([]string, 0, len(patches))
	hostCommands := make([]domain.CommandResult, 0)
	// mergedIntegrationBranches/preMergeIntegrationSHA are set by the
	// useIntegrationBranches block below, once real merges have actually
	// happened, so failApply (defined before that block runs) can revert
	// them if a LATER step (a model-requested git command, or post-merge
	// verification) fails. Declared here so the closure can see them.
	var mergedIntegrationBranches []integratedCandidate
	var preMergeIntegrationSHA string
	var versionChange appliedVersionChange
	failApply := func(cause error) error {
		if !useIntegrationBranches && versionChange.After != "" {
			if restoreErr := restoreProjectVersion(item.ProjectPath, versionChange.After, versionChange.Before); restoreErr != nil {
				cause = fmt.Errorf("%w; VERSION rollback also failed: %v", cause, restoreErr)
			}
		}
		var failure error
		switch {
		case useIntegrationBranches && preMergeIntegrationSHA != "":
			// A real `git reset --hard` to the exact pre-merge HEAD undoes
			// every merge this Apply attempt made, in one step — simpler
			// and more reliable than the CAS journal's per-write rollback.
			// For self-evolution, this ALSO has to run before the
			// transaction's own rollback: that rollback restores captured
			// file/build-artifact snapshots, but knows nothing about Git
			// refs, so HEAD would otherwise keep pointing at the merge
			// commit while the working tree no longer matches it.
			if revertErr := s.revertHostMerge(ctx, sessionID, latestPlanID, item.ProjectPath, preMergeIntegrationSHA, integratedSubmodules(mergedIntegrationBranches, true)); revertErr != nil {
				cause = localApplyRecoveryFailure(fmt.Errorf("%w; git revert also failed: %v", cause, revertErr))
			}
			if selfEvolution {
				failure = rollback(cause)
			} else {
				failure = cause
			}
		case selfEvolution:
			failure = rollback(cause)
		default:
			failure = s.rollbackHostPatches(ctx, item.ProjectPath, appliedPatches, cause)
		}
		_, _ = s.recordHostApplyFailure(sessionID, latestPlanID, failure, len(appliedPatches))
		return failure
	}
	if useIntegrationBranches {
		for _, change := range pending {
			if validateErr := sandbox.ValidateRepositoryIntegrations(ctx, item.ProjectPath, change.SubmoduleIntegrations); validateErr != nil {
				return item, abortPreparedTransaction(fmt.Errorf("validate submodule candidates: %w", validateErr))
			}
		}
		var mergeErr error
		var failedPlanID string
		mergedIntegrationBranches, preMergeIntegrationSHA, failedPlanID, mergeErr = s.mergeIntegrationBranches(ctx, sessionID, item.ProjectPath, pending)
		if mergeErr != nil {
			var conflict *sandbox.MergeConflictError
			if errors.As(mergeErr, &conflict) {
				// Undo any earlier candidates in this batch that already
				// merged cleanly before this one conflicted — all-or-
				// nothing, matching the legacy ChangeSet path's semantics.
				if len(mergedIntegrationBranches) > 0 {
					_ = s.revertHostMerge(ctx, sessionID, latestPlanID, item.ProjectPath, preMergeIntegrationSHA, integratedSubmodules(mergedIntegrationBranches, true))
				}
				updated, prepareErr := s.prepareConflictResolutionFromMerge(ctx, sessionID, item, item.ProjectPath, failedPlanID, conflict)
				if errors.Is(prepareErr, ErrManagedStateConflict) {
					return updated, abortPreparedTransaction(prepareErr)
				}
				if prepareErr != nil {
					return item, abortPreparedTransaction(fmt.Errorf("prepare focused conflict resolution: %w", prepareErr))
				}
				return updated, abortPreparedTransaction(fmt.Errorf("%w: %s", ErrIntegrationConflict, strings.Join(conflict.Paths, ", ")))
			}
			if len(mergedIntegrationBranches) > 0 {
				_ = s.revertHostMerge(ctx, sessionID, latestPlanID, item.ProjectPath, preMergeIntegrationSHA, integratedSubmodules(mergedIntegrationBranches, true))
			}
			// A refused host state is not a defect in the generated change and
			// no new patch can resolve it: the operator has an unfinished
			// merge, unresolved paths, or uncommitted work inside a submodule
			// the change moves. It is retained, classified, and handed back as
			// an operator action rather than spent on a repair round.
			var blocked *hostrepo.BlockedError
			if errors.As(mergeErr, &blocked) {
				return s.failHostStateBlocked(sessionID, item, latestPlanID, blocked, abortPreparedTransaction)
			}
			return item, abortPreparedTransaction(fmt.Errorf("merge integration branch: %w", mergeErr))
		}
	}
	for _, change := range pending {
		for _, op := range change.Plan.Operations {
			if op.Type == "apply_patch" {
				if useChangeSets || useIntegrationBranches {
					continue
				}
				if err := protocol.ValidatePatchPaths(op.Patch); err != nil {
					return item, failApply(err)
				}
				runID := ids.New("host-patch")
				s.bus.Publish(sessionID, "patch.started", map[string]any{"run_id": runID, "target": "host", "files": patchPaths(op.Patch)})
				patchResult, applyErr := s.hostRunner.ApplyPatch(ctx, workspace, op.Patch)
				if applyErr != nil || !patchResult.Success {
					if applyErr != nil {
						return item, failApply(plannerRepairableApplyFailure(fmt.Errorf("host apply failed: %w", applyErr)))
					}
					return item, failApply(plannerRepairableApplyFailure(fmt.Errorf("host apply failed: %s", strings.TrimSpace(patchResult.Stderr))))
				}
				appliedPatches = append(appliedPatches, op.Patch)
				s.bus.Publish(sessionID, "patch.applied", map[string]any{"run_id": runID, "target": "host", "files": patchPaths(op.Patch), "duration_ms": patchResult.DurationMS})
				continue
			}
			if op.Type == "command" && policy.HostReplayGitCommand(op.Command) {
				result, runErr := s.runCommandWithRunner(ctx, sessionID, s.hostRunner, workspace, op.Command, "host")
				if runErr != nil || !result.Success {
					if runErr != nil {
						return item, failApply(plannerRepairableApplyFailure(fmt.Errorf("host git operation failed: %w", runErr)))
					}
					return item, failApply(plannerRepairableApplyFailure(fmt.Errorf("host git operation failed: %s", strings.TrimSpace(result.Stderr))))
				}
				hostCommands = append(hostCommands, result)
			}
		}
	}

	// Gates the host verification environment could not run at all. They are
	// not failures: they are corroboration this Apply went without, reported
	// with the terminal host.applied event so the operator knows exactly which.
	unsupportedHostGates := make([]unsupportedHostGate, 0)
	if useIntegrationBranches && !selfEvolution {
		// Re-run the same gates already run in the sandbox (deduplicated
		// exactly like the sandbox integration pass), now against the
		// REAL merged result on host. For an ordinary project this is new:
		// today's legacy paths never re-verify after a host write at all.
		// Self-evolution skips this and goes straight to BuildHost below,
		// which is a strictly broader check over the same merged result —
		// running both would just double the wait for no extra safety.
		for _, run := range dedupedIntegrationVerifications(pending) {
			index, command := run.index, run.command
			s.bus.Publish(sessionID, "integration.verification_started", map[string]any{"plan_id": pending[index].Plan.PlanID, "argv": command.Argv, "target": "host"})
			result, runErr := s.runCommandWithRunner(ctx, sessionID, s.hostRunner, workspace, command, "host")
			if runErr != nil || !result.Success {
				diagnostic := commandResultDiagnostic(result)
				// A gate this environment cannot run at all returns no verdict
				// about the merge. It already passed in the Protected runner
				// against this same candidate, so reverting over it would
				// discard a verified payload for an infrastructure fault.
				if gate, unsupported := classifyUnsupportedHostGate(command, result); runErr == nil && unsupported {
					unsupportedHostGates = append(unsupportedHostGates, gate)
					s.bus.Publish(sessionID, "integration.verification_unsupported", gate.event(pending[index].Plan.PlanID))
					continue
				}
				if runErr == nil {
					runErr = fmt.Errorf("post-merge verification failed: %s (exit %d): %s", strings.Join(command.Argv, " "), result.ExitCode, diagnostic)
				}
				runErr = wrapHostDependencyState(runErr, diagnostic)
				return item, failApply(plannerRepairableApplyFailure(runErr))
			}
			hostCommands = append(hostCommands, result)
			s.bus.Publish(sessionID, "integration.verification_completed", map[string]any{"plan_id": pending[index].Plan.PlanID, "exit_code": result.ExitCode, "target": "host"})
		}
	}
	if selfEvolution {
		_ = s.selfEvolution.RecordStatus(transaction, sessionID, latestPlanID, "building", "verified patch applied; building real Wharnex host runtime")
		s.bus.Publish(sessionID, "self_evolution.host_build_started", map[string]any{"plan_id": latestPlanID, "transaction_id": transaction.ID})
		buildStarted := time.Now().UTC()
		output, buildErr := s.selfEvolution.BuildHost(ctx, transaction, func(stream, text string) {
			// This build can run for minutes (dependency hydration, npm ci,
			// vite/tsc, go build) with nothing surfaced until it finally
			// succeeds or fails, which reads as a hang. Stream it the same
			// way an ordinary sandbox command already does.
			s.bus.Publish(sessionID, "self_evolution.host_build_output", map[string]any{"stream": stream, "text": text, "transaction_id": transaction.ID})
		})
		if buildErr != nil {
			// A successful test suite can be much noisier than the compiler
			// error emitted at the end. Preserve both build provenance and its
			// terminal diagnostic in the durable recovery evidence.
			detail := truncateBuildFailureText(output, 12000)
			if detail != "" {
				buildErr = fmt.Errorf("%w\n%s", buildErr, detail)
			}
			s.bus.Publish(sessionID, "self_evolution.host_build_failed", map[string]any{"plan_id": latestPlanID, "error": buildErr.Error()})
			return item, failApply(plannerRepairableApplyFailure(buildErr))
		}
		_ = s.selfEvolution.RecordStatus(transaction, sessionID, latestPlanID, "restart_pending", "host build passed; explicit restart confirmation pending")
		hostCommands = append(hostCommands, domain.CommandResult{Argv: []string{"make", "build-stage"}, Cwd: ".", ExitCode: 0, Success: true, DurationMS: time.Since(buildStarted).Milliseconds()})
		s.bus.Publish(sessionID, "self_evolution.host_build_completed", map[string]any{"plan_id": latestPlanID, "transaction_id": transaction.ID})
	}

	versionBeforeHead := ""
	if useIntegrationBranches {
		versionBeforeHead, err = sandbox.CurrentHeadSHA(ctx, item.ProjectPath)
		if err != nil {
			return item, failApply(fmt.Errorf("resolve host HEAD before VERSION increment: %w", err))
		}
	}
	versionCommitSHA := ""
	versionChange, versionCommitSHA, err = s.bumpProjectVersion(ctx, sessionID, item.ProjectPath, pending, useIntegrationBranches)
	if err != nil {
		return item, failApply(fmt.Errorf("apply project VERSION increment: %w", err))
	}
	if versionChange.After != "" && versionChange.After != versionChange.Before {
		changedFiles = normalizedPaths(append(changedFiles, "VERSION"))
		if commitMode == gitsettings.CommitModeManual && useIntegrationBranches && versionCommitSHA != "" {
			mergedIntegrationBranches = append(mergedIntegrationBranches, versionCandidate(sessionID, pending, versionBeforeHead, versionCommitSHA, versionChange))
		}
	}
	if selfEvolution {
		if fingerprintErr := s.selfEvolution.RecordBuiltSourceFingerprint(ctx); fingerprintErr != nil {
			return item, failApply(fingerprintErr)
		}
	}

	// The change is verified and on disk. In manual mode the only thing left
	// to decide is whether it becomes history now or when the operator says
	// so: record what each candidate contributed, then return the branch to
	// where they left it, leaving everything in the working tree.
	if commitMode == gitsettings.CommitModeManual && len(mergedIntegrationBranches) > 0 {
		if unwindErr := s.recordAndUnwindIntegration(ctx, sessionID, item.ProjectPath, mergedIntegrationBranches, preMergeIntegrationSHA); unwindErr != nil {
			return item, failApply(unwindErr)
		}
	}

	hostAppliedAt := time.Now().UTC()
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		if selfEvolution {
			current.State = "restart_pending"
			current.SelfEvolutionActivation = "restart_pending"
			current.SelfEvolutionImpacts = append([]string(nil), transaction.ActivationImpacts...)
		} else {
			current.State = "applied"
		}
		current.SelfEvolution = current.SelfEvolution || selfEvolution
		current.LastAppliedChanges = append([]domain.PendingHostChange(nil), pending...)
		current.LastRevertedChanges = nil
		current.LastHostCommands = append([]domain.CommandResult(nil), hostCommands...)
		current.LastHostAppliedAt = hostAppliedAt
		current.LastVersionBefore = versionChange.Before
		current.LastVersionAfter = versionChange.After
		current.PendingHostChanges = nil
		current.LastManualPrompt = ""
		clearSessionFailure(current)
		if selfEvolution && current.LastTurn != nil && len(current.LastTurn.ResolvedEvidenceIDs) > 0 {
			if current.ResolvedEvidenceIDs == nil {
				current.ResolvedEvidenceIDs = map[string]time.Time{}
			}
			resolvedAt := time.Now().UTC()
			for _, evidenceID := range current.LastTurn.ResolvedEvidenceIDs {
				current.ResolvedEvidenceIDs[evidenceID] = resolvedAt
			}
			current.EvidenceReviewIDs = nil
		}
		return nil
	})
	if err != nil {
		return item, failApply(err)
	}
	if len(mergedIntegrationBranches) > 0 {
		s.deleteIntegrationBranches(ctx, sessionID, item.ProjectPath, integratedBranches(mergedIntegrationBranches))
		s.deleteSubmoduleIntegrationBranches(ctx, sessionID, item.ProjectPath, integratedSubmodules(mergedIntegrationBranches, false))
	}

	s.setProjectTodosByRequestLineage(updated, updated.LastRequestID, domain.ProjectTodoExecutionDone, "")
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
		s.closeRemoteInputChannel(sessionID, "request.completed")
		if committed, commitErr := s.commitPendingKnowledge(sessionID, item.LastRequestID); commitErr != nil {
			s.bus.Publish(sessionID, "knowledge.commit_failed", map[string]any{"error": commitErr.Error(), "request_id": item.LastRequestID})
		} else {
			updated = committed
		}
		return updated, nil
	}

	s.resetDevspace(sessionID)
	appliedEvent := map[string]any{"plan_id": latestPlanID, "plan_count": len(pending)}
	if summary := unsupportedHostGateSummary(unsupportedHostGates); summary != nil {
		appliedEvent["unverified_host_gates"] = summary
	}
	// Commits Wharnex made inside a submodule live only in that submodule's own
	// local repository: push is an explicit human action and Wharnex never
	// performs one. This is the one consequence of submodule-native integration
	// an operator must not have to discover by accident, so it travels with the
	// terminal event rather than only in the Git surface.
	if nested := integratedSubmodules(mergedIntegrationBranches, false); len(nested) > 0 {
		paths := make([]string, 0, len(nested))
		for _, integration := range nested {
			paths = append(paths, integration.Path)
		}
		appliedEvent["submodule_units"] = paths
		appliedEvent["submodule_units_unpushed"] = true
	}
	s.bus.Publish(sessionID, "host.applied", appliedEvent)
	if refreshed, refreshErr := s.refreshContext(sessionID); refreshErr == nil {
		updated = refreshed
		s.publishBaselineUpdate(ctx, updated, currentBaseline, refreshed.Context.Manifest.SHA256, latestPlanID, changedFiles)
	} else {
		s.bus.Publish(sessionID, "context.refresh_after_apply_failed", map[string]any{"error": refreshErr.Error()})
	}
	s.closeRemoteInputChannel(sessionID, "request.completed")
	if committed, commitErr := s.commitPendingKnowledge(sessionID, item.LastRequestID); commitErr != nil {
		s.bus.Publish(sessionID, "knowledge.commit_failed", map[string]any{"error": commitErr.Error(), "request_id": item.LastRequestID})
	} else {
		updated = committed
	}
	return updated, nil
}

// baselineReverifyCandidateFailure identifies an already verified candidate
// whose patches no longer replay on the newest baseline. No host mutation has
// happened at this point: requesting a focused repair is safe and necessary
// to avoid leaving the same stale candidate permanently pending.
func baselineReverifyCandidateFailure(cause error) error {
	return plannerRepairableApplyFailure(fmt.Errorf("reverify pending candidate on current baseline: %w", cause))
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
	if len(patches) == 0 && strings.TrimSpace(item.LastVersionBefore) == "" {
		return item, errors.New("the current plan has no patch or VERSION changes to revert")
	}
	changedFiles := make([]string, 0)
	for _, patch := range patches {
		changedFiles = append(changedFiles, patchTouchedPaths(patch)...)
	}
	if strings.TrimSpace(item.LastVersionBefore) != "" {
		changedFiles = append(changedFiles, "VERSION")
	}
	changedFiles = normalizedPaths(changedFiles)
	latestPlanID := applied[len(applied)-1].Plan.PlanID
	s.bus.Publish(sessionID, "host.revert_started", map[string]any{"plan_id": latestPlanID, "plan_count": len(applied), "patch_count": len(patches)})

	if s.isSelfEvolution(item) && item.State == "restart_pending" {
		transaction, pendingErr := s.selfEvolution.ClaimPendingTransaction(sessionID, latestPlanID)
		if pendingErr != nil {
			return item, fmt.Errorf("recover self-evolution transaction for revert: %w", pendingErr)
		}
		if rollbackErr := transaction.Rollback(ctx); rollbackErr != nil {
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

	if err := restoreProjectVersion(item.ProjectPath, item.LastVersionAfter, item.LastVersionBefore); err != nil {
		return item, fmt.Errorf("restore project VERSION during revert: %w", err)
	}

	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.State = "reverted"
		current.LastRevertedChanges = append([]domain.PendingHostChange(nil), applied...)
		current.LastAppliedChanges = nil
		current.LastHostCommands = nil
		current.LastHostAppliedAt = time.Time{}
		current.LastVersionBefore = ""
		current.LastVersionAfter = ""
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
		return item, errors.New("no Wharnex self-evolution restart is pending confirmation")
	}
	transaction, pending, err := s.selfEvolution.ClaimPendingForSession(sessionID)
	if err != nil {
		return item, fmt.Errorf("recover pending Wharnex self-evolution transaction: %w", err)
	}
	if err := s.selfEvolution.ScheduleRestart(transaction, sessionID, pending.PlanID); err != nil {
		_ = s.selfEvolution.RecordStatus(transaction, sessionID, pending.PlanID, "restart_pending", "restart confirmation accepted but detached handoff failed: "+err.Error())
		transaction.ReleaseStage()
		return item, fmt.Errorf("schedule Wharnex restart: %w", err)
	}
	_ = s.selfEvolution.RecordStatus(transaction, sessionID, pending.PlanID, "restart_scheduled", "detached restart supervisor accepted the pending self-evolution batch")
	s.updateSelfEvolutionBatchSessions(transaction, "restart_scheduled", "")
	transaction.ReleaseStage()
	updated, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	s.bus.Publish(sessionID, "self_evolution.restart_scheduled", map[string]any{"plan_id": pending.PlanID, "transaction_id": transaction.ID})
	go s.awaitSelfEvolutionActivation(transaction.ID)
	return updated, nil
}

func (s *Service) awaitSelfEvolutionActivation(transactionID string) {
	deadline := time.NewTimer(10 * time.Minute)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer deadline.Stop()
	defer ticker.Stop()
	for {
		select {
		case <-deadline.C:
			return
		case <-ticker.C:
			status, err := s.selfEvolution.LastStatus()
			if err != nil || status.Transaction != "txn-"+transactionID {
				continue
			}
			switch status.Phase {
			case "restarted", "rolled_back_runtime", "rollback_failed", "restart_failed":
				s.reconcileSelfEvolutionStatus()
				return
			}
		}
	}
}

func (s *Service) isSelfEvolution(item domain.Session) bool {
	return s.selfEvolution != nil && s.selfEvolution.IsProject(item.ProjectPath)
}

func (s *Service) normalizeSelfEvolutionSessions() {
	for _, item := range s.store.List() {
		canonical := s.selfEvolution != nil && s.selfEvolution.IsProject(item.ProjectPath)
		if item.SelfEvolution == canonical && (!canonical || item.ExecutionMode != domain.ExecutionModeUnprotected) {
			continue
		}
		_, _ = s.store.Update(item.ID, func(current *domain.Session) error {
			current.SelfEvolution = canonical
			if canonical && current.ExecutionMode == domain.ExecutionModeUnprotected {
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
			current.SelfEvolutionImpacts = append([]string(nil), transaction.ActivationImpacts...)
			matchedPlan = current.Plan != nil && current.Plan.PlanID == pending.PlanID
			batchOwnsVisibleState := matchedPlan || current.State == "restart_pending" || current.State == "restart_scheduled"
			if batchOwnsVisibleState {
				current.State = state
				if detail != "" {
					current.LastRepairError = detail
					current.FailureKind = ""
				} else if state == "applied" || state == "restart_scheduled" || state == "reverted" {
					clearSessionFailure(current)
				}
			}
			if activationState == "" {
				current.SelfEvolutionImpacts = nil
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
	transactionReconciled := false
	if transaction, txErr := s.selfEvolution.TransactionForStatus(status); txErr == nil {
		detail := status.Detail
		if status.Phase == "restarted" {
			detail = ""
		}
		if s.updateSelfEvolutionBatchSessions(transaction, state, detail) > 0 {
			if finalize {
				transaction.Finalize()
			}
			transactionReconciled = true
		}
	}
	if !transactionReconciled {
		updated, updateErr := s.store.Update(status.SessionID, func(current *domain.Session) error {
			if !s.isSelfEvolution(*current) || current.Plan == nil || current.Plan.PlanID != status.PlanID {
				return nil
			}
			current.SelfEvolution = true
			if state == "restart_pending" || state == "restart_scheduled" {
				current.SelfEvolutionActivation = state
			} else {
				current.SelfEvolutionActivation = ""
				current.SelfEvolutionImpacts = nil
			}
			current.State = state
			if status.Phase == "restarted" {
				clearSessionFailure(current)
			} else if status.Detail != "" {
				current.LastRepairError = status.Detail
				current.FailureKind = ""
			}
			return nil
		})
		if updateErr == nil && updated.ID != "" {
			s.bus.Publish(status.SessionID, "self_evolution.status_reconciled", map[string]any{"plan_id": status.PlanID, "phase": status.Phase, "state": state, "detail": status.Detail})
		}
	}
	if status.Phase == "restarted" {
		s.reconcileEarlierRestartPending(status)
	}
}

// A successful runtime restart activates the complete host tree that existed
// at that instant, not only the session named by the latest transaction. This
// repairs older sessions whose own transaction evidence was lost after a
// duplicate pre-mutation Apply, while requiring temporal proof that their host
// Apply completed before the healthy restart.
func (s *Service) reconcileEarlierRestartPending(status selfevolution.Status) {
	restartedAt, err := time.Parse(time.RFC3339, status.UpdatedAt)
	if err != nil {
		return
	}
	for _, candidate := range s.store.List() {
		if !s.isSelfEvolution(candidate) || candidate.SelfEvolutionActivation != "restart_pending" || candidate.LastHostAppliedAt.IsZero() || candidate.LastHostAppliedAt.After(restartedAt) {
			continue
		}
		updated, updateErr := s.store.Update(candidate.ID, func(current *domain.Session) error {
			if current.SelfEvolutionActivation != "restart_pending" || current.LastHostAppliedAt.IsZero() || current.LastHostAppliedAt.After(restartedAt) {
				return nil
			}
			current.SelfEvolutionActivation = ""
			current.SelfEvolutionImpacts = nil
			if current.State == "restart_pending" || current.State == "restart_scheduled" {
				current.State = "applied"
				clearSessionFailure(current)
			}
			return nil
		})
		if updateErr == nil && updated.ID != "" {
			s.bus.Publish(candidate.ID, "self_evolution.activation_reconciled", map[string]any{
				"plan_id": status.PlanID, "restart_completed_at": restartedAt.Format(time.RFC3339),
				"host_applied_at": candidate.LastHostAppliedAt.Format(time.RFC3339), "evidence": "later healthy Wharnex restart",
			})
		}
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

func (s *Service) OpenFilePreview(sessionID, path string) (*os.File, os.FileInfo, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return nil, nil, err
	}
	return workspacefs.OpenPreview(item.ProjectPath, path)
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

// EnsureContextArtifacts reconstructs expired/missing temporary context files
// from the authoritative project without changing the session workflow state.
func (s *Service) EnsureContextArtifacts(sessionID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	zipInfo, zipErr := os.Stat(item.Context.ZipPath)
	textInfo, textErr := os.Stat(item.Context.TextPath)
	if zipErr == nil && textErr == nil && zipInfo.Mode().IsRegular() && textInfo.Mode().IsRegular() {
		return item, nil
	}
	return s.refreshContext(sessionID)
}

func (s *Service) RefreshContext(sessionID string) (domain.Session, error) {
	return s.refreshContext(sessionID)
}

func (s *Service) refreshContext(sessionID string) (domain.Session, error) {
	return s.refreshContextWithAttachments(sessionID, nil)
}

// refreshContextWithAttachments rebuilds the snapshot, optionally placing
// external attached paths beside the related projects.
//
// Attachments are per-request rather than per-session: they come from one
// prompt's own markers, so they are passed in here rather than stored, and a
// later request without them simply rebuilds without them.
func (s *Service) refreshContextWithAttachments(sessionID string, attachments []contextbundle.Attachment) (domain.Session, error) {
	return s.refreshContextWithDirectiveSelections(sessionID, attachments, "")
}

func (s *Service) refreshContextWithDirectiveSelections(sessionID string, attachments []contextbundle.Attachment, message string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.Session{}, err
	}
	selections := s.referenceSelections(item, message)
	bundle, err := s.context.BuildWorkspaceWithSelections(item.ProjectPath, item.RelatedProjectPaths, selections, attachments)
	if err != nil {
		return domain.Session{}, fmt.Errorf("refresh project context: %w", err)
	}
	oldDir := filepath.Dir(item.Context.ZipPath)
	changedFiles := manifestChangedFiles(item.Context.Manifest, bundle.Manifest)
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		if current.Context.Manifest.SHA256 != "" && current.Context.Manifest.SHA256 != bundle.Manifest.SHA256 {
			current.ProjectRevisions = append(current.ProjectRevisions, domain.ProjectRevision{
				ParentSHA256: current.Context.Manifest.SHA256, SHA256: bundle.Manifest.SHA256,
				ChangedFiles: changedFiles, Source: "observed", Complete: true, ObservedAt: time.Now().UTC(),
			})
			if len(current.ProjectRevisions) > maxRetainedProjectRevisions {
				current.ProjectRevisions = append([]domain.ProjectRevision(nil), current.ProjectRevisions[len(current.ProjectRevisions)-maxRetainedProjectRevisions:]...)
			}
		}
		current.Context = bundle
		return nil
	})
	if err != nil {
		if dir := ownedContextArchiveDir(bundle.ZipPath); dir != "" {
			_ = os.RemoveAll(dir)
		}
		return domain.Session{}, err
	}
	if oldDir != "" && oldDir != "." && oldDir != filepath.Dir(bundle.ZipPath) && !contextDirectoryReferenced(updated, oldDir) {
		_ = os.RemoveAll(oldDir)
	}
	s.bus.Publish(sessionID, "context.refreshed", map[string]any{"files": len(bundle.Manifest.Files), "snapshot": bundle.Manifest.SHA256})
	return updated, nil
}

func manifestChangedFiles(before, after domain.ContextManifest) []string {
	old := contextFileHashes(before.Files)
	current := contextFileHashes(after.Files)
	changed := make([]string, 0)
	for path, sha := range old {
		if current[path] != sha {
			changed = append(changed, path)
		}
	}
	for path := range current {
		if _, ok := old[path]; !ok {
			changed = append(changed, path)
		}
	}
	return normalizedPaths(changed)
}

func contextDirectoryReferenced(item domain.Session, directory string) bool {
	for _, archive := range item.RequestContextArchives {
		if filepath.Clean(filepath.Dir(archive)) == filepath.Clean(directory) {
			return true
		}
	}
	return false
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
	s.closeInteractiveTerminals(sessionID)
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

// knowledgeStageSkipReason separates the two ways knowledge staging is skipped
// so the UI can present catalog drift (routine, self-correcting on the next
// round) differently from a planner that returned a malformed catalog.
func knowledgeStageSkipReason(revisionConflict bool) string {
	if revisionConflict {
		return "concurrent_catalog_revision"
	}
	return "invalid_knowledge_payload"
}
