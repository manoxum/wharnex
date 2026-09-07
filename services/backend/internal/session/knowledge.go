package session

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// GetProjectKnowledge returns the current incremental knowledge document for
// a project, if one has ever been recorded. The bool is false when nothing
// has been saved yet, which is the common case and not an error.
func (s *Store) GetProjectKnowledge(projectPath string) (domain.ProjectKnowledge, bool, error) {
	if s.db != nil {
		return s.postgresGetProjectKnowledge(projectPath)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	item, ok := s.knowledge[projectPath]
	return item, ok, nil
}

// AppendProjectKnowledge replaces the project's knowledge document with the
// given content (a full document, never a diff — see ProjectKnowledge) and
// increments its version. Called only from the dedicated knowledge_review
// response branch; see internal/app/service_knowledge.go.
func (s *Store) AppendProjectKnowledge(projectPath, content, requestID string) (domain.ProjectKnowledge, error) {
	if s.db != nil {
		return s.postgresAppendProjectKnowledge(projectPath, content, requestID)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.knowledge == nil {
		s.knowledge = make(map[string]domain.ProjectKnowledge)
	}
	current := s.knowledge[projectPath]
	updated := domain.ProjectKnowledge{
		ProjectPath: projectPath, Content: content, Version: current.Version + 1,
		UpdatedAt: time.Now().UTC(), UpdatedByRequestID: requestID,
	}
	s.knowledge[projectPath] = updated
	return updated, nil
}

func (s *Store) postgresGetProjectKnowledge(projectPath string) (domain.ProjectKnowledge, bool, error) {
	var item domain.ProjectKnowledge
	err := s.db.QueryRowContext(context.Background(),
		`SELECT project_path, content, version, updated_at, updated_by_request_id FROM harness_project_knowledge WHERE project_path = $1`,
		projectPath,
	).Scan(&item.ProjectPath, &item.Content, &item.Version, &item.UpdatedAt, &item.UpdatedByRequestID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.ProjectKnowledge{}, false, nil
		}
		return domain.ProjectKnowledge{}, false, err
	}
	return item, true, nil
}

func (s *Store) postgresAppendProjectKnowledge(projectPath, content, requestID string) (domain.ProjectKnowledge, error) {
	var item domain.ProjectKnowledge
	err := s.db.QueryRowContext(context.Background(), `
INSERT INTO harness_project_knowledge (project_path, content, version, updated_at, updated_by_request_id)
VALUES ($1, $2, 1, now(), $3)
ON CONFLICT (project_path) DO UPDATE SET
    content = EXCLUDED.content,
    version = harness_project_knowledge.version + 1,
    updated_at = EXCLUDED.updated_at,
    updated_by_request_id = EXCLUDED.updated_by_request_id
RETURNING project_path, content, version, updated_at, updated_by_request_id`,
		projectPath, content, requestID,
	).Scan(&item.ProjectPath, &item.Content, &item.Version, &item.UpdatedAt, &item.UpdatedByRequestID)
	return item, err
}
