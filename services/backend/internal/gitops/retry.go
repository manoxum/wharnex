package gitops

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type attempt func() (output, diagnostic string, err error)
type recoveryAttempt func(context.Context, string) bool

func retry(ctx context.Context, root string, run attempt, recover recoveryAttempt) (string, error) {
	cleaned := false
	for number := 0; ; number++ {
		output, diagnostic, err := run()
		if err == nil || ctx.Err() != nil || !indexLockFailure(diagnostic) {
			return output, err
		}
		// Only the ordinary repository index is eligible. A private-index or
		// config override must never clear a different lock as collateral work.
		if number == 0 && defaultIndexFailure(ctx, root, diagnostic) {
			cleaned = recover(ctx, root)
		}
		if cleaned {
			// Exactly one replay after cleanup; a second lock is new contention.
			if ctx.Err() != nil {
				return output, errors.Join(err, ctx.Err())
			}
			output, _, err = run()
			return output, err
		}
		if number >= 3 {
			return output, err
		}
		timer := time.NewTimer(100 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return output, errors.Join(err, ctx.Err())
		case <-timer.C:
		}
	}
}

func indexLockFailure(output string) bool {
	return indexLockCreationFailure(output, "") && strings.Contains(output, "index.lock': File exists.")
}

func indexLockCreationFailure(output, path string) bool {
	for _, severity := range []string{"fatal", "error"} {
		marker := severity + ": Unable to create '" + path
		if path != "" {
			marker += "': File exists."
		}
		if strings.Contains(output, marker) {
			return true
		}
	}
	return false
}

func defaultIndexFailure(ctx context.Context, root, output string) bool {
	for _, key := range []string{"GIT_INDEX_FILE", "GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE"} {
		if os.Getenv(key) != "" {
			return false
		}
	}
	cmd := exec.CommandContext(ctx, "git", "-C", root, "rev-parse", "--absolute-git-dir")
	cmd.Env = environment()
	gitDir, err := cmd.Output()
	if err != nil {
		return false
	}
	path := filepath.Join(strings.TrimSpace(string(gitDir)), "index.lock")
	return indexLockCreationFailure(output, path)
}
