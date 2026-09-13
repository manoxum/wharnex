package domain

import (
	"encoding/json"
	"time"
)

const ProtocolV1 = "harness.execution/v1"
const TurnProtocolV1 = "harness.turn/v1"

type TurnKind string

const (
	TurnKindAnswer        TurnKind = "answer"
	TurnKindClarification TurnKind = "clarification"
	TurnKindInvestigation TurnKind = "investigation"
	TurnKindPlan          TurnKind = "plan"
	TurnKindWorkflow      TurnKind = "workflow"
	TurnKindChange        TurnKind = "change"
	TurnKindBlocked       TurnKind = "blocked"
)

func ValidTurnKind(kind TurnKind) bool {
	switch kind {
	case TurnKindAnswer, TurnKindClarification, TurnKindInvestigation, TurnKindPlan, TurnKindWorkflow, TurnKindChange, TurnKindBlocked:
		return true
	default:
		return false
	}
}

type AgentTurn struct {
	Protocol            string       `json:"protocol"`
	RequestID           string       `json:"request_id"`
	Kind                TurnKind     `json:"kind"`
	ChatTitle           string       `json:"chat_title,omitempty"`
	Message             string       `json:"message"`
	Outcome             *TurnOutcome `json:"outcome"`
	ResolvedEvidenceIDs []string     `json:"resolved_evidence_ids,omitempty"`
}

// TurnOutcome describes whether the planner completed its response. It never
// claims host execution, which remains an authoritative Wharnex result.
type TurnOutcome struct {
	Status     string `json:"status"`
	ReasonCode string `json:"reason_code,omitempty"`
	Message    string `json:"message,omitempty"`
	Retryable  bool   `json:"retryable"`
}

const (
	TurnOutcomeCompleted = "completed"
	TurnOutcomeFailed    = "failed"
	TurnOutcomePartial   = "partial"
)

// FailureKind is Wharnex's own closed-set classification of a terminal
// session failure. It is always derived by Wharnex itself — from a sandbox
// error via errors.Is, or from a planner turn outcome's reason code — and
// never copied verbatim from planner-supplied text. Consumers (including the
// frontend) MUST key recovery affordances on this field, never on error
// message substrings: message text is free-form prose that can be rephrased
// or translated, but this field is a value Wharnex itself commits to.
const (
	// FailureKindOfflineGoModuleCache marks a failure caused by the host Go
	// module cache being unable to satisfy the project's build list while
	// GOPROXY=off. It is recoverable via a human-approved, narrowly scoped
	// network grant (see RetryDependencyNetwork).
	FailureKindOfflineGoModuleCache = "offline_go_module_cache"

	// FailureKindHostBuildToolchain marks a self-evolution host build that
	// failed because the host's own toolchain (e.g. the Node.js runtime
	// running `make build-stage`) cannot satisfy a pinned dependency's
	// engine requirement (e.g. Electron requiring a newer Node than the
	// host has installed). Unlike FailureKindOfflineGoModuleCache, there is
	// no Wharnex-grantable recovery: no source patch can change the host's
	// installed runtime, so this must never consume a ChatGPT repair round.
	FailureKindHostBuildToolchain = "host_build_toolchain_mismatch"

	// FailureKindHostDependencyState marks a host-only dependency installation
	// defect discovered after the same candidate already verified in Protected
	// execution (for example, a missing platform-specific npm optional/native
	// binding under node_modules). Replanning source cannot repair host package
	// installation state, so this must stop automatic GPT repair/retry loops.
	FailureKindHostDependencyState = "host_dependency_state"

	// FailureKindSelfEvolutionBusy marks a local coordination block: another
	// self-evolution transaction currently owns the activation lock. The
	// verified candidate is retained and can be applied after that transaction
	// clears; asking the model for another source patch cannot resolve it.
	FailureKindSelfEvolutionBusy = "self_evolution_transaction_busy"

	// FailureKindSelfEvolutionMetadata marks a retained self-evolution batch
	// whose transaction.json identity disagrees with the runtime status that
	// references its directory. This is local recovery state, not a source
	// defect, so a new planner repair round cannot resolve it.
	FailureKindSelfEvolutionMetadata = "self_evolution_transaction_metadata_mismatch"

	// FailureKindStaleHostBaseline marks a retained legacy candidate that could
	// not be safely replayed/reverified on the current host baseline. Wharnex
	// must preserve the candidate for explicit retry/review rather than spend a
	// ChatGPT repair round on baseline metadata.
	FailureKindStaleHostBaseline = "stale_host_baseline"

	// FailureKindHostIntegrationRace marks repeated compare-and-swap races while
	// committing an already verified ChangeSet. This is host concurrency, not a
	// model/source defect; the candidate remains safe to retry.
	FailureKindHostIntegrationRace = "host_integration_race"

	// FailureKindExecutionCanceled marks a sandbox/host command interrupted by
	// cancellation of the owning request context. It is a transport/lifecycle
	// interruption, not evidence that the model-generated source is defective.
	FailureKindExecutionCanceled = "execution_context_canceled"

	// FailureKindRemoteInputTransport marks a terminal failure to obtain or
	// validate the remote ChatGPT result. The project source did not fail, so
	// recovery is a fresh transport request rather than a source repair turn.
	FailureKindRemoteInputTransport = "remote_input_transport"

	// FailureKindSubmoduleWrite marks a response bundle that attempted to write
	// files owned by a registered Git submodule while the open Wharnex project
	// is the superproject. The source change may be valid, but it belongs to a
	// different repository, so retrying or repairing the same request against
	// the superproject cannot succeed.
	FailureKindSubmoduleWrite = "submodule_write"

	// FailureKindSandboxResourceExhausted marks a Protected command that
	// failed because the machine ran out of disk, memory or file descriptors
	// mid-run — observed as a linker reporting "no space left on device"
	// during a race-enabled test build. The generated source is not implicated
	// and rewriting it cannot help, so this must never spend a repair round;
	// recovery is freeing host resources (or narrowing the verification set)
	// and retrying the retained candidate.
	FailureKindSandboxResourceExhausted = "sandbox_resource_exhausted"

	// FailureKindArtifactStorageFull marks a response bundle that validated
	// but could not be archived because the local object store rejected the
	// write for lack of space. Archival is bookkeeping, never a reason to
	// discard a verified result, so this classification exists to make the
	// operator-facing remedy explicit rather than to fail the request.
	FailureKindArtifactStorageFull = "artifact_storage_full"

	// FailureKindHostWorkingStateBlocked marks a verified candidate Wharnex
	// deliberately refused to integrate because the host working tree is in a
	// state where committing on top of it would damage the operator's own
	// uncommitted work: an unfinished merge/rebase, unresolved conflict paths,
	// or a change that moves the recorded commit of a submodule holding
	// uncommitted content.
	//
	// It is emphatically not a source defect, so it never consumes a repair
	// round. The candidate is retained and Apply succeeds unchanged once the
	// operator clears the condition the failure names.
	FailureKindHostWorkingStateBlocked = "host_working_state_blocked"
)

type ExecutionMode string

const (
	ExecutionModeProtected   ExecutionMode = "protected"
	ExecutionModeUnprotected ExecutionMode = "unprotected"
)

func ValidExecutionMode(mode ExecutionMode) bool {
	return mode == ExecutionModeProtected || mode == ExecutionModeUnprotected
}

type AutomationMode string

const (
	AutomationModeManual AutomationMode = "manual"
	AutomationModeAuto   AutomationMode = "auto"
)

func ValidAutomationMode(mode AutomationMode) bool {
	return mode == AutomationModeManual || mode == AutomationModeAuto
}

type EffortLevel string

const (
	EffortLevelLow       EffortLevel = "low"
	EffortLevelMedium    EffortLevel = "medium"
	EffortLevelHigh      EffortLevel = "high"
	EffortLevelExtraHigh EffortLevel = "extra_high"
	EffortLevelMax       EffortLevel = "max"
	EffortLevelUltra     EffortLevel = "ultra"
	EffortLevelLoop      EffortLevel = "loop"
)

func ValidEffortLevel(level EffortLevel) bool {
	switch level {
	case EffortLevelLow, EffortLevelMedium, EffortLevelHigh, EffortLevelExtraHigh, EffortLevelMax, EffortLevelUltra, EffortLevelLoop:
		return true
	default:
		return false
	}
}

// ChatTransportMode controls whether Wharnex Desktop drives the embedded
// ChatGPT conversation's DOM directly (Scraper — composer fill, submit, and
// download interception, as it always has) or never touches that DOM at all
// (Manual — the prompt is only ever shown to the human to copy/paste, and a
// completed response bundle is only ever imported by the human uploading
// it). Independent of AutomationMode: Auto+Manual is a valid, meaningful
// combination — Wharnex still decides execute/apply automatically, only
// the conversation transport itself is human-driven.
type ChatTransportMode string

const (
	ChatTransportModeScraper ChatTransportMode = "scraper"
	ChatTransportModeManual  ChatTransportMode = "manual"
)

func ValidChatTransportMode(mode ChatTransportMode) bool {
	return mode == ChatTransportModeScraper || mode == ChatTransportModeManual
}

type TerminalTarget string

const (
	TerminalTargetSandbox TerminalTarget = "sandbox"
	TerminalTargetHost    TerminalTarget = "host"
)

func ValidTerminalTarget(target TerminalTarget) bool {
	return target == TerminalTargetSandbox || target == TerminalTargetHost
}

type CommandSpec struct {
	Argv              []string `json:"argv"`
	Cwd               string   `json:"cwd"`
	TimeoutSeconds    int      `json:"timeout_seconds"`
	Network           bool     `json:"network"`
	ExpectedExitCodes []int    `json:"expected_exit_codes"`
}

type Operation struct {
	Type    string      `json:"type"`
	Patch   string      `json:"patch"`
	Command CommandSpec `json:"command"`
}

type VersionIncrement struct {
	Component string `json:"component"`
	Amount    int    `json:"amount"`
}

const (
	VersionComponentMajor  = "major"
	VersionComponentMedium = "medium"
	VersionComponentMinor  = "minor"
	VersionComponentPatch  = "patch"
)

func ValidVersionComponent(component string) bool {
	switch component {
	case VersionComponentMajor, VersionComponentMedium, VersionComponentMinor, VersionComponentPatch:
		return true
	default:
		return false
	}
}

type ExecutionPlan struct {
	Protocol          string            `json:"protocol"`
	BaseContextSHA256 string            `json:"base_context_sha256,omitempty"`
	ImpactFiles       []string          `json:"impact_files,omitempty"`
	ReadFiles         []string          `json:"read_files,omitempty"`
	BarrierFiles      []string          `json:"barrier_files,omitempty"`
	PlanID            string            `json:"plan_id"`
	RequestID         string            `json:"request_id"`
	Status            string            `json:"status"`
	Summary           string            `json:"summary"`
	VersionIncrement  *VersionIncrement `json:"version_increment,omitempty"`
	// CommitMessage is the planner-authored Git commit message for a
	// `change` plan's patch, used verbatim (after sanitization) as the
	// commit Wharnex makes on the sandbox's own integration branch before
	// merging it into the host — see internal/sandbox/gitintegration.go.
	// Empty for `workflow` plans, which never reach the host.
	CommitMessage    string        `json:"commit_message,omitempty"`
	Risk             string        `json:"risk"`
	RequiresApproval bool          `json:"requires_approval"`
	Operations       []Operation   `json:"operations"`
	Verification     []CommandSpec `json:"verification"`
}

type PolicyDecision struct {
	Allowed          bool     `json:"allowed"`
	RequiresApproval bool     `json:"requires_approval"`
	Risk             string   `json:"risk"`
	Reasons          []string `json:"reasons"`
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
	Version            int       `json:"version"`
	UpdatedAt          time.Time `json:"updated_at"`
	UpdatedByRequestID string    `json:"updated_by_request_id,omitempty"`
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

type ExecutionResult struct {
	PlanID      string          `json:"plan_id"`
	Success     bool            `json:"success"`
	StartedAt   time.Time       `json:"started_at"`
	CompletedAt time.Time       `json:"completed_at"`
	Commands    []CommandResult `json:"commands"`
	Error       string          `json:"error,omitempty"`
	Warnings    []string        `json:"warnings,omitempty"`
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
	// IntegrationUnits records every repository unit this candidate was
	// committed into, deepest first (see adr/ADR-0050). A project with no
	// submodules produces exactly one entry for the superproject, which is
	// redundant with IntegrationBranch/IntegrationCommit and kept only so the
	// apply path has one shape to consume. Empty on a candidate persisted
	// before this field existed; the apply path then falls back to the
	// superproject-only branch above.
	IntegrationUnits []IntegrationUnit `json:"integration_units,omitempty"`
}

// IntegrationUnit is one repository unit's verified commit for a candidate.
//
// Path is the project-relative unit root and is empty for the superproject, so
// that a single-repository project's record reads exactly as it always did.
type IntegrationUnit struct {
	Path   string `json:"path"`
	Branch string `json:"branch"`
	Commit string `json:"commit,omitempty"`
	// PointerUpdates lists the child units whose gitlink this unit's commit
	// records. It is what makes a pointer-only superproject commit legible in
	// an audit trail instead of looking like an empty change.
	PointerUpdates []string `json:"pointer_updates,omitempty"`
}

type IntegrationOutcome string

const (
	IntegrationPlanning      IntegrationOutcome = "planning"
	IntegrationVerified      IntegrationOutcome = "verified"
	IntegrationMerging       IntegrationOutcome = "merging"
	IntegrationChecking      IntegrationOutcome = "checking"
	IntegrationReady         IntegrationOutcome = "ready"
	IntegrationIntegrated    IntegrationOutcome = "integrated"
	IntegrationConflict      IntegrationOutcome = "conflict"
	IntegrationSemanticCheck IntegrationOutcome = "semantic_recheck"
	IntegrationRetryableRace IntegrationOutcome = "retryable_race"
)

// FileMutation is the canonical result of applying a model delta to its exact
// immutable base. Contents are bounded by the validated patch limit and remain
// durable so a verified candidate can be merged after a backend restart.
type FileMutation struct {
	Path          string `json:"path"`
	BaseSHA256    string `json:"base_sha256,omitempty"`
	ResultSHA256  string `json:"result_sha256,omitempty"`
	BaseExists    bool   `json:"base_exists"`
	ResultExists  bool   `json:"result_exists"`
	BaseContent   string `json:"base_content,omitempty"`
	ResultContent string `json:"result_content,omitempty"`
	BaseMode      uint32 `json:"base_mode,omitempty"`
	ResultMode    uint32 `json:"result_mode,omitempty"`
}

type ChangeSet struct {
	ID            string             `json:"id"`
	BaseRevision  string             `json:"base_revision"`
	Mutations     []FileMutation     `json:"mutations"`
	ReadFiles     []string           `json:"read_files,omitempty"`
	BarrierFiles  []string           `json:"barrier_files,omitempty"`
	ReadHashes    map[string]string  `json:"read_hashes,omitempty"`
	BarrierHashes map[string]string  `json:"barrier_hashes,omitempty"`
	State         IntegrationOutcome `json:"state"`
	CreatedAt     time.Time          `json:"created_at"`
}

type IntegrationConflictDetail struct {
	ChangeSetID string `json:"change_set_id"`
	Path        string `json:"path"`
	Reason      string `json:"reason"`
}

type ConflictResolution struct {
	ID              string                      `json:"id"`
	RequestID       string                      `json:"request_id"`
	OriginalPlanIDs []string                    `json:"original_plan_ids"`
	Paths           []string                    `json:"paths"`
	Details         []IntegrationConflictDetail `json:"details"`
	// AttemptHistory records what each earlier round of this same conflict
	// tried, oldest first. It travels back to the resolver so a repeated
	// collision is visibly a repeated collision: without it every round looks
	// like the first one and the same losing reconciliation can be proposed
	// indefinitely, which is the failure mode a bounded attempt count alone
	// only truncates rather than informs.
	AttemptHistory []string  `json:"attempt_history,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	// Git is set when this conflict came from a human-initiated Git operation
	// on the host — a push that had to integrate the remote's work first, or
	// an explicit branch merge — rather than from integrating a verified
	// Wharnex candidate. The two resolve to different places: a candidate's
	// resolution becomes a new verified change, while this one is replayed
	// into the same Git merge and committed as its merge commit.
	Git *GitConflictContext `json:"git,omitempty"`
	// ManualPaths are operator-resolved conflict paths. They are authoritative:
	// a delegated GPT plan may resolve only the remaining paths. ManualPatch is
	// generated against CURRENT and is injected by the backend before execution.
	ManualPaths []string `json:"manual_paths,omitempty"`
	ManualPatch string   `json:"manual_patch,omitempty"`
}

// GitConflictOrigin names what produced a conflict, so a resolver is told
// which reconciliation it is being asked for rather than having to infer it.
const (
	GitConflictOriginIntegration = "integration"
	GitConflictOriginPush        = "push"
	GitConflictOriginBranchMerge = "branch_merge"
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
	ID       string          `json:"id"`
	ZipPath  string          `json:"-"`
	TextPath string          `json:"-"`
	Manifest ContextManifest `json:"manifest"`
}

type Session struct {
	ID                      string               `json:"id"`
	ChatID                  string               `json:"chat_id,omitempty"`
	ProjectPath             string               `json:"project_path"`
	ExecutionMode           ExecutionMode        `json:"execution_mode"`
	AutomationMode          AutomationMode       `json:"automation_mode"`
	EffortLevel             EffortLevel          `json:"effort_level"`
	ChatTransportMode       ChatTransportMode    `json:"chat_transport_mode"`
	SelfEvolution           bool                 `json:"self_evolution,omitempty"`
	WharnexInstanceID       string               `json:"wharnex_instance_id,omitempty"`
	SelfEvolutionActivation string               `json:"self_evolution_activation,omitempty"`
	ResolvedEvidenceIDs     map[string]time.Time `json:"resolved_evidence_ids,omitempty"`
	EvidenceReviewIDs       []string             `json:"evidence_review_ids,omitempty"`
	State                   string               `json:"state"`
	CreatedAt               time.Time            `json:"created_at"`
	Context                 ContextBundle        `json:"context"`
	Plan                    *ExecutionPlan       `json:"plan,omitempty"`
	Policy                  *PolicyDecision      `json:"policy,omitempty"`
	LastExecution           *ExecutionResult     `json:"last_execution,omitempty"`
	PendingHostChanges      []PendingHostChange  `json:"pending_host_changes,omitempty"`
	LastAppliedChanges      []PendingHostChange  `json:"last_applied_changes,omitempty"`
	LastRevertedChanges     []PendingHostChange  `json:"last_reverted_changes,omitempty"`
	LastHostCommands        []CommandResult      `json:"last_host_commands,omitempty"`
	LastHostAppliedAt       time.Time            `json:"last_host_applied_at,omitempty"`
	LastVersionBefore       string               `json:"last_version_before,omitempty"`
	LastVersionAfter        string               `json:"last_version_after,omitempty"`
	LastProviderResponseID  string               `json:"last_provider_response_id,omitempty"`
	LastRequestID           string               `json:"last_request_id,omitempty"`
	PendingManualRequestIDs []string             `json:"pending_manual_request_ids,omitempty"`
	LastManualPrompt        string               `json:"last_manual_prompt,omitempty"`
	// PendingKnowledgeReviewRequestID marks an in-flight post-apply
	// knowledge_review round. Deliberately independent of State: the apply
	// that triggered this round already succeeded and State already
	// reflects that (applied/restart_pending/...); this field must never be
	// folded into State, or the session would need to "restore" its real
	// state once the review round resolves, which is unnecessary risk for
	// what is a best-effort side round.
	PendingKnowledgeReviewRequestID string `json:"pending_knowledge_review_request_id,omitempty"`
	// KnowledgeSharingEnabled is per-chat. nil is treated as true so sessions
	// persisted before v2 start in the safe/default sharing-on state.
	KnowledgeSharingEnabled            *bool                      `json:"knowledge_sharing_enabled,omitempty"`
	KnowledgeLastSeenRevision          int64                      `json:"knowledge_last_seen_revision,omitempty"`
	PendingKnowledgeRootRequestID      string                     `json:"-"`
	PendingKnowledgeCandidateRequestID string                     `json:"-"`
	PendingKnowledgeCandidate          *ProjectKnowledgeCandidate `json:"-"`
	PendingKnowledgeSummary            string                     `json:"-"`
	// AttemptLedger is the session-scoped attempt state of the Main Request
	// currently in flight (harness.attempts/v1). It is reset when a new Main
	// Request starts and discarded at that request's terminal boundary: its
	// durable residue belongs in the knowledge catalog, which the planner
	// consolidates from this ledger before the terminal response.
	AttemptLedger *AttemptLedger `json:"attempt_ledger,omitempty"`
	// RequestContextDeltas records, per request id, the divergence report that
	// request was sent. Server-only: every transport must materialize the same
	// report the prompt described, and a report is meaningless once its
	// request is gone.
	RequestContextDeltas   map[string]ContextDelta `json:"-"`
	LastMainRequestSummary string                  `json:"last_main_request_summary,omitempty"`
	LastBundle             *ExecutionBundleInfo    `json:"last_bundle,omitempty"`
	LastTurn               *AgentTurn              `json:"last_turn,omitempty"`
	RepairAttempt          int                     `json:"repair_attempt,omitempty"`
	AutomationAttempt      int                     `json:"automation_attempt,omitempty"`
	ImprovementAttempt     int                     `json:"improvement_attempt,omitempty"`
	RepairParentPlanID     string                  `json:"repair_parent_plan_id,omitempty"`
	// ConflictAttempt counts automatic rounds requesting resolution of the
	// SAME IntegrationConflict.ID (a real Git merge conflict or a ChangeSet
	// replay conflict). Distinct from RepairAttempt, which already measures
	// ordinary patch-repair rounds and is reset when a conflict starts —
	// reusing it here would let a plan that already spent repair rounds
	// arrive at a conflict with fewer automatic attempts left than another
	// plan, for no reason related to the conflict itself. Reset to 0
	// whenever a conflict with a new ID begins.
	ConflictAttempt  int               `json:"conflict_attempt,omitempty"`
	LastRepairError  string            `json:"last_repair_error,omitempty"`
	FailureKind      string            `json:"failure_kind,omitempty"`
	WorkflowRound    int               `json:"workflow_round,omitempty"`
	LastRequestMode  string            `json:"last_request_mode,omitempty"`
	PlannerInFlight  bool              `json:"planner_in_flight,omitempty"`
	RequestBaselines map[string]string `json:"request_baselines,omitempty"`
	// RequestBaseCommits records, per request id, the host commit whose tree is
	// exactly what that request's planner context was snapshotted from —
	// anchored in the host repository under refs/wharnex/base/<request_id>.
	// A plan's patch is authored against this tree, so rooting its integration
	// branch here makes the patch apply by construction no matter how far the
	// host has advanced since, and turns real divergence into an ordinary
	// three-way merge instead of a dead-end apply failure.
	RequestBaseCommits map[string]string `json:"request_base_commits,omitempty"`
	// RequestBaseUnitCommits records the same anchor for every OTHER repository
	// unit the project is made of, keyed request id then project-relative unit
	// path (see adr/ADR-0050). A submodule's content lives in another
	// repository, so no single commit can describe the tree a planner was shown
	// for a project that has one; each unit anchors its own. The superproject's
	// anchor stays in RequestBaseCommits above, unchanged, so every
	// pre-submodule read path and every already-persisted session keep working.
	RequestBaseUnitCommits map[string]map[string]string        `json:"request_base_unit_commits,omitempty"`
	RequestContextArchives map[string]string                   `json:"-"`
	RequestKnowledge       map[string]RequestKnowledgeSnapshot `json:"-"`
	BaselineFileSnapshots  map[string]map[string]string        `json:"baseline_file_snapshots,omitempty"`
	BaselineNotices        []BaselineNotice                    `json:"baseline_notices,omitempty"`
	ProjectRevisions       []ProjectRevision                   `json:"project_revisions,omitempty"`
	IntegrationConflict    *ConflictResolution                 `json:"integration_conflict,omitempty"`
	Artifacts              []ArtifactRecord                    `json:"artifacts,omitempty"`
	InterruptedExecution   *InterruptedExecution               `json:"interrupted_execution,omitempty"`
	RemoteRecoveryAttempt  int                                 `json:"remote_recovery_attempt,omitempty"`
	RequestLineages        map[string]RequestLineage           `json:"request_lineages,omitempty"`
	// ArchivedAt/CompactedAt/ArchivePackage implement the passive chat-archive
	// lifecycle (see ADR-0031). Pointers, not bare time.Time: encoding/json's
	// omitempty is a no-op on a zero struct value, and callers need a clean
	// null to mean "not archived".
	ArchivedAt     *time.Time            `json:"archived_at,omitempty"`
	CompactedAt    *time.Time            `json:"compacted_at,omitempty"`
	ArchivePackage *ArchivePackageRecord `json:"archive_package,omitempty"`
}

// InterruptedExecution is a durable execution intent. Its presence means the
// process disappeared or its caller disconnected before a terminal result was
// persisted, so only an explicit user decision may resume or discard it.
const (
	InterruptedExecutionAwaitingDecision = "awaiting_decision"
	InterruptedExecutionRunning          = "running"
	InterruptedExecutionResuming         = "resuming"
	InterruptedExecutionFailedRetryable  = "failed_retryable"
)

type InterruptedExecution struct {
	PlanID      string    `json:"plan_id"`
	RequestedAt time.Time `json:"requested_at"`
	Approved    bool      `json:"approved"`
	Status      string    `json:"status,omitempty"`
	LastError   string    `json:"last_error,omitempty"`
}

type ArtifactRecord struct {
	ID          string    `json:"id"`
	RequestID   string    `json:"request_id,omitempty"`
	Direction   string    `json:"direction"`
	Kind        string    `json:"kind"`
	Name        string    `json:"name"`
	ContentType string    `json:"content_type,omitempty"`
	Size        int64     `json:"size"`
	SHA256      string    `json:"sha256"`
	ObjectKey   string    `json:"-"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	Bundle      bool      `json:"bundle"`
	EntryCount  int       `json:"entry_count,omitempty"`
}

// ArchivePackageRecord describes the single compacted object a session's
// artifacts/events/context archives were folded into (ADR-0031). ObjectKey
// is server-only, exactly like ArtifactRecord.ObjectKey.
type ArchivePackageRecord struct {
	ObjectKey  string    `json:"-"`
	SHA256     string    `json:"sha256"`
	Size       int64     `json:"size"`
	EntryCount int       `json:"entry_count"`
	CreatedAt  time.Time `json:"created_at"`
}

type ArtifactEntry struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
	Dir  bool   `json:"dir"`
}

type Event struct {
	ID        string         `json:"id"`
	SessionID string         `json:"session_id"`
	Type      string         `json:"type"`
	Timestamp time.Time      `json:"timestamp"`
	Data      map[string]any `json:"data"`
}
