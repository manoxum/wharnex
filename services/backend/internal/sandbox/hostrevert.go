package sandbox

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

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
	return RevertHostMergeKeepingLater(ctx, hostPath, preMergeSHA, "")
}

// RevertHostMergeKeepingLater is RevertHostMerge for a caller that knows where
// its own integration ended (integrationTipSHA, the last commit it made).
// Commits a person made after that tip are not the integration's to discard:
// they are kept under a rescue ref and replayed onto the restored base.
func RevertHostMergeKeepingLater(ctx context.Context, hostPath, preMergeSHA, integrationTipSHA string) (hostrepo.SyncResult, error) {
	preMergeSHA = strings.TrimSpace(preMergeSHA)
	if preMergeSHA == "" {
		return hostrepo.SyncResult{}, errors.New("revert host merge: the pre-merge commit is unknown")
	}
	before, inspectErr := hostrepo.Inspect(ctx, hostPath)
	// A reset to the pre-merge tip once deleted a commit made on the branch
	// while the integration was being verified.
	var foreign []string
	if tip := strings.TrimSpace(integrationTipSHA); tip != "" {
		later, err := commitsAfter(ctx, hostPath, tip)
		if err != nil {
			return hostrepo.SyncResult{}, fmt.Errorf("revert host merge: %w", err)
		}
		foreign = later
	}
	rescueRef := ""
	if len(foreign) > 0 {
		rescueRef = "refs/wharnex/revert-rescue/" + time.Now().UTC().Format("20060102T150405")
		if output, err := runGitWaitingForIndexLock(ctx, hostPath, "update-ref", rescueRef, "HEAD"); err != nil {
			return hostrepo.SyncResult{}, fmt.Errorf("revert host merge: could not keep later commits before the reset: %s", output)
		}
	}
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
	for _, commit := range foreign {
		if output, err := runGitWaitingForIndexLock(ctx, hostPath, "cherry-pick", "--allow-empty", "--keep-redundant-commits", commit); err != nil {
			_, _ = runGitWaitingForIndexLock(ctx, hostPath, "cherry-pick", "--abort")
			return hostrepo.SyncResult{}, fmt.Errorf("revert host merge: restored %s, but a later commit %s could not be replayed on it and is kept at %s: %s", preMergeSHA, commit, rescueRef, strings.TrimSpace(output))
		}
	}
	if inspectErr != nil {
		return hostrepo.SyncResult{}, nil
	}
	sync, _ := hostrepo.SyncSubmodules(ctx, hostPath, before.Submodules)
	return sync, nil
}

// commitsAfter lists, oldest first, the commits after tip on the checked-out
// branch. A merge cannot be replayed, so it stops the revert before any reset.
func commitsAfter(ctx context.Context, hostPath, tip string) ([]string, error) {
	output, err := runGitWaitingForIndexLock(ctx, hostPath, "log", "--reverse", "--format=%H%x09%P%x09%an", tip+"..HEAD")
	if err != nil {
		return nil, fmt.Errorf("list commits after %s: %s", tip, strings.TrimSpace(output))
	}
	var later []string
	for _, line := range strings.Split(strings.TrimSpace(output), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) != 3 {
			continue
		}
		if len(strings.Fields(fields[1])) > 1 {
			return nil, fmt.Errorf("a merge by %s (%s) sits on top of the integration; resolve it by hand", strings.TrimSpace(fields[2]), fields[0])
		}
		later = append(later, fields[0])
	}
	return later, nil
}
