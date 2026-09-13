package app

import (
	"context"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/projectversion"
)

type appliedVersionChange struct {
	Before string
	After  string
}

func (s *Service) ensureProjectVersion(sessionID, projectPath string) error {
	version, created, err := projectversion.Ensure(projectPath)
	if err != nil {
		return err
	}
	if created && strings.TrimSpace(sessionID) != "" {
		s.bus.Publish(sessionID, "project.version_created", map[string]any{"version": version})
	}
	return nil
}

func (s *Service) bumpProjectVersion(ctx context.Context, sessionID, projectPath string, pending []domain.PendingHostChange, commit bool) (appliedVersionChange, string, error) {
	increments := make([]projectversion.Increment, 0, len(pending))
	for index := range pending {
		increment := pending[index].Plan.VersionIncrement
		if increment == nil {
			continue
		}
		increments = append(increments, projectversion.Increment{Component: increment.Component, Amount: increment.Amount})
	}
	if len(increments) == 0 {
		return appliedVersionChange{}, "", nil
	}
	before, after, err := projectversion.Bump(projectPath, increments)
	if err != nil {
		return appliedVersionChange{}, "", err
	}
	change := appliedVersionChange{Before: before, After: after}
	if before == after {
		return change, "", nil
	}
	if !commit {
		s.bus.Publish(sessionID, "project.version_bumped", map[string]any{"before": before, "after": after, "tasks": len(increments)})
		return change, "", nil
	}
	message := fmt.Sprintf("chore(version): bump project version to %s", after)
	sha, err := hostrepo.CommitInternalPaths(ctx, projectPath, message, []string{projectversion.FileName})
	if err != nil {
		_ = projectversion.Restore(projectPath, after, before)
		return appliedVersionChange{}, "", err
	}
	s.bus.Publish(sessionID, "project.version_bumped", map[string]any{"before": before, "after": after, "tasks": len(increments)})
	return change, sha, nil
}

func restoreProjectVersion(projectPath, expectedCurrent, before string) error {
	if strings.TrimSpace(before) == "" || strings.TrimSpace(expectedCurrent) == "" {
		return nil
	}
	return projectversion.Restore(projectPath, expectedCurrent, before)
}

func versionCandidate(sessionID string, pending []domain.PendingHostChange, beforeSHA, afterSHA string, change appliedVersionChange) integratedCandidate {
	latest := pending[len(pending)-1].Plan
	return integratedCandidate{
		planID: latest.PlanID, requestID: latest.RequestID, sessionID: sessionID,
		beforeSHA: beforeSHA, afterSHA: afterSHA,
		message: fmt.Sprintf("chore(version): bump project version to %s", change.After),
		paths:   []string{projectversion.FileName},
	}
}
