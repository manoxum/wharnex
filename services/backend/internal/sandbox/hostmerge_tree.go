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

// errMergeTreeUnsupported means this Git build cannot compute a merge from an
// explicit base (merge-tree --write-tree needs 2.38, --merge-base 2.40). The
// caller falls back to a working-tree merge rather than failing the Apply.
var errMergeTreeUnsupported = errors.New("git merge-tree cannot merge from an explicit base on this Git build")

// treeMerge integrates one candidate branch into a repository without letting
// Git touch the working tree until the result is final.
//
// The merged tree is computed offline by merge-tree from the candidate's own
// request base, conflicts Wharnex may decide are settled in a private index,
// and only then is a two-parent merge commit written and the checkout
// fast-forwarded onto it. A conflict therefore never leaves markers, a
// half-merged index or MERGE_HEAD behind in the operator's checkout: there is
// nothing to abort, because nothing was started.
type treeMerge struct {
	hostPath string
	topology hostrepo.Topology
	identity hostrepo.CommitIdentity
	branch   string
	ours     string
	base     string
	gitlinks map[string]string
}

func (m treeMerge) integrate(ctx context.Context) error {
	theirs, err := ResolveRef(ctx, m.hostPath, m.branch)
	if err != nil {
		return err
	}
	tree, err := m.mergedTree(ctx, theirs)
	if err != nil {
		return err
	}
	commitArgs := append(hostrepo.InternalGitArgs(m.topology, m.identity), "commit-tree", tree, "-p", m.ours, "-p", theirs, "-m", m.message(ctx))
	commit, err := runGit(ctx, m.hostPath, commitArgs...)
	if err != nil {
		return fmt.Errorf("record integration merge commit: %s", commit)
	}
	forwardArgs := append(hostrepo.InternalGitArgs(m.topology, m.identity), "merge", "--ff-only", "-q", commit)
	if output, err := runGitWaitingForIndexLock(ctx, m.hostPath, forwardArgs...); err != nil {
		if blocked := hostrepo.HostGitBlocked(ctx, m.hostPath, output); blocked != nil {
			return blocked
		}
		return fmt.Errorf("advance checkout to integration merge: %s", output)
	}
	return nil
}

func (m treeMerge) mergedTree(ctx context.Context, theirs string) (string, error) {
	preflight, err := PreflightMergeFrom(ctx, m.hostPath, m.base, m.ours, theirs)
	if err != nil {
		return "", err
	}
	if !preflight.Supported || preflight.Tree == "" {
		return "", errMergeTreeUnsupported
	}
	if preflight.Clean {
		return preflight.Tree, nil
	}
	local, ordinary := partitionLocallyResolvedMergePaths(preflight.ConflictPaths, m.gitlinks)
	if len(ordinary) > 0 {
		return "", &MergeConflictError{Paths: ordinary, Branch: m.branch, HostSHA: m.ours, MergeBaseSHA: m.mergeBaseSHA(ctx)}
	}
	return m.decideLocally(ctx, preflight.Tree, local)
}

// mergeBaseSHA names the base a conflict capsule's BASE side is read from.
// It is the base the merge actually used, so the resolver sees the version
// both sides really started from.
func (m treeMerge) mergeBaseSHA(ctx context.Context) string {
	if m.base != "" {
		return m.base
	}
	mergeBase, _ := runGit(ctx, m.hostPath, "merge-base", m.ours, m.branch)
	return mergeBase
}

// decideLocally settles the conflicts no planner may author, in a private
// index seeded from the merged tree. Wharnex-managed state keeps the host's
// entry (or its absence); an owned gitlink takes the descendant commit chosen
// before the merge. See resolveLocalMergeConflicts for the same rules applied
// to a working-tree merge.
func (m treeMerge) decideLocally(ctx context.Context, tree string, paths []string) (string, error) {
	gitDir := m.topology.GitDir
	if gitDir == "" {
		gitDir = m.hostPath
	}
	reserved, err := os.CreateTemp(gitDir, "wharnex-merge-index-*")
	if err != nil {
		return "", fmt.Errorf("create temporary merge index: %w", err)
	}
	indexPath := reserved.Name()
	_ = reserved.Close()
	_ = os.Remove(indexPath)
	defer func() { _ = os.Remove(indexPath) }()
	run := func(args ...string) (string, error) {
		cmd := exec.CommandContext(ctx, "git", append([]string{"-C", m.hostPath}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_INDEX_FILE="+indexPath)
		output, runErr := cmd.CombinedOutput()
		return strings.TrimSpace(string(output)), runErr
	}
	if output, err := run("read-tree", tree); err != nil {
		return "", fmt.Errorf("seed temporary merge index: %s", output)
	}
	for _, path := range paths {
		decision, err := m.localDecision(ctx, path)
		if err != nil {
			return "", err
		}
		if output, err := run(decision...); err != nil {
			return "", fmt.Errorf("decide conflict on %s locally: %s", path, output)
		}
	}
	decided, err := run("write-tree")
	if err != nil {
		return "", fmt.Errorf("write locally decided merge tree: %s", decided)
	}
	return decided, nil
}

func (m treeMerge) localDecision(ctx context.Context, path string) ([]string, error) {
	if commit := strings.TrimSpace(m.gitlinks[path]); commit != "" {
		return []string{"update-index", "--add", "--cacheinfo", "160000," + commit + "," + path}, nil
	}
	entry, err := runGit(ctx, m.hostPath, "ls-tree", m.ours, "--", path)
	if err != nil {
		return nil, fmt.Errorf("inspect host version of managed conflict %s: %s", path, entry)
	}
	if strings.TrimSpace(entry) == "" {
		return []string{"update-index", "--force-remove", "--", path}, nil
	}
	meta, _, _ := strings.Cut(entry, "\t")
	fields := strings.Fields(meta)
	if len(fields) != 3 {
		return nil, fmt.Errorf("unexpected tree entry for managed conflict %s: %q", path, entry)
	}
	return []string{"update-index", "--add", "--cacheinfo", fields[0] + "," + fields[2] + "," + path}, nil
}

func (m treeMerge) message(ctx context.Context) string {
	message := "Merge branch '" + m.branch + "'"
	if current, err := runGit(ctx, m.hostPath, "symbolic-ref", "--quiet", "--short", "HEAD"); err == nil && current != "" {
		message += " into " + current
	}
	return message
}
