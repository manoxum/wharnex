package orchestrator

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

func (s *Store) postgresCreatePlan(ctx context.Context, plan Plan, tasks []Task) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin orchestrator plan transaction: %w", err)
	}
	defer tx.Rollback()
	planPayload, err := marshalPayload(plan)
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO harness_orchestrator_plans (id,project_path,status,created_at,updated_at,payload) VALUES ($1,$2,$3,$4,$5,$6)`, plan.ID, plan.ProjectPath, plan.Status, plan.CreatedAt, plan.UpdatedAt, planPayload); err != nil {
		return fmt.Errorf("persist orchestrator plan: %w", err)
	}
	for _, task := range tasks {
		payloadTask := task
		payloadTask.DependsOn = nil
		payload, err := marshalPayload(payloadTask)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO harness_orchestrator_tasks (id,project_path,plan_id,status,created_at,updated_at,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)`, task.ID, task.ProjectPath, task.PlanID, task.Status, task.CreatedAt, task.UpdatedAt, payload); err != nil {
			return fmt.Errorf("persist orchestrator task %s: %w", task.ID, err)
		}
	}
	for _, task := range tasks {
		for _, dependency := range task.DependsOn {
			if _, err := tx.ExecContext(ctx, `INSERT INTO harness_orchestrator_task_dependencies (task_id,depends_on_task_id) VALUES ($1,$2)`, task.ID, dependency); err != nil {
				return fmt.Errorf("persist dependency %s -> %s: %w", task.ID, dependency, err)
			}
		}
	}
	return tx.Commit()
}

func (s *Store) postgresListPlans(ctx context.Context, projectPath string) ([]Plan, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT payload FROM harness_orchestrator_plans WHERE project_path=$1 ORDER BY created_at,id`, projectPath)
	if err != nil {
		return nil, fmt.Errorf("list orchestrator plans: %w", err)
	}
	defer rows.Close()
	var plans []Plan
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		var plan Plan
		if err := json.Unmarshal(payload, &plan); err != nil {
			return nil, fmt.Errorf("decode orchestrator plan: %w", err)
		}
		plans = append(plans, plan)
	}
	return plans, rows.Err()
}

func (s *Store) postgresGetPlan(ctx context.Context, id string) (Plan, error) {
	var payload []byte
	if err := s.db.QueryRowContext(ctx, `SELECT payload FROM harness_orchestrator_plans WHERE id=$1`, id).Scan(&payload); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Plan{}, ErrNotFound
		}
		return Plan{}, fmt.Errorf("get orchestrator plan: %w", err)
	}
	var plan Plan
	if err := json.Unmarshal(payload, &plan); err != nil {
		return Plan{}, fmt.Errorf("decode orchestrator plan: %w", err)
	}
	return plan, nil
}

func (s *Store) postgresPutPlan(ctx context.Context, plan Plan) error {
	payload, err := marshalPayload(plan)
	if err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, `UPDATE harness_orchestrator_plans SET status=$2,updated_at=$3,payload=$4 WHERE id=$1`, plan.ID, plan.Status, plan.UpdatedAt, payload)
	if err != nil {
		return fmt.Errorf("update orchestrator plan: %w", err)
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return ErrNotFound
	}
	return nil
}
