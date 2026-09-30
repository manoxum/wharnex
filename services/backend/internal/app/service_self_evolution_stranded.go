package app

import (
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/selfevolution"
)

// A failed host build can leave an older session claiming restart_pending
// even though its verified candidate was never applied. Once the active
// transaction has restarted or aborted, keep that candidate available for
// Apply and preserve the original failure evidence.
func (s *Service) reconcileUnappliedRestartConfirmations(status selfevolution.Status) {
	if status.Phase != "restarted" && status.Phase != "aborted" {
		return
	}
	for _, candidate := range s.store.List() {
		if !s.unappliedRestartConfirmation(candidate) {
			continue
		}
		_, changed, err := s.updateSessionIfChanged(candidate.ID, func(current *domain.Session) error {
			if !s.unappliedRestartConfirmation(*current) {
				return nil
			}
			current.State = "verified"
			current.SelfEvolutionActivation = ""
			current.SelfEvolutionImpacts = nil
			return nil
		})
		if err == nil && changed {
			s.bus.Publish(candidate.ID, "self_evolution.unapplied_confirmation_recovered", map[string]any{
				"reason": "no host apply evidence or pending restart transaction; verified candidate retained",
			})
		}
	}
}

func (s *Service) unappliedRestartConfirmation(item domain.Session) bool {
	if !s.isSelfEvolution(item) || !item.LastHostAppliedAt.IsZero() || len(item.PendingHostChanges) == 0 {
		return false
	}
	return item.SelfEvolutionActivation == "restart_pending" || item.SelfEvolutionActivation == "restart_scheduled"
}
