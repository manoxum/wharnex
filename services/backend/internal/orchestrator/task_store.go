package orchestrator

import (
	"context"
	"strings"
	"time"
)

func (s *Store) GetTask(ctx context.Context, id string) (Task, error) {
	if s.db != nil {
		return s.postgresGetTask(ctx, id)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	task, ok := s.tasks[id]
	if !ok {
		return Task{}, ErrNotFound
	}
	return cloneTask(task), nil
}

func (s *Store) PutTask(ctx context.Context, task Task) error {
	if s.db != nil {
		return s.postgresPutTask(ctx, task)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var previous *Task
	if current, ok := s.tasks[task.ID]; ok {
		previous = &current
	}
	task = taskWithFirstDoingEvidence(task, previous, time.Now().UTC())
	task = taskWithConversationAffinity(task, previous)
	s.tasks[task.ID] = cloneTask(task)
	return nil
}

func cloneTask(task Task) Task {
	if task.FirstDoingAt != nil {
		firstDoingAt := *task.FirstDoingAt
		task.FirstDoingAt = &firstDoingAt
	}
	task.AcceptanceCriteria = append([]string(nil), task.AcceptanceCriteria...)
	task.DependsOn = append([]string(nil), task.DependsOn...)
	task.ImpactFiles = append([]string(nil), task.ImpactFiles...)
	task.ReadFiles = append([]string(nil), task.ReadFiles...)
	task.BarrierFiles = append([]string(nil), task.BarrierFiles...)
	if task.RetryContext != nil {
		context := *task.RetryContext
		context.ProjectFiles = append([]string(nil), context.ProjectFiles...)
		context.Attachments = append([]TaskAttachment(nil), context.Attachments...)
		task.RetryContext = &context
	}
	return task
}

func taskWithFirstDoingEvidence(task Task, previous *Task, now time.Time) Task {
	if previous != nil && previous.FirstDoingAt != nil {
		firstDoingAt := *previous.FirstDoingAt
		task.FirstDoingAt = &firstDoingAt
		return task
	}
	if task.FirstDoingAt == nil && task.Status == TaskDoing {
		firstDoingAt := now.UTC()
		task.FirstDoingAt = &firstDoingAt
	}
	return task
}

func taskWithConversationAffinity(task Task, previous *Task) Task {
	if previous == nil {
		return task
	}
	previousURL := strings.TrimSpace(previous.ConversationURL)
	previousID := strings.TrimSpace(previous.ConversationID)
	if previousURL == "" && previousID == "" {
		return task
	}
	if previousURL != "" {
		task.ConversationURL = previous.ConversationURL
	}
	if previousID != "" {
		task.ConversationID = previous.ConversationID
	}
	return task
}
