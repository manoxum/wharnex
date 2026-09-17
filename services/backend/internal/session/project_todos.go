package session

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

func (s *Store) projectTodoFallback() map[string][]domain.ProjectTodo {
	if s.projectTodos == nil {
		s.projectTodos = make(map[string][]domain.ProjectTodo)
	}
	return s.projectTodos
}

func (s *Store) ListProjectTodos(projectPath string) ([]domain.ProjectTodo, error) {
	project := strings.TrimSpace(projectPath)
	if project == "" {
		return nil, fmt.Errorf("project_path is required")
	}
	if s.db == nil {
		s.mu.RLock()
		defer s.mu.RUnlock()
		items := append([]domain.ProjectTodo(nil), s.projectTodoFallback()[project]...)
		sort.Slice(items, func(i, j int) bool { return items[i].UpdatedAt.After(items[j].UpdatedAt) })
		return items, nil
	}
	rows, err := s.db.Query(`SELECT id, project_path, created_at, updated_at, payload
		FROM harness_project_todos WHERE project_path=$1 ORDER BY updated_at DESC, id`, project)
	if err != nil {
		return nil, fmt.Errorf("list project todos: %w", err)
	}
	defer rows.Close()
	items := make([]domain.ProjectTodo, 0, 32)
	for rows.Next() {
		var item domain.ProjectTodo
		var payload []byte
		if err := rows.Scan(&item.ID, &item.ProjectPath, &item.CreatedAt, &item.UpdatedAt, &payload); err != nil {
			return nil, fmt.Errorf("scan project todo: %w", err)
		}
		id, projectPath, createdAt, updatedAt := item.ID, item.ProjectPath, item.CreatedAt, item.UpdatedAt
		if len(payload) > 0 && json.Unmarshal(payload, &item) != nil {
			return nil, fmt.Errorf("decode project todo %s", id)
		}
		item.ID, item.ProjectPath, item.CreatedAt, item.UpdatedAt = id, projectPath, createdAt, updatedAt
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetProjectTodo(id string) (domain.ProjectTodo, error) {
	todoID := strings.TrimSpace(id)
	if todoID == "" {
		return domain.ProjectTodo{}, fmt.Errorf("project todo id is required")
	}
	if s.db == nil {
		s.mu.RLock()
		defer s.mu.RUnlock()
		for _, items := range s.projectTodoFallback() {
			for _, item := range items {
				if item.ID == todoID {
					return item, nil
				}
			}
		}
		return domain.ProjectTodo{}, sql.ErrNoRows
	}
	var item domain.ProjectTodo
	var payload []byte
	var createdAt, updatedAt time.Time
	var projectPath string
	err := s.db.QueryRow(`SELECT project_path, created_at, updated_at, payload FROM harness_project_todos WHERE id=$1`, todoID).
		Scan(&projectPath, &createdAt, &updatedAt, &payload)
	if err != nil {
		return domain.ProjectTodo{}, err
	}
	if err := json.Unmarshal(payload, &item); err != nil {
		return domain.ProjectTodo{}, fmt.Errorf("decode project todo %s: %w", todoID, err)
	}
	item.ID, item.ProjectPath, item.CreatedAt, item.UpdatedAt = todoID, projectPath, createdAt, updatedAt
	return item, nil
}

func (s *Store) SaveProjectTodo(item domain.ProjectTodo) (domain.ProjectTodo, error) {
	item.ID = strings.TrimSpace(item.ID)
	item.ProjectPath = strings.TrimSpace(item.ProjectPath)
	if item.ID == "" || item.ProjectPath == "" {
		return domain.ProjectTodo{}, fmt.Errorf("project todo id and project_path are required")
	}
	now := time.Now().UTC()
	if item.CreatedAt.IsZero() {
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	if s.db == nil {
		s.mu.Lock()
		defer s.mu.Unlock()
		items := s.projectTodoFallback()[item.ProjectPath]
		replaced := false
		for index := range items {
			if items[index].ID == item.ID {
				items[index] = item
				replaced = true
				break
			}
		}
		if !replaced {
			items = append(items, item)
		}
		s.projectTodoFallback()[item.ProjectPath] = items
		return item, nil
	}
	payload, err := json.Marshal(item)
	if err != nil {
		return domain.ProjectTodo{}, fmt.Errorf("encode project todo: %w", err)
	}
	_, err = s.db.Exec(`INSERT INTO harness_project_todos (id, project_path, created_at, updated_at, payload)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (id) DO UPDATE SET project_path=EXCLUDED.project_path, updated_at=EXCLUDED.updated_at, payload=EXCLUDED.payload`,
		item.ID, item.ProjectPath, item.CreatedAt, item.UpdatedAt, payload)
	if err != nil {
		return domain.ProjectTodo{}, fmt.Errorf("persist project todo: %w", err)
	}
	return item, nil
}
