package domain

import "time"

const (
	ProjectTodoOpen = "open"
	ProjectTodoDone = "done"

	ProjectTodoClassificationQueued     = "queued"
	ProjectTodoClassificationClassified = "classified"
	ProjectTodoClassificationFailed     = "failed"

	ProjectTodoExecutionOpen       = "open"
	ProjectTodoExecutionProcessing = "processing"
	ProjectTodoExecutionDone       = "done"
	ProjectTodoExecutionFailed     = "failed"
)

type ProjectTodoAttachment struct {
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	MIME        string `json:"mime"`
	StorageRef  string `json:"storage_ref"`
	PreviewKind string `json:"preview_kind,omitempty"`
}

type ProjectTodo struct {
	ID                   string                  `json:"id"`
	ProjectPath          string                  `json:"project_path"`
	Body                 string                  `json:"body"`
	Status               string                  `json:"status"`
	Kind                 string                  `json:"kind,omitempty"`
	Urgency              string                  `json:"urgency,omitempty"`
	Description          string                  `json:"description,omitempty"`
	PrePlan              []string                `json:"pre_plan,omitempty"`
	ClassificationStatus string                  `json:"classification_status"`
	ClassificationTaskID string                  `json:"classification_task_id,omitempty"`
	ClassificationError  string                  `json:"classification_error,omitempty"`
	AttachmentCacheKey   string                  `json:"attachment_cache_key,omitempty"`
	Attachments          []ProjectTodoAttachment `json:"attachments,omitempty"`
	ProjectFiles         []string                `json:"project_files,omitempty"`
	ExecutionStatus      string                  `json:"execution_status,omitempty"`
	ExecutionRequestID   string                  `json:"execution_request_id,omitempty"`
	ExecutionSessionID   string                  `json:"execution_session_id,omitempty"`
	ExecutionChatID      string                  `json:"execution_chat_id,omitempty"`
	ExecutionTarget      string                  `json:"execution_target,omitempty"`
	ExecutionPlanID      string                  `json:"execution_plan_id,omitempty"`
	ExecutionError       string                  `json:"execution_error,omitempty"`
	ArchivedAt           *time.Time              `json:"archived_at,omitempty"`
	CreatedAt            time.Time               `json:"created_at"`
	UpdatedAt            time.Time               `json:"updated_at"`
}
