package session

import (
	"errors"
	"strings"
	"time"
)

type ChatAgentProviderState struct {
	Provider    string     `json:"provider"`
	Paused      bool       `json:"paused"`
	PausedUntil *time.Time `json:"paused_until,omitempty"`
	Reason      string     `json:"reason"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

func (s *Store) ChatAgentProviderState() (ChatAgentProviderState, error) {
	if s.db != nil {
		var state ChatAgentProviderState
		var until *time.Time
		err := s.db.QueryRow(`SELECT provider, paused, paused_until, reason, updated_at
			FROM harness_chat_agent_provider_state WHERE provider='chatgpt'`).
			Scan(&state.Provider, &state.Paused, &until, &state.Reason, &state.UpdatedAt)
		if err != nil {
			return ChatAgentProviderState{}, err
		}
		state.PausedUntil = until
		if state.Paused && until != nil && !until.After(time.Now().UTC()) {
			return s.SetChatAgentProviderPause(false, nil, "")
		}
		return state, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.chatAgentProvider
	if state.Provider == "" {
		state = ChatAgentProviderState{Provider: "chatgpt", UpdatedAt: time.Now().UTC()}
		s.chatAgentProvider = state
	}
	if state.Paused && state.PausedUntil != nil && !state.PausedUntil.After(time.Now().UTC()) {
		state.Paused = false
		state.PausedUntil = nil
		state.Reason = ""
		state.UpdatedAt = time.Now().UTC()
		s.chatAgentProvider = state
	}
	return state, nil
}

func (s *Store) SetChatAgentProviderPause(paused bool, until *time.Time, reason string) (ChatAgentProviderState, error) {
	if paused && until != nil && !until.After(time.Now().UTC()) {
		return ChatAgentProviderState{}, errors.New("paused_until must be in the future")
	}
	reason = strings.TrimSpace(reason)
	if len(reason) > 500 {
		reason = reason[:500]
	}
	if !paused {
		until = nil
		reason = ""
	}
	now := time.Now().UTC()
	if s.db != nil {
		var state ChatAgentProviderState
		var storedUntil *time.Time
		err := s.db.QueryRow(`INSERT INTO harness_chat_agent_provider_state
			(provider,paused,paused_until,reason,updated_at) VALUES ('chatgpt',$1,$2,$3,$4)
			ON CONFLICT (provider) DO UPDATE SET paused=EXCLUDED.paused,
				paused_until=EXCLUDED.paused_until, reason=EXCLUDED.reason, updated_at=EXCLUDED.updated_at
			RETURNING provider,paused,paused_until,reason,updated_at`, paused, until, reason, now).
			Scan(&state.Provider, &state.Paused, &storedUntil, &state.Reason, &state.UpdatedAt)
		state.PausedUntil = storedUntil
		return state, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	state := ChatAgentProviderState{
		Provider: "chatgpt", Paused: paused, PausedUntil: until, Reason: reason, UpdatedAt: now,
	}
	s.chatAgentProvider = state
	return state, nil
}
