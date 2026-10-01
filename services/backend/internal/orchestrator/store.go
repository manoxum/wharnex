package orchestrator

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

var ErrNotFound = errors.New("orchestrator record not found")

type Store struct {
	mu    sync.RWMutex
	db    *sql.DB
	plans map[string]Plan
	tasks map[string]Task
	runs  map[string][]TaskRun
}

func NewMemoryStore() *Store {
	return &Store{plans: map[string]Plan{}, tasks: map[string]Task{}, runs: map[string][]TaskRun{}}
}

func NewPostgresStore(ctx context.Context, databaseURL string) (*Store, error) {
	if databaseURL == "" {
		return nil, errors.New("PostgreSQL database URL is required")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, errors.New("open orchestrator PostgreSQL store: invalid database configuration")
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, errors.New("connect orchestrator PostgreSQL store: database unavailable")
	}
	if _, err := db.ExecContext(ctx, postgresSchema); err != nil {
		db.Close()
		return nil, fmt.Errorf("initialize orchestrator PostgreSQL schema: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) CreatePlan(ctx context.Context, plan Plan, tasks []Task) error {
	if err := ValidateTaskGraph(tasks); err != nil {
		return err
	}
	if s.db != nil {
		return s.postgresCreatePlan(ctx, plan, tasks)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.plans[plan.ID]; exists {
		return fmt.Errorf("plan %s already exists", plan.ID)
	}
	for _, task := range tasks {
		if _, exists := s.tasks[task.ID]; exists {
			return fmt.Errorf("task %s already exists", task.ID)
		}
	}
	s.plans[plan.ID] = clonePlan(plan)
	for _, task := range tasks {
		s.tasks[task.ID] = cloneTask(task)
	}
	return nil
}

func (s *Store) ListPlans(ctx context.Context, projectPath string) ([]Plan, error) {
	if s.db != nil {
		return s.postgresListPlans(ctx, projectPath)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]Plan, 0)
	for _, plan := range s.plans {
		if plan.ProjectPath == projectPath {
			items = append(items, clonePlan(plan))
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.Before(items[j].CreatedAt) })
	return items, nil
}

func (s *Store) GetPlan(ctx context.Context, id string) (Plan, error) {
	if s.db != nil {
		return s.postgresGetPlan(ctx, id)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	plan, ok := s.plans[id]
	if !ok {
		return Plan{}, ErrNotFound
	}
	return clonePlan(plan), nil
}

func (s *Store) PutPlan(ctx context.Context, plan Plan) error {
	if s.db != nil {
		return s.postgresPutPlan(ctx, plan)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.plans[plan.ID]; !ok {
		return ErrNotFound
	}
	s.plans[plan.ID] = clonePlan(plan)
	return nil
}

func (s *Store) ListTasks(ctx context.Context, projectPath string) ([]Task, error) {
	if s.db != nil {
		return s.postgresListTasks(ctx, projectPath)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]Task, 0)
	for _, task := range s.tasks {
		if task.ProjectPath == projectPath {
			items = append(items, cloneTask(task))
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.Before(items[j].CreatedAt) })
	return items, nil
}

const (
	defaultTaskPageLimit = 50
	maxTaskPageLimit     = 100
)

type taskPageCursor struct {
	UpdatedAt time.Time `json:"updated_at"`
	TaskID    string    `json:"task_id"`
}

func (s *Store) ListTaskPage(ctx context.Context, projectPath string, filter TaskPageFilter) (TaskPage, error) {
	normalized, cursor, err := normalizeTaskPageFilter(filter)
	if err != nil {
		return TaskPage{}, err
	}
	if s.db != nil {
		return s.postgresListTaskPage(ctx, projectPath, normalized, cursor)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()

	matching := make([]Task, 0)
	for _, task := range s.tasks {
		if taskMatchesPageFilter(task, projectPath, normalized) {
			matching = append(matching, cloneTask(task))
		}
	}
	sort.Slice(matching, func(i, j int) bool {
		if matching[i].UpdatedAt.Equal(matching[j].UpdatedAt) {
			return matching[i].ID > matching[j].ID
		}
		return matching[i].UpdatedAt.After(matching[j].UpdatedAt)
	})

	total := len(matching)
	pageItems := make([]Task, 0, normalized.Limit+1)
	for _, task := range matching {
		if cursor != nil && !taskAfterPageCursor(task, *cursor) {
			continue
		}
		pageItems = append(pageItems, task)
		if len(pageItems) > normalized.Limit {
			break
		}
	}
	hasMore := len(pageItems) > normalized.Limit
	if hasMore {
		pageItems = pageItems[:normalized.Limit]
	}
	page := TaskPage{Tasks: pageItems, Total: total, HasMore: hasMore}
	if hasMore && len(pageItems) > 0 {
		page.NextCursor, err = encodeTaskPageCursor(pageItems[len(pageItems)-1])
		if err != nil {
			return TaskPage{}, err
		}
	}
	return page, nil
}

func normalizeTaskPageFilter(filter TaskPageFilter) (TaskPageFilter, *taskPageCursor, error) {
	filter.Search = strings.TrimSpace(filter.Search)
	filter.Cursor = strings.TrimSpace(filter.Cursor)
	if filter.Limit <= 0 {
		filter.Limit = defaultTaskPageLimit
	}
	if filter.Limit > maxTaskPageLimit {
		filter.Limit = maxTaskPageLimit
	}
	if filter.Status != "" && filter.Status != TaskComplete && filter.Status != TaskArchived {
		return TaskPageFilter{}, nil, fmt.Errorf("terminal task status must be %s or %s", TaskComplete, TaskArchived)
	}
	if filter.Cursor == "" {
		return filter, nil, nil
	}
	cursor, err := decodeTaskPageCursor(filter.Cursor)
	if err != nil {
		return TaskPageFilter{}, nil, err
	}
	return filter, &cursor, nil
}

func taskMatchesPageFilter(task Task, projectPath string, filter TaskPageFilter) bool {
	if task.ProjectPath != projectPath || (task.Status != TaskComplete && task.Status != TaskArchived) {
		return false
	}
	if filter.Status != "" && task.Status != filter.Status {
		return false
	}
	if filter.Search == "" {
		return true
	}
	needle := strings.ToLower(filter.Search)
	return strings.Contains(strings.ToLower(task.Title), needle) || strings.Contains(strings.ToLower(task.Description), needle)
}

func taskAfterPageCursor(task Task, cursor taskPageCursor) bool {
	if task.UpdatedAt.Before(cursor.UpdatedAt) {
		return true
	}
	return task.UpdatedAt.Equal(cursor.UpdatedAt) && task.ID < cursor.TaskID
}

func encodeTaskPageCursor(task Task) (string, error) {
	raw, err := json.Marshal(taskPageCursor{UpdatedAt: task.UpdatedAt.UTC(), TaskID: task.ID})
	if err != nil {
		return "", fmt.Errorf("encode orchestrator task cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func decodeTaskPageCursor(value string) (taskPageCursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return taskPageCursor{}, errors.New("invalid orchestrator task cursor")
	}
	var cursor taskPageCursor
	if err := json.Unmarshal(raw, &cursor); err != nil || cursor.UpdatedAt.IsZero() || strings.TrimSpace(cursor.TaskID) == "" {
		return taskPageCursor{}, errors.New("invalid orchestrator task cursor")
	}
	return cursor, nil
}

func (s *Store) AppendRun(ctx context.Context, run TaskRun) error {
	if s.db != nil {
		return s.postgresAppendRun(ctx, run)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	runs := s.runs[run.TaskID]
	for index := range runs {
		if runs[index].ID == run.ID {
			runs[index] = run
			s.runs[run.TaskID] = runs
			return nil
		}
	}
	s.runs[run.TaskID] = append(runs, run)
	return nil
}

func (s *Store) ListRuns(ctx context.Context, taskID string) ([]TaskRun, error) {
	if s.db != nil {
		return s.postgresListRuns(ctx, taskID)
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	// make(...) rather than append onto a nil slice: an empty run history must
	// marshal as [] like every other orchestrator collection.
	return append(make([]TaskRun, 0, len(s.runs[taskID])), s.runs[taskID]...), nil
}

func clonePlan(plan Plan) Plan {
	plan.Assumptions = append([]string(nil), plan.Assumptions...)
	return plan
}

func marshalPayload(value any) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode orchestrator record: %w", err)
	}
	return data, nil
}
