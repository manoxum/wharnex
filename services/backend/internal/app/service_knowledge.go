package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/executionbundle"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/planner"
	"kernl.local/harness/backend/internal/projectknowledge"
	"kernl.local/harness/backend/internal/session"
)

const (
	maxKnowledgeReviewHistoryEvents  = 500
	maxKnowledgeReviewCriticalEvents = 200
	maxKnowledgeReviewRoundsPerRoot  = 2
)

func knowledgeDigest(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

func knowledgeCatalogDigest(entries []domain.ProjectKnowledgeEntry) string {
	entries = append([]domain.ProjectKnowledgeEntry(nil), entries...)
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	hash := sha256.New()
	for _, entry := range entries {
		_, _ = hash.Write([]byte(entry.ID))
		_, _ = hash.Write([]byte{0})
		_, _ = hash.Write([]byte(strings.TrimSpace(entry.Content)))
		_, _ = hash.Write([]byte{0})
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func knowledgeProjection(entries []domain.ProjectKnowledgeEntry) string {
	entries = append([]domain.ProjectKnowledgeEntry(nil), entries...)
	sort.Slice(entries, func(i, j int) bool { return entries[i].ID < entries[j].ID })
	parts := make([]string, 0, len(entries))
	for _, entry := range entries {
		parts = append(parts, "## "+entry.ID+"\n\n"+strings.TrimSpace(entry.Content))
	}
	return strings.Join(parts, "\n\n")
}

func knowledgeSharingEnabled(item domain.Session) bool {
	return item.KnowledgeSharingEnabled == nil || *item.KnowledgeSharingEnabled
}

func knowledgeManifest(snapshot domain.RequestKnowledgeSnapshot) map[string]any {
	entries := make([]map[string]any, 0, len(snapshot.Entries))
	for _, entry := range snapshot.Entries {
		entries = append(entries, map[string]any{
			"id": entry.ID, "path": "knowledge/" + entry.ID + ".md", "version": entry.Version,
			"sha256": knowledgeDigest(strings.TrimSpace(entry.Content)), "updated_by_request_id": entry.UpdatedByRequestID,
		})
	}
	return map[string]any{
		"protocol": snapshot.Protocol, "state": snapshot.State, "sharing_enabled": snapshot.SharingEnabled, "revision": snapshot.Revision,
		"sha256": snapshot.SHA256, "updated_by_request_id": snapshot.UpdatedByRequestID, "entries": entries,
	}
}

func validateRequestKnowledgeSnapshot(snapshot domain.RequestKnowledgeSnapshot) error {
	if snapshot.Revision < 0 || snapshot.Version < 0 {
		return errors.New("knowledge revision is invalid")
	}
	switch snapshot.State {
	case domain.KnowledgeStateNone:
		if len(snapshot.Entries) != 0 || snapshot.SHA256 != "" {
			return errors.New("knowledge state none contains catalog entries")
		}
		return nil
	case domain.KnowledgeStatePresent:
		if len(snapshot.Entries) > 0 {
			if !snapshot.SharingEnabled || snapshot.SHA256 == "" {
				return errors.New("knowledge state present is incomplete")
			}
			if knowledgeCatalogDigest(snapshot.Entries) != snapshot.SHA256 {
				return errors.New("knowledge catalog sha256 does not match request snapshot")
			}
			return nil
		}
		// Compatibility for a request persisted before the v2 catalog existed.
		if strings.TrimSpace(snapshot.Content) == "" || snapshot.Version < 1 || snapshot.SHA256 == "" {
			return errors.New("legacy knowledge state present is incomplete")
		}
		if knowledgeDigest(snapshot.Content) != snapshot.SHA256 {
			return errors.New("knowledge content sha256 does not match request snapshot")
		}
		return nil
	default:
		return fmt.Errorf("invalid knowledge state %q", snapshot.State)
	}
}

func effectivePendingKnowledge(item domain.Session, catalog domain.ProjectKnowledgeCatalog) []domain.ProjectKnowledgeEntry {
	candidate := item.PendingKnowledgeCandidate
	if candidate == nil {
		return append([]domain.ProjectKnowledgeEntry(nil), catalog.Entries...)
	}
	if candidate.Mode == domain.KnowledgeCandidateReplace {
		if candidate.BaseRevision == catalog.Revision {
			return append([]domain.ProjectKnowledgeEntry(nil), candidate.Entries...)
		}
		if snapshot, ok := item.RequestKnowledge[item.PendingKnowledgeCandidateRequestID]; ok {
			return reconcileKnowledgeCandidate(*candidate, snapshot.Entries, catalog)
		}
	}
	merged := make(map[string]domain.ProjectKnowledgeEntry, len(catalog.Entries)+len(candidate.Entries))
	for _, entry := range catalog.Entries {
		merged[entry.ID] = entry
	}
	for _, entry := range candidate.Entries {
		merged[entry.ID] = entry
	}
	out := make([]domain.ProjectKnowledgeEntry, 0, len(merged))
	for _, entry := range merged {
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (s *Service) loadRequestKnowledge(sessionID, projectPath string) (domain.RequestKnowledgeSnapshot, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return domain.RequestKnowledgeSnapshot{}, err
	}
	catalog, err := s.loadProjectKnowledgeCatalog(sessionID, projectPath)
	if err != nil {
		if s.bus != nil {
			s.bus.Publish(sessionID, "knowledge.load_failed", map[string]any{"error": err.Error()})
		}
		return domain.RequestKnowledgeSnapshot{}, fmt.Errorf("load project knowledge: %w", err)
	}
	sharing := knowledgeSharingEnabled(item)
	forcedRefresh := catalog.Revision > item.KnowledgeLastSeenRevision
	if forcedRefresh {
		sharing = true
		value := true
		_, _ = s.store.Update(sessionID, func(current *domain.Session) error {
			current.KnowledgeSharingEnabled = &value
			return nil
		})
	}
	entries := effectivePendingKnowledge(item, catalog)
	snapshot := domain.RequestKnowledgeSnapshot{
		Protocol: domain.KnowledgeProtocolV2, Revision: catalog.Revision, SharingEnabled: sharing,
		BaseEntries: append([]domain.ProjectKnowledgeEntry(nil), catalog.Entries...),
	}
	if sharing && len(entries) > 0 {
		snapshot.State = domain.KnowledgeStatePresent
		snapshot.Entries = entries
		snapshot.SHA256 = knowledgeCatalogDigest(entries)
		snapshot.Content = knowledgeProjection(entries)
		snapshot.Version = int(catalog.Revision)
		snapshot.UpdatedByRequestID = catalog.UpdatedByRequestID
	} else {
		snapshot.State = domain.KnowledgeStateNone
	}
	if err := validateRequestKnowledgeSnapshot(snapshot); err != nil {
		return domain.RequestKnowledgeSnapshot{}, err
	}
	if s.bus != nil {
		s.bus.Publish(sessionID, "knowledge.loaded", map[string]any{
			"state": snapshot.State, "sharing_enabled": sharing, "revision": catalog.Revision,
			"entries": len(snapshot.Entries), "forced_refresh": forcedRefresh, "sha256": snapshot.SHA256,
		})
	}
	return snapshot, nil
}

func (s *Service) loadProjectKnowledgeCatalog(sessionID, projectPath string) (domain.ProjectKnowledgeCatalog, error) {
	// The project-side files are the collaboration surface. Read the DB first
	// and the files second on every CAS attempt: if another chat commits between
	// those reads, CAS fails and the next iteration observes both fresh states
	// instead of writing an older file snapshot back over the newer catalog.
	for attempt := 0; attempt < 3; attempt++ {
		current, ok, err := s.store.GetProjectKnowledgeCatalog(projectPath)
		if err != nil {
			return domain.ProjectKnowledgeCatalog{}, err
		}
		if !ok {
			current = domain.ProjectKnowledgeCatalog{ProjectPath: projectPath, Entries: []domain.ProjectKnowledgeEntry{}}
		}
		fileEntries, filesPresent, err := projectknowledge.Load(projectPath)
		if err != nil {
			return domain.ProjectKnowledgeCatalog{}, fmt.Errorf("read %s: %w", projectknowledge.DirectoryName, err)
		}
		if !filesPresent || (ok && sameKnowledgeCatalog(fileEntries, current.Entries)) {
			return current, nil
		}
		saved, err := s.store.CompareAndSwapProjectKnowledgeCatalog(projectPath, fileEntries, "project-file-sync", current.Revision)
		if err == nil {
			if s.bus != nil {
				s.bus.Publish(sessionID, "knowledge.files_imported", map[string]any{"revision": saved.Revision, "entries": len(saved.Entries), "path": projectknowledge.DirectoryName})
			}
			return saved, nil
		}
		if !errors.Is(err, session.ErrProjectKnowledgeConflict) {
			return domain.ProjectKnowledgeCatalog{}, err
		}
	}
	return domain.ProjectKnowledgeCatalog{}, session.ErrProjectKnowledgeConflict
}

func withPlannerKnowledge(request planner.Request, snapshot domain.RequestKnowledgeSnapshot) planner.Request {
	request.KnowledgeEntries = append([]domain.ProjectKnowledgeEntry(nil), snapshot.Entries...)
	request.KnowledgeRevision = snapshot.Revision
	request.KnowledgeSharingEnabled = snapshot.SharingEnabled
	request.KnowledgeSource = snapshot.Content
	request.KnowledgeVersion = snapshot.Version
	request.KnowledgeSHA256 = snapshot.SHA256
	request.KnowledgeUpdatedByRequestID = snapshot.UpdatedByRequestID
	return request
}

func recordRequestKnowledge(item *domain.Session, requestID string, snapshot domain.RequestKnowledgeSnapshot) {
	if item.RequestKnowledge == nil {
		item.RequestKnowledge = map[string]domain.RequestKnowledgeSnapshot{}
	}
	item.RequestKnowledge[requestID] = snapshot
	if snapshot.SharingEnabled && snapshot.Revision > item.KnowledgeLastSeenRevision {
		item.KnowledgeLastSeenRevision = snapshot.Revision
	}
}

func requestKnowledgeSnapshot(item domain.Session, requestID string) (domain.RequestKnowledgeSnapshot, error) {
	snapshot, ok := item.RequestKnowledge[requestID]
	if !ok {
		return domain.RequestKnowledgeSnapshot{}, fmt.Errorf("knowledge snapshot for request %s is unavailable", requestID)
	}
	if err := validateRequestKnowledgeSnapshot(snapshot); err != nil {
		return domain.RequestKnowledgeSnapshot{}, err
	}
	return snapshot, nil
}

func knowledgeReviewCritical(event domain.Event) bool {
	t := strings.ToLower(event.Type)
	for _, marker := range []string{"fail", "block", "conflict", "repair", "patch", "changeset", "integration", "apply", "rollback", "host.", "command.completed", "execution.completed"} {
		if strings.Contains(t, marker) {
			return true
		}
	}
	if code, ok := event.Data["exit_code"]; ok && fmt.Sprint(code) != "0" {
		return true
	}
	if success, ok := event.Data["success"].(bool); ok && !success {
		return true
	}
	return false
}

// selectKnowledgeReviewHistory keeps task boundaries, all important failure /
// repair / integration evidence up to a bounded critical cap, then fills the
// remaining budget with the newest events. This prevents an early patch
// failure from disappearing merely because a long task emitted >500 events.
func selectKnowledgeReviewHistory(history []domain.Event) []domain.Event {
	if len(history) <= maxKnowledgeReviewHistoryEvents {
		return history
	}
	selected := map[int]struct{}{}
	for i := 0; i < len(history) && i < 20; i++ {
		selected[i] = struct{}{}
	}
	critical := 0
	for i, event := range history {
		if critical >= maxKnowledgeReviewCriticalEvents {
			break
		}
		if knowledgeReviewCritical(event) {
			selected[i] = struct{}{}
			critical++
		}
	}
	for i := len(history) - 1; i >= 0 && len(selected) < maxKnowledgeReviewHistoryEvents; i-- {
		selected[i] = struct{}{}
	}
	out := make([]domain.Event, 0, len(selected))
	for i, event := range history {
		if _, ok := selected[i]; ok {
			out = append(out, event)
		}
	}
	return out
}

func knowledgeReviewRoot(item domain.Session, requestID string) string {
	if lineage, ok := item.RequestLineages[requestID]; ok && lineage.RootRequestID != "" {
		return lineage.RootRequestID
	}
	return requestID
}

func knowledgeReviewCount(item domain.Session, rootID string) int {
	count := 0
	for _, lineage := range item.RequestLineages {
		if lineage.Kind == requestKindKnowledgeReview && lineage.RootRequestID == rootID {
			count++
		}
	}
	return count
}

func (s *Service) triggerKnowledgeReview(ctx context.Context, sessionID string) {
	s.triggerKnowledgeReviewWithOptions(ctx, sessionID, "", false)
}

func (s *Service) triggerKnowledgeReviewWithOptions(ctx context.Context, sessionID, reconciliationCandidate string, allowRepeat bool) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return
	}
	rootID := knowledgeReviewRoot(item, item.LastRequestID)
	if item.PendingKnowledgeReviewRequestID != "" {
		s.bus.Publish(sessionID, "knowledge.review_skipped", map[string]any{"reason": "review_pending", "root_request_id": rootID})
		return
	}
	count := knowledgeReviewCount(item, rootID)
	if (count > 0 && !allowRepeat) || count >= maxKnowledgeReviewRoundsPerRoot {
		s.bus.Publish(sessionID, "knowledge.review_skipped", map[string]any{"reason": "review_limit", "root_request_id": rootID, "rounds": count})
		return
	}
	snapshot, err := s.loadRequestKnowledge(sessionID, item.ProjectPath)
	if err != nil {
		s.bus.Publish(sessionID, "knowledge.review_skipped", map[string]any{"reason": "knowledge_load_failed", "root_request_id": rootID})
		return
	}
	history := selectKnowledgeReviewHistory(s.bus.History(sessionID))
	historyJSON, err := json.Marshal(history)
	if err != nil {
		s.bus.Publish(sessionID, "knowledge.review_prepare_failed", map[string]any{"error": err.Error()})
		return
	}
	message := string(historyJSON)
	if strings.TrimSpace(reconciliationCandidate) != "" {
		message += "\n\nCONCURRENT KNOWLEDGE CANDIDATE FROM THE PREVIOUS REVIEW (merge its still-valid operational learning with the current document; do not blindly overwrite newer knowledge):\n" + reconciliationCandidate
	}
	requestID := ids.New("req")
	planned, err := s.planner.Plan(ctx, s.plannerRequest(ctx, planner.Request{
		SessionID: sessionID, RequestID: requestID, Message: message,
		ContextTextPath: item.Context.TextPath, ContextManifest: item.Context.Manifest,
		PreviousResponseID: item.LastProviderResponseID, AutomationMode: item.AutomationMode,
		SelfEvolution: s.isSelfEvolution(item), PlanningMode: "knowledge_review",
		ExpectedBundleFilename: expectedResponseBundleFilenameForDerivedRequest(item, requestID, item.LastRequestID),
	}, snapshot, item.ProjectPath))
	if err != nil {
		s.bus.Publish(sessionID, "knowledge.review_prepare_failed", map[string]any{"error": err.Error()})
		return
	}
	_, err = s.store.Update(sessionID, func(current *domain.Session) error {
		recordRequestLineage(current, requestID, item.LastRequestID, requestKindKnowledgeReview)
		recordRequestKnowledge(current, requestID, snapshot)
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
	s.bus.Publish(sessionID, "knowledge.review_prepared", map[string]any{"request_id": requestID, "root_request_id": rootID, "base_version": snapshot.Version, "base_sha256": snapshot.SHA256, "reconciliation": allowRepeat})
}

// ingestKnowledgeReviewResponse updates only the curated knowledge side-state;
// it never changes the task's terminal State/Plan/Policy/LastExecution.
func (s *Service) ingestKnowledgeReviewResponse(ctx context.Context, sessionID string, parsed executionbundle.Parsed) (BundleSubmission, error) {
	current, err := s.store.Get(sessionID)
	if err != nil {
		return BundleSubmission{}, err
	}
	base, err := requestKnowledgeSnapshot(current, parsed.Turn.RequestID)
	if err != nil {
		return BundleSubmission{}, err
	}
	updatedKnowledge := false
	conflicted := false
	candidate := strings.TrimSpace(parsed.Info.ProjectKnowledgeUpdate)
	if candidate != "" {
		if _, err := s.store.CompareAndSwapProjectKnowledge(current.ProjectPath, candidate, parsed.Turn.RequestID, base.Version); err != nil {
			if !errors.Is(err, session.ErrProjectKnowledgeConflict) {
				return BundleSubmission{}, fmt.Errorf("persist project knowledge: %w", err)
			}
			conflicted = true
			s.bus.Publish(sessionID, "knowledge.update_conflict", map[string]any{"request_id": parsed.Turn.RequestID, "base_version": base.Version, "base_sha256": base.SHA256})
		} else {
			updatedKnowledge = true
		}
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
	if updatedKnowledge {
		if saved, ok, readErr := s.store.GetProjectKnowledge(current.ProjectPath); readErr == nil && ok {
			s.bus.Publish(sessionID, "knowledge.updated", map[string]any{"request_id": parsed.Turn.RequestID, "version": saved.Version, "sha256": knowledgeDigest(saved.Content)})
		}
	} else {
		s.bus.Publish(sessionID, "knowledge.updated", map[string]any{"request_id": parsed.Turn.RequestID, "updated": false})
	}
	if conflicted && candidate != "" {
		s.triggerKnowledgeReviewWithOptions(ctx, sessionID, candidate, true)
		if refreshed, getErr := s.store.Get(sessionID); getErr == nil {
			updated = refreshed
		}
	}
	return BundleSubmission{Session: updated}, nil
}
