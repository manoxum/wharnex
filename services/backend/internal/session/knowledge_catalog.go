package session

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

var knowledgeIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,79}$`)

func normalizeKnowledgeEntries(entries []domain.ProjectKnowledgeEntry) ([]domain.ProjectKnowledgeEntry, error) {
	if len(entries) > 128 {
		return nil, errors.New("project knowledge catalog exceeds 128 entries")
	}
	seen := make(map[string]struct{}, len(entries))
	normalized := make([]domain.ProjectKnowledgeEntry, 0, len(entries))
	total := 0
	for _, entry := range entries {
		entry.ID = strings.TrimSpace(strings.ToLower(entry.ID))
		entry.Content = strings.TrimSpace(entry.Content)
		entry.Category = domain.NormalizeKnowledgeCategory(entry.Category, entry.ID, entry.Content)
		if !knowledgeIDPattern.MatchString(entry.ID) {
			return nil, fmt.Errorf("invalid project knowledge id %q", entry.ID)
		}
		if entry.Content == "" {
			return nil, fmt.Errorf("project knowledge %q is empty", entry.ID)
		}
		if _, duplicate := seen[entry.ID]; duplicate {
			return nil, fmt.Errorf("duplicate project knowledge id %q", entry.ID)
		}
		seen[entry.ID] = struct{}{}
		total += len(entry.Content)
		if total > 256<<10 {
			return nil, errors.New("project knowledge catalog exceeds 256 KiB")
		}
		normalized = append(normalized, entry)
	}
	sort.Slice(normalized, func(i, j int) bool { return normalized[i].ID < normalized[j].ID })
	return normalized, nil
}

func (s *Store) GetProjectKnowledgeCatalog(projectPath string) (domain.ProjectKnowledgeCatalog, bool, error) {
	if s.db != nil {
		return s.postgresGetProjectKnowledgeCatalog(projectPath)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	item, ok := s.knowledgeCatalogs[projectPath]
	if ok {
		item.Entries = append([]domain.ProjectKnowledgeEntry(nil), item.Entries...)
		return item, true, nil
	}
	legacy, legacyOK := s.knowledge[projectPath]
	if !legacyOK || strings.TrimSpace(legacy.Content) == "" {
		return domain.ProjectKnowledgeCatalog{}, false, nil
	}
	return legacyKnowledgeCatalog(legacy), true, nil
}

func legacyKnowledgeCatalog(item domain.ProjectKnowledge) domain.ProjectKnowledgeCatalog {
	return domain.ProjectKnowledgeCatalog{
		ProjectPath: item.ProjectPath, Revision: int64(item.Version), UpdatedAt: item.UpdatedAt,
		UpdatedByRequestID: item.UpdatedByRequestID,
		Entries: []domain.ProjectKnowledgeEntry{{
			ID: "legacy-project-knowledge", Content: item.Content, Category: domain.InferKnowledgeCategory("legacy-project-knowledge", item.Content), Version: max(item.Version, 1),
			UpdatedAt: item.UpdatedAt, UpdatedByRequestID: item.UpdatedByRequestID,
		}},
	}
}

func (s *Store) CompareAndSwapProjectKnowledgeCatalog(projectPath string, entries []domain.ProjectKnowledgeEntry, requestID string, expectedRevision int64) (domain.ProjectKnowledgeCatalog, error) {
	normalized, err := normalizeKnowledgeEntries(entries)
	if err != nil {
		return domain.ProjectKnowledgeCatalog{}, err
	}
	if s.db != nil {
		return s.postgresCompareAndSwapProjectKnowledgeCatalog(projectPath, normalized, requestID, expectedRevision)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.knowledgeCatalogs == nil {
		s.knowledgeCatalogs = make(map[string]domain.ProjectKnowledgeCatalog)
	}
	current, ok := s.knowledgeCatalogs[projectPath]
	if !ok {
		if legacy, legacyOK := s.knowledge[projectPath]; legacyOK && strings.TrimSpace(legacy.Content) != "" {
			current, ok = legacyKnowledgeCatalog(legacy), true
		}
	}
	currentRevision := int64(0)
	if ok {
		currentRevision = current.Revision
	}
	if currentRevision != expectedRevision {
		return domain.ProjectKnowledgeCatalog{}, ErrProjectKnowledgeConflict
	}
	now := time.Now().UTC()
	versions := knowledgeEntryVersions(current.Entries, normalized, requestID, now)
	updated := domain.ProjectKnowledgeCatalog{ProjectPath: projectPath, Revision: expectedRevision + 1, Entries: versions, UpdatedAt: now, UpdatedByRequestID: requestID}
	s.knowledgeCatalogs[projectPath] = updated
	return updated, nil
}

func knowledgeEntryVersions(current, next []domain.ProjectKnowledgeEntry, requestID string, now time.Time) []domain.ProjectKnowledgeEntry {
	old := make(map[string]domain.ProjectKnowledgeEntry, len(current))
	for _, entry := range current {
		old[entry.ID] = entry
	}
	out := make([]domain.ProjectKnowledgeEntry, 0, len(next))
	for _, entry := range next {
		if previous, ok := old[entry.ID]; ok && strings.TrimSpace(previous.Content) == strings.TrimSpace(entry.Content) && domain.NormalizeKnowledgeCategory(previous.Category, previous.ID, previous.Content) == entry.Category {
			entry.Version, entry.UpdatedAt, entry.UpdatedByRequestID = previous.Version, previous.UpdatedAt, previous.UpdatedByRequestID
		} else {
			entry.Version = 1
			if previous, ok := old[entry.ID]; ok {
				entry.Version = previous.Version + 1
			}
			entry.UpdatedAt, entry.UpdatedByRequestID = now, requestID
		}
		out = append(out, entry)
	}
	return out
}

func (s *Store) postgresGetProjectKnowledgeCatalog(projectPath string) (domain.ProjectKnowledgeCatalog, bool, error) {
	var item domain.ProjectKnowledgeCatalog
	err := s.db.QueryRowContext(context.Background(), `SELECT project_path, revision, updated_at, updated_by_request_id FROM harness_project_knowledge_state WHERE project_path=$1`, projectPath).
		Scan(&item.ProjectPath, &item.Revision, &item.UpdatedAt, &item.UpdatedByRequestID)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ProjectKnowledgeCatalog{}, false, nil
	}
	if err != nil {
		return domain.ProjectKnowledgeCatalog{}, false, err
	}
	rows, err := s.db.QueryContext(context.Background(), `SELECT knowledge_id, content, category, version, updated_at, updated_by_request_id FROM harness_project_knowledge_entries WHERE project_path=$1 ORDER BY knowledge_id`, projectPath)
	if err != nil {
		return domain.ProjectKnowledgeCatalog{}, false, err
	}
	defer rows.Close()
	for rows.Next() {
		var entry domain.ProjectKnowledgeEntry
		if err := rows.Scan(&entry.ID, &entry.Content, &entry.Category, &entry.Version, &entry.UpdatedAt, &entry.UpdatedByRequestID); err != nil {
			return domain.ProjectKnowledgeCatalog{}, false, err
		}
		entry.Category = domain.NormalizeKnowledgeCategory(entry.Category, entry.ID, entry.Content)
		item.Entries = append(item.Entries, entry)
	}
	return item, true, rows.Err()
}

func (s *Store) postgresCompareAndSwapProjectKnowledgeCatalog(projectPath string, entries []domain.ProjectKnowledgeEntry, requestID string, expectedRevision int64) (domain.ProjectKnowledgeCatalog, error) {
	ctx := context.Background()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.ProjectKnowledgeCatalog{}, err
	}
	defer tx.Rollback()
	// Materialize the revision row before locking it. A SELECT ... FOR UPDATE
	// cannot lock a row that does not exist, so two first writers could both
	// observe revision zero and race. The unique insert serializes that first
	// creation; the loser then locks and observes the winner's new revision.
	if _, err := tx.ExecContext(ctx, `INSERT INTO harness_project_knowledge_state (project_path, revision, updated_at, updated_by_request_id) VALUES ($1,0,now(),'') ON CONFLICT (project_path) DO NOTHING`, projectPath); err != nil {
		return domain.ProjectKnowledgeCatalog{}, err
	}
	var revision int64
	if err := tx.QueryRowContext(ctx, `SELECT revision FROM harness_project_knowledge_state WHERE project_path=$1 FOR UPDATE`, projectPath).Scan(&revision); err != nil {
		return domain.ProjectKnowledgeCatalog{}, err
	}
	if revision != expectedRevision {
		return domain.ProjectKnowledgeCatalog{}, ErrProjectKnowledgeConflict
	}
	current := []domain.ProjectKnowledgeEntry{}
	rows, err := tx.QueryContext(ctx, `SELECT knowledge_id, content, category, version, updated_at, updated_by_request_id FROM harness_project_knowledge_entries WHERE project_path=$1`, projectPath)
	if err != nil {
		return domain.ProjectKnowledgeCatalog{}, err
	}
	for rows.Next() {
		var entry domain.ProjectKnowledgeEntry
		if err := rows.Scan(&entry.ID, &entry.Content, &entry.Category, &entry.Version, &entry.UpdatedAt, &entry.UpdatedByRequestID); err != nil {
			rows.Close()
			return domain.ProjectKnowledgeCatalog{}, err
		}
		entry.Category = domain.NormalizeKnowledgeCategory(entry.Category, entry.ID, entry.Content)
		current = append(current, entry)
	}
	if err := rows.Close(); err != nil {
		return domain.ProjectKnowledgeCatalog{}, err
	}
	now := time.Now().UTC()
	entries = knowledgeEntryVersions(current, entries, requestID, now)
	if _, err := tx.ExecContext(ctx, `DELETE FROM harness_project_knowledge_entries WHERE project_path=$1`, projectPath); err != nil {
		return domain.ProjectKnowledgeCatalog{}, err
	}
	for _, entry := range entries {
		if _, err := tx.ExecContext(ctx, `INSERT INTO harness_project_knowledge_entries (project_path, knowledge_id, content, category, version, updated_at, updated_by_request_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`, projectPath, entry.ID, entry.Content, entry.Category, entry.Version, entry.UpdatedAt, entry.UpdatedByRequestID); err != nil {
			return domain.ProjectKnowledgeCatalog{}, err
		}
	}
	nextRevision := expectedRevision + 1
	if _, err := tx.ExecContext(ctx, `INSERT INTO harness_project_knowledge_state (project_path, revision, updated_at, updated_by_request_id) VALUES ($1,$2,$3,$4) ON CONFLICT (project_path) DO UPDATE SET revision=EXCLUDED.revision, updated_at=EXCLUDED.updated_at, updated_by_request_id=EXCLUDED.updated_by_request_id`, projectPath, nextRevision, now, requestID); err != nil {
		return domain.ProjectKnowledgeCatalog{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.ProjectKnowledgeCatalog{}, err
	}
	return domain.ProjectKnowledgeCatalog{ProjectPath: projectPath, Revision: nextRevision, Entries: entries, UpdatedAt: now, UpdatedByRequestID: requestID}, nil
}
