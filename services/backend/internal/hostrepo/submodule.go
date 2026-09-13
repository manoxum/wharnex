package hostrepo

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// SyncSkip records a submodule whose worktree was deliberately not reconciled,
// with the reason. Skipping is a normal, safe outcome — reconciling a
// submodule Wharnex cannot satisfy offline, or one holding the operator's
// uncommitted work, would be worse than leaving it — but it must be reported
// rather than hidden, because the superproject is then knowingly ahead of a
// checkout the operator still has to update themselves.
type SyncSkip struct {
	Path   string
	Reason string
}

// SyncResult reports one reconciliation pass over a superproject's submodules.
type SyncResult struct {
	Updated []string
	Skipped []SyncSkip
}

// Changed reports whether the pass did anything worth telling the operator.
func (r SyncResult) Changed() bool { return len(r.Updated) > 0 || len(r.Skipped) > 0 }

// SyncSubmodules brings submodule worktrees back in line with the commits the
// superproject now records, after an operation that moved gitlinks.
//
// Git deliberately does not do this itself: `git merge` and `git reset --hard`
// update the gitlink in the index and HEAD, and leave the submodule's own
// checkout exactly where it was. For Wharnex that silence is corrosive in two
// compounding ways. Post-merge verification then builds against submodule
// content that does not match the tree it is verifying, so a correct change
// fails its own gates; and the superproject is left permanently reporting
// " M <submodule>", which is precisely the state that used to make every
// later Apply abort.
//
// Reconciliation is strictly offline and strictly non-destructive: it never
// fetches, and it never touches a submodule holding uncommitted work.
func SyncSubmodules(ctx context.Context, root string, before []Submodule) (SyncResult, error) {
	after, err := Inspect(ctx, root)
	if err != nil {
		return SyncResult{}, err
	}
	state, err := Working(ctx, root)
	if err != nil {
		return SyncResult{}, err
	}
	dirty := map[string]bool{}
	for _, path := range state.DirtySubmodules {
		dirty[path] = true
	}
	recorded := map[string]string{}
	for _, submodule := range before {
		recorded[submodule.Path] = submodule.CommitSHA
	}
	result := SyncResult{}
	for _, submodule := range after.Submodules {
		if previous, known := recorded[submodule.Path]; known && previous == submodule.CommitSHA {
			continue
		}
		if !submodule.Initialized {
			// An uninitialized submodule is an empty directory; there is no
			// checkout to move and nothing depends on its content.
			continue
		}
		if dirty[submodule.Path] {
			result.Skipped = append(result.Skipped, SyncSkip{Path: submodule.Path, Reason: "submodule holds uncommitted work and was left untouched"})
			continue
		}
		if !hasCommit(ctx, root, submodule) {
			result.Skipped = append(result.Skipped, SyncSkip{
				Path:   submodule.Path,
				Reason: "the recorded commit is not present in the submodule's local object store and Wharnex does not fetch",
			})
			continue
		}
		if output, err := run(ctx, root, "submodule", "update", "--recursive", "--no-fetch", "--checkout", "--", submodule.Path); err != nil {
			result.Skipped = append(result.Skipped, SyncSkip{Path: submodule.Path, Reason: truncate(output, 300)})
			continue
		}
		result.Updated = append(result.Updated, submodule.Path)
	}
	return result, nil
}

// hasCommit reports whether a submodule's own object store already contains
// the commit the superproject now points at. Checking first is what keeps
// reconciliation offline: a submodule whose new commit only exists upstream is
// reported as skipped rather than triggering a network fetch inside what is
// supposed to be a local integration step.
func hasCommit(ctx context.Context, root string, submodule Submodule) bool {
	if strings.TrimSpace(submodule.CommitSHA) == "" {
		return false
	}
	path := root + "/" + submodule.Path
	_, err := run(ctx, path, "cat-file", "-e", submodule.CommitSHA+"^{commit}")
	return err == nil
}

// GitlinkAt returns the commit a ref records for a submodule path, which is
// how a caller can tell whether an incoming merge would move that pointer
// before letting the merge touch the host.
func GitlinkAt(ctx context.Context, root, ref, path string) (string, bool) {
	output, err := run(ctx, root, "rev-parse", "-q", "--verify", ref+":"+path)
	if err != nil || output == "" {
		return "", false
	}
	return output, true
}

// GuardDirtySubmodules refuses an integration that would move the recorded
// commit of a submodule the operator has uncommitted work in.
//
// Git permits that merge and simply leaves the checkout behind, which is the
// worst of the available outcomes: the operator's work is still on disk but
// now sits on a base the superproject no longer records, verification runs
// against content matching neither, and the superproject stays permanently
// dirty. Refusing hands the operator a decision they can actually act on.
func GuardDirtySubmodules(ctx context.Context, root, branch string, dirtySubmodules []string) error {
	blocked := make([]string, 0, len(dirtySubmodules))
	for _, path := range dirtySubmodules {
		current, currentOK := GitlinkAt(ctx, root, "HEAD", path)
		incoming, incomingOK := GitlinkAt(ctx, root, branch, path)
		if currentOK && incomingOK && current != incoming {
			blocked = append(blocked, path)
		}
	}
	if len(blocked) == 0 {
		return nil
	}
	return &BlockedError{
		Reason: BlockedDirtySubmoduleGitlink,
		Detail: "the change moves the recorded commit of a submodule that has uncommitted work",
		Paths:  blocked,
		Remedy: "commit, stash or discard the work inside those submodules and apply again",
	}
}

func truncate(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}

// Available reports whether a usable git executable exists, so callers can
// degrade explicitly instead of failing deep inside an operation.
func Available() bool {
	_, err := exec.LookPath("git")
	return err == nil
}

// String renders a skip for an event payload.
func (s SyncSkip) String() string { return fmt.Sprintf("%s: %s", s.Path, s.Reason) }
