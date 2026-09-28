package orchestrator

import "time"

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
	// FirstDoingAt is monotonic lifecycle evidence. Once a task has been
	// persisted in DOING, stores preserve the original timestamp across every
	// later status, including retries and archival.
	FirstDoingAt *time.Time `json:"first_doing_at,omitempty"`
	// WasCompleted is durable lifecycle evidence. Older records omit it; a task
	// currently in COMPLETE still counts as completed and persists the marker
	// when it is later archived.
	WasCompleted       bool          `json:"was_completed,omitempty"`
	AllowedTransitions *[]TaskStatus `json:"allowed_transitions,omitempty"`
	// EffortLevel bounds the autonomous attempts of the task's Agent run
	// before it fails. Empty inherits the owning session's level.
	EffortLevel  string            `json:"effort_level,omitempty"`
	RetryContext *TaskRetryContext `json:"retry_context,omitempty"`
	// ConversationURL and ConversationID form the task's immutable ChatGPT
	// affinity. The first leased ORCHESTRATOR_EXECUTE request establishes both;
	// every round, repair, retry and archive preserves them.
	ConversationURL string    `json:"conversation_url,omitempty"`
	ConversationID  string    `json:"conversation_id,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func TaskHasCompleted(task Task) bool {
	return task.WasCompleted || task.Status == TaskComplete
}

// TaskHasEnteredDoing keeps transition policy safe for both records written
// after FirstDoingAt was introduced and legacy records whose current status
// proves that execution has already owned the task.
func TaskHasEnteredDoing(task Task) bool {
	return task.FirstDoingAt != nil || task.Status == TaskDoing || task.Status == TaskReview || task.Status == TaskFailed || TaskHasCompleted(task)
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
