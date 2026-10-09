package app

import (
	"encoding/json"
	"fmt"

	"kernl.local/harness/backend/internal/app/normativecontext"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
)

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
	ContextMode          domain.ContextMode                `json:"context_mode,omitempty"`
	ContextPaths         []string                          `json:"context_paths,omitempty"`
}

func (input OrchestratorComposerContext) includesContext() bool {
	return input.IncludeContext || len(input.ProjectFiles) > 0
}

// orchestratorNormativeSeed is the selection a Partial planning request starts
// from. A request the operator sent without context carries no seed, because
// Partial never forces context into it (SoT/CONTEXT_PROTOCOL.md).
func orchestratorNormativeSeed(item domain.Session, input OrchestratorComposerContext) normativecontext.Selection {
	if !input.includesContext() {
		return normativecontext.Selection{}
	}
	return normativeContextSeed(item.ContextMode, item.Context.ZipPath)
}

func encodeOrchestratorPlanningWorkerPayload(
	item domain.Session, requestID, objective, prompt string,
	input OrchestratorComposerContext, contextPaths []string,
) ([]byte, error) {
	return json.Marshal(orchestratorPlanningWorkerPayload{
		Protocol: orchestratorPlanningWorkerProtocol, SessionID: item.ID,
		RequestID: requestID, Objective: objective, Prompt: prompt,
		IncludeContext:       input.includesContext(),
		ProjectFiles:         append([]string(nil), input.ProjectFiles...),
		AttachmentCacheKey:   input.AttachmentCacheKey,
		Attachments:          append([]OrchestratorPlanningAttachment(nil), input.Attachments...),
		GeneratedAttachments: append([]OrchestratorGeneratedAttachment(nil), input.GeneratedAttachments...),
		ReasoningEffort:      string(normalizeReasoningEffort(item.ReasoningEffort)),
		ContextMode:          domain.EffectiveContextMode(item.ContextMode),
		ContextPaths:         append([]string(nil), contextPaths...),
	})
}

// enqueueOrchestratorPlanningWorker hands a manual planning prompt to the
// Worker pool. The normative seed is recorded as the request's cumulative
// selection, so every context increment accumulates on top of it instead of
// replacing it.
func (s *Service) enqueueOrchestratorPlanningWorker(item domain.Session, requestID, objective, prompt string, input OrchestratorComposerContext, seed normativecontext.Selection) (OrchestratorProposalResult, error) {
	fail := func(err error) (OrchestratorProposalResult, error) {
		s.setProjectTodosByRequest(requestID, domain.ProjectTodoExecutionFailed, err.Error())
		return OrchestratorProposalResult{}, err
	}
	payload, err := encodeOrchestratorPlanningWorkerPayload(item, requestID, objective, prompt, input, seed.Paths)
	if err != nil {
		return fail(fmt.Errorf("encode orchestrator planning worker: %w", err))
	}
	if len(seed.Paths) > 0 {
		if _, err := s.store.Update(item.ID, func(current *domain.Session) error {
			if current.OrchestratorContextPaths == nil {
				current.OrchestratorContextPaths = make(map[string][]string)
			}
			current.OrchestratorContextPaths[requestID] = append([]string(nil), seed.Paths...)
			return nil
		}); err != nil {
			return fail(fmt.Errorf("record orchestrator normative context: %w", err))
		}
	}
	worker, err := s.store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "ORCHESTRATOR_PLAN", ProjectID: item.ProjectPath, ChatID: requestID, SessionID: item.ID,
		RequestID: requestID, RootRequestID: requestID,
		DedupeKey: "orchestrator-plan:" + requestID, Payload: payload, MaxAttempts: 8,
	})
	if err != nil {
		return fail(fmt.Errorf("enqueue orchestrator planning worker: %w", err))
	}
	if len(seed.Paths) > 0 || len(seed.Omitted) > 0 {
		s.bus.Publish(item.ID, "orchestrator.context_normative_seeded", normativeSeedEvent(requestID, seed))
	}
	s.bus.Publish(item.ID, "orchestrator.plan_queued", map[string]any{
		"project_path": item.ProjectPath, "request_id": requestID, "worker_task_id": worker.TaskID,
	})
	return OrchestratorProposalResult{
		RequestID: requestID, ManualPrompt: prompt,
		WorkerTaskID: worker.TaskID, Delivery: worker.Status,
	}, nil
}
