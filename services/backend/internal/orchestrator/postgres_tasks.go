package orchestrator

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

func (s *Store) postgresListTasks(ctx context.Context, projectPath string) ([]Task, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT payload FROM harness_tasks WHERE source='orchestrator' AND project_id=$1 ORDER BY created_at,task_id`, projectPath)
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

func (s *Store) postgresListTaskPage(ctx context.Context, projectPath string, filter TaskPageFilter, cursor *taskPageCursor) (TaskPage, error) {
	where, args := postgresTaskPageWhere(projectPath, filter)
	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM harness_tasks WHERE `+where, args...).Scan(&total); err != nil {
		return TaskPage{}, fmt.Errorf("count orchestrator terminal tasks: %w", err)
	}

	pageWhere := where
	pageArgs := append([]any(nil), args...)
	if cursor != nil {
		updatedArg := len(pageArgs) + 1
		idArg := updatedArg + 1
		pageWhere += fmt.Sprintf(" AND (updated_at < $%d OR (updated_at = $%d AND task_id < $%d))", updatedArg, updatedArg, idArg)
		pageArgs = append(pageArgs, cursor.UpdatedAt, cursor.TaskID)
	}
	limitArg := len(pageArgs) + 1
	query := `SELECT payload,updated_at,task_id FROM harness_tasks WHERE ` + pageWhere + fmt.Sprintf(" ORDER BY updated_at DESC,task_id DESC LIMIT $%d", limitArg)
	pageArgs = append(pageArgs, filter.Limit+1)
	rows, err := s.db.QueryContext(ctx, query, pageArgs...)
	if err != nil {
		return TaskPage{}, fmt.Errorf("list orchestrator terminal task page: %w", err)
	}
	defer rows.Close()

	tasks := make([]Task, 0, filter.Limit+1)
	for rows.Next() {
		var payload []byte
		var updatedAt time.Time
		var taskID string
		if err := rows.Scan(&payload, &updatedAt, &taskID); err != nil {
			return TaskPage{}, err
		}
		var task Task
		if err := json.Unmarshal(payload, &task); err != nil {
			return TaskPage{}, fmt.Errorf("decode orchestrator task: %w", err)
		}
		task.ID = taskID
		task.UpdatedAt = updatedAt
		dependencies, err := s.postgresDependencies(ctx, task.ID)
		if err != nil {
			return TaskPage{}, err
		}
		task.DependsOn = dependencies
		tasks = append(tasks, task)
	}
	if err := rows.Err(); err != nil {
		return TaskPage{}, err
	}

	hasMore := len(tasks) > filter.Limit
	if hasMore {
		tasks = tasks[:filter.Limit]
	}
	page := TaskPage{Tasks: tasks, Total: total, HasMore: hasMore}
	if hasMore && len(tasks) > 0 {
		page.NextCursor, err = encodeTaskPageCursor(tasks[len(tasks)-1])
		if err != nil {
			return TaskPage{}, err
		}
	}
	return page, nil
}

func postgresTaskPageWhere(projectPath string, filter TaskPageFilter) (string, []any) {
	where := "source='orchestrator' AND project_id=$1 AND status IN ('COMPLETE','ARCHIVED')"
	args := []any{projectPath}
	if filter.Status != "" {
		args = append(args, filter.Status)
		where += fmt.Sprintf(" AND status=$%d", len(args))
	}
	if filter.Search != "" {
		args = append(args, strings.ToLower(filter.Search))
		searchArg := len(args)
		where += fmt.Sprintf(" AND (position($%d in lower(title)) > 0 OR position($%d in lower(description)) > 0)", searchArg, searchArg)
	}
	return where, args
}

func (s *Store) postgresGetTask(ctx context.Context, id string) (Task, error) {
	var payload []byte
	if err := s.db.QueryRowContext(ctx, `SELECT payload FROM harness_tasks WHERE source='orchestrator' AND task_id=$1`, id).Scan(&payload); err != nil {
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
	result, err := tx.ExecContext(ctx, `INSERT INTO harness_tasks (task_id,type,source,project_id,plan_id,title,description,condition,priority,status,not_before,payload,created_at,updated_at) VALUES ($1,'ORCHESTRATOR_TASK','orchestrator',$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,$11) ON CONFLICT (task_id) DO UPDATE SET project_id=EXCLUDED.project_id,plan_id=EXCLUDED.plan_id,title=EXCLUDED.title,description=EXCLUDED.description,condition=EXCLUDED.condition,priority=EXCLUDED.priority,status=EXCLUDED.status,payload=EXCLUDED.payload,updated_at=EXCLUDED.updated_at`, task.ID, task.ProjectPath, task.PlanID, task.Title, task.Description, task.Condition, orchestratorPriorityRank(task.Priority), task.Status, task.CreatedAt, payload, task.UpdatedAt)
	if err != nil {
		return fmt.Errorf("upsert orchestrator task: %w", err)
	}
	if count, _ := result.RowsAffected(); count == 0 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM harness_task_dependencies WHERE task_id=$1`, task.ID); err != nil {
		return err
	}
	for _, dependency := range task.DependsOn {
		if _, err := tx.ExecContext(ctx, `INSERT INTO harness_task_dependencies (task_id,depends_on_task_id) VALUES ($1,$2)`, task.ID, dependency); err != nil {
			return fmt.Errorf("replace orchestrator dependency: %w", err)
		}
	}
	return tx.Commit()
}

func (s *Store) postgresDependencies(ctx context.Context, taskID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT depends_on_task_id FROM harness_task_dependencies WHERE task_id=$1 ORDER BY depends_on_task_id`, taskID)
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
