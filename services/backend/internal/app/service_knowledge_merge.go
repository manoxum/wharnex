package app

import (
	"fmt"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

func reconcileKnowledgeCandidate(candidate domain.ProjectKnowledgeCandidate, base []domain.ProjectKnowledgeEntry, current domain.ProjectKnowledgeCatalog) []domain.ProjectKnowledgeEntry {
	currentMap := knowledgeEntryMap(current.Entries)
	if candidate.Mode == domain.KnowledgeCandidateOverlay {
		for _, entry := range candidate.Entries {
			mergeKnowledgeEntry(currentMap, nil, entry)
		}
		return sortedKnowledgeEntries(currentMap)
	}
	baseMap := knowledgeEntryMap(base)
	candidateMap := knowledgeEntryMap(candidate.Entries)
	for id, old := range baseMap {
		if _, kept := candidateMap[id]; kept {
			continue
		}
		if now, exists := currentMap[id]; exists && sameKnowledge(now, old) {
			delete(currentMap, id)
		}
	}
	for _, entry := range candidate.Entries {
		old, hadBase := baseMap[entry.ID]
		if hadBase {
			mergeKnowledgeEntry(currentMap, &old, entry)
		} else {
			mergeKnowledgeEntry(currentMap, nil, entry)
		}
	}
	return sortedKnowledgeEntries(currentMap)
}

func knowledgeEntryMap(entries []domain.ProjectKnowledgeEntry) map[string]domain.ProjectKnowledgeEntry {
	out := make(map[string]domain.ProjectKnowledgeEntry, len(entries))
	for _, entry := range entries {
		out[entry.ID] = entry
	}
	return out
}

func mergeKnowledgeEntry(current map[string]domain.ProjectKnowledgeEntry, base *domain.ProjectKnowledgeEntry, candidate domain.ProjectKnowledgeEntry) {
	now, exists := current[candidate.ID]
	if !exists || sameKnowledge(now, candidate) || (base != nil && sameKnowledge(now, *base)) {
		current[candidate.ID] = candidate
		return
	}
	if base != nil && sameKnowledge(candidate, *base) {
		return
	}
	id := concurrentKnowledgeID(candidate.ID, current)
	candidate.ID = id
	current[id] = candidate
}

func concurrentKnowledgeID(id string, entries map[string]domain.ProjectKnowledgeEntry) string {
	base := strings.TrimRight(id, "-")
	if len(base) > 67 {
		base = base[:67]
	}
	for index := 1; ; index++ {
		candidate := fmt.Sprintf("%s-parallel-%d", base, index)
		if _, exists := entries[candidate]; !exists {
			return candidate
		}
	}
}

func sameKnowledge(a, b domain.ProjectKnowledgeEntry) bool {
	return strings.TrimSpace(a.Content) == strings.TrimSpace(b.Content) &&
		domain.NormalizeKnowledgeCategory(a.Category, a.ID, a.Content) == domain.NormalizeKnowledgeCategory(b.Category, b.ID, b.Content)
}

func sortedKnowledgeEntries(entries map[string]domain.ProjectKnowledgeEntry) []domain.ProjectKnowledgeEntry {
	out := make([]domain.ProjectKnowledgeEntry, 0, len(entries))
	for _, entry := range entries {
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func sameKnowledgeCatalog(a, b []domain.ProjectKnowledgeEntry) bool {
	if len(a) != len(b) {
		return false
	}
	aMap := knowledgeEntryMap(a)
	for _, entry := range b {
		other, ok := aMap[entry.ID]
		if !ok || !sameKnowledge(other, entry) {
			return false
		}
	}
	return true
}
