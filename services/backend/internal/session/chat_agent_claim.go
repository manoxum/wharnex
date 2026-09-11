package session

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	ChatAgentClaimAny            = "any"
	ChatAgentClaimResidentOnly   = "resident_only"
	ChatAgentClaimUnresidentOnly = "unresident_only"
)

type ChatAgentClaimOptions struct {
	PreferredLane string   `json:"preferred_lane"`
	ExcludedLanes []string `json:"excluded_lanes"`
	FallbackMode  string   `json:"fallback_mode"`
}

func chatAgentTaskLane(task ChatAgentTask) string {
	if value := strings.TrimSpace(task.ConversationID); value != "" {
		return "c:" + value
	}
	if value := strings.TrimSpace(task.ChatID); value != "" {
		return "h:" + value
	}
	return ""
}

func normalizeChatAgentClaimOptions(input ChatAgentClaimOptions) (ChatAgentClaimOptions, error) {
	input.PreferredLane = strings.TrimSpace(input.PreferredLane)
	input.FallbackMode = strings.TrimSpace(input.FallbackMode)
	if input.FallbackMode == "" {
		input.FallbackMode = ChatAgentClaimAny
	}
	switch input.FallbackMode {
	case ChatAgentClaimAny, ChatAgentClaimResidentOnly, ChatAgentClaimUnresidentOnly:
	default:
		return ChatAgentClaimOptions{}, fmt.Errorf("unsupported chat agent fallback mode %q", input.FallbackMode)
	}
	if input.FallbackMode == ChatAgentClaimResidentOnly && input.PreferredLane == "" {
		return ChatAgentClaimOptions{}, errors.New("preferred_lane is required for resident_only claim")
	}
	seen := map[string]struct{}{}
	cleaned := make([]string, 0, len(input.ExcludedLanes))
	for _, raw := range input.ExcludedLanes {
		lane := strings.TrimSpace(raw)
		if lane == "" || lane == input.PreferredLane {
			continue
		}
		if _, ok := seen[lane]; ok {
			continue
		}
		seen[lane] = struct{}{}
		cleaned = append(cleaned, lane)
	}
	if len(cleaned) > 32 {
		return ChatAgentClaimOptions{}, errors.New("excluded_lanes must contain at most 32 lanes")
	}
	input.ExcludedLanes = cleaned
	return input, nil
}

func chatAgentClaimAllows(task ChatAgentTask, options ChatAgentClaimOptions) bool {
	lane := chatAgentTaskLane(task)
	for _, excluded := range options.ExcludedLanes {
		if lane == excluded {
			return false
		}
	}
	switch options.FallbackMode {
	case ChatAgentClaimResidentOnly:
		return lane == options.PreferredLane
	case ChatAgentClaimUnresidentOnly:
		return options.PreferredLane == "" || lane != options.PreferredLane
	default:
		return true
	}
}

func (s *Store) ClaimChatAgentTask(owner string, lease time.Duration) (*ChatAgentTask, error) {
	return s.ClaimChatAgentTaskWithOptions(owner, lease, ChatAgentClaimOptions{})
}

func (s *Store) ClaimChatAgentTaskWithOptions(owner string, lease time.Duration, input ChatAgentClaimOptions) (*ChatAgentTask, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" {
		return nil, errors.New("lease owner is required")
	}
	if lease < 5*time.Second || lease > 10*time.Minute {
		return nil, errors.New("lease duration must be between 5 seconds and 10 minutes")
	}
	options, err := normalizeChatAgentClaimOptions(input)
	if err != nil {
		return nil, err
	}
	if s.db != nil {
		return s.postgresClaimChatAgentTask(owner, lease, options)
	}
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	if state := s.chatAgentProvider; state.Paused &&
		(state.PausedUntil == nil || state.PausedUntil.After(now)) {
		return nil, nil
	}
	if s.chatAgentProvider.Paused && s.chatAgentProvider.PausedUntil != nil {
		s.chatAgentProvider.Paused = false
		s.chatAgentProvider.PausedUntil = nil
		s.chatAgentProvider.Reason = ""
		s.chatAgentProvider.UpdatedAt = now
	}
	tasks := s.chatAgentFallback()
	for id, task := range tasks {
		if (task.Status == ChatAgentTaskLeased || task.Status == ChatAgentTaskRunning) &&
			task.LeaseExpiresAt != nil && !task.LeaseExpiresAt.After(now) {
			if task.Attempt >= task.MaxAttempts {
				task.Status = ChatAgentTaskFailed
				task.LastError = "lease expired after maximum attempts"
			} else {
				task.Status = ChatAgentTaskPending
			}
			task.LeaseOwner = ""
			task.LeaseExpiresAt = nil
			task.UpdatedAt = now
			tasks[id] = task
		}
	}
	eligible := make([]ChatAgentTask, 0, len(tasks))
	for _, task := range tasks {
		if task.Status != ChatAgentTaskPending && task.Status != ChatAgentTaskWaiting {
			continue
		}
		if task.NotBefore.After(now) || task.Attempt >= task.MaxAttempts {
			continue
		}
		if chatAgentBlockedByActiveTask(task, tasks, now) || !chatAgentClaimAllows(task, options) {
			continue
		}
		eligible = append(eligible, task)
	}
	sort.Slice(eligible, func(i, j int) bool {
		if options.PreferredLane != "" {
			iPreferred := chatAgentTaskLane(eligible[i]) == options.PreferredLane
			jPreferred := chatAgentTaskLane(eligible[j]) == options.PreferredLane
			if iPreferred != jPreferred {
				return iPreferred
			}
		}
		pi := chatAgentEffectivePriority(eligible[i], now)
		pj := chatAgentEffectivePriority(eligible[j], now)
		if pi != pj {
			return pi < pj
		}
		if eligible[i].CreatedAt.Equal(eligible[j].CreatedAt) {
			return eligible[i].TaskID < eligible[j].TaskID
		}
		return eligible[i].CreatedAt.Before(eligible[j].CreatedAt)
	})
	if len(eligible) == 0 {
		return nil, nil
	}
	task := eligible[0]
	expires := now.Add(lease)
	task.Status = ChatAgentTaskLeased
	task.LeaseOwner = owner
	task.LeaseExpiresAt = &expires
	task.Attempt++
	task.UpdatedAt = now
	tasks[task.TaskID] = task
	return &task, nil
}

func chatAgentBlockedByActiveTask(candidate ChatAgentTask, tasks map[string]ChatAgentTask, now time.Time) bool {
	for _, running := range tasks {
		if running.TaskID == candidate.TaskID || (running.Status != ChatAgentTaskLeased && running.Status != ChatAgentTaskRunning) {
			continue
		}
		if running.LeaseExpiresAt != nil && !running.LeaseExpiresAt.After(now) {
			continue
		}
		if chatAgentTaskAccount(candidate.Type) && chatAgentTaskAccount(running.Type) {
			return true
		}
		if candidate.ConversationID != "" && candidate.ConversationID == running.ConversationID &&
			(chatAgentTaskWriter(candidate.Type) || chatAgentTaskWriter(running.Type)) {
			return true
		}
	}
	return false
}

func (s *Store) StartChatAgentTask(taskID, owner string) (ChatAgentTask, error) {
	return s.transitionChatAgentTask(taskID, owner, ChatAgentTaskRunning, time.Time{}, "")
}

func (s *Store) WaitChatAgentTask(taskID, owner string, notBefore time.Time, detail string) (ChatAgentTask, error) {
	if notBefore.IsZero() {
		return ChatAgentTask{}, errors.New("not_before is required for WAITING")
	}
	return s.transitionChatAgentTask(taskID, owner, ChatAgentTaskWaiting, notBefore, detail)
}

func (s *Store) CompleteChatAgentTask(taskID, owner string) (ChatAgentTask, error) {
	return s.transitionChatAgentTask(taskID, owner, ChatAgentTaskDone, time.Time{}, "")
}

func (s *Store) FailChatAgentTask(taskID, owner, detail string, attention bool) (ChatAgentTask, error) {
	status := ChatAgentTaskFailed
	if attention {
		status = ChatAgentTaskAttention
	}
	return s.transitionChatAgentTask(taskID, owner, status, time.Time{}, detail)
}

func (s *Store) transitionChatAgentTask(taskID, owner, status string, notBefore time.Time, detail string) (ChatAgentTask, error) {
	if s.db != nil {
		return s.postgresTransitionChatAgentTask(taskID, owner, status, notBefore, detail)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	task, ok := s.chatAgentFallback()[taskID]
	if !ok {
		return ChatAgentTask{}, ErrChatAgentTaskNotFound
	}
	if task.LeaseOwner != owner || strings.TrimSpace(owner) == "" {
		return ChatAgentTask{}, ErrChatAgentLeaseOwner
	}
	switch status {
	case ChatAgentTaskRunning:
		if task.Status != ChatAgentTaskLeased {
			return ChatAgentTask{}, fmt.Errorf("cannot start chat agent task from %s", task.Status)
		}
	case ChatAgentTaskWaiting, ChatAgentTaskDone, ChatAgentTaskFailed, ChatAgentTaskAttention:
		if task.Status != ChatAgentTaskLeased && task.Status != ChatAgentTaskRunning {
			return ChatAgentTask{}, fmt.Errorf("cannot finish chat agent task from %s", task.Status)
		}
	default:
		return ChatAgentTask{}, fmt.Errorf("unsupported chat agent transition %s", status)
	}
	now := time.Now().UTC()
	task.Status = status
	task.LastError = strings.TrimSpace(detail)
	if status == ChatAgentTaskWaiting {
		task.NotBefore = notBefore.UTC()
	}
	if status != ChatAgentTaskRunning {
		task.LeaseOwner = ""
		task.LeaseExpiresAt = nil
	}
	task.UpdatedAt = now
	s.chatAgentFallback()[task.TaskID] = task
	return task, nil
}

func (s *Store) HeartbeatChatAgentTask(taskID, owner string, lease time.Duration) (ChatAgentTask, error) {
	if lease < 5*time.Second || lease > 10*time.Minute {
		return ChatAgentTask{}, errors.New("lease duration must be between 5 seconds and 10 minutes")
	}
	if s.db != nil {
		return s.postgresHeartbeatChatAgentTask(taskID, owner, lease)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	task, ok := s.chatAgentFallback()[taskID]
	if !ok {
		return ChatAgentTask{}, ErrChatAgentTaskNotFound
	}
	if task.LeaseOwner != owner || (task.Status != ChatAgentTaskLeased && task.Status != ChatAgentTaskRunning) {
		return ChatAgentTask{}, ErrChatAgentLeaseOwner
	}
	now := time.Now().UTC()
	expires := now.Add(lease)
	task.LeaseExpiresAt = &expires
	task.UpdatedAt = now
	s.chatAgentFallback()[taskID] = task
	return task, nil
}

func (s *Store) CancelChatAgentLineage(rootRequestID string) (int, error) {
	rootRequestID = strings.TrimSpace(rootRequestID)
	if rootRequestID == "" {
		return 0, errors.New("root_request_id is required")
	}
	if s.db != nil {
		return s.postgresCancelChatAgentLineage(rootRequestID)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	count := 0
	for id, task := range s.chatAgentFallback() {
		if task.RootRequestID != rootRequestID || !chatAgentTaskActive(task.Status) {
			continue
		}
		task.Status = ChatAgentTaskCancelled
		task.LeaseOwner = ""
		task.LeaseExpiresAt = nil
		task.UpdatedAt = now
		s.chatAgentFallback()[id] = task
		count++
	}
	return count, nil
}
