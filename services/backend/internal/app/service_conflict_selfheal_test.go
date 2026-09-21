package app

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func candidateFor(requestID, planID string, paths ...string) domain.PendingHostChange {
	operations := make([]domain.Operation, 0, 1)
	if len(paths) > 0 {
		patch := ""
		for _, path := range paths {
			patch += "--- a/" + path + "\n+++ b/" + path + "\n@@ -1 +1 @@\n-old\n+new\n"
		}
		operations = append(operations, domain.Operation{Type: "apply_patch", Patch: patch})
	}
	return domain.PendingHostChange{Plan: domain.ExecutionPlan{
		PlanID: planID, RequestID: requestID, ImpactFiles: paths, Operations: operations,
	}}
}

// The exact shape a real chat reached: the original candidate plus two
// conflict-resolution rounds for the same file, all still pending. Three
// candidates claiming one path cannot be reconciled by any merge, so every
// later Apply reproduced the same collision.
func TestSupersededConflictResolutionRetiresEarlierRoundsOfTheSameThread(t *testing.T) {
	item := domain.Session{RequestLineages: map[string]domain.RequestLineage{
		"req-original": {RequestID: "req-original", Kind: requestKindStandard},
		"req-r2":       {RequestID: "req-r2", ParentRequestID: "req-original", Kind: requestKindConflict},
		"req-r3":       {RequestID: "req-r3", ParentRequestID: "req-r2", Kind: requestKindConflict},
	}}
	pending := []domain.PendingHostChange{
		candidateFor("req-original", "plan-original", "services/frontend/src/styles.css", "services/frontend/src/App.tsx"),
		candidateFor("req-r2", "plan-r2", "services/frontend/src/styles.css"),
		candidateFor("req-r3", "plan-r3", "services/frontend/src/styles.css"),
	}

	superseded := supersededConflictResolution(item, pending)
	if superseded == nil {
		t.Fatal("expected the earlier rounds of this conflict thread to be superseded")
	}
	if len(superseded.Paths) != 1 || superseded.Paths[0] != "services/frontend/src/styles.css" {
		t.Fatalf("only the resolved path may be retired, got %v", superseded.Paths)
	}
	// Both earlier links must be retired: retiring only the nearest one leaves
	// the original still claiming the same file.
	assertContains(t, superseded.OriginalPlanIDs, "plan-original")
	assertContains(t, superseded.OriginalPlanIDs, "plan-r2")
	if containsString(superseded.OriginalPlanIDs, "plan-r3") {
		t.Fatal("the newest resolution must never retire itself")
	}
}

// AGENTS.md is explicit that whether two changes combine is decided by a real
// three-way merge, never by impact-file overlap. Two unrelated candidates that
// happen to touch one file must therefore be left alone.
func TestSupersededConflictResolutionIgnoresUnrelatedCandidatesSharingAPath(t *testing.T) {
	item := domain.Session{RequestLineages: map[string]domain.RequestLineage{
		"req-a": {RequestID: "req-a", Kind: requestKindStandard},
		"req-b": {RequestID: "req-b", Kind: requestKindStandard},
	}}
	pending := []domain.PendingHostChange{
		candidateFor("req-a", "plan-a", "shared.go"),
		candidateFor("req-b", "plan-b", "shared.go"),
	}

	if superseded := supersededConflictResolution(item, pending); superseded != nil {
		t.Fatalf("independent candidates must stay a real merge, got retirement of %v", superseded.Paths)
	}
}

// A candidate promoted from a legacy ChangeSet onto a Git-native integration
// branch carries both representations. Retirement used to filter the ChangeSet
// and stop there, leaving untouched the branch Apply actually merges — so it
// reported success while changing nothing that mattered, and that candidate
// collided on the very same path on every later Apply no matter how many
// resolutions arrived. This is what made one real chat unresolvable for hours.
func TestRetireConflictingMutationsNarrowsTheBranchNotOnlyTheChangeSet(t *testing.T) {
	change := candidateFor("req-original", "plan-original", "services/frontend/src/styles.css")
	change.IntegrationBranch = "whx/req-original"
	change.IntegrationCommit = "531d0e5"
	change.ChangeSet = &domain.ChangeSet{ID: "chg-1", Mutations: []domain.FileMutation{
		{Path: "services/frontend/src/styles.css"},
	}}

	remaining, retiredBranches, err := retireConflictingMutations(
		context.Background(), t.TempDir(), "base-sha", []domain.PendingHostChange{change},
		&domain.ConflictResolution{
			Paths:           []string{"services/frontend/src/styles.css"},
			OriginalPlanIDs: []string{"plan-original"},
		})
	if err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 0 {
		t.Fatalf("a candidate whose every path was superseded must not stay pending: %#v", remaining)
	}
	// The branch is the part that matters: leaving it behind is exactly how the
	// same collision came back on every Apply.
	if len(retiredBranches) != 1 || retiredBranches[0] != "whx/req-original" {
		t.Fatalf("the integration branch was not retired: %v", retiredBranches)
	}
}

// TestRecordHostApplyFailureNamesInfrastructureCauses reproduces a real chat
// that stopped dead: its self-evolution host build was OOM-killed
// (`signal: killed`), Apply recorded the raw message and returned, and the
// session stayed in `verified` holding a verified candidate with no failure
// kind, no published remedy and nothing that would ever retry. It looked idle
// while being permanently stuck. The execution path already classifies exactly
// this cause; Apply must too, or the operator is never told what stopped it.
func TestRecordHostApplyFailureNamesInfrastructureCauses(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	verified, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "verified"
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	failure := errors.New("self-evolution host build failed: signal: killed\n[deps] backend: cache hit")
	updated, err := service.recordHostApplyFailure(verified.ID, "plan-1", failure, 0)
	if err != nil {
		t.Fatal(err)
	}
	if updated.FailureKind != domain.FailureKindSandboxResourceExhausted {
		t.Fatalf("an OOM-killed host build must be named as infrastructure, got %q", updated.FailureKind)
	}
	if updated.LastRepairError == "" {
		t.Fatal("the cause must stay readable to the operator")
	}
	// The candidate really is verified and really can be applied again once the
	// host condition clears, so naming the cause must not cost it its way back.
	if updated.State != "verified" {
		t.Fatalf("classifying must not move the session out of its retryable state: %q", updated.State)
	}
}

// TestRetireAlreadyIntegratedCandidatesMakesApplyIdempotent reproduces the
// stall that left a chat holding work the host already had: the merge landed,
// the self-evolution rebuild that follows was OOM-killed, and the candidate
// stayed pending — so every later Apply would merge an already-merged branch
// and rerun that same expensive rebuild. Containment must be proven by Git
// ancestry, never inferred from the failure.
func TestRetireAlreadyIntegratedCandidatesMakesApplyIdempotent(t *testing.T) {
	requireGitBinary(t)
	root := t.TempDir()
	runGitForTest(t, root, "init", "-q")
	if err := os.WriteFile(filepath.Join(root, "f.txt"), []byte("one\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitForTest(t, root, "add", "f.txt")
	runGitForTest(t, root, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "commit", "-qm", "landed")
	landed := strings.TrimSpace(runGitForTest(t, root, "rev-parse", "HEAD"))

	integrated := candidateFor("req-landed", "plan-landed", "f.txt")
	integrated.IntegrationCommit = landed
	pendingStill := candidateFor("req-open", "plan-open", "g.txt")
	pendingStill.IntegrationCommit = "0000000000000000000000000000000000000000"

	kept, retired := retireAlreadyIntegratedCandidates(context.Background(), root, []domain.PendingHostChange{integrated, pendingStill})
	if len(retired) != 1 || retired[0].Plan.PlanID != "plan-landed" {
		t.Fatalf("the candidate the host already contains must be retired: %v", planIDsOf(retired))
	}
	if len(kept) != 1 || kept[0].Plan.PlanID != "plan-open" {
		t.Fatalf("a candidate the host does not contain must be kept: %#v", kept)
	}
}

// A settle the operator cannot see is not a settle: the applied summary is
// rendered only when both LastHostAppliedAt and LastAppliedChanges carry
// something, so flipping the state alone left the chat still displaying the
// failure that had stopped it — visually identical to being stuck.
func TestSettleAlreadyIntegratedApplyLeavesVisibleEvidence(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	seeded, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "verified"
		item.LastRepairError = "self-evolution host build failed: signal: killed"
		item.LastAppliedChanges = []domain.PendingHostChange{candidateFor("req-landed", "plan-landed", "f.txt")}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	settled, err := service.settleAlreadyIntegratedApply(seeded.ID, seeded)
	if err != nil {
		t.Fatal(err)
	}
	if settled.State != "applied" {
		t.Fatalf("expected the session to settle, got %q", settled.State)
	}
	if settled.LastHostAppliedAt.IsZero() || len(settled.LastAppliedChanges) == 0 {
		t.Fatalf("the settle must leave evidence the applied summary can render: at=%v changes=%d",
			settled.LastHostAppliedAt, len(settled.LastAppliedChanges))
	}
	if settled.LastRepairError != "" {
		t.Fatalf("a settled session must not keep advertising the failure that stopped it: %q", settled.LastRepairError)
	}
}

// TestRequestFailureRepairReachesAHostApplyFailure covers the second half of
// the same stall: an Apply failure leaves the session `verified` with a
// successful LastExecution, so every repair branch missed it and the operator
// was told "no repairable failure is available" while the failure was on
// screen. No correction could start — automatically or by hand.
func TestRequestFailureRepairReachesAHostApplyFailure(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	stalled, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "verified"
		item.LastRequestID = "req-applied"
		item.LastRepairError = "host apply failed: merge integration branch refused"
		item.LastExecution = &domain.ExecutionResult{PlanID: "plan-1", Success: true}
		item.PendingHostChanges = []domain.PendingHostChange{candidateFor("req-applied", "plan-1", "f.txt")}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// Without guidance the retry is refused, but by naming the real condition
	// rather than claiming there is nothing to repair.
	_, err = service.RequestFailureRepair(context.Background(), stalled.ID, "")
	if err == nil || strings.Contains(err.Error(), "no repairable failure is available") {
		t.Fatalf("an Apply failure must be reachable and named, got %v", err)
	}

	repaired, err := service.RequestFailureRepair(context.Background(), stalled.ID, "I freed disk space on the host.")
	if err != nil {
		t.Fatal(err)
	}
	if repaired.State != "awaiting_plan" || repaired.LastRequestID == stalled.LastRequestID {
		t.Fatalf("a guided Apply-failure repair did not start a fresh round: %#v", repaired.State)
	}
}

// An applied session with no record of what it applied renders as though it
// were still stuck on whatever failure preceded it. The evidence is recovered
// from the session's own successful execution, never invented — and a session
// that cannot prove what it applied is left untouched.
func TestRepairAppliedEvidenceRestoresWhatTheSessionApplied(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	completedAt := time.Date(2026, 9, 20, 20, 24, 26, 0, time.UTC)
	damaged, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "applied"
		item.Plan = &domain.ExecutionPlan{PlanID: "plan-1", RequestID: "req-1", Summary: "landed work"}
		item.LastExecution = &domain.ExecutionResult{PlanID: "plan-1", Success: true, CompletedAt: completedAt}
		item.LastAppliedChanges = nil
		item.LastHostAppliedAt = time.Time{}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	service.repairAppliedEvidence(damaged)

	repaired, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(repaired.LastAppliedChanges) != 1 || repaired.LastAppliedChanges[0].Plan.PlanID != "plan-1" {
		t.Fatalf("the applied change was not restored: %#v", repaired.LastAppliedChanges)
	}
	if !repaired.LastHostAppliedAt.Equal(completedAt) {
		t.Fatalf("the applied time must come from the session's own execution, got %v", repaired.LastHostAppliedAt)
	}

	// A session whose execution did not succeed proves nothing and is left alone.
	unproven, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.LastAppliedChanges = nil
		item.LastHostAppliedAt = time.Time{}
		item.LastExecution = &domain.ExecutionResult{PlanID: "plan-1", Success: false}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	service.repairAppliedEvidence(unproven)
	if after, _ := service.store.Get(started.ID); len(after.LastAppliedChanges) != 0 {
		t.Fatalf("evidence must never be invented for an unproven session: %#v", after.LastAppliedChanges)
	}
}

func requireGitBinary(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
}

func runGitForTest(t *testing.T, dir string, args ...string) string {
	t.Helper()
	output, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, output)
	}
	return string(output)
}

// A conflict record is cleared only by the exact request it was created for, so
// a thread that moved on left it behind forever — and because Apply refuses
// while any record exists, that orphan parked every later Apply permanently.
func TestOrphanedIntegrationConflictReleasesAParkedSession(t *testing.T) {
	orphaned := domain.Session{
		State:               "verified",
		LastRequestID:       "req-newer",
		IntegrationConflict: &domain.ConflictResolution{ID: "conflict-1", RequestID: "req-stale", Paths: []string{"TODO.md"}},
	}
	if !orphanedIntegrationConflict(orphaned) {
		t.Fatal("a conflict whose round can no longer arrive must be released")
	}

	// Every shape of a still-live conflict must keep blocking.
	live := orphaned
	live.PendingManualRequestIDs = []string{"req-stale"}
	if orphanedIntegrationConflict(live) {
		t.Fatal("a conflict with its own round still pending is live")
	}
	inFlight := orphaned
	inFlight.PlannerInFlight = true
	if orphanedIntegrationConflict(inFlight) {
		t.Fatal("a conflict with the planner in flight is live")
	}
	resolving := orphaned
	resolving.State = "conflict_resolution_pending"
	if orphanedIntegrationConflict(resolving) {
		t.Fatal("a session actively resolving is live")
	}
	sameRequest := orphaned
	sameRequest.LastRequestID = "req-stale"
	if orphanedIntegrationConflict(sameRequest) {
		t.Fatal("the conflict's own request is still the session's current one")
	}
	if orphanedIntegrationConflict(domain.Session{State: "verified"}) {
		t.Fatal("no conflict record means nothing to release")
	}
}
