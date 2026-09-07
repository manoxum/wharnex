package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/executionbundle"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/planner"
)

// maxKnowledgeReviewHistoryEvents bounds the event history handed to the
// knowledge_review round, mirroring the cap already used for the
// self-evolution operational-evidence review (service_evolution_evidence.go).
const maxKnowledgeReviewHistoryEvents = 500

// knowledgeContentForProject returns the project's current incremental
// knowledge document, or "" if none has been recorded yet or the lookup
// fails. Never propagates an error: a knowledge-store outage must not block
// an ordinary request from being planned.
func (s *Service) knowledgeContentForProject(projectPath string) string {
	item, ok, err := s.store.GetProjectKnowledge(projectPath)
	if err != nil || !ok {
		return ""
	}
	return item.Content
}

// triggerKnowledgeReview prepares the optional, best-effort final round of a
// task: sent only after a change was successfully applied to the host (see
// the three call sites in service.go). It never mutates State/Plan/Policy/
// LastExecution — the apply that triggered it already succeeded and that is
// the result the user sees; this round is a side-channel on top of it.
//
// Errors are logged via an event and swallowed: failing to prepare this
// round must never surface as a failure of the apply that just succeeded.
func (s *Service) triggerKnowledgeReview(ctx context.Context, sessionID string) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return
	}
	history := s.bus.History(sessionID)
	if len(history) > maxKnowledgeReviewHistoryEvents {
		history = history[len(history)-maxKnowledgeReviewHistoryEvents:]
	}
	historyJSON, err := json.Marshal(history)
	if err != nil {
		s.bus.Publish(sessionID, "knowledge.review_prepare_failed", map[string]any{"error": err.Error()})
		return
	}
	requestID := ids.New("req")
	planned, err := s.planner.Plan(ctx, planner.Request{
		SessionID: sessionID, RequestID: requestID,
		Message:                string(historyJSON),
		ContextTextPath:        item.Context.TextPath,
		ContextManifest:        item.Context.Manifest,
		PreviousResponseID:     item.LastProviderResponseID,
		AutomationMode:         item.AutomationMode,
		SelfEvolution:          s.isSelfEvolution(item),
		PlanningMode:           "knowledge_review",
		KnowledgeSource:        s.knowledgeContentForProject(item.ProjectPath),
		ExpectedBundleFilename: expectedResponseBundleFilenameForDerivedRequest(item, requestID, item.LastRequestID),
	})
	if err != nil {
		s.bus.Publish(sessionID, "knowledge.review_prepare_failed", map[string]any{"error": err.Error()})
		return
	}
	_, err = s.store.Update(sessionID, func(current *domain.Session) error {
		recordRequestLineage(current, requestID, item.LastRequestID, requestKindKnowledgeReview)
		current.PendingKnowledgeReviewRequestID = requestID
		current.PendingManualRequestIDs = append(current.PendingManualRequestIDs, requestID)
		current.LastManualPrompt = planned.ManualPrompt
		if planned.ProviderResponseID != "" {
			current.LastProviderResponseID = planned.ProviderResponseID
		}
		return nil
	})
	if err != nil {
		s.bus.Publish(sessionID, "knowledge.review_prepare_failed", map[string]any{"error": err.Error()})
		return
	}
	s.bus.Publish(sessionID, "knowledge.review_prepared", map[string]any{"request_id": requestID})
}

// ingestKnowledgeReviewResponse handles the response bundle for a
// knowledge_review round. It is reached only when the response's request_id
// has RequestLineage.Kind == requestKindKnowledgeReview (see
// SubmitExecutionBundle) — this is the ONLY code path that ever reads
// ProjectKnowledgeUpdate, which is what makes "the knowledge source can only
// be updated at the end" an invariant of the code rather than a convention:
// a knowledge.md smuggled into any other response is simply never looked at.
//
// Deliberately does not touch State/Plan/Policy/LastExecution: this round
// never carries a plan, and the session's real terminal state (already
// applied/restart_pending/...) must be left exactly as it is.
func (s *Service) ingestKnowledgeReviewResponse(sessionID string, parsed executionbundle.Parsed) (BundleSubmission, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return BundleSubmission{}, err
	}
	updatedKnowledge := false
	if content := strings.TrimSpace(parsed.Info.ProjectKnowledgeUpdate); content != "" {
		if _, err := s.store.AppendProjectKnowledge(current.ProjectPath, content, parsed.Turn.RequestID); err != nil {
			return BundleSubmission{}, fmt.Errorf("persist project knowledge: %w", err)
		}
		updatedKnowledge = true
	}
	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		turn := parsed.Turn
		item.LastTurn = &turn
		item.LastBundle = &parsed.Info
		item.PendingKnowledgeReviewRequestID = ""
		item.PendingManualRequestIDs = removeString(item.PendingManualRequestIDs, parsed.Turn.RequestID)
		return nil
	})
	if err != nil {
		return BundleSubmission{}, err
	}
	s.releaseRemoteInputLease(sessionID, parsed.Turn.RequestID)
	s.closeRemoteInputChannel(sessionID, "request.terminal")
	s.bus.Publish(sessionID, "knowledge.updated", map[string]any{"request_id": parsed.Turn.RequestID, "updated": updatedKnowledge})
	return BundleSubmission{Session: updated}, nil
}
