// Package worktreestats measures line changes keyed by exact worktree paths.
package worktreestats

import (
	"context"
	"strconv"
	"strings"

	"kernl.local/harness/backend/internal/gitops"
)

// Stat is a compact line-level summary used by list views.
type Stat struct {
	Additions int `json:"additions"`
	Deletions int `json:"deletions"`
}

// Read compares tracked content to HEAD and new files to the empty file.
func Read(ctx context.Context, root string) map[string]Stat {
	stats := map[string]Stat{}
	// Working classifies renames as separate deleted/added paths. Keep these
	// keys aligned, regardless of the repository's rename-detection setting.
	if output, err := gitops.Output(ctx, root, "diff", "--numstat", "-z", "--no-renames", "HEAD"); err == nil {
		parseNumstat(output, stats)
	}
	untracked, err := gitops.Output(ctx, root, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return stats
	}
	for _, path := range strings.Split(untracked, "\x00") {
		if path == "" {
			continue
		}
		output, diffErr := gitops.Output(ctx, root, "diff", "--no-index", "--numstat", "-z", "--", "/dev/null", path)
		// A successful --no-index comparison exits 1 when differences exist.
		if diffErr == nil || output != "" {
			parseNumstat(output, stats)
		}
	}
	return stats
}

func parseNumstat(output string, stats map[string]Stat) {
	records := strings.Split(output, "\x00")
	for i := 0; i < len(records); i++ {
		parts := strings.SplitN(records[i], "\t", 3)
		if len(parts) != 3 {
			continue
		}
		path := parts[2]
		if path == "" {
			// With -z Git emits paired paths as: counts TAB NUL old NUL new
			// NUL. --no-index uses this shape for /dev/null -> a new file.
			if i+2 >= len(records) {
				break
			}
			path = records[i+2]
			i += 2
		}
		if path == "" {
			continue
		}
		stat := stats[path]
		if value, err := strconv.Atoi(parts[0]); err == nil {
			stat.Additions += value
		}
		if value, err := strconv.Atoi(parts[1]); err == nil {
			stat.Deletions += value
		}
		stats[path] = stat
	}
}
