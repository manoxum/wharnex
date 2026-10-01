package orchestrator

import (
	"context"
	"encoding/json"
	"fmt"
)

func (s *Store) postgresAppendRun(ctx context.Context, run TaskRun) error {
	payload, err := marshalPayload(run)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO harness_task_runs (id,task_id,project_path,attempt,status,started_at,completed_at,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,completed_at=EXCLUDED.completed_at,payload=EXCLUDED.payload`, run.ID, run.TaskID, run.ProjectPath, run.Attempt, run.Status, run.StartedAt, run.CompletedAt, payload)
	if err != nil {
		return fmt.Errorf("persist orchestrator task run: %w", err)
	}
	return nil
}

func (s *Store) postgresListRuns(ctx context.Context, taskID string) ([]TaskRun, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT payload FROM harness_task_runs WHERE task_id=$1 ORDER BY attempt,started_at,id`, taskID)
	if err != nil {
		return nil, fmt.Errorf("list orchestrator task runs: %w", err)
	}
	defer rows.Close()
	// Non-nil so an empty history marshals as [] rather than null; the task
	// detail view iterates this array without a null guard.
	runs := make([]TaskRun, 0)
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		var run TaskRun
		if err := json.Unmarshal(payload, &run); err != nil {
			return nil, fmt.Errorf("decode orchestrator task run: %w", err)
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (s *Store) postgresListTaskConclusions(ctx context.Context, projectPath string, limit int) ([]TaskConclusion, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT r.id,r.task_id,t.title,t.status,r.completed_at
		FROM harness_task_runs r
		JOIN harness_tasks t ON t.task_id=r.task_id
		WHERE r.project_path=$1
		  AND t.source='orchestrator'
		  AND t.project_id=$1
		  AND t.status IN ('REVIEW','COMPLETE','ARCHIVED')
		  AND r.status='review'
		  AND r.completed_at IS NOT NULL
		ORDER BY r.completed_at DESC,r.id DESC
		LIMIT $2`, projectPath, limit)
	if err != nil {
		return nil, fmt.Errorf("list orchestrator task conclusions: %w", err)
	}
	defer rows.Close()

	items := make([]TaskConclusion, 0, limit)
	for rows.Next() {
		var item TaskConclusion
		if err := rows.Scan(&item.RunID, &item.TaskID, &item.Title, &item.Status, &item.CompletedAt); err != nil {
			return nil, err
		}
		item.CompletedAt = item.CompletedAt.UTC()
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) postgresListPendingTaskReviews(ctx context.Context, projectPath string, limit int) ([]TaskConclusion, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT recent.id,recent.task_id,recent.title,recent.status,recent.completed_at
		FROM (
			SELECT DISTINCT ON (r.task_id)
				r.id,r.task_id,t.title,t.status,r.completed_at
			FROM harness_task_runs r
			JOIN harness_tasks t ON t.task_id=r.task_id
			WHERE r.project_path=$1
			  AND t.source='orchestrator'
			  AND t.project_id=$1
			  AND t.status='REVIEW'
			  AND r.status='review'
			  AND r.completed_at IS NOT NULL
			ORDER BY r.task_id,r.completed_at DESC,r.id DESC
		) recent
		ORDER BY recent.completed_at DESC,recent.id DESC
		LIMIT $2`, projectPath, limit)
	if err != nil {
		return nil, fmt.Errorf("list pending orchestrator task reviews: %w", err)
	}
	defer rows.Close()

	items := make([]TaskConclusion, 0, limit)
	for rows.Next() {
		var item TaskConclusion
		if err := rows.Scan(&item.RunID, &item.TaskID, &item.Title, &item.Status, &item.CompletedAt); err != nil {
			return nil, err
		}
		item.CompletedAt = item.CompletedAt.UTC()
		items = append(items, item)
	}
	return items, rows.Err()
}
