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
	sortTaskConclusions(items)
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

// ListPendingTaskReviews returns the most recent tasks that are still waiting
// for human/project completion in REVIEW. Ordering is anchored to the durable
// run completion that entered REVIEW, so later task metadata updates cannot
// reorder the queue.
func (s *Store) ListPendingTaskReviews(ctx context.Context, projectPath string, limit int) ([]TaskConclusion, error) {
	limit = normalizeTaskConclusionLimit(limit)
	if s.db != nil {
		return s.postgresListPendingTaskReviews(ctx, projectPath, limit)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]TaskConclusion, 0, limit)
	for _, task := range s.tasks {
		if task.ProjectPath != projectPath || task.Status != TaskReview {
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
	sortTaskConclusions(items)

	// A task normally has one successful review run, but legacy/recovered data
	// can contain more. Keep the newest durable review event per task.
	result := make([]TaskConclusion, 0, limit)
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if _, ok := seen[item.TaskID]; ok {
			continue
		}
		seen[item.TaskID] = struct{}{}
		result = append(result, item)
		if len(result) == limit {
			break
		}
	}
	return result, nil
}

func sortTaskConclusions(items []TaskConclusion) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].CompletedAt.Equal(items[j].CompletedAt) {
			return items[i].RunID > items[j].RunID
		}
		return items[i].CompletedAt.After(items[j].CompletedAt)
	})
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
