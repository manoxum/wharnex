package app

import (
	"context"
	"errors"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/orchestrator"
)

func (s *Service) RetryOrchestratorTask(ctx context.Context, sessionID, taskID string, input orchestrator.TaskRetryContext) (orchestrator.Task, error) {
	owner, err := s.store.Get(sessionID)
	if err != nil {
		return orchestrator.Task{}, err
	}
	if !orchestratorAutomaticExecutionAllowed(owner) {
		return orchestrator.Task{}, errors.New("orchestrator retry requires Protected Auto mode")
	}
	input.Guidance = strings.TrimSpace(input.Guidance)
	if len(input.Guidance) > 32*1024 {
		return orchestrator.Task{}, errors.New("retry guidance exceeds 32 KiB")
	}
	attachments := make([]OrchestratorPlanningAttachment, 0, len(input.Attachments))
	for _, file := range input.Attachments {
		attachments = append(attachments, OrchestratorPlanningAttachment{Name: file.Name, Size: file.Size, MIME: file.MIME, StorageRef: file.StorageRef})
	}
	if err := s.validateOrchestratorComposerContext(OrchestratorComposerContext{
		ProjectFiles: input.ProjectFiles, AttachmentCacheKey: input.AttachmentCacheKey, Attachments: attachments,
	}); err != nil {
		return orchestrator.Task{}, err
	}
	input.ProjectFiles, err = validateProjectFileReferences(owner, input.ProjectFiles)
	if err != nil {
		return orchestrator.Task{}, err
	}
	lock := s.orchestratorProjectLock(owner.ProjectPath)
	lock.Lock()
	defer lock.Unlock()
	task, err := s.orchestrator.GetTask(ctx, taskID)
	if err != nil {
		return orchestrator.Task{}, err
	}
	if task.ProjectPath != owner.ProjectPath || task.Status != orchestrator.TaskFailed {
		return orchestrator.Task{}, errors.New("only a FAILED task in this project can be retried")
	}
	task.RetryContext = &input
	task.UpdatedAt = time.Now().UTC()
	if err := s.orchestrator.PutTask(ctx, task); err != nil {
		return orchestrator.Task{}, err
	}
	if err := s.releaseOrchestratorChain(ctx, owner.ProjectPath, taskID); err != nil {
		return orchestrator.Task{}, err
	}
	if err := s.recalculateOrchestratorTasks(ctx, owner.ProjectPath); err != nil {
		return orchestrator.Task{}, err
	}
	all, err := s.orchestrator.ListTasks(ctx, owner.ProjectPath)
	if err != nil {
		return orchestrator.Task{}, err
	}
	if err := s.ensureReadyOrchestratorTasksQueued(ctx, owner, all); err != nil {
		return orchestrator.Task{}, err
	}
	s.bus.Publish(sessionID, "orchestrator.task_retried", map[string]any{"task_id": taskID, "has_guidance": input.Guidance != "", "attachments": len(input.Attachments)})
	return s.orchestrator.GetTask(ctx, taskID)
}
