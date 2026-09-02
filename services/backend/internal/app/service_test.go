package app

import (
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
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

type fakePlanner struct{ plan domain.ExecutionPlan }

func (f fakePlanner) Plan(_ context.Context, request planner.Request) (planner.Result, error) {
	plan := f.plan
	plan.RequestID = request.RequestID
	return planner.Result{Plan: &plan}, nil
}

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
	s, err := service.StartSession(context.Background(), root)
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
	_, err = service.RunTerminal(context.Background(), s.ID, domain.CommandSpec{Argv: []string{"bash", "-c", "echo unsafe"}, Cwd: ".", TimeoutSeconds: 30, ExpectedExitCodes: []int{0}})
	if err == nil || !strings.Contains(err.Error(), "denied") {
		t.Fatalf("expected policy denial, got %v", err)
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

func TestManualPlanCanMatchEarlierPendingRequest(t *testing.T) {
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
	if requestA == requestB || len(s.PendingManualRequestIDs) != 2 {
		t.Fatalf("expected two distinct pending requests, got %#v", s.PendingManualRequestIDs)
	}

	rawA := []byte(`{"protocol":"harness.execution/v1","plan_id":"plan-a","request_id":"` + requestA + `","status":"ready","summary":"A","risk":"low","requires_approval":false,"operations":[],"verification":[]}`)
	s, err = service.SubmitManualPlan(s.ID, rawA)
	if err != nil {
		t.Fatalf("earlier pending request should be accepted: %v", err)
	}
	if containsString(s.PendingManualRequestIDs, requestA) || !containsString(s.PendingManualRequestIDs, requestB) {
		t.Fatalf("wrong pending request consumption: %#v", s.PendingManualRequestIDs)
	}
	if _, err := service.SubmitManualPlan(s.ID, rawA); err == nil || !strings.Contains(err.Error(), "not pending") {
		t.Fatalf("replayed plan must be rejected, got %v", err)
	}
}

func TestVerificationFailureIncludesCommandAndStderr(t *testing.T) {
	result := domain.CommandResult{ExitCode: 2, Stderr: "src/App.tsx(10,2): error TS2322: example"}
	got := fmt.Sprintf("verification failed: %s (exit %d): %s", strings.Join([]string{"npm", "run", "build"}, " "), result.ExitCode, commandResultDiagnostic(result))
	if !strings.Contains(got, "npm run build") || !strings.Contains(got, "TS2322") {
		t.Fatalf("diagnostic lost useful context: %q", got)
	}
}
