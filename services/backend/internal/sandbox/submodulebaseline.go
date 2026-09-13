package sandbox

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"kernl.local/harness/backend/internal/hostrepo"
)

// SubmoduleBaseline reports what a verification sandbox got for one submodule.
//
// Cloned means that path is a real Git repository in the sandbox, with the
// host submodule's own history, so a patch written there can be staged,
// committed and merged like any other change (adr/ADR-0050). Not cloned means
// the previous behavior: the files are still present, copied by the ordinary
// project overlay, but Git sees only a gitlink and nothing there is integrable.
type SubmoduleBaseline struct {
	Path   string
	Cloned bool
	Commit string
	Reason string
}

// prepareSubmoduleBaselines turns every initialized host submodule into a real
// repository inside the sandbox.
//
// Without this the sandbox is a `git clone --local` of the superproject alone:
// the clone does not carry submodule content, and the file overlay then writes
// the submodule's files into a directory the superproject's index shadows with
// a gitlink. The files are visible to a compiler and invisible to Git, which is
// exactly the asymmetry that made a verified patch die at
// `fatal: Pathspec … is in submodule` after the whole verification suite had
// already been spent on it.
//
// It is deliberately best effort per submodule. A submodule with no checkout,
// an unreadable one, or one whose recorded commit is absent locally is reported
// and left to the overlay; workspace preparation never fails because one
// submodule could not be reproduced.
func prepareSubmoduleBaselines(source, dest string) []SubmoduleBaseline {
	ctx := context.Background()
	units, err := hostrepo.InspectUnits(ctx, source)
	if err != nil || !units.HasSubmodules() {
		return nil
	}
	baselines := make([]SubmoduleBaseline, 0, len(units.List)-1)
	// Units arrive shallowest first, which is the only order that works here: a
	// nested submodule can only be cloned once the directory its parent clone
	// created exists.
	for _, unit := range units.Submodules() {
		baselines = append(baselines, cloneSubmoduleBaseline(source, dest, unit))
	}
	return baselines
}

func cloneSubmoduleBaseline(source, dest string, unit hostrepo.Unit) SubmoduleBaseline {
	baseline := SubmoduleBaseline{Path: unit.Path, Commit: unit.CommitSHA}
	if !unit.Integrable() {
		baseline.Reason = unit.Unmeasurable
		if baseline.Reason == "" {
			baseline.Reason = "the submodule could not be measured"
		}
		return baseline
	}
	sourceRoot := filepath.Join(source, filepath.FromSlash(unit.Path))
	target := filepath.Join(dest, filepath.FromSlash(unit.Path))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		baseline.Reason = truncateForError(err.Error(), 300)
		return baseline
	}
	if output, err := runLocal("", "clone", "-q", "--local", "--no-hardlinks", sourceRoot, target); err != nil {
		baseline.Reason = truncateForError(output, 300)
		// A half-written clone would shadow the overlay with a broken
		// repository, which is worse than having no repository at all.
		_ = os.RemoveAll(target)
		return baseline
	}
	// A clone creates fresh metadata; keep signing and project hooks disabled
	// inside Protected for exactly the reason the superproject clone does.
	for _, args := range [][]string{
		{"config", "commit.gpgSign", "false"},
		{"config", "tag.gpgSign", "false"},
		{"config", "--unset-all", "core.hooksPath"},
	} {
		_, _ = runLocal(target, args...)
	}
	if strings.TrimSpace(unit.CommitSHA) != "" {
		if output, err := runLocal(target, "checkout", "-q", "--detach", unit.CommitSHA); err != nil {
			// The clone is still useful — the overlay writes the host's real
			// content over it and the patch applies — but it is rooted at the
			// submodule's default branch rather than at the commit the
			// superproject records, so the divergence has to be reported.
			baseline.Cloned = true
			baseline.Reason = "recorded commit not checked out: " + truncateForError(output, 200)
			return baseline
		}
	}
	baseline.Cloned = true
	return baseline
}

// clonedSubmodulePaths lists the submodule paths a sandbox can actually
// integrate into, which is what the app layer compares a plan's write set
// against before routing it.
func clonedSubmodulePaths(baselines []SubmoduleBaseline) []string {
	paths := make([]string, 0, len(baselines))
	for _, baseline := range baselines {
		if baseline.Cloned {
			paths = append(paths, baseline.Path)
		}
	}
	return paths
}

func runLocal(dir string, args ...string) (string, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return "", fmt.Errorf("git executable not found")
	}
	if dir != "" {
		args = append([]string{"-C", dir}, args...)
	}
	cmd := exec.Command("git", args...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(output)), err
}
