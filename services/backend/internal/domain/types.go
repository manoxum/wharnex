package domain

import "time"

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
	Protocol  string   `json:"protocol"`
	RequestID string   `json:"request_id"`
	Kind      TurnKind `json:"kind"`
	Message   string   `json:"message"`
}

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
	Protocol         string        `json:"protocol"`
	PlanID           string        `json:"plan_id"`
	RequestID        string        `json:"request_id"`
	Status           string        `json:"status"`
	Summary          string        `json:"summary"`
	Risk             string        `json:"risk"`
	RequiresApproval bool          `json:"requires_approval"`
	Operations       []Operation   `json:"operations"`
	Verification     []CommandSpec `json:"verification"`
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

type ContextFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
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
	ID                      string               `json:"id"`
	ProjectPath             string               `json:"project_path"`
	ExecutionMode           ExecutionMode        `json:"execution_mode"`
	AutomationMode          AutomationMode       `json:"automation_mode"`
	SelfEvolution           bool                 `json:"self_evolution,omitempty"`
	State                   string               `json:"state"`
	CreatedAt               time.Time            `json:"created_at"`
	Context                 ContextBundle        `json:"context"`
	Plan                    *ExecutionPlan       `json:"plan,omitempty"`
	Policy                  *PolicyDecision      `json:"policy,omitempty"`
	LastExecution           *ExecutionResult     `json:"last_execution,omitempty"`
	LastProviderResponseID  string               `json:"last_provider_response_id,omitempty"`
	LastRequestID           string               `json:"last_request_id,omitempty"`
	PendingManualRequestIDs []string             `json:"pending_manual_request_ids,omitempty"`
	LastManualPrompt        string               `json:"last_manual_prompt,omitempty"`
	LastBundle              *ExecutionBundleInfo `json:"last_bundle,omitempty"`
	LastTurn                *AgentTurn           `json:"last_turn,omitempty"`
	RepairAttempt           int                  `json:"repair_attempt,omitempty"`
	RepairParentPlanID      string               `json:"repair_parent_plan_id,omitempty"`
	LastRepairError         string               `json:"last_repair_error,omitempty"`
	WorkflowRound           int                  `json:"workflow_round,omitempty"`
}

type Event struct {
	ID        string         `json:"id"`
	SessionID string         `json:"session_id"`
	Type      string         `json:"type"`
	Timestamp time.Time      `json:"timestamp"`
	Data      map[string]any `json:"data"`
}
