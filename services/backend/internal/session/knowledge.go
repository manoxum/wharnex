package session

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

var ErrProjectKnowledgeConflict = errors.New("project knowledge version conflict")

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

// CompareAndSwapProjectKnowledge replaces the full curated document only when
// its current version matches expectedVersion. expectedVersion=0 means the
// caller observed no document. This prevents concurrent reviews from silently
// overwriting knowledge learned by another session.
func (s *Store) CompareAndSwapProjectKnowledge(projectPath, content, requestID string, expectedVersion int) (domain.ProjectKnowledge, error) {
	if s.db != nil {
		return s.postgresCompareAndSwapProjectKnowledge(projectPath, content, requestID, expectedVersion)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.knowledge == nil {
		s.knowledge = make(map[string]domain.ProjectKnowledge)
	}
	current, ok := s.knowledge[projectPath]
	if (!ok && expectedVersion != 0) || (ok && current.Version != expectedVersion) {
		return domain.ProjectKnowledge{}, ErrProjectKnowledgeConflict
	}
	updated := domain.ProjectKnowledge{
		ProjectPath: projectPath, Content: content, Version: expectedVersion + 1,
		UpdatedAt: time.Now().UTC(), UpdatedByRequestID: requestID,
	}
	s.knowledge[projectPath] = updated
	return updated, nil
}

// AppendProjectKnowledge is retained for narrow callers. New review ingestion
// uses CompareAndSwapProjectKnowledge so stale writers cannot lose knowledge.
func (s *Store) AppendProjectKnowledge(projectPath, content, requestID string) (domain.ProjectKnowledge, error) {
	current, ok, err := s.GetProjectKnowledge(projectPath)
	if err != nil {
		return domain.ProjectKnowledge{}, err
	}
	expected := 0
	if ok {
		expected = current.Version
	}
	return s.CompareAndSwapProjectKnowledge(projectPath, content, requestID, expected)
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

func (s *Store) postgresCompareAndSwapProjectKnowledge(projectPath, content, requestID string, expectedVersion int) (domain.ProjectKnowledge, error) {
	var item domain.ProjectKnowledge
	var err error
	if expectedVersion == 0 {
		err = s.db.QueryRowContext(context.Background(), `
INSERT INTO harness_project_knowledge (project_path, content, version, updated_at, updated_by_request_id)
VALUES ($1, $2, 1, now(), $3)
ON CONFLICT (project_path) DO NOTHING
RETURNING project_path, content, version, updated_at, updated_by_request_id`,
			projectPath, content, requestID,
		).Scan(&item.ProjectPath, &item.Content, &item.Version, &item.UpdatedAt, &item.UpdatedByRequestID)
	} else {
		err = s.db.QueryRowContext(context.Background(), `
UPDATE harness_project_knowledge
SET content = $2, version = version + 1, updated_at = now(), updated_by_request_id = $3
WHERE project_path = $1 AND version = $4
RETURNING project_path, content, version, updated_at, updated_by_request_id`,
			projectPath, content, requestID, expectedVersion,
		).Scan(&item.ProjectPath, &item.Content, &item.Version, &item.UpdatedAt, &item.UpdatedByRequestID)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ProjectKnowledge{}, ErrProjectKnowledgeConflict
	}
	return item, err
}
