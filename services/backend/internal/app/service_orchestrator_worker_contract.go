package app

import "kernl.local/harness/backend/internal/orchestrator"

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
	ConversationURL  string               `json:"conversation_url,omitempty"`
	ConversationID   string               `json:"conversation_id,omitempty"`
}

func settledOrchestratorWorkerRequest(task orchestrator.Task) OrchestratorWorkerRequest {
	return OrchestratorWorkerRequest{
		Task: task, AgentState: "settled",
		ConversationURL: task.ConversationURL, ConversationID: task.ConversationID,
	}
}
