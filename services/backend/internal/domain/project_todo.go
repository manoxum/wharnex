package domain

import "time"

const (
	ProjectTodoOpen = "open"
	ProjectTodoDone = "done"

	ProjectTodoClassificationQueued     = "queued"
	ProjectTodoClassificationClassified = "classified"
	ProjectTodoClassificationFailed     = "failed"
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
	ClassificationStatus string                  `json:"classification_status"`
	ClassificationTaskID string                  `json:"classification_task_id,omitempty"`
	ClassificationError  string                  `json:"classification_error,omitempty"`
	AttachmentCacheKey   string                  `json:"attachment_cache_key,omitempty"`
	Attachments          []ProjectTodoAttachment `json:"attachments,omitempty"`
	ProjectFiles         []string                `json:"project_files,omitempty"`
	CreatedAt            time.Time               `json:"created_at"`
	UpdatedAt            time.Time               `json:"updated_at"`
}
