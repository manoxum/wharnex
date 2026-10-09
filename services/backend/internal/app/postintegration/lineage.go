package postintegration

import "kernl.local/harness/backend/internal/domain"

// RequiresObservation follows engine-owned lineage. Only an actual workflow's
// evidence continuation opens the runtime conclusion, never a protocol repair.
func RequiresObservation(item domain.Session, requestID string) bool {
	observed := false
	seen := make(map[string]bool)
	for requestID != "" {
		if seen[requestID] {
			return true
		}
		seen[requestID] = true
		lineage, ok := item.RequestLineages[requestID]
		if !ok {
			return false
		}
		if lineage.Kind == RequestKind {
			return !observed
		}
		if lineage.Kind == "evidence" {
			observed = true
		}
		requestID = lineage.ParentRequestID
	}
	return false
}
