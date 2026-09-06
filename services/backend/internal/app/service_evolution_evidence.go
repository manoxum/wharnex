package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

const maxEvolutionEvidenceEvents = 2000

type EvolutionEvidenceEvent struct {
	domain.Event
	ProjectPath string `json:"project_path"`
	ProjectName string `json:"project_name"`
	Category    string `json:"category"`
}

type EvolutionEvidence struct {
	Events     []EvolutionEvidenceEvent `json:"events"`
	Counts     map[string]int           `json:"counts"`
	Projects   []string                 `json:"projects"`
	Categories []string                 `json:"categories"`
	Total      int                      `json:"total"`
	Truncated  bool                     `json:"truncated"`
}

// EvolutionEvidence is global by design but remains callable only from the
// canonical WHX self-evolution project. Resolved IDs form a durable ledger.
func (s *Service) EvolutionEvidence(sessionID string) (EvolutionEvidence, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return EvolutionEvidence{}, err
	}
	if !s.isSelfEvolution(current) {
		return EvolutionEvidence{}, errors.New("operational improvement evidence is available only when WHX opens its own canonical runtime root")
	}
	resolved := current.ResolvedEvidenceIDs
	var events []EvolutionEvidenceEvent
	projects := map[string]struct{}{}
	categories := map[string]struct{}{}
	for _, item := range s.store.List() {
		name := filepath.Base(item.ProjectPath)
		if name == "." || name == string(filepath.Separator) {
			name = item.ProjectPath
		}
		projects[item.ProjectPath] = struct{}{}
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
	return EvolutionEvidence{Events: events, Counts: counts, Projects: sortedKeys(projects), Categories: sortedKeys(categories), Total: total, Truncated: truncated}, nil
}

func (s *Service) PrepareEvolutionAnalysis(ctx context.Context, sessionID string, selectedIDs ...string) (domain.Session, EvolutionEvidence, error) {
	evidence, err := s.EvolutionEvidence(sessionID)
	if err != nil {
		return domain.Session{}, evidence, err
	}
	selected := make(map[string]struct{}, len(selectedIDs))
	for _, id := range selectedIDs {
		selected[strings.TrimSpace(id)] = struct{}{}
	}
	reviewEvents := make([]EvolutionEvidenceEvent, 0, len(evidence.Events))
	for _, event := range evidence.Events {
		if len(selected) == 0 {
			reviewEvents = append(reviewEvents, event)
			continue
		}
		if _, ok := selected[event.ID]; ok {
			reviewEvents = append(reviewEvents, event)
		}
	}
	if len(reviewEvents) == 0 {
		return domain.Session{}, evidence, errors.New("no unresolved operational evidence was selected")
	}
	if len(reviewEvents) > 500 {
		reviewEvents = reviewEvents[len(reviewEvents)-500:]
	}
	raw, err := json.Marshal(reviewEvents)
	if err != nil {
		return domain.Session{}, evidence, fmt.Errorf("encode operational evidence: %w", err)
	}
	message := strings.Join([]string{
		"WHX OPERATIONAL SELF-EVOLUTION REVIEW",
		"Analyze only the selected unresolved evidence below, across all projects. Correlate every claim to evidence ids. Propose a focused plan-first change without weakening Policy or isolation. After the implementation is verified, return the exact evidence ids actually resolved under a `resolved_evidence_ids` list; never claim unrelated or merely observed events as resolved.",
		fmt.Sprintf("Unresolved total: %d; selected and included: %d; truncated: %t", evidence.Total, len(reviewEvents), evidence.Truncated), string(raw),
	}, "\n\n")
	_, updated, err := s.SubmitMessageWithMode(ctx, sessionID, message, "plan_first")
	if err != nil {
		return updated, evidence, err
	}
	ids := make([]string, 0, len(reviewEvents))
	for _, event := range reviewEvents {
		ids = append(ids, event.ID)
	}
	updated, err = s.store.Update(sessionID, func(item *domain.Session) error { item.EvidenceReviewIDs = append([]string(nil), ids...); return nil })
	if err != nil {
		return updated, evidence, err
	}
	s.bus.Publish(sessionID, "self_evolution.analysis_prepared", map[string]any{"request_id": updated.LastRequestID, "evidence_total": evidence.Total, "evidence_included": len(reviewEvents), "evidence_ids": ids, "truncated": evidence.Truncated})
	return updated, evidence, nil
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
