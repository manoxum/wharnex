package planner

import (
	"context"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
)

type Request struct {
	SessionID          string
	RequestID          string
	Message            string
	ContextTextPath    string
	ContextManifest    domain.ContextManifest
	PreviousResponseID string
	AutomationMode     domain.AutomationMode
	EffortLevel        domain.EffortLevel
	SelfEvolution      bool
	PlanningMode       string
	// ExpectedBundleFilename is the canonical whx_bundle_res_* name the
	// manual/ZIP transport prompt tells the planner to return. It is
	// precomputed by the caller (internal/bundlename) because building it
	// requires the session's chat id and request lineage, neither of which
	// this package knows about. Falls back to RequestID-based defaults when
	// empty (e.g. an API-transport request, which never names a file).
	ExpectedBundleFilename string
	// ExecutionEnvironment is the pre-rendered LOCAL EXECUTION ENVIRONMENT
	// section (internal/sandboxenv). It carries the measured host resources,
	// the Protected container's real limits, the runner image's actual tool
	// inventory, and the closed policy/protocol budgets a plan must satisfy.
	// Kept as rendered text so this package stays free of sandbox/policy
	// dependencies; empty when the environment could not be measured, in
	// which case the prompt simply omits the section.
	ExecutionEnvironment string
	// RepositoryTopology is the pre-rendered LOCAL REPOSITORY TOPOLOGY section
	// (internal/repomanifest): which repositories this project is actually made
	// of, and which of them a patch can be delivered into. Empty for an
	// ordinary single-repository project, which is every project that has no
	// submodules — the section exists to describe a layout the planner would
	// otherwise have to guess at, not to restate the common case.
	//
	// Kept as rendered text for the same reason ExecutionEnvironment is.
	RepositoryTopology string
	// KnowledgeEntries are the v2 request snapshot. Manual/Desktop transport
	// serializes every entry as its own knowledge/<id>.md file; the prompt only
	// carries catalog identity and usage rules so knowledge is a real artifact,
	// not a decorative Markdown blob duplicated into the user message.
	KnowledgeEntries            []domain.ProjectKnowledgeEntry
	KnowledgeRevision           int64
	KnowledgeSharingEnabled     bool
	KnowledgeSource             string // legacy knowledge_review compatibility
	KnowledgeVersion            int    // legacy knowledge_review compatibility
	KnowledgeSHA256             string
	KnowledgeUpdatedByRequestID string
	// ParentRequestID links a continuation to the request it derives from.
	// Empty for a Main Request. The app layer uses it to resolve the Main
	// Request root, which is what both the attempt ledger and the divergence
	// report are anchored to.
	ParentRequestID string
	// AttemptLedger is the pre-rendered SESSION ATTEMPT LEDGER section
	// (harness.attempts/v1): Wharnex's measured history of every round already
	// spent on this Main Request plus the planner's own cumulative account of
	// what does and does not work locally. Empty on a Main Request's first
	// round, which has nothing to carry forward yet.
	//
	// Kept as rendered text for the same reason ExecutionEnvironment is: this
	// package must not depend on session or execution types.
	AttemptLedger string
	// ContextDelta is the pre-rendered LOCAL PROJECT DIVERGENCE section
	// (harness.context-delta/v1): exactly how the local project moved since the
	// full snapshot this conversation already holds. Empty when there is no
	// earlier snapshot to diverge from.
	ContextDelta string
	// AttemptRound and AttemptBound describe where this request sits in the
	// Main Request's automated budget, so the response contract can ask for a
	// terminal consolidation on the round that is expected to be the last.
	AttemptRound int
	AttemptBound int
}

type Result struct {
	Plan               *domain.ExecutionPlan
	OrchestratorPlan   *orchestrator.Proposal
	Turn               *domain.AgentTurn
	ManualPrompt       string
	ProviderResponseID string
}

type Planner interface {
	Plan(ctx context.Context, request Request) (Result, error)
}
