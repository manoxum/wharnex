package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/protocol"
	"kernl.local/harness/backend/internal/sandbox"
)

// integrationBranchName is the Git branch Wharness creates inside a
// verification sandbox for one candidate's verified patch, and later merges
// into the host under that exact same name (see ADR-0028/29 and
// SoT/SANDBOX_MODEL.md). request_id already matches req_<timestamp>_<hex>,
// which is a safe Git branch name component as-is.
func integrationBranchName(requestID string) string {
	return "whx/" + requestID
}

// Bounds applied to planner-supplied text before it becomes a real Git commit
// message. The subject follows the Git convention the protocol validator also
// enforces; the body is bounded separately so detail is capped without the cap
// eating into the subject.
const (
	maxCommitSubjectLength = protocol.MaxCommitSubjectLength
	maxCommitBodyLength    = protocol.MaxCommitMessageBytes
)

// sanitizeCommitMessage strips control characters and collapses whitespace
// from planner-supplied text before it is used verbatim as a Git commit
// message — the same defensive posture already applied to other free-form
// planner text (summary, README.md) elsewhere in this protocol, but load
// bearing here specifically because this text becomes real, permanent
// project history, not just a chat message.
// sanitizeCommitMessage prepares planner-supplied text to become a real Git
// commit message: a subject line, then an optional body separated by one blank
// line.
//
// The body's line structure is deliberately preserved. Flattening newlines into
// spaces — as this previously did — made a commit body structurally impossible,
// so every Wharness commit was a bare subject no matter what the planner wrote,
// and the reasoning that makes history worth reading was silently discarded.
// The subject is still collapsed to a single line, because Git treats the first
// line as the subject and a multi-line one has no meaning.
func sanitizeCommitMessage(raw, fallback string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = strings.TrimSpace(fallback)
	}
	subject, body := splitCommitMessage(stripControlCharacters(raw))
	subject = strings.Join(strings.Fields(subject), " ")
	if subject == "" {
		// Reached only when both the plan's own message and its summary are
		// empty, which ValidateCommitMessage rejects upstream for any change
		// bundle. It is labelled as the degradation it is rather than reusing
		// a subject the protocol itself names as a quality failure.
		subject = "chore: record verified change with no planner-supplied message"
	}
	if len(subject) > maxCommitSubjectLength {
		subject = strings.TrimSpace(subject[:maxCommitSubjectLength])
	}
	if body == "" {
		return subject
	}
	if len(body) > maxCommitBodyLength {
		body = strings.TrimSpace(body[:maxCommitBodyLength])
	}
	return subject + "\n\n" + body
}

// splitCommitMessage separates the Git subject from its body. Anything after
// the first line is body; a blank separator line is normalized in.
func splitCommitMessage(raw string) (subject, body string) {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	parts := strings.SplitN(raw, "\n", 2)
	subject = strings.TrimSpace(parts[0])
	if len(parts) == 1 {
		return subject, ""
	}
	return subject, strings.Trim(parts[1], "\n")
}

// stripControlCharacters removes characters that must never reach a commit
// message, while keeping the newlines and tabs that carry body structure.
func stripControlCharacters(raw string) string {
	var b strings.Builder
	for _, r := range raw {
		switch {
		case r == '\n' || r == '\t':
			b.WriteRune(r)
		case r < 0x20 || r == 0x7f:
			// control characters dropped
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// allPendingHaveIntegrationBranches reports whether every host-applicable
// pending candidate already has a verified Git integration branch — the
// condition for ApplyToHost to use the git-merge flow instead of the legacy
// ChangeSet/raw-patch paths. A candidate with no patch (command-only plan)
// has no branch to merge and does not disqualify the group.
func allPendingHaveIntegrationBranches(pending []domain.PendingHostChange) bool {
	if len(pending) == 0 {
		return false
	}
	for index := range pending {
		if pending[index].IntegrationBranch == "" && len(actualPatchFiles(&pending[index].Plan)) > 0 {
			return false
		}
	}
	return true
}

// planIDForIntegrationBranch finds which pending candidate's PlanID owns a
// given integration branch (branches are always named "whx/"+RequestID —
// see integrationBranchName). branch may carry a "origin/" remote-tracking
// prefix (replayPendingChangeSets merges "origin/"+IntegrationBranch when
// replaying an earlier candidate into a fresh verification sandbox), so
// comparison is by suffix. Used to attribute a *sandbox.MergeConflictError
// back to the specific plan that conflicted.
func planIDForIntegrationBranch(pending []domain.PendingHostChange, branch string) string {
	for index := range pending {
		candidate := pending[index].IntegrationBranch
		if candidate != "" && strings.HasSuffix(branch, candidate) {
			return pending[index].Plan.PlanID
		}
	}
	return ""
}

// commitVerifiedPatchToBranch commits a just-verified sandbox workspace's
// applied patch onto its own integration branch and pushes that branch into
// the host's own .git (never a remote — see PushBranchToHost). Returns ""
// for a command-only plan with no patch, which has nothing to commit.
// baseRootedBranch is non-empty when the workspace was already repointed at
// the request's own base and that branch opened there (see
// prepareBaseRootedWorkspace). In that case the branch exists and is checked
// out already, so committing must not try to create it a second time — and
// must not re-root it at the host's newer tip, which is exactly the parentage
// this whole mechanism exists to avoid.
func (s *Service) commitVerifiedPatchToBranch(ctx context.Context, sessionID string, plan *domain.ExecutionPlan, projectPath, workspacePath, baseRootedBranch string) (branch, commitSHA string, err error) {
	patchFiles := actualPatchFiles(plan)
	if len(patchFiles) == 0 {
		return "", "", nil
	}
	message := sanitizeCommitMessage(plan.CommitMessage, plan.Summary)
	message = fmt.Sprintf("%s\n\nRequest-Id: %s\nPlan-Id: %s", message, plan.RequestID, plan.PlanID)
	branch = integrationBranchName(plan.RequestID)
	if strings.TrimSpace(baseRootedBranch) == branch {
		commitSHA, err = sandbox.CommitBaseRootedPatch(ctx, workspacePath, message, patchFiles)
	} else {
		commitSHA, err = sandbox.CommitVerifiedPatch(ctx, workspacePath, branch, message, patchFiles)
	}
	if err != nil {
		return "", "", err
	}
	// Creating the commit happens entirely inside the disposable sandbox, but
	// the push writes a ref into the host's own .git. That is the only
	// host-facing mutation in the whole verification phase, so it — and
	// nothing longer — is what must be serialized per project. Holding the
	// project lock only here is what lets two chats verify concurrently
	// without racing each other's ref updates.
	pushLock := s.projectApplyLock(projectPath)
	pushLock.Lock()
	pushErr := sandbox.PushBranchToHost(ctx, workspacePath, projectPath, branch)
	pushLock.Unlock()
	if pushErr != nil {
		return "", "", pushErr
	}
	s.bus.Publish(sessionID, "integration.branch_committed", map[string]any{"plan_id": plan.PlanID, "branch": branch, "commit": commitSHA})
	return branch, commitSHA, nil
}

// mergeIntegrationBranches merges every pending candidate's integration
// branch into the host's currently checked-out branch, in order, stopping
// at the first failure (mirrors the ordering/short-circuit semantics the
// legacy ChangeSet path already had). On success it returns the branches
// that were merged (for later deletion) and the host's HEAD immediately
// before this call, so a later post-merge verification failure can revert
// the whole batch with one git reset. On a real merge conflict it returns
// *sandbox.MergeConflictError for the specific candidate that conflicted;
// the host is left exactly as it was before that attempt.
func (s *Service) mergeIntegrationBranches(ctx context.Context, sessionID, projectPath string, pending []domain.PendingHostChange) (mergedBranches []string, preMergeSHA string, failedPlanID string, err error) {
	preMergeSHA, err = sandbox.CurrentHeadSHA(ctx, projectPath)
	if err != nil {
		return nil, "", "", fmt.Errorf("resolve host HEAD before merge: %w", err)
	}
	for index := range pending {
		branch := pending[index].IntegrationBranch
		if branch == "" {
			continue
		}
		s.bus.Publish(sessionID, "integration.merge_started", map[string]any{"plan_id": pending[index].Plan.PlanID, "branch": branch})
		// Ask Git whether this merge can succeed before letting it touch the
		// host at all. A doomed merge would otherwise still commit the host's
		// dirty tree as a pre-merge snapshot on its way to aborting, leaving a
		// bookkeeping commit behind for a merge that never happened.
		if conflict, preflightErr := sandbox.PreflightMergeIntoHost(ctx, projectPath, branch); preflightErr == nil && conflict != nil {
			s.bus.Publish(sessionID, "integration.merge_preflight_conflict", map[string]any{"plan_id": pending[index].Plan.PlanID, "branch": branch, "paths": conflict.Paths})
			return mergedBranches, preMergeSHA, pending[index].Plan.PlanID, conflict
		}
		if _, mergeErr := sandbox.MergeBranchOnHost(ctx, projectPath, branch); mergeErr != nil {
			return mergedBranches, preMergeSHA, pending[index].Plan.PlanID, mergeErr
		}
		mergedBranches = append(mergedBranches, branch)
		s.bus.Publish(sessionID, "integration.merge_completed", map[string]any{"plan_id": pending[index].Plan.PlanID, "branch": branch})
	}
	return mergedBranches, preMergeSHA, "", nil
}

// deleteIntegrationBranches best-effort cleans up branches after a
// successful Apply. The merge commits themselves remain in the host's log
// regardless of whether this cleanup succeeds.
func (s *Service) deleteIntegrationBranches(ctx context.Context, sessionID, projectPath string, branches []string) {
	for _, branch := range branches {
		if err := sandbox.DeleteHostBranch(ctx, projectPath, branch); err != nil {
			s.bus.Publish(sessionID, "integration.branch_cleanup_failed", map[string]any{"branch": branch, "error": err.Error()})
		}
	}
}

// prepareConflictResolutionFromMerge builds the same harness.conflict/v1
// capsule and session transition as the legacy ChangeSet conflict path
// (prepareConflictResolution), but sources BASE/CURRENT/RESULT content via
// git show against the merge-base/host/candidate-branch commits a real Git
// merge conflict already identifies — no working-tree checkout needed.
//
// repoPath is the repository conflict's SHAs/branch are meaningful in: the
// real host project path when the conflict came from ApplyToHost's own
// merge, but the (still-alive at this point, not yet cleaned up) sandbox
// workspace path when it came from replaying an earlier pending
// candidate's branch into a NEW verification sandbox — that conflict's
// HostSHA/MergeBaseSHA/Branch (an "origin/..." remote-tracking ref) only
// resolve inside that sandbox's own .git, never the host's.
func (s *Service) prepareConflictResolutionFromMerge(ctx context.Context, sessionID string, item domain.Session, repoPath, failedPlanID string, conflict *sandbox.MergeConflictError) (domain.Session, error) {
	requestID := ids.New("req")
	conflictID := ids.New("conflict")
	continuing := item.IntegrationConflict != nil && strings.TrimSpace(item.IntegrationConflict.ID) != ""
	if continuing {
		conflictID = item.IntegrationConflict.ID
	}
	paths := normalizedPaths(conflict.Paths)
	if continuing && item.ConflictAttempt >= maxAutoRepairAttempts {
		return s.exhaustConflictResolution(sessionID, item, conflictID, paths)
	}
	files := make([]conflictCapsuleFile, 0, len(paths))
	for _, path := range paths {
		base, baseExists, err := sandbox.ReadFileAtRef(ctx, repoPath, conflict.MergeBaseSHA, path)
		if err != nil {
			return item, fmt.Errorf("read merge-base content for %s: %w", path, err)
		}
		current, currentExists, err := sandbox.ReadFileAtRef(ctx, repoPath, conflict.HostSHA, path)
		if err != nil {
			return item, fmt.Errorf("read host content for %s: %w", path, err)
		}
		result, resultExists, err := sandbox.ReadFileAtRef(ctx, repoPath, conflict.Branch, path)
		if err != nil {
			return item, fmt.Errorf("read candidate content for %s: %w", path, err)
		}
		files = append(files, conflictCapsuleFile{
			Path: path, Reason: "merge conflict", BaseExists: baseExists, CurrentExists: currentExists, ResultExists: resultExists,
			BaseSHA256: hashBytes([]byte(base)), CurrentSHA256: hashBytes([]byte(current)), ResultSHA256: hashBytes([]byte(result)),
			Base: truncateRepairText(base, 24000), Current: truncateRepairText(current, 24000), Result: truncateRepairText(result, 24000),
		})
	}
	capsule := conflictCapsule{
		Protocol: "harness.conflict/v1", ConflictID: conflictID, CurrentRevision: item.Context.Manifest.SHA256,
		OriginalPlanIDs: []string{failedPlanID},
		Intent:          s.buildConflictIntent(ctx, item, repoPath, conflict, paths),
		Files:           files,
	}
	capsuleJSON, err := json.MarshalIndent(capsule, "", "  ")
	if err != nil {
		return item, err
	}
	message := buildConflictResolutionMessage(capsuleJSON, paths)
	knowledgeSnapshot, err := s.loadRequestKnowledge(sessionID, item.ProjectPath)
	if err != nil {
		return item, err
	}
	prompt := planner.BuildManualPrompt(s.plannerRequest(ctx, planner.Request{
		SessionID: sessionID, RequestID: requestID, Message: message,
		ContextTextPath: item.Context.TextPath, ContextManifest: item.Context.Manifest,
		PreviousResponseID: item.LastProviderResponseID, AutomationMode: item.AutomationMode,
		SelfEvolution: s.isSelfEvolution(item), PlanningMode: "direct",
		ExpectedBundleFilename: expectedResponseBundleFilenameForDerivedRequest(item, requestID, item.LastRequestID),
	}, knowledgeSnapshot, item.ProjectPath))
	// Carry forward what this round tried, so the next round of the same
	// conflict can see the shape of the loop rather than restarting blind.
	history := appendConflictAttempt(intentHistory(item), conflictAttemptRecord(item, paths))
	resolution := domain.ConflictResolution{ID: conflictID, RequestID: requestID, OriginalPlanIDs: []string{failedPlanID}, Paths: paths, Details: nil, AttemptHistory: history, CreatedAt: time.Now().UTC()}
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
		recordRequestContext(current, requestID, item.Context)
		return nil
	})
	if err == nil {
		s.bus.Publish(sessionID, "conflict.prompt_ready", map[string]any{"conflict_id": conflictID, "request_id": requestID, "paths": paths, "surface_key": conflictSurfaceKey(sessionID, conflictID)})
	}
	return updated, err
}
