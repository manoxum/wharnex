package app

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

type recordingTerminal struct {
	writes     []string
	cols, rows uint16
	closed     bool
}

func (t *recordingTerminal) Write(data []byte) error {
	t.writes = append(t.writes, string(data))
	return nil
}
func (t *recordingTerminal) Resize(cols, rows uint16) error {
	t.cols, t.rows = cols, rows
	return nil
}
func (t *recordingTerminal) Close() error { t.closed = true; return nil }

type interactiveRecordingRunner struct {
	workspace sandbox.Workspace
	options   sandbox.TerminalOptions
	terminal  *recordingTerminal
	terminals []*recordingTerminal
}

func (r *interactiveRecordingRunner) Prepare(_ context.Context, projectRoot string) (sandbox.Workspace, error) {
	r.workspace = sandbox.Workspace{Path: projectRoot, SourcePath: projectRoot}
	return r.workspace, nil
}
func (*interactiveRecordingRunner) ApplyPatch(context.Context, sandbox.Workspace, string) (domain.CommandResult, error) {
	return domain.CommandResult{}, errors.New("unexpected patch")
}
func (*interactiveRecordingRunner) Run(context.Context, sandbox.Workspace, domain.CommandSpec) (domain.CommandResult, error) {
	return domain.CommandResult{}, errors.New("unexpected one-shot command")
}
func (*interactiveRecordingRunner) Cleanup(sandbox.Workspace) error { return nil }
func (r *interactiveRecordingRunner) StartInteractive(_ sandbox.Workspace, options sandbox.TerminalOptions, onOutput func([]byte), _ func(int, error)) (sandbox.InteractiveTerminal, error) {
	r.options = options
	r.terminal = &recordingTerminal{}
	r.terminals = append(r.terminals, r.terminal)
	onOutput([]byte("shell ready\r\n"))
	return r.terminal, nil
}

func TestInteractiveTerminalCarriesOpaquePTYInputWithoutPersistingIt(t *testing.T) {
	root := t.TempDir()
	runner := &interactiveRecordingRunner{}
	bus := audit.NewBus()
	service := NewService(session.NewStore(), bus, contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), runner)
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	descriptor, err := service.StartInteractiveTerminal(context.Background(), started.ID, domain.TerminalTargetSandbox, ".", false, 120, 40)
	if err != nil {
		t.Fatal(err)
	}
	replay, _, cancel, err := service.SubscribeInteractiveTerminal(started.ID, descriptor.TerminalID)
	if err != nil {
		t.Fatal(err)
	}
	defer cancel()
	if len(replay) != 2 || replay[0].Type != "output" || replay[1].Type != "ready" {
		t.Fatalf("terminal replay did not preserve startup frames: %#v", replay)
	}
	input := "vim README.md\nbash -c 'printf changed > file'\n"
	if err := service.WriteInteractiveTerminal(started.ID, descriptor.TerminalID, input); err != nil {
		t.Fatal(err)
	}
	if err := service.ResizeInteractiveTerminal(started.ID, descriptor.TerminalID, 999, 1); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(runner.terminal.writes, ""); got != input {
		t.Fatalf("PTY input changed in transit: %q", got)
	}
	if runner.terminal.cols != 300 || runner.terminal.rows != 24 {
		t.Fatalf("terminal size was not bounded: %dx%d", runner.terminal.cols, runner.terminal.rows)
	}
	for _, event := range bus.History(started.ID) {
		if strings.Contains(strings.Join(mapValues(event.Data), " "), "printf changed") {
			t.Fatalf("raw PTY input leaked into durable audit: %#v", event)
		}
	}
	if err := service.CloseInteractiveTerminal(started.ID, descriptor.TerminalID); err != nil || !runner.terminal.closed {
		t.Fatalf("terminal did not close: err=%v terminal=%#v", err, runner.terminal)
	}
}

func TestInteractiveTerminalsRemainIndependentWithinOneSession(t *testing.T) {
	root := t.TempDir()
	runner := &interactiveRecordingRunner{}
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), runner)
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.StartInteractiveTerminal(context.Background(), started.ID, domain.TerminalTargetSandbox, ".", false, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.StartInteractiveTerminal(context.Background(), started.ID, domain.TerminalTargetSandbox, ".", false, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	if first.TerminalID == second.TerminalID || len(runner.terminals) != 2 {
		t.Fatalf("expected two independent PTYs, first=%q second=%q count=%d", first.TerminalID, second.TerminalID, len(runner.terminals))
	}
	if runner.terminals[0].closed {
		t.Fatal("starting a second terminal closed the first terminal")
	}
	if err := service.WriteInteractiveTerminal(started.ID, first.TerminalID, "echo first\n"); err != nil {
		t.Fatal(err)
	}
	if err := service.WriteInteractiveTerminal(started.ID, second.TerminalID, "echo second\n"); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(runner.terminals[0].writes, ""); got != "echo first\n" {
		t.Fatalf("first PTY received the wrong input: %q", got)
	}
	if got := strings.Join(runner.terminals[1].writes, ""); got != "echo second\n" {
		t.Fatalf("second PTY received the wrong input: %q", got)
	}
	if err := service.CloseInteractiveTerminal(started.ID, first.TerminalID); err != nil {
		t.Fatal(err)
	}
	if !runner.terminals[0].closed || runner.terminals[1].closed {
		t.Fatalf("closing one PTY must not close its sibling: first=%v second=%v", runner.terminals[0].closed, runner.terminals[1].closed)
	}
}

func TestInteractiveHostTerminalUsesTheRealProjectRunner(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), &interactiveRecordingRunner{})
	started, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	host := &interactiveRecordingRunner{}
	service.hostRunner = host
	if _, err := service.StartInteractiveTerminal(context.Background(), started.ID, domain.TerminalTargetHost, "src", false, 80, 24); err != nil {
		t.Fatal(err)
	}
	if host.workspace.Path != filepath.Clean(started.ProjectPath) || host.options.Cwd != "src" {
		t.Fatalf("host PTY did not receive the real project root: workspace=%#v options=%#v", host.workspace, host.options)
	}
}

func mapValues(values map[string]any) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, strings.TrimSpace(strings.ReplaceAll(strings.TrimSpace(toString(value)), "\n", " ")))
	}
	return result
}

func toString(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}
