package domain

import (
	"encoding/json"
	"sort"
	"strings"
	"time"
)

const ProtocolV1 = "harness.execution/v1"
const ProtocolV2 = "harness.execution/v2"
const TurnProtocolV1 = "harness.turn/v1"
const DebugProtocolV1 = "harness.debug/v1"

// InteractiveProtocolV1 is the public successor to the legacy debug label.
// DebugProtocolV1 remains readable for durable/in-flight compatibility.
const InteractiveProtocolV1 = "harness.interactive/v1"
const InterviewProtocolV1 = "harness.interview/v1"

const DebugQueryProjectExecutionSummary = "project_execution_summary"

const (
	DebugAccessObserve = "observe"
	DebugAccessModify  = "modify"
)

const (
	ToolLifetimeTemporary  = "temporary"
	ToolLifetimePersistent = "persistent"
)

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
	Interview           *Interview   `json:"interview,omitempty"`
}

// Interview is a structured clarification. It is data for a human decision,
// never executable instruction. A reply returns through the ordinary composer
// so the user retains control over what is submitted to the provider.
type Interview struct {
	Protocol  string              `json:"protocol"`
	Questions []InterviewQuestion `json:"questions"`
}

type InterviewQuestion struct {
	ID            string            `json:"id"`
	Prompt        string            `json:"prompt"`
	AllowMultiple bool              `json:"allow_multiple,omitempty"`
	Options       []InterviewOption `json:"options"`
}

type InterviewOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
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
// error via errors.Is, or from a planner turn's structured outcome — and
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

	// FailureKindHostBuildDependencyNetwork marks a host build that failed
	// while fetching dependencies over the network — a DNS answer that never
	// came, a refused or reset connection, a registry timeout. The candidate
	// is not implicated: the same build succeeds unchanged once the network
	// answers, so a planner round spent rewriting source is spent on the one
	// thing that cannot be the cause. Retrying the Apply is the recovery.
	FailureKindHostBuildDependencyNetwork = "host_build_dependency_network"

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

	// FailureKindSandboxPreparationTimeout marks a Protected command whose
	// command budget expired while Wharnex was preparing the isolated runner
	// (for example while copying project-local node_modules). The source patch
	// has not executed yet, so replanning source cannot resolve this failure.
	FailureKindSandboxPreparationTimeout = "sandbox_preparation_timeout"

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

	// FailureKindPlannerGuidanceRequired marks a planner outcome that explicitly
	// declared retryable=false without mapping to a dedicated local recovery.
	// Repeating the same request would loop, but an operator may provide new
	// evidence or guidance and deliberately start a materially different round.
	FailureKindPlannerGuidanceRequired = "planner_guidance_required"
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

// ReasoningEffort controls the provider's per-turn reasoning depth. It is
// deliberately independent from EffortLevel, which bounds how many autonomous
// attempts Wharnex may spend across the whole Main Request.
type ReasoningEffort string

const (
	ReasoningEffortInstant ReasoningEffort = "instant"
	ReasoningEffortMedium  ReasoningEffort = "medium"
	ReasoningEffortHigh    ReasoningEffort = "high"
)

func ValidReasoningEffort(effort ReasoningEffort) bool {
	switch effort {
	case ReasoningEffortInstant, ReasoningEffortMedium, ReasoningEffortHigh:
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
	Protocol          string   `json:"protocol"`
	BaseContextSHA256 string   `json:"base_context_sha256,omitempty"`
	ImpactFiles       []string `json:"impact_files,omitempty"`
	ReadFiles         []string `json:"read_files,omitempty"`
	BarrierFiles      []string `json:"barrier_files,omitempty"`
	PlanID            string   `json:"plan_id"`
	RequestID         string   `json:"request_id"`
	Status            string   `json:"status"`
	Summary           string   `json:"summary"`
	// Document is the human-facing execution contract. Unlike Summary (one
	// sentence), it explains the approach, risks and verification before the
	// operator consents.
	Document         string            `json:"document,omitempty"`
	Dependencies     []PlanDependency  `json:"dependencies,omitempty"`
	SystemTools      []PlanSystemTool  `json:"system_tools,omitempty"`
	ApprovedChatPlan *ApprovedChatPlan `json:"approved_chat_plan,omitempty"`
	Debug            *DebugSpec        `json:"debug,omitempty"`
	VersionIncrement *VersionIncrement `json:"version_increment,omitempty"`
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
	// CrossProject carries work for projects other than the one this request
	// belongs to, one self-contained unit per project.
	//
	// It is a list of units rather than a `project` tag on each operation
	// because a change to another project is a whole change to that project:
	// it needs its own commit message, because it becomes that project's Git
	// history, and its own verification, because it is verified in that
	// project's sandbox against that project's tree. Tagging operations would
	// have left both of those with nowhere to live.
	//
	// A unit is admissible only when the request's own prompt granted that
	// project by name (see internal/crossproject and adr/ADR-0053). The primary
	// plan above is unchanged and unaware of this field.
	CrossProject []CrossProjectUnit `json:"cross_project,omitempty"`
}

// DebugSpec turns a workflow plan into a bounded diagnostic probe. Observe is
// the backwards-compatible default. Modify is host-only, approval-gated, and
// still constrained by argv validation plus the Policy Engine.
type DebugSpec struct {
	Protocol string `json:"protocol"`
	Target   string `json:"target"`
	Access   string `json:"access,omitempty"`
	// Query selects an engine-owned, read-only diagnostic. Unlike a command it
	// never crosses the process boundary and cannot acquire shell/filesystem
	// authority from model-controlled argv. Queries are observe-only.
	Query     string `json:"query,omitempty"`
	Rationale string `json:"rationale"`
}

func (d DebugSpec) EffectiveAccess() string {
	if d.Access == "" {
		return DebugAccessObserve
	}
	return d.Access
}

// PlanDependency describes project dependency impact. It is presentation
// metadata only: package-manager authority still comes from Operations and
// the Policy Engine.
type PlanDependency struct {
	Scope   string `json:"scope"`
	Manager string `json:"manager"`
	Name    string `json:"name"`
	Version string `json:"version,omitempty"`
	Action  string `json:"action"`
	Reason  string `json:"reason"`
}

// PlanSystemTool discloses an OS/runtime prerequisite. Lifetime is required
// when a host-debug modify plan installs/updates/configures a tool so the
// operator can distinguish disposable tooling from durable host state.
type PlanSystemTool struct {
	Target   string `json:"target"`
	Name     string `json:"name"`
	Action   string `json:"action"`
	Lifetime string `json:"lifetime,omitempty"`
	Reason   string `json:"reason"`
}

// ApprovedChatPlan binds an executable response to the exact planning-only
// proposal the operator approved earlier in the same Main Request.
type ApprovedChatPlan struct {
	Protocol  string `json:"protocol"`
	RequestID string `json:"request_id"`
	SHA256    string `json:"sha256"`
	Document  string `json:"document"`
}

// CrossProjectUnit is a complete change for one granted referenced project.
//
// It is deliberately shaped like the executable half of a plan: the same
// operations, the same verification commands, and the same mandatory commit
// message a change owes the history it will become. It is executed as a derived
// request on that project — its own Protected sandbox, its own verification,
// its own Git-native host integration — because that is the only authority that
// may write to a project, and it does not change when the patch arrived through
// another project's chat.
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
	// SubmoduleIntegrations are verified commits created in repositories nested
	// below the open superproject. Apply merges IntegrationBranch, then advances
	// each nested repository on the branch captured during verification.
	SubmoduleIntegrations []RepositoryIntegration `json:"submodule_integrations,omitempty"`
}

// UnmarshalJSON keeps verified candidates written by the first
// submodule-native engine recoverable. That engine persisted integration_units
// (including one root record); the repository-tree engine stores only the
// nested records as submodule_integrations. Silently dropping the old field
// makes the preflight forget which gitlinks it owns and recreates an
// unresolvable managed-state conflict after restart.
func (p *PendingHostChange) UnmarshalJSON(data []byte) error {
	type plain PendingHostChange
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*p = PendingHostChange(decoded)
	if len(p.SubmoduleIntegrations) > 0 {
		return nil
	}
	var legacy struct {
		IntegrationUnits []struct {
			Path         string `json:"path"`
			Branch       string `json:"branch"`
			Commit       string `json:"commit"`
			TargetBranch string `json:"target_branch,omitempty"`
			BaseCommit   string `json:"base_commit,omitempty"`
		} `json:"integration_units"`
	}
	if err := json.Unmarshal(data, &legacy); err != nil {
		return err
	}
	for _, unit := range legacy.IntegrationUnits {
		path := strings.TrimSpace(unit.Path)
		if path == "" || path == "." {
			if p.IntegrationBranch == "" {
				p.IntegrationBranch = unit.Branch
			}
			if p.IntegrationCommit == "" {
				p.IntegrationCommit = unit.Commit
			}
			continue
		}
		p.SubmoduleIntegrations = append(p.SubmoduleIntegrations, RepositoryIntegration{
			Path: path, Branch: unit.Branch, Commit: unit.Commit,
			TargetBranch: unit.TargetBranch, BaseCommit: unit.BaseCommit,
		})
	}
	sort.SliceStable(p.SubmoduleIntegrations, func(i, j int) bool {
		return strings.Count(p.SubmoduleIntegrations[i].Path, "/") < strings.Count(p.SubmoduleIntegrations[j].Path, "/")
	})
	return nil
}

// RepositoryIntegration identifies one nested repository candidate. Branch is
// Wharnex's temporary ref; TargetBranch and BaseCommit preserve the operator's
// original checkout across Apply and rollback.
type RepositoryIntegration struct {
	Path         string `json:"path"`
	Branch       string `json:"branch"`
	Commit       string `json:"commit"`
	TargetBranch string `json:"target_branch,omitempty"`
	BaseCommit   string `json:"base_commit,omitempty"`
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

// ConflictComplexity says what kind of work an unresolved conflict still
// needs, so escalation is chosen on evidence rather than on the mere fact that
// the merge did not come out clean.
//
// The distinction matters because the three classes have different correct
// destinations: a structural collision has no textual reconciliation at all, a
// semantic one needs the intent behind each side and is exactly what a planner
// round buys, and a mechanical one must never leave the machine.
type ConflictComplexity string

const (
	// ConflictComplexityMechanical is a collision the local ladder reconciled,
	// or could reconcile on a retry. It never escalates.
	ConflictComplexityMechanical ConflictComplexity = "mechanical"
	// ConflictComplexitySemantic is a bounded textual collision where both
	// sides rewrote the same region. A planner that sees both intents can
	// resolve it.
	ConflictComplexitySemantic ConflictComplexity = "semantic"
	// ConflictComplexityStructural is create/delete, binary content or file
	// mode: there is no text to reconcile and a patch cannot express the
	// answer.
	ConflictComplexityStructural ConflictComplexity = "structural"
)

type IntegrationConflictDetail struct {
	ChangeSetID string `json:"change_set_id"`
	Path        string `json:"path"`
	Reason      string `json:"reason"`
	// Complexity and the counters below are the integrator's own assessment of
	// what it tried. They travel with the conflict so the escalation decision,
	// the conflict capsule and the operator all read the same evidence.
	Complexity    ConflictComplexity `json:"complexity,omitempty"`
	Hunks         int                `json:"hunks,omitempty"`
	ResolvedHunks int                `json:"resolved_hunks,omitempty"`
	ConflictLines int                `json:"conflict_lines,omitempty"`
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
	GitConflictOriginPull        = "pull"
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

type Session struct {
	ID                  string   `json:"id"`
	ChatID              string   `json:"chat_id,omitempty"`
	ProjectPath         string   `json:"project_path"`
	RelatedProjectPaths []string `json:"related_project_paths,omitempty"`
	// CrossProjectGrant is the authority the current Main Request carries to
	// change projects other than this one, derived from its own `@ref:`
	// directives. It is replaced when a new Main Request is submitted and
	// inherited unchanged by that request's continuations.
	CrossProjectGrant *CrossProjectGrant `json:"cross_project_grant,omitempty"`
	// CrossProjectRanPlanID is the last plan whose cross-project units were
	// dispatched, so an Apply path reached twice for one candidate cannot
	// install the same change in another project twice.
	CrossProjectRanPlanID   string               `json:"cross_project_ran_plan_id,omitempty"`
	ExecutionMode           ExecutionMode        `json:"execution_mode"`
	AutomationMode          AutomationMode       `json:"automation_mode"`
	DebugEnabled            bool                 `json:"debug_enabled,omitempty"`
	DebugApprovedRootID     string               `json:"debug_approved_root_request_id,omitempty"`
	DebugApprovedPlanID     string               `json:"debug_approved_plan_id,omitempty"`
	ApprovedChatPlan        *ApprovedChatPlan    `json:"approved_chat_plan,omitempty"`
	ExecutionApprovedRootID string               `json:"execution_approved_root_request_id,omitempty"`
	ApprovedBoundaryKeys    []string             `json:"approved_execution_boundary_keys,omitempty"`
	EffortLevel             EffortLevel          `json:"effort_level"`
	ReasoningEffort         ReasoningEffort      `json:"reasoning_effort"`
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
	RequestBaseCommits     map[string]string `json:"request_base_commits,omitempty"`
	RequestContextArchives map[string]string `json:"-"`
	// RequestSupportArtifacts are bounded, engine-authored files that must
	// accompany one derived request but must never be expanded into its prompt.
	// Keeping them server-only prevents large conflict capsules from crossing
	// the Desktop's 1 MiB prompt boundary while the normal request ZIP remains
	// the single authoritative transport.
	RequestSupportArtifacts map[string][]RequestSupportArtifact `json:"-"`
	RequestKnowledge        map[string]RequestKnowledgeSnapshot `json:"-"`
	BaselineFileSnapshots   map[string]map[string]string        `json:"baseline_file_snapshots,omitempty"`
	BaselineNotices         []BaselineNotice                    `json:"baseline_notices,omitempty"`
	ProjectRevisions        []ProjectRevision                   `json:"project_revisions,omitempty"`
	IntegrationConflict     *ConflictResolution                 `json:"integration_conflict,omitempty"`
	Artifacts               []ArtifactRecord                    `json:"artifacts,omitempty"`
	InterruptedExecution    *InterruptedExecution               `json:"interrupted_execution,omitempty"`
	RemoteRecoveryAttempt   int                                 `json:"remote_recovery_attempt,omitempty"`
	RequestLineages         map[string]RequestLineage           `json:"request_lineages,omitempty"`
	// ArchivedAt/CompactedAt/ArchivePackage implement the passive chat-archive
	// lifecycle (see ADR-0031). Pointers, not bare time.Time: encoding/json's
	// omitempty is a no-op on a zero struct value, and callers need a clean
	// null to mean "not archived".
	ArchivedAt     *time.Time            `json:"archived_at,omitempty"`
	CompactedAt    *time.Time            `json:"compacted_at,omitempty"`
	ArchivePackage *ArchivePackageRecord `json:"archive_package,omitempty"`
}

type RequestSupportArtifact struct {
	Path    string `json:"path"`
	Content []byte `json:"content"`
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
	BundleType  string    `json:"bundle_type,omitempty"`
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
