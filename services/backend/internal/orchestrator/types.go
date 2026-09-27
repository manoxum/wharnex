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
	CreatedAt          time.Time     `json:"created_at"`
	UpdatedAt          time.Time     `json:"updated_at"`
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

type Overview struct {
	Plans             []Plan            `json:"plans"`
	Tasks             []Task            `json:"tasks"`
	PlanningRequests  []PlanningRequest `json:"planning_requests"`
	MutationSlots     int               `json:"mutation_slots"`
	MutationSlotsUsed int               `json:"mutation_slots_used"`
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
