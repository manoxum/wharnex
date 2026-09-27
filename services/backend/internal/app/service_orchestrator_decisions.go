package app

import (
	"context"
	"errors"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
)

func (s *Service) RejectOrchestratorPlan(ctx context.Context, sessionID, planID string) (orchestrator.Overview, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return orchestrator.Overview{}, err
	}
	lock := s.orchestratorProjectLock(item.ProjectPath)
	if err := func() error {
		lock.Lock()
		defer lock.Unlock()
		plan, tasks, err := s.orchestratorDraftSnapshot(ctx, item.ProjectPath, planID)
		if err != nil {
			return err
		}
		if err := s.archiveOrchestratorDraft(ctx, plan, tasks); err != nil {
			return err
		}
		s.setProjectTodosByPlan(item.ProjectPath, plan.ID, domain.ProjectTodoExecutionOpen, "")
		s.bus.Publish(sessionID, "orchestrator.plan_rejected", map[string]any{"plan_id": plan.ID, "request_id": plan.PlannerRequestID})
		return nil
	}(); err != nil {
		return orchestrator.Overview{}, err
	}
	return s.OrchestratorOverview(ctx, sessionID)
}

func (s *Service) ApproveOrchestratorPlan(ctx context.Context, sessionID, planID string) (orchestrator.Overview, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return orchestrator.Overview{}, err
	}
	lock := s.orchestratorProjectLock(item.ProjectPath)
	if err := func() error {
		lock.Lock()
		defer lock.Unlock()
		plan, err := s.orchestrator.GetPlan(ctx, planID)
		if err != nil {
			return err
		}
		if plan.ProjectPath != item.ProjectPath {
			return errors.New("plan does not belong to this project")
		}
		if plan.Status != orchestrator.PlanDraft {
			return errors.New("orchestrator plan approval requires a draft plan")
		}
		plan.Status = orchestrator.PlanActive
		plan.UpdatedAt = time.Now().UTC()
		if err := s.orchestrator.PutPlan(ctx, plan); err != nil {
			return err
		}
		if err := s.recalculateOrchestratorTasks(ctx, item.ProjectPath); err != nil {
			return err
		}
		s.bus.Publish(sessionID, "orchestrator.plan_approved", map[string]any{"plan_id": plan.ID})
		return nil
	}(); err != nil {
		return orchestrator.Overview{}, err
	}
	return s.OrchestratorOverview(ctx, sessionID)
}
