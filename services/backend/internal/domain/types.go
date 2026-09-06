package domain

import (
	"encoding/json"
	"time"
)

const ProtocolV1 = "harness.execution/v1"
const TurnProtocolV1 = "harness.turn/v1"

type TurnKind string

const (
	TurnKindAnswer        TurnKind = "answer"
	TurnKindClarification TurnKind = "clarification"
	TurnKindInvestigation TurnKind = "investigation"
	TurnKindWorkflow      TurnKind = "workflow"
	TurnKindChange        TurnKind = "change"
	TurnKindBlocked       TurnKind = "blocked"
)

func ValidTurnKind(kind TurnKind) bool {
	switch kind {
	case TurnKindAnswer, TurnKindClarification, TurnKindInvestigation, TurnKindWorkflow, TurnKindChange, TurnKindBlocked:
		return true
	default:
		return false
	}
}

type AgentTurn struct {
	Protocol            string       `json:"protocol"`
	RequestID           string       `json:"request_id"`
	Kind                TurnKind     `json:"kind"`
	Message             string       `json:"message"`
	Outcome             *TurnOutcome `json:"outcome"`
	ResolvedEvidenceIDs []string     `json:"resolved_evidence_ids,omitempty"`
}

// TurnOutcome describes whether the planner completed its response. It never
// claims host execution, which remains an authoritative Wharness result.
type TurnOutcome struct {
	Status     string `json:"status"`
	ReasonCode string `json:"reason_code,omitempty"`
	Message    string `json:"message,omitempty"`
	Retryable  bool   `json:"retryable"`
}

const (
	TurnOutcomeCompleted = "completed"
	TurnOutcomeFailed    = "failed"
	TurnOutcomePartial   = "partial"
)

// FailureKind is Wharness's own closed-set classification of a terminal
// session failure. It is always derived by Wharness itself — from a sandbox
// error via errors.Is, or from a planner turn outcome's reason code — and
// never copied verbatim from planner-supplied text. Consumers (including the
// frontend) MUST key recovery affordances on this field, never on error
// message substrings: message text is free-form prose that can be rephrased
// or translated, but this field is a value Wharness itself commits to.
const (
	// FailureKindOfflineGoModuleCache marks a failure caused by the host Go
	// module cache being unable to satisfy the project's build list while
	// GOPROXY=off. It is recoverable via a human-approved, narrowly scoped
	// network grant (see RetryDependencyNetwork).
	FailureKindOfflineGoModuleCache = "offline_go_module_cache"
)

type ExecutionMode string

const (
	ExecutionModeProtected   ExecutionMode = "protected"
	ExecutionModeUnprotected ExecutionMode = "unprotected"
)

func ValidExecutionMode(mode ExecutionMode) bool {
	return mode == ExecutionModeProtected || mode == ExecutionModeUnprotected
}

type AutomationMode string

const (
	AutomationModeManual AutomationMode = "manual"
	AutomationModeAuto   AutomationMode = "auto"
)

func ValidAutomationMode(mode AutomationMode) bool {
	return mode == AutomationModeManual || mode == AutomationModeAuto
}

type TerminalTarget string

const (
	TerminalTargetSandbox TerminalTarget = "sandbox"
	TerminalTargetHost    TerminalTarget = "host"
)

func ValidTerminalTarget(target TerminalTarget) bool {
	return target == TerminalTargetSandbox || target == TerminalTargetHost
}

type CommandSpec struct {
	Argv              []string `json:"argv"`
	Cwd               string   `json:"cwd"`
	TimeoutSeconds    int      `json:"timeout_seconds"`
	Network           bool     `json:"network"`
	ExpectedExitCodes []int    `json:"expected_exit_codes"`
}

type Operation struct {
	Type    string      `json:"type"`
	Patch   string      `json:"patch"`
	Command CommandSpec `json:"command"`
}

type ExecutionPlan struct {
	Protocol          string        `json:"protocol"`
	BaseContextSHA256 string        `json:"base_context_sha256,omitempty"`
	ImpactFiles       []string      `json:"impact_files,omitempty"`
	ReadFiles         []string      `json:"read_files,omitempty"`
	BarrierFiles      []string      `json:"barrier_files,omitempty"`
	PlanID            string        `json:"plan_id"`
	RequestID         string        `json:"request_id"`
	Status            string        `json:"status"`
	Summary           string        `json:"summary"`
	Risk              string        `json:"risk"`
	RequiresApproval  bool          `json:"requires_approval"`
	Operations        []Operation   `json:"operations"`
	Verification      []CommandSpec `json:"verification"`
}

type PolicyDecision struct {
	Allowed          bool     `json:"allowed"`
	RequiresApproval bool     `json:"requires_approval"`
	Risk             string   `json:"risk"`
	Reasons          []string `json:"reasons"`
}

type CommandResult struct {
	Argv             []string `json:"argv"`
	Cwd              string   `json:"cwd"`
	ExitCode         int      `json:"exit_code"`
	Stdout           string   `json:"stdout"`
	Stderr           string   `json:"stderr"`
	DurationMS       int64    `json:"duration_ms"`
	Success          bool     `json:"success"`
	BaselineFailure  bool     `json:"baseline_failure,omitempty"`
	BaselineExitCode int      `json:"baseline_exit_code,omitempty"`
	BaselineOutput   string   `json:"baseline_output,omitempty"`
}

type ExecutionBundleInfo struct {
	Filename string   `json:"filename"`
	README   string   `json:"readme"`
	Files    []string `json:"files"`
	Patches  []string `json:"patches"`
	SHA256   string   `json:"sha256"`
}

type ExecutionResult struct {
	PlanID      string          `json:"plan_id"`
	Success     bool            `json:"success"`
	StartedAt   time.Time       `json:"started_at"`
	CompletedAt time.Time       `json:"completed_at"`
	Commands    []CommandResult `json:"commands"`
	Error       string          `json:"error,omitempty"`
	Warnings    []string        `json:"warnings,omitempty"`
}

func (r ExecutionResult) MarshalJSON() ([]byte, error) {
	type executionResult ExecutionResult
	if r.Commands == nil {
		r.Commands = []CommandResult{}
	}
	return json.Marshal(executionResult(r))
}

// BaselineNotice records one project-context transition observed by a peer
// session. CompleteDelta is false when Wharness could not prove that the peer
// observed the immediately preceding baseline, disabling optimistic fast-forward.
type BaselineNotice struct {
	ID              string    `json:"id"`
	SourceSessionID string    `json:"source_session_id"`
	SourcePlanID    string    `json:"source_plan_id"`
	PreviousSHA256  string    `json:"previous_sha256"`
	NewSHA256       string    `json:"new_sha256"`
	ChangedFiles    []string  `json:"changed_files"`
	OverlapFiles    []string  `json:"overlap_files,omitempty"`
	Relevant        bool      `json:"relevant"`
	CompleteDelta   bool      `json:"complete_delta"`
	CreatedAt       time.Time `json:"created_at"`
}

type ProjectRevision struct {
	ParentSHA256 string    `json:"parent_sha256,omitempty"`
	SHA256       string    `json:"sha256"`
	ChangedFiles []string  `json:"changed_files,omitempty"`
	Source       string    `json:"source"`
	Complete     bool      `json:"complete"`
	ObservedAt   time.Time `json:"observed_at"`
}

// PendingHostChange is a Protected plan that has passed sandbox verification
// but has not yet been accepted into the host project. Keeping the plan and its
// execution together lets later plans verify against the cumulative candidate
// without making the host the source of truth prematurely.
type PendingHostChange struct {
	Plan       ExecutionPlan   `json:"plan"`
	Execution  ExecutionResult `json:"execution"`
	VerifiedAt time.Time       `json:"verified_at"`
	ChangeSet  *ChangeSet      `json:"change_set,omitempty"`
}

type IntegrationOutcome string

const (
	IntegrationPlanning      IntegrationOutcome = "planning"
	IntegrationVerified      IntegrationOutcome = "verified"
	IntegrationMerging       IntegrationOutcome = "merging"
	IntegrationChecking      IntegrationOutcome = "checking"
	IntegrationReady         IntegrationOutcome = "ready"
	IntegrationIntegrated    IntegrationOutcome = "integrated"
	IntegrationConflict      IntegrationOutcome = "conflict"
	IntegrationSemanticCheck IntegrationOutcome = "semantic_recheck"
	IntegrationRetryableRace IntegrationOutcome = "retryable_race"
)

// FileMutation is the canonical result of applying a model delta to its exact
// immutable base. Contents are bounded by the validated patch limit and remain
// durable so a verified candidate can be merged after a backend restart.
type FileMutation struct {
	Path          string `json:"path"`
	BaseSHA256    string `json:"base_sha256,omitempty"`
	ResultSHA256  string `json:"result_sha256,omitempty"`
	BaseExists    bool   `json:"base_exists"`
	ResultExists  bool   `json:"result_exists"`
	BaseContent   string `json:"base_content,omitempty"`
	ResultContent string `json:"result_content,omitempty"`
	BaseMode      uint32 `json:"base_mode,omitempty"`
	ResultMode    uint32 `json:"result_mode,omitempty"`
}

type ChangeSet struct {
	ID            string             `json:"id"`
	BaseRevision  string             `json:"base_revision"`
	Mutations     []FileMutation     `json:"mutations"`
	ReadFiles     []string           `json:"read_files,omitempty"`
	BarrierFiles  []string           `json:"barrier_files,omitempty"`
	ReadHashes    map[string]string  `json:"read_hashes,omitempty"`
	BarrierHashes map[string]string  `json:"barrier_hashes,omitempty"`
	State         IntegrationOutcome `json:"state"`
	CreatedAt     time.Time          `json:"created_at"`
}

type IntegrationConflictDetail struct {
	ChangeSetID string `json:"change_set_id"`
	Path        string `json:"path"`
	Reason      string `json:"reason"`
}

type ConflictResolution struct {
	ID              string                      `json:"id"`
	RequestID       string                      `json:"request_id"`
	OriginalPlanIDs []string                    `json:"original_plan_ids"`
	Paths           []string                    `json:"paths"`
	Details         []IntegrationConflictDetail `json:"details"`
	CreatedAt       time.Time                   `json:"created_at"`
}

type RequestLineage struct {
	RequestID       string    `json:"request_id"`
	RootRequestID   string    `json:"root_request_id"`
	ParentRequestID string    `json:"parent_request_id,omitempty"`
	Kind            string    `json:"kind"`
	CreatedAt       time.Time `json:"created_at"`
}

type ContextFile struct {
	Path        string `json:"path"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
	ContentType string `json:"content_type,omitempty"`
}

type ContextExclusion struct {
	Path   string `json:"path"`
	Kind   string `json:"kind"`
	Reason string `json:"reason"`
	Rule   string `json:"rule"`
}

type ContextManifest struct {
	ID              string             `json:"id"`
	ProjectRoot     string             `json:"project_root"`
	SHA256          string             `json:"sha256"`
	Files           []ContextFile      `json:"files"`
	Excluded        []string           `json:"excluded"`
	ExcludedDetails []ContextExclusion `json:"excluded_details,omitempty"`
	TextTruncated   bool               `json:"text_truncated"`
}

type ContextBundle struct {
	ID       string          `json:"id"`
	ZipPath  string          `json:"-"`
	TextPath string          `json:"-"`
	Manifest ContextManifest `json:"manifest"`
}

type Session struct {
	ID                      string                       `json:"id"`
	ProjectPath             string                       `json:"project_path"`
	ExecutionMode           ExecutionMode                `json:"execution_mode"`
	AutomationMode          AutomationMode               `json:"automation_mode"`
	SelfEvolution           bool                         `json:"self_evolution,omitempty"`
	SelfEvolutionActivation string                       `json:"self_evolution_activation,omitempty"`
	ResolvedEvidenceIDs     map[string]time.Time         `json:"resolved_evidence_ids,omitempty"`
	EvidenceReviewIDs       []string                     `json:"evidence_review_ids,omitempty"`
	State                   string                       `json:"state"`
	CreatedAt               time.Time                    `json:"created_at"`
	Context                 ContextBundle                `json:"context"`
	Plan                    *ExecutionPlan               `json:"plan,omitempty"`
	Policy                  *PolicyDecision              `json:"policy,omitempty"`
	LastExecution           *ExecutionResult             `json:"last_execution,omitempty"`
	PendingHostChanges      []PendingHostChange          `json:"pending_host_changes,omitempty"`
	LastAppliedChanges      []PendingHostChange          `json:"last_applied_changes,omitempty"`
	LastProviderResponseID  string                       `json:"last_provider_response_id,omitempty"`
	LastRequestID           string                       `json:"last_request_id,omitempty"`
	PendingManualRequestIDs []string                     `json:"pending_manual_request_ids,omitempty"`
	LastManualPrompt        string                       `json:"last_manual_prompt,omitempty"`
	LastBundle              *ExecutionBundleInfo         `json:"last_bundle,omitempty"`
	LastTurn                *AgentTurn                   `json:"last_turn,omitempty"`
	RepairAttempt           int                          `json:"repair_attempt,omitempty"`
	RepairParentPlanID      string                       `json:"repair_parent_plan_id,omitempty"`
	LastRepairError         string                       `json:"last_repair_error,omitempty"`
	FailureKind             string                       `json:"failure_kind,omitempty"`
	WorkflowRound           int                          `json:"workflow_round,omitempty"`
	LastRequestMode         string                       `json:"last_request_mode,omitempty"`
	PlannerInFlight         bool                         `json:"planner_in_flight,omitempty"`
	RequestBaselines        map[string]string            `json:"request_baselines,omitempty"`
	RequestContextArchives  map[string]string            `json:"-"`
	BaselineFileSnapshots   map[string]map[string]string `json:"baseline_file_snapshots,omitempty"`
	BaselineNotices         []BaselineNotice             `json:"baseline_notices,omitempty"`
	ProjectRevisions        []ProjectRevision            `json:"project_revisions,omitempty"`
	IntegrationConflict     *ConflictResolution          `json:"integration_conflict,omitempty"`
	Artifacts               []ArtifactRecord             `json:"artifacts,omitempty"`
	InterruptedExecution    *InterruptedExecution        `json:"interrupted_execution,omitempty"`
	RemoteRecoveryAttempt   int                          `json:"remote_recovery_attempt,omitempty"`
	RequestLineages         map[string]RequestLineage    `json:"request_lineages,omitempty"`
}

// InterruptedExecution is a durable execution intent. Its presence means the
// process disappeared or its caller disconnected before a terminal result was
// persisted, so only an explicit user decision may resume or discard it.
type InterruptedExecution struct {
	PlanID      string    `json:"plan_id"`
	RequestedAt time.Time `json:"requested_at"`
	Approved    bool      `json:"approved"`
}

type ArtifactRecord struct {
	ID          string    `json:"id"`
	RequestID   string    `json:"request_id,omitempty"`
	Direction   string    `json:"direction"`
	Kind        string    `json:"kind"`
	Name        string    `json:"name"`
	ContentType string    `json:"content_type,omitempty"`
	Size        int64     `json:"size"`
	SHA256      string    `json:"sha256"`
	ObjectKey   string    `json:"-"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	Bundle      bool      `json:"bundle"`
	EntryCount  int       `json:"entry_count,omitempty"`
}

type ArtifactEntry struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
	Dir  bool   `json:"dir"`
}

type Event struct {
	ID        string         `json:"id"`
	SessionID string         `json:"session_id"`
	Type      string         `json:"type"`
	Timestamp time.Time      `json:"timestamp"`
	Data      map[string]any `json:"data"`
}
