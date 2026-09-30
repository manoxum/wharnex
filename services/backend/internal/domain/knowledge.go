package domain

import (
	"strings"
	"time"
)

// InferKnowledgeCategory classifies legacy records only when their identifier
// or content carries a strong operational signal. Ambiguous records remain
// general so historical project-specific knowledge is not promoted by mistake.
func InferKnowledgeCategory(id, content string) string {
	id = strings.ToLower(strings.TrimSpace(id))
	body := strings.ToLower(strings.TrimSpace(content))

	switch {
	case containsKnowledgeSignal(id, "conflict", "three-way", "3-way") ||
		containsKnowledgeSignal(body, "conflict resolution", "merge conflict", "three-way merge", "3-way merge"):
		return KnowledgeCategoryConflictResolution
	case containsKnowledgeSignal(id, "patch", "hunk") ||
		containsKnowledgeSignal(body, "git apply", "apply_patch", "patch hunk", "unified diff", "patch strategy"):
		return KnowledgeCategoryPatchStrategy
	case containsKnowledgeSignal(id, "verification", "testing", "regression-test", "regression-testing", "quality-gate") ||
		containsKnowledgeSignal(body, "verification gate", "quality gate", "regression test", "go test", "vitest", "typecheck"):
		return KnowledgeCategoryVerification
	case containsKnowledgeSignal(id, "runtime-environment", "host-command", "toolchain", "sandbox-tool") ||
		containsKnowledgeSignal(body, "runtime environment", "host command", "toolchain", "missing executable", "dependency cache"):
		return KnowledgeCategoryRuntimeEnvironment
	case containsKnowledgeSignal(id, "repair", "recovery", "correction", "revert", "rollback", "restart") ||
		containsKnowledgeSignal(body, "execution repair", "verification failed", "build failed", "host-pending", "rollback", "recovery"):
		return KnowledgeCategoryExecutionRepair
	case containsKnowledgeSignal(id, "protocol", "transport", "bundle", "context-map") ||
		containsKnowledgeSignal(body, "protocol", "request archive", "response bundle", "wire shape", "transport"):
		return KnowledgeCategoryProtocolTransport
	default:
		return KnowledgeCategoryGeneral
	}
}

func containsKnowledgeSignal(value string, signals ...string) bool {
	for _, signal := range signals {
		if strings.Contains(value, signal) {
			return true
		}
	}
	return false
}

// ProjectKnowledgeCatalog is the current per-project catalog. Revision changes
// whenever any record is committed and is what lets another parallel chat
// detect that its next request must refresh/re-enable knowledge sharing.
type ProjectKnowledgeCatalog struct {
	ProjectPath        string                  `json:"project_path"`
	Revision           int64                   `json:"revision"`
	Entries            []ProjectKnowledgeEntry `json:"entries"`
	UpdatedAt          time.Time               `json:"updated_at"`
	UpdatedByRequestID string                  `json:"updated_by_request_id,omitempty"`
}

const (
	KnowledgeCandidateReplace = "replace"
	KnowledgeCandidateOverlay = "overlay"
)

// ProjectKnowledgeCandidate is planner-authored catalog state from one
// response. replace is allowed only when the request received the catalog;
// overlay carries only newly learned/changed records when sharing was off.
type ProjectKnowledgeCandidate struct {
	BaseRevision int64                   `json:"base_revision"`
	Mode         string                  `json:"mode"`
	Entries      []ProjectKnowledgeEntry `json:"entries"`
}

const (
	KnowledgeProtocolV2   = "harness.knowledge/v2"
	KnowledgeStateNone    = "none"
	KnowledgeStatePresent = "present"
)

// RequestKnowledgeSnapshot is the immutable knowledge identity attached to one
// planner request. It is server-only session state so every transport can use
// exactly the same document/version/hash that was embedded in the prompt.
type RequestKnowledgeSnapshot struct {
	Protocol string `json:"protocol,omitempty"`
	State    string `json:"state"`
	// Content/Version remain as a read-compatible projection for an already
	// pending legacy request. New v2 transports use Entries/Revision.
	Content            string                  `json:"content,omitempty"`
	Version            int                     `json:"version,omitempty"`
	SHA256             string                  `json:"sha256,omitempty"`
	UpdatedByRequestID string                  `json:"updated_by_request_id,omitempty"`
	Revision           int64                   `json:"revision,omitempty"`
	SharingEnabled     bool                    `json:"sharing_enabled"`
	Entries            []ProjectKnowledgeEntry `json:"entries,omitempty"`
	// BaseEntries is the durable catalog at Revision, before any staged
	// candidate from this Main Request is overlaid for transport. It is kept
	// only in Wharnex session persistence so terminal reconciliation can retain
	// deletions/edits across repair/workflow rounds without sending hidden
	// records when chat sharing is off.
	BaseEntries []ProjectKnowledgeEntry `json:"base_entries,omitempty"`
}

const (
	// AttemptProtocolV1 identifies the session attempt ledger: the
	// incrementally improved, session-scoped record of what has already been
	// proven to work and to fail on THIS machine during ONE Main Request.
	//
	// It is deliberately separate from harness.knowledge/v2. Knowledge is
	// durable project truth committed only after a Main Request succeeds; the
	// ledger is disposable scaffolding whose whole purpose is to stop a
	// planner from re-proposing an approach an earlier round already disproved
	// locally. Folding the two together is what previously left the planner
	// with no protocol slot for "attempt 2's patch did not apply" — a fact
	// that is decisive for the next round and worthless as project history.
	AttemptProtocolV1 = "harness.attempts/v1"

	// Attempt round classifications. These are Wharnex measurements, never
	// planner claims, so a round that failed cannot quietly disappear from the
	// next request because the model chose not to write it down.
	AttemptOutcomeSucceeded          = "succeeded"
	AttemptOutcomeBundleRejected     = "bundle_rejected"
	AttemptOutcomePolicyBlocked      = "policy_blocked"
	AttemptOutcomeVerificationFailed = "verification_failed"
	AttemptOutcomeIntegrationFailed  = "integration_failed"
	AttemptOutcomeConflict           = "conflict"
	AttemptOutcomeInfrastructure     = "infrastructure_blocked"
	AttemptOutcomeObservation        = "observation"
)

// AttemptRound is one Wharnex-measured round inside a Main Request. It records
// what was actually attempted and what actually happened, independent of what
// the planner reported about itself.
type AttemptRound struct {
	Round     int    `json:"round"`
	RequestID string `json:"request_id"`
	Kind      string `json:"kind"`
	PlanID    string `json:"plan_id,omitempty"`
	Outcome   string `json:"outcome"`
	// Detail is the single most actionable sentence about this round, already
	// truncated. Full diagnostics stay in the request message and event log;
	// duplicating them here would grow every later round's prompt without
	// adding a decision the planner cannot already make.
	Detail string `json:"detail,omitempty"`
	// Commands are the argv lines that actually ran and their exit codes, so a
	// later round can see that a tool was already tried and how it ended.
	Commands  []string  `json:"commands,omitempty"`
	Paths     []string  `json:"paths,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// AttemptLedger is the session-scoped attempt state for one Main Request.
//
// Rounds are Wharnex's own measurement and are authoritative. Narrative is the
// planner's cumulative prose ledger (what works locally, what does not, and
// why), returned in every response bundle and echoed back on every later
// request of the same Main Request so each wave starts from the consolidated
// conclusions of every earlier wave rather than from the last failure alone.
type AttemptLedger struct {
	Protocol      string         `json:"protocol"`
	RootRequestID string         `json:"root_request_id"`
	Rounds        []AttemptRound `json:"rounds,omitempty"`
	// Narrative is planner-authored and replaced wholesale each round: the
	// contract asks for the complete refined ledger, never a delta, so a
	// dropped or garbled round cannot corrupt the accumulated conclusions.
	Narrative string `json:"narrative,omitempty"`
	// NarrativeRequestID records which round authored the current narrative,
	// so a degraded round that returned none is visible rather than silently
	// presenting stale prose as current.
	NarrativeRequestID string    `json:"narrative_request_id,omitempty"`
	UpdatedAt          time.Time `json:"updated_at,omitempty"`
}
