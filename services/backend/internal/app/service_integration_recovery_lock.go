package app

import "kernl.local/harness/backend/internal/domain"

// parkedBySelfEvolutionLock reports a verified candidate whose Apply was
// refused only because the global self-evolution batch lock was held. Apply
// keeps such a candidate in `verified` rather than `failed` (the candidate is
// fine), which put it outside integration recovery entirely.
//
// On 2026-09-29 two Orchestrator tasks sat DOING for hours in exactly this
// state: their Agents had verified candidates, the lock holder was released,
// and nothing retried the integration. A chat has a person to press Apply; an
// Orchestrator task has nobody, and its Worker only reported "Agent state
// verified" every 30 seconds.
func parkedBySelfEvolutionLock(item domain.Session) bool {
	return item.State == "verified" && item.FailureKind == domain.FailureKindSelfEvolutionBusy
}

// lockRetryState is the extra retry-state key for one eligible session and
// whether it may be retried now; only a lock-parked session is gated.
func (s *Service) lockRetryState(item domain.Session) (string, bool) {
	if !parkedBySelfEvolutionLock(item) {
		return "", true
	}
	return s.selfEvolutionRetryGate()
}

// selfEvolutionRetryGate reports whether a lock-parked candidate may be
// retried now and the lock state that retry is keyed on. A fail-closed
// transaction is waiting for its operator, so retrying against it only spends
// the attempt; every other lock state is tried once, so a lock that is freed or
// moves to another transaction counts as a new state.
func (s *Service) selfEvolutionRetryGate() (string, bool) {
	if _, blocked := s.SelfEvolutionBlocked(); blocked {
		return "", false
	}
	if s.selfEvolution == nil || !s.selfEvolution.Enabled() {
		return "", true
	}
	status, err := s.selfEvolution.LastStatus()
	if err != nil {
		return "", true
	}
	return status.Transaction + "@" + status.Phase + "@" + status.UpdatedAt, true
}
