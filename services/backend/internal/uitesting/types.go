package uitesting

import (
	"time"

	"kernl.local/harness/backend/internal/uitesting/textlist"
)

type Profile struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	Role       string `json:"role"`
	Configured bool   `json:"configured"`
}

type Environment struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	URL         string `json:"url,omitempty"`
	// Notes is operator-provided, non-secret reference data for GPT (existing
	// record identifiers, sample values). Local configuration, like URL.
	Notes    string    `json:"notes,omitempty"`
	Profiles []Profile `json:"profiles"`
}

// TestCase is one catalog entry. Status and LastRunID are execution state owned
// by Wharnex; every other field is the definition GPT (or the operator's brief)
// authored, and only the definition feeds DefinitionDigest.
type TestCase struct {
	ID             string         `json:"id"`
	Title          string         `json:"title"`
	Description    string         `json:"description,omitempty"`
	Goal           string         `json:"goal"`
	EnvironmentID  string         `json:"environment_id"`
	ProfileID      string         `json:"profile_id,omitempty"`
	Priority       string         `json:"priority,omitempty"`
	Access         string         `json:"access,omitempty"`
	Category       string         `json:"category,omitempty"`
	Preconditions  textlist.List  `json:"preconditions,omitempty"`
	Steps          []StrategyStep `json:"steps,omitempty"`
	ExpectedResult string         `json:"expected_result,omitempty"`
	TestData       textlist.List  `json:"test_data,omitempty"`
	DependsOn      []string       `json:"depends_on,omitempty"`
	Tags           textlist.List  `json:"tags,omitempty"`
	Source         string         `json:"source,omitempty"`
	Brief          string         `json:"brief,omitempty"`
	Status         string         `json:"status"`
	LastRunID      string         `json:"last_run_id,omitempty"`
}

// StrategyStep is one planned step of a test's execution strategy.
type StrategyStep struct {
	Action   string `json:"action"`
	Expected string `json:"expected,omitempty"`
}

// DesignRequest tracks an operator brief sent to GPT to design new tests.
type DesignRequest struct {
	TaskID        string    `json:"task_id"`
	Brief         string    `json:"brief"`
	EnvironmentID string    `json:"environment_id,omitempty"`
	Status        string    `json:"status"`
	Error         string    `json:"error,omitempty"`
	TestIDs       []string  `json:"test_ids,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// SessionSummary is the non-secret view of a persisted browser session.
type SessionSummary struct {
	ID            string    `json:"id"`
	EnvironmentID string    `json:"environment_id"`
	TestID        string    `json:"test_id"`
	ProfileID     string    `json:"profile_id,omitempty"`
	Covers        []string  `json:"covers"`
	Valid         bool      `json:"valid"`
	CapturedAt    time.Time `json:"captured_at"`
	ExpiresAt     time.Time `json:"expires_at"`
}

type Step struct {
	Index   int    `json:"index"`
	Action  string `json:"action"`
	Caption string `json:"caption,omitempty"`
	// ScreenCaption is GPT's description of the screenshot taken before this
	// step: the legend shown under the capture in guides and in the PDF.
	ScreenCaption string `json:"screen_caption,omitempty"`
	Outcome       string `json:"outcome,omitempty"`
	Screenshot    string `json:"screenshot,omitempty"`
}

type Run struct {
	ID           string    `json:"id"`
	TaskID       string    `json:"task_id,omitempty"`
	TestID       string    `json:"test_id"`
	Status       string    `json:"status"`
	Error        string    `json:"error,omitempty"`
	Role         string    `json:"role,omitempty"`
	ParentRunID  string    `json:"parent_run_id,omitempty"`
	RestoredFrom string    `json:"restored_from,omitempty"`
	Steps        []Step    `json:"steps,omitempty"`
	StartedAt    time.Time `json:"started_at"`
	CompletedAt  time.Time `json:"completed_at,omitempty"`
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
	ProjectID      string           `json:"project_id"`
	ContextSHA256  string           `json:"context_sha256,omitempty"`
	SyncStatus     string           `json:"sync_status"`
	SyncTaskID     string           `json:"sync_task_id,omitempty"`
	SyncError      string           `json:"sync_error,omitempty"`
	SyncSummary    string           `json:"sync_summary,omitempty"`
	AutoRunChanges bool             `json:"auto_run_changes"`
	Environments   []Environment    `json:"environments"`
	Tests          []TestCase       `json:"tests"`
	Runs           []Run            `json:"runs"`
	Guides         []Guide          `json:"guides"`
	Designs        []DesignRequest  `json:"designs"`
	Sessions       []SessionSummary `json:"sessions"`
	UpdatedAt      time.Time        `json:"updated_at"`
}

// Discovery origins decide merge authority: a synchronization never overwrites
// an operator-requested test, while a design request is that operator's own.
const (
	DiscoveryOriginSync   = "sync"
	DiscoveryOriginDesign = "design"
)

type Discovery struct {
	ContextSHA256   string        `json:"context_sha256"`
	Origin          string        `json:"origin,omitempty"`
	Replace         bool          `json:"replace,omitempty"`
	Summary         string        `json:"summary,omitempty"`
	Environments    []Environment `json:"environments"`
	Tests           []TestCase    `json:"tests"`
	ObsoleteTestIDs []string      `json:"obsolete_test_ids,omitempty"`
	// ObsoleteEnvironmentIDs retires environments out of scope (for example a
	// native-device app): their discovered tests go with them.
	ObsoleteEnvironmentIDs []string `json:"obsolete_environment_ids,omitempty"`
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
