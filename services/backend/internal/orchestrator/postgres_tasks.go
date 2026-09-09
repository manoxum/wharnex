package orchestrator

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

func (s *Store) postgresListTasks(ctx context.Context, projectPath string) ([]Task, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT payload FROM harness_orchestrator_tasks WHERE project_path=$1 ORDER BY created_at,id`, projectPath)
	if err != nil {
		return nil, fmt.Errorf("list orchestrator tasks: %w", err)
	}
	defer rows.Close()
	// Non-nil for the same reason as postgresListPlans: this array is
	// consumed directly by the frontend and must never marshal as null.
	tasks := make([]Task, 0)
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		var task Task
		if err := json.Unmarshal(payload, &task); err != nil {
			return nil, fmt.Errorf("decode orchestrator task: %w", err)
		}
		dependencies, err := s.postgresDependencies(ctx, task.ID)
		if err != nil {
			return nil, err
		}
		task.DependsOn = dependencies
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (s *Store) postgresGetTask(ctx context.Context, id string) (Task, error) {
	var payload []byte
	if err := s.db.QueryRowContext(ctx, `SELECT payload FROM harness_orchestrator_tasks WHERE id=$1`, id).Scan(&payload); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Task{}, ErrNotFound
		}
		return Task{}, fmt.Errorf("get orchestrator task: %w", err)
	}
	var task Task
	if err := json.Unmarshal(payload, &task); err != nil {
		return Task{}, fmt.Errorf("decode orchestrator task: %w", err)
	}
	dependencies, err := s.postgresDependencies(ctx, task.ID)
	if err != nil {
		return Task{}, err
	}
	task.DependsOn = dependencies
	return task, nil
}

func (s *Store) postgresPutTask(ctx context.Context, task Task) error {
	payloadTask := task
	payloadTask.DependsOn = nil
	payload, err := marshalPayload(payloadTask)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `INSERT INTO harness_orchestrator_tasks (id,project_path,plan_id,status,created_at,updated_at,payload) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET project_path=EXCLUDED.project_path,plan_id=EXCLUDED.plan_id,status=EXCLUDED.status,updated_at=EXCLUDED.updated_at,payload=EXCLUDED.payload`, task.ID, task.ProjectPath, task.PlanID, task.Status, task.CreatedAt, task.UpdatedAt, payload)
	if err != nil {
		return fmt.Errorf("upsert orchestrator task: %w", err)
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM harness_orchestrator_task_dependencies WHERE task_id=$1`, task.ID); err != nil {
		return err
	}
	for _, dependency := range task.DependsOn {
		if _, err := tx.ExecContext(ctx, `INSERT INTO harness_orchestrator_task_dependencies (task_id,depends_on_task_id) VALUES ($1,$2)`, task.ID, dependency); err != nil {
			return fmt.Errorf("replace orchestrator dependency: %w", err)
		}
	}
	return tx.Commit()
}

func (s *Store) postgresDependencies(ctx context.Context, taskID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT depends_on_task_id FROM harness_orchestrator_task_dependencies WHERE task_id=$1 ORDER BY depends_on_task_id`, taskID)
	if err != nil {
		return nil, fmt.Errorf("read orchestrator dependencies: %w", err)
	}
	defer rows.Close()
	// Non-nil: depends_on is read directly by the graph/Kanban views.
	result := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result = append(result, id)
	}
	return result, rows.Err()
}
