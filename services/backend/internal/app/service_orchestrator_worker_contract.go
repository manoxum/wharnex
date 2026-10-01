package app

import (
	"errors"
	"fmt"

	"kernl.local/harness/backend/internal/orchestrator"
)

type OrchestratorWorkerRequest struct {
	Task             orchestrator.Task    `json:"task"`
	Run              orchestrator.TaskRun `json:"run"`
	AgentSessionID   string               `json:"agent_session_id"`
	RequestID        string               `json:"request_id"`
	Prompt           string               `json:"prompt,omitempty"`
	ExpectedFilename string               `json:"expected_filename,omitempty"`
	ChatID           string               `json:"chat_id,omitempty"`
	ReasoningEffort  string               `json:"reasoning_effort,omitempty"`
	AgentState       string               `json:"agent_state"`
	// AgentFailureKind names why an Agent without a pending request is not
	// advancing (for example a verified candidate the self-evolution lock
	// refused), so the Worker's observation says more than the bare state.
	AgentFailureKind string `json:"agent_failure_kind,omitempty"`
	ConversationURL  string `json:"conversation_url,omitempty"`
	ConversationID   string `json:"conversation_id,omitempty"`
}

func settledOrchestratorWorkerRequest(task orchestrator.Task) OrchestratorWorkerRequest {
	return OrchestratorWorkerRequest{
		Task: task, AgentState: "settled",
		ConversationURL: task.ConversationURL, ConversationID: task.ConversationID,
	}
}

// ErrOrchestratorStoreUnavailable marks a worker-start the backend could not
// answer because its own orchestrator store failed. It says nothing about the
// task: on 2026-09-29 a backend deployed mid-migration failed every task read,
// reported each as "does not belong to this project", and the Worker spent a
// healthy task's attempt budget on a fault no attempt could change.
var ErrOrchestratorStoreUnavailable = errors.New("orchestrator store unavailable")

func orchestratorStoreUnavailable(cause error) error {
	return fmt.Errorf("%w: %v", ErrOrchestratorStoreUnavailable, cause)
}
