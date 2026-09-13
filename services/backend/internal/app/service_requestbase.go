package app

import (
	"context"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox"
)

// maxRetainedRequestBases bounds how many anchored base refs one session keeps
// alive, matching the retention the request context archives already use.
// Every anchor holds a commit object reachable, so an unbounded map would keep
// growing a long-lived project's object database for no benefit.
const maxRetainedRequestBases = 24

// captureRequestBase anchors the host tree a request is being planned against.
//
// It is best effort by design. A project whose repository has no commit yet,
// or a Git that refuses for any reason, degrades to the pre-existing behavior
// (the plan executes against the host's current tree) rather than failing a
// request the user asked for. What it must never do is silently record a base
// that is not the one the context was built from, so it is only ever called
// immediately alongside the context snapshot it describes.
func (s *Service) captureRequestBase(ctx context.Context, sessionID, projectPath, requestID string) string {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" || strings.TrimSpace(projectPath) == "" {
		return ""
	}
	commit, err := sandbox.CaptureRequestBase(ctx, projectPath, requestID)
	if err != nil {
		s.bus.Publish(sessionID, "request.base_capture_degraded", map[string]any{"request_id": requestID, "error": err.Error()})
		return ""
	}
	s.bus.Publish(sessionID, "request.base_captured", map[string]any{"request_id": requestID, "commit": commit})
	return commit
}

// ExecutionConcurrency reports how many plans one project may verify at a
// time. Concurrency is per canonical project: unrelated projects have always
// executed independently.
func (s *Service) ExecutionConcurrency() int { return s.executionQueue.currentCapacity() }

// SetExecutionConcurrency changes that limit at runtime and returns the value
// actually applied after clamping. Raising it is not free — each concurrent
// runner claims a full container memory allowance and a complete project
// clone — so the ceiling is deliberately small.
func (s *Service) SetExecutionConcurrency(capacity int) int {
	return s.executionQueue.setCapacity(capacity)
}

// MaxExecutionConcurrency is the ceiling the UI presents for that knob.
func (s *Service) MaxExecutionConcurrency() int { return maxProjectExecutionConcurrency }

// recordRequestBaseCommit stores one request's anchored base and evicts the
// oldest anchors beyond the retention bound, releasing their host refs so the
// underlying commits become collectable again. Requests that are still the
// active one or still pending are never evicted.
func recordRequestBaseCommit(item *domain.Session, requestID, commitSHA string) (released []string) {
	requestID = strings.TrimSpace(requestID)
	commitSHA = strings.TrimSpace(commitSHA)
	if requestID == "" || commitSHA == "" {
		return nil
	}
	if item.RequestBaseCommits == nil {
		item.RequestBaseCommits = make(map[string]string)
	}
	item.RequestBaseCommits[requestID] = commitSHA
	if len(item.RequestBaseCommits) <= maxRetainedRequestBases {
		return nil
	}
	keep := map[string]bool{requestID: true, item.LastRequestID: true}
	for _, id := range item.PendingManualRequestIDs {
		keep[id] = true
	}
	for _, pending := range item.PendingHostChanges {
		keep[pending.Plan.RequestID] = true
	}
	for id := range item.RequestBaseCommits {
		if keep[id] {
			continue
		}
		delete(item.RequestBaseCommits, id)
		released = append(released, id)
		if len(item.RequestBaseCommits) <= maxRetainedRequestBases {
			break
		}
	}
	return released
}

// requestBaseCommit resolves the anchored base for a request id.
func requestBaseCommit(item domain.Session, requestID string) string {
	if item.RequestBaseCommits == nil {
		return ""
	}
	return strings.TrimSpace(item.RequestBaseCommits[strings.TrimSpace(requestID)])
}

// releaseRequestBaseRefs drops anchors for requests that can no longer
// execute. Failure is not actionable — an orphaned ref costs one unreachable
// commit and never affects correctness — so it is reported, not returned.
func (s *Service) releaseRequestBaseRefs(ctx context.Context, sessionID, projectPath string, requestIDs []string) {
	for _, requestID := range requestIDs {
		if strings.TrimSpace(requestID) == "" {
			continue
		}
		if err := sandbox.DeleteRequestBaseRef(ctx, projectPath, requestID); err != nil {
			s.bus.Publish(sessionID, "request.base_release_failed", map[string]any{"request_id": requestID, "error": err.Error()})
		}
	}
}

// prepareBaseRootedWorkspace repoints a fresh verification sandbox at the
// exact tree the plan was authored against and opens its integration branch
// there. Reports false when this plan has no usable anchored base, in which
// case the caller keeps the previous host-current behavior unchanged.
//
// The base object already travels with the sandbox's local clone, but a clone
// negotiates refs/heads/* only, so the ref itself has to be fetched explicitly
// before it can be checked out.
func (s *Service) prepareBaseRootedWorkspace(ctx context.Context, sessionID string, item domain.Session, plan *domain.ExecutionPlan, workspacePath string) (branch, baseCommit string, ok bool) {
	if plan == nil || len(actualPatchFiles(plan)) == 0 {
		return "", "", false
	}
	baseCommit = requestBaseCommit(item, plan.RequestID)
	if baseCommit == "" {
		return "", "", false
	}
	ref := sandbox.RequestBaseRef(plan.RequestID)
	if err := sandbox.FetchRefFromHost(ctx, workspacePath, item.ProjectPath, ref); err != nil {
		s.bus.Publish(sessionID, "execution.base_root_degraded", map[string]any{"plan_id": plan.PlanID, "request_id": plan.RequestID, "error": err.Error()})
		return "", "", false
	}
	branch = integrationBranchName(plan.RequestID)
	if err := sandbox.CheckoutRequestBase(ctx, workspacePath, branch, baseCommit); err != nil {
		s.bus.Publish(sessionID, "execution.base_root_degraded", map[string]any{"plan_id": plan.PlanID, "request_id": plan.RequestID, "error": err.Error()})
		return "", "", false
	}
	s.bus.Publish(sessionID, "execution.base_rooted", map[string]any{"plan_id": plan.PlanID, "request_id": plan.RequestID, "base_commit": baseCommit, "branch": branch})
	return branch, baseCommit, true
}
