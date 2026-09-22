package app

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/gitsettings"
	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/pendingcommit"
	"kernl.local/harness/backend/internal/projectversion"
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
func (s *Service) projectGitSettings(projectPath string) gitsettings.ProjectSettings {
	if s.gitSettingsFile == "" {
		return gitsettings.DefaultProject()
	}
	document, err := gitsettings.Read(s.gitSettingsFile)
	if err != nil {
		return gitsettings.DefaultProject()
	}
	return document.ForProject(projectPath)
}

func (s *Service) projectCommitMode(projectPath string) gitsettings.CommitMode {
	return s.projectGitSettings(projectPath).CommitMode
}
func (s *Service) projectConflictStrategy(projectPath string) gitsettings.ConflictStrategy {
	return s.projectGitSettings(projectPath).ConflictStrategy
}

func (s *Service) globalGitSettings() gitsettings.GlobalSettings {
	if s.gitSettingsFile == "" {
		return gitsettings.DefaultGlobal()
	}
	document, err := gitsettings.Read(s.gitSettingsFile)
	if err != nil {
		return gitsettings.DefaultGlobal()
	}
	return document.GlobalSettings()
}

func (s *Service) projectCommitIdentity(ctx context.Context, projectPath string) hostrepo.CommitIdentity {
	settings := s.globalGitSettings()
	configured, hasConfigured := hostrepo.ConfiguredCommitIdentity(ctx, projectPath)
	custom := hostrepo.CommitIdentity{Name: settings.CustomAuthorName, Email: settings.CustomAuthorEmail}
	switch settings.CommitAuthorStrategy {
	case gitsettings.CommitAuthorGitUser:
		if hasConfigured {
			return configured
		}
	case gitsettings.CommitAuthorCustom:
		if custom.Name != "" && custom.Email != "" {
			return custom
		}
	case gitsettings.CommitAuthorWharnexGit:
		if hasConfigured {
			return hostrepo.CommitIdentity{Name: "WHX - " + configured.Name, Email: configured.Email}
		}
	case gitsettings.CommitAuthorWharnexCustom:
		if custom.Name != "" && custom.Email != "" {
			return hostrepo.CommitIdentity{Name: "WHX - " + custom.Name, Email: custom.Email}
		}
	}
	return hostrepo.DefaultCommitIdentity()
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
	settings := document.ForProject(projectPath)
	settings.CommitMode = mode
	updated := document.WithProject(projectPath, settings)
	if err := gitsettings.Save(s.gitSettingsFile, updated); err != nil {
		return "", err
	}
	return mode, nil
}

func (s *Service) SetGitConflictStrategy(projectPath string, strategy gitsettings.ConflictStrategy) (gitsettings.ConflictStrategy, error) {
	if !gitsettings.ValidConflictStrategy(strategy) {
		return "", fmt.Errorf("unsupported conflict strategy %q", strategy)
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
	settings := document.ForProject(projectPath)
	settings.ConflictStrategy = strategy
	if err := gitsettings.Save(s.gitSettingsFile, document.WithProject(projectPath, settings)); err != nil {
		return "", err
	}
	return strategy, nil
}

func (s *Service) SetGitAuthorSettings(settings gitsettings.GlobalSettings) (gitsettings.GlobalSettings, error) {
	if !gitsettings.ValidCommitAuthorStrategy(settings.CommitAuthorStrategy) {
		return gitsettings.GlobalSettings{}, fmt.Errorf("unsupported commit author strategy %q", settings.CommitAuthorStrategy)
	}
	if (settings.CommitAuthorStrategy == gitsettings.CommitAuthorCustom || settings.CommitAuthorStrategy == gitsettings.CommitAuthorWharnexCustom) && (strings.TrimSpace(settings.CustomAuthorName) == "" || strings.TrimSpace(settings.CustomAuthorEmail) == "") {
		return gitsettings.GlobalSettings{}, errors.New("custom commit authorship requires name and email")
	}
	if s.gitSettingsFile == "" {
		return gitsettings.GlobalSettings{}, errors.New("the Git settings document is not configured")
	}
	s.gitSettingsMu.Lock()
	defer s.gitSettingsMu.Unlock()
	document, err := gitsettings.Read(s.gitSettingsFile)
	if err != nil {
		return gitsettings.GlobalSettings{}, err
	}
	updated := document.WithGlobal(settings)
	if err := gitsettings.Save(s.gitSettingsFile, updated); err != nil {
		return gitsettings.GlobalSettings{}, err
	}
	return updated.GlobalSettings(), nil
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

// GitWorkingFile is one changed worktree path shown by the Git surface.
type GitWorkingFile struct {
	Path      string `json:"path"`
	Kind      string `json:"kind"`
	Status    string `json:"status"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

// GitWorkingSummary reports both aggregate counts and the concrete paths. The
// file list is independent of commit mode: auto-commit changes can still leave
// ordinary operator edits in the worktree and those must remain inspectable.
type GitWorkingSummary struct {
	Clean                bool             `json:"clean"`
	StageableCount       int              `json:"stageable_count"`
	Files                []GitWorkingFile `json:"files"`
	DirtySubmodules      []string         `json:"dirty_submodules,omitempty"`
	EmbeddedRepositories []string         `json:"embedded_repositories,omitempty"`
	UnmergedPaths        []string         `json:"unmerged_paths,omitempty"`
}

func gitWorkingFiles(state hostrepo.WorkingState, stats ...map[string]hostrepo.DiffStat) []GitWorkingFile {
	kinds := make(map[string]string)
	for _, path := range state.Stageable {
		kinds[path] = "change"
	}
	for _, path := range state.GitlinkChanges {
		kinds[path] = "gitlink"
	}
	for _, path := range state.DirtySubmodules {
		kinds[path] = "submodule"
	}
	for _, path := range state.EmbeddedRepositories {
		kinds[path] = "embedded_repository"
	}
	for _, path := range state.Unmerged {
		kinds[path] = "unmerged"
	}
	files := make([]GitWorkingFile, 0, len(kinds))
	for path, kind := range kinds {
		status := state.Statuses[path]
		if status == "" {
			switch kind {
			case "embedded_repository":
				status = "added"
			case "unmerged":
				status = "unmerged"
			default:
				status = "modified"
			}
		}
		file := GitWorkingFile{Path: path, Kind: kind, Status: status}
		if len(stats) > 0 {
			file.Additions, file.Deletions = stats[0][path].Additions, stats[0][path].Deletions
		}
		files = append(files, file)
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return files
}

// GitHeadState is the lightweight checkout identity used by the frontend to
// notice branch changes made by Wharnex or by an external process without
// polling the considerably heavier GitOverview endpoint every second.
type GitHeadState struct {
	CurrentBranch string `json:"current_branch,omitempty"`
	Detached      bool   `json:"detached"`
	CommitSHA     string `json:"commit_sha,omitempty"`
}

// GitHead returns only the checkout identity required for live Git UI sync.
func (s *Service) GitHead(ctx context.Context, sessionID string) (GitHeadState, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitHeadState{}, err
	}
	repoRoot, _, _, err := s.gitRepositoryRoot(ctx, item.ProjectPath)
	if err != nil {
		return GitHeadState{}, err
	}
	branch := hostrepo.CurrentBranch(ctx, repoRoot)
	sha, _ := hostrepo.HeadSHA(ctx, repoRoot)
	return GitHeadState{CurrentBranch: branch, Detached: branch == "" && sha != "", CommitSHA: sha}, nil
}

// GitOverview is everything the Git surface renders in one round trip.
type GitOverview struct {
	ProjectPath      string                     `json:"project_path"`
	Repository       string                     `json:"repository"`
	Repositories     []GitRepository            `json:"repositories"`
	ProjectVersion   string                     `json:"project_version"`
	Available        bool                       `json:"available"`
	Unavailable      string                     `json:"unavailable,omitempty"`
	CommitMode       string                     `json:"commit_mode"`
	ConflictStrategy string                     `json:"conflict_strategy"`
	AuthorSettings   gitsettings.GlobalSettings `json:"author_settings"`
	CommitModeFixed  bool                       `json:"commit_mode_fixed,omitempty"`
	CurrentBranch    string                     `json:"current_branch,omitempty"`
	Detached         bool                       `json:"detached"`
	InProgress       string                     `json:"in_progress,omitempty"`
	HasIdentity      bool                       `json:"has_identity"`
	Branches         []hostrepo.Branch          `json:"branches"`
	Remotes          []hostrepo.Remote          `json:"remotes"`
	Tags             []hostrepo.Tag             `json:"tags"`
	Commits          []hostrepo.Commit          `json:"commits"`
	Pending          []pendingcommit.Record     `json:"pending"`
	Working          GitWorkingSummary          `json:"working"`
	Conflict         *domain.GitConflictContext `json:"conflict,omitempty"`
}

// GitOverview reads the project's whole Git situation.
type GitFileDiff struct {
	Path      string `json:"path"`
	Diff      string `json:"diff"`
	Truncated bool   `json:"truncated,omitempty"`
}

// GitFileDiff returns a bounded, read-only diff for one path that Git itself
// currently reports as changed. Matching against WorkingState avoids accepting
// arbitrary path input while still allowing deleted and untracked files, which
// an editor-style read guard cannot open.
func (s *Service) GitFileDiff(ctx context.Context, sessionID, path string) (GitFileDiff, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitFileDiff{}, err
	}
	repoRoot, _, _, err := s.gitRepositoryRoot(ctx, item.ProjectPath)
	if err != nil {
		return GitFileDiff{}, err
	}
	path = strings.TrimSpace(path)
	state, err := hostrepo.Working(ctx, repoRoot)
	if err != nil {
		return GitFileDiff{}, err
	}
	var file *GitWorkingFile
	for _, candidate := range gitWorkingFiles(state) {
		if candidate.Path == path {
			current := candidate
			file = &current
			break
		}
	}
	if file == nil {
		return GitFileDiff{}, fmt.Errorf("path is not a changed worktree file")
	}
	if file.Kind == "submodule" || file.Kind == "embedded_repository" {
		return GitFileDiff{}, fmt.Errorf("inline diff is unavailable for %s", file.Kind)
	}
	diff, truncated, err := hostrepo.WorktreeDiff(ctx, repoRoot, []string{file.Path}, 512<<10)
	if err != nil {
		return GitFileDiff{}, err
	}
	return GitFileDiff{Path: file.Path, Diff: diff, Truncated: truncated}, nil
}

// GitOverview is read-only and degrades rather than failing: a project whose
// repository cannot be inspected returns Available=false with the reason, so
// the surface can explain itself instead of rendering an empty panel.
func (s *Service) GitOverview(ctx context.Context, sessionID string) (GitOverview, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitOverview{}, err
	}
	projectSettings := s.projectGitSettings(item.ProjectPath)
	overview := GitOverview{
		ProjectPath:      item.ProjectPath,
		CommitMode:       string(projectSettings.CommitMode),
		ConflictStrategy: string(projectSettings.ConflictStrategy),
		AuthorSettings:   s.globalGitSettings(),
	}
	repoRoot, repoPath, repositories, repositoryErr := s.gitRepositoryRoot(ctx, item.ProjectPath)
	overview.Repository = repoPath
	overview.Repositories = repositories
	if repositoryErr != nil {
		overview.Unavailable = repositoryErr.Error()
		return overview, nil
	}
	if version, _, versionErr := projectversion.Ensure(item.ProjectPath); versionErr == nil {
		overview.ProjectVersion = version
	}
	if s.isSelfEvolution(item) {
		// Self-evolution always commits; presenting a toggle that Apply would
		// then override would be a lie about what the button does.
		overview.CommitMode = string(gitsettings.CommitModeAuto)
		overview.CommitModeFixed = true
	}
	topology, err := hostrepo.Inspect(ctx, repoRoot)
	if err != nil {
		overview.Unavailable = err.Error()
		return overview, nil
	}
	overview.Available = true
	overview.CurrentBranch = topology.Branch
	overview.Detached = topology.Detached
	overview.InProgress = string(topology.InProgress)
	overview.HasIdentity = hostrepo.HasCommitIdentity(ctx, repoRoot)
	if branches, branchErr := hostrepo.Branches(ctx, repoRoot); branchErr == nil {
		overview.Branches = branches
	}
	if remotes, remoteErr := hostrepo.Remotes(ctx, repoRoot); remoteErr == nil {
		overview.Remotes = remotes
	}
	if tags, tagErr := hostrepo.Tags(ctx, repoRoot, 50); tagErr == nil {
		overview.Tags = tags
	}
	if commits, logErr := hostrepo.Log(ctx, repoRoot, 50); logErr == nil {
		overview.Commits = commits
	}
	if state, stateErr := hostrepo.Working(ctx, repoRoot); stateErr == nil {
		overview.Working = GitWorkingSummary{
			Clean: state.Clean(), StageableCount: len(state.Stageable), Files: gitWorkingFiles(state, hostrepo.WorktreeStats(ctx, repoRoot)),
			DirtySubmodules: state.DirtySubmodules, EmbeddedRepositories: state.EmbeddedRepositories,
			UnmergedPaths: state.Unmerged,
		}
	}
	if repoPath == "" {
		overview.Pending = s.pendingRecordsWithoutDiffs(item.ProjectPath)
	}
	if repoPath == "" && item.IntegrationConflict != nil && item.IntegrationConflict.Git != nil {
		overview.Conflict = item.IntegrationConflict.Git
	}
	return overview, nil
}

// GitUnpushedOverview is the current local branch's commits that are not yet
// published according to its valid upstream or, when none exists, any local
// remote-tracking ref. Commits are newest first like the other history APIs.
type GitUnpushedOverview struct {
	Branch       string            `json:"branch"`
	Upstream     string            `json:"upstream,omitempty"`
	Remote       string            `json:"remote,omitempty"`
	RemoteBranch string            `json:"remote_branch,omitempty"`
	HasUpstream  bool              `json:"has_upstream"`
	Commits      []hostrepo.Commit `json:"commits"`
}

// GitCommitDetail combines one unpushed commit's metadata with its bounded
// unified diff for the detail panel.
type GitCommitDetail struct {
	Commit        hostrepo.Commit `json:"commit"`
	Diff          string          `json:"diff"`
	DiffTruncated bool            `json:"diff_truncated,omitempty"`
}

func currentLocalBranch(branches []hostrepo.Branch) (hostrepo.Branch, bool) {
	for _, branch := range branches {
		if branch.Remote == "" && branch.Current {
			return branch, true
		}
	}
	return hostrepo.Branch{}, false
}

func splitUpstream(upstream string) (string, string) {
	remote, branch, ok := strings.Cut(strings.TrimSpace(upstream), "/")
	if !ok {
		return "", ""
	}
	return remote, branch
}

// GitUnpushed returns commits that are provably unpublished. A valid upstream
// is the primary comparison. Without one, the hostrepo layer falls back to
// commits reachable from HEAD but from no remote-tracking ref, which keeps the
// list useful without inventing a destination branch for selective push.
func (s *Service) GitUnpushed(ctx context.Context, sessionID string) (GitUnpushedOverview, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitUnpushedOverview{}, err
	}
	repoRoot, _, _, err := s.gitRepositoryRoot(ctx, item.ProjectPath)
	if err != nil {
		return GitUnpushedOverview{}, err
	}
	branches, err := hostrepo.Branches(ctx, repoRoot)
	if err != nil {
		return GitUnpushedOverview{}, err
	}
	active, ok := currentLocalBranch(branches)
	if !ok {
		return GitUnpushedOverview{Commits: []hostrepo.Commit{}}, nil
	}
	hasUpstream := active.HasUpstream && !active.Gone
	overview := GitUnpushedOverview{Branch: active.Name, Upstream: active.Upstream, HasUpstream: hasUpstream, Commits: []hostrepo.Commit{}}
	limit := 50
	if hasUpstream {
		overview.Remote, overview.RemoteBranch = splitUpstream(active.Upstream)
		if active.Ahead <= 0 {
			return overview, nil
		}
		limit = active.Ahead
	}
	commits, err := hostrepo.Unpushed(ctx, repoRoot, limit)
	if err != nil {
		return GitUnpushedOverview{}, err
	}
	overview.Commits = commits
	return overview, nil
}

// GitUnpushedCommit returns detail only for a commit that is currently in the
// unpushed set, so arbitrary historical SHAs cannot be used as a generic Git
// object reader through this endpoint.
func (s *Service) GitUnpushedCommit(ctx context.Context, sessionID, sha string) (GitCommitDetail, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitCommitDetail{}, err
	}
	repoRoot, _, _, err := s.gitRepositoryRoot(ctx, item.ProjectPath)
	if err != nil {
		return GitCommitDetail{}, err
	}
	overview, err := s.GitUnpushed(ctx, sessionID)
	if err != nil {
		return GitCommitDetail{}, err
	}
	for _, commit := range overview.Commits {
		if commit.SHA != strings.TrimSpace(sha) {
			continue
		}
		diff, truncated, diffErr := hostrepo.CommitDiff(ctx, repoRoot, commit.SHA, 512<<10)
		if diffErr != nil {
			return GitCommitDetail{}, diffErr
		}
		return GitCommitDetail{Commit: commit, Diff: diff, DiffTruncated: truncated}, nil
	}
	return GitCommitDetail{}, errors.New("commit is not pending publication")
}

// GitHistory returns a graph-ready commit timeline for selected branch refs or
// all refs. Only branch names reported by this repository are accepted.
func (s *Service) GitHistory(ctx context.Context, sessionID string, refs []string, all bool) ([]hostrepo.Commit, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return nil, err
	}
	repoRoot, _, _, err := s.gitRepositoryRoot(ctx, item.ProjectPath)
	if err != nil {
		return nil, err
	}
	if all {
		return hostrepo.LogRefs(ctx, repoRoot, nil, true, 200)
	}
	branches, err := hostrepo.Branches(ctx, repoRoot)
	if err != nil {
		return nil, err
	}
	allowed := make(map[string]bool, len(branches))
	for _, branch := range branches {
		allowed[branch.Name] = true
	}
	selected := make([]string, 0, len(refs))
	seen := map[string]bool{}
	for _, ref := range refs {
		ref = strings.TrimSpace(ref)
		if ref == "" || seen[ref] {
			continue
		}
		if !allowed[ref] {
			return nil, fmt.Errorf("unknown branch %q", ref)
		}
		seen[ref] = true
		selected = append(selected, ref)
		if len(selected) >= 32 {
			break
		}
	}
	if len(selected) == 0 {
		return hostrepo.Log(ctx, repoRoot, 50)
	}
	return hostrepo.LogRefs(ctx, repoRoot, selected, false, 200)
}

type GitHistoryPage struct {
	Commits    []hostrepo.Commit `json:"commits"`
	NextOffset int               `json:"next_offset"`
	HasMore    bool              `json:"has_more"`
}

func (s *Service) GitHistoryPage(ctx context.Context, sessionID string, refs []string, all bool, limit, offset int) (GitHistoryPage, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitHistoryPage{}, err
	}
	repoRoot, _, _, err := s.gitRepositoryRoot(ctx, item.ProjectPath)
	if err != nil {
		return GitHistoryPage{}, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	selected, err := s.validHistoryRefs(ctx, repoRoot, refs, all)
	if err != nil {
		return GitHistoryPage{}, err
	}
	commits, err := hostrepo.LogRefsPage(ctx, repoRoot, selected, all, limit+1, offset)
	if err != nil {
		return GitHistoryPage{}, err
	}
	hasMore := len(commits) > limit
	if hasMore {
		commits = commits[:limit]
	}
	return GitHistoryPage{Commits: commits, NextOffset: offset + len(commits), HasMore: hasMore}, nil
}

func (s *Service) validHistoryRefs(ctx context.Context, projectPath string, refs []string, all bool) ([]string, error) {
	if all {
		return nil, nil
	}
	branches, err := hostrepo.Branches(ctx, projectPath)
	if err != nil {
		return nil, err
	}
	allowed := map[string]bool{}
	for _, branch := range branches {
		allowed[branch.Name] = true
	}
	selected := []string{}
	seen := map[string]bool{}
	for _, ref := range refs {
		ref = strings.TrimSpace(ref)
		if ref == "" || seen[ref] {
			continue
		}
		if !allowed[ref] {
			return nil, fmt.Errorf("unknown branch %q", ref)
		}
		seen[ref] = true
		selected = append(selected, ref)
		if len(selected) >= 32 {
			break
		}
	}
	return selected, nil
}

func (s *Service) GitHistoryCommit(ctx context.Context, sessionID, sha string) (GitCommitDetail, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return GitCommitDetail{}, err
	}
	repoRoot, _, _, err := s.gitRepositoryRoot(ctx, item.ProjectPath)
	if err != nil {
		return GitCommitDetail{}, err
	}
	commit, err := hostrepo.CommitBySHA(ctx, repoRoot, sha)
	if err != nil {
		return GitCommitDetail{}, err
	}
	diff, truncated, err := hostrepo.CommitDiff(ctx, repoRoot, commit.SHA, 512<<10)
	if err != nil {
		return GitCommitDetail{}, err
	}
	return GitCommitDetail{Commit: commit, Diff: diff, DiffTruncated: truncated}, nil
}

func (s *Service) GitMergeCandidates(ctx context.Context, sessionID, targetRef string) ([]hostrepo.Branch, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return nil, err
	}
	repoRoot, _, _, err := s.gitRepositoryRoot(ctx, item.ProjectPath)
	if err != nil {
		return nil, err
	}
	return hostrepo.MergeCandidates(ctx, repoRoot, targetRef)
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
