package app

import (
	"context"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/sandbox"
)

// upgradeLegacyRepositoryIntegrations repairs the two durable shapes written
// by the retired repository-unit engine: integration_units decoded without
// checkout identity, and snapshots that a short-lived incompatible decoder
// rewrote after silently discarding integration_units altogether.
func upgradeLegacyRepositoryIntegrations(ctx context.Context, projectPath string, pending []domain.PendingHostChange) ([]domain.PendingHostChange, bool, error) {
	if !legacyRepositoryInspectionNeeded(pending) {
		return pending, false, nil
	}
	units, err := hostrepo.InspectUnits(ctx, projectPath)
	if err != nil {
		return nil, false, fmt.Errorf("measure repository tree for legacy candidate: %w", err)
	}
	byPath := make(map[string]hostrepo.Unit, len(units.List))
	for _, unit := range units.List {
		byPath[unit.Path] = unit
	}

	upgraded := append([]domain.PendingHostChange(nil), pending...)
	changed := false
	for changeIndex := range upgraded {
		change := &upgraded[changeIndex]
		integrations := append([]domain.RepositoryIntegration(nil), change.SubmoduleIntegrations...)
		if len(integrations) == 0 && change.IntegrationBranch != "" {
			recovered, recoverErr := recoverDiscardedRepositoryIntegrations(ctx, *change, units, byPath)
			if recoverErr != nil {
				return nil, false, recoverErr
			}
			if len(recovered) > 0 {
				integrations = recovered
				changed = true
			}
		}
		for integrationIndex := range integrations {
			integration := &integrations[integrationIndex]
			if strings.TrimSpace(integration.BaseCommit) != "" {
				continue
			}
			unit, found := byPath[strings.TrimSpace(integration.Path)]
			if !found || !unit.Integrable() {
				return nil, false, fmt.Errorf("legacy nested repository %s is no longer an initialized repository", integration.Path)
			}
			head, headErr := sandbox.CurrentHeadSHA(ctx, unit.Root)
			if headErr != nil {
				return nil, false, fmt.Errorf("resolve legacy nested repository %s HEAD: %w", integration.Path, headErr)
			}
			integration.TargetBranch = unit.Topology.Branch
			integration.BaseCommit = head
			changed = true
		}
		change.SubmoduleIntegrations = integrations
	}
	return upgraded, changed, nil
}

func legacyRepositoryInspectionNeeded(pending []domain.PendingHostChange) bool {
	for index := range pending {
		change := &pending[index]
		for _, integration := range change.SubmoduleIntegrations {
			if strings.TrimSpace(integration.BaseCommit) == "" {
				return true
			}
		}
		if len(change.SubmoduleIntegrations) == 0 && change.IntegrationBranch != "" && len(actualPatchFiles(&change.Plan)) > 0 {
			return true
		}
	}
	return false
}

// recoverDiscardedRepositoryIntegrations accepts only evidence that agrees in
// three independent places: a plan path is owned by a registered unit, the
// superproject/parent candidate records that unit's exact gitlink, and the same
// named local unit branch points at that commit. Anything ambiguous fails
// closed instead of degrading the candidate to a root-only merge.
func recoverDiscardedRepositoryIntegrations(ctx context.Context, change domain.PendingHostChange, units hostrepo.Units, byPath map[string]hostrepo.Unit) ([]domain.RepositoryIntegration, error) {
	required := map[string]bool{}
	for _, path := range actualPatchFiles(&change.Plan) {
		owner := hostrepo.RootUnitPath
		for _, unit := range units.List {
			if unit.IsRoot() {
				continue
			}
			if (path == unit.Path || strings.HasPrefix(path, unit.Path+"/")) && len(unit.Path) > len(owner) {
				owner = unit.Path
			}
		}
		for owner != hostrepo.RootUnitPath {
			required[owner] = true
			unit, found := byPath[owner]
			if !found {
				return nil, fmt.Errorf("recover legacy nested candidate owner %s: repository is no longer registered", owner)
			}
			owner = unit.ParentPath
		}
	}
	if len(required) == 0 {
		return nil, nil
	}

	integrations := make([]domain.RepositoryIntegration, 0, len(required))
	for _, unit := range units.List {
		if !required[unit.Path] {
			continue
		}
		if !unit.Integrable() {
			return nil, fmt.Errorf("recover legacy nested candidate %s: repository is not initialized and measurable", unit.Path)
		}
		parent, found := byPath[unit.ParentPath]
		if !found || !parent.Integrable() {
			return nil, fmt.Errorf("recover legacy nested candidate %s: parent repository is unavailable", unit.Path)
		}
		childPath := strings.TrimPrefix(unit.Path, unit.ParentPath+"/")
		if unit.ParentPath == hostrepo.RootUnitPath {
			childPath = unit.Path
		}
		commit, found := hostrepo.GitlinkAt(ctx, parent.Root, change.IntegrationBranch, childPath)
		if !found {
			return nil, fmt.Errorf("recover legacy nested candidate %s: branch %s records no exact gitlink", unit.Path, change.IntegrationBranch)
		}
		branches, branchErr := hostrepo.Branches(ctx, unit.Root)
		if branchErr != nil {
			return nil, fmt.Errorf("recover legacy nested candidate %s branch: %w", unit.Path, branchErr)
		}
		branchMatches := false
		for _, branch := range branches {
			if branch.Remote == "" && branch.Name == change.IntegrationBranch && branch.CommitSHA == commit {
				branchMatches = true
				break
			}
		}
		if !branchMatches {
			return nil, fmt.Errorf("recover legacy nested candidate %s: local branch %s does not point at gitlink %s", unit.Path, change.IntegrationBranch, commit)
		}
		head, headErr := sandbox.CurrentHeadSHA(ctx, unit.Root)
		if headErr != nil {
			return nil, fmt.Errorf("recover legacy nested candidate %s HEAD: %w", unit.Path, headErr)
		}
		integrations = append(integrations, domain.RepositoryIntegration{
			Path: unit.Path, Branch: change.IntegrationBranch, Commit: commit,
			TargetBranch: unit.Topology.Branch, BaseCommit: head,
		})
	}
	return integrations, nil
}
