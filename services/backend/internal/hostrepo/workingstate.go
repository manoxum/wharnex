package hostrepo

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// WorkingState classifies a host worktree's uncommitted state by what Git can
// actually do with each kind of dirt.
//
// The distinction is load bearing. The previous implementation asked one
// question — "is `git status --porcelain` non-empty?" — and then assumed the
// answer meant `git add -A` would stage something. Three of the four classes
// below break that assumption, and each broke Apply in a different way:
//
//   - Stageable is the only class `git add -A` actually captures.
//   - DirtySubmodules are reported as modified but stage nothing, so a commit
//     after `add -A` fails with "no changes added to commit" and aborted every
//     subsequent Apply until the operator cleaned the submodule by hand.
//   - EmbeddedRepositories stage as a gitlink (mode 160000), so the snapshot
//     commit silently records a pointer instead of the operator's files, and
//     the revert that promises to restore them cannot.
//   - Unmerged stage as if the conflict were resolved, committing the
//     operator's conflict markers into their own project history.
type WorkingState struct {
	// Stageable lists paths `git add -A` will genuinely capture.
	Stageable []string
	// Statuses preserves the human-facing Git state for paths reported by
	// porcelain. It is intentionally separate from the safety classification
	// above: Apply cares whether a path is capturable, while the workbench also
	// needs to explain whether that path was added, modified or deleted.
	Statuses map[string]string
	// DirtySubmodules lists submodules whose working tree has uncommitted
	// content. Their dirt lives in another repository and the superproject
	// cannot commit it.
	DirtySubmodules []string
	// GitlinkChanges lists submodules whose recorded commit differs from the
	// superproject index. Unlike content dirt, this IS stageable.
	GitlinkChanges []string
	// EmbeddedRepositories lists untracked directories that are themselves Git
	// repositories.
	EmbeddedRepositories []string
	// Unmerged lists paths with unresolved conflict stages.
	Unmerged []string
}

// Clean reports a worktree with nothing at all to preserve.
func (w WorkingState) Clean() bool {
	return len(w.Stageable) == 0 && len(w.DirtySubmodules) == 0 &&
		len(w.GitlinkChanges) == 0 && len(w.EmbeddedRepositories) == 0 && len(w.Unmerged) == 0
}

// Committable reports whether a snapshot commit would capture anything. When
// false, the correct behavior is to skip the snapshot entirely rather than to
// run a commit that fails — the exact failure that made a dirty submodule
// permanently block host integration.
func (w WorkingState) Committable() bool {
	return len(w.Stageable) > 0 || len(w.GitlinkChanges) > 0
}

// Working classifies a repository's current uncommitted state.
//
// It reads `git status --porcelain=v2 -z --untracked-files=all`, whose
// per-entry submodule field (`N...` for an ordinary path, `S<c><m><u>` for a
// gitlink) distinguishes a moved gitlink from dirty submodule content — a
// distinction porcelain v1 collapses into an indistinguishable " M <path>".
//
// NUL termination plus --no-renames keeps every record exactly one chunk with
// an unquoted path, so a path containing spaces or non-ASCII bytes parses the
// same as any other. Renames are irrelevant here: this classifies which dirt
// is capturable, not how a file got where it is.
func Working(ctx context.Context, root string) (WorkingState, error) {
	output, err := run(ctx, root, "status", "--porcelain=v2", "-z", "--untracked-files=all", "--no-renames")
	if err != nil {
		return WorkingState{}, fmt.Errorf("inspect host working tree: %s", output)
	}
	state := WorkingState{Statuses: map[string]string{}}
	for _, record := range strings.Split(output, "\x00") {
		if record == "" {
			continue
		}
		switch record[0] {
		case '1', '2':
			// "1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>"
			classifyChangedEntry(record, &state)
		case 'u':
			// "u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
			if path := recordPath(record, 10); path != "" {
				state.Unmerged = append(state.Unmerged, path)
				state.Statuses[path] = "unmerged"
			}
		case '?':
			classifyUntrackedEntry(root, recordPath(record, 1), &state)
		}
	}
	sortAll(&state)
	return state, nil
}

// classifyChangedEntry reads one tracked-change record. Field 3 is the
// submodule state: "N..." for a normal path, or "S<c><m><u>" where c='C' means
// the recorded commit changed, m='M' means the submodule worktree has modified
// content, and u='U' means it has untracked content.
func classifyChangedEntry(record string, state *WorkingState) {
	fields := strings.SplitN(record, " ", 9)
	if len(fields) < 9 {
		return
	}
	status := workingPathStatus(fields[1])
	path := filepath.ToSlash(fields[8])
	if path == "" {
		return
	}
	state.Statuses[path] = status
	submoduleField := fields[2]
	if !strings.HasPrefix(submoduleField, "S") || len(submoduleField) < 4 {
		state.Stageable = append(state.Stageable, path)
		return
	}
	if submoduleField[1] == 'C' {
		state.GitlinkChanges = append(state.GitlinkChanges, path)
	}
	if submoduleField[2] == 'M' || submoduleField[3] == 'U' {
		state.DirtySubmodules = append(state.DirtySubmodules, path)
	}
}

// classifyUntrackedEntry separates ordinary untracked files from embedded
// repositories. With --untracked-files=all Git expands every untracked
// directory into its files, so an entry that is still a directory is one Git
// refused to descend into — which is precisely an embedded repository. The
// on-disk check confirms it rather than trusting the shape alone.
func classifyUntrackedEntry(root, path string, state *WorkingState) {
	if path == "" {
		return
	}
	trimmed := strings.TrimSuffix(path, "/")
	if _, err := os.Lstat(filepath.Join(root, filepath.FromSlash(trimmed), ".git")); err == nil {
		state.EmbeddedRepositories = append(state.EmbeddedRepositories, trimmed)
		return
	}
	state.Stageable = append(state.Stageable, trimmed)
	state.Statuses[trimmed] = "added"
}

func workingPathStatus(xy string) string {
	if strings.Contains(xy, "D") {
		return "deleted"
	}
	if strings.Contains(xy, "A") {
		return "added"
	}
	return "modified"
}

// recordPath returns the path field of a porcelain v2 record, given how many
// space-separated fields precede it. Splitting with a bound rather than on
// every space is what keeps a path containing spaces intact.
func recordPath(record string, precedingFields int) string {
	fields := strings.SplitN(record, " ", precedingFields+1)
	if len(fields) <= precedingFields {
		return ""
	}
	return filepath.ToSlash(fields[precedingFields])
}

func sortAll(state *WorkingState) {
	for _, list := range []*[]string{&state.Stageable, &state.DirtySubmodules, &state.GitlinkChanges, &state.EmbeddedRepositories, &state.Unmerged} {
		sort.Strings(*list)
	}
}
