package app

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/hostrepo"
)

func requireGitForApp(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
}

func runGitForApp(t *testing.T, dir string, args ...string) {
	t.Helper()
	base := []string{
		"-C", dir,
		"-c", "user.name=Tester", "-c", "user.email=test@example.invalid",
		"-c", "commit.gpgSign=false", "-c", "protocol.file.allow=always",
	}
	cmd := exec.Command("git", append(base, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
}

func newAppRepo(t *testing.T, fileName string) string {
	t.Helper()
	root := t.TempDir()
	runGitForApp(t, root, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(root, fileName), []byte("content\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, root, "add", "-A")
	runGitForApp(t, root, "commit", "-qm", "initial")
	return root
}

func newAppRepoWithSubmodule(t *testing.T, subPath string) string {
	t.Helper()
	origin := newAppRepo(t, "lib.txt")
	root := newAppRepo(t, "README.md")
	runGitForApp(t, root, "submodule", "add", "-q", "--", origin, subPath)
	runGitForApp(t, root, "commit", "-qm", "add submodule")
	return root
}

func planPatching(path string) *domain.ExecutionPlan {
	patch := "--- a/" + path + "\n+++ b/" + path + "\n@@ -1 +1,2 @@\n content\n+added\n"
	return &domain.ExecutionPlan{
		PlanID:     "plan_1",
		RequestID:  "req_1",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: patch}},
	}
}

// A path inside an initialized submodule is ordinary, integrable source: it is
// committed in that submodule's own repository and the superproject's pointer
// is moved to match (adr/ADR-0050). Refusing it — the pre-ADR-0050 behavior —
// made a deployment superproject whose whole source lives in submodules unable
// to receive any change at all.
func TestRouteSubmoduleWritesAdmitsAnInitializedSubmodule(t *testing.T) {
	requireGitForApp(t)
	root := newAppRepoWithSubmodule(t, "mod/app")
	service := &Service{bus: audit.NewBus()}

	if err := service.routeSubmoduleWrites(context.Background(), "session", root, planPatching("mod/app/lib.txt")); err != nil {
		t.Fatalf("a write inside an initialized submodule must be admitted: %v", err)
	}
}

// What remains refused is the case where no repository can receive the change:
// a submodule with no checkout is an empty directory, so there is nothing to
// patch and nothing to commit into, and no planner repair can change that.
func TestRouteSubmoduleWritesRefusesAnUninitializedSubmodule(t *testing.T) {
	requireGitForApp(t)
	origin := newAppRepoWithSubmodule(t, "mod/app")
	root := filepath.Join(t.TempDir(), "clone")
	runGitForApp(t, t.TempDir(), "clone", "-q", "--", origin, root)
	service := &Service{bus: audit.NewBus()}

	err := service.routeSubmoduleWrites(context.Background(), "session", root, planPatching("mod/app/lib.txt"))
	if !errors.Is(err, ErrSubmoduleWrite) {
		t.Fatalf("expected ErrSubmoduleWrite, got %v", err)
	}
	if !strings.Contains(err.Error(), "mod/app") {
		t.Fatalf("the refusal must name the submodule, got %v", err)
	}
	if !strings.Contains(err.Error(), "submodule update --init") {
		t.Fatalf("the refusal must carry the operator action that clears it, got %v", err)
	}
}

func TestRouteSubmoduleWritesAllowsSuperprojectPaths(t *testing.T) {
	requireGitForApp(t)
	root := newAppRepoWithSubmodule(t, "mod/app")
	service := &Service{bus: audit.NewBus()}

	if err := service.routeSubmoduleWrites(context.Background(), "session", root, planPatching("README.md")); err != nil {
		t.Fatalf("a superproject path must be admitted: %v", err)
	}
	// A path that merely shares a prefix with the submodule is not inside it.
	if err := service.routeSubmoduleWrites(context.Background(), "session", root, planPatching("mod/apple.txt")); err != nil {
		t.Fatalf("a path outside the submodule must be admitted: %v", err)
	}
}

// A project Wharnex cannot measure must behave exactly as before: a
// measurement failure may never reject a legitimate change.
func TestRouteSubmoduleWritesAdmitsWhenTheProjectCannotBeInspected(t *testing.T) {
	service := &Service{bus: audit.NewBus()}
	if err := service.routeSubmoduleWrites(context.Background(), "session", filepath.Join(t.TempDir(), "missing"), planPatching("a.txt")); err != nil {
		t.Fatalf("an unmeasurable project must degrade to the previous behavior, got %v", err)
	}
	if err := service.routeSubmoduleWrites(context.Background(), "session", "", planPatching("a.txt")); err != nil {
		t.Fatalf("an empty project path must degrade, got %v", err)
	}
}

// A gitlink conflict is three commit ids: `git show <ref>:<submodule>` returns
// nothing, so a capsule built from it tells the planner the path exists on no
// side and then asks for a patch there — rejected on arrival, every round.
//
// A path INSIDE the submodule is the opposite case: it is an ordinary file in
// that submodule's own repository, reported by that repository's own merge, and
// a planner resolves it exactly like any other file.
func TestPartitionSubmoduleConflictPathsSeparatesOnlyGitlinks(t *testing.T) {
	topology := hostrepo.Topology{Submodules: []hostrepo.Submodule{{Path: "mod/app"}}}
	submodulePaths, resolvable := partitionSubmoduleConflictPaths(topology, []string{"README.md", "mod/app", "mod/app/lib.txt"})
	if len(submodulePaths) != 1 || submodulePaths[0] != "mod/app" {
		t.Fatalf("expected only the gitlink partitioned out, got %v", submodulePaths)
	}
	if len(resolvable) != 2 || resolvable[0] != "README.md" || resolvable[1] != "mod/app/lib.txt" {
		t.Fatalf("expected the superproject file and the in-submodule file left for a planner, got %v", resolvable)
	}
}

func TestClassifyHostWorkingStateBlockedFailure(t *testing.T) {
	blocked := &hostrepo.BlockedError{
		Reason: hostrepo.BlockedUnmergedPaths,
		Detail: "the index holds unresolved conflicts",
		Paths:  []string{"f.txt"},
		Remedy: "resolve or reset those paths and apply again",
	}
	wrapped := errors.Join(ErrHostWorkingStateBlocked, blocked)
	if kind := classifyExecutionFailure(wrapped); kind != domain.FailureKindHostWorkingStateBlocked {
		t.Fatalf("expected %q, got %q", domain.FailureKindHostWorkingStateBlocked, kind)
	}
	detail := hostStateBlockedDetail(blocked)
	if !strings.Contains(detail, "f.txt") || !strings.Contains(detail, "apply again") {
		t.Fatalf("the failure text must name the paths and the remedy, got %q", detail)
	}
}
