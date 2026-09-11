package session

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	chatAgentBootstrapWait    = time.Minute
	chatAgentMaxInitialWait   = 15 * time.Minute
	chatAgentHealthyWindow    = 15 * time.Minute
	chatAgentSampleWindowSize = 50
	chatAgentMinSamples       = 3
)

type ChatAgentProcessingSample struct {
	RequestID      string    `json:"request_id"`
	ConversationID string    `json:"conversation_id"`
	DurationMS     int64     `json:"duration_ms"`
	CreatedAt      time.Time `json:"created_at"`
}

func chatAgentInitialWait(average time.Duration, samples int) time.Duration {
	if samples < chatAgentMinSamples || average <= 0 {
		return chatAgentBootstrapWait
	}
	wait := (chatAgentBootstrapWait + average) / 2
	if wait < chatAgentBootstrapWait {
		wait = chatAgentBootstrapWait
	}
	if wait > chatAgentMaxInitialWait {
		wait = chatAgentMaxInitialWait
	}
	return wait
}

func chatAgentRateLimitPause(level int) time.Duration {
	switch {
	case level <= 1:
		return time.Minute
	case level == 2:
		return 2 * time.Minute
	case level == 3:
		return 4 * time.Minute
	default:
		return 5 * time.Minute
	}
}

func (s *Store) enrichChatAgentProviderState(state ChatAgentProviderState) (ChatAgentProviderState, error) {
	if s.db != nil {
		var count int
		var average sql.NullFloat64
		err := s.db.QueryRow(`SELECT COUNT(*), AVG(duration_ms)::float8
			FROM harness_chat_agent_processing_samples WHERE provider='chatgpt'`).Scan(&count, &average)
		if err != nil {
			return ChatAgentProviderState{}, fmt.Errorf("read chat agent processing samples: %w", err)
		}
		state.ValidSampleCount = count
		if average.Valid {
			state.AverageProcessingMS = int64(average.Float64)
		}
	} else {
		state.ValidSampleCount = len(s.chatAgentProcessingSamples)
		var sum int64
		for _, sample := range s.chatAgentProcessingSamples {
			sum += sample.DurationMS
		}
		if state.ValidSampleCount > 0 {
			state.AverageProcessingMS = sum / int64(state.ValidSampleCount)
		}
	}
	state.InitialWaitMS = chatAgentInitialWait(time.Duration(state.AverageProcessingMS)*time.Millisecond, state.ValidSampleCount).Milliseconds()
	return state, nil
}

func (s *Store) RecordChatAgentRateLimit(source string) (ChatAgentProviderState, error) {
	source = strings.TrimSpace(source)
	if source == "" {
		source = "unknown"
	}
	if len(source) > 80 {
		source = source[:80]
	}
	now := time.Now().UTC()
	if s.db != nil {
		tx, err := s.db.Begin()
		if err != nil {
			return ChatAgentProviderState{}, fmt.Errorf("begin chat agent rate limit: %w", err)
		}
		defer func() { _ = tx.Rollback() }()
		var level int
		var lastLimit, lastValid sql.NullTime
		if err := tx.QueryRow(`SELECT rate_limit_level,last_rate_limit_at,last_valid_bundle_at
			FROM harness_chat_agent_provider_state WHERE provider='chatgpt' FOR UPDATE`).Scan(&level, &lastLimit, &lastValid); err != nil {
			return ChatAgentProviderState{}, fmt.Errorf("lock chat agent rate limit state: %w", err)
		}
		if lastLimit.Valid && now.Sub(lastLimit.Time) >= chatAgentHealthyWindow && lastValid.Valid && lastValid.Time.After(lastLimit.Time) {
			level = 0
		}
		level++
		if level > 4 {
			level = 4
		}
		until := now.Add(chatAgentRateLimitPause(level))
		reason := fmt.Sprintf("ChatGPT HTTP 429 rate limit (%s, level %d)", source, level)
		if _, err := tx.Exec(`UPDATE harness_chat_agent_provider_state SET paused=true,paused_until=$1,reason=$2,
			rate_limit_level=$3,last_rate_limit_at=$4,last_rate_limit_source=$5,updated_at=$4 WHERE provider='chatgpt'`,
			until, reason, level, now, source); err != nil {
			return ChatAgentProviderState{}, fmt.Errorf("persist chat agent rate limit: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return ChatAgentProviderState{}, fmt.Errorf("commit chat agent rate limit: %w", err)
		}
		return s.ChatAgentProviderState()
	}

	s.mu.Lock()
	state := s.chatAgentProvider
	if state.Provider == "" {
		state.Provider = "chatgpt"
	}
	if state.LastRateLimitAt != nil && now.Sub(*state.LastRateLimitAt) >= chatAgentHealthyWindow && state.LastValidBundleAt != nil && state.LastValidBundleAt.After(*state.LastRateLimitAt) {
		state.RateLimitLevel = 0
	}
	state.RateLimitLevel++
	if state.RateLimitLevel > 4 {
		state.RateLimitLevel = 4
	}
	until := now.Add(chatAgentRateLimitPause(state.RateLimitLevel))
	state.Paused = true
	state.PausedUntil = &until
	state.Reason = fmt.Sprintf("ChatGPT HTTP 429 rate limit (%s, level %d)", source, state.RateLimitLevel)
	state.LastRateLimitAt = &now
	state.LastRateLimitSource = source
	state.UpdatedAt = now
	s.chatAgentProvider = state
	state, err := s.enrichChatAgentProviderState(state)
	s.mu.Unlock()
	return state, err
}

func (s *Store) RecordChatAgentValidBundle(requestID, conversationID string, duration time.Duration) (ChatAgentProviderState, error) {
	requestID = strings.TrimSpace(requestID)
	conversationID = strings.TrimSpace(conversationID)
	if requestID == "" {
		return ChatAgentProviderState{}, errors.New("request_id is required")
	}
	if duration < 0 || duration > 24*time.Hour {
		return ChatAgentProviderState{}, errors.New("duration must be between 0 and 24 hours")
	}
	now := time.Now().UTC()
	if s.db != nil {
		tx, err := s.db.Begin()
		if err != nil {
			return ChatAgentProviderState{}, fmt.Errorf("begin valid chat agent bundle sample: %w", err)
		}
		defer func() { _ = tx.Rollback() }()
		if duration > 0 {
			if _, err := tx.Exec(`INSERT INTO harness_chat_agent_processing_samples
				(provider,request_id,conversation_id,duration_ms,created_at) VALUES ('chatgpt',$1,$2,$3,$4)
				ON CONFLICT (provider,request_id) DO NOTHING`, requestID, conversationID, duration.Milliseconds(), now); err != nil {
				return ChatAgentProviderState{}, fmt.Errorf("persist chat agent processing sample: %w", err)
			}
			if _, err := tx.Exec(`DELETE FROM harness_chat_agent_processing_samples WHERE provider='chatgpt' AND request_id IN (
				SELECT request_id FROM harness_chat_agent_processing_samples WHERE provider='chatgpt'
				ORDER BY created_at DESC, request_id DESC OFFSET $1)`, chatAgentSampleWindowSize); err != nil {
				return ChatAgentProviderState{}, fmt.Errorf("trim chat agent processing samples: %w", err)
			}
		}
		if _, err := tx.Exec(`UPDATE harness_chat_agent_provider_state SET last_valid_bundle_at=$1,
			rate_limit_level=CASE WHEN last_rate_limit_at IS NOT NULL AND last_rate_limit_at <= $1-interval '15 minutes' THEN 0 ELSE rate_limit_level END,
			updated_at=$1 WHERE provider='chatgpt'`, now); err != nil {
			return ChatAgentProviderState{}, fmt.Errorf("persist valid chat agent bundle time: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return ChatAgentProviderState{}, fmt.Errorf("commit valid chat agent bundle sample: %w", err)
		}
		return s.ChatAgentProviderState()
	}

	s.mu.Lock()
	state := s.chatAgentProvider
	if state.Provider == "" {
		state.Provider = "chatgpt"
	}
	if duration > 0 {
		duplicate := false
		for _, sample := range s.chatAgentProcessingSamples {
			if sample.RequestID == requestID {
				duplicate = true
				break
			}
		}
		if !duplicate {
			s.chatAgentProcessingSamples = append(s.chatAgentProcessingSamples, ChatAgentProcessingSample{
				RequestID: requestID, ConversationID: conversationID, DurationMS: duration.Milliseconds(), CreatedAt: now,
			})
			if len(s.chatAgentProcessingSamples) > chatAgentSampleWindowSize {
				s.chatAgentProcessingSamples = append([]ChatAgentProcessingSample(nil), s.chatAgentProcessingSamples[len(s.chatAgentProcessingSamples)-chatAgentSampleWindowSize:]...)
			}
		}
	}
	state.LastValidBundleAt = &now
	if state.LastRateLimitAt != nil && now.Sub(*state.LastRateLimitAt) >= chatAgentHealthyWindow {
		state.RateLimitLevel = 0
	}
	state.UpdatedAt = now
	s.chatAgentProvider = state
	state, err := s.enrichChatAgentProviderState(state)
	s.mu.Unlock()
	return state, err
}
