package manual

import (
	"context"

	"kernl.local/harness/backend/internal/planner"
)

type Planner struct{}

func New() *Planner { return &Planner{} }

func (p *Planner) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	return planner.Result{ManualPrompt: planner.BuildManualPrompt(request)}, nil
}
