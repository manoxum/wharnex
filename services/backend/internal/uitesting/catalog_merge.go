package uitesting

import (
	"fmt"
	"strings"
	"time"
)

// SaveDiscovery merges a validated discovery answer into the stored catalog.
// taskID names the exchange; a design answer completes its design request.
func (s *Store) SaveDiscovery(project string, discovery Discovery, taskID ...string) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	if err != nil {
		return Document{}, err
	}
	doc := state.Document
	design := findDesign(doc.Designs, firstOf(taskID))
	brief := ""
	if design >= 0 {
		brief = doc.Designs[design].Brief
	}
	added, err := mergeDiscovery(&doc, discovery, brief)
	if err != nil {
		return Document{}, err
	}
	now := time.Now().UTC()
	if discovery.Origin == DiscoveryOriginDesign {
		if design >= 0 {
			doc.Designs[design].Status, doc.Designs[design].Error = "done", ""
			doc.Designs[design].TestIDs, doc.Designs[design].UpdatedAt = added, now
		}
	} else {
		doc.ContextSHA256 = discovery.ContextSHA256
		doc.SyncStatus, doc.SyncTaskID, doc.SyncError = "ready", "", ""
		doc.SyncSummary = discovery.Summary
	}
	doc.UpdatedAt = now
	state.Document = doc
	return doc, s.save(project, state)
}

// SaveCoverage adds the proposed tests whose ids are new to the catalog and
// returns those ids; a proposal reusing an existing id is ignored, so coverage
// can never overwrite a planned test.
func (s *Store) SaveCoverage(project string, proposed []TestCase) ([]string, Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.load(project)
	if err != nil {
		return nil, Document{}, err
	}
	known := map[string]bool{}
	for _, test := range state.Document.Tests {
		known[test.ID] = true
	}
	fresh := []TestCase{}
	for _, test := range proposed {
		if !known[test.ID] {
			fresh = append(fresh, test)
		}
	}
	if len(fresh) == 0 {
		return nil, state.Document, nil
	}
	doc := state.Document
	added, err := mergeDiscovery(&doc, Discovery{Origin: DiscoveryOriginCoverage, Tests: fresh}, "")
	if err != nil {
		return nil, Document{}, err
	}
	doc.UpdatedAt = time.Now().UTC()
	state.Document = doc
	return added, doc, s.save(project, state)
}

// mergeDiscovery applies one answer to doc and returns the ids it wrote. The
// merged catalog is validated as a whole before anything is kept.
func mergeDiscovery(doc *Document, discovery Discovery, brief string) ([]string, error) {
	environments := mergeEnvironments(doc.Environments, discovery.Environments)
	tests := append([]TestCase(nil), doc.Tests...)
	index := map[string]int{}
	for i, test := range tests {
		index[test.ID] = i
	}
	design := discovery.Origin == DiscoveryOriginDesign
	returned := map[string]bool{}
	written := []string{}
	for _, incoming := range discovery.Tests {
		returned[incoming.ID] = true
		incoming.Status, incoming.LastRunID, incoming.Source, incoming.Brief = "ready", "", SourceDiscovered, ""
		if design {
			incoming.Source, incoming.Brief = SourceUser, truncate(brief, MaxDesignBrief)
		}
		position, exists := index[incoming.ID]
		if !exists {
			index[incoming.ID] = len(tests)
			tests = append(tests, incoming)
			written = append(written, incoming.ID)
			continue
		}
		current := tests[position]
		if current.Source == SourceUser && !design {
			continue
		}
		if current.Source == SourceUser {
			incoming.Brief = current.Brief + "\n\n" + incoming.Brief
			incoming.Brief = truncate(strings.TrimSpace(incoming.Brief), MaxDesignBrief)
		}
		incoming.LastRunID = current.LastRunID
		if DefinitionDigest(incoming) == DefinitionDigest(current) {
			incoming.Status = current.Status
		}
		tests[position] = incoming
		written = append(written, incoming.ID)
	}
	obsolete := discovery.ObsoleteTestIDs
	if discovery.Replace {
		obsolete = nil
		for _, test := range doc.Tests {
			if !returned[test.ID] {
				obsolete = append(obsolete, test.ID)
			}
		}
	}
	tests = retireTests(tests, append(obsolete, testsOfEnvironments(tests, discovery.ObsoleteEnvironmentIDs)...))
	environments = retireEnvironments(environments, tests, discovery.ObsoleteEnvironmentIDs)
	if err := validateCatalog(environments, tests); err != nil {
		return nil, fmt.Errorf("UI discovery would leave an invalid catalog: %w", err)
	}
	doc.Environments, doc.Tests = environments, tests
	return written, nil
}

// mergeEnvironments upserts environments by id. Local configuration (URL and
// which profiles hold credentials) always survives, and environments or
// profiles GPT omits are kept because stored tests may still reference them.
func mergeEnvironments(current, incoming []Environment) []Environment {
	merged := append([]Environment(nil), current...)
	index := map[string]int{}
	for i, env := range merged {
		index[env.ID] = i
	}
	for _, env := range incoming {
		position, exists := index[env.ID]
		if !exists {
			env.URL, env.Notes = "", ""
			if env.Profiles == nil {
				env.Profiles = []Profile{}
			}
			for i := range env.Profiles {
				env.Profiles[i].Configured = false
			}
			index[env.ID] = len(merged)
			merged = append(merged, env)
			continue
		}
		target := &merged[position]
		target.Name, target.Description = env.Name, env.Description // URL and Notes stay local
		profiles := map[string]int{}
		for i, profile := range target.Profiles {
			profiles[profile.ID] = i
		}
		for _, profile := range env.Profiles {
			if i, ok := profiles[profile.ID]; ok {
				target.Profiles[i].Label, target.Profiles[i].Role = profile.Label, profile.Role
				continue
			}
			profile.Configured = false
			target.Profiles = append(target.Profiles, profile)
		}
	}
	return merged
}

func firstOf(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}
