package app

import (
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/executionbundle"
	"kernl.local/harness/backend/internal/session"
)

func (s *Service) SetKnowledgeSharingEnabled(sessionID string, enabled bool) (domain.Session, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return current, err
	}
	acknowledgedRevision := current.KnowledgeLastSeenRevision
	if !enabled {
		catalog, loadErr := s.loadProjectKnowledgeCatalog(sessionID, current.ProjectPath)
		if loadErr != nil {
			return current, loadErr
		}
		if catalog.Revision > acknowledgedRevision {
			acknowledgedRevision = catalog.Revision
		}
	}
	value := enabled
	item, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.KnowledgeSharingEnabled = &value
		if !enabled && acknowledgedRevision > current.KnowledgeLastSeenRevision {
			current.KnowledgeLastSeenRevision = acknowledgedRevision
		}
		return nil
	})
	if err == nil && s.bus != nil {
		s.bus.Publish(sessionID, "knowledge.sharing_changed", map[string]any{"enabled": enabled, "acknowledged_revision": acknowledgedRevision})
	}
	return item, err
}

func (s *Service) stageResponseKnowledge(sessionID string, parsed executionbundle.Parsed) error {
	candidate := parsed.Info.ProjectKnowledgeCandidate
	summary := strings.TrimSpace(parsed.Info.CumulativeSummary)
	current, err := s.store.Get(sessionID)
	if err != nil {
		return err
	}
	snapshot, snapshotErr := requestKnowledgeSnapshot(current, parsed.Turn.RequestID)
	if snapshotErr != nil {
		return snapshotErr
	}
	// Requests prepared before the v2 protocol did not ask ChatGPT for these
	// artifacts. Ignore opportunistic v2-looking extras on those old requests
	// rather than applying semantics the planner was never told to follow.
	if snapshot.Protocol != domain.KnowledgeProtocolV2 {
		return nil
	}
	if candidate == nil {
		return errors.New("v2 response bundle requires knowledge/index.json")
	}
	if summary == "" {
		return errors.New("v2 response bundle requires non-empty summary.md")
	}
	rootID := knowledgeReviewRoot(current, parsed.Turn.RequestID)
	if candidate != nil {
		if candidate.BaseRevision != snapshot.Revision {
			// Pure concurrency: a peer chat committed knowledge while this
			// request was in flight, so the candidate was authored against an
			// older catalog. Applying a stale `replace` would delete entries
			// the planner never saw, so the candidate is still refused — but
			// as a distinguishable, non-protocol condition, because the
			// caller must keep the response bundle's executable payload
			// rather than discard a verified change over catalog drift.
			return &knowledgeRevisionConflictError{Candidate: candidate.BaseRevision, Current: snapshot.Revision}
		}
		if snapshot.SharingEnabled && candidate.Mode != domain.KnowledgeCandidateReplace {
			return errors.New("knowledge response must use replace mode when the request received the catalog")
		}
		if !snapshot.SharingEnabled && candidate.Mode != domain.KnowledgeCandidateOverlay {
			return errors.New("knowledge response must use overlay mode when sharing was disabled")
		}
	}
	_, err = s.store.Update(sessionID, func(item *domain.Session) error {
		if item.PendingKnowledgeRootRequestID != "" && item.PendingKnowledgeRootRequestID != rootID {
			item.PendingKnowledgeCandidateRequestID = ""
			item.PendingKnowledgeCandidate = nil
			item.PendingKnowledgeSummary = ""
		}
		item.PendingKnowledgeRootRequestID = rootID
		if candidate != nil {
			item.PendingKnowledgeCandidateRequestID = parsed.Turn.RequestID
			copyCandidate := *candidate
			copyCandidate.Entries = append([]domain.ProjectKnowledgeEntry(nil), candidate.Entries...)
			item.PendingKnowledgeCandidate = &copyCandidate
		}
		if summary != "" {
			item.PendingKnowledgeSummary = summary
		}
		return nil
	})
	if err == nil && s.bus != nil {
		s.bus.Publish(sessionID, "knowledge.staged", map[string]any{"request_id": parsed.Turn.RequestID, "root_request_id": rootID, "entries": knowledgeCandidateLen(candidate), "summary": summary != ""})
	}
	return err
}

func knowledgeCandidateLen(candidate *domain.ProjectKnowledgeCandidate) int {
	if candidate == nil {
		return 0
	}
	return len(candidate.Entries)
}

func (s *Service) commitPendingKnowledge(sessionID, terminalRequestID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return item, err
	}
	rootID := knowledgeReviewRoot(item, terminalRequestID)
	if item.PendingKnowledgeRootRequestID == "" || item.PendingKnowledgeRootRequestID != rootID {
		return item, nil
	}
	candidate := item.PendingKnowledgeCandidate
	summary := strings.TrimSpace(item.PendingKnowledgeSummary)
	newRevision := item.KnowledgeLastSeenRevision
	catalogChanged := false
	hadRepairEvidence := attemptLedgerHasRepairEvidence(item, rootID)
	if candidate != nil {
		sourceRequestID := strings.TrimSpace(item.PendingKnowledgeCandidateRequestID)
		if sourceRequestID == "" {
			sourceRequestID = terminalRequestID
		}
		base, err := requestKnowledgeSnapshot(item, sourceRequestID)
		if err != nil {
			return item, err
		}
		baseEntries := base.BaseEntries
		if baseEntries == nil {
			// Compatibility with request snapshots persisted before v2 learned to
			// distinguish the durable catalog from a staged cumulative view.
			baseEntries = base.Entries
		}
		for attempt := 0; attempt < 3; attempt++ {
			current, ok, err := s.store.GetProjectKnowledgeCatalog(item.ProjectPath)
			if err != nil {
				return item, err
			}
			if !ok {
				current = domain.ProjectKnowledgeCatalog{ProjectPath: item.ProjectPath, Entries: []domain.ProjectKnowledgeEntry{}}
			}
			desired := reconcileKnowledgeCandidate(*candidate, baseEntries, current)
			// The local database is the only store. Knowledge is no longer
			// written into the project tree, so committing it can never dirty
			// the operator's working tree, collide in a merge, or arrive in
			// someone else's checkout without them choosing to import it.
			if sameKnowledgeCatalog(desired, current.Entries) {
				newRevision = current.Revision
				break
			}
			saved, err := s.store.CompareAndSwapProjectKnowledgeCatalog(item.ProjectPath, desired, terminalRequestID, current.Revision)
			if err == nil {
				newRevision = saved.Revision
				catalogChanged = true
				if s.bus != nil {
					s.bus.Publish(sessionID, "knowledge.updated", map[string]any{"request_id": terminalRequestID, "revision": saved.Revision, "entries": len(saved.Entries), "sha256": knowledgeCatalogDigest(saved.Entries), "store": "database"})
				}
				break
			}
			if !errors.Is(err, session.ErrProjectKnowledgeConflict) || attempt == 2 {
				return item, fmt.Errorf("persist project knowledge catalog: %w", err)
			}
		}
	}
	summary = canonicalKnowledgeSummary(summary, catalogChanged)
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		current.LastMainRequestSummary = summary
		current.PendingKnowledgeRootRequestID = ""
		current.PendingKnowledgeCandidateRequestID = ""
		current.PendingKnowledgeCandidate = nil
		current.PendingKnowledgeSummary = ""
		// The Main Request reached its real terminal boundary, so the durable
		// catalog above now holds whatever of this session's learning was worth
		// keeping. The attempt ledger was the scaffolding used to reach that
		// conclusion and has no authority past this point.
		clearAttemptLedger(current, rootID)
		if newRevision > current.KnowledgeLastSeenRevision {
			current.KnowledgeLastSeenRevision = newRevision
		}
		return nil
	})
	if err == nil && s.bus != nil && summary != "" {
		s.bus.Publish(sessionID, "main_request.summary_ready", map[string]any{"request_id": terminalRequestID, "root_request_id": rootID, "summary": summary})
	}
	if err == nil && s.bus != nil && hadRepairEvidence && candidate != nil && !catalogChanged {
		s.bus.Publish(sessionID, "knowledge.promotion_missing", map[string]any{
			"request_id": terminalRequestID, "root_request_id": rootID,
			"reason": "the Main Request reached its terminal boundary after a measured repair failure, but the durable knowledge catalog did not change",
		})
	}
	return updated, err
}

func canonicalKnowledgeSummary(summary string, catalogChanged bool) string {
	const heading = "## Conhecimento adquirido"
	lines := strings.Split(strings.ReplaceAll(strings.TrimSpace(summary), "\r\n", "\n"), "\n")
	kept := make([]string, 0, len(lines))
	skipping := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.EqualFold(trimmed, heading) {
			skipping = true
			continue
		}
		if skipping {
			if strings.HasPrefix(trimmed, "## ") {
				skipping = false
			} else {
				continue
			}
		}
		kept = append(kept, line)
	}
	base := strings.TrimSpace(strings.Join(kept, "\n"))
	if base == "" {
		base = "Resumo final da Main Request."
	}
	outcome := "Não. Esta Main Request não gerou novo conhecimento durável para persistir."
	if catalogChanged {
		outcome = "Sim. O catálogo de conhecimento durável do projeto foi atualizado nesta Main Request."
	}
	return base + "\n\n" + heading + "\n\n" + outcome
}

func attemptLedgerHasRepairEvidence(item domain.Session, rootID string) bool {
	ledger := attemptLedgerForRoot(item, rootID)
	if ledger == nil {
		return false
	}
	for _, round := range ledger.Rounds {
		switch round.Outcome {
		case domain.AttemptOutcomeVerificationFailed, domain.AttemptOutcomeIntegrationFailed, domain.AttemptOutcomeConflict, domain.AttemptOutcomeInfrastructure:
			return true
		}
	}
	return false
}

// knowledgeRevisionConflictError marks a knowledge candidate that was authored
// against a catalog revision a peer chat has since superseded. It is a
// concurrency outcome, not a planner protocol violation, and it must never
// invalidate the response bundle it travelled with.
type knowledgeRevisionConflictError struct {
	Candidate int64
	Current   int64
}

func (e *knowledgeRevisionConflictError) Error() string {
	return fmt.Sprintf("knowledge candidate base_revision %d does not match request revision %d", e.Candidate, e.Current)
}
