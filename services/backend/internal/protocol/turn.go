package protocol

import (
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
)

func ValidateTurn(turn domain.AgentTurn) error {
	if turn.Protocol != domain.TurnProtocolV1 {
		return fmt.Errorf("unsupported turn protocol %q", turn.Protocol)
	}
	if strings.TrimSpace(turn.RequestID) == "" {
		return errors.New("turn request_id is required")
	}
	if !domain.ValidTurnKind(turn.Kind) {
		return fmt.Errorf("unsupported turn kind %q", turn.Kind)
	}
	message := strings.TrimSpace(turn.Message)
	if message == "" {
		return errors.New("turn message is required")
	}
	if len(message) > 256<<10 {
		return errors.New("turn message exceeds 256 KiB limit")
	}
	if turn.Outcome == nil {
		return errors.New("turn outcome is required")
	}
	if turn.Outcome.Status != domain.TurnOutcomeCompleted && turn.Outcome.Status != domain.TurnOutcomeFailed && turn.Outcome.Status != domain.TurnOutcomePartial {
		return errors.New("turn outcome status is invalid")
	}
	if len(turn.Outcome.ReasonCode) > 128 {
		return errors.New("turn outcome reason_code exceeds 128 characters")
	}
	if len(turn.Outcome.Message) > 16<<10 {
		return errors.New("turn outcome message exceeds 16 KiB limit")
	}
	if turn.Outcome.Status != domain.TurnOutcomeCompleted && strings.TrimSpace(turn.Outcome.Message) == "" {
		return errors.New("non-completed turn outcome message is required")
	}
	if len(turn.ResolvedEvidenceIDs) > 500 {
		return errors.New("resolved_evidence_ids exceeds 500 entries")
	}
	seenEvidence := map[string]struct{}{}
	for _, id := range turn.ResolvedEvidenceIDs {
		if !strings.HasPrefix(id, "evt_") {
			return errors.New("resolved_evidence_ids contains an invalid event id")
		}
		if _, exists := seenEvidence[id]; exists {
			return errors.New("resolved_evidence_ids contains a duplicate")
		}
		seenEvidence[id] = struct{}{}
	}
	return nil
}
