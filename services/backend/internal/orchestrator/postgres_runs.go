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
	_, err = s.db.ExecContext(ctx, `INSERT INTO harness_orchestrator_task_runs (id,task_id,project_path,attempt,status,started_at,completed_at,payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,completed_at=EXCLUDED.completed_at,payload=EXCLUDED.payload`, run.ID, run.TaskID, run.ProjectPath, run.Attempt, run.Status, run.StartedAt, run.CompletedAt, payload)
	if err != nil {
		return fmt.Errorf("persist orchestrator task run: %w", err)
	}
	return nil
}

func (s *Store) postgresListRuns(ctx context.Context, taskID string) ([]TaskRun, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT payload FROM harness_orchestrator_task_runs WHERE task_id=$1 ORDER BY attempt,started_at,id`, taskID)
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
