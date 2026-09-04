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
		if !item.PlannerInFlight {
			continue
		}
		_, _ = s.store.Update(item.ID, func(current *domain.Session) error {
			current.PlannerInFlight = false
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
	if item.RequestBaselines == nil {
		item.RequestBaselines = make(map[string]string)
	}
	if strings.TrimSpace(requestID) != "" && strings.TrimSpace(sha) != "" {
		item.RequestBaselines[requestID] = sha
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

func canFastForwardBaseline(item domain.Session, fromSHA, toSHA string, impact []string) bool {
	fromSHA = strings.TrimSpace(fromSHA)
	toSHA = strings.TrimSpace(toSHA)
	impact = normalizedPaths(impact)
	if fromSHA == "" || toSHA == "" || fromSHA == toSHA || len(impact) == 0 {
		return fromSHA != "" && fromSHA == toSHA
	}
	cursor := fromSHA
	visited := map[string]bool{}
	for cursor != toSHA {
		if visited[cursor] {
			return false
		}
		visited[cursor] = true
		advanced := false
		for _, notice := range item.BaselineNotices {
			if strings.TrimSpace(notice.PreviousSHA256) != cursor || !notice.CompleteDelta {
				continue
			}
			changed := normalizedPaths(notice.ChangedFiles)
			if len(changed) == 0 || len(overlapPaths(changed, impact)) > 0 {
				return false
			}
			cursor = strings.TrimSpace(notice.NewSHA256)
			advanced = cursor != ""
			break
		}
		if !advanced {
			return false
		}
	}
	return true
}
