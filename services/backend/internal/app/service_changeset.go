package app

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/changeset"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/protocol"
	"kernl.local/harness/backend/internal/sandbox"
)

func canReconcilePlanFromArchive(item domain.Session, plan *domain.ExecutionPlan) bool {
	if plan == nil || len(actualPatchFiles(plan)) == 0 {
		return false
	}
	archive := requestContextArchive(item, plan.RequestID)
	if archive == "" {
		return false
	}
	info, err := os.Stat(archive)
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	reader, err := zip.OpenReader(archive)
	if err != nil {
		return false
	}
	defer reader.Close()
	entries := make(map[string]bool, len(reader.File))
	for _, entry := range reader.File {
		if !entry.FileInfo().IsDir() {
			entries[filepath.ToSlash(strings.TrimPrefix(entry.Name, "./"))] = true
		}
	}
	required := append(actualPatchFiles(plan), plan.ReadFiles...)
	required = append(required, plan.BarrierFiles...)
	// A file the patch CREATES cannot be in the archive: the archive is the
	// project as it stood when the request was planned, and the file did not
	// exist then. Demanding it made reconciliation structurally impossible for
	// every change that adds a file, which then fell through to the legacy
	// rebase that retargets the plan onto a tree it was not authored against —
	// the dead end adr/ADR-0035 forbids — or, for a command-bearing plan, threw
	// the whole verified bundle away at ingestion (see adr/ADR-0045).
	created := make(map[string]bool)
	for _, path := range planCreatedFiles(plan) {
		created[path] = true
	}
	for _, path := range normalizedPaths(required) {
		if entries[path] || created[path] {
			continue
		}
		return false
	}
	return true
}

func executionBase(item domain.Session, plan *domain.ExecutionPlan, stale bool) (string, func(), error) {
	if !stale {
		return item.ProjectPath, func() {}, nil
	}
	archive := requestContextArchive(item, plan.RequestID)
	if archive == "" {
		return "", func() {}, errors.New("immutable request base is unavailable")
	}
	root, cleanup, err := changeset.ExtractArchive(archive)
	if err != nil {
		return "", func() {}, err
	}
	if err := sandbox.HydrateMissingProjectFilesExcept(root, item.ProjectPath, planCreatedFiles(plan)); err != nil {
		cleanup()
		return "", func() {}, fmt.Errorf("hydrate immutable request base: %w", err)
	}
	return root, cleanup, nil
}

// bindExecutionDependencySource points dependency resolution at the real
// project when the executed tree came from an extracted immutable base, so the
// Go module root is located in the project rather than in the extraction.
//
// It is NOT sufficient on its own, and believing otherwise cost three separate
// chats a dependency stall. The private module cache key is derived inside
// Prepare, before this runs, so rewriting SourcePath afterwards left the key
// already computed from the temporary directory. Preparation therefore has to
// be told the canonical project up front — see sandbox.PrepareExecutionWorkspace
// and adr/ADR-0045 — and this function keeps only its original narrower job.
func bindExecutionDependencySource(workspace *sandbox.Workspace, item domain.Session, restoredBase bool) {
	if restoredBase && workspace != nil {
		workspace.SourcePath = item.ProjectPath
	}
}

type pendingChangeSetReplayConflict struct {
	changeSetID string
	conflicts   []domain.IntegrationConflictDetail
}

func (e *pendingChangeSetReplayConflict) Error() string {
	return fmt.Sprintf("replay pending ChangeSet %s conflicts at %s", e.changeSetID, strings.Join(conflictPaths(e.conflicts), ", "))
}

// pendingIntegrationReplayConflict is the Git-based counterpart of
// pendingChangeSetReplayConflict: a real merge conflict hit while replaying
// an earlier pending candidate's branch into a NEW verification sandbox.
// workspacePath carries where that conflict's SHAs/branch actually resolve
// — the sandbox, not the host — since failExecution has no other way to
// reach it (it is not otherwise passed a workspace).
type pendingIntegrationReplayConflict struct {
	workspacePath string
	conflict      *sandbox.MergeConflictError
}

func (e *pendingIntegrationReplayConflict) Error() string { return e.conflict.Error() }
func (e *pendingIntegrationReplayConflict) Unwrap() error { return e.conflict }

// replayPendingChangeSets rebuilds this session's already-verified, not yet
// applied candidates inside a fresh verification sandbox so the new plan is
// verified on top of them.
//
// sharedHostAncestry says whether the workspace is a real clone of the host
// (the normal case) or was rebuilt from an immutable archived request base. An
// archive-based workspace has a synthetic root commit and NO ancestor in
// common with the host, so a pending candidate's integration branch cannot be
// merged into it: git refuses with "refusing to merge unrelated histories",
// which stranded a real session in a repair loop that could never succeed.
// Without shared ancestry the candidate is replayed as its own commit diff
// instead — same content, no common ancestor required.
func (s *Service) replayPendingChangeSets(ctx context.Context, sessionID, hostProjectPath string, runner sandbox.Runner, workspace sandbox.Workspace, pending []domain.PendingHostChange, skipPlanID string, sharedHostAncestry bool, result *domain.ExecutionResult) error {
	for index := range pending {
		change := pending[index]
		if change.Plan.PlanID == skipPlanID {
			continue
		}
		if change.ChangeSet != nil {
			prepared, err := changeset.Prepare(workspace.Path, []domain.ChangeSet{*change.ChangeSet})
			if err != nil {
				return fmt.Errorf("replay pending ChangeSet %s: %w", change.ChangeSet.ID, err)
			}
			if prepared.Outcome == domain.IntegrationConflict {
				return &pendingChangeSetReplayConflict{changeSetID: change.ChangeSet.ID, conflicts: append([]domain.IntegrationConflictDetail(nil), prepared.Conflicts...)}
			}
			if err := changeset.ApplyToWorkspace(workspace.Path, prepared); err != nil {
				return fmt.Errorf("replay pending ChangeSet %s: %w", change.ChangeSet.ID, err)
			}
			s.bus.Publish(sessionID, "changeset.replayed", map[string]any{"changeset_id": change.ChangeSet.ID, "target": "sandbox-pending", "files": changeSetPaths(*change.ChangeSet)})
			continue
		}
		if change.IntegrationBranch != "" && !sharedHostAncestry {
			// No common ancestor exists between this workspace and the host,
			// so a merge is impossible by construction. Replay the candidate's
			// verified commit as a plain diff through the normal patch
			// strategy (which already falls back to --3way/--recount). This
			// keeps the same content without pretending the two histories are
			// related.
			if err := s.replayIntegrationCommitAsPatch(ctx, sessionID, hostProjectPath, runner, workspace, change, result); err != nil {
				return err
			}
			continue
		}
		if change.IntegrationBranch != "" {
			// The earlier candidate's branch was already pushed into the
			// host's own .git at its own verification time. Fetching it
			// explicitly by path (rather than relying on the clone's own
			// "origin" remote-tracking ref, which configureSandboxGitRemotes
			// may have already deleted by reconciling remotes to mirror the
			// real project) and merging it — a real commit, not a raw
			// overlay — is what lets THIS candidate's own commit, made
			// later in this same verification round, correctly descend
			// from it: a plain `git apply` of the raw patch text (as the
			// fallback below does for a legacy candidate) would leave this
			// candidate's branch rooted at the original clone point, and
			// merging both branches into host afterwards would then look
			// like two independent edits to the same line — a spurious
			// conflict, not the clean sequential build this actually is.
			if fetchErr := sandbox.FetchBranchFromHost(ctx, workspace.Path, hostProjectPath, change.IntegrationBranch); fetchErr != nil {
				return fmt.Errorf("fetch pending integration branch %s: %w", change.IntegrationBranch, fetchErr)
			}
			if _, mergeErr := sandbox.MergeBranchOnHost(ctx, workspace.Path, change.IntegrationBranch); mergeErr != nil {
				var conflict *sandbox.MergeConflictError
				if errors.As(mergeErr, &conflict) {
					return &pendingIntegrationReplayConflict{workspacePath: workspace.Path, conflict: conflict}
				}
				return fmt.Errorf("replay pending integration branch %s: %w", change.IntegrationBranch, mergeErr)
			}
			s.bus.Publish(sessionID, "integration.branch_replayed", map[string]any{"branch": change.IntegrationBranch, "plan_id": change.Plan.PlanID, "target": "sandbox-pending"})
			continue
		}
		if err := s.replayPlanPatches(ctx, runner, workspace, change, result); err != nil {
			return err
		}
	}
	return nil
}

func materializePlanChangeSet(plan domain.ExecutionPlan, baseRoot, resultRoot string) (*domain.ChangeSet, error) {
	paths := actualPatchFiles(&plan)
	if len(paths) == 0 {
		return nil, nil
	}
	set, err := changeset.Materialize(ids.New("chg"), plan.BaseContextSHA256, baseRoot, resultRoot, paths)
	if err != nil {
		return nil, err
	}
	// Compatibility runners used by embedders may verify a patch without
	// exposing a mutated filesystem. Retain the legacy patch path in that case.
	if len(set.Mutations) == 0 {
		return nil, nil
	}
	set.ReadFiles = append([]string(nil), plan.ReadFiles...)
	set.BarrierFiles = append([]string(nil), plan.BarrierFiles...)
	set.ReadHashes, err = changeset.FileHashes(baseRoot, plan.ReadFiles)
	if err != nil {
		return nil, err
	}
	set.BarrierHashes, err = changeset.FileHashes(baseRoot, plan.BarrierFiles)
	if err != nil {
		return nil, err
	}
	set.State = domain.IntegrationVerified
	set.CreatedAt = time.Now().UTC()
	return &set, nil
}

type stagedHostIntegration struct {
	workspace sandbox.Workspace
	prepared  changeset.Prepared
	pending   []domain.PendingHostChange
}

func (s *Service) stageHostIntegration(ctx context.Context, sessionID string, item domain.Session, pending []domain.PendingHostChange) (stagedHostIntegration, error) {
	sets := make([]domain.ChangeSet, 0, len(pending))
	for index := range pending {
		if pending[index].ChangeSet == nil {
			return stagedHostIntegration{}, errors.New("legacy pending candidate requires patch compatibility path")
		}
		sets = append(sets, *pending[index].ChangeSet)
	}
	workspace, err := s.runner.Prepare(ctx, item.ProjectPath)
	if err != nil {
		return stagedHostIntegration{}, err
	}
	prepared, err := changeset.Prepare(workspace.Path, sets)
	if err != nil {
		_ = s.runner.Cleanup(workspace)
		return stagedHostIntegration{}, err
	}
	publishReconciliationEvidence(s.bus, sessionID, prepared.Reconciliations)
	if prepared.Outcome == domain.IntegrationConflict {
		_ = s.runner.Cleanup(workspace)
		return stagedHostIntegration{prepared: prepared}, nil
	}
	// A persisted ChangeSet predates Git-native integration. Rebuild its
	// ordered candidate chain inside this isolated clone and promote every
	// effective change to the same whx/<request_id> branch contract new plans
	// use. Applying the aggregate directly to the host used to bypass both Auto
	// commits and Manual pending-commit records entirely.
	converted := append([]domain.PendingHostChange(nil), pending...)
	for index := range converted {
		set := converted[index].ChangeSet
		if set == nil {
			_ = s.runner.Cleanup(workspace)
			return stagedHostIntegration{}, errors.New("legacy pending candidate requires a ChangeSet")
		}
		candidate, candidateErr := changeset.Prepare(workspace.Path, []domain.ChangeSet{*set})
		if candidateErr != nil {
			_ = s.runner.Cleanup(workspace)
			return stagedHostIntegration{}, candidateErr
		}
		if candidate.Outcome == domain.IntegrationConflict {
			_ = s.runner.Cleanup(workspace)
			return stagedHostIntegration{prepared: candidate}, nil
		}
		if candidateErr = changeset.ApplyToWorkspace(workspace.Path, candidate); candidateErr != nil {
			_ = s.runner.Cleanup(workspace)
			return stagedHostIntegration{}, candidateErr
		}
		paths := actualPatchFiles(&converted[index].Plan)
		if len(paths) == 0 {
			continue
		}
		branch := integrationBranchName(converted[index].Plan.RequestID)
		var commit string
		var commitErr error
		if len(candidate.Writes) == 0 {
			commit, commitErr = sandbox.CommitVerifiedPatchAllowEmpty(ctx, workspace.Path, branch, commitMessageForPlan(&converted[index].Plan), paths)
		} else {
			commit, commitErr = sandbox.CommitVerifiedPatch(ctx, workspace.Path, branch, commitMessageForPlan(&converted[index].Plan), paths)
		}
		if commitErr != nil {
			_ = s.runner.Cleanup(workspace)
			return stagedHostIntegration{}, fmt.Errorf("commit legacy ChangeSet %s to integration branch: %w", set.ID, commitErr)
		}
		converted[index].IntegrationBranch = branch
		converted[index].IntegrationCommit = commit
		converted[index].ChangeSet = nil
	}
	if len(prepared.SemanticFiles) > 0 || len(prepared.BarrierFiles) > 0 {
		s.bus.Publish(sessionID, "integration.semantic_recheck", map[string]any{"read_files": prepared.SemanticFiles, "barrier_files": prepared.BarrierFiles})
	}
	var baselineWorkspace *sandbox.Workspace
	defer func() {
		if baselineWorkspace != nil {
			_ = s.runner.Cleanup(*baselineWorkspace)
		}
	}()
	// Every pending candidate is verified against the SAME merged workspace,
	// so two candidates declaring the same gate (typically `npm run lint`,
	// `npm run typecheck` and `npm run build`, which nearly every frontend
	// plan repeats) would run it once per candidate for an identical tree
	// and an identical result. Observed in production: three queued
	// candidates turned one integration pass into ~12 command runs and
	// ~2.5 minutes of duplicated work, repeated again on every Apply retry.
	// Deduplicate on the command identity (argv + cwd); the first candidate
	// that declares a gate owns it, which keeps the baseline comparison
	// below anchored to the smallest — most conservative — prefix.
	for _, run := range dedupedIntegrationVerifications(pending) {
		index, command := run.index, run.command
		s.bus.Publish(sessionID, "integration.verification_started", map[string]any{"plan_id": pending[index].Plan.PlanID, "argv": command.Argv})
		result, runErr := s.runCommandWithRunner(ctx, sessionID, s.runner, workspace, command, "integration-sandbox")
		if runErr != nil {
			_ = s.runner.Cleanup(workspace)
			return stagedHostIntegration{}, runErr
		}
		if result.Success {
			continue
		}
		baselineResult, unchanged, baselineErr := s.compareVerificationBaseline(ctx, s.runner, &baselineWorkspace, item.ProjectPath, pending[:index], command, result)
		if baselineErr == nil && unchanged {
			s.bus.Publish(sessionID, "integration.verification_baseline_unchanged", map[string]any{
				"plan_id": pending[index].Plan.PlanID, "argv": command.Argv,
				"exit_code": baselineResult.ExitCode, "diagnostic": commandResultDiagnostic(baselineResult),
			})
			continue
		}
		if baselineErr != nil {
			s.bus.Publish(sessionID, "integration.verification_baseline_compare_failed", map[string]any{"plan_id": pending[index].Plan.PlanID, "argv": command.Argv, "error": baselineErr.Error()})
		}
		_ = s.runner.Cleanup(workspace)
		return stagedHostIntegration{}, fmt.Errorf("integration verification failed for plan %s: %s", pending[index].Plan.PlanID, commandResultDiagnostic(result))
	}
	// Only a fully verified chain may publish refs into the host repository.
	// ApplyToHost already holds the per-project integration lock, so these
	// local-only pushes cannot race another Wharnex Apply.
	for index := range converted {
		if converted[index].IntegrationBranch == "" {
			continue
		}
		if err := sandbox.PushBranchToHost(ctx, workspace.Path, item.ProjectPath, converted[index].IntegrationBranch); err != nil {
			_ = s.runner.Cleanup(workspace)
			return stagedHostIntegration{}, fmt.Errorf("publish promoted legacy candidate: %w", err)
		}
		s.bus.Publish(sessionID, "integration.branch_committed", map[string]any{
			"plan_id": converted[index].Plan.PlanID, "branch": converted[index].IntegrationBranch,
			"commit": converted[index].IntegrationCommit, "source": "legacy_changeset",
		})
	}
	return stagedHostIntegration{workspace: workspace, prepared: prepared, pending: converted}, nil
}

// integrationVerification is one gate to run against the merged integration
// workspace, together with the index of the pending candidate that owns it.
type integrationVerification struct {
	index   int
	command domain.CommandSpec
}

// dedupedIntegrationVerifications flattens every pending candidate's
// verification gates into the set that actually has to run, keeping the
// first candidate that declared each one. Identity is argv + cwd: a gate is
// the same gate regardless of the timeout or exit-code envelope a later
// plan happened to write for it, and it runs against one shared workspace.
func dedupedIntegrationVerifications(pending []domain.PendingHostChange) []integrationVerification {
	runs := make([]integrationVerification, 0)
	seen := make(map[string]struct{})
	for index := range pending {
		for _, command := range pending[index].Plan.Verification {
			key := strings.Join(append([]string{strings.TrimSpace(command.Cwd)}, command.Argv...), "\x00")
			if _, duplicate := seen[key]; duplicate {
				continue
			}
			seen[key] = struct{}{}
			runs = append(runs, integrationVerification{index: index, command: command})
		}
	}
	return runs
}

func allPendingHaveChangeSets(pending []domain.PendingHostChange) bool {
	if len(pending) == 0 {
		return false
	}
	for index := range pending {
		if pending[index].ChangeSet == nil {
			return false
		}
	}
	return true
}

func conflictPaths(conflicts []domain.IntegrationConflictDetail) []string {
	paths := make([]string, 0, len(conflicts))
	for _, conflict := range conflicts {
		paths = append(paths, conflict.Path)
	}
	return normalizedPaths(paths)
}

func changeSetPaths(set domain.ChangeSet) []string {
	paths := make([]string, 0, len(set.Mutations))
	for _, mutation := range set.Mutations {
		paths = append(paths, mutation.Path)
	}
	return normalizedPaths(paths)
}

type conflictCapsule struct {
	Protocol        string   `json:"protocol"`
	ConflictID      string   `json:"conflict_id"`
	CurrentRevision string   `json:"current_revision"`
	OriginalPlanIDs []string `json:"original_plan_ids"`
	// Intent carries why each side of the collision exists. Three versions of
	// a file say what differs; only intent says which reconciliation is
	// correct, so a resolver without it can do no better than guess textually.
	Intent *conflictCapsuleIntent `json:"intent,omitempty"`
	// Origin says what produced this conflict, so a resolver knows which
	// reconciliation it is being asked for instead of inferring it from the
	// file contents. Absent means the historical case, an integration
	// conflict between a verified candidate and the host.
	Origin string `json:"origin,omitempty"`
	// Git is present when the conflict came from a host Git operation the
	// operator started — a push that had to integrate the remote first, or an
	// explicit branch merge — and names the exact merge being reconciled.
	Git   *conflictCapsuleGit   `json:"git,omitempty"`
	Files []conflictCapsuleFile `json:"files"`
}

// conflictCapsuleGit names the merge a Git-origin conflict is reconciling.
type conflictCapsuleGit struct {
	Ref          string `json:"ref"`
	TargetBranch string `json:"target_branch,omitempty"`
	Remote       string `json:"remote,omitempty"`
	BaseSHA      string `json:"base_sha"`
	OursSHA      string `json:"ours_sha"`
	TheirsSHA    string `json:"theirs_sha"`
}

// conflictCapsuleIntent describes the purpose of both colliding sides and how
// many times this same conflict has already been attempted.
type conflictCapsuleIntent struct {
	// OurGoal is the colliding candidate's own planner-authored purpose.
	OurGoal string `json:"our_goal,omitempty"`
	// OurCommitMessage is the Conventional Commits subject the plan declared.
	OurCommitMessage string `json:"our_commit_message,omitempty"`
	// IncomingChanges are the already-integrated changes this candidate
	// collides with, newest first, each stating its own purpose.
	IncomingChanges []conflictCapsuleChange `json:"incoming_changes,omitempty"`
	// Attempt/MaxAttempts make the remaining budget explicit so the resolver
	// can tell a first attempt from the last one and choose a decisively
	// simpler reconciliation rather than repeating a strategy that has already
	// failed. Exhausting the budget stops automatic resolution.
	Attempt     int `json:"attempt"`
	MaxAttempts int `json:"max_attempts"`
	// PreviousAttempts records what earlier rounds of THIS conflict already
	// tried, so the resolver can see it is circling rather than converging.
	PreviousAttempts []string `json:"previous_attempts,omitempty"`
}

type conflictCapsuleChange struct {
	Commit  string `json:"commit"`
	Purpose string `json:"purpose"`
}

type conflictCapsuleFile struct {
	Path          string `json:"path"`
	Reason        string `json:"reason"`
	BaseExists    bool   `json:"base_exists"`
	CurrentExists bool   `json:"current_exists"`
	ResultExists  bool   `json:"result_exists"`
	BaseSHA256    string `json:"base_sha256"`
	CurrentSHA256 string `json:"current_sha256"`
	ResultSHA256  string `json:"result_sha256"`
	Base          string `json:"base"`
	Current       string `json:"current"`
	Result        string `json:"result"`
}

func (s *Service) prepareConflictResolution(ctx context.Context, sessionID string, item domain.Session, pending []domain.PendingHostChange, conflicts []domain.IntegrationConflictDetail) (domain.Session, error) {
	requestID := ids.New("req")
	conflictID := ids.New("conflict")
	continuing := item.IntegrationConflict != nil && strings.TrimSpace(item.IntegrationConflict.ID) != ""
	if continuing {
		conflictID = item.IntegrationConflict.ID
	}
	paths := conflictPaths(conflicts)

	// Same rule as the Git-native merge path: a planner may not patch
	// Wharnex-managed project state, so a conflict there can never be resolved
	// by a focused-resolution bundle and must not be sent to one.
	managed, resolvable := partitionManagedConflictPaths(paths)
	if len(managed) > 0 {
		s.bus.Publish(sessionID, "integration.conflict_managed_paths", map[string]any{
			"paths": managed, "reason": "Wharnex-managed project state is reconciled locally, never by a planner patch",
		})
	}
	if len(resolvable) == 0 {
		return s.failManagedOnlyConflict(sessionID, item, conflictID, managed)
	}
	paths = resolvable

	// The escalation decision is recorded before the prompt is built so the
	// operator can see why a round was or was not spent, whichever way it
	// went. Only an exhausted effort budget or a collision no patch can
	// express stops the engine here; everything else is dispatched by Wharnex
	// itself without waiting for a confirmation.
	escalation := classifyIntegrationEscalation(item, conflicts)
	s.bus.Publish(sessionID, "integration.escalation_decided", map[string]any{
		"conflict_id": conflictID, "automatic": escalation.Automatic,
		"reason": escalation.Reason, "complexity": string(escalation.Complexity), "paths": paths,
	})
	if conflictResolutionExhausted(item) {
		return s.exhaustConflictResolution(sessionID, item, conflictID, paths)
	}

	planIDs := make([]string, 0)
	files := make([]conflictCapsuleFile, 0, len(conflicts))
	for _, conflict := range conflicts {
		planIDs = append(planIDs, planIDForChangeSet(pending, conflict.ChangeSetID))
		mutation, ok := mutationForConflict(pending, conflict.ChangeSetID, conflict.Path)
		if !ok {
			continue
		}
		current, readErr := os.ReadFile(filepath.Join(item.ProjectPath, filepath.FromSlash(conflict.Path)))
		currentExists := readErr == nil
		if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
			return item, fmt.Errorf("read current conflict path %s: %w", conflict.Path, readErr)
		}
		files = append(files, conflictCapsuleFile{
			Path: conflict.Path, Reason: conflict.Reason, BaseExists: mutation.BaseExists, CurrentExists: currentExists, ResultExists: mutation.ResultExists,
			BaseSHA256: mutation.BaseSHA256, CurrentSHA256: hashBytes(current), ResultSHA256: mutation.ResultSHA256,
			Base: truncateRepairText(mutation.BaseContent, 24000), Current: truncateRepairText(string(current), 24000), Result: truncateRepairText(mutation.ResultContent, 24000),
		})
	}
	planIDs = normalizedStrings(planIDs)
	capsule := conflictCapsule{Protocol: "harness.conflict/v1", ConflictID: conflictID, CurrentRevision: item.Context.Manifest.SHA256, OriginalPlanIDs: planIDs, Files: files}
	capsuleJSON, err := json.MarshalIndent(capsule, "", "  ")
	if err != nil {
		return item, err
	}
	message := buildConflictResolutionMessage(capsuleJSON, paths, conflictComplexitySummary(conflicts))
	knowledgeSnapshot, err := s.loadRequestKnowledge(sessionID, item.ProjectPath)
	if err != nil {
		return item, err
	}
	s.prepareContinuation(ctx, item, requestID, item.LastRequestID)
	prompt := planner.BuildManualPrompt(s.plannerRequest(ctx, planner.Request{
		SessionID: sessionID, RequestID: requestID, ParentRequestID: item.LastRequestID, Message: message,
		ContextTextPath: item.Context.TextPath, ContextManifest: item.Context.Manifest,
		PreviousResponseID: item.LastProviderResponseID, AutomationMode: item.AutomationMode,
		SelfEvolution: s.isSelfEvolution(item), PlanningMode: "direct",
		ExpectedBundleFilename: expectedResponseBundleFilenameForDerivedRequest(item, requestID, item.LastRequestID),
	}, knowledgeSnapshot, item.ProjectPath))
	resolution := domain.ConflictResolution{ID: conflictID, RequestID: requestID, OriginalPlanIDs: planIDs, Paths: paths, Details: append([]domain.IntegrationConflictDetail(nil), conflicts...), CreatedAt: time.Now().UTC()}
	var prunedContexts []string
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		recordRequestLineage(current, requestID, item.LastRequestID, requestKindConflict)
		recordRequestKnowledge(current, requestID, knowledgeSnapshot)
		if current.IntegrationConflict == nil {
			current.RepairAttempt = 0
			current.RepairParentPlanID = ""
			current.ConflictAttempt = 0
		} else {
			current.ConflictAttempt++
		}
		current.IntegrationConflict = &resolution
		current.LastRequestID = requestID
		current.LastManualPrompt = prompt
		current.PendingManualRequestIDs = appendUnique(current.PendingManualRequestIDs, requestID)
		current.State = "conflict_resolution_pending"
		current.LastRepairError = "host apply failed safely; focused conflict resolution required: " + strings.Join(paths, ", ")
		recordRequestBaseline(current, requestID, item.Context.Manifest.SHA256)
		prunedContexts = append(prunedContexts, recordRequestContext(current, requestID, item.Context)...)
		return nil
	})
	if err == nil {
		s.cleanupPrunedRequestContexts(prunedContexts)
		s.bus.Publish(sessionID, "conflict.prompt_ready", map[string]any{"conflict_id": conflictID, "request_id": requestID, "paths": paths, "surface_key": conflictSurfaceKey(sessionID, conflictID)})
	}
	return updated, err
}

// exhaustConflictResolution stops an automatic conflict-resolution loop that
// has already spent the selected effort budget on the SAME conflict ID
// without converging, instead of preparing yet another automatic prompt.
// Shared by prepareConflictResolution (ChangeSet path) and
// prepareConflictResolutionFromMerge (Git merge path) — both call this the
// same way once item.ConflictAttempt reaches the cap, mirroring how
// prepareRepairRequest already escalates ordinary repair rounds.
func (s *Service) exhaustConflictResolution(sessionID string, item domain.Session, conflictID string, paths []string) (domain.Session, error) {
	detail := fmt.Sprintf("automatic conflict resolution exhausted after %d attempts: %s", item.ConflictAttempt, strings.Join(paths, ", "))
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.State = "conflict_resolution_exhausted"
		current.LastRepairError = detail
		return nil
	})
	if err == nil {
		s.bus.Publish(sessionID, "conflict.exhausted", map[string]any{"conflict_id": conflictID, "attempts": item.ConflictAttempt, "paths": paths})
	}
	return updated, err
}

func buildConflictResolutionMessage(capsule []byte, paths []string, localAttempts string) string {
	if strings.TrimSpace(localAttempts) != "" {
		localAttempts = "\n\n" + strings.TrimSpace(localAttempts) +
			"\nThese collisions already survived Wharnex's own line-granular and token-granular three-way merge, so a purely mechanical union of both sides is not the answer being asked for."
	}
	return fmt.Sprintf(`WHARNEX CONFLICT RESOLUTION PROTOCOL — harness.conflict/v1

This is a focused support turn for a real integration conflict. Preserve the original task intent while reconciling CURRENT with RESULT using BASE as the common ancestor.

Return one normal canonical Wharnex change bundle for this request. The plan base_context_sha256 must equal CURRENT REVISION. Its patches may modify ONLY these conflict paths:
- %s

Do not repeat unrelated project work, do not modify non-conflict paths, and do not return a workflow. Resolve every listed conflict in one deliberate bundle. The dedicated conflict surface is independent from the main planning conversation.%s

CONFLICT CAPSULE:
%s`, strings.Join(paths, "\n- "), localAttempts, string(capsule))
}

func validateConflictResolutionPlan(item domain.Session, plan *domain.ExecutionPlan) error {
	if item.IntegrationConflict == nil || plan == nil || plan.RequestID != item.IntegrationConflict.RequestID {
		return nil
	}
	paths := actualPatchFiles(plan)
	manual := make(map[string]bool, len(item.IntegrationConflict.ManualPaths))
	for _, path := range item.IntegrationConflict.ManualPaths {
		manual[path] = true
	}
	if len(paths) == 0 && len(manual) == 0 {
		return errors.New("conflict resolution requires a patch or a manual decision for every conflict path")
	}
	allowed := make(map[string]bool, len(item.IntegrationConflict.Paths))
	for _, path := range item.IntegrationConflict.Paths {
		allowed[path] = true
	}
	for _, path := range paths {
		if !allowed[path] {
			return fmt.Errorf("conflict resolution path is outside the capsule: %s", path)
		}
	}
	for path := range allowed {
		if manual[path] {
			continue
		}
		found := false
		for _, candidate := range paths {
			if candidate == path {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("conflict resolution omitted path: %s", path)
		}
	}
	return nil
}

func retireConflictingMutations(changes []domain.PendingHostChange, conflict *domain.ConflictResolution) []domain.PendingHostChange {
	if conflict == nil {
		return changes
	}
	blocked := make(map[string]bool, len(conflict.Paths))
	for _, path := range conflict.Paths {
		blocked[path] = true
	}
	result := make([]domain.PendingHostChange, 0, len(changes))
	for _, change := range changes {
		if change.ChangeSet == nil {
			continue
		}
		mutations := change.ChangeSet.Mutations[:0]
		for _, mutation := range change.ChangeSet.Mutations {
			if !blocked[mutation.Path] {
				mutations = append(mutations, mutation)
			}
		}
		change.ChangeSet.Mutations = mutations
		if len(mutations) > 0 {
			result = append(result, change)
		}
	}
	return result
}

func mutationForConflict(pending []domain.PendingHostChange, changeSetID, path string) (domain.FileMutation, bool) {
	for _, change := range pending {
		if change.ChangeSet == nil || change.ChangeSet.ID != changeSetID {
			continue
		}
		for _, mutation := range change.ChangeSet.Mutations {
			if mutation.Path == path {
				return mutation, true
			}
		}
	}
	return domain.FileMutation{}, false
}

func planIDForChangeSet(pending []domain.PendingHostChange, id string) string {
	for _, change := range pending {
		if change.ChangeSet != nil && change.ChangeSet.ID == id {
			return change.Plan.PlanID
		}
	}
	return ""
}

func normalizedStrings(values []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	sort.Strings(result)
	return result
}

func hashBytes(value []byte) string {
	if value == nil {
		return ""
	}
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func conflictSurfaceKey(sessionID, conflictID string) string {
	value := sessionID + "_cf_" + conflictID
	if len(value) > 128 {
		value = value[:128]
	}
	return value
}

// replayIntegrationCommitAsPatch reproduces a pending Git-native candidate
// inside a workspace that shares no history with the host. The candidate's
// commit still lives in the host's own object database (PushBranchToHost put
// it there at verification time), so its diff is read from there and applied
// through the runner's normal patch strategy.
//
// A candidate whose commit the host no longer has — the branch was pruned, or
// the pending record predates the Git-native path — falls back to the plan's
// own recorded patches, which is exactly what the legacy replay tail does.
func (s *Service) replayIntegrationCommitAsPatch(ctx context.Context, sessionID, hostProjectPath string, runner sandbox.Runner, workspace sandbox.Workspace, change domain.PendingHostChange, result *domain.ExecutionResult) error {
	commit := strings.TrimSpace(change.IntegrationCommit)
	if commit == "" || !sandbox.HasCommit(ctx, hostProjectPath, commit) {
		s.bus.Publish(sessionID, "integration.branch_replay_downgraded", map[string]any{
			"branch": change.IntegrationBranch, "plan_id": change.Plan.PlanID,
			"reason": "the verified integration commit is no longer present in the host repository; replaying the plan's own patches instead",
		})
		return s.replayPlanPatches(ctx, runner, workspace, change, result)
	}
	patch, err := sandbox.CommitDiff(ctx, hostProjectPath, commit)
	if err != nil {
		return fmt.Errorf("read pending integration commit %s as patch: %w", commit, err)
	}
	if strings.TrimSpace(patch) == "" {
		// An empty diff means the candidate changed nothing reachable from
		// this base; there is nothing to replay and nothing to fail on.
		return nil
	}
	if err := protocol.ValidatePatchPaths(patch); err != nil {
		return fmt.Errorf("replay pending integration commit %s: %w", commit, err)
	}
	commandResult, runErr := runner.ApplyPatch(ctx, workspace, patch)
	result.Commands = append(result.Commands, commandResult)
	if runErr != nil || !commandResult.Success {
		if runErr == nil {
			runErr = fmt.Errorf("patch failed: %s", strings.TrimSpace(commandResult.Stderr))
		}
		return fmt.Errorf("replay pending integration commit %s: %w", commit, runErr)
	}
	s.bus.Publish(sessionID, "integration.branch_replayed", map[string]any{
		"branch": change.IntegrationBranch, "plan_id": change.Plan.PlanID,
		"commit": commit, "target": "sandbox-pending", "strategy": "commit_diff",
	})
	return nil
}

// replayPlanPatches is the legacy replay tail, extracted so the Git-native
// downgrade path above can reuse it verbatim instead of duplicating it.
func (s *Service) replayPlanPatches(ctx context.Context, runner sandbox.Runner, workspace sandbox.Workspace, change domain.PendingHostChange, result *domain.ExecutionResult) error {
	for _, patch := range planPatches(&change.Plan) {
		if err := protocol.ValidatePatchPaths(patch); err != nil {
			return fmt.Errorf("replay pending plan %s: %w", change.Plan.PlanID, err)
		}
		commandResult, runErr := runner.ApplyPatch(ctx, workspace, patch)
		result.Commands = append(result.Commands, commandResult)
		if runErr != nil || !commandResult.Success {
			if runErr == nil {
				runErr = fmt.Errorf("patch failed: %s", strings.TrimSpace(commandResult.Stderr))
			}
			return fmt.Errorf("replay pending plan %s: %w", change.Plan.PlanID, runErr)
		}
	}
	return nil
}

// partitionManagedConflictPaths splits conflicting paths into the ones Wharnex
// owns and the ones a planner is allowed to patch.
//
// The two sets must never be mixed in one focused-resolution request: a bundle
// that touches a managed path is rejected by the patch validator before any
// conflict-specific check runs, so including one makes the whole request
// unsatisfiable.
func partitionManagedConflictPaths(paths []string) (managed []string, resolvable []string) {
	for _, path := range paths {
		if protocol.IsWharnexManagedPath(path) {
			managed = append(managed, path)
			continue
		}
		resolvable = append(resolvable, path)
	}
	return managed, resolvable
}

// failManagedOnlyConflict terminates a conflict whose every path is
// Wharnex-managed.
//
// There is no planner turn that can resolve this, so the request stops with an
// actionable local state instead of being retried against a contradiction. The
// conflicting knowledge itself is not lost: the records remain in the database
// and are re-materialized on the next knowledge commit, which is why the
// remedy is local rather than a model round.
func (s *Service) failManagedOnlyConflict(sessionID string, item domain.Session, conflictID string, managed []string) (domain.Session, error) {
	detail := fmt.Sprintf(
		"integration conflict confined to Wharnex-managed project state (%s); these paths are materialized by Wharnex and are never resolved by a planner patch. Re-run the request against the current host state.",
		strings.Join(managed, ", "),
	)
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.State = "conflict_resolution_exhausted"
		current.LastRepairError = detail
		current.IntegrationConflict = nil
		return nil
	})
	if err != nil {
		return updated, err
	}
	s.bus.Publish(sessionID, "conflict.managed_paths_only", map[string]any{"conflict_id": conflictID, "paths": managed})
	return updated, fmt.Errorf("%w: %s", ErrManagedStateConflict, strings.Join(managed, ", "))
}
