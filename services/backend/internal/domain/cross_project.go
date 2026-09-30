package domain

import (
	"strings"
	"time"
)

type CrossProjectUnit struct {
	// Project is the reference name from the request's own `@ref:` grant, never
	// a filesystem path. A path chosen by the model is a containment problem;
	// a name is resolved by Wharnex against what the operator already granted.
	Project       string        `json:"project"`
	CommitMessage string        `json:"commit_message"`
	Summary       string        `json:"summary,omitempty"`
	Operations    []Operation   `json:"operations"`
	Verification  []CommandSpec `json:"verification,omitempty"`
}

// CrossProjectGrant records which projects one request was allowed to change.
//
// The grant is derived from the `@ref:` directives in the request's own main
// prompt and recorded durably at submit time, so a later continuation inherits
// exactly the authority the operator gave and can never widen it by naming a
// new project in a bundle. It is keyed by the root request id because a
// continuation is the same Main Request, not a new grant.
type CrossProjectGrant struct {
	RootRequestID string                `json:"root_request_id"`
	Projects      []CrossProjectGrantee `json:"projects"`
	GrantedAt     time.Time             `json:"granted_at"`
}

// CrossProjectGrantee is one granted project: the name the prompt used, the
// canonical host path it resolved to, and any files the operator singled out.
type CrossProjectGrantee struct {
	Name        string   `json:"name"`
	ProjectPath string   `json:"project_path"`
	Files       []string `json:"files,omitempty"`
	// Attached reports whether this project's context was already part of the
	// session snapshot when the reference resolved. A granted project that was
	// not attached had its context brought in for this request.
	Attached bool `json:"attached,omitempty"`
}

// KnownProjectRef is a project Wharnex has worked on before, named so a
// reference can resolve to it whether or not it happens to be open.
type KnownProjectRef struct {
	Name        string `json:"name"`
	ProjectPath string `json:"project_path"`
	Open        bool   `json:"open"`
}

type CommandResult struct {
	Argv             []string `json:"argv"`
	Cwd              string   `json:"cwd"`
	ExitCode         int      `json:"exit_code"`
	Stdout           string   `json:"stdout"`
	Stderr           string   `json:"stderr"`
	DurationMS       int64    `json:"duration_ms"`
	Success          bool     `json:"success"`
	BaselineFailure  bool     `json:"baseline_failure,omitempty"`
	BaselineExitCode int      `json:"baseline_exit_code,omitempty"`
	BaselineOutput   string   `json:"baseline_output,omitempty"`
}

type ExecutionBundleInfo struct {
	Filename string   `json:"filename"`
	README   string   `json:"readme"`
	Files    []string `json:"files"`
	Patches  []string `json:"patches"`
	SHA256   string   `json:"sha256"`
	// CumulativeSummary is the response bundle's summary.md. It is staged
	// throughout one Main Request and only surfaced after that Main Request
	// reaches its real terminal boundary (for changes: successful host Apply).
	CumulativeSummary string `json:"cumulative_summary,omitempty"`
	// ProjectKnowledgeCandidate is the v2 catalog returned with an ordinary
	// planner response. Wharnex stages it while the Main Request is in flight
	// and commits it only at that request's terminal boundary.
	ProjectKnowledgeCandidate *ProjectKnowledgeCandidate `json:"project_knowledge_candidate,omitempty"`
	// AttemptLedgerNarrative is the response bundle's attempts/ledger.md: the
	// planner's cumulative, incrementally refined account of what has been
	// proven to work and to fail locally during this Main Request. Absent on a
	// degraded response, which is recorded and tolerated rather than rejected —
	// a bookkeeping artifact must never discard a verified executable payload.
	AttemptLedgerNarrative string `json:"attempt_ledger_narrative,omitempty"`
	// ProjectKnowledgeUpdate is the legacy optional knowledge.md payload kept
	// only so an already-pending pre-v2 knowledge_review can still finish after
	// an upgrade. New requests use knowledge/index.json plus one Markdown file
	// per knowledge record and never schedule a knowledge_review round.
	ProjectKnowledgeUpdate string `json:"project_knowledge_update,omitempty"`
}

// ProjectKnowledge is the legacy single-document projection retained for API
// and migration compatibility. New storage is ProjectKnowledgeCatalog, where
// every knowledge item is an independent record.
type ProjectKnowledge struct {
	ProjectPath        string    `json:"project_path"`
	Content            string    `json:"content"`
	Version            int       `json:"version"`
	UpdatedAt          time.Time `json:"updated_at"`
	UpdatedByRequestID string    `json:"updated_by_request_id,omitempty"`
}

// ProjectKnowledgeEntry is one durable, independently versioned knowledge
// record. ID is stable across edits so the planner can update, split, merge,
// deduplicate, or remove records without treating the catalog as one blob.
type ProjectKnowledgeEntry struct {
	ID                 string    `json:"id"`
	Content            string    `json:"content"`
	Category           string    `json:"category,omitempty"`
	Version            int       `json:"version"`
	UpdatedAt          time.Time `json:"updated_at"`
	UpdatedByRequestID string    `json:"updated_by_request_id,omitempty"`
}

const (
	KnowledgeCategoryConflictResolution = "conflict_resolution"
	KnowledgeCategoryPatchStrategy      = "patch_strategy"
	KnowledgeCategoryExecutionRepair    = "execution_repair"
	KnowledgeCategoryVerification       = "verification"
	KnowledgeCategoryRuntimeEnvironment = "runtime_environment"
	KnowledgeCategoryProtocolTransport  = "protocol_transport"
	KnowledgeCategoryProductDomain      = "product_domain"
	KnowledgeCategoryGeneral            = "general"
)

var knowledgeCategories = map[string]struct{}{
	KnowledgeCategoryConflictResolution: {},
	KnowledgeCategoryPatchStrategy:      {},
	KnowledgeCategoryExecutionRepair:    {},
	KnowledgeCategoryVerification:       {},
	KnowledgeCategoryRuntimeEnvironment: {},
	KnowledgeCategoryProtocolTransport:  {},
	KnowledgeCategoryProductDomain:      {},
	KnowledgeCategoryGeneral:            {},
}

// IsKnowledgeCategory reports whether category is one of the canonical
// knowledge categories. Matching is case-insensitive and ignores outer space.
func IsKnowledgeCategory(category string) bool {
	_, ok := knowledgeCategories[strings.ToLower(strings.TrimSpace(category))]
	return ok
}

// NormalizeKnowledgeCategory preserves valid explicit categories, classifies
// historical uncategorized records conservatively, and fails closed for an
// unknown explicit value.
func NormalizeKnowledgeCategory(category, id, content string) string {
	category = strings.ToLower(strings.TrimSpace(category))
	if category != "" {
		if IsKnowledgeCategory(category) {
			return category
		}
		return KnowledgeCategoryGeneral
	}
	return InferKnowledgeCategory(id, content)
}

// KnowledgeCategorySupportsSelfEvolution is deliberately allowlist-based so
// project-domain or unknown/general knowledge never reaches self-evolution.
func KnowledgeCategorySupportsSelfEvolution(category string) bool {
	switch strings.ToLower(strings.TrimSpace(category)) {
	case KnowledgeCategoryConflictResolution,
		KnowledgeCategoryPatchStrategy,
		KnowledgeCategoryExecutionRepair,
		KnowledgeCategoryVerification,
		KnowledgeCategoryRuntimeEnvironment,
		KnowledgeCategoryProtocolTransport:
		return true
	default:
		return false
	}
}
