package app

import (
	"context"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
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
// requestBaseAnchors is one request's anchored base across every repository
// unit the project is made of. Root is the superproject's anchor — the value
// every pre-submodule code path already consumed — and Units carries the rest,
// keyed by project-relative unit path.
type requestBaseAnchors struct {
	Root  string
	Units map[string]string
}

func (a requestBaseAnchors) empty() bool { return a.Root == "" && len(a.Units) == 0 }

func (s *Service) captureRequestBase(ctx context.Context, sessionID, projectPath, requestID string) requestBaseAnchors {
	requestID = strings.TrimSpace(requestID)
	anchors := requestBaseAnchors{}
	if requestID == "" || strings.TrimSpace(projectPath) == "" {
		return anchors
	}
	bases, err := sandbox.CaptureRequestBaseUnits(ctx, projectPath, requestID)
	if err != nil {
		s.bus.Publish(sessionID, "request.base_capture_degraded", map[string]any{"request_id": requestID, "error": err.Error()})
		return anchors
	}
	for _, base := range bases {
		if base.CommitSHA == "" {
			// Per-unit degradation, not request failure: that unit executes
			// against its current content while every other unit still gets the
			// tree its patch was authored against.
			s.bus.Publish(sessionID, "request.base_capture_degraded", map[string]any{
				"request_id": requestID, "unit": base.UnitPath, "error": base.Reason,
			})
			continue
		}
		if base.UnitPath == hostrepo.RootUnitPath {
			anchors.Root = base.CommitSHA
			continue
		}
		if anchors.Units == nil {
			anchors.Units = map[string]string{}
		}
		anchors.Units[base.UnitPath] = base.CommitSHA
	}
	if anchors.empty() {
		return anchors
	}
	s.bus.Publish(sessionID, "request.base_captured", map[string]any{
		"request_id": requestID, "commit": anchors.Root, "submodule_units": len(anchors.Units),
	})
	return anchors
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
func recordRequestBaseCommit(item *domain.Session, requestID string, anchors requestBaseAnchors) (released []string) {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" || anchors.empty() {
		return nil
	}
	if item.RequestBaseCommits == nil {
		item.RequestBaseCommits = make(map[string]string)
	}
	item.RequestBaseCommits[requestID] = strings.TrimSpace(anchors.Root)
	if len(anchors.Units) > 0 {
		if item.RequestBaseUnitCommits == nil {
			item.RequestBaseUnitCommits = make(map[string]map[string]string)
		}
		item.RequestBaseUnitCommits[requestID] = anchors.Units
	}
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
		delete(item.RequestBaseUnitCommits, id)
		released = append(released, id)
		if len(item.RequestBaseCommits) <= maxRetainedRequestBases {
			break
		}
	}
	return released
}

// requestBaseCommit resolves the superproject's anchored base for a request id.
func requestBaseCommit(item domain.Session, requestID string) string {
	if item.RequestBaseCommits == nil {
		return ""
	}
	return strings.TrimSpace(item.RequestBaseCommits[strings.TrimSpace(requestID)])
}

// requestBaseUnits rebuilds the full per-unit anchor set a request recorded,
// superproject included, in the shape the sandbox checkout consumes.
func requestBaseUnits(item domain.Session, requestID string) []sandbox.UnitBase {
	requestID = strings.TrimSpace(requestID)
	bases := make([]sandbox.UnitBase, 0, 1+len(item.RequestBaseUnitCommits[requestID]))
	if root := requestBaseCommit(item, requestID); root != "" {
		bases = append(bases, sandbox.UnitBase{UnitPath: hostrepo.RootUnitPath, CommitSHA: root})
	}
	units := make([]string, 0, len(item.RequestBaseUnitCommits[requestID]))
	for unitPath := range item.RequestBaseUnitCommits[requestID] {
		units = append(units, unitPath)
	}
	sort.Strings(units)
	for _, unitPath := range units {
		bases = append(bases, sandbox.UnitBase{UnitPath: unitPath, CommitSHA: item.RequestBaseUnitCommits[requestID][unitPath]})
	}
	return bases
}

// releaseRequestBaseRefs drops anchors for requests that can no longer
// execute. Failure is not actionable — an orphaned ref costs one unreachable
// commit and never affects correctness — so it is reported, not returned.
// Anchors are released in every repository unit rather than only the
// superproject: each unit holds its own ref under the same name, and a ref left
// behind in a submodule keeps a commit reachable there forever.
func (s *Service) releaseRequestBaseRefs(ctx context.Context, sessionID, projectPath string, requestIDs []string) {
	unitPaths := []string{hostrepo.RootUnitPath}
	if units, err := hostrepo.InspectUnits(ctx, projectPath); err == nil {
		unitPaths = unitPaths[:0]
		for _, unit := range units.List {
			if unit.Integrable() {
				unitPaths = append(unitPaths, unit.Path)
			}
		}
	}
	for _, requestID := range requestIDs {
		if strings.TrimSpace(requestID) == "" {
			continue
		}
		if failures := sandbox.DeleteRequestBaseUnitRefs(ctx, projectPath, requestID, unitPaths); len(failures) > 0 {
			s.bus.Publish(sessionID, "request.base_release_failed", map[string]any{"request_id": requestID, "error": strings.Join(failures, "; ")})
		}
	}
}

// prepareBaseRootedWorkspace repoints a fresh verification sandbox at the exact
// tree the plan was authored against — in every repository unit the project is
// made of — and opens its integration branch there. rooted names the units
// whose branch now exists, which the commit step must not create a second time.
// A nil rooted map means nothing could be rooted and the caller keeps the
// previous host-current behavior unchanged.
//
// The base objects already travel with the sandbox's local clones, but a clone
// negotiates refs/heads/* only, so each unit's ref has to be fetched explicitly
// before it can be checked out.
func (s *Service) prepareBaseRootedWorkspace(ctx context.Context, sessionID string, item domain.Session, plan *domain.ExecutionPlan, workspacePath string) (branch string, rooted map[string]bool) {
	if plan == nil || len(actualPatchFiles(plan)) == 0 {
		return "", nil
	}
	bases := requestBaseUnits(item, plan.RequestID)
	if len(bases) == 0 {
		return "", nil
	}
	branch = integrationBranchName(plan.RequestID)
	rooted, degraded := sandbox.CheckoutRequestBaseUnits(ctx, workspacePath, item.ProjectPath, plan.RequestID, branch, bases)
	for unitPath, reason := range degraded {
		s.bus.Publish(sessionID, "execution.base_root_degraded", map[string]any{
			"plan_id": plan.PlanID, "request_id": plan.RequestID, "unit": unitPath, "error": reason,
		})
	}
	if len(rooted) == 0 {
		return "", nil
	}
	s.bus.Publish(sessionID, "execution.base_rooted", map[string]any{
		"plan_id": plan.PlanID, "request_id": plan.RequestID,
		"base_commit": requestBaseCommit(item, plan.RequestID), "branch": branch, "units": len(rooted),
	})
	return branch, rooted
}
