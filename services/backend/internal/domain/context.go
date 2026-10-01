package domain

import "time"

// which reconciliation it is being asked for rather than having to infer it.
const (
	GitConflictOriginIntegration = "integration"
	GitConflictOriginPush        = "push"
	GitConflictOriginBranchMerge = "branch_merge"
	GitConflictOriginPull        = "pull"
	GitConflictOriginRemoteMerge = "remote_branch_merge"
)

// GitConflictContext describes a host Git merge whose conflict is awaiting a
// planner resolution, with everything needed to replay that exact merge later.
type GitConflictContext struct {
	Origin string `json:"origin"`
	// Ref is the incoming ref being merged, as Git resolves it.
	Ref string `json:"ref"`
	// Remote and RemoteBranch are set for a push-triggered integration.
	Remote       string `json:"remote,omitempty"`
	RemoteBranch string `json:"remote_branch,omitempty"`
	// BaseSHA/OursSHA/TheirsSHA are the three sides of the merge. They are
	// recorded before the merge is aborted, because afterwards Git keeps no
	// MERGE_HEAD to recover them from.
	BaseSHA   string `json:"base_sha"`
	OursSHA   string `json:"ours_sha"`
	TheirsSHA string `json:"theirs_sha"`
	// TargetBranch is the local branch the merge lands on.
	TargetBranch string `json:"target_branch,omitempty"`
	// SourceRefs preserves the ordered source set of an isolated remote merge.
	SourceRefs []string `json:"source_refs,omitempty"`
	// AutoDispatch is set once the operator's choice (the project's GPT-only
	// strategy handing it to a dedicated chat, or an explicit delegation) makes
	// the conflict prompt sendable without another decision.
	AutoDispatch bool `json:"auto_dispatch,omitempty"`
}

type RequestLineage struct {
	RequestID       string    `json:"request_id"`
	RootRequestID   string    `json:"root_request_id"`
	ParentRequestID string    `json:"parent_request_id,omitempty"`
	Kind            string    `json:"kind"`
	CreatedAt       time.Time `json:"created_at"`
}

type ContextFile struct {
	Path        string `json:"path"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
	ContentType string `json:"content_type,omitempty"`
}

type ContextExclusion struct {
	Path   string `json:"path"`
	Kind   string `json:"kind"`
	Reason string `json:"reason"`
	Rule   string `json:"rule"`
}

type ContextManifest struct {
	ID              string             `json:"id"`
	ProjectRoot     string             `json:"project_root"`
	SHA256          string             `json:"sha256"`
	Files           []ContextFile      `json:"files"`
	Excluded        []string           `json:"excluded"`
	ExcludedDetails []ContextExclusion `json:"excluded_details,omitempty"`
	TextTruncated   bool               `json:"text_truncated"`
}

type ContextBundle struct {
	ID              string                  `json:"id"`
	ZipPath         string                  `json:"-"`
	TextPath        string                  `json:"-"`
	Manifest        ContextManifest         `json:"manifest"`
	WorkspaceSHA256 string                  `json:"workspace_sha256,omitempty"`
	RelatedProjects []RelatedProjectContext `json:"related_projects,omitempty"`
	Attachments     []AttachedPathContext   `json:"attachments,omitempty"`
}

// RelatedProjectContext describes a user-bound companion repository included
// as namespaced, read-only evidence in the planner context. The primary
// manifest remains the only execution baseline for this Session.
// AttachedPathContext describes one external file or directory an `@attach`
// directive brought into this context.
//
// It is read-only material from outside every project: never a patch target,
// never a path in a plan. The counters exist so the operator can see what their
// selection actually admitted, and Truncated so an attachment that hit a bound
// says so instead of quietly arriving incomplete.
type AttachedPathContext struct {
	Root          string   `json:"root"`
	Name          string   `json:"name"`
	Kind          string   `json:"kind"`
	Prefix        string   `json:"prefix"`
	Files         int      `json:"files"`
	Bytes         int64    `json:"bytes"`
	ExcludedItems int      `json:"excluded_items,omitempty"`
	Truncated     bool     `json:"truncated,omitempty"`
	IncludedPaths []string `json:"included_paths,omitempty"`
}

type RelatedProjectContext struct {
	ProjectPath string          `json:"project_path"`
	Name        string          `json:"name"`
	Prefix      string          `json:"prefix"`
	Manifest    ContextManifest `json:"manifest"`
}

type PlanExecutionControl struct {
	PlanID    string    `json:"plan_id"`
	State     string    `json:"state"`
	UpdatedAt time.Time `json:"updated_at"`
}
