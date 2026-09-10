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

// A patch inside a submodule cannot be staged, committed or merged: the
// superproject's index holds a single gitlink there. Left undetected it
// applied to disk, passed every verification gate, and then died at commit
// time with an opaque Git error — after a full model turn and container run,
// and with no repair a planner could possibly produce.
func TestRejectSubmoduleWritesRefusesPatchesInsideASubmodule(t *testing.T) {
	requireGitForApp(t)
	root := newAppRepoWithSubmodule(t, "mod/app")
	service := &Service{bus: audit.NewBus()}

	err := service.rejectSubmoduleWrites(context.Background(), "session", root, planPatching("mod/app/lib.txt"))
	if !errors.Is(err, ErrSubmoduleWrite) {
		t.Fatalf("expected ErrSubmoduleWrite, got %v", err)
	}
	if !strings.Contains(err.Error(), "mod/app") {
		t.Fatalf("the refusal must name the submodule, got %v", err)
	}
}

func TestRejectSubmoduleWritesAllowsSuperprojectPaths(t *testing.T) {
	requireGitForApp(t)
	root := newAppRepoWithSubmodule(t, "mod/app")
	service := &Service{bus: audit.NewBus()}

	if err := service.rejectSubmoduleWrites(context.Background(), "session", root, planPatching("README.md")); err != nil {
		t.Fatalf("a superproject path must be admitted: %v", err)
	}
	// A path that merely shares a prefix with the submodule is not inside it.
	if err := service.rejectSubmoduleWrites(context.Background(), "session", root, planPatching("mod/apple.txt")); err != nil {
		t.Fatalf("a path outside the submodule must be admitted: %v", err)
	}
}

// A project Wharnex cannot measure must behave exactly as before: a
// measurement failure may never reject a legitimate change.
func TestRejectSubmoduleWritesAdmitsWhenTheProjectCannotBeInspected(t *testing.T) {
	service := &Service{bus: audit.NewBus()}
	if err := service.rejectSubmoduleWrites(context.Background(), "session", filepath.Join(t.TempDir(), "missing"), planPatching("a.txt")); err != nil {
		t.Fatalf("an unmeasurable project must degrade to the previous behavior, got %v", err)
	}
	if err := service.rejectSubmoduleWrites(context.Background(), "session", "", planPatching("a.txt")); err != nil {
		t.Fatalf("an empty project path must degrade, got %v", err)
	}
}

// A gitlink conflict is three commit ids: `git show <ref>:<submodule>` returns
// nothing, so a capsule built from it tells the planner the path exists on no
// side and then asks for a patch there — rejected on arrival, every round.
func TestPartitionSubmoduleConflictPathsSeparatesGitlinks(t *testing.T) {
	topology := hostrepo.Topology{Submodules: []hostrepo.Submodule{{Path: "mod/app"}}}
	submodulePaths, resolvable := partitionSubmoduleConflictPaths(topology, []string{"README.md", "mod/app", "mod/app/lib.txt"})
	if len(submodulePaths) != 2 || !strings.Contains(strings.Join(submodulePaths, ","), "mod/app") {
		t.Fatalf("expected both submodule paths partitioned out, got %v", submodulePaths)
	}
	if len(resolvable) != 1 || resolvable[0] != "README.md" {
		t.Fatalf("expected only README.md left for a planner, got %v", resolvable)
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
