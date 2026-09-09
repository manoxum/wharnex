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
