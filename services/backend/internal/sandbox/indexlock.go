package sandbox

import (
	"context"
	"strings"
	"time"
)

// indexLockRetries and indexLockRetryDelay bound how long a Wharnex host
// mutation waits out another Git process briefly holding the index lock.
// Editors poll `git status` on the open project continuously, and each poll
// takes the lock for a moment; a merge or revert that loses that race once is
// not a blocked host, only an unlucky instant. A lock held for longer than the
// whole window is still reported, and still never deleted.
const (
	indexLockRetries    = 20
	indexLockRetryDelay = 250 * time.Millisecond
)

// runGitWaitingForIndexLock runs a host-mutating Git command, retrying only
// while its failure is index-lock contention.
func runGitWaitingForIndexLock(ctx context.Context, dir string, args ...string) (string, error) {
	var output string
	var err error
	for attempt := 0; attempt < indexLockRetries; attempt++ {
		output, err = runGit(ctx, dir, args...)
		if err == nil || !isIndexLockContention(output) {
			return output, err
		}
		select {
		case <-ctx.Done():
			return output, err
		case <-time.After(indexLockRetryDelay):
		}
	}
	return output, err
}

func isIndexLockContention(output string) bool {
	lowered := strings.ToLower(output)
	return strings.Contains(lowered, "index.lock") || strings.Contains(lowered, "another git process seems to be running")
}
