package app

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
)

func pendingWithVerification(planID string, commands ...domain.CommandSpec) domain.PendingHostChange {
	return domain.PendingHostChange{Plan: domain.ExecutionPlan{PlanID: planID, Verification: commands}}
}

func TestIntegrationVerificationRunsEachDistinctGateOnce(t *testing.T) {
	// Three queued frontend candidates repeating the same gates turned one
	// integration pass into a dozen command runs against an identical merged
	// workspace. Each distinct gate must run once, owned by the first
	// candidate that declared it, so the baseline comparison stays anchored
	// to the smallest prefix.
	lint := domain.CommandSpec{Argv: []string{"npm", "run", "lint"}, Cwd: "services/frontend", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}
	build := domain.CommandSpec{Argv: []string{"npm", "run", "build"}, Cwd: "services/frontend", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}
	// Same argv, different envelope: still the same gate.
	lintSlower := domain.CommandSpec{Argv: []string{"npm", "run", "lint"}, Cwd: "services/frontend", TimeoutSeconds: 900, ExpectedExitCodes: []int{0}}
	// Same argv, different cwd: a genuinely different gate.
	backendLint := domain.CommandSpec{Argv: []string{"npm", "run", "lint"}, Cwd: "services/desktop", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}
	tests := domain.CommandSpec{Argv: []string{"npm", "test", "--", "--run", "src/styles.test.ts"}, Cwd: "services/frontend", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}

	pending := []domain.PendingHostChange{
		pendingWithVerification("plan-one", lint, build),
		pendingWithVerification("plan-two", lintSlower, build, tests),
		pendingWithVerification("plan-three", build, backendLint),
	}

	runs := dedupedIntegrationVerifications(pending)
	if len(runs) != 4 {
		t.Fatalf("expected 4 distinct gates, got %d: %+v", len(runs), runs)
	}
	expected := []struct {
		index int
		argv  string
		cwd   string
	}{
		{0, "lint", "services/frontend"},
		{0, "build", "services/frontend"},
		{1, "test", "services/frontend"},
		{2, "lint", "services/desktop"},
	}
	for position, want := range expected {
		got := runs[position]
		if got.index != want.index {
			t.Fatalf("gate %d must be owned by the first candidate that declared it: got index %d, want %d", position, got.index, want.index)
		}
		if got.command.Cwd != want.cwd {
			t.Fatalf("gate %d cwd = %q, want %q", position, got.command.Cwd, want.cwd)
		}
		if !slices.Contains(got.command.Argv, want.argv) {
			t.Fatalf("gate %d argv = %v, want the %q gate", position, got.command.Argv, want.argv)
		}
	}
	// The winning `npm run lint` must be the first candidate's spec, not the
	// later candidate's slower envelope.
	if runs[0].command.TimeoutSeconds != 60 {
		t.Fatalf("the first declaration owns the gate; timeout = %d, want 60", runs[0].command.TimeoutSeconds)
	}
}

func TestIntegrationVerificationKeepsEveryGateWhenNothingRepeats(t *testing.T) {
	pending := []domain.PendingHostChange{
		pendingWithVerification("plan-one", domain.CommandSpec{Argv: []string{"go", "test", "./..."}, Cwd: "services/backend"}),
		pendingWithVerification("plan-two", domain.CommandSpec{Argv: []string{"npm", "run", "build"}, Cwd: "services/frontend"}),
	}
	if runs := dedupedIntegrationVerifications(pending); len(runs) != 2 {
		t.Fatalf("distinct gates must all survive, got %d", len(runs))
	}
	if runs := dedupedIntegrationVerifications(nil); len(runs) != 0 {
		t.Fatalf("no pending changes means no gates, got %d", len(runs))
	}
}

func mustRunGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
	return strings.TrimSpace(string(output))
}

// TestExtendConflictWithLiveDriftAddsAPathTheCapsuleNeverAuthorized
// reproduces the production incident behind ADR-0065's amendment: a conflict
// thread opened for one file, then the host moved a second, unrelated file
// out of sync with the same candidate commit before the resolution round
// replayed. The stale capsule only ever named the first path; the fix is
// reading the live drift straight from Git instead of trusting that snapshot.
func TestExtendConflictWithLiveDriftAddsAPathTheCapsuleNeverAuthorized(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	repo := t.TempDir()
	mustRunGit(t, repo, "init", "-q")
	mustRunGit(t, repo, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "root")
	baseSHA := mustRunGit(t, repo, "rev-parse", "HEAD")

	if err := os.WriteFile(filepath.Join(repo, "a.txt"), []byte("base-a\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "b.txt"), []byte("base-b\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustRunGit(t, repo, "add", "a.txt", "b.txt")
	mustRunGit(t, repo, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "seed")

	// The candidate: changes both files relative to baseSHA.
	if err := os.WriteFile(filepath.Join(repo, "a.txt"), []byte("candidate-a\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "b.txt"), []byte("candidate-b\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustRunGit(t, repo, "commit", "-qam", "candidate")
	candidateSHA := mustRunGit(t, repo, "rev-parse", "HEAD")

	// The host: moved on independently from the same seed, conflicting on
	// BOTH files — but only "a.txt" is what an earlier round already opened
	// a conflict thread for.
	mustRunGit(t, repo, "checkout", "-q", "-b", "host", "HEAD~1")
	if err := os.WriteFile(filepath.Join(repo, "a.txt"), []byte("host-a\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "b.txt"), []byte("host-b\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustRunGit(t, repo, "commit", "-qam", "host drift")
	hostSHA := mustRunGit(t, repo, "rev-parse", "HEAD")

	conflict := &domain.ConflictResolution{
		ID: "conflict-1", Paths: []string{"a.txt"},
		PathSources: map[string]domain.ConflictPathSource{
			"a.txt": {PlanID: "plan-1", CandidateSHA: candidateSHA, MergeBaseSHA: baseSHA},
		},
	}

	extended := extendConflictWithLiveDrift(context.Background(), repo, hostSHA, conflict)
	if len(extended.Paths) != 2 {
		t.Fatalf("expected the live drift on b.txt to be folded in, got paths=%v", extended.Paths)
	}
	source, ok := extended.PathSources["b.txt"]
	if !ok {
		t.Fatal("the newly discovered path must get a usable ConflictPathSource")
	}
	if source.CandidateSHA != candidateSHA || source.MergeBaseSHA != baseSHA {
		t.Fatalf("a drifted path must reuse the one candidate's own commit/base, got %+v", source)
	}

	item := domain.Session{ProjectPath: repo, IntegrationConflict: conflict}
	if !(&Service{}).conflictNeedsCapsuleExtension(context.Background(), item) {
		t.Fatal("conflictNeedsCapsuleExtension must report the same drift refreshConflictCapsule would act on")
	}
}

func TestExtendConflictWithLiveDriftLeavesAnUnchangedPathSetAlone(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	repo := t.TempDir()
	mustRunGit(t, repo, "init", "-q")
	mustRunGit(t, repo, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "root")
	baseSHA := mustRunGit(t, repo, "rev-parse", "HEAD")

	if err := os.WriteFile(filepath.Join(repo, "a.txt"), []byte("base-a\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustRunGit(t, repo, "add", "a.txt")
	mustRunGit(t, repo, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid", "commit", "-qm", "seed")

	if err := os.WriteFile(filepath.Join(repo, "a.txt"), []byte("candidate-a\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	mustRunGit(t, repo, "commit", "-qam", "candidate")
	candidateSHA := mustRunGit(t, repo, "rev-parse", "HEAD")
	hostSHA := mustRunGit(t, repo, "rev-parse", "HEAD~1") // host never diverged further

	conflict := &domain.ConflictResolution{
		ID: "conflict-1", Paths: []string{"a.txt"},
		PathSources: map[string]domain.ConflictPathSource{
			"a.txt": {PlanID: "plan-1", CandidateSHA: candidateSHA, MergeBaseSHA: baseSHA},
		},
	}
	extended := extendConflictWithLiveDrift(context.Background(), repo, hostSHA, conflict)
	if len(extended.Paths) != 1 {
		t.Fatalf("a merge that only conflicts where the thread already knows must not grow the path set, got %v", extended.Paths)
	}
}
