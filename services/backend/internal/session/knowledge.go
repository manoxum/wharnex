package session

import (
	"errors"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

var ErrProjectKnowledgeConflict = errors.New("project knowledge version conflict")

// GetProjectKnowledge preserves the v1 single-document API as a deterministic
// projection of the v2 record catalog. New code should use
// GetProjectKnowledgeCatalog so record identity is not lost.
func (s *Store) GetProjectKnowledge(projectPath string) (domain.ProjectKnowledge, bool, error) {
	catalog, ok, err := s.GetProjectKnowledgeCatalog(projectPath)
	if err != nil || !ok {
		return domain.ProjectKnowledge{}, ok, err
	}
	entries := append([]domain.ProjectKnowledgeEntry(nil), catalog.Entries...)
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	content := ""
	if len(entries) == 1 && entries[0].ID == "legacy-project-knowledge" {
		content = strings.TrimSpace(entries[0].Content)
	} else {
		parts := make([]string, 0, len(entries))
		for _, entry := range entries {
			parts = append(parts, "## "+entry.ID+"\n\n"+strings.TrimSpace(entry.Content))
		}
		content = strings.Join(parts, "\n\n")
	}
	return domain.ProjectKnowledge{
		ProjectPath: projectPath, Content: content, Version: int(catalog.Revision),
		UpdatedAt: catalog.UpdatedAt, UpdatedByRequestID: catalog.UpdatedByRequestID,
	}, true, nil
}

// CompareAndSwapProjectKnowledge is a compatibility adapter for pre-v2 tests,
// API clients, and an already-pending legacy knowledge_review response. The
// incoming document becomes one legacy record in the catalog.
func (s *Store) CompareAndSwapProjectKnowledge(projectPath, content, requestID string, expectedVersion int) (domain.ProjectKnowledge, error) {
	catalog, err := s.CompareAndSwapProjectKnowledgeCatalog(projectPath, []domain.ProjectKnowledgeEntry{{ID: "legacy-project-knowledge", Content: content}}, requestID, int64(expectedVersion))
	if err != nil {
		return domain.ProjectKnowledge{}, err
	}
	item, _, err := s.GetProjectKnowledge(projectPath)
	if err != nil {
		return domain.ProjectKnowledge{}, err
	}
	item.Version = int(catalog.Revision)
	return item, nil
}

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
