// Package hostrepo measures the real shape of a host project's Git
// repository instead of assuming one.
//
// Every host-facing Git operation Wharnex performs (the pre-merge snapshot,
// the request-base capture, the integration merge, the post-failure revert)
// was originally written against one implicit repository shape: a normal
// checkout whose `.git` is a directory, containing no submodules and no
// embedded repositories, with no operation in progress and no commit hooks.
// Real projects violate every one of those assumptions, and each violation
// produced a different late, opaque failure at Apply time.
//
// This package turns those assumptions into measurements a caller can act on
// before it mutates anything.
package hostrepo

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// InProgressOperation names a Git operation the operator has started and not
// yet finished. A repository in one of these states has an index that does
// not describe a committable tree, so Wharnex must never stage and commit it.
type InProgressOperation string

const (
	OperationNone       InProgressOperation = ""
	OperationMerge      InProgressOperation = "merge"
	OperationRebase     InProgressOperation = "rebase"
	OperationCherryPick InProgressOperation = "cherry-pick"
	OperationRevert     InProgressOperation = "revert"
	OperationApply      InProgressOperation = "am"
	OperationBisect     InProgressOperation = "bisect"
)

// Submodule is one gitlink recorded in the host's index.
//
// Registered reports whether .gitmodules still describes it; a gitlink whose
// .gitmodules entry was removed is still a gitlink as far as merge and status
// are concerned, which is exactly the sort of asymmetry that made the previous
// code fail unpredictably.
type Submodule struct {
	Path        string
	CommitSHA   string
	Registered  bool
	Initialized bool
}

// Topology is the static shape of a repository: where its Git directory
// actually lives, what kind of worktree it is, and what it contains that
// ordinary path-based reasoning gets wrong.
type Topology struct {
	// Root is the absolute worktree root the caller asked about.
	Root string
	// GitDir is where this worktree's own Git metadata lives. It is NOT
	// always <Root>/.git: a linked worktree (git worktree add) and a project
	// root that is itself a submodule both use a `.git` FILE pointing
	// elsewhere. Anything writing into the Git directory must use this.
	GitDir string
	// CommonDir is the shared object/ref store. It differs from GitDir only
	// for a linked worktree.
	CommonDir string
	// LinkedWorktree reports whether Root is a secondary worktree of another
	// repository rather than its primary checkout.
	LinkedWorktree bool
	// HeadBorn is false for a repository with no commit yet, whose HEAD
	// resolves to nothing.
	HeadBorn bool
	// Detached reports a HEAD that is not on a branch.
	Detached bool
	// Branch is the checked-out branch name, empty when detached or unborn.
	Branch string
	// InProgress names an unfinished merge/rebase/cherry-pick/revert/am/bisect.
	InProgress InProgressOperation
	// Submodules lists every gitlink in the index, ordered by path.
	Submodules []Submodule
}

// SubmoduleFor returns the submodule containing a repository-relative path,
// which is what makes "this patch writes inside a submodule" answerable before
// a `git add` fails on it.
func (t Topology) SubmoduleFor(rel string) (Submodule, bool) {
	rel = strings.TrimPrefix(filepath.ToSlash(strings.TrimSpace(rel)), "./")
	for _, submodule := range t.Submodules {
		if rel == submodule.Path || strings.HasPrefix(rel, submodule.Path+"/") {
			return submodule, true
		}
	}
	return Submodule{}, false
}

// SubmodulePaths lists the submodule paths, for messages and events.
func (t Topology) SubmodulePaths() []string {
	paths := make([]string, 0, len(t.Submodules))
	for _, submodule := range t.Submodules {
		paths = append(paths, submodule.Path)
	}
	return paths
}

// ErrGitUnavailable reports a host with no usable git executable.
var ErrGitUnavailable = errors.New("git executable not found")

func run(ctx context.Context, dir string, args ...string) (string, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return "", ErrGitUnavailable
	}
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(output)), err
}

// Inspect measures a repository's topology. It performs no mutation of any
// kind: every command it runs is a read.
func Inspect(ctx context.Context, root string) (Topology, error) {
	abs, err := filepath.Abs(strings.TrimSpace(root))
	if err != nil {
		return Topology{}, fmt.Errorf("resolve project root: %w", err)
	}
	topology := Topology{Root: abs}
	gitDir, err := run(ctx, abs, "rev-parse", "--absolute-git-dir")
	if err != nil {
		return Topology{}, fmt.Errorf("resolve git directory: %s", gitDir)
	}
	topology.GitDir = gitDir
	commonDir, err := run(ctx, abs, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil || commonDir == "" {
		// --path-format landed in Git 2.31; fall back to the plain form, which
		// may be relative to the worktree root.
		commonDir, _ = run(ctx, abs, "rev-parse", "--git-common-dir")
		if commonDir != "" && !filepath.IsAbs(commonDir) {
			commonDir = filepath.Join(abs, commonDir)
		}
	}
	if commonDir == "" {
		commonDir = gitDir
	}
	topology.CommonDir = filepath.Clean(commonDir)
	topology.LinkedWorktree = filepath.Clean(topology.GitDir) != topology.CommonDir

	if head, headErr := run(ctx, abs, "rev-parse", "--verify", "-q", "HEAD"); headErr == nil && head != "" {
		topology.HeadBorn = true
	}
	if branch, branchErr := run(ctx, abs, "symbolic-ref", "--quiet", "--short", "HEAD"); branchErr == nil {
		topology.Branch = branch
	} else if topology.HeadBorn {
		topology.Detached = true
	}
	topology.InProgress = detectInProgress(topology.GitDir)
	submodules, err := inspectSubmodules(ctx, abs)
	if err != nil {
		return Topology{}, err
	}
	topology.Submodules = submodules
	return topology, nil
}

// detectInProgress reads the marker files Git itself uses to remember an
// unfinished operation. This is deliberately filesystem inspection of the
// resolved Git directory rather than parsing porcelain output: the markers are
// the authority Git's own "you have not concluded your merge" check uses.
func detectInProgress(gitDir string) InProgressOperation {
	exists := func(name string) bool {
		_, err := os.Stat(filepath.Join(gitDir, name))
		return err == nil
	}
	switch {
	case exists("rebase-merge"), exists("rebase-apply"):
		return OperationRebase
	case exists("CHERRY_PICK_HEAD"):
		return OperationCherryPick
	case exists("REVERT_HEAD"):
		return OperationRevert
	case exists("MERGE_HEAD"):
		return OperationMerge
	case exists("BISECT_LOG"):
		return OperationBisect
	}
	return OperationNone
}

// inspectSubmodules lists gitlinks from the index rather than from
// .gitmodules. The index is what merge, status and `git add` actually act on:
// a gitlink whose .gitmodules entry was deleted still shadows its directory,
// and a .gitmodules entry with no gitlink does not.
func inspectSubmodules(ctx context.Context, root string) ([]Submodule, error) {
	output, err := run(ctx, root, "ls-files", "--stage", "-z")
	if err != nil {
		return nil, fmt.Errorf("list index entries: %s", output)
	}
	registered := registeredSubmodulePaths(ctx, root)
	submodules := make([]Submodule, 0)
	for _, entry := range strings.Split(output, "\x00") {
		if !strings.HasPrefix(entry, "160000 ") {
			continue
		}
		// Format: "<mode> <sha> <stage>\t<path>"
		meta, path, found := strings.Cut(entry, "\t")
		if !found {
			continue
		}
		fields := strings.Fields(meta)
		if len(fields) < 2 {
			continue
		}
		path = filepath.ToSlash(path)
		submodules = append(submodules, Submodule{
			Path:        path,
			CommitSHA:   fields[1],
			Registered:  registered[path],
			Initialized: submoduleInitialized(root, path),
		})
	}
	return submodules, nil
}

func registeredSubmodulePaths(ctx context.Context, root string) map[string]bool {
	paths := map[string]bool{}
	output, err := run(ctx, root, "config", "-f", ".gitmodules", "--get-regexp", `^submodule\..*\.path$`)
	if err != nil {
		return paths
	}
	for _, line := range strings.Split(output, "\n") {
		if _, value, found := strings.Cut(strings.TrimSpace(line), " "); found {
			paths[filepath.ToSlash(strings.TrimSpace(value))] = true
		}
	}
	return paths
}

// submoduleInitialized reports whether the submodule has a working checkout.
// An uninitialized submodule is an empty directory: its content is absent, so
// nothing can be verified or patched there, and a gitlink change is safe to
// leave alone.
func submoduleInitialized(root, path string) bool {
	_, err := os.Lstat(filepath.Join(root, filepath.FromSlash(path), ".git"))
	return err == nil
}
