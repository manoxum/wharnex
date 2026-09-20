package hostrepo

import (
	"context"
	"strconv"
	"strings"
)

// DiffStat is a compact line-level summary used by list views.
type DiffStat struct {
	Additions int `json:"additions"`
	Deletions int `json:"deletions"`
}

func parseNumstat(output string, stats map[string]DiffStat) {
	for _, line := range strings.Split(output, "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "\t", 3)
		if len(parts) != 3 {
			continue
		}
		path := strings.TrimSpace(parts[2])
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

// WorktreeStats returns line counts for tracked/staged and untracked files.
func WorktreeStats(ctx context.Context, root string) map[string]DiffStat {
	stats := map[string]DiffStat{}
	if output, err := runRaw(ctx, root, "diff", "--numstat", "HEAD"); err == nil {
		parseNumstat(output, stats)
	}
	untracked, err := runRaw(ctx, root, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return stats
	}
	for _, path := range strings.Split(untracked, "\x00") {
		if path == "" {
			continue
		}
		output, diffErr := runRaw(ctx, root, "diff", "--no-index", "--numstat", "--", "/dev/null", path)
		if diffErr == nil || output != "" {
			parseNumstat(output, stats)
		}
	}
	return stats
}
