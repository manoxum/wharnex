package sandbox

import (
	"context"
	"errors"

	"kernl.local/harness/backend/internal/domain"
)

var ErrOfflineDependenciesUnavailable = errors.New("offline sandbox dependencies unavailable")

type Workspace struct {
	Path       string
	SourcePath string
	// ProjectPath is the canonical project this workspace belongs to. It equals
	// SourcePath for an ordinary execution and differs when the tree came from
	// an extracted immutable request base, which is exactly when project-scoped
	// resources must NOT follow the executed tree.
	ProjectPath       string
	GoModuleCachePath string
}

type Runner interface {
	Prepare(ctx context.Context, projectRoot string) (Workspace, error)
	ApplyPatch(ctx context.Context, workspace Workspace, patch string) (domain.CommandResult, error)
	Run(ctx context.Context, workspace Workspace, command domain.CommandSpec) (domain.CommandResult, error)
	Cleanup(workspace Workspace) error
}

// StreamingRunner is an optional Runner capability used by the application layer
// to forward stdout/stderr chunks to SSE subscribers while a command is running.
type StreamingRunner interface {
	RunStreaming(ctx context.Context, workspace Workspace, command domain.CommandSpec, onOutput StreamCallback) (domain.CommandResult, error)
}

// TerminalOptions describes a human-owned interactive terminal. Unlike model
// execution, its input is an opaque PTY byte stream rather than command argv.
type TerminalOptions struct {
	ID      string
	Cwd     string
	Network bool
	Cols    uint16
	Rows    uint16
}

type InteractiveTerminal interface {
	Write(data []byte) error
	Resize(cols, rows uint16) error
	Close() error
}

// InteractiveTerminalRunner is deliberately separate from Runner: planners
// can receive only Runner, while the HTTP/application terminal path may opt in
// to the human-only PTY capability.
type InteractiveTerminalRunner interface {
	StartInteractive(workspace Workspace, options TerminalOptions, onOutput func([]byte), onExit func(int, error)) (InteractiveTerminal, error)
}

// ReversePatchRunner is an optional host capability used by explicit regression
// rollback. It must validate the reverse patch before mutating the workspace.
type ReversePatchRunner interface {
	ReversePatch(ctx context.Context, workspace Workspace, patch string) (domain.CommandResult, error)
}

// ProjectScopedRunner prepares a workspace whose tree comes from somewhere other
// than the project directory — an extracted immutable request base — while every
// project-scoped resource stays keyed by the canonical project.
//
// This exists because the two are NOT interchangeable and were conflated in
// production. Prepare derives the private Go module cache key from the tree it
// is handed; rooting a request at its immutable base hands it a fresh temporary
// directory, so the key changed on every such execution. The project's real
// cache — already populated, sitting on disk — became unreachable, offline
// verification failed with "host Go module cache is unavailable", and each
// human-approved rehydration wrote ~144 MB under a key that would never be read
// again. Measured on this instance: 8 cache directories, only one of which
// matched a real project root.
type ProjectScopedRunner interface {
	PrepareFromProject(ctx context.Context, executionRoot, projectPath string) (Workspace, error)
}

// PrepareExecutionWorkspace prepares executionRoot while keeping project-scoped
// resources bound to projectPath. It is the call site every execution should
// use: passing the two paths separately is what keeps an immutable-base
// execution sharing the project's own dependency cache.
func PrepareExecutionWorkspace(ctx context.Context, runner Runner, executionRoot, projectPath string) (Workspace, error) {
	if scoped, ok := runner.(ProjectScopedRunner); ok {
		return scoped.PrepareFromProject(ctx, executionRoot, projectPath)
	}
	return runner.Prepare(ctx, executionRoot)
}
