package orchestrator

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"

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
	s.tasks[task.ID] = cloneTask(task)
	return nil
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
	return append([]TaskRun(nil), s.runs[taskID]...), nil
}

func clonePlan(plan Plan) Plan {
	plan.Assumptions = append([]string(nil), plan.Assumptions...)
	return plan
}

func cloneTask(task Task) Task {
	task.AcceptanceCriteria = append([]string(nil), task.AcceptanceCriteria...)
	task.DependsOn = append([]string(nil), task.DependsOn...)
	task.ImpactFiles = append([]string(nil), task.ImpactFiles...)
	task.ReadFiles = append([]string(nil), task.ReadFiles...)
	task.BarrierFiles = append([]string(nil), task.BarrierFiles...)
	return task
}

func marshalPayload(value any) ([]byte, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode orchestrator record: %w", err)
	}
	return data, nil
}
