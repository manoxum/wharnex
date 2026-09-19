package app

import (
	"context"
	"errors"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

// FailRemoteInputRequest ends a request that cannot obtain its required remote
// input. Ordinary requests are terminal; a post-terminal knowledge_review is a
// best-effort side round and must never rewrite the task's already-successful
// state when its delivery fails.
func (s *Service) FailRemoteInputRequest(ctx context.Context, sessionID, requestID, reason string) (domain.Session, error) {
	return s.FailRemoteInputRequestWithKind(ctx, sessionID, requestID, reason, "transport")
}

func (s *Service) FailRemoteInputRequestWithKind(ctx context.Context, sessionID, requestID, reason, kind string) (domain.Session, error) {
	requestID = strings.TrimSpace(requestID)
	reason = strings.TrimSpace(reason)
	kind = strings.TrimSpace(kind)
	if kind == "" {
		kind = "transport"
	}
	if kind != "transport" && kind != "bundle_validation" && kind != "submodule_write" {
		return domain.Session{}, errors.New("unsupported remote input failure kind")
	}
	if requestID == "" || reason == "" || len(reason) > 512 {
		return domain.Session{}, errors.New("remote input failure requires a request id and bounded reason")
	}
	if kind == "submodule_write" && !strings.Contains(strings.ToLower(reason), strings.ToLower(ErrSubmoduleWrite.Error())) {
		return domain.Session{}, errors.New("submodule write failure requires the local submodule-write diagnostic")
	}
	knowledgeReviewFailure := false
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		// A durable session restored after a Desktop/backend restart can retain
		// the active request id while the transient pending-id slice is absent.
		// Permit only that exact current id; never let an older request close a
		// newer session. knowledge_review has a separate durable request id, so
		// its lineage/pending marker is also an admissible restored identity.
		pending := containsString(current.PendingManualRequestIDs, requestID)
		isKnowledgeReview := knowledgeReviewRequest(*current, requestID)
		inFlight := current.PlannerInFlight && current.LastRequestID == requestID
		if !pending && !inFlight && !isKnowledgeReview {
			return errors.New("remote input request is not pending")
		}
		if isKnowledgeReview {
			knowledgeReviewFailure = true
			current.PendingManualRequestIDs = removeString(current.PendingManualRequestIDs, requestID)
			if current.PendingKnowledgeReviewRequestID == requestID {
				current.PendingKnowledgeReviewRequestID = ""
				current.LastManualPrompt = ""
			}
			current.PlannerInFlight = false
			return nil
		}
		current.PendingManualRequestIDs = removeString(current.PendingManualRequestIDs, requestID)
		current.PlannerInFlight = false
		current.State = "failed"
		if kind == "submodule_write" {
			// This is a repository-topology refusal raised locally by Wharnex,
			// not a transport outage and not a planner defect. Repeating the
			// same request against the superproject can only reproduce it.
			current.LastRepairError = reason
			current.FailureKind = domain.FailureKindSubmoduleWrite
		} else {
			current.LastRepairError = "Remote input communication failed: " + reason
			current.FailureKind = domain.FailureKindRemoteInputTransport
		}
		return nil
	})
	if err != nil {
		return domain.Session{}, err
	}
	if !knowledgeReviewFailure {
		s.setProjectTodosByRequestLineage(updated, requestID, domain.ProjectTodoExecutionFailed, reason)
	}
	if knowledgeReviewFailure {
		s.releaseRemoteInputLease(sessionID, requestID)
		s.closeRemoteInputChannel(sessionID, "knowledge_review_delivery_failed")
		s.bus.Publish(sessionID, "knowledge.review_delivery_failed", map[string]any{"request_id": requestID, "reason": reason, "kind": kind})
		return updated, nil
	}
	closeReason := "transport_failed"
	if kind == "submodule_write" {
		closeReason = "bundle_submodule_write_rejected"
	}
	s.closeRemoteInputChannel(sessionID, closeReason)
	s.bus.Publish(sessionID, "remote_input.failed", map[string]any{"request_id": requestID, "reason": reason, "kind": kind})
	if kind == "bundle_validation" && updated.AutomationMode == domain.AutomationModeAuto && updated.RemoteRecoveryAttempt < 1 {
		recovered, retryErr := s.retryFailedRequest(ctx, sessionID, true)
		if retryErr != nil {
			s.bus.Publish(sessionID, "request.auto_recovery_failed", map[string]any{"replaces_request_id": requestID, "error": retryErr.Error()})
			return updated, nil
		}
		s.setProjectTodosByRequestLineage(recovered, recovered.LastRequestID, domain.ProjectTodoExecutionProcessing, "")
		s.bus.Publish(sessionID, "request.auto_recovery_prepared", map[string]any{"request_id": recovered.LastRequestID, "replaces_request_id": requestID, "attempt": recovered.RemoteRecoveryAttempt})
		return recovered, nil
	}
	return updated, nil
}
