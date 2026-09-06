package app

import (
	"context"
	"path/filepath"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
)

func manualContinuationEligible(item domain.Session) bool {
	if item.PlannerInFlight {
		return false
	}
	switch item.State {
	case "awaiting_plan", "workflow_pending", "repair_pending", "baseline_update_pending", "conflict_resolution_pending":
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
	case "awaiting_plan", "workflow_pending", "workflow_planned", "workflow_observed", "repair_pending", "planned", "verified", "baseline_update_pending", "conflict_resolution_pending":
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
				recordRequestContext(item, item.LastRequestID, item.Context)
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
		_, _ = s.store.Update(peer.ID, func(item *domain.Session) error {
			item.BaselineNotices = append(item.BaselineNotices, notice)
			if len(item.BaselineNotices) > maxRetainedBaselineNotices {
				item.BaselineNotices = append([]domain.BaselineNotice(nil), item.BaselineNotices[len(item.BaselineNotices)-maxRetainedBaselineNotices:]...)
			}
			return nil
		})
		s.bus.Publish(peer.ID, "baseline.peer_updated", map[string]any{"previous_sha256": notice.PreviousSHA256, "new_sha256": notice.NewSHA256, "changed_files": notice.ChangedFiles, "overlap_files": overlap, "relevant": relevant, "complete_delta": completeDelta, "source_plan_id": planID})
		// A notice is advisory while the original request is still pending. The
		// actual bundle write set is a stronger compatibility signal than an
		// early planner forecast, so do not supersede useful work here. Bundle
		// intake and host integration perform the authoritative reconciliation.
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
