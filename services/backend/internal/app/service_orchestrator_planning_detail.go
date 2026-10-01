package app

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
	"kernl.local/harness/backend/internal/session"
)

func (s *Service) OrchestratorPlanningRequestDetail(
	ctx context.Context,
	sessionID, requestID string,
) (orchestrator.PlanningRequestDetail, error) {
	owner, err := s.store.Get(sessionID)
	if err != nil {
		return orchestrator.PlanningRequestDetail{}, err
	}
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return orchestrator.PlanningRequestDetail{}, errors.New("orchestrator request_id is required")
	}
	detail := orchestrator.PlanningRequestDetail{
		RequestID:    requestID,
		ProjectFiles: make([]string, 0), Attachments: make([]orchestrator.PlanningAttachment, 0),
		Attempts: make([]orchestrator.PlanningAttempt, 0), Tasks: make([]orchestrator.PlanningTaskDetail, 0),
		Bundles: orchestratorPlanningBundles(owner.Artifacts, requestID),
	}
	planningTasks, err := s.store.ListChatAgentTasks(session.ChatAgentTaskFilter{
		ProjectID: owner.ProjectPath, RequestID: requestID, Type: "ORCHESTRATOR_PLAN", Limit: 200,
	})
	if err != nil {
		return orchestrator.PlanningRequestDetail{}, err
	}
	var latest *session.ChatAgentTask
	for index := range planningTasks {
		task := planningTasks[index]
		detail.Attempts = append(detail.Attempts, orchestrator.PlanningAttempt{
			TaskID: task.TaskID, Status: task.Status, Attempt: task.Attempt,
			MaxAttempts: task.MaxAttempts, LastError: task.LastError,
			CreatedAt: task.CreatedAt, UpdatedAt: task.UpdatedAt,
		})
		if latest == nil || task.UpdatedAt.After(latest.UpdatedAt) ||
			(task.UpdatedAt.Equal(latest.UpdatedAt) && task.CreatedAt.After(latest.CreatedAt)) {
			copy := task
			latest = &copy
		}
	}
	if latest != nil {
		summary := orchestratorPlanningRequest(*latest)
		detail.TaskID, detail.Objective, detail.Status = summary.TaskID, summary.Objective, summary.Status
		detail.Attempt, detail.MaxAttempts, detail.LastError = summary.Attempt, summary.MaxAttempts, summary.LastError
	}
	if payload, ok := latestOrchestratorPlanningPayload(planningTasks); ok {
		if strings.TrimSpace(payload.Objective) != "" {
			detail.Objective = strings.TrimSpace(payload.Objective)
		}
		detail.Prompt = payload.Prompt
		detail.IncludeContext = payload.IncludeContext || len(payload.ProjectFiles) > 0
		detail.ProjectFiles = append(detail.ProjectFiles, payload.ProjectFiles...)
		detail.Attachments = planningAttachmentDetails(payload)
		detail.ReasoningEffort = payload.ReasoningEffort
	}
	plans, err := s.orchestrator.ListPlans(ctx, owner.ProjectPath)
	if err != nil {
		return orchestrator.PlanningRequestDetail{}, err
	}
	for index := range plans {
		if plans[index].PlannerRequestID != requestID {
			continue
		}
		if detail.Plan == nil || plans[index].UpdatedAt.After(detail.Plan.UpdatedAt) {
			plan := plans[index]
			detail.Plan = &plan
		}
	}
	if detail.Plan == nil {
		return detail, nil
	}
	if detail.Objective == "" {
		detail.Objective = detail.Plan.Objective
	}
	detail.Tasks, err = s.orchestratorPlanningTasksWithRuns(ctx, owner.ProjectPath, detail.Plan.ID)
	if err != nil {
		return orchestrator.PlanningRequestDetail{}, err
	}
	return detail, nil
}

func latestOrchestratorPlanningPayload(tasks []session.ChatAgentTask) (orchestratorPlanningWorkerPayload, bool) {
	for index := len(tasks) - 1; index >= 0; index-- {
		var payload orchestratorPlanningWorkerPayload
		if json.Unmarshal(tasks[index].Payload, &payload) != nil {
			continue
		}
		if payload.RequestID != "" || payload.Objective != "" || payload.Prompt != "" ||
			len(payload.ProjectFiles) > 0 || len(payload.Attachments) > 0 || len(payload.GeneratedAttachments) > 0 {
			return payload, true
		}
	}
	return orchestratorPlanningWorkerPayload{}, false
}

func planningAttachmentDetails(payload orchestratorPlanningWorkerPayload) []orchestrator.PlanningAttachment {
	items := make([]orchestrator.PlanningAttachment, 0, len(payload.Attachments)+len(payload.GeneratedAttachments))
	for _, attachment := range payload.Attachments {
		items = append(items, orchestrator.PlanningAttachment{
			Name: attachment.Name, Size: attachment.Size, MIME: attachment.MIME,
		})
	}
	for _, attachment := range payload.GeneratedAttachments {
		items = append(items, orchestrator.PlanningAttachment{
			Name: attachment.Name, Size: int64(len(attachment.Content)), MIME: attachment.MIME, Generated: true,
		})
	}
	return items
}

// orchestratorPlanningBundles lists the ZIPs exchanged with ChatGPT for one
// planning request, request first.
func orchestratorPlanningBundles(artifacts []domain.ArtifactRecord, requestID string) []orchestrator.PlanningBundle {
	bundles := make([]orchestrator.PlanningBundle, 0, 2)
	for _, artifact := range artifacts {
		if artifact.RequestID != requestID || artifact.Kind != "bundle" {
			continue
		}
		bundles = append(bundles, orchestrator.PlanningBundle{
			ID: artifact.ID, RequestID: artifact.RequestID, Direction: artifact.Direction, Kind: artifact.Kind, Name: artifact.Name,
			ContentType: artifact.ContentType, Size: artifact.Size, SHA256: artifact.SHA256, CreatedAt: artifact.CreatedAt,
			ExpiresAt: artifact.ExpiresAt, Bundle: artifact.Bundle, BundleType: artifact.BundleType, EntryCount: artifact.EntryCount,
		})
	}
	sort.SliceStable(bundles, func(i, j int) bool {
		if bundles[i].Direction != bundles[j].Direction {
			return bundles[i].Direction == "input"
		}
		return bundles[i].CreatedAt.Before(bundles[j].CreatedAt)
	})
	return bundles
}
