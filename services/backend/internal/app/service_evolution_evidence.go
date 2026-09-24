package app

import (
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"kernl.local/harness/backend/internal/domain"
)

const (
	maxEvolutionEvidenceEvents    = 2000
	maxEvolutionKnowledgeEvidence = 500
)

type EvolutionEvidenceEvent struct {
	domain.Event
	ProjectPath string `json:"project_path"`
	ProjectName string `json:"project_name"`
	Category    string `json:"category"`
}

type EvolutionKnowledgeRef struct {
	ProjectPath string `json:"project_path"`
	ID          string `json:"id"`
}

type EvolutionKnowledgeEvidence struct {
	ProjectPath        string    `json:"project_path"`
	ProjectName        string    `json:"project_name"`
	ID                 string    `json:"id"`
	Category           string    `json:"category"`
	Excerpt            string    `json:"excerpt"`
	Version            int       `json:"version"`
	UpdatedAt          time.Time `json:"updated_at"`
	UpdatedByRequestID string    `json:"updated_by_request_id,omitempty"`
}

type EvolutionEvidence struct {
	Events              []EvolutionEvidenceEvent     `json:"events"`
	Counts              map[string]int               `json:"counts"`
	Projects            []string                     `json:"projects"`
	Categories          []string                     `json:"categories"`
	Total               int                          `json:"total"`
	Truncated           bool                         `json:"truncated"`
	Knowledge           []EvolutionKnowledgeEvidence `json:"knowledge"`
	KnowledgeCounts     map[string]int               `json:"knowledge_counts"`
	KnowledgeCategories []string                     `json:"knowledge_categories"`
	KnowledgeTotal      int                          `json:"knowledge_total"`
	KnowledgeTruncated  bool                         `json:"knowledge_truncated"`
}

// EvolutionEvidence is global by design but remains callable only from the
// canonical WHX self-evolution project. Resolved event IDs form a durable
// ledger. Reusable knowledge is a second evidence source; project-domain and
// uncategorized/general records are deliberately filtered out before they can
// influence WHX itself.
func (s *Service) EvolutionEvidence(sessionID string) (EvolutionEvidence, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return EvolutionEvidence{}, err
	}
	if !s.isSelfEvolution(current) {
		return EvolutionEvidence{}, errors.New("operational improvement evidence is available only when WHX opens its own canonical runtime root")
	}
	resolved := make(map[string]time.Time)
	for _, candidate := range s.store.List() {
		if !s.isSelfEvolution(candidate) {
			continue
		}
		for id, resolvedAt := range candidate.ResolvedEvidenceIDs {
			resolved[id] = resolvedAt
		}
	}

	var events []EvolutionEvidenceEvent
	projects := map[string]struct{}{}
	categories := map[string]struct{}{}
	projectNames := map[string]string{}
	for _, item := range s.store.List() {
		name := evolutionProjectName(item.ProjectPath)
		projects[item.ProjectPath] = struct{}{}
		projectNames[item.ProjectPath] = name
		for _, event := range s.bus.History(item.ID) {
			if _, ok := resolved[event.ID]; ok || strings.HasPrefix(event.Type, "self_evolution.evidence_") {
				continue
			}
			category := evidenceCategory(event.Type)
			categories[category] = struct{}{}
			events = append(events, EvolutionEvidenceEvent{Event: event, ProjectPath: item.ProjectPath, ProjectName: name, Category: category})
		}
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].Timestamp.Equal(events[j].Timestamp) {
			return events[i].ID < events[j].ID
		}
		return events[i].Timestamp.Before(events[j].Timestamp)
	})
	total := len(events)
	truncated := total > maxEvolutionEvidenceEvents
	if truncated {
		events = events[total-maxEvolutionEvidenceEvents:]
	}
	counts := make(map[string]int)
	for _, event := range events {
		counts[event.Category]++
	}

	knowledge, knowledgeTotal, knowledgeTruncated, knowledgeCounts, knowledgeCategories, err := s.evolutionKnowledgeEvidence(projectNames)
	if err != nil {
		return EvolutionEvidence{}, err
	}
	return EvolutionEvidence{
		Events: events, Counts: counts, Projects: sortedKeys(projects), Categories: sortedKeys(categories), Total: total, Truncated: truncated,
		Knowledge: knowledge, KnowledgeCounts: knowledgeCounts, KnowledgeCategories: knowledgeCategories, KnowledgeTotal: knowledgeTotal, KnowledgeTruncated: knowledgeTruncated,
	}, nil
}

func (s *Service) evolutionKnowledgeEvidence(projectNames map[string]string) ([]EvolutionKnowledgeEvidence, int, bool, map[string]int, []string, error) {
	paths := make([]string, 0, len(projectNames))
	for projectPath := range projectNames {
		paths = append(paths, projectPath)
	}
	sort.Strings(paths)
	items := make([]EvolutionKnowledgeEvidence, 0)
	counts := map[string]int{}
	categories := map[string]struct{}{}
	for _, projectPath := range paths {
		catalog, present, err := s.store.GetProjectKnowledgeCatalog(projectPath)
		if err != nil {
			return nil, 0, false, nil, nil, fmt.Errorf("read knowledge for self-evolution evidence: %w", err)
		}
		if !present {
			continue
		}
		for _, entry := range catalog.Entries {
			category := domain.NormalizeKnowledgeCategory(entry.Category, entry.ID, entry.Content)
			if !domain.KnowledgeCategorySupportsSelfEvolution(category) {
				continue
			}
			counts[category]++
			categories[category] = struct{}{}
			items = append(items, EvolutionKnowledgeEvidence{
				ProjectPath: projectPath, ProjectName: projectNames[projectPath], ID: entry.ID, Category: category,
				Excerpt: knowledgeExcerpt(entry.Content, 360), Version: entry.Version, UpdatedAt: entry.UpdatedAt, UpdatedByRequestID: entry.UpdatedByRequestID,
			})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			if items[i].ProjectPath == items[j].ProjectPath {
				return items[i].ID < items[j].ID
			}
			return items[i].ProjectPath < items[j].ProjectPath
		}
		return items[i].UpdatedAt.Before(items[j].UpdatedAt)
	})
	total := len(items)
	truncated := total > maxEvolutionKnowledgeEvidence
	if truncated {
		items = items[total-maxEvolutionKnowledgeEvidence:]
	}
	return items, total, truncated, counts, sortedKeys(categories), nil
}

func evolutionProjectName(projectPath string) string {
	name := filepath.Base(projectPath)
	if name == "." || name == string(filepath.Separator) {
		return projectPath
	}
	return name
}

func knowledgeExcerpt(content string, maxRunes int) string {
	content = strings.Join(strings.Fields(strings.TrimSpace(content)), " ")
	if maxRunes <= 0 || utf8.RuneCountInString(content) <= maxRunes {
		return content
	}
	runes := []rune(content)
	return strings.TrimSpace(string(runes[:maxRunes])) + "…"
}

func (s *Service) ResolveEvolutionEvidence(sessionID string, ids []string) (EvolutionEvidence, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return EvolutionEvidence{}, err
	}
	if !s.isSelfEvolution(current) {
		return EvolutionEvidence{}, errors.New("evidence can be resolved only from WHX self-evolution")
	}
	valid := map[string]struct{}{}
	for _, item := range s.store.List() {
		for _, event := range s.bus.History(item.ID) {
			valid[event.ID] = struct{}{}
		}
	}
	now := time.Now().UTC()
	resolvedCount := 0
	_, err = s.store.Update(sessionID, func(item *domain.Session) error {
		if item.ResolvedEvidenceIDs == nil {
			item.ResolvedEvidenceIDs = map[string]time.Time{}
		}
		for _, id := range ids {
			if _, ok := valid[id]; ok {
				item.ResolvedEvidenceIDs[id] = now
				resolvedCount++
			}
		}
		return nil
	})
	if err != nil {
		return EvolutionEvidence{}, err
	}
	s.bus.Publish(sessionID, "self_evolution.evidence_resolved", map[string]any{"count": resolvedCount, "evidence_ids": ids})
	return s.EvolutionEvidence(sessionID)
}

func evidenceCategory(eventType string) string {
	lower := strings.ToLower(eventType)
	switch {
	case strings.Contains(lower, "protocol"):
		return "protocolo"
	case strings.Contains(lower, "transport") || strings.Contains(lower, "network") || strings.Contains(lower, "remote_input"):
		return "transporte"
	case strings.Contains(lower, "fail") || strings.Contains(lower, "error") || strings.Contains(lower, "blocked") || strings.Contains(lower, "conflict"):
		return "erro"
	case strings.Contains(lower, "completed") || strings.Contains(lower, "applied") || strings.Contains(lower, "success"):
		return "sucesso"
	case strings.Contains(lower, "policy"):
		return "policy"
	default:
		return "atividade"
	}
}

func sortedKeys(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}
