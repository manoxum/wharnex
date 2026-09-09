package app

import (
	"encoding/json"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
)

const remoteInputFailurePrefix = "Remote input communication failed: "

func knowledgeReviewRequest(item domain.Session, requestID string) bool {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return false
	}
	if item.PendingKnowledgeReviewRequestID == requestID {
		return true
	}
	lineage, ok := item.RequestLineages[requestID]
	return ok && lineage.Kind == requestKindKnowledgeReview && containsString(item.PendingManualRequestIDs, requestID)
}

func knowledgeReviewPromptMatches(item domain.Session, requestID string, snapshot domain.RequestKnowledgeSnapshot) bool {
	prompt := strings.TrimSpace(item.LastManualPrompt)
	if prompt == "" || !strings.Contains(prompt, "WHX KNOWLEDGE REVIEW") {
		return false
	}
	if !strings.Contains(prompt, "REQUEST ID: "+requestID) || !strings.Contains(prompt, expectedResponseBundleFilename(item, requestID)) {
		return false
	}
	if snapshot.State != domain.KnowledgeStatePresent {
		return true
	}
	identity := fmt.Sprintf("Knowledge identity: version=%d sha256=%s", snapshot.Version, snapshot.SHA256)
	return strings.Contains(prompt, identity) && strings.Contains(prompt, strings.TrimSpace(snapshot.Content))
}

func (s *Service) rebuildKnowledgeReviewPrompt(item domain.Session, requestID string, snapshot domain.RequestKnowledgeSnapshot) (string, error) {
	lineage, ok := item.RequestLineages[requestID]
	if !ok || lineage.Kind != requestKindKnowledgeReview {
		return "", fmt.Errorf("request %s is not a knowledge review", requestID)
	}
	history, err := json.Marshal(selectKnowledgeReviewHistory(s.bus.History(item.ID)))
	if err != nil {
		return "", fmt.Errorf("marshal knowledge review history: %w", err)
	}
	request := withPlannerKnowledge(planner.Request{
		SessionID:              item.ID,
		RequestID:              requestID,
		Message:                string(history),
		ContextTextPath:        item.Context.TextPath,
		ContextManifest:        item.Context.Manifest,
		PreviousResponseID:     item.LastProviderResponseID,
		AutomationMode:         item.AutomationMode,
		SelfEvolution:          s.isSelfEvolution(item),
		PlanningMode:           "knowledge_review",
		ExpectedBundleFilename: expectedResponseBundleFilename(item, requestID),
	}, snapshot)
	return planner.BuildManualPrompt(request), nil
}

func recoverPostApplyState(item domain.Session) (string, bool) {
	if item.State != "failed" || item.LastExecution == nil || !item.LastExecution.Success || item.LastHostAppliedAt.IsZero() {
		return "", false
	}
	if !strings.HasPrefix(item.LastRepairError, remoteInputFailurePrefix) {
		return "", false
	}
	switch item.SelfEvolutionActivation {
	case "restart_pending", "restart_scheduled":
		return item.SelfEvolutionActivation, true
	default:
		return "applied", true
	}
}

// normalizeKnowledgeReviewSessions repairs durable sessions created by older
// versions that coupled a best-effort knowledge_review delivery failure to the
// main task state or persisted a prompt that predates the canonical knowledge
// identity. It never replays the already-applied task.
func (s *Service) normalizeKnowledgeReviewSessions() {
	for _, item := range s.store.List() {
		requestID := strings.TrimSpace(item.PendingKnowledgeReviewRequestID)
		if requestID == "" || !knowledgeReviewRequest(item, requestID) {
			continue
		}
		restoreState, restoreTask := recoverPostApplyState(item)
		snapshot, snapshotErr := requestKnowledgeSnapshot(item, requestID)
		promptNeedsRepair := snapshotErr == nil && !knowledgeReviewPromptMatches(item, requestID, snapshot)
		pendingMissing := !containsString(item.PendingManualRequestIDs, requestID)
		overlappedMainRequest := false
		for _, pendingID := range item.PendingManualRequestIDs {
			if strings.TrimSpace(pendingID) != "" && pendingID != requestID {
				overlappedMainRequest = true
				break
			}
		}
		if !restoreTask && !promptNeedsRepair && !pendingMissing && !overlappedMainRequest {
			continue
		}

		rebuiltPrompt := ""
		if promptNeedsRepair {
			if prompt, err := s.rebuildKnowledgeReviewPrompt(item, requestID, snapshot); err == nil {
				rebuiltPrompt = prompt
			} else {
				snapshotErr = err
			}
		}
		discardReview := snapshotErr != nil || overlappedMainRequest
		_, err := s.store.Update(item.ID, func(current *domain.Session) error {
			if current.PendingKnowledgeReviewRequestID != requestID {
				return nil
			}
			current.PlannerInFlight = false
			if restoreTask {
				current.State = restoreState
				clearSessionFailure(current)
			}
			if discardReview {
				current.PendingKnowledgeReviewRequestID = ""
				current.PendingManualRequestIDs = removeString(current.PendingManualRequestIDs, requestID)
				current.LastManualPrompt = ""
				return nil
			}
			current.PendingManualRequestIDs = appendUnique(current.PendingManualRequestIDs, requestID)
			if rebuiltPrompt != "" {
				current.LastManualPrompt = rebuiltPrompt
			}
			return nil
		})
		if err != nil {
			continue
		}
		data := map[string]any{"request_id": requestID, "task_state_restored": restoreTask, "prompt_regenerated": rebuiltPrompt != "", "review_discarded": discardReview}
		if discardReview {
			if overlappedMainRequest {
				data["reason"] = "legacy knowledge review overlapped an active main request and shared one prompt slot"
			} else {
				data["reason"] = snapshotErr.Error()
			}
		}
		s.bus.Publish(item.ID, "knowledge.review_recovered", data)
	}
}

// normalizeOrphanedManualRequests closes legacy request chains whose only
// prompt was erased by an overlapping side review. Replaying an unknown or
// mismatched prompt is unsafe; retaining a phantom pending ID deadlocks every
// future request. The operator can use the ordinary fresh-request recovery.
func (s *Service) normalizeOrphanedManualRequests() {
	for _, item := range s.store.List() {
		if len(item.PendingManualRequestIDs) == 0 || strings.TrimSpace(item.LastManualPrompt) != "" || item.PendingKnowledgeReviewRequestID != "" {
			continue
		}
		_, err := s.store.Update(item.ID, func(current *domain.Session) error {
			if len(current.PendingManualRequestIDs) == 0 || strings.TrimSpace(current.LastManualPrompt) != "" || current.PendingKnowledgeReviewRequestID != "" {
				return nil
			}
			current.PendingManualRequestIDs = nil
			current.PlannerInFlight = false
			if state, ok := recoverPostApplyState(*current); ok {
				current.State = state
				clearSessionFailure(current)
				return nil
			}
			current.State = "failed"
			current.FailureKind = domain.FailureKindRemoteInputTransport
			current.LastRepairError = remoteInputFailurePrefix + "o pedido pendente legado perdeu a sua entrada; repita-o como um pedido novo"
			return nil
		})
		if err == nil {
			s.bus.Publish(item.ID, "request.orphan_recovered", map[string]any{"request_ids": item.PendingManualRequestIDs})
		}
	}
}
