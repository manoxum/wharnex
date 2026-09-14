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

func TestRejectSubmoduleWritesAdmitsInitializedSubmoduleRepositories(t *testing.T) {
	requireGitForApp(t)
	root := newAppRepoWithSubmodule(t, "mod/app")
	service := &Service{bus: audit.NewBus()}

	if err := service.rejectSubmoduleWrites(context.Background(), "session", root, planPatching("mod/app/lib.txt")); err != nil {
		t.Fatalf("initialized submodule must be routed as a repository candidate: %v", err)
	}
}

func TestRejectSubmoduleWritesRefusesUninitializedSubmodule(t *testing.T) {
	requireGitForApp(t)
	root := newAppRepoWithSubmodule(t, "mod/app")
	runGitForApp(t, root, "submodule", "deinit", "-f", "--", "mod/app")
	service := &Service{bus: audit.NewBus()}
	err := service.rejectSubmoduleWrites(context.Background(), "session", root, planPatching("mod/app/lib.txt"))
	if !errors.Is(err, ErrSubmoduleWrite) || !strings.Contains(err.Error(), "mod/app") {
		t.Fatalf("expected actionable uninitialized submodule refusal, got %v", err)
	}
}

func TestRootIntegrationPathsStagesGitlinkForNestedFiles(t *testing.T) {
	plan := planPatching("services/admin/client/app.js")
	paths := rootIntegrationPaths(plan, []domain.RepositoryIntegration{{Path: "services/admin"}})
	if len(paths) != 1 || paths[0] != "services/admin" {
		t.Fatalf("root write set = %v, want the submodule gitlink", paths)
	}
}

func TestUpgradeLegacyRepositoryIntegrationsCapturesSafeCheckoutIdentity(t *testing.T) {
	requireGitForApp(t)
	root := newAppRepoWithSubmodule(t, "services/app")
	appRoot := filepath.Join(root, "services", "app")
	base := gitIn(t, appRoot, "rev-parse", "HEAD")
	pending := []domain.PendingHostChange{{
		IntegrationBranch: "whx/req_legacy",
		SubmoduleIntegrations: []domain.RepositoryIntegration{{
			Path: "services/app", Branch: "whx/req_legacy", Commit: base,
		}},
	}}

	upgraded, changed, err := upgradeLegacyRepositoryIntegrations(context.Background(), root, pending)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || len(upgraded[0].SubmoduleIntegrations) != 1 {
		t.Fatalf("legacy repository identity was not upgraded: %+v", upgraded)
	}
	integration := upgraded[0].SubmoduleIntegrations[0]
	if integration.TargetBranch != "main" || integration.BaseCommit != base {
		t.Fatalf("recovered checkout identity = %+v, want main at %s", integration, base)
	}
	if pending[0].SubmoduleIntegrations[0].BaseCommit != "" {
		t.Fatal("upgrade mutated the store-owned input slice before persistence")
	}
}

func TestUpgradeLegacyRepositoryIntegrationsReconstructsDiscardedUnits(t *testing.T) {
	requireGitForApp(t)
	root := newAppRepoWithSubmodule(t, "services/app")
	appRoot := filepath.Join(root, "services", "app")
	base := gitIn(t, appRoot, "rev-parse", "HEAD")
	branch := "whx/req_discarded_units"
	runGitForApp(t, appRoot, "switch", "-c", branch)
	if err := os.WriteFile(filepath.Join(appRoot, "lib.txt"), []byte("content\ncandidate\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitForApp(t, appRoot, "add", "lib.txt")
	runGitForApp(t, appRoot, "commit", "-qm", "candidate")
	candidate := gitIn(t, appRoot, "rev-parse", "HEAD")
	runGitForApp(t, root, "switch", "-c", branch)
	runGitForApp(t, root, "add", "services/app")
	runGitForApp(t, root, "commit", "-qm", "record candidate gitlink")
	runGitForApp(t, root, "switch", "main")
	runGitForApp(t, appRoot, "switch", "main")

	pending := []domain.PendingHostChange{
		{IntegrationBranch: branch, Plan: *planPatching("services/app/lib.txt")},
	}
	upgraded, changed, err := upgradeLegacyRepositoryIntegrations(context.Background(), root, pending)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || len(upgraded[0].SubmoduleIntegrations) != 1 {
		t.Fatalf("discarded repository units were not reconstructed: %+v", upgraded)
	}
	integration := upgraded[0].SubmoduleIntegrations[0]
	if integration.Path != "services/app" || integration.Branch != branch || integration.Commit != candidate {
		t.Fatalf("reconstructed candidate does not match its exact local refs: %+v", integration)
	}
	if integration.TargetBranch != "main" || integration.BaseCommit != base {
		t.Fatalf("reconstructed checkout identity = %+v, want main at %s", integration, base)
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
