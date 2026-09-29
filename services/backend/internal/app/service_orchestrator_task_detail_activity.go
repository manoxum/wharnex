package app

import (
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/session"
)

func filterOrchestratorTaskEvents(events []domain.Event, allowed map[string]bool) []domain.Event {
	if len(allowed) == 0 {
		return append([]domain.Event(nil), events...)
	}
	filtered := make([]domain.Event, 0, len(events))
	for _, event := range events {
		if requestID, _ := event.Data["request_id"].(string); requestID != "" && !allowed[requestID] {
			continue
		}
		if rootID, _ := event.Data["root_request_id"].(string); rootID != "" && !allowed[rootID] {
			continue
		}
		filtered = append(filtered, event)
	}
	return filtered
}

func taskLastTurn(turn *domain.AgentTurn, allowed map[string]bool) *domain.AgentTurn {
	if turn == nil || (len(allowed) > 0 && !allowed[turn.RequestID]) {
		return nil
	}
	copy := *turn
	return &copy
}

func orchestratorTaskActivity(runID string, agent domain.Session, events []domain.Event, allowed map[string]bool) ([]OrchestratorTaskPlan, []OrchestratorTaskExecution) {
	plans := make([]OrchestratorTaskPlan, 0)
	executions := make([]OrchestratorTaskExecution, 0)
	seenPlans := map[string]bool{}
	seenExecutions := map[string]bool{}
	for _, event := range events {
		requestID, _ := event.Data["request_id"].(string)
		if !requestBelongsToRun(requestID, allowed) {
			continue
		}
		switch event.Type {
		case EventPlanRecorded:
			body, ok := event.Data["plan"].(map[string]any)
			if !ok {
				continue
			}
			planID, _ := event.Data["plan_id"].(string)
			at := event.Timestamp
			plans = append(plans, OrchestratorTaskPlan{RunID: runID, SessionID: agent.ID, RequestID: requestID, PlanID: planID, RecordedAt: &at, Plan: body})
			seenPlans[requestID+"\x00"+planID] = true
		case EventExecutionRecorded:
			body, ok := event.Data["execution"].(map[string]any)
			if !ok {
				continue
			}
			planID, _ := event.Data["plan_id"].(string)
			success, _ := event.Data["success"].(bool)
			at := event.Timestamp
			executions = append(executions, OrchestratorTaskExecution{RunID: runID, SessionID: agent.ID, RequestID: requestID, PlanID: planID, RecordedAt: &at, Success: success, Execution: body})
			seenExecutions[requestID+"\x00"+planID] = true
		}
	}
	if agent.Plan != nil && requestBelongsToRun(agent.Plan.RequestID, allowed) && !seenPlans[agent.Plan.RequestID+"\x00"+agent.Plan.PlanID] {
		if body, err := structuredEventData(agent.Plan); err == nil {
			plans = append(plans, OrchestratorTaskPlan{RunID: runID, SessionID: agent.ID, RequestID: agent.Plan.RequestID, PlanID: agent.Plan.PlanID, Current: true, Plan: body})
		}
	}
	if agent.LastExecution != nil {
		requestID := orchestratorExecutionRequestID(agent, agent.LastExecution.PlanID)
		if requestBelongsToRun(requestID, allowed) && !seenExecutions[requestID+"\x00"+agent.LastExecution.PlanID] {
			if body, err := structuredEventData(agent.LastExecution); err == nil {
				executions = append(executions, OrchestratorTaskExecution{RunID: runID, SessionID: agent.ID, RequestID: requestID, PlanID: agent.LastExecution.PlanID, Current: true, Success: agent.LastExecution.Success, Execution: body})
			}
		}
	}
	return plans, executions
}

func orchestratorExecutionRequestID(agent domain.Session, planID string) string {
	if agent.Plan != nil && agent.Plan.PlanID == planID {
		return agent.Plan.RequestID
	}
	return agent.LastRequestID
}

func (s *Service) activeOrchestratorTaskWorker(task orchestrator.Task) (*OrchestratorTaskActiveWorker, error) {
	workers, err := s.store.ListChatAgentTasks(session.ChatAgentTaskFilter{ProjectID: task.ProjectPath, ChatID: task.ID, Type: "ORCHESTRATOR_EXECUTE", ActiveOnly: true})
	if err != nil {
		return nil, err
	}
	var active *session.ChatAgentTask
	now := time.Now().UTC()
	for index := range workers {
		candidate := &workers[index]
		if (candidate.Status != session.ChatAgentTaskLeased && candidate.Status != session.ChatAgentTaskRunning) || candidate.LeaseOwner == "" || candidate.LeaseExpiresAt == nil || !candidate.LeaseExpiresAt.After(now) {
			continue
		}
		if active == nil || candidate.UpdatedAt.After(active.UpdatedAt) {
			active = candidate
		}
	}
	if active == nil {
		return nil, nil
	}
	return &OrchestratorTaskActiveWorker{WorkerTaskID: active.TaskID, Status: active.Status, LeaseOwner: active.LeaseOwner, AssignedWorker: active.AssignedWorker,
		SessionID: active.SessionID, RequestID: active.RequestID, ConversationID: active.ConversationID, LeaseExpiresAt: active.LeaseExpiresAt}, nil
}
