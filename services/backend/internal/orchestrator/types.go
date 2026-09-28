package orchestrator

import "time"

const ProtocolV1 = "harness.orchestrator-plan/v1"

type PlanStatus string

const (
	PlanDraft     PlanStatus = "DRAFT"
	PlanActive    PlanStatus = "ACTIVE"
	PlanCompleted PlanStatus = "COMPLETED"
	PlanArchived  PlanStatus = "ARCHIVED"
)

type TaskStatus string

const (
	TaskPending  TaskStatus = "PENDING"
	TaskWaiting  TaskStatus = "WAITING"
	TaskReady    TaskStatus = "READY"
	TaskDoing    TaskStatus = "DOING"
	TaskReview   TaskStatus = "REVIEW"
	TaskFailed   TaskStatus = "FAILED"
	TaskComplete TaskStatus = "COMPLETE"
	TaskArchived TaskStatus = "ARCHIVED"
)

type TaskCondition string

const (
	ConditionNone            TaskCondition = "none"
	ConditionDependency      TaskCondition = "dependency"
	ConditionPlanApproval    TaskCondition = "plan_approval"
	ConditionManualPause     TaskCondition = "manual_pause"
	ConditionMissingContext  TaskCondition = "missing_context"
	ConditionApproval        TaskCondition = "approval"
	ConditionConflict        TaskCondition = "conflict"
	ConditionFailedRun       TaskCondition = "failed_run"
	ConditionStaleDependency TaskCondition = "stale_dependency"
)

type Priority string

const (
	PriorityLow    Priority = "low"
	PriorityNormal Priority = "normal"
	PriorityHigh   Priority = "high"
	PriorityUrgent Priority = "urgent"
)

type Plan struct {
	ID               string     `json:"id"`
	ProjectPath      string     `json:"project_path"`
	Title            string     `json:"title"`
	Objective        string     `json:"objective"`
	Status           PlanStatus `json:"status"`
	PlannerRequestID string     `json:"planner_request_id,omitempty"`
	Assumptions      []string   `json:"assumptions,omitempty"`
	ReasoningEffort  string     `json:"reasoning_effort,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
}

type Task struct {
	ID                 string        `json:"id"`
	ProjectPath        string        `json:"project_path"`
	PlanID             string        `json:"plan_id,omitempty"`
	Title              string        `json:"title"`
	Description        string        `json:"description,omitempty"`
	AcceptanceCriteria []string      `json:"acceptance_criteria,omitempty"`
	Status             TaskStatus    `json:"status"`
	Condition          TaskCondition `json:"condition"`
	Priority           Priority      `json:"priority"`
	DependsOn          []string      `json:"depends_on,omitempty"`
	Capability         string        `json:"capability,omitempty"`
	Complexity         string        `json:"complexity,omitempty"`
	Parallelizable     bool          `json:"parallelizable"`
	ImpactFiles        []string      `json:"impact_files,omitempty"`
	ReadFiles          []string      `json:"read_files,omitempty"`
	BarrierFiles       []string      `json:"barrier_files,omitempty"`
	ReasoningEffort    string        `json:"reasoning_effort,omitempty"`
	// WasCompleted is durable lifecycle evidence. Older records omit it; a task
	// currently in COMPLETE still counts as completed and persists the marker
	// when it is later archived.
	WasCompleted       bool          `json:"was_completed,omitempty"`
	AllowedTransitions *[]TaskStatus `json:"allowed_transitions,omitempty"`
	// EffortLevel bounds the autonomous attempts of the task's Agent run
	// before it fails. Empty inherits the owning session's level.
	EffortLevel  string            `json:"effort_level,omitempty"`
	RetryContext *TaskRetryContext `json:"retry_context,omitempty"`
	// ConversationURL is the task's one ChatGPT conversation. It is set by the
	// first submitted request and never changes: every round, repair, attempt
	// and retry (FAILED back to READY) continues in it until the task ends.
	ConversationURL string    `json:"conversation_url,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func TaskHasCompleted(task Task) bool {
	return task.WasCompleted || task.Status == TaskComplete
}

func TaskSatisfiesDependency(task Task) bool {
	return task.Status == TaskReview || TaskHasCompleted(task)
}

type TaskAttachment struct {
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	MIME       string `json:"mime"`
	StorageRef string `json:"storage_ref"`
}

type TaskRetryContext struct {
	Guidance           string           `json:"guidance,omitempty"`
	ProjectFiles       []string         `json:"project_files,omitempty"`
	AttachmentCacheKey string           `json:"attachment_cache_key,omitempty"`
	Attachments        []TaskAttachment `json:"attachments,omitempty"`
}

type TaskRun struct {
	ID          string     `json:"id"`
	TaskID      string     `json:"task_id"`
	ProjectPath string     `json:"project_path"`
	SessionID   string     `json:"session_id,omitempty"`
	RequestID   string     `json:"request_id,omitempty"`
	PlanID      string     `json:"execution_plan_id,omitempty"`
	Attempt     int        `json:"attempt"`
	Status      string     `json:"status"`
	Error       string     `json:"error,omitempty"`
	StartedAt   time.Time  `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

type Proposal struct {
	Protocol    string         `json:"protocol"`
	Title       string         `json:"title"`
	Objective   string         `json:"objective"`
	Assumptions []string       `json:"assumptions"`
	Tasks       []ProposalTask `json:"tasks"`
}

type ProposalTask struct {
	ID                 string   `json:"id"`
	Title              string   `json:"title"`
	Description        string   `json:"description"`
	AcceptanceCriteria []string `json:"acceptance_criteria"`
	DependsOn          []string `json:"depends_on"`
	Priority           Priority `json:"priority"`
	Capability         string   `json:"capability"`
	Complexity         string   `json:"complexity"`
	Parallelizable     bool     `json:"parallelizable"`
	ImpactFiles        []string `json:"impact_files"`
	ReadFiles          []string `json:"read_files"`
	BarrierFiles       []string `json:"barrier_files"`
}

type TaskPageFilter struct {
	Status TaskStatus
	Search string
	Limit  int
	Cursor string
}

type TaskPage struct {
	Tasks      []Task `json:"tasks"`
	Total      int    `json:"total"`
	NextCursor string `json:"next_cursor,omitempty"`
	HasMore    bool   `json:"has_more"`
}

type Overview struct {
	Plans             []Plan             `json:"plans"`
	Tasks             []Task             `json:"tasks"`
	TaskCounts        map[TaskStatus]int `json:"task_counts"`
	PlanningRequests  []PlanningRequest  `json:"planning_requests"`
	MutationSlots     int                `json:"mutation_slots"`
	MutationSlotsUsed int                `json:"mutation_slots_used"`
}

type PlanningRequest struct {
	RequestID   string    `json:"request_id"`
	TaskID      string    `json:"task_id"`
	Objective   string    `json:"objective,omitempty"`
	Status      string    `json:"status"`
	Attempt     int       `json:"attempt"`
	MaxAttempts int       `json:"max_attempts"`
	LastError   string    `json:"last_error,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type PlanningAttempt struct {
	TaskID      string    `json:"task_id"`
	Status      string    `json:"status"`
	Attempt     int       `json:"attempt"`
	MaxAttempts int       `json:"max_attempts"`
	LastError   string    `json:"last_error,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type PlanningAttachment struct {
	Name      string `json:"name"`
	Size      int64  `json:"size,omitempty"`
	MIME      string `json:"mime,omitempty"`
	Generated bool   `json:"generated,omitempty"`
}

type PlanningTaskDetail struct {
	Task Task      `json:"task"`
	Runs []TaskRun `json:"runs"`
}

type PlanningRequestDetail struct {
	RequestID       string               `json:"request_id"`
	TaskID          string               `json:"task_id,omitempty"`
	Objective       string               `json:"objective,omitempty"`
	Prompt          string               `json:"prompt,omitempty"`
	Status          string               `json:"status,omitempty"`
	Attempt         int                  `json:"attempt,omitempty"`
	MaxAttempts     int                  `json:"max_attempts,omitempty"`
	LastError       string               `json:"last_error,omitempty"`
	IncludeContext  bool                 `json:"include_context"`
	ProjectFiles    []string             `json:"project_files"`
	Attachments     []PlanningAttachment `json:"attachments"`
	ReasoningEffort string               `json:"reasoning_effort,omitempty"`
	Attempts        []PlanningAttempt    `json:"attempts"`
	Plan            *Plan                `json:"plan,omitempty"`
	Tasks           []PlanningTaskDetail `json:"tasks"`
}

func orchestratorPriorityRank(priority Priority) int {
	switch priority {
	case PriorityUrgent:
		return 0
	case PriorityHigh:
		return 10
	case PriorityLow:
		return 30
	default:
		return 20
	}
}
