package selfevolution

import (
	"context"
	"fmt"
	"os/exec"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/sandbox"
)

// foreignChangedPaths returns the paths the host changed between the
// transaction baseline and current HEAD through commits that are not this
// transaction's own plan integrations.
//
// A batch integrates each plan as a real merge before one host build decides
// the whole batch. When that build failed, the merges of the batch's earlier
// plans were still on HEAD, so a plain baseline..HEAD diff reported the
// transaction's own changes as "unrelated" host history and refused the
// rollback. On 2026-09-29 txn-20260929T093927 parked in rollback_failed that
// way, holding the global batch lock while every later integration waited.
//
// Only a first-parent merge whose merged side carries a Plan-Id trailer naming
// one of this transaction's plans is excluded. Every other commit — an
// operator's, a host snapshot, a version bump, another request's merge —
// still counts, so the safety check keeps protecting work it did not author.
// When the baseline is not on HEAD's first-parent chain the full diff is used.
func (tx Transaction) foreignChangedPaths(ctx context.Context, baseline, current string) ([]string, error) {
	metadata, err := tx.readMetadataUnchecked()
	if err != nil || len(metadata.Plans) == 0 {
		return sandbox.ChangedPathsBetween(ctx, tx.Root, baseline, current)
	}
	own := make(map[string]bool, len(metadata.Plans))
	for _, plan := range metadata.Plans {
		own[plan.PlanID] = true
	}
	chain, err := firstParentChain(ctx, tx.Root, baseline, current)
	if err != nil || len(chain) == 0 || chain[len(chain)-1].parents[0] != baseline {
		return sandbox.ChangedPathsBetween(ctx, tx.Root, baseline, current)
	}
	changed := map[string]struct{}{}
	for _, commit := range chain {
		if len(commit.parents) == 2 && own[commitPlanID(ctx, tx.Root, commit.parents[1])] {
			continue
		}
		paths, err := sandbox.ChangedPathsBetween(ctx, tx.Root, commit.parents[0], commit.sha)
		if err != nil {
			return nil, err
		}
		for _, path := range paths {
			changed[path] = struct{}{}
		}
	}
	result := make([]string, 0, len(changed))
	for path := range changed {
		result = append(result, path)
	}
	sort.Strings(result)
	return result, nil
}

type chainCommit struct {
	sha     string
	parents []string
}

// firstParentChain lists baseline..current along first parents, newest first.
func firstParentChain(ctx context.Context, root, baseline, current string) ([]chainCommit, error) {
	output, err := exec.CommandContext(ctx, "git", "-C", root, "rev-list", "--first-parent", "--parents", baseline+".."+current).Output()
	if err != nil {
		return nil, fmt.Errorf("list first-parent history %s..%s: %w", baseline, current, err)
	}
	var chain []chainCommit
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			return nil, fmt.Errorf("commit %q has no parent inside %s..%s", line, baseline, current)
		}
		chain = append(chain, chainCommit{sha: fields[0], parents: fields[1:]})
	}
	return chain, nil
}

// commitPlanID reads the last Plan-Id trailer Wharnex writes on a verified
// candidate commit; an unreadable commit simply has none.
func commitPlanID(ctx context.Context, root, sha string) string {
	output, err := exec.CommandContext(ctx, "git", "-C", root, "log", "-1", "--format=%B", sha).Output()
	if err != nil {
		return ""
	}
	planID := ""
	for _, line := range strings.Split(string(output), "\n") {
		if value, ok := strings.CutPrefix(strings.TrimSpace(line), "Plan-Id:"); ok {
			planID = strings.TrimSpace(value)
		}
	}
	return planID
}
