package app

import (
	"errors"
	"fmt"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
)

func (s *Service) SetContextMode(sessionID string, mode domain.ContextMode) (domain.Session, error) {
	if !domain.ValidContextMode(mode) {
		return domain.Session{}, fmt.Errorf("unsupported context mode %q", mode)
	}
	planning, err := s.store.ListChatAgentTasks(session.ChatAgentTaskFilter{SessionID: sessionID, Type: "ORCHESTRATOR_PLAN", ActiveOnly: true, Limit: 1})
	if err != nil {
		return domain.Session{}, err
	}
	if len(planning) > 0 {
		return domain.Session{}, errors.New("finish the active Orchestrator planning request before changing context mode")
	}
	item, err := s.store.Update(sessionID, func(current *domain.Session) error {
		if len(current.PendingManualRequestIDs) > 0 {
			return errors.New("finish the pending request before changing context mode")
		}
		current.ContextMode = mode
		current.ContextPaths = nil
		return nil
	})
	if err == nil {
		s.bus.Publish(sessionID, "context.mode_changed", map[string]any{"context_mode": mode})
	}
	return item, err
}
