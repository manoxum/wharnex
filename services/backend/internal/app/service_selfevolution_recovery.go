package app

import (
	"errors"
	"strings"
)

// SelfEvolutionBlock describes a self-evolution transaction parked in a
// fail-closed phase, which holds the global batch lock until an operator
// acknowledges it.
type SelfEvolutionBlock struct {
	Phase       string `json:"phase"`
	Transaction string `json:"transaction"`
	PlanID      string `json:"plan_id,omitempty"`
	SessionID   string `json:"session_id,omitempty"`
	Detail      string `json:"detail,omitempty"`
	Remedy      string `json:"remedy,omitempty"`
	Releasable  bool   `json:"releasable"`
}

// SelfEvolutionBlocked reports the transaction currently blocking
// self-evolution, if any.
//
// It exists because the refusal was previously unreadable and unrecoverable in
// the same breath: "another Wharnex self-evolution transaction is already
// active" named no phase, no transaction, no cause and no action, and no
// endpoint could clear it. A fail-closed phase is meant to stop and wait for a
// human — which only works if the human can see what it is waiting for.
func (s *Service) SelfEvolutionBlocked() (SelfEvolutionBlock, bool) {
	if s.selfEvolution == nil || !s.selfEvolution.Enabled() {
		return SelfEvolutionBlock{}, false
	}
	status, err := s.selfEvolution.LastStatus()
	if err != nil {
		return SelfEvolutionBlock{}, false
	}
	blocked := s.selfEvolution.BlockedStatus(status)
	if blocked == nil {
		return SelfEvolutionBlock{}, false
	}
	return SelfEvolutionBlock{
		Phase: blocked.Phase, Transaction: blocked.Transaction, PlanID: blocked.PlanID,
		SessionID: status.SessionID, Detail: blocked.Detail, Remedy: blocked.Remedy, Releasable: true,
	}, true
}

// ReleaseSelfEvolutionBlock is the operator's explicit acknowledgement that a
// fail-closed transaction has been dealt with. It names the transaction so the
// release cannot happen by accident and the audit trail records which state a
// human actually inspected.
func (s *Service) ReleaseSelfEvolutionBlock(transactionID string) (SelfEvolutionBlock, error) {
	if s.selfEvolution == nil || !s.selfEvolution.Enabled() {
		return SelfEvolutionBlock{}, errors.New("self-evolution is not enabled for this runtime")
	}
	status, err := s.selfEvolution.ReleaseBlockedTransaction(strings.TrimSpace(transactionID))
	if err != nil {
		return SelfEvolutionBlock{}, err
	}
	s.bus.Publish("", "self_evolution.transaction_released", map[string]any{
		"transaction": status.Transaction, "plan_id": status.PlanID, "detail": status.Detail,
	})
	return SelfEvolutionBlock{
		Phase: status.Phase, Transaction: status.Transaction, PlanID: status.PlanID,
		SessionID: status.SessionID, Detail: status.Detail,
	}, nil
}
