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
