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
	return nil
}
