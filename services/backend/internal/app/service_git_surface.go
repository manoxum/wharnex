package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/gitsettings"
	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/pendingcommit"
)

// SetGitSurface wires the Git surface's own persistence: where per-project
// commit-mode settings live, and the queue of applied-but-uncommitted changes.
func (s *Service) SetGitSurface(settingsFile string, pending *pendingcommit.Store) {
	s.gitSettingsFile = strings.TrimSpace(settingsFile)
	s.pendingCommits = pending
}

// projectCommitMode resolves what a project does with its history after a
// successful Apply. A settings document that cannot be read degrades to auto,
// which is the historical behavior: a configuration fault must never silently
// switch a project into leaving changes uncommitted.
func (s *Service) projectCommitMode(projectPath string) gitsettings.CommitMode {
	if s.gitSettingsFile == "" {
		return gitsettings.CommitModeAuto
	}
	document, err := gitsettings.Read(s.gitSettingsFile)
	if err != nil {
		return gitsettings.CommitModeAuto
	}
	return document.ForProject(projectPath).CommitMode
}

// GitCommitMode reports the mode a project is currently using.
func (s *Service) GitCommitMode(projectPath string) gitsettings.CommitMode {
	return s.projectCommitMode(projectPath)
}

// SetGitCommitMode changes a project's commit mode.
//
// It deliberately does not retroactively commit or uncommit anything. Changing
// the mode decides what happens to the *next* applied change; rewriting history
// that already exists, or committing work the operator has not reviewed, would
// be a far larger action than the toggle they clicked.
func (s *Service) SetGitCommitMode(projectPath string, mode gitsettings.CommitMode) (gitsettings.CommitMode, error) {
	if !gitsettings.ValidCommitMode(mode) {
		return "", fmt.Errorf("unsupported commit mode %q", mode)
	}
	if s.gitSettingsFile == "" {
		return "", errors.New("the Git settings document is not configured")
	}
	s.gitSettingsMu.Lock()
	defer s.gitSettingsMu.Unlock()
	document, err := gitsettings.Read(s.gitSettingsFile)
	if err != nil {
		return "", err
	}
	updated := document.WithProject(projectPath, gitsettings.ProjectSettings{CommitMode: mode})
	if err := gitsettings.Save(s.gitSettingsFile, updated); err != nil {
		return "", err
	}
	return mode, nil
}

// recordAndUnwindIntegration turns a completed, verified integration into
// uncommitted work plus a durable record of the history it should receive.
//
// Order matters and is not interchangeable. Every diff is captured while the
// commits still exist and every record is durably stored *before* the branch
// moves, so a crash between the two leaves the operator with committed history
// — recoverable, and visible in `git log` — rather than with an unexplained
// dirty worktree whose commit messages were lost.
func (s *Service) recordAndUnwindIntegration(ctx context.Context, sessionID, projectPath string, integrated []integratedCandidate, targetSHA string) error {
	if s.pendingCommits == nil {
		return errors.New("manual commit mode requires the pending-commit store")
	}
	if strings.TrimSpace(targetSHA) == "" {
		return errors.New("manual commit mode needs the host's pre-integration commit")
	}
	// Records written so far are rolled back if any later step fails, because
	// the caller's own failure path reverts the merges: leaving records behind
	// would describe changes that no longer exist anywhere.
	written := make([]string, 0, len(integrated))
	rollback := func(cause error) error {
		if len(written) > 0 {
			_, _ = s.pendingCommits.Remove(projectPath, written)
		}
		return cause
	}
	for _, candidate := range integrated {
		diff, truncated, diffErr := hostrepo.DiffBetween(ctx, projectPath, candidate.beforeSHA, candidate.afterSHA, pendingcommit.MaxDiffBytes)
		if diffErr != nil {
			// The diff is documentation, not the change itself. Losing it must
			// not cost the operator the commit message, which is the part they
			// cannot reconstruct.
			s.bus.Publish(sessionID, "git.pending_diff_degraded", map[string]any{"plan_id": candidate.planID, "error": diffErr.Error()})
		}
		record := pendingcommit.Record{
			ID:            ids.New("pending"),
			ProjectPath:   projectPath,
			SessionID:     candidate.sessionID,
			RequestID:     candidate.requestID,
			PlanID:        candidate.planID,
			Message:       candidate.message,
			Paths:         candidate.paths,
			Diff:          diff,
			DiffTruncated: truncated,
			CreatedAt:     time.Now().UTC(),
		}
		if err := s.pendingCommits.Append(record); err != nil {
			return rollback(fmt.Errorf("record pending commit for %s: %w", candidate.planID, err))
		}
		written = append(written, record.ID)
		s.bus.Publish(sessionID, "git.pending_commit_recorded", map[string]any{
			"plan_id": candidate.planID, "pending_id": record.ID, "subject": firstLineOf(record.Message), "paths": record.Paths,
		})
	}
	if err := hostrepo.UnwindToCommit(ctx, projectPath, targetSHA); err != nil {
		return rollback(err)
	}
	s.bus.Publish(sessionID, "git.integration_left_uncommitted", map[string]any{
		"commit": targetSHA, "candidates": len(integrated),
		"reason": "this project applies changes without committing; the change is in the working tree",
	})
	return nil
}

func firstLineOf(message string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(message), "\n")
	return line
}

// GitWorkingSummary counts the host worktree's uncommitted state by class, so
// the Git surface can say what is there without shipping every path.
type GitWorkingSummary struct {
	Clean                bool     `json:"clean"`
	StageableCount       int      `json:"stageable_count"`
	DirtySubmodules      []string `json:"dirty_submodules,omitempty"`
	EmbeddedRepositories []string `json:"embedded_repositories,omitempty"`
	UnmergedPaths        []string `json:"unmerged_paths,omitempty"`
}

// GitOverview is everything the Git surface renders in one round trip.
type GitOverview struct {
	ProjectPath     string                     `json:"project_path"`
	Available       bool                       `json:"available"`
	Unavailable     string                     `json:"unavailable,omitempty"`
	CommitMode      string                     `json:"commit_mode"`
	CommitModeFixed bool                       `json:"commit_mode_fixed,omitempty"`
	CurrentBranch   string                     `json:"current_branch,omitempty"`
	Detached        bool                       `json:"detached"`
	InProgress      string                     `json:"in_progress,omitempty"`
	HasIdentity     bool                       `json:"has_identity"`
	Branches        []hostrepo.Branch          `json:"branches"`
	Remotes         []hostrepo.Remote          `json:"remotes"`
	Commits         []hostrepo.Commit          `json:"commits"`
	Pending         []pendingcommit.Record     `json:"pending"`
	Working         GitWorkingSummary          `json:"working"`
	Conflict        *domain.GitConflictContext `json:"conflict,omitempty"`
}

// GitOverview reads the project's whole Git situation.
//
// It is read-only and degrades rather than failing: a project whose repository
// cannot be inspected returns Available=false with the reason, so the surface
// can explain itself instead of rendering an empty panel that looks broken.
func (s *Service) GitOverview(ctx context.Context, sessionID string) (GitOverview, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitOverview{}, err
	}
	overview := GitOverview{
		ProjectPath: item.ProjectPath,
		CommitMode:  string(s.projectCommitMode(item.ProjectPath)),
	}
	if s.isSelfEvolution(item) {
		// Self-evolution always commits; presenting a toggle that Apply would
		// then override would be a lie about what the button does.
		overview.CommitMode = string(gitsettings.CommitModeAuto)
		overview.CommitModeFixed = true
	}
	topology, err := hostrepo.Inspect(ctx, item.ProjectPath)
	if err != nil {
		overview.Unavailable = err.Error()
		return overview, nil
	}
	overview.Available = true
	overview.CurrentBranch = topology.Branch
	overview.Detached = topology.Detached
	overview.InProgress = string(topology.InProgress)
	overview.HasIdentity = hostrepo.HasCommitIdentity(ctx, item.ProjectPath)
	if branches, branchErr := hostrepo.Branches(ctx, item.ProjectPath); branchErr == nil {
		overview.Branches = branches
	}
	if remotes, remoteErr := hostrepo.Remotes(ctx, item.ProjectPath); remoteErr == nil {
		overview.Remotes = remotes
	}
	if commits, logErr := hostrepo.Log(ctx, item.ProjectPath, 50); logErr == nil {
		overview.Commits = commits
	}
	if state, stateErr := hostrepo.Working(ctx, item.ProjectPath); stateErr == nil {
		overview.Working = GitWorkingSummary{
			Clean: state.Clean(), StageableCount: len(state.Stageable),
			DirtySubmodules: state.DirtySubmodules, EmbeddedRepositories: state.EmbeddedRepositories,
			UnmergedPaths: state.Unmerged,
		}
	}
	overview.Pending = s.pendingRecordsWithoutDiffs(item.ProjectPath)
	if item.IntegrationConflict != nil && item.IntegrationConflict.Git != nil {
		overview.Conflict = item.IntegrationConflict.Git
	}
	return overview, nil
}

// pendingRecordsWithoutDiffs lists the queue with diffs stripped. A diff is up
// to 256 KB and the surface shows one at a time on demand, so including every
// diff in the list response would make the panel's own refresh the heaviest
// request in the application.
func (s *Service) pendingRecordsWithoutDiffs(projectPath string) []pendingcommit.Record {
	records, err := s.pendingCommits.List(projectPath)
	if err != nil {
		return []pendingcommit.Record{}
	}
	stripped := make([]pendingcommit.Record, 0, len(records))
	for _, record := range records {
		record.Diff = ""
		stripped = append(stripped, record)
	}
	return stripped
}

// PendingCommitDiff returns one pending record in full, diff included.
func (s *Service) PendingCommitDiff(sessionID, pendingID string) (pendingcommit.Record, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return pendingcommit.Record{}, err
	}
	records, err := s.pendingCommits.List(item.ProjectPath)
	if err != nil {
		return pendingcommit.Record{}, err
	}
	for _, record := range records {
		if record.ID == pendingID {
			return record, nil
		}
	}
	return pendingcommit.Record{}, errors.New("no such pending commit")
}
