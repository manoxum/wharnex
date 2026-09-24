package app

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/pendingcommit"
)

func (s *Service) previewCommitPaths(ctx context.Context, projectPath, root string, req GitPreviewRequest) ([]string, error) {
	if len(req.PendingIDs) == 0 && len(req.Paths) > 0 {
		return validatePreviewPaths(ctx, root, req.Paths)
	}
	if s.pendingCommits == nil {
		return nil, fmt.Errorf("the pending-commit store is not configured")
	}
	records, err := s.pendingCommits.List(projectPath)
	if err != nil {
		return nil, err
	}
	selected := records
	if len(req.PendingIDs) > 0 {
		var missing []string
		selected, missing = pendingcommit.Select(records, req.PendingIDs)
		if len(missing) > 0 {
			return nil, fmt.Errorf("unknown pending commit(s): %s", strings.Join(missing, ", "))
		}
		chosen := make(map[string]bool, len(selected))
		for _, record := range selected {
			chosen[record.ID] = true
		}
		if blockers := pendingcommit.BlockingPredecessors(records, chosen); len(blockers) > 0 {
			return nil, ErrPendingCommitBlocked
		}
	}
	set := map[string]bool{}
	for _, record := range selected {
		for _, path := range record.Paths {
			set[path] = true
		}
	}
	paths := make([]string, 0, len(set))
	for path := range set {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	if len(paths) == 0 {
		return nil, fmt.Errorf("there are no pending changes to preview")
	}
	return paths, nil
}

func validatePreviewPaths(ctx context.Context, root string, requested []string) ([]string, error) {
	state, err := hostrepo.Working(ctx, root)
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{}
	for _, path := range state.Stageable {
		allowed[path] = true
	}
	for _, path := range state.GitlinkChanges {
		allowed[path] = true
	}
	seen := map[string]bool{}
	paths := make([]string, 0, len(requested))
	for _, raw := range requested {
		path := strings.TrimSpace(raw)
		if path == "" || seen[path] {
			continue
		}
		if !allowed[path] {
			return nil, fmt.Errorf("path is not a committable worktree file: %s", path)
		}
		seen[path] = true
		paths = append(paths, path)
	}
	if len(paths) == 0 {
		return nil, fmt.Errorf("select at least one changed file to commit")
	}
	sort.Strings(paths)
	return paths, nil
}
