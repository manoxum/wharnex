package domain

import (
	"encoding/json"
	"time"
)

const (
	// ContextDeltaProtocolV1 identifies the divergence report Wharnex attaches
	// to every continuation request: exactly how the local project has moved
	// since the full snapshot the planner already holds from the Main Request.
	ContextDeltaProtocolV1 = "harness.context-delta/v1"

	// ContextDeltaSourceGit is a real three-way-capable comparison between two
	// anchored request-base commits, including content.
	ContextDeltaSourceGit = "git"
	// ContextDeltaSourceManifest is the degraded path-only comparison derived
	// from two context manifests when Git cannot answer.
	ContextDeltaSourceManifest = "manifest"
	// ContextDeltaSourceUnavailable means Wharnex could not prove what changed.
	// The planner must then treat the attached manifest as authoritative.
	ContextDeltaSourceUnavailable = "unavailable"
)

// ContextDeltaFile is one path that diverged between the base snapshot the
// planner holds and the snapshot this request was built from.
type ContextDeltaFile struct {
	Path      string `json:"path"`
	Status    string `json:"status"`
	Additions int    `json:"additions,omitempty"`
	Deletions int    `json:"deletions,omitempty"`
}

// ContextDelta is the divergence between one request's project snapshot and
// the snapshot of the Main Request its conversation was seeded with.
//
// Resending a complete baseline every wave is expensive and, worse, ambiguous:
// the planner cannot tell which files genuinely moved from which files merely
// got a new manifest hash. Naming the exact divergence lets it keep reasoning
// against the snapshot it already has.
type ContextDelta struct {
	Protocol           string             `json:"protocol"`
	BaseRequestID      string             `json:"base_request_id"`
	BaseManifestSHA256 string             `json:"base_manifest_sha256,omitempty"`
	BaseCommit         string             `json:"base_commit,omitempty"`
	CurrentRequestID   string             `json:"current_request_id"`
	CurrentManifestSHA string             `json:"current_manifest_sha256,omitempty"`
	CurrentCommit      string             `json:"current_commit,omitempty"`
	Source             string             `json:"source"`
	Unchanged          bool               `json:"unchanged"`
	Files              []ContextDeltaFile `json:"files,omitempty"`
	// Truncated reports that more paths diverged than the report lists, so the
	// planner knows the list is a sample rather than the complete write set.
	Truncated bool `json:"truncated,omitempty"`
	// Patch is the real unified diff when it fits the transport budget. It is
	// what turns "these files changed" into "here is exactly what changed",
	// which is the difference between a planner re-reading the whole project
	// and a planner rebasing its own pending edit.
	Patch string `json:"-"`
	// PatchOmittedReason explains an absent patch (too large, no Git, ...) so
	// the planner does not infer that the listed files changed trivially.
	PatchOmittedReason string `json:"patch_omitted_reason,omitempty"`
}

type InteractiveOperationResult struct {
	OperationID string    `json:"operation_id"`
	Type        string    `json:"type"`
	Capability  string    `json:"capability"`
	Target      string    `json:"target"`
	Status      string    `json:"status"`
	StartedAt   time.Time `json:"started_at"`
	CompletedAt time.Time `json:"completed_at"`
	Output      string    `json:"output,omitempty"`
	Error       string    `json:"error,omitempty"`
	Truncated   bool      `json:"truncated,omitempty"`
	Redacted    bool      `json:"redacted,omitempty"`
	Bytes       int       `json:"bytes,omitempty"`
	Rows        int       `json:"rows,omitempty"`
}

type ExecutionResult struct {
	PlanID      string                       `json:"plan_id"`
	Success     bool                         `json:"success"`
	StartedAt   time.Time                    `json:"started_at"`
	CompletedAt time.Time                    `json:"completed_at"`
	Commands    []CommandResult              `json:"commands"`
	Interactive []InteractiveOperationResult `json:"interactive,omitempty"`
	Error       string                       `json:"error,omitempty"`
	Warnings    []string                     `json:"warnings,omitempty"`
}

func (r ExecutionResult) MarshalJSON() ([]byte, error) {
	type executionResult ExecutionResult
	if r.Commands == nil {
		r.Commands = []CommandResult{}
	}
	return json.Marshal(executionResult(r))
}

// BaselineNotice records one project-context transition observed by a peer
// session. CompleteDelta is false when Wharnex could not prove that the peer
// observed the immediately preceding baseline, disabling optimistic fast-forward.
type BaselineNotice struct {
	ID              string    `json:"id"`
	SourceSessionID string    `json:"source_session_id"`
	SourcePlanID    string    `json:"source_plan_id"`
	PreviousSHA256  string    `json:"previous_sha256"`
	NewSHA256       string    `json:"new_sha256"`
	ChangedFiles    []string  `json:"changed_files"`
	OverlapFiles    []string  `json:"overlap_files,omitempty"`
	Relevant        bool      `json:"relevant"`
	CompleteDelta   bool      `json:"complete_delta"`
	CreatedAt       time.Time `json:"created_at"`
}

type ProjectRevision struct {
	ParentSHA256 string    `json:"parent_sha256,omitempty"`
	SHA256       string    `json:"sha256"`
	ChangedFiles []string  `json:"changed_files,omitempty"`
	Source       string    `json:"source"`
	Complete     bool      `json:"complete"`
	ObservedAt   time.Time `json:"observed_at"`
}

// PendingHostChange is a Protected plan that has passed sandbox verification
// but has not yet been accepted into the host project. Keeping the plan and its
// execution together lets later plans verify against the cumulative candidate
// without making the host the source of truth prematurely.
type PendingHostChange struct {
	Plan       ExecutionPlan   `json:"plan"`
	Execution  ExecutionResult `json:"execution"`
	VerifiedAt time.Time       `json:"verified_at"`
	// ChangeSet is the legacy CAS-based integration record. New candidates
	// no longer set it (see IntegrationBranch); it is kept only so a
	// candidate already persisted before this field existed can be promoted
	// to the Git-native branch contract at Apply time instead of being
	// stranded or bypassing the selected commit mode.
	ChangeSet *ChangeSet `json:"change_set,omitempty"`
	// IntegrationBranch is the Git branch holding this candidate's verified
	// commit, already pushed into the host's own .git (never a remote) at
	// verification time — see internal/sandbox/gitintegration.go. Applying
	// this candidate is a real `git merge` of this branch into the host's
	// checked-out branch, not a file-level compare-and-swap.
	IntegrationBranch string `json:"integration_branch,omitempty"`
	// IntegrationCommit is the commit SHA IntegrationBranch pointed to right
	// after it was created, for audit/diagnostics.
	IntegrationCommit string `json:"integration_commit,omitempty"`
	// IntegrationBaseRequestID overrides the request-base anchor used when a
	// pending candidate has been narrowed by a later focused conflict
	// resolution. The candidate keeps its original Plan.RequestID for lineage
	// and branch identity, but any surviving delta must be materialized on top
	// of the resolution request's base so promotion cannot resurrect stale
	// ancestry that caused an incidental conflict outside the plan write set.
	IntegrationBaseRequestID string `json:"integration_base_request_id,omitempty"`
	// SubmoduleIntegrations are verified commits created in repositories nested
	// below the open superproject. Apply merges IntegrationBranch, then advances
	// each nested repository on the branch captured during verification.
	SubmoduleIntegrations []RepositoryIntegration `json:"submodule_integrations,omitempty"`
}
