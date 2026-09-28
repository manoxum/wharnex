package orchestrator

import (
	"context"
	"sort"
	"time"
)

const (
	defaultTaskConclusionLimit = 32
	maxTaskConclusionLimit     = 100
)

// TaskConclusion is the compact durable identity needed by workspace attention.
// RunID and CompletedAt remain stable while the owning task advances through
// REVIEW, COMPLETE and ARCHIVED.
type TaskConclusion struct {
	RunID       string     `json:"run_id"`
	TaskID      string     `json:"task_id"`
	Title       string     `json:"title"`
	Status      TaskStatus `json:"status"`
	CompletedAt time.Time  `json:"completed_at"`
}

func (s *Store) ListTaskConclusions(ctx context.Context, projectPath string, limit int) ([]TaskConclusion, error) {
	limit = normalizeTaskConclusionLimit(limit)
	if s.db != nil {
		return s.postgresListTaskConclusions(ctx, projectPath, limit)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]TaskConclusion, 0, limit)
	for _, task := range s.tasks {
		if task.ProjectPath != projectPath || !taskStatusHasSuccessfulConclusion(task.Status) {
			continue
		}
		for _, run := range s.runs[task.ID] {
			if run.ProjectPath != projectPath || run.Status != "review" || run.CompletedAt == nil {
				continue
			}
			items = append(items, TaskConclusion{
				RunID: run.ID, TaskID: task.ID, Title: task.Title, Status: task.Status, CompletedAt: run.CompletedAt.UTC(),
			})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CompletedAt.Equal(items[j].CompletedAt) {
			return items[i].RunID > items[j].RunID
		}
		return items[i].CompletedAt.After(items[j].CompletedAt)
	})
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func normalizeTaskConclusionLimit(limit int) int {
	if limit <= 0 {
		return defaultTaskConclusionLimit
	}
	if limit > maxTaskConclusionLimit {
		return maxTaskConclusionLimit
	}
	return limit
}

func taskStatusHasSuccessfulConclusion(status TaskStatus) bool {
	return status == TaskReview || status == TaskComplete || status == TaskArchived
}
