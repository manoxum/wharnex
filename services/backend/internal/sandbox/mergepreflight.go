package sandbox

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
)

// MergePreflight is the result of asking Git — not a heuristic — whether two
// commits can be merged, without touching any working tree, index or ref.
type MergePreflight struct {
	// Clean is true when the merge would succeed with no conflict.
	Clean bool
	// ConflictPaths lists exactly the paths Git could not auto-merge. Only
	// meaningful when Clean is false and Supported is true.
	ConflictPaths []string
	// Supported is false when this Git build cannot answer the question
	// (git merge-tree --write-tree landed in Git 2.38). Callers MUST treat
	// an unsupported preflight as "unknown", never as "clean" or "conflict":
	// the real merge remains the decision point either way.
	Supported bool
	// Tree is the merged tree Git wrote. For a conflicting merge it holds the
	// conflicted paths with markers, so it is only a finished result when
	// Clean is true or every conflict is subsequently decided locally.
	Tree string
}

// PreflightMerge reports whether merging other into base would conflict.
//
// This is deliberately Git's own merge machinery rather than a line-range or
// impact-file overlap test. Those approximations are wrong in both directions:
// two patches editing the same line range merge cleanly when the edit is
// identical, and two patches editing entirely disjoint line ranges still
// conflict across a rename, a delete/edit pair, or enough context drift.
// merge-tree answers the actual question, offline, in milliseconds, with no
// model turn and no host mutation.
//
// It is an advisory scheduling and reporting signal only. The host is a
// moving target between this check and the real merge, so the atomic merge
// stays authoritative; this exists to avoid entering work that is already
// known to collide, and to name the colliding paths early.
func PreflightMerge(ctx context.Context, repoPath, base, other string) (MergePreflight, error) {
	return PreflightMergeFrom(ctx, repoPath, "", base, other)
}

// PreflightMergeFrom is PreflightMerge with the merge-base named explicitly
// instead of computed from the commit graph. An empty mergeBase keeps Git's
// own choice. See CandidateMergeBase for why a Wharnex candidate needs this:
// the common ancestor Git computes predates the operator work the candidate
// was authored on top of.
func PreflightMergeFrom(ctx context.Context, repoPath, mergeBase, ours, theirs string) (MergePreflight, error) {
	ours = strings.TrimSpace(ours)
	theirs = strings.TrimSpace(theirs)
	if ours == "" || theirs == "" {
		return MergePreflight{}, errors.New("both commits are required")
	}
	if _, err := exec.LookPath("git"); err != nil {
		return MergePreflight{}, errors.New("git executable not found")
	}
	args := []string{"-C", repoPath, "merge-tree", "--write-tree", "--name-only"}
	if mergeBase = strings.TrimSpace(mergeBase); mergeBase != "" {
		args = append(args, "--merge-base="+mergeBase)
	}
	cmd := exec.CommandContext(ctx, "git", append(args, ours, theirs)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.Output()
	if err == nil {
		return MergePreflight{Clean: true, Supported: true, Tree: mergeTreeOID(string(output))}, nil
	}
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		return MergePreflight{}, err
	}
	// git merge-tree exits 1 for "merged with conflicts" and >1 for a real
	// failure, which includes a Git too old to know --write-tree (2.38) or
	// --merge-base (2.40) at all.
	if exitErr.ExitCode() != 1 {
		return MergePreflight{Supported: false}, nil
	}
	return MergePreflight{Clean: false, ConflictPaths: parseMergeTreeConflicts(string(output)), Supported: true, Tree: mergeTreeOID(string(output))}, nil
}

func mergeTreeOID(output string) string {
	first, _, _ := strings.Cut(output, "\n")
	return strings.TrimSpace(first)
}

// parseMergeTreeConflicts reads the conflicted-file section of a conflicting
// `git merge-tree --write-tree --name-only` run: the first line is the written
// tree OID, followed by one path per line, terminated by a blank line before
// the human-readable conflict messages.
func parseMergeTreeConflicts(output string) []string {
	lines := strings.Split(output, "\n")
	paths := make([]string, 0, len(lines))
	for index, line := range lines {
		if index == 0 {
			continue
		}
		line = strings.TrimSpace(line)
		if line == "" {
			break
		}
		paths = append(paths, line)
	}
	return paths
}
