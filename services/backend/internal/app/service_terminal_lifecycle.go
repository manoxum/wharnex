package app

import (
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox"
)

func (s *Service) SubscribeInteractiveTerminal(sessionID, terminalID string) ([]TerminalFrame, <-chan TerminalFrame, func(), error) {
	state, err := s.ownedTerminal(sessionID, terminalID)
	if err != nil {
		return nil, nil, nil, err
	}
	channel := make(chan TerminalFrame, 64)
	state.mu.Lock()
	replay := append([]TerminalFrame(nil), state.frames...)
	if len(replay) == 0 || replay[0].Type != "ready" {
		replay = append([]TerminalFrame{{Type: "ready"}}, replay...)
	}
	if state.orphanTimer != nil {
		state.orphanTimer.Stop()
		state.orphanTimer = nil
	}
	state.subscribers[channel] = struct{}{}
	state.mu.Unlock()
	cancel := func() {
		state.mu.Lock()
		delete(state.subscribers, channel)
		if len(state.subscribers) == 0 && !state.exited && state.target != domain.TerminalTargetHost {
			if state.orphanTimer != nil {
				state.orphanTimer.Stop()
			}
			state.orphanTimer = s.newTerminalOrphanTimer(sessionID, terminalID, state)
		}
		state.mu.Unlock()
	}
	return replay, channel, cancel, nil
}

func (s *Service) newTerminalOrphanTimer(sessionID, terminalID string, state *terminalSessionState) *time.Timer {
	return time.AfterFunc(30*time.Second, func() {
		state.mu.Lock()
		hasSubscribers := len(state.subscribers) > 0
		state.mu.Unlock()
		if !hasSubscribers {
			_ = s.CloseInteractiveTerminal(sessionID, terminalID)
		}
	})
}

func (s *Service) CloseInteractiveTerminal(sessionID, terminalID string) error {
	state, err := s.ownedTerminal(sessionID, terminalID)
	if err != nil {
		return err
	}
	s.terminalMu.Lock()
	delete(s.terminals, terminalID)
	s.terminalMu.Unlock()
	s.closeInteractiveTerminalState(terminalID, state)
	return nil
}

func (s *Service) closeInteractiveTerminals(sessionID string) {
	s.terminalMu.Lock()
	states := make(map[string]*terminalSessionState)
	for id, state := range s.terminals {
		if state.sessionID == sessionID {
			states[id] = state
			delete(s.terminals, id)
		}
	}
	s.terminalMu.Unlock()
	for id, state := range states {
		s.closeInteractiveTerminalState(id, state)
	}
}

// DetachInteractiveTerminals preserves bridge-backed host shells while the
// backend restarts. Protected sandbox PTYs and in-process host PTYs are closed.
func (s *Service) DetachInteractiveTerminals() {
	s.terminalMu.Lock()
	states := make(map[string]*terminalSessionState, len(s.terminals))
	for id, state := range s.terminals {
		states[id] = state
		delete(s.terminals, id)
	}
	s.terminalMu.Unlock()
	for id, state := range states {
		state.mu.Lock()
		handle := state.terminal
		if state.orphanTimer != nil {
			state.orphanTimer.Stop()
			state.orphanTimer = nil
		}
		state.mu.Unlock()
		if state.target == domain.TerminalTargetHost {
			if detachable, ok := handle.(sandbox.DetachableTerminal); ok {
				_ = detachable.Detach()
				continue
			}
		}
		s.closeInteractiveTerminalState(id, state)
	}
}

// CloseAllInteractiveTerminals explicitly closes every live PTY. It remains
// useful for tests and explicit teardown paths; backend shutdown uses detach.
func (s *Service) CloseAllInteractiveTerminals() {
	s.terminalMu.Lock()
	states := make(map[string]*terminalSessionState, len(s.terminals))
	for id, state := range s.terminals {
		states[id] = state
		delete(s.terminals, id)
	}
	s.terminalMu.Unlock()
	for id, state := range states {
		s.closeInteractiveTerminalState(id, state)
	}
}

func (s *Service) closeInteractiveTerminalState(terminalID string, state *terminalSessionState) {
	state.mu.Lock()
	handle := state.terminal
	wasOpen := !state.exited
	state.exited = true
	if state.orphanTimer != nil {
		state.orphanTimer.Stop()
		state.orphanTimer = nil
	}
	state.mu.Unlock()
	if wasOpen {
		code := -1
		state.publish(TerminalFrame{Type: "exit", Code: &code, Message: "terminal session closed"})
	}
	if handle != nil {
		_ = handle.Close()
	}
	s.bus.Publish(state.sessionID, "terminal.session_closed", map[string]any{"terminal_id": terminalID, "target": state.target})
}
