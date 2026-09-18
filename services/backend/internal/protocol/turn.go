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
	chatTitle := strings.TrimSpace(turn.ChatTitle)
	if len([]rune(chatTitle)) > 82 {
		return errors.New("turn chat_title exceeds 82 characters")
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
	if turn.Interview == nil {
		return nil
	}
	if turn.Kind != domain.TurnKindClarification {
		return errors.New("interview is valid only on a clarification turn")
	}
	if turn.Interview.Protocol != domain.InterviewProtocolV1 {
		return fmt.Errorf("unsupported interview protocol %q", turn.Interview.Protocol)
	}
	if len(turn.Interview.Questions) == 0 || len(turn.Interview.Questions) > 8 {
		return errors.New("interview requires 1..8 questions")
	}
	questionIDs := map[string]struct{}{}
	for index, question := range turn.Interview.Questions {
		if !safeInterviewID(question.ID) {
			return fmt.Errorf("interview question %d has invalid id", index)
		}
		if _, exists := questionIDs[question.ID]; exists {
			return fmt.Errorf("interview question %d has duplicate id", index)
		}
		questionIDs[question.ID] = struct{}{}
		if prompt := strings.TrimSpace(question.Prompt); prompt == "" || len(prompt) > 1024 {
			return fmt.Errorf("interview question %d prompt must be 1..1024 bytes", index)
		}
		if len(question.Options) < 2 || len(question.Options) > 8 {
			return fmt.Errorf("interview question %d requires 2..8 options", index)
		}
		optionIDs := map[string]struct{}{}
		for optionIndex, option := range question.Options {
			if !safeInterviewID(option.ID) {
				return fmt.Errorf("interview question %d option %d has invalid id", index, optionIndex)
			}
			if _, exists := optionIDs[option.ID]; exists {
				return fmt.Errorf("interview question %d has duplicate option id", index)
			}
			optionIDs[option.ID] = struct{}{}
			if label := strings.TrimSpace(option.Label); label == "" || len(label) > 512 {
				return fmt.Errorf("interview question %d option %d label must be 1..512 bytes", index, optionIndex)
			}
		}
	}
	return nil
}

func safeInterviewID(value string) bool {
	if len(value) == 0 || len(value) > 64 {
		return false
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}
