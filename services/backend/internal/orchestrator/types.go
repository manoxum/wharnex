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
	Plans             []Plan             `json:"plans"`
	Tasks             []Task             `json:"tasks"`
	TaskCounts        map[TaskStatus]int `json:"task_counts"`
	PlanningRequests  []PlanningRequest  `json:"planning_requests"`
	RecentReviews     []TaskConclusion   `json:"recent_reviews"`
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
	// Bundles are the request and response ZIPs exchanged with ChatGPT to
	// produce this plan, in the artifact shape the bundle explorer reads.
	Bundles []PlanningBundle `json:"bundles"`
}

type PlanningBundle struct {
	ID          string    `json:"id"`
	RequestID   string    `json:"request_id,omitempty"`
	Direction   string    `json:"direction"`
	Kind        string    `json:"kind"`
	Name        string    `json:"name"`
	ContentType string    `json:"content_type,omitempty"`
	Size        int64     `json:"size"`
	SHA256      string    `json:"sha256"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	Bundle      bool      `json:"bundle"`
	BundleType  string    `json:"bundle_type,omitempty"`
	EntryCount  int       `json:"entry_count,omitempty"`
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
