package app

import (
	"time"

	"kernl.local/harness/backend/internal/domain"
)

const (
	requestKindStandard        = "standard"
	requestKindRepair          = "repair"
	requestKindEvidence        = "evidence"
	requestKindConflict        = "conflict"
	requestKindKnowledgeReview = "knowledge_review"
)

func recordRequestLineage(item *domain.Session, requestID, parentID, kind string) {
	if requestID == "" {
		return
	}
	if item.RequestLineages == nil {
		item.RequestLineages = map[string]domain.RequestLineage{}
	}
	rootID := requestID
	if parent, ok := item.RequestLineages[parentID]; ok && parent.RootRequestID != "" {
		rootID = parent.RootRequestID
	} else if parentID != "" {
		rootID = parentID
	}
	item.RequestLineages[requestID] = domain.RequestLineage{RequestID: requestID, RootRequestID: rootID, ParentRequestID: parentID, Kind: kind, CreatedAt: time.Now().UTC()}
}

func requestEventLineage(item domain.Session, requestID string) map[string]any {
	lineage, ok := item.RequestLineages[requestID]
	if !ok {
		return map[string]any{"request_id": requestID, "root_request_id": requestID, "iteration_kind": requestKindStandard}
	}
	return map[string]any{"request_id": requestID, "root_request_id": lineage.RootRequestID, "parent_request_id": lineage.ParentRequestID, "iteration_kind": lineage.Kind}
}
