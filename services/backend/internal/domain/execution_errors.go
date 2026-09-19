package domain

import "time"

const (
	ExecutionErrorStatusOpen   = "open"
	ExecutionErrorStatusSolved = "resolved"
)

type ExecutionErrorLog struct {
	Kind          string   `json:"kind"`
	Argv          []string `json:"argv,omitempty"`
	Cwd           string   `json:"cwd,omitempty"`
	ExitCode      *int     `json:"exit_code,omitempty"`
	Stdout        string   `json:"stdout,omitempty"`
	Stderr        string   `json:"stderr,omitempty"`
	OperationID   string   `json:"operation_id,omitempty"`
	OperationType string   `json:"operation_type,omitempty"`
	Output        string   `json:"output,omitempty"`
	Error         string   `json:"error,omitempty"`
	DurationMS    int64    `json:"duration_ms,omitempty"`
}

type ExecutionErrorSolution struct {
	RequestID     string `json:"request_id"`
	PlanID        string `json:"plan_id"`
	Summary       string `json:"summary"`
	CommitMessage string `json:"commit_message,omitempty"`
}

type ExecutionErrorRecord struct {
	ID            string                  `json:"id"`
	SessionID     string                  `json:"session_id"`
	ChatID        string                  `json:"chat_id"`
	RootRequestID string                  `json:"root_request_id,omitempty"`
	RequestID     string                  `json:"request_id,omitempty"`
	PlanID        string                  `json:"plan_id,omitempty"`
	Stage         string                  `json:"stage"`
	Error         string                  `json:"error"`
	Cause         string                  `json:"cause,omitempty"`
	FailureKind   string                  `json:"failure_kind,omitempty"`
	StatusCode    *int                    `json:"status_code,omitempty"`
	Logs          []ExecutionErrorLog     `json:"logs"`
	Status        string                  `json:"status"`
	GPTSolution   *ExecutionErrorSolution `json:"gpt_solution,omitempty"`
	OccurredAt    time.Time               `json:"occurred_at"`
	ResolvedAt    *time.Time              `json:"resolved_at,omitempty"`
	UpdatedAt     time.Time               `json:"updated_at"`
}
