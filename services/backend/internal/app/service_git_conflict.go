package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/sandbox"
)

// gitConflictRequest describes a host Git merge that could not auto-merge and
// is being handed to a planner.
type gitConflictRequest struct {
	origin       string
	ref          string
	remote       string
	remoteBranch string
	targetBranch string
	sides        hostrepo.MergeSides
	paths        []string
}

// prepareGitConflictResolution turns an aborted host merge into a bounded
// planner request.
//
// It reuses the `harness.conflict/v1` capsule the integration path already
// uses rather than inventing a second conflict protocol, because the question
// is identical — three versions of a file, and the intent behind each side.
// What differs is where the answer goes, and the capsule now says so: `origin`
// distinguishes reconciling a Wharnex candidate from reconciling a branch the
// operator asked to merge, and the `git` block names the exact merge to replay.
func (s *Service) prepareGitConflictResolution(ctx context.Context, sessionID string, item domain.Session, request gitConflictRequest) (domain.Session, string, error) {
	requestID := ids.New("req")
	conflictID := ids.New("conflict")
	paths := normalizedPaths(request.paths)
	// The same bounded budget the integration path uses. A merge that keeps
	// conflicting after the budget is spent is one a person has to look at,
	// and the aborted merge means the repository is usable meanwhile.
	if conflictResolutionExhausted(item) {
		return item, "", fmt.Errorf("conflict resolution is exhausted for this chat; resolve %s in Git directly", strings.Join(paths, ", "))
	}

	// A submodule pointer and Wharnex-managed state are no more resolvable by
	// a patch here than they are on the integration path.
	managed, resolvable := partitionManagedConflictPaths(paths)
	if topology, topologyErr := hostrepo.Inspect(ctx, item.ProjectPath); topologyErr == nil && len(topology.Submodules) > 0 {
		submodulePaths, patchable := partitionSubmoduleConflictPaths(topology, resolvable)
		managed, resolvable = append(managed, submodulePaths...), patchable
	}
	if len(resolvable) == 0 {
		hostrepo.AbortMerge(ctx, item.ProjectPath)
		return item, "", fmt.Errorf("this merge conflicts only on paths a planner cannot patch (%s); resolve it in Git directly", strings.Join(managed, ", "))
	}
	if len(managed) > 0 {
		s.bus.Publish(sessionID, "git.conflict_unresolvable_paths", map[string]any{"paths": managed})
	}

	files := make([]conflictCapsuleFile, 0, len(resolvable))
	for _, path := range resolvable {
		base, baseExists := hostrepo.FileAtRef(ctx, item.ProjectPath, request.sides.BaseSHA, path)
		ours, oursExists := hostrepo.FileAtRef(ctx, item.ProjectPath, request.sides.OursSHA, path)
		theirs, theirsExists := hostrepo.FileAtRef(ctx, item.ProjectPath, request.sides.TheirsSHA, path)
		files = append(files, conflictCapsuleFile{
			Path: path, Reason: "merge conflict",
			BaseExists: baseExists, CurrentExists: oursExists, ResultExists: theirsExists,
			BaseSHA256: hashBytes([]byte(base)), CurrentSHA256: hashBytes([]byte(ours)), ResultSHA256: hashBytes([]byte(theirs)),
			Base: truncateRepairText(base, 24000), Current: truncateRepairText(ours, 24000), Result: truncateRepairText(theirs, 24000),
		})
	}

	capsule := conflictCapsule{
		Protocol: "harness.conflict/v1", ConflictID: conflictID, CurrentRevision: item.Context.Manifest.SHA256,
		OriginalPlanIDs: []string{}, Origin: request.origin,
		Git: &conflictCapsuleGit{
			Ref: request.ref, TargetBranch: request.targetBranch, Remote: request.remote,
			BaseSHA: request.sides.BaseSHA, OursSHA: request.sides.OursSHA, TheirsSHA: request.sides.TheirsSHA,
		},
		Intent: s.gitConflictIntent(ctx, item, request, resolvable),
		Files:  files,
	}
	capsuleJSON, err := json.MarshalIndent(capsule, "", "  ")
	if err != nil {
		return item, "", err
	}
	message := buildGitConflictResolutionMessage(capsuleJSON, request, resolvable)
	knowledgeSnapshot, err := s.loadRequestKnowledge(sessionID, item.ProjectPath)
	if err != nil {
		return item, "", err
	}
	prompt := planner.BuildManualPrompt(s.plannerRequest(ctx, planner.Request{
		SessionID: sessionID, RequestID: requestID, Message: message,
		ContextTextPath: item.Context.TextPath, ContextManifest: item.Context.Manifest,
		PreviousResponseID: item.LastProviderResponseID, AutomationMode: item.AutomationMode,
		SelfEvolution: s.isSelfEvolution(item), PlanningMode: "direct",
		ExpectedBundleFilename: expectedResponseBundleFilenameForDerivedRequest(item, requestID, item.LastRequestID),
	}, knowledgeSnapshot, item.ProjectPath))

	resolution := domain.ConflictResolution{
		ID: conflictID, RequestID: requestID, OriginalPlanIDs: []string{}, Paths: resolvable,
		CreatedAt: time.Now().UTC(),
		Git: &domain.GitConflictContext{
			Origin: request.origin, Ref: request.ref, Remote: request.remote, RemoteBranch: request.remoteBranch,
			BaseSHA: request.sides.BaseSHA, OursSHA: request.sides.OursSHA, TheirsSHA: request.sides.TheirsSHA,
			TargetBranch: request.targetBranch,
		},
	}
	var prunedContexts []string
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		recordRequestLineage(current, requestID, item.LastRequestID, requestKindConflict)
		recordRequestKnowledge(current, requestID, knowledgeSnapshot)
		if current.IntegrationConflict == nil {
			current.ConflictAttempt = 0
		} else {
			current.ConflictAttempt++
		}
		current.IntegrationConflict = &resolution
		current.LastRequestID = requestID
		current.LastManualPrompt = prompt
		current.PendingManualRequestIDs = appendUnique(current.PendingManualRequestIDs, requestID)
		current.State = "conflict_resolution_pending"
		current.LastRepairError = fmt.Sprintf("merging %s conflicts on: %s", request.ref, strings.Join(resolvable, ", "))
		recordRequestBaseline(current, requestID, item.Context.Manifest.SHA256)
		prunedContexts = append(prunedContexts, recordRequestContext(current, requestID, item.Context)...)
		return nil
	})
	if err == nil {
		s.cleanupPrunedRequestContexts(prunedContexts)
		s.bus.Publish(sessionID, "conflict.prompt_ready", map[string]any{
			"conflict_id": conflictID, "request_id": requestID, "paths": resolvable,
			"origin": request.origin, "surface_key": conflictSurfaceKey(sessionID, conflictID),
		})
	}
	return updated, conflictID, err
}

// gitConflictIntent describes both sides of a host merge. The incoming side's
// purpose comes from the commit messages the remote or branch already carries,
// which is the same source the integration path uses.
func (s *Service) gitConflictIntent(ctx context.Context, item domain.Session, request gitConflictRequest, paths []string) *conflictCapsuleIntent {
	intent := &conflictCapsuleIntent{
		OurGoal:     fmt.Sprintf("preserve the work already on %s", firstNonEmpty(request.targetBranch, "the current branch")),
		Attempt:     item.ConflictAttempt + 1,
		MaxAttempts: policyForEffort(item.EffortLevel).MaxAttempts,
	}
	summaries, err := sandbox.CommitsTouching(ctx, item.ProjectPath, request.sides.BaseSHA, request.sides.TheirsSHA, paths)
	if err != nil {
		return intent
	}
	for _, summary := range summaries {
		intent.IncomingChanges = append(intent.IncomingChanges, conflictCapsuleChange{Commit: summary.SHA, Purpose: summary.Subject})
	}
	return intent
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// buildGitConflictResolutionMessage states plainly that this is a Git merge
// being reconciled, not a Wharnex candidate, and that the patch must be
// authored against CURRENT — which is exactly the content the working tree
// will hold when the resolution is replayed.
func buildGitConflictResolutionMessage(capsuleJSON []byte, request gitConflictRequest, paths []string) string {
	what := fmt.Sprintf("merging %s into %s", request.ref, firstNonEmpty(request.targetBranch, "the current branch"))
	if request.origin == domain.GitConflictOriginPush {
		what = fmt.Sprintf("integrating %s before pushing %s", request.ref, request.remoteBranch)
	}
	return strings.Join([]string{
		"A Git merge on the host could not be completed automatically: " + what + ".",
		"",
		"BASE is the last commit both sides shared, CURRENT is this branch's version, RESULT is the incoming version.",
		"Reconcile them so both sides' intent survives. Return a normal change bundle whose patches target exactly these paths and no others:",
		"  " + strings.Join(paths, "\n  "),
		"",
		"Each patch MUST be authored against CURRENT, which is the content those files will hold when the resolution is applied.",
		"Do not include verification commands: this is a Git reconciliation, not a code change to build.",
		"",
		string(capsuleJSON),
	}, "\n")
}
