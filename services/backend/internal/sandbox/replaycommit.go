package sandbox

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
)

// ErrThreeWayReplayUnavailable means a three-way replay could not even be
// attempted (the Git build lacks merge-tree from an explicit base). The caller
// keeps its previous plain-diff replay instead of failing the round.
var ErrThreeWayReplayUnavailable = errors.New("three-way replay of a pending candidate is unavailable on this Git build")

// emptyTreeSHA is Git's well-known empty tree, the base of a root commit.
const emptyTreeSHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

// ThreeWayReplayPatch reproduces a pending candidate's own verified change
// inside a verification workspace that shares no Git history with the host,
// and returns it as a patch that applies to the workspace's current tree by
// construction.
//
// Replaying the commit's raw diff made the replay only as good as the
// workspace's resemblance to the tree that diff was cut from. Any later edit
// to the same lines — the operator's own uncommitted work, another integrated
// candidate — failed `git apply`, and that failure was a generic error: no
// capsule, only an automatic repair round asking a planner to fix a replay
// that runs before its own plan and that no patch of its can reach.
//
// Here the candidate's commit is fetched into the workspace, and its change is
// merged three-way from its own request base (or its parent) onto a commit of
// the workspace's current tree. merge-tree needs trees, not shared history, so
// unrelated histories are no obstacle. Compatible edits merge with no model
// turn; a real collision is a *MergeConflictError whose refs all resolve
// inside workspacePath, which the caller routes to a harness.conflict/v1
// capsule. Wharnex-managed paths keep the workspace's version.
func ThreeWayReplayPatch(ctx context.Context, workspacePath, hostPath, branch, commit string) (string, error) {
	branch = strings.TrimSpace(branch)
	commit = strings.TrimSpace(commit)
	if branch == "" || commit == "" {
		return "", errors.New("an integration branch and commit are required")
	}
	if output, err := runGit(ctx, workspacePath, "fetch", "-q", "--no-tags", "--", hostPath, "+"+commit+":refs/heads/"+branch); err != nil {
		return "", fmt.Errorf("fetch pending candidate %s from host: %s", commit, output)
	}
	ours, err := CaptureWorkingTreeCommit(ctx, workspacePath, "Wharnex replay target")
	if err != nil {
		return "", fmt.Errorf("record workspace tree before replay: %w", err)
	}
	topology, err := hostrepo.Inspect(ctx, workspacePath)
	if err != nil {
		return "", err
	}
	merge := treeMerge{hostPath: workspacePath, topology: topology, branch: branch, ours: ours, base: replayBase(ctx, workspacePath, commit)}
	tree, err := merge.mergedTree(ctx, commit)
	if errors.Is(err, errMergeTreeUnsupported) {
		return "", ErrThreeWayReplayUnavailable
	}
	if err != nil {
		return "", err
	}
	patch, err := runGitRaw(ctx, workspacePath, "diff", "--binary", "--no-color", "--no-ext-diff", ours, tree)
	if err != nil {
		return "", fmt.Errorf("read replayed candidate as patch: %w", err)
	}
	return patch, nil
}

// replayBase is the tree the candidate's change is measured from: its request
// base when it has one, otherwise its own first parent, otherwise (a root
// commit) the empty tree. Never Git's computed merge-base: in an unrelated
// workspace there is none.
func replayBase(ctx context.Context, workspacePath, commit string) string {
	if base := CandidateMergeBase(ctx, workspacePath, commit); base != "" {
		return base
	}
	if parent, err := ResolveRef(ctx, workspacePath, commit+"^1"); err == nil {
		return parent
	}
	return emptyTreeSHA
}

// runGitRaw returns a command's stdout byte-exact. A patch must keep its
// trailing newline, which runGit's trimming would strip.
func runGitRaw(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return "", errors.New(strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", err
	}
	return string(output), nil
}
