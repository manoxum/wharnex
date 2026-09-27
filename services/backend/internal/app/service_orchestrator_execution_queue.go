package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/session"
)

const orchestratorExecutionWorkerProtocol = "harness.orchestrator-execution/v1"

func orchestratorAutomaticExecutionAllowed(owner domain.Session) bool {
	return owner.ExecutionMode == domain.ExecutionModeProtected && domain.AutomationModeIsAutomatic(owner.AutomationMode)
}

func (s *Service) enqueueReadyOrchestratorTask(ctx context.Context, owner domain.Session, task orchestrator.Task) error {
	if task.Status != orchestrator.TaskReady || task.ProjectPath != owner.ProjectPath {
		return nil
	}
	if !orchestratorAutomaticExecutionAllowed(owner) {
		return errors.New("READY execution requires Protected mode with Auto or Auto Approve")
	}
	releaseID := task.ID + ":" + strconv.FormatInt(task.UpdatedAt.UnixNano(), 10)
	existing, err := s.store.ListChatAgentTasks(session.ChatAgentTaskFilter{
		ProjectID: task.ProjectPath, ChatID: task.ID, RequestID: releaseID,
		Type: "ORCHESTRATOR_EXECUTE", Limit: 1,
	})
	if err != nil {
		return fmt.Errorf("inspect orchestrator execution release: %w", err)
	}
	if len(existing) > 0 {
		if existing[0].Status == session.ChatAgentTaskFailed || existing[0].Status == session.ChatAgentTaskAttention || existing[0].Status == session.ChatAgentTaskCancelled {
			current, err := s.orchestrator.GetTask(ctx, task.ID)
			if err != nil {
				return err
			}
			if current.Status == orchestrator.TaskReady && current.UpdatedAt.Equal(task.UpdatedAt) {
				current.Status = orchestrator.TaskPending
				current.Condition = orchestrator.ConditionFailedRun
				current.UpdatedAt = time.Now().UTC()
				return s.orchestrator.PutTask(ctx, current)
			}
		}
		return nil
	}
	payload, err := json.Marshal(map[string]string{
		"protocol": orchestratorExecutionWorkerProtocol,
		"task_id":  task.ID,
	})
	if err != nil {
		return fmt.Errorf("encode orchestrator execution worker: %w", err)
	}
	_, err = s.store.EnqueueChatAgentTask(session.ChatAgentTask{
		Type: "ORCHESTRATOR_EXECUTE", ProjectID: task.ProjectPath,
		ChatID: task.ID, SessionID: owner.ID, RequestID: releaseID, RootRequestID: task.ID,
		PlanID: task.PlanID, Title: task.Title,
		DedupeKey: "orchestrator-execute:" + releaseID,
		Payload:   payload, MaxAttempts: 30,
	})
	if err != nil {
		return fmt.Errorf("enqueue orchestrator execution worker: %w", err)
	}
	return nil
}

func (s *Service) ensureReadyOrchestratorTasksQueued(ctx context.Context, owner domain.Session, tasks []orchestrator.Task) error {
	if !orchestratorAutomaticExecutionAllowed(owner) {
		return nil
	}
	for _, task := range tasks {
		if err := s.enqueueReadyOrchestratorTask(ctx, owner, task); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) ensureLegacyDoingOrchestratorTasksQueued(ctx context.Context, owner domain.Session, tasks []orchestrator.Task) error {
	if !orchestratorAutomaticExecutionAllowed(owner) {
		return nil
	}
	for _, task := range tasks {
		if task.Status != orchestrator.TaskDoing {
			continue
		}
		workers, err := s.store.ListChatAgentTasks(session.ChatAgentTaskFilter{
			ProjectID: task.ProjectPath, ChatID: task.ID, Type: "ORCHESTRATOR_EXECUTE", Limit: 1,
		})
		if err != nil {
			return err
		}
		if len(workers) > 0 {
			continue
		}
		runs, err := s.orchestrator.ListRuns(ctx, task.ID)
		if err != nil || len(runs) == 0 {
			continue
		}
		run := runs[len(runs)-1]
		if run.Status != "awaiting_agent" || run.SessionID == "" {
			continue
		}
		agent, err := s.store.Get(run.SessionID)
		if err != nil || agent.State != "awaiting_plan" || agent.LastManualPrompt == "" {
			continue
		}
		remote, err := s.store.ListChatAgentTasks(session.ChatAgentTaskFilter{RequestID: agent.LastRequestID, Limit: 20})
		if err != nil || len(remote) > 0 {
			continue
		}
		payload, err := json.Marshal(map[string]string{"protocol": orchestratorExecutionWorkerProtocol, "task_id": task.ID})
		if err != nil {
			return err
		}
		_, err = s.store.EnqueueChatAgentTask(session.ChatAgentTask{
			Type: "ORCHESTRATOR_EXECUTE", ProjectID: task.ProjectPath, ChatID: task.ID,
			SessionID: owner.ID, RequestID: task.ID + ":run:" + run.ID, RootRequestID: task.ID,
			PlanID: task.PlanID, Title: task.Title, DedupeKey: "orchestrator-execute:run:" + run.ID,
			Payload: payload, MaxAttempts: 30,
		})
		if err != nil {
			return err
		}
	}
	return nil
}
