package executionbundle

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

var knowledgeEntryIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,79}$`)

type knowledgeIndexWire struct {
	Protocol     string                    `json:"protocol"`
	RequestID    string                    `json:"request_id,omitempty"`
	BaseRevision int64                     `json:"base_revision"`
	Mode         string                    `json:"mode"`
	Entries      []knowledgeIndexEntryWire `json:"entries"`
}

type knowledgeIndexEntryWire struct {
	ID     string `json:"id"`
	File   string `json:"file"`
	SHA256 string `json:"sha256"`
}

func parseKnowledgeCandidate(files map[string][]byte) (*domain.ProjectKnowledgeCandidate, error) {
	raw, ok := files["knowledge/index.json"]
	if !ok {
		for name := range files {
			if strings.HasPrefix(name, "knowledge/") {
				return nil, errors.New("knowledge files require knowledge/index.json")
			}
		}
		return nil, nil
	}
	if len(raw) > 128<<10 {
		return nil, errors.New("knowledge/index.json exceeds 128 KiB")
	}
	var index knowledgeIndexWire
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&index); err != nil {
		return nil, fmt.Errorf("decode knowledge/index.json: %w", err)
	}
	if index.Protocol != domain.KnowledgeProtocolV2 {
		return nil, fmt.Errorf("knowledge/index.json protocol must be %q", domain.KnowledgeProtocolV2)
	}
	if index.BaseRevision < 0 {
		return nil, errors.New("knowledge base_revision must be non-negative")
	}
	if index.Mode != domain.KnowledgeCandidateReplace && index.Mode != domain.KnowledgeCandidateOverlay {
		return nil, errors.New("knowledge mode must be replace or overlay")
	}
	if len(index.Entries) > 128 {
		return nil, errors.New("knowledge catalog exceeds 128 entries")
	}
	seen := map[string]struct{}{}
	candidate := &domain.ProjectKnowledgeCandidate{BaseRevision: index.BaseRevision, Mode: index.Mode, Entries: make([]domain.ProjectKnowledgeEntry, 0, len(index.Entries))}
	total := 0
	for _, wire := range index.Entries {
		id := strings.TrimSpace(strings.ToLower(wire.ID))
		if !knowledgeEntryIDPattern.MatchString(id) {
			return nil, fmt.Errorf("invalid knowledge id %q", wire.ID)
		}
		if _, duplicate := seen[id]; duplicate {
			return nil, fmt.Errorf("duplicate knowledge id %q", id)
		}
		seen[id] = struct{}{}
		expectedFile := "knowledge/" + id + ".md"
		name, err := safeName(wire.File)
		if err != nil || name != expectedFile {
			return nil, fmt.Errorf("knowledge %q must use file %s", id, expectedFile)
		}
		content, exists := files[expectedFile]
		if !exists {
			return nil, fmt.Errorf("knowledge %q references missing %s", id, expectedFile)
		}
		if len(bytes.TrimSpace(content)) == 0 {
			return nil, fmt.Errorf("knowledge %q is empty", id)
		}
		total += len(content)
		if total > maxKnowledgeBytes {
			return nil, errors.New("knowledge catalog exceeds 256 KiB")
		}
		digest := sha256.Sum256(content)
		actual := hex.EncodeToString(digest[:])
		if strings.ToLower(strings.TrimSpace(wire.SHA256)) != actual {
			return nil, fmt.Errorf("knowledge %q sha256 mismatch", id)
		}
		candidate.Entries = append(candidate.Entries, domain.ProjectKnowledgeEntry{ID: id, Content: strings.TrimSpace(string(content))})
	}
	for name := range files {
		if !strings.HasPrefix(name, "knowledge/") || name == "knowledge/index.json" {
			continue
		}
		if !strings.HasSuffix(strings.ToLower(name), ".md") {
			return nil, fmt.Errorf("unsupported knowledge artifact %s", name)
		}
		id := strings.TrimSuffix(path.Base(name), path.Ext(name))
		if _, ok := seen[id]; !ok {
			return nil, fmt.Errorf("unindexed knowledge file %s", name)
		}
	}
	sort.Slice(candidate.Entries, func(i, j int) bool { return candidate.Entries[i].ID < candidate.Entries[j].ID })
	return candidate, nil
}
