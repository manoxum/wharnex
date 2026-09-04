package app

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	contextbundle "kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner"
	manualplanner "kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/projectconfig"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

type fakePlanner struct{ plan domain.ExecutionPlan }

func (f fakePlanner) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	plan := f.plan
	plan.RequestID = request.RequestID
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
	turn := domain.AgentTurn{Protocol: domain.TurnProtocolV1, Kind: domain.TurnKindAnswer, Message: "Esta opção mantém 12 meses de histórico."}
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

func TestAutoProviderChangeExecutesAndAppliesWithoutDownload(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "hello.txt")
	if err := os.WriteFile(path, []byte("old\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := domain.ExecutionPlan{
		Protocol: domain.ProtocolV1, PlanID: "provider-change", Status: "ready", Summary: "update hello", Risk: "low",
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

type fakeRunner struct{}

func (fakeRunner) Prepare(context.Context, string) (sandbox.Workspace, error) {
	return sandbox.Workspace{Path: "/tmp/fake"}, nil
}
func (fakeRunner) ApplyPatch(context.Context, sandbox.Workspace, string) (domain.CommandResult, error) {
	return domain.CommandResult{Argv: []string{"git", "apply"}, ExitCode: 0, Success: true}, nil
}
func (fakeRunner) Run(_ context.Context, _ sandbox.Workspace, c domain.CommandSpec) (domain.CommandResult, error) {
	return domain.CommandResult{Argv: c.Argv, Cwd: c.Cwd, ExitCode: 0, Success: true}, nil
}
func (fakeRunner) Cleanup(sandbox.Workspace) error { return nil }

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
	s, err := service.StartSession(context.Background(), root)
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

type contextCapturePlanner struct{ seen string }

func (p *contextCapturePlanner) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	data, err := os.ReadFile(request.ContextTextPath)
	if err != nil {
		return planner.Result{}, err
	}
	p.seen = string(data)
	plan := domain.ExecutionPlan{Protocol: domain.ProtocolV1, PlanID: "capture", RequestID: request.RequestID, Status: "ready", Summary: "capture", Risk: "low", Operations: []domain.Operation{}, Verification: []domain.CommandSpec{}}
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

	rawA := []byte(`{"protocol":"harness.execution/v1","plan_id":"plan-a","request_id":"` + requestA + `","status":"ready","summary":"A","risk":"low","requires_approval":false,"operations":[],"verification":[]}`)
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
	s, err := service.StartSession(context.Background(), root)
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
	raw := []byte(`{"protocol":"harness.execution/v1","plan_id":"failed-plan","request_id":"` + originalRequest + `","status":"ready","summary":"test failure","risk":"low","requires_approval":false,"operations":[],"verification":[{"argv":["npm","run","build"],"cwd":".","timeout_seconds":30,"network":false,"expected_exit_codes":[0]}]}`)
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

func makeExecutionBundle(t *testing.T, requestID string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	entries := map[string]string{
		"README.md":         "# Automatic fix\nChanges hello.txt from old to new.\n",
		"patches/001.patch": "--- a/hello.txt\n+++ b/hello.txt\n@@ -1 +1 @@\n-old\n+new\n",
		"plan.json":         `{"protocol":"harness.execution/v1","plan_id":"bundle-plan","request_id":"` + requestID + `","status":"ready","summary":"update hello","risk":"low","requires_approval":false,"operations":[{"type":"apply_patch","patch_file":"patches/001.patch","command":{"argv":[],"cwd":".","timeout_seconds":60,"network":false,"expected_exit_codes":[0]}}],"verification":[]}`,
	}
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

func makeAnswerBundle(t *testing.T, requestID string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	entries := map[string]string{
		"README.md": "# Answer\nNo project mutation is required.\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"` + requestID + `","kind":"answer","message":"A série mensal limita o histórico aos últimos 12 registos."}`,
	}
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

func makeWorkflowBundle(t *testing.T, requestID string) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	entries := map[string]string{
		"README.md": "# Investigation step\nInspect the project before answering.\n",
		"turn.json": `{"protocol":"harness.turn/v1","request_id":"` + requestID + `","kind":"workflow","message":"Vou confirmar as capacidades existentes antes de recomendar a próxima funcionalidade."}`,
		"plan.json": `{"protocol":"harness.execution/v1","plan_id":"workflow-1","request_id":"` + requestID + `","status":"ready","summary":"inspect supported formats","risk":"low","requires_approval":false,"operations":[{"type":"command","patch":"","command":{"argv":["git","status","--short"],"cwd":".","timeout_seconds":30,"network":false,"expected_exit_codes":[0]}}],"verification":[]}`,
	}
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
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "wharness-bundle-"+firstRequest+".zip", makeWorkflowBundle(t, firstRequest))
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

func TestPlanFirstRejectsImplementationBundleUntilUserApproval(t *testing.T) {
	root := t.TempDir()
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
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, "wharness-bundle-"+prompted.LastRequestID+".zip", makeExecutionBundle(t, prompted.LastRequestID)); err == nil || !strings.Contains(err.Error(), "plan-first") {
		t.Fatalf("expected plan-first implementation rejection, got %v", err)
	}
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "wharness-bundle-"+prompted.LastRequestID+".zip", makeAnswerBundle(t, prompted.LastRequestID))
	if err != nil {
		t.Fatal(err)
	}
	if result.AutoExecuted || result.AutoApplied || result.Session.State != "answered" {
		t.Fatalf("plan proposal must stay terminal: %#v", result)
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
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "wharness-bundle-"+prompted.LastRequestID+".zip", makeAnswerBundle(t, prompted.LastRequestID))
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
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "wharness-bundle-"+prompted.LastRequestID+".zip", bundle)
	if err != nil {
		t.Fatal(err)
	}
	if !result.AutoExecuted || !result.AutoApplied || result.Session.State != "applied" {
		t.Fatalf("unexpected auto result: %#v", result)
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
		"plan.json": `{"protocol":"harness.execution/v1","plan_id":"blocked-docker","request_id":"` + requestID + `","status":"ready","summary":"run docker compose","risk":"high","requires_approval":false,"operations":[{"type":"command","patch":"","command":{"argv":["docker","compose","config","--quiet"],"cwd":".","timeout_seconds":30,"network":false,"expected_exit_codes":[0]}}],"verification":[]}`,
	}
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
	result, err := service.SubmitExecutionBundle(context.Background(), started.ID, "wharness-bundle-"+prompted.LastRequestID+".zip", makePolicyBlockedBundle(t, prompted.LastRequestID))
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
		t.Fatalf("host project must survive Wharness reset: %v", err)
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
	if _, err := service.SubmitExecutionBundle(context.Background(), started.ID, "wharness-bundle-"+requestID+".zip", makeWorkflowBundle(t, requestID)); err == nil || !strings.Contains(err.Error(), "workflow round limit reached") {
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
}
