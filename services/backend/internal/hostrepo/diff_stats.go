package hostrepo

import (
	"context"
	"crypto/sha256"

	"kernl.local/harness/backend/internal/hostrepo/worktreestats"
)

// StagedSignature fingerprints the meaningful index diff. Git status may
// rewrite index stat caches without changing what is staged.
func StagedSignature(ctx context.Context, root string) [32]byte {
	output, _ := runRaw(ctx, root, "diff", "--cached", "--raw", "-z")
	return sha256.Sum256([]byte(output))
}

// DiffStat is a compact line-level summary used by list views.
type DiffStat = worktreestats.Stat

// WorktreeStats returns line counts for tracked/staged and untracked files.
func WorktreeStats(ctx context.Context, root string) map[string]DiffStat {
	return worktreestats.Read(ctx, root)
}
