package sandbox

import (
	"context"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/sandbox/nodecontext"
)

func prepareNodeDependenciesContext(ctx context.Context, workspace Workspace, command domain.CommandSpec) error {
	return nodecontext.Prepare(ctx, nodecontext.Paths{Path: workspace.Path, SourcePath: workspace.SourcePath}, command, safeWorkspaceCwd, copyDependencyTreeContext)
}

func requiresLocalNodeDependencies(argv []string) bool { return nodecontext.RequiresDependencies(argv) }
