package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/changeset"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/selfevolution"
	"kernl.local/harness/backend/internal/session"
)

func TestHostApplicablePendingChangesDropsVerificationOnlyPlans(t *testing.T) {
	patch := "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n"
	changes := []domain.PendingHostChange{
		{Plan: domain.ExecutionPlan{PlanID: "verify-only", Verification: []domain.CommandSpec{appCommand("false")}}},
		{Plan: domain.ExecutionPlan{PlanID: "patch", Operations: []domain.Operation{{Type: "apply_patch", Patch: patch}}}},
	}
	filtered := hostApplicablePendingChanges(changes)
	if len(filtered) != 1 || filtered[0].Plan.PlanID != "patch" {
		t.Fatalf("verification-only plan polluted host candidate: %#v", filtered)
	}
}

func TestLegacyRemoteInputFailureIsClassifiedAsTransportNotSourceRepair(t *testing.T) {
	item := domain.Session{LastRepairError: "Remote input communication failed: bundle download timed out"}
	if got := sessionFailureKind(item); got != domain.FailureKindRemoteInputTransport {
		t.Fatalf("sessionFailureKind()=%q want %q", got, domain.FailureKindRemoteInputTransport)
	}
}

func TestServiceStartupMigratesPersistedSubmoduleRefusalFromTransport(t *testing.T) {
	store := session.NewStore()
	item := domain.Session{
		ID:              "ses-submodule-migration",
		ProjectPath:     t.TempDir(),
		State:           "failed",
		FailureKind:     domain.FailureKindRemoteInputTransport,
		LastRepairError: "Remote input communication failed: " + ErrSubmoduleWrite.Error() + ": services/admin/file.ts belongs to services/admin",
	}
	if err := store.Put(item); err != nil {
		t.Fatal(err)
	}

	_ = NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	updated, err := store.Get(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.FailureKind != domain.FailureKindSubmoduleWrite {
		t.Fatalf("failure kind = %q want %q", updated.FailureKind, domain.FailureKindSubmoduleWrite)
	}
	if updated.LastRepairError != item.LastRepairError {
		t.Fatalf("startup migration must preserve diagnostic prose: %q", updated.LastRepairError)
	}
}

func TestServiceStartupNormalizesThePendingHostCandidateExposedToClients(t *testing.T) {
	store := session.NewStore()
	patch := "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n"
	item := domain.Session{
		ID: "ses-pending-normalization", ProjectPath: t.TempDir(), State: "verified",
		PendingHostChanges: []domain.PendingHostChange{
			{Plan: domain.ExecutionPlan{PlanID: "verify-only", Verification: []domain.CommandSpec{appCommand("false")}}},
			{Plan: domain.ExecutionPlan{PlanID: "patch", Operations: []domain.Operation{{Type: "apply_patch", Patch: patch}}}},
		},
	}
	if err := store.Put(item); err != nil {
		t.Fatal(err)
	}
	_ = NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	updated, err := store.Get(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.PendingHostChanges) != 1 || updated.PendingHostChanges[0].Plan.PlanID != "patch" {
		t.Fatalf("public pending candidate was not normalized: %#v", updated.PendingHostChanges)
	}
}

func TestLocalCoordinationFailuresNeverClassifyAsSourceRepair(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"self evolution busy", selfevolution.ErrBusy, domain.FailureKindSelfEvolutionBusy},
		{"self evolution metadata", selfevolution.ErrTransactionMetadataMismatch, domain.FailureKindSelfEvolutionMetadata},
		{"host dependency state", errHostDependencyState, domain.FailureKindHostDependencyState},
		{"stale host baseline", ErrStaleHostBaseline, domain.FailureKindStaleHostBaseline},
		{"integration race", ErrHostIntegrationRace, domain.FailureKindHostIntegrationRace},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := classifyExecutionFailure(tc.err); got != tc.want {
				t.Fatalf("classifyExecutionFailure()=%q want %q", got, tc.want)
			}
		})
	}
}

func TestPlannerLocalCoordinationReasonsDoNotRequestFreshGPTTurn(t *testing.T) {
	cases := map[string]string{
		"host_build_toolchain_mismatch":                domain.FailureKindHostBuildToolchain,
		"host_dependency_state":                        domain.FailureKindHostDependencyState,
		"self_evolution_transaction_busy":              domain.FailureKindSelfEvolutionBusy,
		"self_evolution_transaction_metadata_mismatch": domain.FailureKindSelfEvolutionMetadata,
		"stale_pending_baseline":                       domain.FailureKindStaleHostBaseline,
		"host_integration_race":                        domain.FailureKindHostIntegrationRace,
	}
	for reason, want := range cases {
		outcome := &domain.TurnOutcome{Status: domain.TurnOutcomeFailed, ReasonCode: reason, Retryable: true}
		if got := classifyPlannerOutcomeFailure(outcome); got != want {
			t.Fatalf("reason %s classified as %q want %q", reason, got, want)
		}
	}
}

func TestRolldownNativeBindingFailureIsHostDependencyState(t *testing.T) {
	diagnostic := `Error: Cannot find native binding. npm has a bug related to optional dependencies.
Caused by: Cannot find module '@rolldown/binding-linux-x64-musl'
Require stack: /workspace/node_modules/rolldown/dist/shared/binding.mjs`
	wrapped := wrapHostDependencyState(errors.New("post-merge verification failed: npm run build"), diagnostic)
	if !errors.Is(wrapped, errHostDependencyState) {
		t.Fatalf("rolldown native binding failure was not wrapped: %v", wrapped)
	}
	if got := classifyExecutionFailure(wrapped); got != domain.FailureKindHostDependencyState {
		t.Fatalf("host dependency failure classified as %q", got)
	}
}

func TestHostDependencyPlannerOutcomeStopsFreshRequestRecovery(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "fix feature")
	if err != nil {
		t.Fatal(err)
	}
	requestID := prompted.LastRequestID
	seedFailedPlanForRepair(t, service, started.ID, requestID)
	bundle := makeFailedBundleWithReason(t, requestID, "host_dependency_state", true)
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", bundle)
	if err != nil {
		t.Fatal(err)
	}
	if result.RemoteRecoveryPrepared || result.Session.RemoteRecoveryAttempt != 0 {
		t.Fatalf("host dependency state must not start another GPT request: %#v", result)
	}
	if result.Session.FailureKind != domain.FailureKindHostDependencyState {
		t.Fatalf("failure kind = %q", result.Session.FailureKind)
	}
}

func TestPrepareRepairRequestBlocksHostDependencyState(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	cause := errors.Join(errHostDependencyState, errors.New("post-merge verification failed: npm run build"))
	updated, err := service.prepareRepairRequest(context.Background(), started.ID, domain.ExecutionResult{PlanID: "plan-host-deps"}, cause)
	if err != nil {
		t.Fatal(err)
	}
	if updated.State == "repair_pending" {
		t.Fatal("host dependency state must not be routed into the GPT repair loop")
	}
	if updated.FailureKind != domain.FailureKindHostDependencyState {
		t.Fatalf("failure kind = %q", updated.FailureKind)
	}
	if updated.RepairAttempt != 0 {
		t.Fatalf("repair attempt should not be consumed, got %d", updated.RepairAttempt)
	}
}

func TestStageHostIntegrationAcceptsUnchangedBaselineVerificationFailure(t *testing.T) {
	root := t.TempDir()
	baseRoot := t.TempDir()
	resultRoot := t.TempDir()
	for _, dir := range []string{root, baseRoot} {
		if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("old\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(resultRoot, "a.txt"), []byte("new\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	set, err := changeset.Materialize("cs-one", "base", baseRoot, resultRoot, []string{"a.txt"})
	if err != nil {
		t.Fatal(err)
	}
	bus := audit.NewBus()
	runner := sandbox.NewLocalRunner()
	service := &Service{runner: runner, bus: bus}
	pending := []domain.PendingHostChange{{
		Plan:      domain.ExecutionPlan{PlanID: "plan-one", Verification: []domain.CommandSpec{{Argv: []string{"false"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}}},
		Execution: domain.ExecutionResult{PlanID: "plan-one", Success: true, CompletedAt: time.Now().UTC()},
		ChangeSet: &set,
	}}
	staged, err := service.stageHostIntegration(context.Background(), "ses-one", domain.Session{ProjectPath: root}, pending)
	if err != nil {
		t.Fatalf("unchanged baseline failure rejected cumulative candidate: %v", err)
	}
	defer runner.Cleanup(staged.workspace)
	if staged.prepared.Outcome != domain.IntegrationReady {
		t.Fatalf("unexpected integration outcome %s", staged.prepared.Outcome)
	}
	found := false
	for _, event := range bus.History("ses-one") {
		if event.Type == "integration.verification_baseline_unchanged" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing baseline-unchanged integration evidence")
	}
}

func TestLegacyFailureKindRecognizesPersistedPingPongCauses(t *testing.T) {
	cases := []struct {
		detail string
		want   string
	}{
		{selfevolution.ErrBusy.Error(), domain.FailureKindSelfEvolutionBusy},
		{"Planner reported failed: self_evolution_transaction_metadata_mismatch: Protected verification passed, but Host Apply cannot start because persisted metadata is inconsistent.", domain.FailureKindSelfEvolutionMetadata},
		{"Planner reported failed: host_dependency_state: node_modules incomplete", domain.FailureKindHostDependencyState},
		{"host apply blocked by stale baseline: old vs new", domain.FailureKindStaleHostBaseline},
		{ErrHostIntegrationRace.Error() + ": external write race", domain.FailureKindHostIntegrationRace},
	}
	for _, tc := range cases {
		for _, item := range []domain.Session{
			{LastRepairError: tc.detail},
			{LastExecution: &domain.ExecutionResult{Error: tc.detail}},
		} {
			if got := sessionFailureKind(item); got != tc.want {
				t.Fatalf("sessionFailureKind(%q)=%q want %q", tc.detail, got, tc.want)
			}
		}
	}
}

func TestServiceStartupBackfillsPersistedSelfEvolutionMetadataFailure(t *testing.T) {
	store := session.NewStore()
	item := domain.Session{
		ID:              "ses-stuck-metadata",
		ProjectPath:     t.TempDir(),
		State:           "failed",
		LastRepairError: "Planner reported failed: self_evolution_transaction_metadata_mismatch: Protected verification passed, but Host Apply cannot start because persisted metadata is inconsistent.",
	}
	if err := store.Put(item); err != nil {
		t.Fatal(err)
	}
	_ = NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	updated, err := store.Get(item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.FailureKind != domain.FailureKindSelfEvolutionMetadata {
		t.Fatalf("failure kind = %q", updated.FailureKind)
	}
	if updated.LastRepairError != item.LastRepairError {
		t.Fatalf("startup normalization must preserve diagnostic prose: %q", updated.LastRepairError)
	}
}

func TestRetryableStaleBaselineOutcomeDoesNotStartAnotherGPTRequest(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "continue verified candidate")
	if err != nil {
		t.Fatal(err)
	}
	requestID := prompted.LastRequestID
	seedFailedPlanForRepair(t, service, started.ID, requestID)
	bundle := makeFailedBundleWithReason(t, requestID, "stale_pending_baseline", true)
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", bundle)
	if err != nil {
		t.Fatal(err)
	}
	if result.RemoteRecoveryPrepared || result.Session.RemoteRecoveryAttempt != 0 {
		t.Fatalf("stale baseline must not start another GPT request: %#v", result)
	}
	if result.Session.FailureKind != domain.FailureKindStaleHostBaseline {
		t.Fatalf("failure kind = %q", result.Session.FailureKind)
	}
}

func TestClassifiedLocalFailureIsWrappedSafely(t *testing.T) {
	wrapped := errors.New("outer")
	if errors.Is(wrapped, ErrHostIntegrationRace) {
		t.Fatal("sanity check failed")
	}
	cause := errors.Join(ErrHostIntegrationRace, wrapped)
	if got := classifyExecutionFailure(cause); got != domain.FailureKindHostIntegrationRace {
		t.Fatalf("wrapped integration race classified as %q", got)
	}
}

func TestReverifyPendingCandidateAcceptsUnchangedBaselineVerificationFailure(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	patch := "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n"
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "reverify-debt", RequestID: "req-reverify-debt", Status: "ready", Summary: "reverify", Risk: "low",
		Operations:   []domain.Operation{{Type: "apply_patch", Patch: patch}},
		Verification: []domain.CommandSpec{{Argv: []string{"npm", "run", "build"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}},
	}
	runner := &verificationDebtRunner{baselineSame: true}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan: plan}, policy.NewEngine(), runner)
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	pending := []domain.PendingHostChange{{Plan: plan, Execution: domain.ExecutionResult{PlanID: plan.PlanID, Success: true}}}
	updated, err := service.reverifyPendingCandidate(context.Background(), started.ID, started, pending, strings.Repeat("a", 64))
	if err != nil {
		t.Fatalf("unchanged baseline verification debt blocked stale revalidation: %v", err)
	}
	if updated.State != "verified" || len(updated.PendingHostChanges) != 1 {
		t.Fatalf("candidate was not retained as verified: state=%s pending=%d", updated.State, len(updated.PendingHostChanges))
	}
	found := false
	for _, event := range service.bus.History(started.ID) {
		if event.Type == "baseline.reverify_failure_unchanged" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("missing stale revalidation baseline-debt evidence")
	}
}

type canceledExitRunner struct{}

func (canceledExitRunner) Prepare(context.Context, string) (sandbox.Workspace, error) {
	return sandbox.Workspace{Path: "/tmp/canceled"}, nil
}
func (canceledExitRunner) ApplyPatch(context.Context, sandbox.Workspace, string) (domain.CommandResult, error) {
	return domain.CommandResult{ExitCode: 0, Success: true}, nil
}
func (canceledExitRunner) Run(_ context.Context, _ sandbox.Workspace, command domain.CommandSpec) (domain.CommandResult, error) {
	return domain.CommandResult{Argv: command.Argv, Cwd: command.Cwd, ExitCode: -1, Success: false}, nil
}
func (canceledExitRunner) Cleanup(sandbox.Workspace) error { return nil }

func TestCanceledCommandExitMinusOneIsNotTreatedAsSourceRegression(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	service := &Service{bus: audit.NewBus()}
	_, err := service.runCommandWithRunner(ctx, "ses-canceled", canceledExitRunner{}, sandbox.Workspace{Path: "/tmp/canceled"}, appCommand("npm", "run", "typecheck"), "sandbox")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled exit -1 returned %v", err)
	}
	if got := classifyExecutionFailure(fmt.Errorf("verification failed: %w", err)); got != domain.FailureKindExecutionCanceled {
		t.Fatalf("canceled execution classified as %q", got)
	}
}
