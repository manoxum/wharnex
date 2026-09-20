package sandbox

import (
	"context"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
)

// BaseContinuationPaths returns the conflicting paths whose collision is not a
// real divergence at all.
//
// A candidate is rooted at its own request base, and that base is captured from
// the host's working tree — including the operator's uncommitted edits. The
// host's own pre-merge snapshot then commits those same edits independently, on
// history the base is not an ancestor of. Git therefore sees one operator change
// recorded twice from a common ancestor that holds neither version, and reports
// a conflict on a path where nothing diverged: the candidate started from
// exactly what the host holds now and moved on from there, so the real sequence
// is linear (ancestor -> host -> candidate).
//
// This is what made a focused conflict resolution unable to converge. Such a
// resolution is authored against the host's current content by construction, so
// its own request base always holds that content — and it therefore collided
// again on the very path it had just resolved, every round, indefinitely, with
// no source change able to prevent it.
//
// The proof required is deliberately exact and per path: the request base and
// the host must hold identical bytes, or the path must be absent from both.
// Anything else remains an ordinary conflict for the normal path to handle,
// because only exact equality establishes that the host's version is an
// ancestor of the candidate's.
func BaseContinuationPaths(ctx context.Context, hostPath, requestBaseRef, hostRef string, paths []string) []string {
	requestBaseRef = strings.TrimSpace(requestBaseRef)
	hostRef = strings.TrimSpace(hostRef)
	if requestBaseRef == "" || hostRef == "" || len(paths) == 0 {
		return nil
	}
	continuations := make([]string, 0, len(paths))
	for _, path := range paths {
		baseContent, baseExists, baseErr := ReadFileAtRef(ctx, hostPath, requestBaseRef, path)
		if baseErr != nil {
			continue
		}
		hostContent, hostExists, hostErr := ReadFileAtRef(ctx, hostPath, hostRef, path)
		if hostErr != nil || baseExists != hostExists {
			continue
		}
		if baseExists && baseContent != hostContent {
			continue
		}
		continuations = append(continuations, path)
	}
	return continuations
}

// withoutPaths returns values with every entry of removed excluded.
func withoutPaths(values, removed []string) []string {
	if len(removed) == 0 {
		return values
	}
	excluded := make(map[string]struct{}, len(removed))
	for _, path := range removed {
		excluded[path] = struct{}{}
	}
	kept := make([]string, 0, len(values))
	for _, path := range values {
		if _, skip := excluded[path]; skip {
			continue
		}
		kept = append(kept, path)
	}
	return kept
}

// stageBaseContinuations takes the candidate's version of each proven
// continuation path, leaving the merge staged but not committed so one commit
// can conclude every kind of local reconciliation this merge performed.
//
// Taking the candidate's side loses nothing here, which is exactly what
// BaseContinuationPaths establishes: the host's current content is what the
// candidate was authored from, so it is already contained in what the candidate
// produced. Preserving the host version instead — the rule for Wharnex-managed
// state — would discard the resolution the operator is waiting for.
func stageBaseContinuations(ctx context.Context, hostPath, branch string, paths []string) error {
	for _, path := range paths {
		listed, listErr := runGit(ctx, hostPath, "ls-tree", "--name-only", branch, "--", path)
		if listErr != nil {
			return fmt.Errorf("inspect candidate version of %s: %s", path, listed)
		}
		if strings.TrimSpace(listed) == "" {
			if output, err := runGit(ctx, hostPath, "rm", "-q", "-f", "--ignore-unmatch", "--", path); err != nil {
				return fmt.Errorf("apply candidate deletion for %s: %s", path, output)
			}
			continue
		}
		if output, err := runGit(ctx, hostPath, "checkout", branch, "--", path); err != nil {
			return fmt.Errorf("take candidate version of %s: %s", path, output)
		}
		if output, err := runGit(ctx, hostPath, "add", "--", path); err != nil {
			return fmt.Errorf("stage candidate version of %s: %s", path, output)
		}
	}
	return nil
}

// reconcileMergeLocally settles every conflict this merge can decide without a
// resolver and concludes it with one commit.
//
// The two kinds are settled in opposite directions on purpose. Wharnex-managed
// state and submodule pointers keep the host's version, because a planner may
// not author them at all. A proven base continuation keeps the candidate's,
// because the host's version is what the candidate was authored from and is
// therefore already contained in it.
func reconcileMergeLocally(ctx context.Context, hostPath string, topology hostrepo.Topology, branch, preMergeSHA string, local, continuations []string, gitlinks map[string]string) error {
	if err := stageBaseContinuations(ctx, hostPath, branch, continuations); err != nil {
		return err
	}
	if len(local) > 0 {
		// resolveLocalMergeConflicts concludes the merge itself, which also
		// records whatever the continuations staged above.
		return resolveLocalMergeConflicts(ctx, hostPath, topology, preMergeSHA, local, gitlinks)
	}
	return commitReconciledMerge(ctx, hostPath, topology)
}

// commitReconciledMerge concludes a merge whose every remaining conflict was
// reconciled locally, under Wharnex's own identity and with project hooks
// disabled like every other commit its plumbing makes.
func commitReconciledMerge(ctx context.Context, hostPath string, topology hostrepo.Topology) error {
	commitArgs := append(hostrepo.InternalGitArgs(topology), "commit", "-q", "--no-edit")
	if output, err := runGit(ctx, hostPath, commitArgs...); err != nil {
		return fmt.Errorf("commit merge after local reconciliation: %s", output)
	}
	return nil
}
