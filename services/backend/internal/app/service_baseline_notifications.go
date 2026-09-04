package app

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/planner"
)

func manualContinuationEligible(item domain.Session) bool {
	if item.PlannerInFlight {
		return false
	}
	switch item.State {
	case "awaiting_plan", "workflow_pending", "repair_pending", "baseline_update_pending":
		return item.LastManualPrompt != ""
	default:
		return false
	}
}

func concurrentSessionActive(item domain.Session) bool {
	if item.PlannerInFlight || len(item.PendingManualRequestIDs) > 0 || len(item.PendingHostChanges) > 0 {
		return true
	}
	switch item.State {
	case "awaiting_plan", "workflow_pending", "workflow_planned", "workflow_observed", "repair_pending", "planned", "verified", "baseline_update_pending":
		return true
	default:
		return false
	}
}

func (s *Service) publishBaselineUpdate(ctx context.Context, source domain.Session, oldSHA, newSHA, planID string, changed []string) {
	changed = normalizedPaths(changed)
	if oldSHA == "" || newSHA == "" || oldSHA == newSHA {
		return
	}
	for _, peer := range s.store.List() {
		if peer.ID == source.ID || filepath.Clean(peer.ProjectPath) != filepath.Clean(source.ProjectPath) || !concurrentSessionActive(peer) {
			continue
		}
		peerBaseline := strings.TrimSpace(peer.Context.Manifest.SHA256)
		completeDelta := peerBaseline == strings.TrimSpace(oldSHA)
		_, _ = s.store.Update(peer.ID, func(item *domain.Session) error {
			if item.LastRequestID != "" {
				recordRequestBaseline(item, item.LastRequestID, peerBaseline)
			}
			return nil
		})
		refreshed, err := s.refreshContext(peer.ID)
		if err != nil {
			s.bus.Publish(peer.ID, "baseline.refresh_failed", map[string]any{"error": err.Error(), "new_sha256": newSHA})
			continue
		}
		peerCurrentSHA := strings.TrimSpace(refreshed.Context.Manifest.SHA256)
		if peerCurrentSHA == "" || peerCurrentSHA == peerBaseline {
			continue
		}
		forecast := planTouchedFiles(refreshed.Plan)
		for index := range refreshed.PendingHostChanges {
			forecast = append(forecast, planTouchedFiles(&refreshed.PendingHostChanges[index].Plan)...)
		}
		forecast = normalizedPaths(forecast)
		if refreshed.PlannerInFlight {
			forecast = nil
		}
		deltaFiles := changed
		if !completeDelta {
			deltaFiles = nil
		}
		overlap := overlapPaths(deltaFiles, forecast)
		relevant := !completeDelta || len(deltaFiles) == 0 || len(forecast) == 0 || len(overlap) > 0
		notice := domain.BaselineNotice{ID: ids.New("base"), SourceSessionID: source.ID, SourcePlanID: planID, PreviousSHA256: peerBaseline, NewSHA256: peerCurrentSHA, ChangedFiles: deltaFiles, OverlapFiles: overlap, Relevant: relevant, CompleteDelta: completeDelta, CreatedAt: time.Now().UTC()}
		updated, _ := s.store.Update(peer.ID, func(item *domain.Session) error {
			item.BaselineNotices = append(item.BaselineNotices, notice)
			if len(item.BaselineNotices) > 20 {
				item.BaselineNotices = append([]domain.BaselineNotice(nil), item.BaselineNotices[len(item.BaselineNotices)-20:]...)
			}
			return nil
		})
		s.bus.Publish(peer.ID, "baseline.peer_updated", map[string]any{"previous_sha256": notice.PreviousSHA256, "new_sha256": notice.NewSHA256, "changed_files": notice.ChangedFiles, "overlap_files": overlap, "relevant": relevant, "complete_delta": completeDelta, "source_plan_id": planID})
		if relevant && updated.AutomationMode == domain.AutomationModeAuto && manualContinuationEligible(updated) {
			s.prepareBaselineContinuation(updated, notice)
		}
	}
}

func (s *Service) prepareBaselineContinuation(item domain.Session, notice domain.BaselineNotice) {
	requestID := ids.New("req")
	message := fmt.Sprintf("WHARNESS CONCURRENT BASELINE UPDATE\n\nThe original user task remains active. Another parallel Harness chat successfully changed the host while this task was in flight. Re-evaluate your current work against the new baseline and continue the SAME user goal without restarting unrelated analysis.\n\nPREVIOUS BASELINE SHA256: %s\nNEW BASELINE SHA256: %s\nCHANGED FILES:\n- %s\nLIKELY OVERLAP:\n- %s\n\nIf the changed files do not affect your work, state that briefly and continue. If they do, adapt patches and verification to the new baseline. Any change plan must set base_context_sha256 to the NEW BASELINE SHA256 and refresh impact_files before producing patches.", notice.PreviousSHA256, notice.NewSHA256, strings.Join(notice.ChangedFiles, "\n- "), strings.Join(notice.OverlapFiles, "\n- "))
	prompt := planner.BuildManualPrompt(planner.Request{SessionID: item.ID, RequestID: requestID, Message: message, ContextTextPath: item.Context.TextPath, ContextManifest: item.Context.Manifest, PreviousResponseID: item.LastProviderResponseID, AutomationMode: item.AutomationMode, SelfEvolution: s.isSelfEvolution(item), PlanningMode: "direct"})
	_, err := s.store.Update(item.ID, func(current *domain.Session) error {
		current.LastRequestID = requestID
		current.LastManualPrompt = prompt
		current.PendingManualRequestIDs = appendUnique(current.PendingManualRequestIDs, requestID)
		current.State = "baseline_update_pending"
		recordRequestBaseline(current, requestID, item.Context.Manifest.SHA256)
		return nil
	})
	if err == nil {
		s.bus.Publish(item.ID, "baseline.continuation_ready", map[string]any{"request_id": requestID, "new_sha256": notice.NewSHA256, "source_plan_id": notice.SourcePlanID})
	}
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
