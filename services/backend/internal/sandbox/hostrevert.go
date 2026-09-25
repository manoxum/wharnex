package sandbox

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
)

// RevertHostMerge resets the host's checked-out branch back to preMergeSHA.
// Safe because preMergeSHA is always the tip this exact request's own merge
// moved away from, moments earlier — used when post-merge verification
// fails, so the host is never left in a state that failed its own build.
// Transient index-lock contention (an editor's `git status`) is waited out.
//
// The submodule realignment is not optional bookkeeping. `git reset --hard`
// restores the superproject's gitlinks but leaves every submodule checkout
// wherever the merge left it, so a revert without it returns a host that
// reports itself permanently modified — the exact condition that used to make
// every subsequent Apply fail before it began.
func RevertHostMerge(ctx context.Context, hostPath, preMergeSHA string) (hostrepo.SyncResult, error) {
	preMergeSHA = strings.TrimSpace(preMergeSHA)
	if preMergeSHA == "" {
		return hostrepo.SyncResult{}, errors.New("revert host merge: the pre-merge commit is unknown")
	}
	before, inspectErr := hostrepo.Inspect(ctx, hostPath)
	if output, err := runGitWaitingForIndexLock(ctx, hostPath, "reset", "--hard", preMergeSHA); err != nil {
		if blocked := hostrepo.HostGitBlocked(ctx, hostPath, output); blocked != nil {
			return hostrepo.SyncResult{}, fmt.Errorf("revert host merge to %s: %w", preMergeSHA, blocked)
		}
		return hostrepo.SyncResult{}, fmt.Errorf("revert host merge to %s: %s", preMergeSHA, output)
	}
	// A revert that reports success but leaves HEAD elsewhere is the failure
	// that matters most here, so it is measured rather than assumed.
	if head, err := CurrentHeadSHA(ctx, hostPath); err != nil || head != preMergeSHA {
		return hostrepo.SyncResult{}, fmt.Errorf("revert host merge: HEAD is %s after reset, expected %s", head, preMergeSHA)
	}
	if inspectErr != nil {
		return hostrepo.SyncResult{}, nil
	}
	sync, _ := hostrepo.SyncSubmodules(ctx, hostPath, before.Submodules)
	return sync, nil
}
