package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// A request rooted at its own immutable base executes a temporary extraction of
// that base, not the project directory. The private Go module cache must stay
// bound to the project anyway.
//
// Production evidence (chat e6829d45, 2026-09-13T00:00:11Z): the project's own
// cache held 144 MB of hydrated modules while execution ran from an extracted
// base under /tmp. The cache key was derived from that temporary path, so the
// populated cache was unreachable, the run failed with "offline sandbox
// dependencies unavailable", and the retry 24 seconds later failed identically.
// Eight cache directories existed on that machine; only one matched a real
// project root, the other seven being ~144 MB each keyed by a temporary
// directory that would never be seen again.
func TestDependencyCacheFollowsTheProjectNotTheExecutedTree(t *testing.T) {
	cacheDir := t.TempDir()
	runner := NewDockerRunnerWithDependencyCache("runner:test", cacheDir)
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "go.mod"), []byte("module example.local/p\n\ngo 1.23\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	direct, err := runner.Prepare(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Cleanup(direct)

	// The same project, executed from an extracted immutable request base.
	extracted := t.TempDir()
	if err := os.WriteFile(filepath.Join(extracted, "go.mod"), []byte("module example.local/p\n\ngo 1.23\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	rooted, err := runner.PrepareFromProject(context.Background(), extracted, project)
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Cleanup(rooted)

	if rooted.GoModuleCachePath != direct.GoModuleCachePath {
		t.Fatalf("an immutable-base execution must share the project's dependency cache:\n  direct   = %s\n  rooted   = %s", direct.GoModuleCachePath, rooted.GoModuleCachePath)
	}
	if rooted.SourcePath == direct.SourcePath {
		t.Fatal("the fixture must actually execute a different tree, or it proves nothing")
	}
	if rooted.ProjectPath != direct.ProjectPath {
		t.Fatalf("canonical project = %q, want %q", rooted.ProjectPath, direct.ProjectPath)
	}
}

// Two genuinely different projects must still keep separate caches: sharing the
// key would hand one project's build list another project's modules.
func TestDependencyCacheSeparatesDistinctProjects(t *testing.T) {
	cacheDir := t.TempDir()
	runner := NewDockerRunnerWithDependencyCache("runner:test", cacheDir)
	first, err := runner.Prepare(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Cleanup(first)
	second, err := runner.Prepare(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Cleanup(second)
	if first.GoModuleCachePath == second.GoModuleCachePath {
		t.Fatal("distinct projects must not share one dependency cache")
	}
}

// PrepareExecutionWorkspace is the seam the application layer uses; a runner
// without the optional capability must still prepare the executed tree.
func TestPrepareExecutionWorkspaceFallsBackForAPlainRunner(t *testing.T) {
	project := t.TempDir()
	workspace, err := PrepareExecutionWorkspace(context.Background(), &LocalRunner{}, project, project)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = (&LocalRunner{}).Cleanup(workspace) }()
	if workspace.ProjectPath == "" {
		t.Fatal("a prepared workspace must record its canonical project")
	}
}
