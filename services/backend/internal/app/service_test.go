package app

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/projectconfig"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/selfevolution"
	"kernl.local/harness/backend/internal/session"
)

func appCommand(argv ...string) domain.CommandSpec {
	return domain.CommandSpec{Argv: argv, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}
}

type fakePlanner struct{ plan domain.ExecutionPlan }

func (f fakePlanner) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	plan := f.plan
	plan.RequestID = request.RequestID
	if plan.VersionIncrement == nil {
		plan.VersionIncrement = &domain.VersionIncrement{Component: domain.VersionComponentPatch, Amount: 1}
	}
	return planner.Result{Plan: &plan}, nil
}

type fakeTurnPlanner struct{ turn domain.AgentTurn }

func (f fakeTurnPlanner) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	turn := f.turn
	turn.RequestID = request.RequestID
	return planner.Result{Turn: &turn}, nil
}

func TestAnswerTurnDoesNotCreateExecutionPlan(t *testing.T) {
	root := t.TempDir()
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, Kind: domain.TurnKindAnswer, Message: "Esta opção mantém 12 meses de histórico.", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakeTurnPlanner{turn}, policy.NewEngine(), fakeRunner{})
	s, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	result, updated, err := service.SubmitMessage(context.Background(), s.ID, "Para que serve esta opção?")
	if err != nil {
		t.Fatal(err)
	}
	if result.Turn == nil || updated.LastTurn == nil || updated.State != "answered" || updated.Plan != nil || updated.LastExecution != nil {
		t.Fatalf("answer entered the planning pipeline: result=%#v session=%#v", result, updated)
	}
}

func TestProviderFailedOutcomeMarksRequestFailedWithoutExecution(t *testing.T) {
	root := t.TempDir()
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, Kind: domain.TurnKindBlocked, Message: "Não consegui concluir.", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeFailed, ReasonCode: "tool_unavailable", Message: "A ferramenta necessária não respondeu.", Retryable: true}}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakeTurnPlanner{turn}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, updated, err := service.SubmitMessage(context.Background(), started.ID, "Analisa o projeto")
	if err != nil {
		t.Fatal(err)
	}
	if updated.State != "failed" || updated.Plan != nil || updated.LastExecution != nil || !strings.Contains(updated.LastRepairError, "tool_unavailable") {
		t.Fatalf("provider failure was presented as success: %#v", updated)
	}
}

func TestServiceStartupDoesNotRewriteNormalizedSelfEvolutionSessions(t *testing.T) {
	root := t.TempDir()
	for _, relative := range []string{"Makefile", "scripts/start.sh", "services/backend/go.mod", "services/desktop/package.json"} {
		path := filepath.Join(root, relative)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("fixture"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("WHARNESS_ROOT", root)
	statePath := filepath.Join(t.TempDir(), "sessions.json")
	store, err := session.NewPersistentStore(statePath)
	if err != nil {
		t.Fatal(err)
	}
	item := domain.Session{ID: "ses_normalized", ProjectPath: root, ExecutionMode: domain.ExecutionModeProtected, AutomationMode: domain.AutomationModeAuto, SelfEvolution: true, State: "ready", CreatedAt: time.Now().UTC()}
	if err := store.Put(item); err != nil {
		t.Fatal(err)
	}
	past := time.Unix(1, 0)
	if err := os.Chtimes(statePath, past, past); err != nil {
		t.Fatal(err)
	}
	NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), fakeRunner{})
	info, err := os.Stat(statePath)
	if err != nil {
		t.Fatal(err)
	}
	if !info.ModTime().Equal(past) {
		t.Fatalf("startup rewrote an already normalized self-evolution session: modtime=%s", info.ModTime())
	}
}

func TestAutoProviderChangeExecutesAndAppliesWithoutDownload(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "hello.txt")
	if err := os.WriteFile(path, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "provider-change", Status: "ready", Summary: "Replace the hello greeting text in the demo file", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n"}},
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), sandbox.NewLocalRunner())
	s, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, updated, err := service.SubmitMessage(context.Background(), s.ID, "Corrija hello.txt")
	if err != nil {
		t.Fatal(err)
	}
	if updated.State != "applied" || updated.LastExecution == nil || !updated.LastExecution.Success {
		t.Fatalf("provider change did not complete automatically: %#v", updated)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new\n" {
		t.Fatalf("provider change was not applied: %q", contents)
	}
}

type terminalTargetRunner struct {
	prepared string
	ran      bool
}

func (r *terminalTargetRunner) Prepare(_ context.Context, projectRoot string) (sandbox.Workspace, error) {
	r.prepared = projectRoot
	return sandbox.Workspace{Path: projectRoot, SourcePath: projectRoot}, nil
}
func (r *terminalTargetRunner) ApplyPatch(context.Context, sandbox.Workspace, string) (domain.CommandResult, error) {
	return domain.CommandResult{}, errors.New("unexpected patch")
}
func (r *terminalTargetRunner) Run(_ context.Context, _ sandbox.Workspace, command domain.CommandSpec) (domain.CommandResult, error) {
	r.ran = true
	return domain.CommandResult{Argv: command.Argv, Cwd: command.Cwd, ExitCode: 0, Stdout: "host-target", Success: true}, nil
}
func (r *terminalTargetRunner) Cleanup(sandbox.Workspace) error { return nil }

// fakeRunner delegates Prepare/ApplyPatch/Cleanup to a real LocalRunner (safe
// to call on the nil embedded pointer: LocalRunner has no fields and never
// dereferences its receiver), so verification produces a REAL Git-backed
// sandbox with the patch genuinely applied — required since ApplyToHost now
// commits verified changes onto a real integration branch (see
// internal/sandbox/gitintegration.go), which needs an actual repository and
// actual file content to commit. Run stays fake/canned: tests using this
// runner want a deterministic, instant "verification passed" without a real
// toolchain, not a real `go test`/`npm test` execution.
type fakeRunner struct{ *sandbox.LocalRunner }

func (fakeRunner) Run(_ context.Context, _ sandbox.Workspace, c domain.CommandSpec) (domain.CommandResult, error) {
	return domain.CommandResult{Argv: c.Argv, Cwd: c.Cwd, ExitCode: 0, Success: true}, nil
}

// RunStreaming must also be overridden and not merely inherited from the
// embedded *LocalRunner: LocalRunner implements sandbox.StreamingRunner, so
// without this override runCommandWithRunner's own type-assertion for that
// interface would silently prefer the REAL (promoted) RunStreaming over the
// fake Run above, running verification commands for real after all.
func (r fakeRunner) RunStreaming(ctx context.Context, workspace sandbox.Workspace, c domain.CommandSpec, _ sandbox.StreamCallback) (domain.CommandResult, error) {
	return r.Run(ctx, workspace, c)
}

type blockingPrepareRunner struct {
	sandbox.Runner
	once    sync.Once
	entered chan struct{}
	release chan struct{}
}

func (r *blockingPrepareRunner) Prepare(ctx context.Context, root string) (sandbox.Workspace, error) {
	r.once.Do(func() {
		close(r.entered)
		select {
		case <-r.release:
		case <-ctx.Done():
		}
	})
	return r.Runner.Prepare(ctx, root)
}

type streamingEventRunner struct{}

func (streamingEventRunner) Prepare(context.Context, string) (sandbox.Workspace, error) {
	return sandbox.Workspace{Path: "/tmp/streaming"}, nil
}
func (streamingEventRunner) ApplyPatch(context.Context, sandbox.Workspace, string) (domain.CommandResult, error) {
	return domain.CommandResult{}, errors.New("unexpected patch")
}
func (streamingEventRunner) Run(_ context.Context, _ sandbox.Workspace, c domain.CommandSpec) (domain.CommandResult, error) {
	return domain.CommandResult{Argv: c.Argv, Cwd: c.Cwd, ExitCode: 0, Stdout: "final output\n", Success: true}, nil
}
func (streamingEventRunner) RunStreaming(_ context.Context, _ sandbox.Workspace, c domain.CommandSpec, onOutput sandbox.StreamCallback) (domain.CommandResult, error) {
	onOutput("stdout", "live output\n")
	return domain.CommandResult{Argv: c.Argv, Cwd: c.Cwd, ExitCode: 0, Stdout: "live output\n", Success: true}, nil
}
func (streamingEventRunner) Cleanup(sandbox.Workspace) error { return nil }

type workflowEvidenceRunner struct{}

func (workflowEvidenceRunner) Prepare(context.Context, string) (sandbox.Workspace, error) {
	return sandbox.Workspace{Path: "/tmp/workflow"}, nil
}
func (workflowEvidenceRunner) ApplyPatch(context.Context, sandbox.Workspace, string) (domain.CommandResult, error) {
	return domain.CommandResult{}, errors.New("workflow must not apply patches")
}
func (workflowEvidenceRunner) Run(_ context.Context, _ sandbox.Workspace, c domain.CommandSpec) (domain.CommandResult, error) {
	return domain.CommandResult{Argv: c.Argv, Cwd: c.Cwd, ExitCode: 0, Stdout: "evidence: formatter supports csv and xlsx\n", Success: true}, nil
}
func (workflowEvidenceRunner) Cleanup(sandbox.Workspace) error { return nil }

func TestServicePlansAndExecutes(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "p1", RequestID: "r1", Status: "ready", Summary: "test", Risk: "low", Operations: []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"go", "test", "./..."}, Cwd: ".", TimeoutSeconds: 10, ExpectedExitCodes: []int{0}}}}}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), fakeRunner{})
	s, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	_, s, err = service.SubmitMessage(context.Background(), s.ID, "test")
	if err != nil {
		t.Fatal(err)
	}
	if s.Plan == nil {
		t.Fatal("expected plan")
	}
	result, _, err := service.Execute(context.Background(), s.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success {
		t.Fatal("expected success")
	}
}

func TestRejectExecutionPlanEndsUnstartedPlanWithoutRunningCommands(t *testing.T) {
	root := t.TempDir()
	plan := domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "reject-me", Status: "ready", Summary: "planned change", Document: "# Complete plan", Risk: "low"}
	runner := &terminalTargetRunner{}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), runner)
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	_, planned, err := service.SubmitMessage(context.Background(), started.ID, "prepare a change")
	if err != nil {
		t.Fatal(err)
	}
	if planned.Plan == nil || planned.State != "planned" {
		t.Fatalf("expected an unstarted plan, got %#v", planned)
	}
	rejected, err := service.RejectExecutionPlan(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rejected.State != "plan_rejected" || rejected.Plan != nil || rejected.Policy != nil || runner.ran {
		t.Fatalf("rejection changed execution state unexpectedly: session=%#v ran=%v", rejected, runner.ran)
	}
}

func TestAutoExecutionCannotBeExecutedAgain(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "auto-single-shot", RequestID: "r-auto", Status: "ready", Summary: "test", Risk: "low", Operations: []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"go", "test", "./..."}, Cwd: ".", TimeoutSeconds: 10, ExpectedExitCodes: []int{0}}}}}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, automated, err := service.SubmitMessage(context.Background(), started.ID, "test")
	if err != nil {
		t.Fatal(err)
	}
	if automated.LastExecution == nil || !automated.LastExecution.Success || automated.LastExecution.PlanID != plan.PlanID {
		t.Fatalf("auto mode should have executed the plan exactly once: %#v", automated.LastExecution)
	}
	if _, _, err := service.Execute(context.Background(), started.ID, false); err == nil || !strings.Contains(err.Error(), "already executed successfully") {
		t.Fatalf("completed auto plan must reject an explicit duplicate Execute, got %v", err)
	}
}

func TestExecutionPublishesLiveCommandOutput(t *testing.T) {
	root := t.TempDir()
	plan := domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "stream-plan", Status: "ready", Summary: "stream", Risk: "low", Operations: []domain.Operation{{Type: "command", Command: domain.CommandSpec{Argv: []string{"printf", "live"}, Cwd: ".", TimeoutSeconds: 5, ExpectedExitCodes: []int{0}}}}}
	bus := audit.NewBus()
	service := NewService(session.NewStore(), bus, contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), streamingEventRunner{})
	s, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.SubmitMessage(context.Background(), s.ID, "execute"); err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.Execute(context.Background(), s.ID, false); err != nil {
		t.Fatal(err)
	}
	for _, event := range bus.History(s.ID) {
		if event.Type == "command.output" && event.Data["stream"] == "stdout" && event.Data["text"] == "live output\n" {
			return
		}
	}
	t.Fatal("expected live command.output event")
}

func TestVerifiedPatchDoesNotTouchHostUntilApply(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "hello.txt")
	if err := os.WriteFile(path, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "patch-plan", RequestID: "placeholder", Status: "ready", Summary: "change hello", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n"}},
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), sandbox.NewLocalRunner())
	s, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = service.SubmitMessage(context.Background(), s.ID, "change")
	if err != nil {
		t.Fatal(err)
	}
	result, _, err := service.Execute(context.Background(), s.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success {
		t.Fatal("sandbox execution should pass")
	}
	before, _ := os.ReadFile(path)
	if string(before) != "old\n" {
		t.Fatalf("host changed before apply: %q", before)
	}
	if _, err := service.ApplyToHost(context.Background(), s.ID); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(path)
	if string(after) != "new\n" {
		t.Fatalf("host was not patched: %q", after)
	}
}

func TestConcurrentHostApplyReloadsCandidateAfterProjectLock(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "hello.txt")
	if err := os.WriteFile(path, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "concurrent-apply", RequestID: "placeholder", Status: "ready", Summary: "change hello", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n"}},
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.SubmitMessage(context.Background(), started.ID, "change"); err != nil {
		t.Fatal(err)
	}
	if result, _, executeErr := service.Execute(context.Background(), started.ID, false); executeErr != nil || !result.Success {
		t.Fatalf("prepare verified candidate: result=%#v err=%v", result, executeErr)
	}
	blocker := &blockingPrepareRunner{Runner: service.hostRunner, entered: make(chan struct{}), release: make(chan struct{})}
	service.hostRunner = blocker
	firstDone := make(chan error, 1)
	secondDone := make(chan error, 1)
	go func() {
		_, applyErr := service.ApplyToHost(context.Background(), started.ID)
		firstDone <- applyErr
	}()
	<-blocker.entered
	go func() {
		_, applyErr := service.ApplyToHost(context.Background(), started.ID)
		secondDone <- applyErr
	}()
	// Give the second caller time to read the still-verified session before it
	// blocks on the project apply lock. This is the real duplicate-delivery
	// ordering that previously replayed an already-consumed integration branch.
	time.Sleep(50 * time.Millisecond)
	close(blocker.release)
	if err := <-firstDone; err != nil {
		t.Fatalf("first Apply failed: %v", err)
	}
	if err := <-secondDone; !errors.Is(err, ErrExecutionRequired) {
		t.Fatalf("duplicate concurrent Apply must observe the consumed candidate, got %v", err)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new\n" {
		t.Fatalf("host change was not integrated exactly once: %q", contents)
	}
}

func TestVerifiedPatchCanBeExtendedByAnotherPatchBeforeHostApply(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "hello.txt")
	if err := os.WriteFile(path, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	first := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "pending-base", RequestID: "req-base", Status: "ready", Summary: "first pending change", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+middle\n"}},
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{first}, policy.NewEngine(), sandbox.NewLocalRunner())
	created, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.SubmitMessage(context.Background(), created.ID, "first"); err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.Execute(context.Background(), created.ID, false); err != nil {
		t.Fatal(err)
	}

	second := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "pending-fix", RequestID: "req-fix", Status: "ready", Summary: "extend pending change", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-middle\n+new\n"}},
	}
	decision := service.policy.Evaluate(second)
	if _, err = service.store.Update(created.ID, func(item *domain.Session) error {
		item.Plan = &second
		item.Policy = &decision
		item.State = "planned"
		item.LastExecution = nil
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if _, _, err = service.Execute(context.Background(), created.ID, false); err != nil {
		t.Fatalf("a second patch should execute on top of the verified pending change: %v", err)
	}
	if _, err = service.ApplyToHost(context.Background(), created.ID); err != nil {
		t.Fatalf("the cumulative pending change should apply to the host: %v", err)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new\n" {
		t.Fatalf("cumulative host apply produced %q", contents)
	}
}

func TestVerifiedChangeSetMergesIndependentExternalEditBeforeApply(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "file.txt")
	if err := os.WriteFile(path, []byte("one\nmiddle\nthree\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "merge-independent", Status: "ready", Summary: "change final line", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/file.txt\n+++ b/file.txt\n@@ -1,3 +1,3 @@\n one\n middle\n-three\n+THREE\n"}},
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.SubmitMessage(context.Background(), started.ID, "change final line"); err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.Execute(context.Background(), started.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("ONE\nmiddle\nthree\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err = service.ApplyToHost(context.Background(), started.ID); err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "ONE\nmiddle\nTHREE\n" {
		t.Fatalf("independent external edit was not preserved: %q", contents)
	}
}

func TestVerifiedChangeSetCreatesDedicatedConflictResolutionRequest(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "file.txt")
	if err := os.WriteFile(path, []byte("base\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "conflicting-plan", Status: "ready", Summary: "change value", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-base\n+task\n"}},
	}
	bus := audit.NewBus()
	service := NewService(session.NewStore(), bus, contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.SubmitMessage(context.Background(), started.ID, "change value"); err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.Execute(context.Background(), started.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("external\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	conflicted, err := service.ApplyToHost(context.Background(), started.ID)
	if !errors.Is(err, ErrIntegrationConflict) {
		t.Fatalf("expected focused integration conflict, got %v", err)
	}
	if conflicted.State != "conflict_resolution_pending" || conflicted.IntegrationConflict == nil || conflicted.LastManualPrompt == "" {
		t.Fatalf("dedicated conflict request was not prepared: %#v", conflicted)
	}
	if !strings.Contains(conflicted.LastManualPrompt, "harness.conflict/v1") || !strings.Contains(conflicted.LastManualPrompt, "file.txt") {
		t.Fatalf("conflict capsule missing from prompt: %q", conflicted.LastManualPrompt)
	}
	seen := false
	for _, event := range bus.History(started.ID) {
		if event.Type == "conflict.prompt_ready" && strings.Contains(fmt.Sprint(event.Data["surface_key"]), "_cf_") {
			seen = true
		}
	}
	if !seen {
		t.Fatal("dedicated conflict ChatGPT surface was not announced")
	}
	rejected, rejectErr := service.RejectPendingHostChanges(started.ID)
	if rejectErr != nil {
		t.Fatalf("explicit conflict cancellation failed: %v", rejectErr)
	}
	if rejected.IntegrationConflict != nil || len(rejected.PendingManualRequestIDs) != 0 || rejected.State != "ready" {
		t.Fatalf("conflict surface/request was not retired: %#v", rejected)
	}
	if contents, readErr := os.ReadFile(path); readErr != nil || string(contents) != "external\n" {
		t.Fatalf("cancelling conflict changed the host: %q err=%v", contents, readErr)
	}
}

func TestRetainedChangeSetReplayConflictCreatesDedicatedConflictResolutionRequest(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "file.txt")
	if err := os.WriteFile(path, []byte("base\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	first := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "retained-plan", RequestID: "req-retained", Status: "ready", Summary: "retain candidate", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-base\n+candidate\n"}},
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{first}, policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.SubmitMessage(context.Background(), started.ID, "retain candidate"); err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.Execute(context.Background(), started.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("external\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	refreshed, err := service.RefreshContext(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	requestID := "req-replacement"
	_, err = service.store.Update(started.ID, func(current *domain.Session) error {
		current.Plan = &domain.ExecutionPlan{
			Protocol: domain.ProtocolV1, PlanID: "replacement-plan", RequestID: requestID, BaseContextSHA256: refreshed.Context.Manifest.SHA256,
			Status: "ready", Summary: "replacement", Risk: "low", Operations: []domain.Operation{}, Verification: []domain.CommandSpec{},
		}
		current.Policy = &domain.PolicyDecision{Allowed: true, Risk: "low"}
		current.LastRequestID = requestID
		current.PendingManualRequestIDs = nil
		current.State = "planned"
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	_, conflicted, err := service.Execute(context.Background(), started.ID, false)
	if err == nil {
		t.Fatal("expected retained ChangeSet replay conflict")
	}
	if conflicted.State != "conflict_resolution_pending" || conflicted.IntegrationConflict == nil {
		t.Fatalf("retained replay conflict entered generic repair instead of focused conflict resolution: state=%s conflict=%#v", conflicted.State, conflicted.IntegrationConflict)
	}
	if !strings.Contains(conflicted.LastManualPrompt, "harness.conflict/v1") || !strings.Contains(conflicted.LastManualPrompt, "file.txt") {
		t.Fatalf("focused replay conflict capsule missing: %q", conflicted.LastManualPrompt)
	}
}

// TestConflictResolutionStopsAfterBoundedAttempts is a focused unit test of
// the exhaustion guard itself: a session whose IntegrationConflict already
// spent maxAutoRepairAttempts automatic rounds must not get yet another
// automatic conflict-resolution prompt prepared.
func TestConflictResolutionStopsAfterBoundedAttempts(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(context.Background(), t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	seeded, err := service.store.Update(started.ID, func(current *domain.Session) error {
		current.IntegrationConflict = &domain.ConflictResolution{ID: "conflict-existing", RequestID: "req-existing", Paths: []string{"file.txt"}}
		current.ConflictAttempt = maxAutoRepairAttempts
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	pendingBefore := len(seeded.PendingManualRequestIDs)

	updated, err := service.prepareConflictResolution(context.Background(), started.ID, seeded, nil, []domain.IntegrationConflictDetail{{Path: "file.txt", Reason: "merge conflict"}})
	if err != nil {
		t.Fatal(err)
	}
	if updated.State != "conflict_resolution_exhausted" {
		t.Fatalf("expected state conflict_resolution_exhausted, got %q", updated.State)
	}
	if len(updated.PendingManualRequestIDs) != pendingBefore {
		t.Fatalf("exhaustion must not create a new pending request: before=%d after=%d", pendingBefore, len(updated.PendingManualRequestIDs))
	}
	seen := false
	for _, event := range service.bus.History(started.ID) {
		if event.Type == "conflict.exhausted" {
			seen = true
		}
	}
	if !seen {
		t.Fatal("expected conflict.exhausted to be published")
	}
}

// TestActiveConflictBlocksRepeatedApply reproduces the incident in which a
// failed focused round cleared its transient request flags while the durable
// IntegrationConflict remained. Apply must key off the durable conflict and
// refuse to merge the stale original candidate again.
func TestActiveConflictBlocksRepeatedApply(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "file.txt")
	if err := os.WriteFile(path, []byte("base\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "conflicting-plan", Status: "ready", Summary: "change value", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-base\n+task\n"}},
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.SubmitMessage(context.Background(), started.ID, "change value"); err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.Execute(context.Background(), started.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("external\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	conflicted, err := service.ApplyToHost(context.Background(), started.ID)
	if !errors.Is(err, ErrIntegrationConflict) {
		t.Fatalf("expected the first integration conflict, got %v", err)
	}
	if conflicted.State != "conflict_resolution_pending" || conflicted.ConflictAttempt != 0 {
		t.Fatalf("expected the first conflict round to start at ConflictAttempt=0: %#v", conflicted)
	}

	_, err = service.store.Update(started.ID, func(current *domain.Session) error {
		current.PlannerInFlight = false
		current.PendingManualRequestIDs = nil
		current.State = "failed"
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	blocked, err := service.ApplyToHost(context.Background(), started.ID)
	if err == nil || !strings.Contains(err.Error(), "finish the active planner/repair turn") {
		t.Fatalf("expected active conflict to block stale Apply, got %v", err)
	}
	if blocked.IntegrationConflict == nil || blocked.State != "failed" {
		t.Fatalf("blocked Apply mutated the active conflict: %#v", blocked)
	}
}

func TestCancelPendingRequestReleasesConversationAndPreservesVerifiedCandidate(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(context.Background(), t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	requestID := "req-cancel"
	_, err = service.store.Update(started.ID, func(current *domain.Session) error {
		current.LastRequestID = requestID
		current.PendingManualRequestIDs = []string{requestID}
		current.LastManualPrompt = "pending"
		current.State = "repair_pending"
		current.PendingHostChanges = []domain.PendingHostChange{{Plan: domain.ExecutionPlan{PlanID: "verified-before-cancel"}}}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	cancelled, err := service.CancelPendingRequest(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.State != "verified" || len(cancelled.PendingManualRequestIDs) != 0 || cancelled.LastManualPrompt != "" {
		t.Fatalf("request did not release the conversation: %#v", cancelled)
	}
	if len(cancelled.PendingHostChanges) != 1 {
		t.Fatalf("cancel discarded an already verified candidate: %#v", cancelled.PendingHostChanges)
	}
}

func TestCancelPendingRequestRejectsStaleIdentityAndClearsLegacyMarkers(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(context.Background(), t.TempDir(), domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.store.Update(started.ID, func(current *domain.Session) error {
		current.LastRequestID = "req-current"
		current.PendingManualRequestIDs = []string{"req-old", "req-current"}
		current.PendingKnowledgeReviewRequestID = "req-current"
		current.LastManualPrompt = "pending"
		current.State = "awaiting_plan"
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.CancelPendingRequestByID(started.ID, "req-old"); err == nil {
		t.Fatal("expected a stale cancellation to be rejected")
	}
	unchanged, _ := service.GetSession(started.ID)
	if len(unchanged.PendingManualRequestIDs) != 2 {
		t.Fatalf("stale cancellation mutated the request chain: %#v", unchanged)
	}
	cancelled, err := service.CancelPendingRequestByID(started.ID, "req-current")
	if err != nil {
		t.Fatal(err)
	}
	if len(cancelled.PendingManualRequestIDs) != 0 || cancelled.PendingKnowledgeReviewRequestID != "" || cancelled.LastManualPrompt != "" {
		t.Fatalf("cancellation left split request state: %#v", cancelled)
	}
}

func TestConflictResolutionPlanCannotEscapeCapsule(t *testing.T) {
	item := domain.Session{IntegrationConflict: &domain.ConflictResolution{RequestID: "req-conflict", Paths: []string{"file.txt"}}}
	valid := &domain.ExecutionPlan{RequestID: "req-conflict", Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n"}}}
	if err := validateConflictResolutionPlan(item, valid); err != nil {
		t.Fatalf("valid focused resolution rejected: %v", err)
	}
	escaping := *valid
	escaping.Operations = []domain.Operation{{Type: "apply_patch", Patch: "--- a/other.txt\n+++ b/other.txt\n@@ -1 +1 @@\n-old\n+new\n"}}
	if err := validateConflictResolutionPlan(item, &escaping); err == nil || !strings.Contains(err.Error(), "outside the capsule") {
		t.Fatalf("escaping resolution was not rejected: %v", err)
	}
}

func TestRejectPendingHostChangesDiscardsCandidateWithoutTouchingHost(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "hello.txt")
	if err := os.WriteFile(path, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "reject-pending", Status: "ready", Summary: "pending", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n"}},
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), sandbox.NewLocalRunner())
	created, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.SubmitMessage(context.Background(), created.ID, "change"); err != nil {
		t.Fatal(err)
	}
	verified, _, err := service.Execute(context.Background(), created.ID, false)
	if err != nil || !verified.Success {
		t.Fatalf("verify pending change: result=%#v err=%v", verified, err)
	}
	rejected, err := service.RejectPendingHostChanges(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rejected.State != "ready" || len(rejected.PendingHostChanges) != 0 {
		t.Fatalf("pending candidate was not cleared: %#v", rejected)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "old\n" {
		t.Fatalf("reject touched the host: %q", contents)
	}
}

func TestFailedCumulativeHostApplyRollsBackPatchesFromThatAttempt(t *testing.T) {
	root := t.TempDir()
	firstPath := filepath.Join(root, "first.txt")
	secondPath := filepath.Join(root, "second.txt")
	if err := os.WriteFile(firstPath, []byte("old-first\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(secondPath, []byte("old-second\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "atomic-apply", Status: "ready", Summary: "two patches", Risk: "low",
		Operations: []domain.Operation{
			{Type: "apply_patch", Patch: "--- a/first.txt\n+++ b/first.txt\n@@ -1 +1 @@\n-old-first\n+new-first\n"},
			{Type: "apply_patch", Patch: "--- a/second.txt\n+++ b/second.txt\n@@ -1 +1 @@\n-old-second\n+new-second\n"},
		},
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), sandbox.NewLocalRunner())
	created, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.SubmitMessage(context.Background(), created.ID, "change both"); err != nil {
		t.Fatal(err)
	}
	if _, _, err = service.Execute(context.Background(), created.ID, false); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(secondPath, []byte("host-diverged\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err = service.ApplyToHost(context.Background(), created.ID); err == nil {
		t.Fatal("expected cumulative host apply to fail on the diverged second file")
	}
	firstContents, _ := os.ReadFile(firstPath)
	secondContents, _ := os.ReadFile(secondPath)
	if string(firstContents) != "old-first\n" || string(secondContents) != "host-diverged\n" {
		t.Fatalf("failed apply was not rolled back: first=%q second=%q", firstContents, secondContents)
	}
	current, err := service.GetSession(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(current.PendingHostChanges) != 1 {
		t.Fatalf("failed apply must retain the pending candidate: %#v", current.PendingHostChanges)
	}
	if !strings.Contains(current.LastRepairError, "host apply failed") {
		t.Fatalf("host apply failure was not retained for the correction turn: %q", current.LastRepairError)
	}
	capture := &messageCapturePlanner{}
	service.planner = capture
	if _, _, err = service.SubmitMessage(context.Background(), created.ID, "corrija a aplicação"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(capture.seen, "HOST-PENDING PROTECTED CANDIDATE") || !strings.Contains(capture.seen, "LAST HOST APPLY ERROR") {
		t.Fatalf("correction turn did not receive the pending candidate and apply error: %s", capture.seen)
	}
}

type contextCapturePlanner struct{ seen string }

type messageCapturePlanner struct{ seen string }

func (p *messageCapturePlanner) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	if request.PlanningMode != "knowledge_review" {
		p.seen = request.Message
	}
	return planner.Result{Turn: &domain.AgentTurn{Protocol: domain.TurnProtocolV1, RequestID: request.RequestID, Kind: domain.TurnKindAnswer, Message: "captured", Outcome: &domain.TurnOutcome{Status: domain.TurnOutcomeCompleted}}}, nil
}

func (p *contextCapturePlanner) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	data, err := os.ReadFile(request.ContextTextPath)
	if err != nil {
		return planner.Result{}, err
	}
	p.seen = string(data)
	plan := domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "capture", RequestID: request.RequestID, Status: "ready", Summary: "capture", VersionIncrement: &domain.VersionIncrement{Component: domain.VersionComponentPatch, Amount: 1}, Risk: "low", Operations: []domain.Operation{}, Verification: []domain.CommandSpec{}}
	return planner.Result{Plan: &plan}, nil
}

func TestSubmitMessageRefreshesContextAfterEditorSave(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "hello.txt")
	if err := os.WriteFile(path, []byte("before\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	capture := &contextCapturePlanner{}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), capture, policy.NewEngine(), fakeRunner{})
	s, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	file, err := service.ReadFile(s.ID, "hello.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.WriteFile(s.ID, "hello.txt", "after\n", file.SHA256); err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.SubmitMessage(context.Background(), s.ID, "read latest"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(capture.seen, "after\n") {
		t.Fatalf("planner context was stale: %q", capture.seen)
	}
	if strings.Contains(capture.seen, "before\n") {
		t.Fatalf("old file content leaked into refreshed context: %q", capture.seen)
	}
}

func TestRunTerminalCanTargetHostOnlyThroughHostRunner(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), fakeRunner{})
	s, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	host := &terminalTargetRunner{}
	service.hostRunner = host
	result, err := service.RunTerminal(context.Background(), s.ID, domain.TerminalTargetHost, domain.CommandSpec{Argv: []string{"git", "status", "--short"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}})
	if err != nil {
		t.Fatal(err)
	}
	if !host.ran || host.prepared != s.ProjectPath || result.Stdout != "host-target" {
		t.Fatalf("host terminal did not use host runner: runner=%#v result=%#v", host, result)
	}
}

func TestRunTerminalRejectsSandboxNetworkFlagForHost(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), fakeRunner{})
	s, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.RunTerminal(context.Background(), s.ID, domain.TerminalTargetHost, domain.CommandSpec{Argv: []string{"git", "status"}, Cwd: ".", Network: true, TimeoutSeconds: 30, ExpectedExitCodes: []int{0}})
	if err == nil || !strings.Contains(err.Error(), "inherits host networking") {
		t.Fatalf("expected host network-toggle rejection, got %v", err)
	}
}

func TestRunTerminalDeniesShell(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("ok\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), fakeRunner{})
	s, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.RunTerminal(context.Background(), s.ID, domain.TerminalTargetSandbox, domain.CommandSpec{Argv: []string{"bash", "-c", "echo unsafe"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}})
	if err == nil || !strings.Contains(err.Error(), "denied") {
		t.Fatalf("expected policy denial, got %v", err)
	}
}

func TestProjectConfigRepairsMissingFileForRestoredSession(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), fakeRunner{})
	s, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(root, projectconfig.FileName)
	if err := os.Remove(configPath); err != nil {
		t.Fatal(err)
	}
	cfg, err := service.ProjectConfig(s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Version != projectconfig.CurrentVersion {
		t.Fatalf("unexpected repaired config version: %d", cfg.Version)
	}
	if _, err := os.Stat(configPath); err != nil {
		t.Fatalf("missing config was not recreated: %v", err)
	}
}

func TestRunTerminalAllowsHumanDevelopmentMutation(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), fakeRunner{})
	s, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.RunTerminal(context.Background(), s.ID, domain.TerminalTargetSandbox, domain.CommandSpec{Argv: []string{"git", "add", "README.md"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success {
		t.Fatalf("interactive terminal command should be accepted: %#v", result)
	}
}

func TestStartSessionInitializesGitRepository(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("ok\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), fakeRunner{})
	if _, err := service.StartSession(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, ".git")); err != nil {
		t.Fatalf("project .git was not initialized: %v", err)
	}
}

func TestManualChatGPTPlanNormalizationExecutesAndApplies(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("demo\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	s, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, s, err = service.SubmitMessage(context.Background(), s.ID, "crie ola.txt")
	if err != nil {
		t.Fatal(err)
	}
	raw := []byte(`{
		"schema":"harness.execution/v1",
		"request_id":"` + s.LastRequestID + `",
		"status":"ready",
		"summary":"Criar ola.txt",
		"version_increment":{"component":"patch","amount":1},
		"operations":[{"type":"apply_patch","cwd":".","patch":"*** Begin Patch\n*** Add File: ola.txt\n+ola mundo\n*** End Patch","command":{"argv":[]}}],
		"verification":[{"type":"command","cwd":".","command":{"argv":["git","diff","--check"]},"patch":""}]
	}`)
	s, err = service.SubmitManualPlan(s.ID, raw)
	if err != nil {
		t.Fatal(err)
	}
	if s.Plan == nil || s.Plan.Protocol != domain.ProtocolV1 {
		t.Fatalf("manual plan not normalized: %#v", s.Plan)
	}
	result, s, err := service.Execute(context.Background(), s.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success {
		t.Fatal("sandbox execution should succeed")
	}
	if _, err := os.Stat(filepath.Join(root, "ola.txt")); !os.IsNotExist(err) {
		t.Fatal("host file must not exist before ApplyToHost")
	}
	if _, err := service.ApplyToHost(context.Background(), s.ID); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(root, "ola.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "ola mundo\n" {
		t.Fatalf("unexpected host content: %q", data)
	}
}

func TestUnprotectedExecutionTouchesHostImmediately(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	root := t.TempDir()
	path := filepath.Join(root, "hello.txt")
	if err := os.WriteFile(path, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "host-plan", RequestID: "placeholder", Status: "ready", Summary: "change host", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n"}},
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), sandbox.NewLocalRunner())
	s, err := service.StartSession(context.Background(), root, domain.ExecutionModeUnprotected)
	if err != nil {
		t.Fatal(err)
	}
	if s.AutomationMode != domain.AutomationModeManual {
		t.Fatalf("unprotected session automation mode = %q", s.AutomationMode)
	}
	_, s, err = service.SubmitMessage(context.Background(), s.ID, "change")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Execute(context.Background(), s.ID, false); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("unprotected execution must require confirmation, got %v", err)
	}
	result, s, err := service.Execute(context.Background(), s.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || s.State != "applied" {
		t.Fatalf("expected direct applied state, result=%#v session=%#v", result, s)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "new\n" {
		t.Fatalf("host was not changed directly: %q", data)
	}
	if _, err := service.ApplyToHost(context.Background(), s.ID); err == nil || !strings.Contains(err.Error(), "unprotected") {
		t.Fatalf("apply must be unavailable after direct execution, got %v", err)
	}
}

func TestExecutionModeCanChangePerSession(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), fakeRunner{})
	s, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if s.ExecutionMode != domain.ExecutionModeProtected {
		t.Fatalf("default mode = %q", s.ExecutionMode)
	}
	if s.AutomationMode != domain.AutomationModeAuto {
		t.Fatalf("default automation mode = %q", s.AutomationMode)
	}
	s, err = service.SetAutomationMode(s.ID, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	s, err = service.SetExecutionMode(s.ID, domain.ExecutionModeUnprotected)
	if err != nil {
		t.Fatal(err)
	}
	if s.ExecutionMode != domain.ExecutionModeUnprotected {
		t.Fatalf("updated mode = %q", s.ExecutionMode)
	}
	if _, err := service.SetExecutionMode(s.ID, domain.ExecutionMode("invalid")); err == nil {
		t.Fatal("invalid execution mode should be rejected")
	}
}

func TestSetChatTransportModeValidatesAndPersists(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), fakeRunner{})
	s, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if s.ChatTransportMode != domain.ChatTransportModeScraper {
		t.Fatalf("default chat transport mode = %q, expected scraper", s.ChatTransportMode)
	}
	s, err = service.SetChatTransportMode(s.ID, domain.ChatTransportModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if s.ChatTransportMode != domain.ChatTransportModeManual {
		t.Fatalf("updated chat transport mode = %q", s.ChatTransportMode)
	}
	refetched, err := service.GetSession(s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if refetched.ChatTransportMode != domain.ChatTransportModeManual {
		t.Fatalf("chat transport mode did not persist: %q", refetched.ChatTransportMode)
	}
	if _, err := service.SetChatTransportMode(s.ID, domain.ChatTransportMode("invalid")); err == nil {
		t.Fatal("invalid chat transport mode should be rejected")
	}
}

// TestChatTransportModeIndependentFromAutomationMode confirms Manual
// transport is not treated as mutually exclusive with Auto automation, the
// way Unprotected already is — the two axes are deliberately orthogonal.
func TestChatTransportModeIndependentFromAutomationMode(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), fakeRunner{})
	s, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	s, err = service.SetChatTransportMode(s.ID, domain.ChatTransportModeManual)
	if err != nil {
		t.Fatalf("Auto + Manual transport should be a valid combination: %v", err)
	}
	if s.AutomationMode != domain.AutomationModeAuto || s.ChatTransportMode != domain.ChatTransportModeManual {
		t.Fatalf("expected Auto automation to survive switching chat transport to manual: %#v", s)
	}
}

func TestNewManualRequestSupersedesEarlierPendingRequest(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("demo\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	s, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, s, err = service.SubmitMessage(context.Background(), s.ID, "pedido A")
	if err != nil {
		t.Fatal(err)
	}
	requestA := s.LastRequestID
	_, s, err = service.SubmitMessage(context.Background(), s.ID, "pedido B")
	if err != nil {
		t.Fatal(err)
	}
	requestB := s.LastRequestID
	if requestA == requestB || len(s.PendingManualRequestIDs) != 1 || s.PendingManualRequestIDs[0] != requestB {
		t.Fatalf("expected only the latest request to remain active, got %#v", s.PendingManualRequestIDs)
	}

	rawA := []byte(`{"protocol":"harness.execution/v1","plan_id":"plan-a","request_id":"` + requestA + `","status":"ready","summary":"A","version_increment":{"component":"patch","amount":1},"risk":"low","requires_approval":false,"operations":[],"verification":[]}`)
	if _, err := service.SubmitManualPlan(s.ID, rawA); err == nil || !strings.Contains(err.Error(), "not pending") {
		t.Fatalf("superseded plan must be rejected, got %v", err)
	}
}

func TestVerificationFailureIncludesCommandAndStderr(t *testing.T) {
	result := domain.CommandResult{ExitCode: 2, Stderr: "src/App.tsx(10,2): error TS2322: example"}
	got := fmt.Sprintf("verification failed: %s (exit %d): %s", strings.Join([]string{"npm", "run", "build"}, " "), result.ExitCode, commandResultDiagnostic(result))
	if !strings.Contains(got, "npm run build") || !strings.Contains(got, "TS2322") {
		t.Fatalf("diagnostic lost useful context: %q", got)
	}
}

type verificationDebtRunner struct {
	prepareCount int
	runCount     int
	baselineSame bool
}

func (r *verificationDebtRunner) Prepare(context.Context, string) (sandbox.Workspace, error) {
	r.prepareCount++
	return sandbox.Workspace{Path: fmt.Sprintf("/tmp/fake-%d", r.prepareCount)}, nil
}
func (*verificationDebtRunner) ApplyPatch(context.Context, sandbox.Workspace, string) (domain.CommandResult, error) {
	return domain.CommandResult{Argv: []string{"git", "apply"}, ExitCode: 0, Success: true}, nil
}
func (r *verificationDebtRunner) Run(_ context.Context, _ sandbox.Workspace, c domain.CommandSpec) (domain.CommandResult, error) {
	r.runCount++
	output := "src/lib/zip.ts(80,26): error TS2322: existing baseline error"
	if r.runCount > 1 && !r.baselineSame {
		output = "src/new.ts(1,1): error TS9999: regression"
	}
	return domain.CommandResult{Argv: c.Argv, Cwd: c.Cwd, ExitCode: 2, Stdout: output, Success: false}, nil
}
func (*verificationDebtRunner) Cleanup(sandbox.Workspace) error { return nil }

func TestProtectedExecutionAcceptsUnchangedBaselineVerificationDebt(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "baseline-debt", Status: "ready", Summary: "test", Risk: "low", Verification: []domain.CommandSpec{{Argv: []string{"npm", "run", "build"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}}}
	runner := &verificationDebtRunner{baselineSame: true}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), runner)
	s, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.SubmitMessage(context.Background(), s.ID, "test"); err != nil {
		t.Fatal(err)
	}
	result, updated, err := service.Execute(context.Background(), s.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Success || updated.State != "verified" {
		t.Fatalf("expected verified success, result=%#v state=%s", result, updated.State)
	}
	if len(result.Warnings) != 1 || !strings.Contains(result.Warnings[0], "pre-existing") {
		t.Fatalf("expected baseline warning, got %#v", result.Warnings)
	}
	if len(result.Commands) != 1 || !result.Commands[0].BaselineFailure {
		t.Fatalf("expected command marked as baseline debt: %#v", result.Commands)
	}
}

func TestProtectedExecutionRejectsChangedVerificationFailure(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "new-regression", Status: "ready", Summary: "test", Risk: "low", Verification: []domain.CommandSpec{{Argv: []string{"npm", "run", "build"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}}}}
	runner := &verificationDebtRunner{baselineSame: false}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), runner)
	s, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.SubmitMessage(context.Background(), s.ID, "test"); err != nil {
		t.Fatal(err)
	}
	result, _, err := service.Execute(context.Background(), s.ID, true)
	if err == nil || result.Success {
		t.Fatalf("expected changed failure to be rejected, result=%#v err=%v", result, err)
	}
}

func TestVerificationFailureEquivalentAcceptsSameTypeScriptDiagnosticsWithDifferentNoise(t *testing.T) {
	baseline := domain.CommandResult{
		ExitCode: 2,
		Stdout:   "> project@1.0.0 build\n> tsc --noEmit\n\nsrc/lib/zip.ts(80,26): error TS2322: Type X is not assignable to type Y.\nsrc/main.tsx(4,8): error TS2882: Cannot find module './styles.css'.\n",
	}
	post := domain.CommandResult{
		ExitCode: 2,
		Stdout:   "> project@1.0.0 build\n> tsc --noEmit\n",
		Stderr:   "npm notice transient-noise\nsrc/lib/zip.ts(80,26): error TS2322:   Type X   is not assignable to type Y.\nsrc/main.tsx(4,8): error TS2882: Cannot find module './styles.css'.\n",
	}
	if !verificationFailureEquivalent(baseline, post) {
		t.Fatal("same TypeScript diagnostics should be treated as unchanged baseline debt")
	}
}

func TestVerificationFailureEquivalentRejectsNewTypeScriptDiagnostic(t *testing.T) {
	baseline := domain.CommandResult{
		ExitCode: 2,
		Stdout:   "src/lib/zip.ts(80,26): error TS2322: existing error\n",
	}
	post := domain.CommandResult{
		ExitCode: 2,
		Stdout:   "src/lib/zip.ts(80,26): error TS2322: existing error\nsrc/components/LocalActivityModal.tsx(120,4): error TS9999: new regression\n",
	}
	if verificationFailureEquivalent(baseline, post) {
		t.Fatal("new TypeScript diagnostic must be rejected")
	}
}

func TestVerificationFailureEquivalentRejectsUnstructuredDifferentFailures(t *testing.T) {
	baseline := domain.CommandResult{ExitCode: 1, Stderr: "old generic failure"}
	post := domain.CommandResult{ExitCode: 1, Stderr: "different generic failure"}
	if verificationFailureEquivalent(baseline, post) {
		t.Fatal("unstructured failures must retain strict comparison")
	}
}

type repairFailureRunner struct{ runCount int }

func (repairFailureRunner) Prepare(context.Context, string) (sandbox.Workspace, error) {
	return sandbox.Workspace{Path: "/tmp/repair-fake"}, nil
}
func (repairFailureRunner) ApplyPatch(context.Context, sandbox.Workspace, string) (domain.CommandResult, error) {
	return domain.CommandResult{Argv: []string{"git", "apply"}, ExitCode: 0, Success: true}, nil
}
func (r *repairFailureRunner) Run(_ context.Context, _ sandbox.Workspace, c domain.CommandSpec) (domain.CommandResult, error) {
	r.runCount++
	output := "src/new.ts(4,2): error TS9999: repair me"
	if r.runCount > 1 {
		output = "src/old.ts(1,1): error TS2322: old baseline debt"
	}
	return domain.CommandResult{Argv: c.Argv, Cwd: c.Cwd, ExitCode: 2, Stderr: output, Success: false}, nil
}
func (*repairFailureRunner) Cleanup(sandbox.Workspace) error { return nil }

func TestExecutionFailurePreparesFreshManualRepairRequest(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), &repairFailureRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "fix feature")
	if err != nil {
		t.Fatal(err)
	}
	originalRequest := prompted.LastRequestID
	raw := []byte(`{"protocol":"harness.execution/v1","plan_id":"failed-plan","request_id":"` + originalRequest + `","status":"ready","summary":"test failure","version_increment":{"component":"patch","amount":1},"risk":"low","requires_approval":false,"operations":[],"verification":[{"argv":["npm","run","build"],"cwd":".","timeout_seconds":30,"network":false,"expected_exit_codes":[0]}]}`)
	planned, err := service.SubmitManualPlan(started.ID, raw)
	if err != nil {
		t.Fatal(err)
	}
	result, repaired, err := service.Execute(context.Background(), planned.ID, true)
	if err == nil || result.Success {
		t.Fatalf("expected execution failure, result=%#v err=%v", result, err)
	}
	if repaired.State != "repair_pending" {
		t.Fatalf("expected repair_pending state, got %q", repaired.State)
	}
	if repaired.RepairAttempt != 1 {
		t.Fatalf("expected repair attempt 1, got %d", repaired.RepairAttempt)
	}
	if repaired.LastRequestID == "" || repaired.LastRequestID == originalRequest {
		t.Fatalf("expected fresh repair request id, got %q", repaired.LastRequestID)
	}
	if !containsString(repaired.PendingManualRequestIDs, repaired.LastRequestID) {
		t.Fatalf("repair request must be pending: %#v", repaired.PendingManualRequestIDs)
	}
	if !strings.Contains(repaired.LastManualPrompt, "AUTOMATIC REPAIR REQUEST") || !strings.Contains(repaired.LastManualPrompt, "TS9999") {
		t.Fatalf("repair prompt lost failure evidence: %q", repaired.LastManualPrompt)
	}
}

func TestRequestFailureRepairStartsManualGPTRepairWithOptionalGuidanceAfterAutomationStops(t *testing.T) {
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
	seedFailedPlanForRepair(t, service, started.ID, prompted.LastRequestID)
	failed, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "failed"
		item.RepairAttempt = maxAutoRepairAttempts
		item.LastRepairError = "tests still fail"
		item.LastExecution = &domain.ExecutionResult{PlanID: item.Plan.PlanID, Success: false, Error: item.LastRepairError}
		item.PendingManualRequestIDs = nil
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	repaired, err := service.RequestFailureRepair(context.Background(), failed.ID, "Verifique também o fixture Windows.")
	if err != nil {
		t.Fatal(err)
	}
	if repaired.State != "repair_pending" || repaired.LastManualPrompt == "" {
		t.Fatalf("manual GPT repair was not prepared: %#v", repaired)
	}
	if !strings.Contains(repaired.LastManualPrompt, "Verifique também o fixture Windows.") {
		t.Fatalf("manual guidance missing from repair prompt: %q", repaired.LastManualPrompt)
	}
	if repaired.LastRequestID == failed.LastRequestID {
		t.Fatal("manual repair must own a fresh request id")
	}
}

func TestRequestFailureRepairReusesPreparedPromptAndAppendsGuidanceOnce(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	prepared, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "repair_pending"
		item.LastRequestID = "req-repair"
		item.LastManualPrompt = "repair evidence"
		item.PendingManualRequestIDs = []string{"req-repair"}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.RequestFailureRepair(context.Background(), prepared.ID, "Observe o Windows.")
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.RequestFailureRepair(context.Background(), prepared.ID, "Observe o Windows.")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(second.LastManualPrompt, "OPTIONAL OPERATOR GUIDANCE:") != 1 || second.LastManualPrompt != first.LastManualPrompt {
		t.Fatalf("operator guidance was duplicated: %q", second.LastManualPrompt)
	}
}

func TestRequestFailureRepairRetriesTerminalPlannerFailureWithGuidance(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	failed, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "failed"
		item.LastRequestID = "req-failed"
		item.LastRepairError = "bundle validation failed"
		item.LastExecution = nil
		item.PendingManualRequestIDs = nil
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	repaired, err := service.RequestFailureRepair(context.Background(), failed.ID, "Preserve the public API.")
	if err != nil {
		t.Fatal(err)
	}
	if repaired.State != "awaiting_plan" || repaired.LastManualPrompt == "" || repaired.LastRequestID == failed.LastRequestID {
		t.Fatalf("terminal planner failure was not retried: %#v", repaired)
	}
	if !strings.Contains(repaired.LastManualPrompt, "Preserve the public API.") {
		t.Fatalf("manual guidance missing from fresh recovery: %q", repaired.LastManualPrompt)
	}
}

func TestRequestFailureRepairRejectsInfrastructureFailure(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	failed, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "failed"
		item.FailureKind = domain.FailureKindOfflineGoModuleCache
		item.LastRepairError = "offline sandbox dependencies unavailable"
		item.LastExecution = &domain.ExecutionResult{PlanID: "plan-offline", Success: false, Error: item.LastRepairError}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	unchanged, err := service.RequestFailureRepair(context.Background(), failed.ID, "try changing the source")
	if err == nil || !strings.Contains(err.Error(), "dedicated local recovery action") {
		t.Fatalf("expected infrastructure-specific recovery rejection, got %v", err)
	}
	if unchanged.RepairAttempt != 0 || unchanged.LastManualPrompt != "" {
		t.Fatalf("infrastructure failure must not consume or prepare a GPT repair: %#v", unchanged)
	}
}

func TestExecutionFailureRepairRequestIncludesProjectKnowledge(t *testing.T) {
	// The automatic repair round is exactly where a prior operational
	// lesson about why a change failed to apply matters most; it must not
	// be limited to the first request of a chat the way it once was.
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := session.NewStore()
	if _, err := store.AppendProjectKnowledge(root, "- Self-evolution rollback needs stack-known-good.sh captured before Apply.", "req-earlier"); err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), &repairFailureRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "fix feature")
	if err != nil {
		t.Fatal(err)
	}
	originalRequest := prompted.LastRequestID
	raw := []byte(`{"protocol":"harness.execution/v1","plan_id":"failed-plan","request_id":"` + originalRequest + `","status":"ready","summary":"test failure","version_increment":{"component":"patch","amount":1},"risk":"low","requires_approval":false,"operations":[],"verification":[{"argv":["npm","run","build"],"cwd":".","timeout_seconds":30,"network":false,"expected_exit_codes":[0]}]}`)
	planned, err := service.SubmitManualPlan(started.ID, raw)
	if err != nil {
		t.Fatal(err)
	}
	result, repaired, err := service.Execute(context.Background(), planned.ID, true)
	if err == nil || result.Success {
		t.Fatalf("expected execution failure, result=%#v err=%v", result, err)
	}
	if !strings.Contains(repaired.LastManualPrompt, "PROJECT KNOWLEDGE PROTOCOL — harness.knowledge/v2") || strings.Contains(repaired.LastManualPrompt, "stack-known-good.sh") {
		t.Fatalf("expected the automatic repair prompt to reference separately attached v2 knowledge without duplicating its content, got %q", repaired.LastManualPrompt)
	}
}

func TestSuccessfulRetainedPlanRetryRetiresObsoleteRepairRequest(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "fix feature")
	if err != nil {
		t.Fatal(err)
	}
	originalRequest := prompted.LastRequestID
	raw := []byte(`{"protocol":"harness.execution/v1","plan_id":"retained-plan","request_id":"` + originalRequest + `","status":"ready","summary":"update file","version_increment":{"component":"patch","amount":1},"commit_message":"fix(demo): replace the hello greeting text","risk":"low","requires_approval":false,"operations":[{"type":"apply_patch","patch":"--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n","command":{"argv":[],"cwd":".","timeout_seconds":30,"network":false,"expected_exit_codes":[0]}}],"verification":[]}`)
	planned, err := service.SubmitManualPlan(started.ID, raw)
	if err != nil {
		t.Fatal(err)
	}
	const repairRequest = "req_obsolete_repair"
	if _, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "repair_pending"
		item.LastRequestID = repairRequest
		item.LastManualPrompt = "repair prompt"
		item.PendingManualRequestIDs = []string{repairRequest}
		item.RepairAttempt = 1
		item.LastRepairError = "temporary harness failure"
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	result, retried, err := service.Execute(context.Background(), planned.ID, true)
	if err != nil || !result.Success {
		t.Fatalf("retained plan retry failed: result=%#v err=%v", result, err)
	}
	if retried.State != "applied" || len(retried.PendingManualRequestIDs) != 0 || retried.LastManualPrompt != "" || retried.LastRequestID != originalRequest {
		t.Fatalf("obsolete repair request survived successful retry: %#v", retried)
	}
}

func TestRepairLoopStopsAfterBoundedAttempts(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.store.Update(started.ID, func(item *domain.Session) error {
		item.RepairAttempt = maxAutoRepairAttempts
		item.State = "failed"
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	current, err := service.prepareRepairRequest(context.Background(), started.ID, domain.ExecutionResult{PlanID: "p"}, errors.New("boom"))
	if err != nil {
		t.Fatal(err)
	}
	if current.RepairAttempt != maxAutoRepairAttempts || current.State != "failed" {
		t.Fatalf("repair loop should stop without new request: %#v", current)
	}
}

func addV2ResponseArtifacts(entries map[string]string, summary string) {
	entries["summary.md"] = summary
	entries["knowledge/index.json"] = `{"protocol":"harness.knowledge/v2","base_revision":0,"mode":"replace","entries":[]}`
}

func makeExecutionBundle(t *testing.T, requestID string) []byte {
	return makeExecutionBundleWithBaseline(t, requestID, "")
}

func makeV2ExecutionBundle(t *testing.T, requestID string, requiresApproval bool, approved *domain.ApprovedChatPlan) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	approvedField := ""
	if approved != nil {
		rawApproved, err := json.Marshal(approved)
		if err != nil {
			t.Fatal(err)
		}
		approvedField = `,"approved_chat_plan":` + string(rawApproved)
	}
	entries := map[string]string{
		"README.md":         "# Informed execution plan\nChanges hello.txt from old to new.\n",
		"turn.json":         `{"protocol":"harness.turn/v1","request_id":"` + requestID + `","kind":"change","message":"Implementação concluída e pronta para execução local.","outcome":{"status":"completed","retryable":false}}`,
		"patches/001.patch": "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n",
		"plan.json":         `{"protocol":"harness.execution/v2","plan_id":"bundle-plan-v2","request_id":"` + requestID + `","status":"ready","summary":"Substitui a saudação do ficheiro de demonstração.","document":"## Resultado\nSubstituir old por new em hello.txt.\n\n## Alterações\nUma alteração textual em hello.txt.\n\n## Riscos e rollback\nBaixo; reverter o patch.\n\n## Verificação\nConfirmar o conteúdo final.","dependencies":[],"system_tools":[]` + approvedField + `,"version_increment":{"component":"patch","amount":1},"commit_message":"fix(demo): replace greeting text\n\nKeep the demo content aligned with the approved request.","risk":"low","requires_approval":` + strconv.FormatBool(requiresApproval) + `,"operations":[{"type":"apply_patch","patch_file":"patches/001.patch","command":{"argv":[],"cwd":".","timeout_seconds":60,"network":false,"expected_exit_codes":[0]}}],"verification":[]}`,
	}
	addV2ResponseArtifacts(entries, "Atualização cumulativa do pedido de teste.")
	for name, value := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func makeExecutionBundleWithBaseline(t *testing.T, requestID, baseline string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	baselineField := ""
	if baseline != "" {
		baselineField = `,"base_context_sha256":"` + baseline + `","impact_files":["hello.txt"]`
	}
	entries := map[string]string{
		"README.md":         "# Automatic fix\nChanges hello.txt from old to new.\n",
		"patches/001.patch": "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n",
		"plan.json":         `{"protocol":"harness.execution/v1","plan_id":"bundle-plan","request_id":"` + requestID + `","status":"ready","summary":"Replace the hello greeting text in the demo file","version_increment":{"component":"patch","amount":1},"commit_message":"fix(demo): replace the hello greeting text","risk":"low","requires_approval":false` + baselineField + `,"operations":[{"type":"apply_patch","patch_file":"patches/001.patch","command":{"argv":[],"cwd":".","timeout_seconds":60,"network":false,"expected_exit_codes":[0]}}],"verification":[]}`,
	}
	addV2ResponseArtifacts(entries, "Atualização cumulativa do pedido de teste.")
	for name, value := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestStaleBundleWithDisjointLocalChangeContinuesOnCurrentBaseline(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "change hello")
	if err != nil {
		t.Fatal(err)
	}
	staleRequestID := prompted.LastRequestID
	staleBaseline := prompted.Context.Manifest.SHA256
	if err := os.WriteFile(filepath.Join(root, "unrelated.txt"), []byte("context changed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	refreshed, err := service.RefreshContext(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.Context.Manifest.SHA256 == staleBaseline {
		t.Fatal("fixture did not change the context baseline")
	}

	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+staleRequestID+".zip", makeExecutionBundleWithBaseline(t, staleRequestID, staleBaseline))
	if err != nil {
		t.Fatal(err)
	}
	if result.AutoError != "" {
		t.Fatalf("disjoint local context change blocked the bundle: %s", result.AutoError)
	}
	if result.Session.Plan == nil || result.Session.Plan.BaseContextSHA256 != refreshed.Context.Manifest.SHA256 {
		t.Fatalf("bundle was not rebased onto compatible current context: %#v", result.Session.Plan)
	}
	if containsString(result.Session.PendingManualRequestIDs, staleRequestID) {
		t.Fatalf("accepted request remains pending: %#v", result.Session.PendingManualRequestIDs)
	}
}

func TestStaleBundleWithOverlappingLocalChangePreparesDedicatedConflictResolution(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "change hello")
	if err != nil {
		t.Fatal(err)
	}
	staleRequestID := prompted.LastRequestID
	staleBaseline := prompted.Context.Manifest.SHA256
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("local edit\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err = service.RefreshContext(started.ID)
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+staleRequestID+".zip", makeExecutionBundleWithBaseline(t, staleRequestID, staleBaseline))
	if err != nil {
		t.Fatal(err)
	}
	if result.Session.State != "conflict_resolution_pending" || result.Session.LastRequestID == staleRequestID {
		t.Fatalf("overlapping stale bundle did not open conflict support: %#v", result.Session)
	}
	if !result.ConflictPrepared || result.Session.IntegrationConflict == nil || !strings.Contains(result.Session.LastManualPrompt, "harness.conflict/v1") {
		t.Fatalf("overlap did not produce a focused conflict capsule: result=%#v", result)
	}
}

func TestStaleBundleWithoutRetainedArchiveNeverCreatesBaselineContinuation(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "change hello")
	if err != nil {
		t.Fatal(err)
	}
	requestID := prompted.LastRequestID
	baseline := prompted.Context.Manifest.SHA256
	if err := os.RemoveAll(filepath.Dir(prompted.Context.ZipPath)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("external\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RefreshContext(started.ID); err != nil {
		t.Fatal(err)
	}
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", makeExecutionBundleWithBaseline(t, requestID, baseline))
	if err != nil {
		t.Fatal(err)
	}
	if result.Session.State == "baseline_update_pending" || strings.Contains(result.AutoError, "ignored superseded bundle for baseline") {
		t.Fatalf("legacy missing archive re-entered baseline ping-pong: state=%s error=%q", result.Session.State, result.AutoError)
	}
}

func TestExecutionBaseHydratesMissingVerificationDependencies(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "changed.go"), []byte("current\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "dependency.go"), []byte("dependency\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "context.zip")
	var raw bytes.Buffer
	writer := zip.NewWriter(&raw)
	entry, err := writer.Create("changed.go")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("historical\n")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archive, raw.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := &domain.ExecutionPlan{RequestID: "req_hydrate", Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/changed.go\n+++ b/changed.go\n@@ -1 +1 @@\n-historical\n+result\n"}}, Verification: []domain.CommandSpec{appCommand("go", "test", "./...")}}
	item := domain.Session{ProjectPath: project, RequestContextArchives: map[string]string{plan.RequestID: archive}}
	if !canReconcilePlanFromArchive(item, plan) {
		t.Fatal("archive containing every authoritative patch path should be reconcilable")
	}

	root, cleanup, err := executionBase(item, plan, true)
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if data, err := os.ReadFile(filepath.Join(root, "changed.go")); err != nil || string(data) != "historical\n" {
		t.Fatalf("historical patch base changed: data=%q err=%v", data, err)
	}
	if data, err := os.ReadFile(filepath.Join(root, "dependency.go")); err != nil || string(data) != "dependency\n" {
		t.Fatalf("verification dependency was not hydrated: data=%q err=%v", data, err)
	}

	plan.ReadFiles = []string{"missing-declared.go"}
	if canReconcilePlanFromArchive(item, plan) {
		t.Fatal("archive missing a declared dependency must use the current-baseline compatibility path")
	}
}

func TestRestoredExecutionUsesOriginalProjectAsDependencySource(t *testing.T) {
	item := domain.Session{ProjectPath: "/project/current"}
	workspace := sandbox.Workspace{Path: "/private/restored-base", SourcePath: "/private/restored-base"}
	bindExecutionDependencySource(&workspace, item, true)
	if workspace.SourcePath != item.ProjectPath || workspace.Path != "/private/restored-base" {
		t.Fatalf("restored execution dependency source is wrong: %#v", workspace)
	}
}

func TestEnsureContextArtifactsRebuildsExpiredFilesWithoutChangingWorkflowState(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("content\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, pending, err := service.SubmitMessage(context.Background(), started.ID, "inspect project")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Dir(pending.Context.ZipPath)); err != nil {
		t.Fatal(err)
	}
	rebuilt, err := service.EnsureContextArtifacts(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rebuilt.State != pending.State || rebuilt.LastRequestID != pending.LastRequestID {
		t.Fatalf("context repair changed workflow ownership: before=%s/%s after=%s/%s", pending.State, pending.LastRequestID, rebuilt.State, rebuilt.LastRequestID)
	}
	for _, artifact := range []string{rebuilt.Context.ZipPath, rebuilt.Context.TextPath} {
		if info, statErr := os.Stat(artifact); statErr != nil || !info.Mode().IsRegular() {
			t.Fatalf("context artifact was not rebuilt: %s err=%v", artifact, statErr)
		}
	}
}

func TestCompatibleLateBundleRetiresPrematureBaselineContinuation(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "change hello")
	if err != nil {
		t.Fatal(err)
	}
	originalRequest := prompted.LastRequestID
	originalBaseline := prompted.Context.Manifest.SHA256
	if err := os.WriteFile(filepath.Join(root, "unrelated.txt"), []byte("independent\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.RefreshContext(started.ID); err != nil {
		t.Fatal(err)
	}
	const replacementRequest = "req_replacement_baseline"
	if _, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.State = "baseline_update_pending"
		item.LastRequestID = replacementRequest
		item.PendingManualRequestIDs = appendUnique(item.PendingManualRequestIDs, replacementRequest)
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+originalRequest+".zip", makeExecutionBundleWithBaseline(t, originalRequest, originalBaseline))
	if err != nil {
		t.Fatal(err)
	}
	if result.AutoError != "" || containsString(result.Session.PendingManualRequestIDs, replacementRequest) {
		t.Fatalf("compatible late bundle did not retire redundant continuation: %#v", result)
	}
}

func makeAnswerBundle(t *testing.T, requestID string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	entries := map[string]string{
		"README.md": "# Answer\nNo project mutation is required.\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"` + requestID + `","kind":"answer","message":"A série mensal limita o histórico aos últimos 12 registos.","outcome":{"status":"completed","retryable":false}}`,
	}
	addV2ResponseArtifacts(entries, "Resumo cumulativo da resposta de teste.")
	for name, value := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func makePlanBundle(t *testing.T, requestID string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	entries := map[string]string{
		"README.md": "# Plan proposal\nNo project mutation is included before approval.\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"` + requestID + `","kind":"plan","message":"## TODO\n- [ ] Refatorar o fluxo de aprovação mantendo o escopo proposto.\n\nRisco: médio. Verificar testes do backend e frontend.","outcome":{"status":"completed","retryable":false}}`,
	}
	addV2ResponseArtifacts(entries, "Resumo cumulativo da proposta de plano.")
	for name, value := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func makeFailedBundle(t *testing.T, requestID string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	entries := map[string]string{
		"README.md": "# Not completed\nThe requested evidence was unavailable.\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"` + requestID + `","kind":"blocked","message":"Não consegui concluir a análise.","outcome":{"status":"failed","reason_code":"context_unavailable","message":"Nenhum canal de contexto estava acessível.","retryable":true}}`,
	}
	addV2ResponseArtifacts(entries, "Resumo cumulativo da tentativa bloqueada.")
	for name, value := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func makeFailedBundleWithReason(t *testing.T, requestID, reasonCode string, retryable bool) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	retryableJSON := "false"
	if retryable {
		retryableJSON = "true"
	}
	entries := map[string]string{
		"README.md": "# Not completed\nA local infrastructure fault prevented verification.\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"` + requestID + `","kind":"blocked","message":"Não consegui concluir a verificação.","outcome":{"status":"failed","reason_code":"` + reasonCode + `","message":"Os gates Go obrigatórios não puderam iniciar.","retryable":` + retryableJSON + `}}`,
	}
	addV2ResponseArtifacts(entries, "Resumo cumulativo da falha de infraestrutura.")
	for name, value := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func seedFailedPlanForRepair(t *testing.T, service *Service, sessionID, requestID string) {
	t.Helper()
	plan := &domain.ExecutionPlan{
		Protocol:  domain.ProtocolV1,
		PlanID:    "plan_repair_seed",
		RequestID: requestID,
		Status:    "ready",
		Risk:      "low",
		Operations: []domain.Operation{
			{Type: "command", Command: domain.CommandSpec{Argv: []string{"go", "test", "./..."}, Cwd: ".", TimeoutSeconds: 60, ExpectedExitCodes: []int{0}}},
		},
	}
	if _, err := service.store.Update(sessionID, func(item *domain.Session) error {
		decision := service.policy.Evaluate(*plan)
		item.Plan = plan
		item.Policy = &decision
		item.LastExecution = &domain.ExecutionResult{PlanID: plan.PlanID, Success: false, Error: "offline sandbox dependencies unavailable: github.com/jackc/pgpassfile"}
		item.State = "failed"
		item.RepairAttempt = 2
		item.PendingManualRequestIDs = []string{requestID}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestPlannerInfrastructureOutcomePreservesFailedPlan(t *testing.T) {
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

	bundle := makeFailedBundleWithReason(t, requestID, "offline_host_go_module_cache", true)
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", bundle)
	if err != nil {
		t.Fatal(err)
	}
	if result.Session.Plan == nil || result.Session.Policy == nil || result.Session.LastExecution == nil {
		t.Fatalf("infrastructure-classified planner failure must preserve the failed plan/policy/execution: %#v", result.Session)
	}
	if result.Session.State != "failed" {
		t.Fatalf("session state = %q, want failed", result.Session.State)
	}
	if result.Session.FailureKind != domain.FailureKindOfflineGoModuleCache {
		t.Fatalf("failure_kind = %q, want %q", result.Session.FailureKind, domain.FailureKindOfflineGoModuleCache)
	}
	if result.Session.RepairAttempt != 0 {
		t.Fatalf("repair attempt was consumed diagnosing infrastructure: %d", result.Session.RepairAttempt)
	}
	// Auto mode + retryable:true would normally fire a fresh-request
	// recovery; an infrastructure-classified outcome must suppress it, since
	// a new ChatGPT request would fail identically against the same missing
	// host module cache.
	if result.RemoteRecoveryPrepared || result.Session.RemoteRecoveryAttempt != 0 {
		t.Fatalf("infrastructure failure must not trigger automatic fresh-request recovery: %#v", result)
	}
}

func TestPlannerCodeDefectOutcomeStillClearsPlan(t *testing.T) {
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

	bundle := makeFailedBundleWithReason(t, requestID, "invalid_patch", true)
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", bundle)
	if err != nil {
		t.Fatal(err)
	}
	if result.Session.Plan != nil || result.Session.Policy != nil || result.Session.LastExecution != nil {
		t.Fatalf("a genuine code-defect outcome must still clear the plan: %#v", result.Session)
	}
	if result.Session.FailureKind != "" {
		t.Fatalf("failure_kind must stay empty for a non-infrastructure outcome, got %q", result.Session.FailureKind)
	}
}

func TestRetryDependencyNetworkRecoversFromPlannerReportedInfrastructureFailure(t *testing.T) {
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

	bundle := makeFailedBundleWithReason(t, requestID, "offline_host_go_module_cache", false)
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", bundle); err != nil {
		t.Fatal(err)
	}

	updated, err := service.RetryDependencyNetwork(context.Background(), started.ID, true)
	if err != nil {
		t.Fatalf("RetryDependencyNetwork should recover from a planner-reported infrastructure failure: %v", err)
	}
	if updated.Plan == nil {
		t.Fatal("recovered session lost its plan")
	}
	foundHydration := false
	for _, op := range updated.Plan.Operations {
		if op.Type == "command" && isGoDependencyHydration(op.Command) {
			foundHydration = true
		}
	}
	if !foundHydration {
		t.Fatal("recovered plan did not gain a go mod download hydration operation")
	}
}

func TestFailExecutionClassifiesOfflineGoModuleCache(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = service.failExecution(context.Background(), started.ID, domain.ExecutionResult{PlanID: "p"}, fmt.Errorf("%w: x", sandbox.ErrOfflineDependenciesUnavailable))
	if err == nil {
		t.Fatal("expected failExecution to propagate the cause")
	}
	current, getErr := service.store.Get(started.ID)
	if getErr != nil {
		t.Fatal(getErr)
	}
	if current.FailureKind != domain.FailureKindOfflineGoModuleCache {
		t.Fatalf("failure_kind = %q, want %q", current.FailureKind, domain.FailureKindOfflineGoModuleCache)
	}

	_, _, err = service.failExecution(context.Background(), started.ID, domain.ExecutionResult{PlanID: "p"}, errors.New("generic failure"))
	if err == nil {
		t.Fatal("expected failExecution to propagate the cause")
	}
	current, getErr = service.store.Get(started.ID)
	if getErr != nil {
		t.Fatal(getErr)
	}
	if current.FailureKind != "" {
		t.Fatalf("failure_kind should be empty for a generic failure, got %q", current.FailureKind)
	}
}

func TestFailExecutionDoesNotQueueRepairForSandboxPreparationTimeout(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	cause := fmt.Errorf("verification failed: %w after 3m0s during dependency preparation", sandbox.ErrCommandPreparationTimeout)
	_, updated, err := service.failExecution(context.Background(), started.ID, domain.ExecutionResult{PlanID: "p"}, cause)
	if err == nil {
		t.Fatal("expected failExecution to propagate the cause")
	}
	if updated.FailureKind != domain.FailureKindSandboxPreparationTimeout {
		t.Fatalf("failure_kind = %q, want %q", updated.FailureKind, domain.FailureKindSandboxPreparationTimeout)
	}
	if updated.State == "repair_pending" {
		t.Fatal("sandbox preparation timeout must not queue a planner repair")
	}
	if updated.RepairAttempt != 0 {
		t.Fatalf("sandbox preparation timeout consumed %d repair attempts", updated.RepairAttempt)
	}
}

func TestPrepareRepairRequestBlocksHostToolchainMismatchInsteadOfConsumingAnAttempt(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	// Reproduces the real production case: a self-evolution host build (not
	// a sandbox execution) failed because the host's Node.js is older than
	// what the pinned Electron dependency's postinstall requires. No patch
	// to project source can fix this, so it must never be dispatched to
	// ChatGPT as a repair request.
	cause := fmt.Errorf("self-evolution host build failed: %w", selfevolution.ErrHostBuildToolchainMismatch)
	updated, err := service.prepareRepairRequest(context.Background(), started.ID, domain.ExecutionResult{PlanID: "p"}, cause)
	if err != nil {
		t.Fatal(err)
	}
	if updated.State == "repair_pending" {
		t.Fatal("a host toolchain mismatch must never be routed into the repair loop")
	}
	if updated.FailureKind != domain.FailureKindHostBuildToolchain {
		t.Fatalf("failure_kind = %q, want %q", updated.FailureKind, domain.FailureKindHostBuildToolchain)
	}
	if updated.RepairAttempt != 0 {
		t.Fatalf("repair attempt should not be consumed, got %d", updated.RepairAttempt)
	}
}

func TestSetChatIDBackfillsALegacySessionMissingOne(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if started.ChatID != "" {
		t.Fatalf("expected a freshly started session to have no chat id, got %q", started.ChatID)
	}
	updated, err := service.SetChatID(started.ID, "569f235d-6552-464d-ae2a-60ebeb0501f2")
	if err != nil {
		t.Fatal(err)
	}
	if updated.ChatID != "569f235d-6552-464d-ae2a-60ebeb0501f2" {
		t.Fatalf("chat id was not backfilled, got %q", updated.ChatID)
	}
	if _, err := service.SetChatID(started.ID, "has_underscore"); err == nil {
		t.Fatal("expected a chat id containing '_' to be rejected: it would make whx_bundle_* names ambiguous to parse")
	}
	if _, err := service.SetChatID(started.ID, "different-chat"); err == nil || !strings.Contains(err.Error(), "already owned") {
		t.Fatalf("expected immutable chat ownership rejection, got %v", err)
	}
}

func TestSessionFailureKindFallsBackToLegacyProse(t *testing.T) {
	legacy := domain.Session{LastRepairError: "offline sandbox dependencies unavailable: github.com/jackc/pgpassfile"}
	if got := sessionFailureKind(legacy); got != domain.FailureKindOfflineGoModuleCache {
		t.Fatalf("legacy prose was not classified: %q", got)
	}
	clean := domain.Session{LastRepairError: "some other failure"}
	if got := sessionFailureKind(clean); got != "" {
		t.Fatalf("unrelated prose was misclassified: %q", got)
	}
	legacyToolchain := domain.Session{LastRepairError: "self-evolution host build failed: exit status 2\nError: Electron failed to install correctly."}
	if got := sessionFailureKind(legacyToolchain); got != domain.FailureKindHostBuildToolchain {
		t.Fatalf("legacy toolchain-mismatch prose was not classified: %q", got)
	}
}

func TestClearSessionFailureResetsFailureKind(t *testing.T) {
	current := &domain.Session{LastRepairError: "boom", FailureKind: domain.FailureKindOfflineGoModuleCache}
	clearSessionFailure(current)
	if current.LastRepairError != "" || current.FailureKind != "" {
		t.Fatalf("clearSessionFailure left residue: %#v", current)
	}
}

func makeWorkflowBundle(t *testing.T, requestID string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	entries := map[string]string{
		"README.md": "# Investigation step\nInspect the project before answering.\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"` + requestID + `","kind":"workflow","message":"Vou confirmar as capacidades existentes antes de recomendar a próxima funcionalidade.","outcome":{"status":"completed","retryable":false}}`,
		"plan.json": `{"protocol":"harness.execution/v1","plan_id":"workflow-1","request_id":"` + requestID + `","status":"ready","summary":"inspect supported formats","risk":"low","requires_approval":false,"operations":[{"type":"command","patch":"","command":{"argv":["git","status","--short"],"cwd":".","timeout_seconds":30,"network":false,"expected_exit_codes":[0]}}],"verification":[]}`,
	}
	addV2ResponseArtifacts(entries, "Resumo cumulativo do passo de investigação.")
	for name, value := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestAutoWorkflowBundleExecutesSandboxAndPreparesSameConversationContinuation(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), workflowEvidenceRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "Que funcionalidade deveríamos adicionar a seguir?")
	if err != nil {
		t.Fatal(err)
	}
	firstRequest := prompted.LastRequestID
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+firstRequest+".zip", makeWorkflowBundle(t, firstRequest))
	if err != nil {
		t.Fatal(err)
	}
	if !result.WorkflowExecuted || !result.WorkflowPrepared || result.WorkflowRound != 1 {
		t.Fatalf("workflow did not advance automatically: %#v", result)
	}
	if result.AutoApplied {
		t.Fatal("workflow must never apply to the host")
	}
	if result.Session.State != "workflow_pending" || result.Session.LastRequestID == firstRequest {
		t.Fatalf("workflow continuation was not prepared with a fresh request: %#v", result.Session)
	}
	if !containsString(result.Session.PendingManualRequestIDs, result.Session.LastRequestID) {
		t.Fatalf("workflow continuation request is not pending: %#v", result.Session.PendingManualRequestIDs)
	}
	if !strings.Contains(result.Session.LastManualPrompt, "LOCAL WORKFLOW OBSERVATIONS") || !strings.Contains(result.Session.LastManualPrompt, "evidence: formatter supports csv and xlsx") {
		t.Fatalf("workflow evidence was not returned to ChatGPT: %q", result.Session.LastManualPrompt)
	}
}

func TestPlanFirstRejectsImplementationBundleUntilLinkedApproval(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessageWithMode(context.Background(), started.ID, "refactor UI", "plan_first")
	if err != nil {
		t.Fatal(err)
	}
	if prompted.LastRequestMode != "plan_first" {
		t.Fatalf("planning mode not persisted: %#v", prompted)
	}
	planRequestID := prompted.LastRequestID
	planFilename := expectedResponseBundleFilename(prompted, planRequestID)
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, planFilename, makeExecutionBundle(t, planRequestID)); err == nil || !strings.Contains(err.Error(), "plan-first") {
		t.Fatalf("expected plan-first implementation rejection, got %v", err)
	}
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, planFilename, makePlanBundle(t, planRequestID))
	if err != nil {
		t.Fatal(err)
	}
	if result.AutoExecuted || result.AutoApplied || result.Session.State != "awaiting_plan_approval" || result.Session.LastTurn == nil || result.Session.LastTurn.Kind != domain.TurnKindPlan {
		t.Fatalf("plan proposal must wait for explicit approval: %#v", result)
	}

	_, approved, err := service.SubmitPlanApproval(context.Background(), started.ID, planRequestID)
	if err != nil {
		t.Fatal(err)
	}
	if approved.LastRequestID == planRequestID || approved.LastRequestMode != "approve_plan" {
		t.Fatalf("approval must create a distinct continuation: %#v", approved)
	}
	lineage, ok := approved.RequestLineages[approved.LastRequestID]
	if !ok || lineage.Kind != requestKindPlanApproval || lineage.ParentRequestID != planRequestID || lineage.RootRequestID != planRequestID {
		t.Fatalf("approval lineage mismatch: %#v", lineage)
	}
	if !strings.Contains(approved.LastManualPrompt, "REQUEST STRATEGY: APPROVE_PLAN") || !strings.Contains(approved.LastManualPrompt, "Refatorar o fluxo de aprovação") {
		t.Fatalf("approval prompt did not preserve the approved proposal: %q", approved.LastManualPrompt)
	}
	expectedFilename := expectedResponseBundleFilename(approved, approved.LastRequestID)
	if !strings.Contains(approved.LastManualPrompt, expectedFilename) {
		t.Fatalf("approval prompt did not use the derived canonical filename %q", expectedFilename)
	}
	if approved.ApprovedChatPlan == nil || !strings.Contains(approved.LastManualPrompt, approved.ApprovedChatPlan.SHA256) {
		t.Fatalf("approval continuation did not persist and transport the approved chat plan: %#v", approved.ApprovedChatPlan)
	}
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, expectedFilename, makeV2ExecutionBundle(t, approved.LastRequestID, true, nil)); err == nil || !strings.Contains(err.Error(), "approved_chat_plan") {
		t.Fatalf("approved implementation without its exact chat-plan binding must be rejected, got %v", err)
	}
	implementation, err := service.SubmitExecutionBundle(context.Background(), started.ID, expectedFilename, makeV2ExecutionBundle(t, approved.LastRequestID, true, approved.ApprovedChatPlan))
	if err != nil {
		t.Fatal(err)
	}
	if !implementation.AutoExecuted || !implementation.AutoApplied || implementation.Session.State != "applied" {
		t.Fatalf("approved chat plan must authorize its bound Protected Auto implementation through host Apply: %#v", implementation)
	}
	if _, _, err := service.SubmitPlanApproval(context.Background(), started.ID, planRequestID); err == nil {
		t.Fatal("duplicate approval must not create a second continuation")
	}
}

func TestDirectRequestCanReturnPlanProposalWithoutPlanToggle(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "Elabora um plano para reorganizar o fluxo")
	if err != nil {
		t.Fatal(err)
	}
	if prompted.LastRequestMode != "direct" {
		t.Fatalf("direct mode unexpectedly changed: %#v", prompted)
	}
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, expectedResponseBundleFilename(prompted, prompted.LastRequestID), makePlanBundle(t, prompted.LastRequestID))
	if err != nil {
		t.Fatal(err)
	}
	if result.Session.State != "awaiting_plan_approval" || result.Session.LastTurn == nil || result.Session.LastTurn.Kind != domain.TurnKindPlan {
		t.Fatalf("direct explicit plan was not recognized as an approval proposal: %#v", result.Session)
	}
}

func TestAutoAnswerBundleDoesNotExecuteOrApply(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "Para que serve esta configuração?")
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+prompted.LastRequestID+".zip", makeAnswerBundle(t, prompted.LastRequestID))
	if err != nil {
		t.Fatal(err)
	}
	if result.AutoExecuted || result.AutoApplied {
		t.Fatalf("answer must never enter the execution pipeline: %#v", result)
	}
	if result.Session.State != "answered" || result.Session.LastTurn == nil || result.Session.LastTurn.Kind != domain.TurnKindAnswer {
		t.Fatalf("answer was not persisted as a conversational outcome: %#v", result.Session)
	}
}

func TestExecutionBundleRequiresAuthoritativeFilenameAndReplaysIdempotently(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	started, err = service.SetChatID(started.ID, "chat-owner")
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "Explique o projeto")
	if err != nil {
		t.Fatal(err)
	}
	bundle := makeAnswerBundle(t, prompted.LastRequestID)
	wrongName := "whx_bundle_res_system_" + prompted.LastRequestID + ".zip"
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, wrongName, bundle); !errors.Is(err, ErrExecutionBundleRequestMismatch) {
		t.Fatalf("non-authoritative filename error = %v", err)
	}
	expectedName := expectedResponseBundleFilename(prompted, prompted.LastRequestID)
	first, err := service.SubmitExecutionBundle(context.Background(), started.ID, expectedName, bundle)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.SubmitExecutionBundle(context.Background(), started.ID, expectedName, bundle)
	if err != nil {
		t.Fatalf("ack replay should be idempotent: %v", err)
	}
	if second.Session.State != first.Session.State || second.Session.LastBundle == nil || second.Session.LastBundle.SHA256 != first.Session.LastBundle.SHA256 {
		t.Fatalf("idempotent replay changed the accepted result: first=%#v second=%#v", first.Session, second.Session)
	}
}

func TestRetryableFailedPlannerOutcomePreparesOneFreshAutoRequestWithoutExecution(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "Analisa este projeto")
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+prompted.LastRequestID+".zip", makeFailedBundle(t, prompted.LastRequestID))
	if err != nil {
		t.Fatal(err)
	}
	if result.AutoExecuted || result.Session.State != "awaiting_plan" || result.Session.Plan != nil || !result.RemoteRecoveryPrepared {
		t.Fatalf("failed planner outcome reached execution state: %#v", result)
	}
	if result.Session.LastRequestID == prompted.LastRequestID || result.Session.RemoteRecoveryAttempt != 1 || !strings.Contains(result.AutoError, "context_unavailable") {
		t.Fatalf("failed planner outcome did not produce bounded fresh recovery: %#v", result)
	}
}

func TestAutoBundleExecutesSandboxAndAppliesHost(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "change hello")
	if err != nil {
		t.Fatal(err)
	}
	bundle := makeExecutionBundle(t, prompted.LastRequestID)
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+prompted.LastRequestID+".zip", bundle)
	if err != nil {
		t.Fatal(err)
	}
	if !result.AutoExecuted || !result.AutoApplied || result.Session.State != "applied" {
		t.Fatalf("unexpected auto result: %#v", result)
	}
	if result.Session.PendingKnowledgeReviewRequestID != "" {
		t.Fatalf("new successful auto apply must not schedule a separate knowledge-review request: %#v", result.Session)
	}
	if result.Session.LastHostAppliedAt.IsZero() {
		t.Fatal("successful auto apply must retain the host-apply timestamp")
	}
	contents, err := os.ReadFile(filepath.Join(root, "hello.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new\n" {
		t.Fatalf("host patch was not applied: %q", contents)
	}
	if result.Session.LastBundle == nil || len(result.Session.LastBundle.Patches) != 1 {
		t.Fatalf("bundle metadata missing: %#v", result.Session.LastBundle)
	}
}

func TestApprovedProtectedAutoExecutionAlsoAppliesHost(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "change hello")
	if err != nil {
		t.Fatal(err)
	}
	submission, err := service.SubmitExecutionBundle(context.Background(), started.ID, expectedResponseBundleFilename(prompted, prompted.LastRequestID), makeV2ExecutionBundle(t, prompted.LastRequestID, true, nil))
	if err != nil {
		t.Fatal(err)
	}
	if submission.AutoExecuted || submission.AutoApplied || submission.Session.State != "planned" {
		t.Fatalf("approval-gated execution should pause before local work: %#v", submission)
	}
	_, applied, err := service.Execute(context.Background(), started.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if applied.State != "applied" || len(applied.PendingHostChanges) != 0 {
		t.Fatalf("one informed approval must cover sandbox execution and Protected Auto Apply: %#v", applied)
	}
	contents, err := os.ReadFile(filepath.Join(root, "hello.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new\n" {
		t.Fatalf("approved change was not applied to host: %q", contents)
	}
}

func TestApprovedProtectedManualExecutionAlsoAppliesHost(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.txt"), []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "change hello")
	if err != nil {
		t.Fatal(err)
	}
	submission, err := service.SubmitExecutionBundle(context.Background(), started.ID, expectedResponseBundleFilename(prompted, prompted.LastRequestID), makeV2ExecutionBundle(t, prompted.LastRequestID, true, nil))
	if err != nil {
		t.Fatal(err)
	}
	if submission.AutoExecuted || submission.AutoApplied || submission.Session.State != "planned" {
		t.Fatalf("manual automation should still wait for the execution decision: %#v", submission)
	}
	_, applied, err := service.Execute(context.Background(), started.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	if applied.State != "applied" || len(applied.PendingHostChanges) != 0 {
		t.Fatalf("one informed approval must cover sandbox execution and host integration even in manual automation: %#v", applied)
	}
	contents, err := os.ReadFile(filepath.Join(root, "hello.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new\n" {
		t.Fatalf("approved manual-mode change was not applied to host: %q", contents)
	}
}

func TestAutoModeRequiresProtected(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	if _, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeUnprotected, domain.AutomationModeAuto); err == nil {
		t.Fatal("expected auto/unprotected rejection")
	}
}

func TestStartSessionCreatesWhanessProjectConfig(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "whaness.yml")); err != nil {
		t.Fatalf("whaness.yml was not created: %v", err)
	}
	cfg, err := service.ProjectConfig(started.ID)
	if err != nil || !cfg.Context.AutoExclude {
		t.Fatalf("unexpected project config: cfg=%+v err=%v", cfg, err)
	}
}

func TestUpdateProjectConfigRebuildsContext(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "docs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "main.go"), []byte("package main\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "docs", "notes.md"), []byte("notes\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := service.ProjectConfig(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Context.Exclude = []string{"docs/**"}
	_, updated, err := service.UpdateProjectConfig(started.ID, cfg)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range updated.Context.Manifest.Files {
		if file.Path == "docs/notes.md" {
			t.Fatal("excluded docs file remained in rebuilt context")
		}
	}
}

func makePolicyBlockedBundle(t *testing.T, requestID string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	entries := map[string]string{
		"README.md": "# Docker attempt\nThis intentionally exercises Policy repair.\n",
		"plan.json": `{"protocol":"harness.execution/v1","plan_id":"blocked-docker","request_id":"` + requestID + `","status":"ready","summary":"run docker compose","version_increment":{"component":"patch","amount":1},"commit_message":"build(deploy): validate the compose configuration","risk":"high","requires_approval":false,"operations":[{"type":"command","patch":"","command":{"argv":["docker","compose","config","--quiet"],"cwd":".","timeout_seconds":30,"network":false,"expected_exit_codes":[0]}}],"verification":[]}`,
	}
	addV2ResponseArtifacts(entries, "Resumo cumulativo da tentativa bloqueada pela Policy.")
	for name, value := range entries {
		entry, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestAutoPolicyBlockedBundleExplainsAndPreparesRepair(t *testing.T) {
	root := t.TempDir()
	bus := audit.NewBus()
	service := NewService(session.NewStore(), bus, contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "crie uma stack docker")
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+prompted.LastRequestID+".zip", makePolicyBlockedBundle(t, prompted.LastRequestID))
	if err != nil {
		t.Fatal(err)
	}
	if !result.PolicyBlocked || result.AutoExecuted || result.AutoApplied {
		t.Fatalf("blocked policy must not execute: %#v", result)
	}
	if len(result.PolicyReasons) == 0 || !strings.Contains(strings.Join(result.PolicyReasons, " "), `executable "docker" is denied`) {
		t.Fatalf("policy reason was not surfaced: %#v", result.PolicyReasons)
	}
	if !result.RepairPrepared || result.Session.State != "repair_pending" || result.Session.LastManualPrompt == "" {
		t.Fatalf("policy block did not prepare repair: %#v", result.Session)
	}
	if !strings.Contains(result.Session.LastManualPrompt, "AUTOMATIC POLICY REPAIR REQUEST") || !strings.Contains(result.Session.LastManualPrompt, "docker") {
		t.Fatalf("repair prompt lost policy evidence: %q", result.Session.LastManualPrompt)
	}
	seen := false
	for _, event := range bus.History(started.ID) {
		if event.Type == "automation.policy_blocked" {
			seen = true
		}
	}
	if !seen {
		t.Fatal("expected automation.policy_blocked audit event")
	}
}

func TestRetryPolicyRepairPreparesPromptForPreviouslyBlockedManualBundle(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "crie uma stack docker")
	if err != nil {
		t.Fatal(err)
	}
	blocked, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+prompted.LastRequestID+".zip", makePolicyBlockedBundle(t, prompted.LastRequestID))
	if err != nil {
		t.Fatal(err)
	}
	if blocked.Session.Policy == nil || blocked.Session.Policy.Allowed {
		t.Fatalf("expected a persisted policy block: %#v", blocked)
	}

	repaired, err := service.RetryPolicyRepair(context.Background(), started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if repaired.State != "repair_pending" || repaired.LastManualPrompt == "" || len(repaired.PendingManualRequestIDs) != 1 {
		t.Fatalf("expected a pending correction prompt: %#v", repaired)
	}
	if !strings.Contains(repaired.LastManualPrompt, "AUTOMATIC POLICY REPAIR REQUEST") || !strings.Contains(repaired.LastManualPrompt, `executable "docker" is denied`) {
		t.Fatalf("repair prompt did not retain the policy reason: %q", repaired.LastManualPrompt)
	}
}

func TestRetryPolicyRepairReturnsPendingPromptWhenBundleWasNotPersisted(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "corrija a recuperação de bundles")
	if err != nil {
		t.Fatal(err)
	}
	if prompted.State != "awaiting_plan" || prompted.LastManualPrompt == "" || prompted.LastRequestID == "" {
		t.Fatalf("expected a pending manual prompt: %#v", prompted)
	}

	reprocessed, err := service.RetryPolicyRepair(context.Background(), started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reprocessed.ID != prompted.ID || reprocessed.LastRequestID != prompted.LastRequestID || reprocessed.LastManualPrompt != prompted.LastManualPrompt {
		t.Fatalf("pending prompt changed during reprocess: %#v", reprocessed)
	}
}

func TestStorageUsageAndClearAllDataDoNotDeleteProject(t *testing.T) {
	project := t.TempDir()
	marker := filepath.Join(project, "keep.txt")
	if err := os.WriteFile(marker, []byte("host project\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	stateFile := filepath.Join(t.TempDir(), "sessions.json")
	store, err := session.NewPersistentStore(stateFile)
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	started, err := service.StartSession(context.Background(), project)
	if err != nil {
		t.Fatal(err)
	}
	usage := service.StorageUsage()
	if usage.TotalBytes <= 0 || usage.ContextBytes <= 0 || len(usage.Projects) != 1 || usage.Projects[0].ProjectPath != started.ProjectPath {
		t.Fatalf("unexpected storage usage: %#v", usage)
	}
	if err := service.ClearAllData(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("host project must survive Wharnex reset: %v", err)
	}
	if _, err := store.Get(started.ID); !errors.Is(err, session.ErrNotFound) {
		t.Fatalf("session state was not cleared: %v", err)
	}
}

func TestClearAllDataDoesNotSweepForeignActiveWorkspace(t *testing.T) {
	foreign, err := os.MkdirTemp("", "kernl-workspace-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(foreign)
	marker := filepath.Join(foreign, "package.json")
	if err := os.WriteFile(marker, []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	if err := service.ClearAllData(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("foreign active workspace must survive reset: %v", err)
	}
}

func TestWorkflowRoundLimitKeepsTerminalRequestPending(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), workflowEvidenceRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, prompted, err := service.SubmitMessage(context.Background(), started.ID, "Investigue até ter evidência suficiente.")
	if err != nil {
		t.Fatal(err)
	}
	requestID := prompted.LastRequestID
	if _, err := service.store.Update(started.ID, func(item *domain.Session) error {
		item.WorkflowRound = maxWorkflowRounds
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, "whx_bundle_res_system_"+requestID+".zip", makeWorkflowBundle(t, requestID)); err == nil || !strings.Contains(err.Error(), "workflow round limit reached") {
		t.Fatalf("expected workflow round limit rejection, got %v", err)
	}
	current, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !containsString(current.PendingManualRequestIDs, requestID) {
		t.Fatalf("terminal request should remain pending after rejecting an extra workflow round: %#v", current.PendingManualRequestIDs)
	}
}

func TestAutoSelfEvolutionRunsProjectVerificationAndReachesRestartPending(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"Makefile":                      "build-stage:\n\t@true\n",
		"scripts/start.sh":              "#!/usr/bin/env sh\nexit 0\n",
		"scripts/stop.sh":               "#!/usr/bin/env sh\nexit 0\n",
		"scripts/self-restart.sh":       "#!/usr/bin/env sh\nexit 0\n",
		"scripts/stack.sh":              "#!/usr/bin/env sh\nexit 0\n",
		"services/backend/go.mod":       "module example.invalid/self-auto\n",
		"services/desktop/package.json": "{}\n",
		"auto.txt":                      "old\n",
	}
	for relative, content := range files {
		absolute := filepath.Join(root, relative)
		if err := os.MkdirAll(filepath.Dir(absolute), 0o755); err != nil {
			t.Fatal(err)
		}
		mode := os.FileMode(0o644)
		if strings.HasPrefix(relative, "scripts/") {
			mode = 0o755
		}
		if err := os.WriteFile(absolute, []byte(content), mode); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("WHARNESS_ROOT", root)
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "self-auto-project-verification", Status: "ready", Summary: "verify and evolve", Risk: "low",
		Operations:   []domain.Operation{{Type: "apply_patch", Patch: "--- a/auto.txt\n+++ b/auto.txt\n@@ -1 +1 @@\n-old\n+new\n"}},
		Verification: []domain.CommandSpec{appCommand("node", "scripts/check.mjs")},
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	if !started.SelfEvolution {
		t.Fatal("expected self-evolution session")
	}
	_, updated, err := service.SubmitMessage(context.Background(), started.ID, "Atualize o próprio Wharnex")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Policy == nil || updated.Policy.RequiresApproval {
		t.Fatalf("ordinary project verification must not stop Auto self-evolution: %#v", updated.Policy)
	}
	if updated.State != "restart_pending" || updated.SelfEvolutionActivation != "restart_pending" {
		t.Fatalf("Auto self-evolution should execute, apply, build and stop only at activation confirmation: %#v", updated)
	}
	if updated.PendingKnowledgeReviewRequestID != "" {
		t.Fatalf("Auto self-evolution must not schedule a separate final knowledge review: %#v", updated)
	}
	contents, err := os.ReadFile(filepath.Join(root, "auto.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new\n" {
		t.Fatalf("self-evolution host patch was not applied automatically: %q", contents)
	}
	status, err := service.selfEvolution.LastStatus()
	if err != nil {
		t.Fatal(err)
	}
	transaction, err := service.selfEvolution.TransactionForStatus(status)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.selfEvolution.RecordStatus(transaction, started.ID, updated.Plan.PlanID, "restarted", "new Wharnex runtime is healthy"); err != nil {
		t.Fatal(err)
	}
	restarted := NewService(service.store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	reconciled, err := restarted.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reconciled.State != "applied" || reconciled.SelfEvolutionActivation != "" {
		t.Fatalf("successful restart should reconcile to terminal applied state: %#v", reconciled)
	}
	if _, _, err := restarted.Execute(context.Background(), started.ID, false); err == nil || !strings.Contains(err.Error(), "already executed successfully") {
		t.Fatalf("completed self-evolution plan must be single-shot after restart, got %v", err)
	}
}

func TestLaterHealthyRestartReconcilesOlderPendingActivation(t *testing.T) {
	root := t.TempDir()
	store := session.NewStore()
	bus := audit.NewBus()
	appliedAt := time.Date(2026, 9, 16, 17, 52, 17, 0, time.UTC)
	pending := domain.Session{
		ID: "ses-older", ProjectPath: root, ExecutionMode: domain.ExecutionModeProtected,
		SelfEvolution: true, SelfEvolutionActivation: "restart_pending", State: "restart_pending",
		LastHostAppliedAt: appliedAt, LastRepairError: "host build passed; explicit restart confirmation pending",
	}
	if err := store.Put(pending); err != nil {
		t.Fatal(err)
	}
	service := &Service{store: store, bus: bus, selfEvolution: selfevolution.New(root)}
	service.reconcileEarlierRestartPending(selfevolution.Status{
		Phase: "restarted", PlanID: "newer-plan", UpdatedAt: "2026-09-16T18:47:14Z",
	})
	reconciled, err := store.Get(pending.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reconciled.State != "applied" || reconciled.SelfEvolutionActivation != "" || reconciled.LastRepairError != "" {
		t.Fatalf("later healthy restart did not clear stale activation: %#v", reconciled)
	}
	found := false
	for _, event := range bus.History(pending.ID) {
		found = found || event.Type == "self_evolution.activation_reconciled"
	}
	if !found {
		t.Fatal("expected durable activation reconciliation evidence")
	}
}

func TestAutoApprovalPauseReturnsActionableError(t *testing.T) {
	root := t.TempDir()
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "explicit-approval", Status: "ready", Summary: "approval", Risk: "low", RequiresApproval: true,
		Operations: []domain.Operation{{Type: "command", Command: appCommand("go", "test", "./...")}},
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), fakeRunner{})
	started, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, updated, err := service.SubmitMessage(context.Background(), started.ID, "Execute")
	if err != nil {
		t.Fatal(err)
	}
	if updated.State != "planned" {
		t.Fatalf("explicit approval plan must remain planned, got %s", updated.State)
	}
	current, err := service.store.Get(started.ID)
	if err != nil {
		t.Fatal(err)
	}
	result := service.runAutomaticPlan(context.Background(), started.ID, "test")
	if !strings.Contains(result.AutoError, "still requires explicit approval") || result.AutoExecuted {
		t.Fatalf("approval gate should be visible and non-executing: result=%#v session=%#v", result, current)
	}
}

func TestSelfEvolutionRootIsForcedToProtectedMode(t *testing.T) {
	root := t.TempDir()
	for path, content := range map[string]string{
		"Makefile":                      "all:\n\t@true\n",
		"scripts/start.sh":              "#!/usr/bin/env sh\nexit 0\n",
		"services/backend/go.mod":       "module example.invalid/self\n",
		"services/desktop/package.json": "{}\n",
	} {
		absolute := filepath.Join(root, path)
		if err := os.MkdirAll(filepath.Dir(absolute), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(absolute, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("WHARNESS_ROOT", root)
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	forced, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeUnprotected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if forced.ExecutionMode != domain.ExecutionModeProtected || !forced.SelfEvolution {
		t.Fatalf("self-evolution should transparently force a restored Unprotected preference back to Protected: %#v", forced)
	}
	created, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeManual)
	if err != nil {
		t.Fatal(err)
	}
	if !created.SelfEvolution {
		t.Fatal("expected session to be marked as self-evolution")
	}
	if _, err := service.SetExecutionMode(created.ID, domain.ExecutionModeUnprotected); err == nil || !strings.Contains(err.Error(), "locked to Protected") {
		t.Fatalf("self-evolution should reject later Unprotected switch, got %v", err)
	}
	if _, err := store.Update(created.ID, func(item *domain.Session) error {
		item.Plan = &domain.ExecutionPlan{PlanID: "plan-runtime-rollback"}
		item.State = "applied"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	statusDir := filepath.Join(root, ".harness", "self-evolution")
	if err := os.MkdirAll(statusDir, 0o700); err != nil {
		t.Fatal(err)
	}
	status := "phase=rollback_restored\nsession_id=" + created.ID + "\nplan_id=plan-runtime-rollback\ndetail=previous runtime restored\n"
	if err := os.WriteFile(filepath.Join(statusDir, "status"), []byte(status), 0o600); err != nil {
		t.Fatal(err)
	}
	restarted := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), fakeRunner{})
	reconciled, err := restarted.store.Get(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reconciled.State != "verified" || reconciled.LastRepairError != "previous runtime restored" {
		t.Fatalf("runtime rollback should reconcile session to retryable verified state: %#v", reconciled)
	}
}

func TestAppliedPatchCanBeRevertedToPreviousHostState(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "rollback.txt")
	if err := os.WriteFile(path, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "revert-change", Status: "ready", Summary: "update rollback", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/rollback.txt\n+++ b/rollback.txt\n@@ -1 +1 @@\n-old\n+new\n"}},
	}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), sandbox.NewLocalRunner())
	s, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, applied, err := service.SubmitMessage(context.Background(), s.ID, "Atualize rollback.txt")
	if err != nil {
		t.Fatal(err)
	}
	if applied.State != "applied" {
		t.Fatalf("expected applied state, got %s", applied.State)
	}
	reverted, err := service.RevertHostChange(context.Background(), s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reverted.State != "reverted" {
		t.Fatalf("expected reverted state, got %s", reverted.State)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "old\n" {
		t.Fatalf("revert produced %q", contents)
	}
	if len(reverted.LastRevertedChanges) != 1 || reverted.LastRevertedChanges[0].Plan.PlanID != plan.PlanID {
		t.Fatalf("revert must retain the exact applied batch for redo: %#v", reverted.LastRevertedChanges)
	}
	restored, err := service.RestoreRevertedHostChange(context.Background(), s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if restored.State != "applied" || len(restored.LastRevertedChanges) != 0 || len(restored.LastAppliedChanges) != 1 {
		t.Fatalf("restore should make the reverted batch applied again: %#v", restored)
	}
	contents, err = os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new\n" {
		t.Fatalf("restore produced %q", contents)
	}
}

func TestRestoreRevertedPatchFailurePreparesDistinctChatGPTRequest(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "restore-conflict.txt")
	if err := os.WriteFile(path, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "restore-conflict", Status: "ready", Summary: "update restore conflict", Risk: "low",
		Operations: []domain.Operation{{Type: "apply_patch", Patch: "--- a/restore-conflict.txt\n+++ b/restore-conflict.txt\n@@ -1 +1 @@\n-old\n+new\n"}},
	}
	store := session.NewStore()
	service := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{plan}, policy.NewEngine(), sandbox.NewLocalRunner())
	s, err := service.StartSessionWithModes(context.Background(), root, domain.ExecutionModeProtected, domain.AutomationModeAuto)
	if err != nil {
		t.Fatal(err)
	}
	_, applied, err := service.SubmitMessage(context.Background(), s.ID, "Atualize restore-conflict.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.RevertHostChange(context.Background(), applied.ID); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("drifted\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	recoveryService := NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manualplanner.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	recovery, err := recoveryService.RestoreRevertedHostChange(context.Background(), s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recovery.State != "repair_pending" || recovery.LastManualPrompt == "" {
		t.Fatalf("restore conflict should prepare a ChatGPT continuation: state=%s prompt=%q", recovery.State, recovery.LastManualPrompt)
	}
	if !strings.Contains(recovery.LastManualPrompt, "REVERT RESTORE RECOVERY REQUEST") {
		t.Fatalf("restore prompt must identify its recovery purpose: %s", recovery.LastManualPrompt)
	}
	lineage := recovery.RequestLineages[recovery.LastRequestID]
	if lineage.Kind != requestKindRevertRestore {
		t.Fatalf("restore recovery must use distinct lineage kind, got %#v", lineage)
	}
	if len(recovery.LastRevertedChanges) != 1 {
		t.Fatalf("failed direct restore must retain the redo candidate: %#v", recovery.LastRevertedChanges)
	}
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "drifted\n" {
		t.Fatalf("failed restore must preserve current host content, got %q", contents)
	}
}
