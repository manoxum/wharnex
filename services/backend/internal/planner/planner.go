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
