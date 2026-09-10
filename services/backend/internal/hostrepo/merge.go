package hostrepo

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// MergeOutcome is the closed set of results a human-initiated merge can have.
type MergeOutcome string

const (
	MergeOutcomeMerged   MergeOutcome = "merged"
	MergeOutcomeUpToDate MergeOutcome = "up_to_date"
	// MergeOutcomeConflict: Git could not auto-merge. The merge is aborted
	// before returning, so the working tree is left exactly as it was.
	MergeOutcomeConflict MergeOutcome = "conflict"
)

// MergeSides names the three commits a three-way merge reconciles, which is
// everything needed to reconstruct BASE/CURRENT/RESULT content for a conflict
// capsule without keeping a conflicted working tree around.
type MergeSides struct {
	// BaseSHA is the merge base — the last commit both sides agreed on.
	BaseSHA string `json:"base_sha"`
	// OursSHA is the local branch tip the merge started from.
	OursSHA string `json:"ours_sha"`
	// TheirsSHA is the incoming ref's tip.
	TheirsSHA string `json:"theirs_sha"`
	// Ref is the incoming ref as the operator named it.
	Ref string `json:"ref"`
}

// MergeResult reports one merge attempt.
type MergeResult struct {
	Outcome   MergeOutcome `json:"outcome"`
	CommitSHA string       `json:"commit_sha,omitempty"`
	// Paths lists what Git could not auto-merge; empty unless Outcome is
	// MergeOutcomeConflict.
	Paths []string   `json:"paths,omitempty"`
	Sides MergeSides `json:"sides"`
	// Detail carries Git's own message for a failure that is neither a clean
	// merge nor a content conflict (unrelated histories, a missing ref).
	Detail string `json:"detail,omitempty"`
}

// MergeBranch merges a ref into the checked-out branch on behalf of a human.
//
// A conflicting merge is always aborted before returning. Leaving the host in
// a conflicted state would be the more "natural" Git behavior, but it is the
// wrong choice here: Wharnex's own integration path refuses to touch a
// repository with unresolved paths, so a conflicted merge left in place would
// block every Agent request on the project for as long as the operator — or a
// planner round — took to resolve it. Aborting keeps the repository usable and
// loses nothing: MergeSides carries everything needed to reconstruct the
// conflict, and replaying the merge after a resolution reproduces it exactly.
func MergeBranch(ctx context.Context, root, ref string) (MergeResult, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" || strings.HasPrefix(ref, "-") {
		return MergeResult{}, errors.New("a branch to merge is required")
	}
	topology, err := Inspect(ctx, root)
	if err != nil {
		return MergeResult{}, err
	}
	if topology.InProgress != OperationNone {
		return MergeResult{}, &BlockedError{
			Reason: BlockedOperationInProgress,
			Detail: fmt.Sprintf("a %s is in progress", topology.InProgress),
			Remedy: fmt.Sprintf("finish or abort the %s before merging", topology.InProgress),
		}
	}
	state, err := Working(ctx, root)
	if err != nil {
		return MergeResult{}, err
	}
	if len(state.Unmerged) > 0 {
		return MergeResult{}, &BlockedError{
			Reason: BlockedUnmergedPaths,
			Detail: "the index holds unresolved conflicts",
			Paths:  state.Unmerged,
			Remedy: "resolve or reset those paths before merging",
		}
	}
	sides, err := resolveMergeSides(ctx, root, ref)
	if err != nil {
		return MergeResult{}, err
	}
	// A merge refuses outright when uncommitted changes overlap what it would
	// write. That refusal is correct and must reach the operator as itself,
	// not be worked around by committing their files for them: this is their
	// merge, not Wharnex integration plumbing.
	output, mergeErr := run(ctx, root, "merge", "--no-edit", "--", ref)
	if mergeErr == nil {
		if strings.Contains(output, "Already up to date") {
			return MergeResult{Outcome: MergeOutcomeUpToDate, Sides: sides}, nil
		}
		head, _ := run(ctx, root, "rev-parse", "HEAD")
		result := MergeResult{Outcome: MergeOutcomeMerged, CommitSHA: head, Sides: sides}
		return result, nil
	}
	conflicted, conflictErr := run(ctx, root, "diff", "--name-only", "--diff-filter=U")
	_, _ = run(ctx, root, "merge", "--abort")
	if conflictErr == nil && strings.TrimSpace(conflicted) != "" {
		return MergeResult{Outcome: MergeOutcomeConflict, Paths: strings.Fields(conflicted), Sides: sides}, nil
	}
	return MergeResult{}, fmt.Errorf("merge %s: %s", ref, RedactRemoteURL(output))
}

// resolveMergeSides records the three commits before the merge runs, because
// afterwards HEAD has moved and an aborted merge leaves no MERGE_HEAD behind.
func resolveMergeSides(ctx context.Context, root, ref string) (MergeSides, error) {
	ours, err := run(ctx, root, "rev-parse", "--verify", "-q", "HEAD")
	if err != nil {
		return MergeSides{}, errors.New("the current branch has no commit to merge into")
	}
	theirs, err := run(ctx, root, "rev-parse", "--verify", "-q", ref+"^{commit}")
	if err != nil {
		return MergeSides{}, fmt.Errorf("unknown branch: %s", ref)
	}
	base, _ := run(ctx, root, "merge-base", ours, theirs)
	return MergeSides{BaseSHA: base, OursSHA: ours, TheirsSHA: theirs, Ref: ref}, nil
}

// BeginMergeResolution replays a conflicting merge and leaves the working tree
// holding *our* clean version of each conflicting path, with the merge still in
// progress.
//
// Replaying rather than keeping the original conflicted tree alive is what let
// MergeBranch abort: the same two commits merged again produce the same
// conflict, so reconstructing it on demand costs nothing and keeps the
// repository usable in between.
//
// Checking out `--ours` is what makes the resolution a plain patch. A
// conflicted file contains Git's `<<<<<<<` markers, which no patch can be
// authored against; our own clean version, by contrast, is exactly the CURRENT
// content the conflict capsule showed the resolver, so the patch it wrote
// applies to the file byte-for-byte.
func BeginMergeResolution(ctx context.Context, root, ref string, conflictPaths []string) error {
	if strings.TrimSpace(ref) == "" || strings.HasPrefix(ref, "-") {
		return errors.New("a branch to merge is required")
	}
	if len(conflictPaths) == 0 {
		return errors.New("at least one conflicting path is required")
	}
	output, mergeErr := run(ctx, root, "merge", "--no-commit", "--no-ff", "--", ref)
	if mergeErr != nil {
		conflicted, _ := run(ctx, root, "diff", "--name-only", "--diff-filter=U")
		if strings.TrimSpace(conflicted) == "" {
			_, _ = run(ctx, root, "merge", "--abort")
			return fmt.Errorf("replay merge %s: %s", ref, RedactRemoteURL(output))
		}
	}
	for _, path := range conflictPaths {
		if output, err := run(ctx, root, "checkout", "--ours", "--", path); err != nil {
			// A path conflicting as add/add or delete/modify may have no
			// "ours" side. Leaving it staged as-is is correct: the resolution
			// patch decides its final content either way.
			if !strings.Contains(output, "does not have our version") {
				_, _ = run(ctx, root, "merge", "--abort")
				return fmt.Errorf("restore our version of %s: %s", path, output)
			}
		}
	}
	return nil
}

// CompleteMergeResolution stages the resolved paths and concludes the merge.
// It refuses to commit while any path is still unresolved, so a partial
// resolution can never be recorded as a finished merge.
func CompleteMergeResolution(ctx context.Context, root string, conflictPaths []string, message string) (commitSHA string, err error) {
	if strings.TrimSpace(message) == "" {
		return "", errors.New("a commit message is required")
	}
	stage := append([]string{"add", "--"}, conflictPaths...)
	if output, addErr := run(ctx, root, stage...); addErr != nil {
		return "", fmt.Errorf("stage resolved paths: %s", output)
	}
	if remaining, _ := run(ctx, root, "diff", "--name-only", "--diff-filter=U"); strings.TrimSpace(remaining) != "" {
		return "", fmt.Errorf("resolution left unresolved paths: %s", strings.Join(strings.Fields(remaining), ", "))
	}
	if output, commitErr := run(ctx, root, "commit", "-q", "--no-edit", "-m", message); commitErr != nil {
		return "", fmt.Errorf("commit merge resolution: %s", output)
	}
	head, err := run(ctx, root, "rev-parse", "HEAD")
	if err != nil {
		return "", fmt.Errorf("resolve merge commit: %s", head)
	}
	return head, nil
}

// AbortMerge returns the repository to its pre-merge state. It is safe to call
// when no merge is in progress.
func AbortMerge(ctx context.Context, root string) {
	_, _ = run(ctx, root, "merge", "--abort")
}

// FileAtRef returns a path's content at a commit, and whether it exists there.
// A path that is a submodule pointer or any other non-blob reports as absent,
// because there is no text for a resolver to reconcile.
func FileAtRef(ctx context.Context, root, ref, path string) (content string, exists bool) {
	kind, err := run(ctx, root, "cat-file", "-t", ref+":"+path)
	if err != nil || strings.TrimSpace(kind) != "blob" {
		return "", false
	}
	output, err := runRaw(ctx, root, "show", ref+":"+path)
	if err != nil {
		return "", false
	}
	return output, true
}
