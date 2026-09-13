package sandbox

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/hostrepo"
)

func writeFile(t *testing.T, root, rel, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func readFile(t *testing.T, root, rel string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		t.Fatalf("read %s: %v", rel, err)
	}
	return string(data)
}

func unitMessage(t *testing.T) UnitCommitMessage {
	t.Helper()
	return func(unit hostrepo.Unit, pointerUpdates []string) string {
		message := "fix(app): correct the dependency install"
		if len(pointerUpdates) > 0 {
			message += "\n\nRecords: " + strings.Join(pointerUpdates, ", ")
		}
		return message
	}
}

// The sandbox is a clone of the superproject, which carries no submodule
// content: the files were written on top of a directory the index shadows with
// a gitlink, so `git add` there failed with "Pathspec is in submodule" after the
// entire verification suite had already been spent on the change.
func TestCopyProjectGivesEachSubmoduleARealRepository(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "services/app")

	workspace, err := copyProject(host)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(workspace.Path)

	info, err := os.Stat(filepath.Join(workspace.Path, "services", "app", ".git"))
	if err != nil || !info.IsDir() {
		t.Fatalf("the submodule must be a real repository in the sandbox: %v", err)
	}
	recorded := mustGit(t, host, "rev-parse", "HEAD:services/app")
	if head := mustGit(t, filepath.Join(workspace.Path, "services", "app"), "rev-parse", "HEAD"); head != recorded {
		t.Fatalf("the sandbox submodule is at %s, want the commit the superproject records (%s)", head, recorded)
	}
	if len(workspace.SubmoduleBaselines) != 1 || !workspace.SubmoduleBaselines[0].Cloned {
		t.Fatalf("the baseline must be reported as reproduced: %+v", workspace.SubmoduleBaselines)
	}
	// The overlay still reproduces the host's real content on top of it.
	if got := readFile(t, workspace.Path, "services/app/lib.txt"); got != "v1\n" {
		t.Fatalf("the submodule's content was not overlaid: %q", got)
	}
}

// The reported failure, end to end: a change whose only edit is inside a
// submodule is committed there, the superproject records the moved pointer, and
// both merge onto the host.
func TestSubmoduleNativeIntegrationCommitsMergesAndReverts(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "services/app")
	workspace, err := copyProject(host)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(workspace.Path)
	originalHostHead := mustGit(t, host, "rev-parse", "HEAD")
	originalSubmoduleHead := mustGit(t, filepath.Join(host, "services", "app"), "rev-parse", "HEAD")

	writeFile(t, workspace.Path, "services/app/lib.txt", "v2\n")
	writeFile(t, workspace.Path, "hello.txt", "after\n")

	ctx := context.Background()
	units, err := hostrepo.InspectUnits(ctx, workspace.Path)
	if err != nil {
		t.Fatal(err)
	}
	sets := units.Group([]string{"services/app/lib.txt", "hello.txt"})
	commits, err := CommitVerifiedUnits(ctx, workspace.Path, "whx/req_units", units, sets, nil, unitMessage(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) != 2 {
		t.Fatalf("expected one commit per repository unit, got %+v", commits)
	}
	if commits[0].UnitPath != "services/app" {
		t.Fatalf("the submodule must be committed first, got %q", commits[0].UnitPath)
	}
	if commits[1].UnitPath != hostrepo.RootUnitPath || len(commits[1].PointerUpdates) != 1 {
		t.Fatalf("the superproject must record the moved pointer, got %+v", commits[1])
	}

	if err := PushUnitsToHost(ctx, workspace.Path, host, commits); err != nil {
		t.Fatal(err)
	}
	merge, err := MergeUnitsOnHost(ctx, host, "whx/req_units", []string{"services/app", hostrepo.RootUnitPath})
	if err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, host, "services/app/lib.txt"); got != "v2\n" {
		t.Fatalf("the submodule change did not reach the host: %q", got)
	}
	if got := readFile(t, host, "hello.txt"); got != "after\n" {
		t.Fatalf("the superproject change did not reach the host: %q", got)
	}
	// The whole point of moving the pointer: the superproject must not be left
	// reporting itself permanently modified, which is what blocked every later
	// Apply before ADR-0050.
	if status := mustGit(t, host, "status", "--porcelain"); strings.TrimSpace(status) != "" {
		t.Fatalf("the host must be clean after integration, got:\n%s", status)
	}
	if recorded := mustGit(t, host, "rev-parse", "HEAD:services/app"); recorded == originalSubmoduleHead {
		t.Fatal("the superproject still records the old submodule commit")
	}

	if err := RevertHostUnits(ctx, host, merge); err != nil {
		t.Fatal(err)
	}
	if got := mustGit(t, host, "rev-parse", "HEAD"); got != originalHostHead {
		t.Fatalf("the superproject did not return to its pre-merge commit: %s", got)
	}
	if got := mustGit(t, filepath.Join(host, "services", "app"), "rev-parse", "HEAD"); got != originalSubmoduleHead {
		t.Fatalf("the submodule did not return to its pre-merge commit: %s", got)
	}
	if got := readFile(t, host, "services/app/lib.txt"); got != "v1\n" {
		t.Fatalf("the revert left the submodule's content changed: %q", got)
	}
	if status := mustGit(t, host, "status", "--porcelain"); strings.TrimSpace(status) != "" {
		t.Fatalf("the host must be clean after revert, got:\n%s", status)
	}
}

// An operator's uncommitted work inside a submodule Wharnex is integrating is
// preserved by a snapshot commit in that submodule, rather than blocking the
// integration. Refusing there would block the feature on exactly the state it
// now handles.
func TestSubmoduleIntegrationPreservesOperatorWorkInsideTheSubmodule(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "services/app")
	workspace, err := copyProject(host)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(workspace.Path)
	writeFile(t, workspace.Path, "services/app/lib.txt", "v2\n")

	ctx := context.Background()
	units, err := hostrepo.InspectUnits(ctx, workspace.Path)
	if err != nil {
		t.Fatal(err)
	}
	commits, err := CommitVerifiedUnits(ctx, workspace.Path, "whx/req_dirty", units,
		units.Group([]string{"services/app/lib.txt"}), nil, unitMessage(t))
	if err != nil {
		t.Fatal(err)
	}
	if err := PushUnitsToHost(ctx, workspace.Path, host, commits); err != nil {
		t.Fatal(err)
	}
	// The operator's own work, in the submodule this change is about.
	writeFile(t, host, "services/app/notes.txt", "operator work\n")

	merge, err := MergeUnitsOnHost(ctx, host, "whx/req_dirty", []string{"services/app", hostrepo.RootUnitPath})
	if err != nil {
		t.Fatalf("a dirty submodule Wharnex integrates into must not block the merge: %v", err)
	}
	if got := readFile(t, host, "services/app/notes.txt"); got != "operator work\n" {
		t.Fatalf("the operator's work was lost: %q", got)
	}
	if got := readFile(t, host, "services/app/lib.txt"); got != "v2\n" {
		t.Fatalf("the change did not reach the submodule: %q", got)
	}
	var preserved bool
	for _, unit := range merge.Units {
		if unit.UnitPath == "services/app" && unit.Preservation.Committed {
			preserved = true
		}
	}
	if !preserved {
		t.Fatalf("the submodule's uncommitted work must be snapshotted in its own repository: %+v", merge.Units)
	}
}

// Base rooting must reach every unit, and the superproject's own `git clean`
// must not destroy the submodule repositories the sandbox just cloned: Git
// refuses to descend into a nested repository without `-ff`, and that refusal
// is exactly what this relies on.
func TestCheckoutRequestBaseUnitsRootsEveryUnitWithoutLosingSubmoduleClones(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "services/app")
	workspace, err := copyProject(host)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(workspace.Path)

	ctx := context.Background()
	bases, err := CaptureRequestBaseUnits(ctx, host, "req_rooted")
	if err != nil {
		t.Fatal(err)
	}
	if len(bases) != 2 {
		t.Fatalf("expected an anchor per repository unit, got %+v", bases)
	}
	for _, base := range bases {
		if base.CommitSHA == "" {
			t.Fatalf("unit %q was not anchored: %s", base.UnitPath, base.Reason)
		}
	}

	rooted, degraded := CheckoutRequestBaseUnits(ctx, workspace.Path, host, "req_rooted", "whx/req_rooted", bases)
	if len(degraded) != 0 {
		t.Fatalf("no unit should have degraded: %+v", degraded)
	}
	if !rooted[hostrepo.RootUnitPath] || !rooted["services/app"] {
		t.Fatalf("every unit must be rooted, got %+v", rooted)
	}
	for _, unit := range []string{"", "services/app"} {
		root := UnitRepoPath(workspace.Path, unit)
		if branch := mustGit(t, root, "rev-parse", "--abbrev-ref", "HEAD"); branch != "whx/req_rooted" {
			t.Fatalf("%s is on %q, want the integration branch", unitLabel(unit), branch)
		}
	}
	if info, err := os.Stat(filepath.Join(workspace.Path, "services", "app", ".git")); err != nil || !info.IsDir() {
		t.Fatalf("the superproject checkout destroyed the submodule's repository: %v", err)
	}
	if got := readFile(t, workspace.Path, "services/app/lib.txt"); got != "v1\n" {
		t.Fatalf("the submodule's base content is wrong: %q", got)
	}

	if failures := DeleteRequestBaseUnitRefs(ctx, host, "req_rooted", []string{"services/app", hostrepo.RootUnitPath}); len(failures) != 0 {
		t.Fatalf("every unit's anchor must be releasable, got %v", failures)
	}
}

func TestOrderUnitsDeepestFirstPutsTheSuperprojectLast(t *testing.T) {
	ordered := orderUnitsDeepestFirst([]string{hostrepo.RootUnitPath, "a", "a/b", "a", "."})
	want := []string{"a/b", "a", hostrepo.RootUnitPath}
	if len(ordered) != len(want) {
		t.Fatalf("expected deduplicated units %v, got %v", want, ordered)
	}
	for index := range want {
		if ordered[index] != want[index] {
			t.Fatalf("unit %d is %q, want %q", index, ordered[index], want[index])
		}
	}
}

// Verification commits inside a submodule's own repository and records which
// branch that repository was on. If the operator checks it out onto something
// else before Apply, merging would advance a branch the candidate was never
// built against — in a repository Wharnex does not own.
func TestGuardUnitDriftRefusesASubmoduleMovedSinceVerification(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "services/app")
	ctx := context.Background()
	appRoot := filepath.Join(host, "services", "app")
	mustGit(t, appRoot, "checkout", "-q", "-B", "devup")

	verified := CaptureUnitCheckouts(ctx, host, []string{hostrepo.RootUnitPath, "services/app"})
	if verified["services/app"].TargetBranch != "devup" || verified["services/app"].BaseCommit == "" {
		t.Fatalf("the capture must record the branch and its commit, got %+v", verified["services/app"])
	}
	if err := GuardUnitDrift(ctx, host, verified); err != nil {
		t.Fatalf("an unchanged checkout must pass the guard: %v", err)
	}

	mustGit(t, appRoot, "checkout", "-q", "-B", "other")
	err := GuardUnitDrift(ctx, host, verified)
	var drift *UnitDriftError
	if !errors.As(err, &drift) {
		t.Fatalf("expected a typed drift refusal, got %v", err)
	}
	if drift.UnitPath != "services/app" || !strings.Contains(drift.Error(), "devup") || !strings.Contains(drift.Error(), "other") {
		t.Fatalf("the refusal must name the unit and both branches, got %v", drift)
	}
}

// A candidate persisted before checkouts were recorded must stay appliable, and
// a submodule the operator deliberately keeps detached is not drift.
func TestGuardUnitDriftIgnoresUnrecordedAndDetachedUnits(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "services/app")
	ctx := context.Background()

	if err := GuardUnitDrift(ctx, host, nil); err != nil {
		t.Fatalf("a candidate with no recorded checkout must not be guarded: %v", err)
	}
	detached := map[string]UnitCheckout{"services/app": {BaseCommit: "deadbeef"}}
	if err := GuardUnitDrift(ctx, host, detached); err != nil {
		t.Fatalf("a unit verified while detached must not be guarded: %v", err)
	}
}

// A push that fails part-way must not leave refs behind for a candidate that
// never existed; the next attempt at the same request id would then fail to
// create a branch it had apparently already pushed.
func TestPushUnitsToHostUnwindsRefsItAlreadyPublished(t *testing.T) {
	requireGit(t)
	host := newHostRepoWithSubmodule(t, "services/app")
	workspace, err := copyProject(host)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(workspace.Path)
	ctx := context.Background()
	writeFile(t, workspace.Path, "services/app/lib.txt", "v2\n")
	units, err := hostrepo.InspectUnits(ctx, workspace.Path)
	if err != nil {
		t.Fatal(err)
	}
	commits, err := CommitVerifiedUnits(ctx, workspace.Path, "whx/req_unwind", units,
		units.Group([]string{"services/app/lib.txt"}), nil, unitMessage(t))
	if err != nil {
		t.Fatal(err)
	}
	// Make the LAST unit's push fail by pointing it at a destination that is
	// not a repository, after the first one has already been published.
	broken := append([]UnitCommit(nil), commits...)
	broken[len(broken)-1].UnitPath = "definitely/not/a/repository"
	if err := PushUnitsToHost(ctx, workspace.Path, host, broken); err == nil {
		t.Fatal("expected the publish to fail")
	}
	if _, lookupErr := runGit(ctx, filepath.Join(host, "services", "app"), "rev-parse", "--verify", "-q", "whx/req_unwind"); lookupErr == nil {
		t.Fatal("a failed publish left the branch it had already pushed behind in the submodule")
	}
}
