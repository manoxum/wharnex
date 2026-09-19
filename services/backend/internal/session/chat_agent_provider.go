package session

import (
	"errors"
	"strings"
	"time"
)

type ChatAgentProviderState struct {
	Provider            string     `json:"provider"`
	Paused              bool       `json:"paused"`
	PausedUntil         *time.Time `json:"paused_until,omitempty"`
	Reason              string     `json:"reason"`
	RateLimitLevel      int        `json:"rate_limit_level"`
	LastRateLimitAt     *time.Time `json:"last_rate_limit_at,omitempty"`
	LastRateLimitSource string     `json:"last_rate_limit_source"`
	LastValidBundleAt   *time.Time `json:"last_valid_bundle_at,omitempty"`
	AverageProcessingMS int64      `json:"average_processing_ms"`
	ValidSampleCount    int        `json:"valid_sample_count"`
	InitialWaitMS       int64      `json:"initial_wait_ms"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

func (s *Store) ChatAgentProviderState() (ChatAgentProviderState, error) {
	if s.db != nil {
		var state ChatAgentProviderState
		var until, lastLimit, lastValid *time.Time
		err := s.db.QueryRow(`SELECT provider,paused,paused_until,reason,rate_limit_level,
			last_rate_limit_at,last_rate_limit_source,last_valid_bundle_at,updated_at
			FROM harness_chat_agent_provider_state WHERE provider='chatgpt'`).Scan(
			&state.Provider, &state.Paused, &until, &state.Reason, &state.RateLimitLevel,
			&lastLimit, &state.LastRateLimitSource, &lastValid, &state.UpdatedAt,
		)
		if err != nil {
			return ChatAgentProviderState{}, err
		}
		state.PausedUntil, state.LastRateLimitAt, state.LastValidBundleAt = until, lastLimit, lastValid
		if state.Paused && until != nil && !until.After(time.Now().UTC()) {
			return s.SetChatAgentProviderPause(false, nil, "")
		}
		return s.enrichChatAgentProviderState(state)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.chatAgentProvider
	if state.Provider == "" {
		state = ChatAgentProviderState{Provider: "chatgpt", UpdatedAt: time.Now().UTC()}
	}
	if state.Paused && state.PausedUntil != nil && !state.PausedUntil.After(time.Now().UTC()) {
		state.Paused = false
		state.PausedUntil = nil
		state.Reason = ""
		state.RateLimitLevel = 0
		state.LastRateLimitAt = nil
		state.LastRateLimitSource = ""
		state.UpdatedAt = time.Now().UTC()
	}
	s.chatAgentProvider = state
	return s.enrichChatAgentProviderState(state)
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
		_, err := s.db.Exec(`INSERT INTO harness_chat_agent_provider_state
			(provider,paused,paused_until,reason,updated_at) VALUES ('chatgpt',$1,$2,$3,$4)
			ON CONFLICT (provider) DO UPDATE SET paused=EXCLUDED.paused,
				paused_until=EXCLUDED.paused_until,reason=EXCLUDED.reason,
				rate_limit_level=CASE WHEN EXCLUDED.paused THEN harness_chat_agent_provider_state.rate_limit_level ELSE 0 END,
				last_rate_limit_at=CASE WHEN EXCLUDED.paused THEN harness_chat_agent_provider_state.last_rate_limit_at ELSE NULL END,
				last_rate_limit_source=CASE WHEN EXCLUDED.paused THEN harness_chat_agent_provider_state.last_rate_limit_source ELSE '' END,
				updated_at=EXCLUDED.updated_at`,
			paused, until, reason, now)
		if err != nil {
			return ChatAgentProviderState{}, err
		}
		return s.ChatAgentProviderState()
	}

	s.mu.Lock()
	state := s.chatAgentProvider
	if state.Provider == "" {
		state.Provider = "chatgpt"
	}
	state.Paused, state.PausedUntil, state.Reason, state.UpdatedAt = paused, until, reason, now
	if !paused {
		state.RateLimitLevel = 0
		state.LastRateLimitAt = nil
		state.LastRateLimitSource = ""
	}
	s.chatAgentProvider = state
	state, err := s.enrichChatAgentProviderState(state)
	s.mu.Unlock()
	return state, err
}
