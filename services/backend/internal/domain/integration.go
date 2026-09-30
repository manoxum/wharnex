package domain

import (
	"encoding/json"
	"sort"
	"strings"
)

// UnmarshalJSON keeps verified candidates written by the first
// submodule-native engine recoverable. That engine persisted integration_units
// (including one root record); the repository-tree engine stores only the
// nested records as submodule_integrations. Silently dropping the old field
// makes the preflight forget which gitlinks it owns and recreates an
// unresolvable managed-state conflict after restart.
func (p *PendingHostChange) UnmarshalJSON(data []byte) error {
	type plain PendingHostChange
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*p = PendingHostChange(decoded)
	if len(p.SubmoduleIntegrations) > 0 {
		return nil
	}
	var legacy struct {
		IntegrationUnits []struct {
			Path         string `json:"path"`
			Branch       string `json:"branch"`
			Commit       string `json:"commit"`
			TargetBranch string `json:"target_branch,omitempty"`
			BaseCommit   string `json:"base_commit,omitempty"`
		} `json:"integration_units"`
	}
	if err := json.Unmarshal(data, &legacy); err != nil {
		return err
	}
	for _, unit := range legacy.IntegrationUnits {
		path := strings.TrimSpace(unit.Path)
		if path == "" || path == "." {
			if p.IntegrationBranch == "" {
				p.IntegrationBranch = unit.Branch
			}
			if p.IntegrationCommit == "" {
				p.IntegrationCommit = unit.Commit
			}
			continue
		}
		p.SubmoduleIntegrations = append(p.SubmoduleIntegrations, RepositoryIntegration{
			Path: path, Branch: unit.Branch, Commit: unit.Commit,
			TargetBranch: unit.TargetBranch, BaseCommit: unit.BaseCommit,
		})
	}
	sort.SliceStable(p.SubmoduleIntegrations, func(i, j int) bool {
		return strings.Count(p.SubmoduleIntegrations[i].Path, "/") < strings.Count(p.SubmoduleIntegrations[j].Path, "/")
	})
	return nil
}

// RepositoryIntegration identifies one nested repository candidate. Branch is
// Wharnex's temporary ref; TargetBranch and BaseCommit preserve the operator's
// original checkout across Apply and rollback.
type RepositoryIntegration struct {
	Path         string `json:"path"`
	Branch       string `json:"branch"`
	Commit       string `json:"commit"`
	TargetBranch string `json:"target_branch,omitempty"`
	BaseCommit   string `json:"base_commit,omitempty"`
}

type IntegrationOutcome string

const (
	IntegrationPlanning      IntegrationOutcome = "planning"
	IntegrationVerified      IntegrationOutcome = "verified"
	IntegrationMerging       IntegrationOutcome = "merging"
	IntegrationChecking      IntegrationOutcome = "checking"
	IntegrationReady         IntegrationOutcome = "ready"
	IntegrationIntegrated    IntegrationOutcome = "integrated"
	IntegrationConflict      IntegrationOutcome = "conflict"
	IntegrationSemanticCheck IntegrationOutcome = "semantic_recheck"
	IntegrationRetryableRace IntegrationOutcome = "retryable_race"
)

// FileMutation is the canonical result of applying a model delta to its exact
// immutable base. Contents are bounded by the validated patch limit and remain
// durable so a verified candidate can be merged after a backend restart.
