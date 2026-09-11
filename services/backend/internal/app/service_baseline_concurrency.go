package app

import (
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"kernl.local/harness/backend/internal/domain"
)

func (s *Service) projectApplyLock(projectPath string) *sync.Mutex {
	key := filepath.Clean(projectPath)
	s.applyMu.Lock()
	defer s.applyMu.Unlock()
	lock := s.projectApplyLocks[key]
	if lock == nil {
		lock = &sync.Mutex{}
		s.projectApplyLocks[key] = lock
	}
	return lock
}

func (s *Service) normalizeBaselineConcurrencySessions() {
	for _, item := range s.store.List() {
		strandedConflict := item.IntegrationConflict != nil &&
			item.IntegrationConflict.RequestID == item.LastRequestID &&
			strings.TrimSpace(item.LastManualPrompt) != "" &&
			!containsString(item.PendingManualRequestIDs, item.LastRequestID)
		if !item.PlannerInFlight && !strandedConflict {
			continue
		}
		_, _ = s.store.Update(item.ID, func(current *domain.Session) error {
			current.PlannerInFlight = false
			if strandedConflict {
				current.State = "conflict_resolution_pending"
				current.PendingManualRequestIDs = appendUnique(current.PendingManualRequestIDs, current.LastRequestID)
			}
			return nil
		})
	}
}

func enrichPlanConcurrency(plan *domain.ExecutionPlan, baseline string) {
	if plan == nil {
		return
	}
	if strings.TrimSpace(plan.BaseContextSHA256) == "" {
		plan.BaseContextSHA256 = strings.TrimSpace(baseline)
	}
	if len(plan.ImpactFiles) == 0 {
		plan.ImpactFiles = planTouchedFiles(plan)
	}
	plan.ImpactFiles = normalizedPaths(plan.ImpactFiles)
	plan.ReadFiles = normalizedPaths(plan.ReadFiles)
	plan.BarrierFiles = normalizedPaths(plan.BarrierFiles)
}

func recordRequestContext(item *domain.Session, requestID string, bundle domain.ContextBundle) []string {
	requestID = strings.TrimSpace(requestID)
	archive := strings.TrimSpace(bundle.ZipPath)
	if requestID == "" || archive == "" {
		return nil
	}
	if item.RequestContextArchives == nil {
		item.RequestContextArchives = make(map[string]string)
	}
	pruned := make([]string, 0, max(1, len(item.RequestContextArchives)-24))
	if previous := strings.TrimSpace(item.RequestContextArchives[requestID]); previous != "" && previous != archive {
		pruned = append(pruned, previous)
	}
	item.RequestContextArchives[requestID] = archive
	if len(item.RequestContextArchives) <= 24 {
		return pruned
	}
	keep := map[string]bool{item.LastRequestID: true}
	for _, id := range item.PendingManualRequestIDs {
		keep[id] = true
	}
	for id, path := range item.RequestContextArchives {
		if !keep[id] {
			pruned = append(pruned, path)
			delete(item.RequestContextArchives, id)
			if len(item.RequestContextArchives) <= 24 {
				break
			}
		}
	}
	return pruned
}

func requestContextArchive(item domain.Session, requestID string) string {
	return strings.TrimSpace(item.RequestContextArchives[strings.TrimSpace(requestID)])
}

func planBaseline(item domain.Session, plan *domain.ExecutionPlan) string {
	if plan != nil {
		if baseline := strings.TrimSpace(plan.BaseContextSHA256); baseline != "" {
			return baseline
		}
		return requestBaseline(item, plan.RequestID)
	}
	return strings.TrimSpace(item.Context.Manifest.SHA256)
}

func requestBaseline(item domain.Session, requestID string) string {
	if item.RequestBaselines != nil {
		if value := strings.TrimSpace(item.RequestBaselines[requestID]); value != "" {
			return value
		}
	}
	return strings.TrimSpace(item.Context.Manifest.SHA256)
}

func recordRequestBaseline(item *domain.Session, requestID, sha string) {
	requestID = strings.TrimSpace(requestID)
	sha = strings.TrimSpace(sha)
	if item.RequestBaselines == nil {
		item.RequestBaselines = make(map[string]string)
	}
	if requestID != "" && sha != "" {
		item.RequestBaselines[requestID] = sha
		if strings.TrimSpace(item.Context.Manifest.SHA256) == sha {
			if item.BaselineFileSnapshots == nil {
				item.BaselineFileSnapshots = make(map[string]map[string]string)
			}
			item.BaselineFileSnapshots[sha] = contextFileHashes(item.Context.Manifest.Files)
		}
	}
	if len(item.RequestBaselines) > 24 {
		keep := map[string]bool{item.LastRequestID: true}
		for _, id := range item.PendingManualRequestIDs {
			keep[id] = true
		}
		for id := range item.RequestBaselines {
			if !keep[id] {
				delete(item.RequestBaselines, id)
				if len(item.RequestBaselines) <= 24 {
					break
				}
			}
		}
	}
	usedSnapshots := make(map[string]bool, len(item.RequestBaselines))
	for _, baseline := range item.RequestBaselines {
		usedSnapshots[strings.TrimSpace(baseline)] = true
	}
	for baseline := range item.BaselineFileSnapshots {
		if !usedSnapshots[baseline] {
			delete(item.BaselineFileSnapshots, baseline)
		}
	}
}

func contextFileHashes(files []domain.ContextFile) map[string]string {
	hashes := make(map[string]string, len(files))
	for _, file := range files {
		path := filepath.ToSlash(filepath.Clean(strings.TrimSpace(file.Path)))
		sha := strings.TrimSpace(file.SHA256)
		if path != "" && path != "." && sha != "" {
			hashes[path] = sha
		}
	}
	return hashes
}

func requestSnapshotDelta(item domain.Session, requestID, fromSHA, toSHA string) ([]string, bool) {
	requestID = strings.TrimSpace(requestID)
	fromSHA = strings.TrimSpace(fromSHA)
	toSHA = strings.TrimSpace(toSHA)
	if requestID == "" || fromSHA == "" || toSHA == "" || strings.TrimSpace(item.Context.Manifest.SHA256) != toSHA {
		return nil, false
	}
	if strings.TrimSpace(item.RequestBaselines[requestID]) != fromSHA {
		return nil, false
	}
	previous, ok := item.BaselineFileSnapshots[fromSHA]
	if !ok {
		return nil, false
	}
	current := contextFileHashes(item.Context.Manifest.Files)
	changed := make([]string, 0)
	for path, sha := range previous {
		if current[path] != sha {
			changed = append(changed, path)
		}
	}
	for path := range current {
		if _, existed := previous[path]; !existed {
			changed = append(changed, path)
		}
	}
	return normalizedPaths(changed), true
}

func canFastForwardPlanBaseline(item domain.Session, plan *domain.ExecutionPlan, fromSHA, toSHA string) bool {
	if plan == nil {
		return false
	}
	impact := planTouchedFiles(plan)
	patchFiles := actualPatchFiles(plan)
	patchOnly := len(patchFiles) > 0 && !planHasCommandOperation(plan)
	if patchOnly {
		impact = patchFiles
	}
	if canFastForwardBaseline(item, fromSHA, toSHA, impact) {
		return true
	}
	if !patchOnly {
		return false
	}
	changed, complete := requestSnapshotDelta(item, plan.RequestID, fromSHA, toSHA)
	return complete && len(overlapPaths(changed, patchFiles)) == 0
}

func canLegacyRebasePlan(item domain.Session, plan *domain.ExecutionPlan) bool {
	return item.ExecutionMode == domain.ExecutionModeProtected && plan != nil && len(actualPatchFiles(plan)) > 0 && !planHasCommandOperation(plan)
}

func requestSupersededByBaselineContinuation(item domain.Session, requestID string) bool {
	return item.State == "baseline_update_pending" && strings.TrimSpace(item.LastRequestID) != "" && strings.TrimSpace(requestID) != strings.TrimSpace(item.LastRequestID)
}

func actualPatchFiles(plan *domain.ExecutionPlan) []string {
	if plan == nil {
		return nil
	}
	paths := make([]string, 0)
	for _, op := range plan.Operations {
		if op.Type == "apply_patch" {
			paths = append(paths, patchTouchedPaths(op.Patch)...)
		}
	}
	return normalizedPaths(paths)
}

func planHasCommandOperation(plan *domain.ExecutionPlan) bool {
	if plan == nil {
		return false
	}
	for _, op := range plan.Operations {
		if op.Type == "command" {
			return true
		}
	}
	return false
}

func planTouchedFiles(plan *domain.ExecutionPlan) []string {
	if plan == nil {
		return nil
	}
	paths := append([]string(nil), plan.ImpactFiles...)
	for _, op := range plan.Operations {
		if op.Type == "apply_patch" {
			paths = append(paths, patchTouchedPaths(op.Patch)...)
		}
	}
	return normalizedPaths(paths)
}

func patchTouchedPaths(patch string) []string {
	paths := make([]string, 0)
	for _, line := range strings.Split(patch, "\n") {
		if !strings.HasPrefix(line, "+++ ") && !strings.HasPrefix(line, "--- ") {
			continue
		}
		value := strings.TrimSpace(line[4:])
		if fields := strings.Fields(value); len(fields) > 0 {
			value = fields[0]
		}
		value = strings.TrimPrefix(strings.TrimPrefix(value, "a/"), "b/")
		if value != "" && value != "/dev/null" {
			paths = append(paths, value)
		}
	}
	return normalizedPaths(paths)
}

func normalizedPaths(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = filepath.ToSlash(filepath.Clean(strings.TrimSpace(value)))
		if value == "" || value == "." || value == ".." || strings.HasPrefix(value, "../") || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func overlapPaths(changed, forecast []string) []string {
	if len(forecast) == 0 {
		return nil
	}
	known := make(map[string]bool, len(forecast))
	for _, path := range normalizedPaths(forecast) {
		known[path] = true
	}
	out := make([]string, 0)
	for _, path := range normalizedPaths(changed) {
		if known[path] {
			out = append(out, path)
		}
	}
	return out
}

// baselineEdge is one observed hop in a project's baseline history: a change
// from one context SHA256 to another, with the set of files that changed
// between them (when the full delta is known).
type baselineEdge struct {
	from, to     string
	changedFiles []string
	complete     bool
}

func canFastForwardBaseline(item domain.Session, fromSHA, toSHA string, impact []string) bool {
	fromSHA = strings.TrimSpace(fromSHA)
	toSHA = strings.TrimSpace(toSHA)
	impact = normalizedPaths(impact)
	if fromSHA == "" || toSHA == "" || fromSHA == toSHA || len(impact) == 0 {
		return fromSHA != "" && fromSHA == toSHA
	}
	// BaselineNotices only records a hop when ANOTHER Wharness session on the
	// same project applied a plan through the tracked Host Apply pipeline.
	// ProjectRevisions records a hop on every context refresh that observes a
	// new SHA256, regardless of what caused it — a peer session's apply, a
	// manual git operation, or an external edit made outside Wharness
	// entirely (a co-editing tool, another IDE, a background script). A plan
	// pending against a project actively developed alongside Wharness must be
	// reconcilable against that second, always-populated source too, or every
	// external edit permanently strands it behind a "stale baseline" block
	// that neither ChatGPT nor a human can retry their way out of. Trying
	// both sources independently cannot make a genuine conflict look safe:
	// each source only ever asserts real observed changed-files, so an
	// overlap detected by either one still blocks.
	if walkBaselineChain(baselineNoticeEdges(item.BaselineNotices), fromSHA, toSHA, impact) {
		return true
	}
	return walkBaselineChain(projectRevisionEdges(item.ProjectRevisions), fromSHA, toSHA, impact)
}

func baselineNoticeEdges(notices []domain.BaselineNotice) []baselineEdge {
	edges := make([]baselineEdge, 0, len(notices))
	for _, notice := range notices {
		edges = append(edges, baselineEdge{
			from: strings.TrimSpace(notice.PreviousSHA256), to: strings.TrimSpace(notice.NewSHA256),
			changedFiles: notice.ChangedFiles, complete: notice.CompleteDelta,
		})
	}
	return edges
}

func projectRevisionEdges(revisions []domain.ProjectRevision) []baselineEdge {
	edges := make([]baselineEdge, 0, len(revisions))
	for _, revision := range revisions {
		edges = append(edges, baselineEdge{
			from: strings.TrimSpace(revision.ParentSHA256), to: strings.TrimSpace(revision.SHA256),
			changedFiles: revision.ChangedFiles, complete: revision.Complete,
		})
	}
	return edges
}

func walkBaselineChain(edges []baselineEdge, fromSHA, toSHA string, impact []string) bool {
	cursor := fromSHA
	visited := map[string]bool{}
	for cursor != toSHA {
		if visited[cursor] {
			return false
		}
		visited[cursor] = true
		advanced := false
		for _, edge := range edges {
			if edge.from != cursor || !edge.complete {
				continue
			}
			changed := normalizedPaths(edge.changedFiles)
			if len(changed) == 0 || len(overlapPaths(changed, impact)) > 0 {
				return false
			}
			cursor = edge.to
			advanced = cursor != ""
			break
		}
		if !advanced {
			return false
		}
	}
	return true
}
