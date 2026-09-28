package session

import (
	"fmt"
	"strings"
)

func (s *Store) postgresListUnifiedTaskPage(filter UnifiedTaskPageFilter, cursor *unifiedTaskPageCursor) (UnifiedTaskPage, error) {
	where := []string{"project_id=$1", unifiedTaskScopeSQL(filter.Scope)}
	args := []any{filter.ProjectID}
	if filter.Status != "" {
		args = append(args, filter.Status)
		where = append(where, fmt.Sprintf("status=$%d", len(args)))
	}
	if cursor != nil {
		updatedArg := len(args) + 1
		idArg := updatedArg + 1
		where = append(where, fmt.Sprintf("(updated_at < $%d OR (updated_at = $%d AND task_id < $%d))", updatedArg, updatedArg, idArg))
		args = append(args, cursor.UpdatedAt, cursor.TaskID)
	}
	limitArg := len(args) + 1
	query := `SELECT ` + chatAgentTaskColumns + ` FROM harness_tasks WHERE ` + strings.Join(where, " AND ") +
		fmt.Sprintf(` ORDER BY updated_at DESC, task_id DESC LIMIT $%d`, limitArg)
	args = append(args, filter.Limit+1)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return UnifiedTaskPage{}, fmt.Errorf("list unified task page: %w", err)
	}
	defer rows.Close()
	items := make([]ChatAgentTask, 0, filter.Limit+1)
	for rows.Next() {
		task, scanErr := scanChatAgentTask(rows)
		if scanErr != nil {
			return UnifiedTaskPage{}, fmt.Errorf("scan unified task page: %w", scanErr)
		}
		items = append(items, task)
	}
	if err := rows.Err(); err != nil {
		return UnifiedTaskPage{}, err
	}
	return buildUnifiedTaskPage(items, filter.Limit)
}

func unifiedTaskScopeSQL(scope string) string {
	statuses := unifiedTaskScopeStatuses(scope)
	quoted := make([]string, 0, len(statuses))
	for _, status := range statuses {
		quoted = append(quoted, "'"+status+"'")
	}
	return "status IN (" + strings.Join(quoted, ",") + ")"
}
