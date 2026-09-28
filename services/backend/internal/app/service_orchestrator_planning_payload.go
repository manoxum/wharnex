package app

import "encoding/json"

type OrchestratorPlanningAttachment struct {
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	MIME       string `json:"mime"`
	StorageRef string `json:"storage_ref"`
}

type OrchestratorGeneratedAttachment struct {
	Name    string `json:"name"`
	MIME    string `json:"mime"`
	Content string `json:"content"`
}

type OrchestratorComposerContext struct {
	IncludeContext       bool                              `json:"include_context,omitempty"`
	ProjectFiles         []string                          `json:"project_files,omitempty"`
	AttachmentCacheKey   string                            `json:"attachment_cache_key,omitempty"`
	Attachments          []OrchestratorPlanningAttachment  `json:"attachments,omitempty"`
	TodoIDs              []string                          `json:"todo_ids,omitempty"`
	GeneratedAttachments []OrchestratorGeneratedAttachment `json:"-"`
}

type orchestratorPlanningWorkerPayload struct {
	Protocol             string                            `json:"protocol"`
	SessionID            string                            `json:"session_id"`
	RequestID            string                            `json:"request_id"`
	Objective            string                            `json:"objective"`
	Prompt               string                            `json:"prompt"`
	IncludeContext       bool                              `json:"include_context,omitempty"`
	ProjectFiles         []string                          `json:"project_files,omitempty"`
	AttachmentCacheKey   string                            `json:"attachment_cache_key,omitempty"`
	Attachments          []OrchestratorPlanningAttachment  `json:"attachments,omitempty"`
	GeneratedAttachments []OrchestratorGeneratedAttachment `json:"generated_attachments,omitempty"`
	ReasoningEffort      string                            `json:"reasoning_effort"`
}

func encodeOrchestratorPlanningWorkerPayload(
	sessionID, requestID, objective, prompt string,
	input OrchestratorComposerContext,
	reasoningEffort string,
) ([]byte, error) {
	return json.Marshal(orchestratorPlanningWorkerPayload{
		Protocol: orchestratorPlanningWorkerProtocol, SessionID: sessionID,
		RequestID: requestID, Objective: objective, Prompt: prompt,
		IncludeContext:       input.IncludeContext || len(input.ProjectFiles) > 0,
		ProjectFiles:         append([]string(nil), input.ProjectFiles...),
		AttachmentCacheKey:   input.AttachmentCacheKey,
		Attachments:          append([]OrchestratorPlanningAttachment(nil), input.Attachments...),
		GeneratedAttachments: append([]OrchestratorGeneratedAttachment(nil), input.GeneratedAttachments...),
		ReasoningEffort:      reasoningEffort,
	})
}
