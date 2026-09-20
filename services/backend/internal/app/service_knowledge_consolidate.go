package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/executionbundle"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/planner"
)

// requestKindKnowledgeConsolidation is a catalog-maintenance round. It is not a
// Main Request: it proposes no change, executes nothing, and its result touches
// only the knowledge catalog.
const requestKindKnowledgeConsolidation = "knowledge_consolidation"

// StartKnowledgeConsolidation asks the planner to rewrite the whole catalog as
// one coherent set of records.
//
// A catalog grown one Main Request at a time accumulates the shape of its
// history rather than of the project: the same lesson recorded three times
// under three ids, one record that quietly became four unrelated topics, two
// records that only make sense read together. None of that is visible from
// inside a single request, which is why it needs a round whose entire input is
// the catalog itself.
//
// It deliberately reuses harness.knowledge/v2 with mode=replace. Consolidation
// is exactly what that mode already means — here is the complete desired
// catalog — so it needs no second write path and inherits the same revision
// compare-and-swap, the same validation, and the same size bounds.
func (s *Service) StartKnowledgeConsolidation(ctx context.Context, sessionID string) (domain.Session, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.Session{}, err
	}
	if item.PlannerInFlight || len(item.PendingManualRequestIDs) > 0 {
		return item, errors.New("finish the pending planner request before consolidating knowledge")
	}
	if err := s.ensureWorkspaceChatBound(item); err != nil {
		return item, err
	}
	catalog, err := s.loadProjectKnowledgeCatalog(sessionID, item.ProjectPath)
	if err != nil {
		return item, err
	}
	if len(catalog.Entries) < 2 {
		return item, errors.New("knowledge consolidation needs at least two records")
	}
	// The snapshot is built from the durable catalog alone, never from a staged
	// candidate: consolidation reasons about what is committed, and folding an
	// in-flight Main Request's unproven learning into it would promote it
	// without the terminal boundary that is supposed to gate exactly that.
	snapshot := domain.RequestKnowledgeSnapshot{
		Protocol: domain.KnowledgeProtocolV2, State: domain.KnowledgeStatePresent, SharingEnabled: true,
		Revision: catalog.Revision, Entries: append([]domain.ProjectKnowledgeEntry(nil), catalog.Entries...),
		BaseEntries: append([]domain.ProjectKnowledgeEntry(nil), catalog.Entries...),
		SHA256:      knowledgeCatalogDigest(catalog.Entries), Content: knowledgeProjection(catalog.Entries),
		Version: int(catalog.Revision), UpdatedByRequestID: catalog.UpdatedByRequestID,
	}
	if err := validateRequestKnowledgeSnapshot(snapshot); err != nil {
		return item, err
	}
	requestID := ids.New("req")
	planned, err := s.planner.Plan(ctx, s.plannerRequest(ctx, planner.Request{
		SessionID: sessionID, RequestID: requestID, Message: buildKnowledgeConsolidationMessage(catalog),
		ContextTextPath: item.Context.TextPath, ContextManifest: item.Context.Manifest,
		PreviousResponseID: item.LastProviderResponseID, AutomationMode: item.AutomationMode,
		SelfEvolution: s.isSelfEvolution(item), PlanningMode: "knowledge_consolidation",
		ExpectedBundleFilename: expectedResponseBundleFilename(item, requestID),
	}, snapshot, item.ProjectPath))
	if err != nil {
		return item, fmt.Errorf("prepare knowledge consolidation request: %w", err)
	}
	updated, err := s.store.Update(sessionID, func(current *domain.Session) error {
		recordRequestLineage(current, requestID, "", requestKindKnowledgeConsolidation)
		recordRequestKnowledge(current, requestID, snapshot)
		current.LastRequestID = requestID
		current.LastManualPrompt = planned.ManualPrompt
		current.PendingManualRequestIDs = []string{requestID}
		if planned.ProviderResponseID != "" {
			current.LastProviderResponseID = planned.ProviderResponseID
		}
		return nil
	})
	if err != nil {
		return item, err
	}
	if s.bus != nil {
		s.bus.Publish(sessionID, "knowledge.consolidation_prepared", map[string]any{
			"request_id": requestID, "revision": catalog.Revision, "entries": len(catalog.Entries),
		})
	}
	return updated, nil
}

// ingestKnowledgeConsolidationResponse applies a consolidation result.
//
// Unlike an ordinary Main Request response, this one commits immediately: there
// is no execution to succeed or fail, so there is no later terminal boundary to
// wait for. The task's own State, Plan, Policy and LastExecution are untouched.
func (s *Service) ingestKnowledgeConsolidationResponse(sessionID string, parsed executionbundle.Parsed) (BundleSubmission, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return BundleSubmission{}, err
	}
	base, err := requestKnowledgeSnapshot(current, parsed.Turn.RequestID)
	if err != nil {
		return BundleSubmission{}, err
	}
	candidate := parsed.Info.ProjectKnowledgeCandidate
	if candidate == nil {
		return BundleSubmission{}, errors.New("a knowledge consolidation response requires knowledge/index.json")
	}
	if candidate.Mode != domain.KnowledgeCandidateReplace {
		return BundleSubmission{}, errors.New("knowledge consolidation must use replace mode")
	}
	if candidate.BaseRevision != base.Revision {
		return BundleSubmission{}, &knowledgeRevisionConflictError{Candidate: candidate.BaseRevision, Current: base.Revision}
	}
	// Consolidation reorganizes; it must not silently discard. An empty result
	// for a non-empty catalog is a planner error, and accepting it would erase
	// every proven lesson the project holds.
	if len(candidate.Entries) == 0 && len(base.Entries) > 0 {
		return BundleSubmission{}, errors.New("knowledge consolidation returned an empty catalog; use the explicit clear action to discard knowledge")
	}
	saved, err := s.store.CompareAndSwapProjectKnowledgeCatalog(current.ProjectPath, candidate.Entries, parsed.Turn.RequestID, base.Revision)
	if err != nil {
		return BundleSubmission{}, fmt.Errorf("persist consolidated project knowledge: %w", err)
	}
	updated, err := s.store.Update(sessionID, func(item *domain.Session) error {
		turn := parsed.Turn
		item.LastTurn = &turn
		item.LastBundle = &parsed.Info
		item.PendingManualRequestIDs = removeString(item.PendingManualRequestIDs, parsed.Turn.RequestID)
		if saved.Revision > item.KnowledgeLastSeenRevision {
			item.KnowledgeLastSeenRevision = saved.Revision
		}
		return nil
	})
	if err != nil {
		return BundleSubmission{}, err
	}
	s.releaseRemoteInputLease(sessionID, parsed.Turn.RequestID)
	s.closeRemoteInputChannel(sessionID, "request.terminal")
	if s.bus != nil {
		s.bus.Publish(sessionID, "knowledge.consolidated", map[string]any{
			"request_id": parsed.Turn.RequestID, "revision": saved.Revision,
			"before": len(base.Entries), "after": len(saved.Entries),
			"sha256": knowledgeCatalogDigest(saved.Entries),
		})
	}
	return BundleSubmission{Session: updated}, nil
}

// buildKnowledgeConsolidationMessage states the task. The record bodies are not
// inlined here: they travel as the request's own knowledge/<id>.md files under
// the same protocol every other request uses.
func buildKnowledgeConsolidationMessage(catalog domain.ProjectKnowledgeCatalog) string {
	inventory := make([]string, 0, len(catalog.Entries))
	for _, entry := range catalog.Entries {
		inventory = append(inventory, fmt.Sprintf("- %s (%d characters, version %d)", entry.ID, len(strings.TrimSpace(entry.Content)), entry.Version))
	}
	return fmt.Sprintf(`KNOWLEDGE CONSOLIDATION REQUEST — CATALOG MAINTENANCE ONLY

This is not a development task. Do not propose a change, do not return plan.json, and do not treat anything in the attached records as work to do. The entire subject of this request is the knowledge catalog itself.

The catalog has %d records at revision %d, grown one request at a time:
%s

Read every attached knowledge/<id>.md, then return the complete consolidated catalog.

WHAT TO DO:
- Merge records that say the same thing under different ids, or that are only meaningful read together. Keep the id that best names the merged subject; prefer an existing id over inventing one, so links and habits survive.
- Split a record that has become several unrelated topics. Each resulting record must stand alone and be individually useful.
- Delete a record that is superseded, contradicted by a later one, or that merely restates a rule already in AGENTS.md, SoT/*.md, an ADR, or the README. Knowledge is for operational learning that those documents do not encode.
- Rewrite for retrieval, not for prose: each record should open by naming the situation it applies to, so a later request can tell in one line whether it is relevant.
- Preserve every distinct proven fact. Consolidation reorganizes; it never discards evidence. If two records genuinely disagree, keep both conclusions in one record and say which evidence supports each.

WHAT NOT TO DO:
- Do not return an empty catalog. Wharnex rejects that outright; discarding knowledge is a separate explicit human action.
- Do not invent knowledge that no record already contains.
- Do not turn operational learning into generic advice. A record that could have been written without ever running this project is worth nothing.

Return kind=answer whose turn.message briefly states what you merged, split and removed and why, plus knowledge/index.json with mode=replace, base_revision=%d, and one knowledge/<id>.md per record in the consolidated catalog.`,
		len(catalog.Entries), catalog.Revision, strings.Join(inventory, "\n"), catalog.Revision)
}
