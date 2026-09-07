package planner

import (
	"context"

	"kernl.local/harness/backend/internal/domain"
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
	// KnowledgeSource is the project's current incremental knowledge
	// document (see domain.ProjectKnowledge), included in every request
	// sent to the planner for this project — the first request of a chat,
	// every repair/workflow-continuation/conflict-resolution round, and the
	// closing knowledge_review round — so operational lessons learned from
	// a prior failure are always in front of the model, not only at the
	// start of whichever chat happened to be open when they were recorded.
	// Empty when the project has no recorded knowledge yet.
	KnowledgeSource string
}

type Result struct {
	Plan               *domain.ExecutionPlan
	Turn               *domain.AgentTurn
	ManualPrompt       string
	ProviderResponseID string
}

type Planner interface {
	Plan(ctx context.Context, request Request) (Result, error)
}
