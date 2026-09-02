package domain

import "time"

const ProtocolV1 = "harness.execution/v1"

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
	Argv       []string `json:"argv"`
	Cwd        string   `json:"cwd"`
	ExitCode   int      `json:"exit_code"`
	Stdout     string   `json:"stdout"`
	Stderr     string   `json:"stderr"`
	DurationMS int64    `json:"duration_ms"`
	Success    bool     `json:"success"`
}

type ExecutionResult struct {
	PlanID      string          `json:"plan_id"`
	Success     bool            `json:"success"`
	StartedAt   time.Time       `json:"started_at"`
	CompletedAt time.Time       `json:"completed_at"`
	Commands    []CommandResult `json:"commands"`
	Error       string          `json:"error,omitempty"`
}

type ContextFile struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type ContextManifest struct {
	ID            string        `json:"id"`
	ProjectRoot   string        `json:"project_root"`
	SHA256        string        `json:"sha256"`
	Files         []ContextFile `json:"files"`
	Excluded      []string      `json:"excluded"`
	TextTruncated bool          `json:"text_truncated"`
}

type ContextBundle struct {
	ID       string          `json:"id"`
	ZipPath  string          `json:"-"`
	TextPath string          `json:"-"`
	Manifest ContextManifest `json:"manifest"`
}

type Session struct {
	ID                     string           `json:"id"`
	ProjectPath            string           `json:"project_path"`
	State                  string           `json:"state"`
	CreatedAt              time.Time        `json:"created_at"`
	Context                ContextBundle    `json:"context"`
	Plan                   *ExecutionPlan   `json:"plan,omitempty"`
	Policy                 *PolicyDecision  `json:"policy,omitempty"`
	LastExecution          *ExecutionResult `json:"last_execution,omitempty"`
	LastProviderResponseID string           `json:"-"`
	LastRequestID          string           `json:"last_request_id,omitempty"`
	LastManualPrompt       string           `json:"last_manual_prompt,omitempty"`
}

type Event struct {
	ID        string         `json:"id"`
	SessionID string         `json:"session_id"`
	Type      string         `json:"type"`
	Timestamp time.Time      `json:"timestamp"`
	Data      map[string]any `json:"data"`
}
