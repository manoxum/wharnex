package sandbox

import (
	"context"

	"kernl.local/harness/backend/internal/domain"
)

type Workspace struct {
	Path       string
	SourcePath string
}

type Runner interface {
	Prepare(ctx context.Context, projectRoot string) (Workspace, error)
	ApplyPatch(ctx context.Context, workspace Workspace, patch string) (domain.CommandResult, error)
	Run(ctx context.Context, workspace Workspace, command domain.CommandSpec) (domain.CommandResult, error)
	Cleanup(workspace Workspace) error
}
