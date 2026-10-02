package uitesting

import "time"

type Profile struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Role       string `json:"role"`
	Configured bool   `json:"configured"`
}

type Environment struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description,omitempty"`
	URL         string    `json:"url,omitempty"`
	Profiles    []Profile `json:"profiles"`
}

type TestCase struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Description   string `json:"description,omitempty"`
	Goal          string `json:"goal"`
	EnvironmentID string `json:"environment_id"`
	ProfileID     string `json:"profile_id,omitempty"`
	Priority      string `json:"priority,omitempty"`
	Status        string `json:"status"`
	LastRunID     string `json:"last_run_id,omitempty"`
}

type Step struct {
	Index      int    `json:"index"`
	Action     string `json:"action"`
	Caption    string `json:"caption,omitempty"`
	Outcome    string `json:"outcome,omitempty"`
	Screenshot string `json:"screenshot,omitempty"`
}

type Run struct {
	ID          string    `json:"id"`
	TaskID      string    `json:"task_id,omitempty"`
	TestID      string    `json:"test_id"`
	Status      string    `json:"status"`
	Error       string    `json:"error,omitempty"`
	Steps       []Step    `json:"steps,omitempty"`
	StartedAt   time.Time `json:"started_at"`
	CompletedAt time.Time `json:"completed_at,omitempty"`
}

type Guide struct {
	ID          string    `json:"id"`
	TestID      string    `json:"test_id"`
	RunID       string    `json:"run_id"`
	Title       string    `json:"title"`
	Markdown    string    `json:"markdown"`
	PDFReady    bool      `json:"pdf_ready"`
	Screenshots []Step    `json:"screenshots,omitempty"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Document struct {
	ProjectID      string        `json:"project_id"`
	ContextSHA256  string        `json:"context_sha256,omitempty"`
	SyncStatus     string        `json:"sync_status"`
	SyncTaskID     string        `json:"sync_task_id,omitempty"`
	SyncError      string        `json:"sync_error,omitempty"`
	AutoRunChanges bool          `json:"auto_run_changes"`
	Environments   []Environment `json:"environments"`
	Tests          []TestCase    `json:"tests"`
	Runs           []Run         `json:"runs"`
	Guides         []Guide       `json:"guides"`
	UpdatedAt      time.Time     `json:"updated_at"`
}

type Discovery struct {
	ContextSHA256 string        `json:"context_sha256"`
	Environments  []Environment `json:"environments"`
	Tests         []TestCase    `json:"tests"`
}

type Credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type RunResult struct {
	Status      string       `json:"status"`
	Error       string       `json:"error,omitempty"`
	GuideTitle  string       `json:"guide_title,omitempty"`
	GuideMD     string       `json:"guide_markdown,omitempty"`
	PDFBase64   string       `json:"pdf_base64,omitempty"`
	Screenshots []Screenshot `json:"screenshots,omitempty"`
	Steps       []Step       `json:"steps,omitempty"`
}

type Screenshot struct {
	Name          string `json:"name"`
	Caption       string `json:"caption,omitempty"`
	ContentBase64 string `json:"content_base64"`
}
