package app

import (
	"context"
	"errors"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/session"
)

func TestInteractiveHostTerminalReconnectsByStableID(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), &interactiveRecordingRunner{})
	started, err := service.StartSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	host := &interactiveRecordingRunner{}
	service.hostRunner = host
	const terminalID = "pty_reconnect_test"
	first, err := service.StartOrReconnectInteractiveTerminal(context.Background(), started.ID, terminalID, domain.TerminalTargetHost, ".", false, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.StartOrReconnectInteractiveTerminal(context.Background(), started.ID, terminalID, domain.TerminalTargetHost, ".", false, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	if first.TerminalID != terminalID || second.TerminalID != terminalID || len(host.terminals) != 1 {
		t.Fatalf("stable terminal id created a duplicate PTY: first=%#v second=%#v count=%d", first, second, len(host.terminals))
	}
}

func TestInteractiveHostTerminalReconnectsAfterTransportExit(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), &interactiveRecordingRunner{})
	started, err := service.StartSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	host := &interactiveRecordingRunner{}
	service.hostRunner = host
	const terminalID = "pty_transport_reconnect"
	if _, err := service.StartOrReconnectInteractiveTerminal(context.Background(), started.ID, terminalID, domain.TerminalTargetHost, ".", false, 80, 24); err != nil {
		t.Fatal(err)
	}
	service.terminals[terminalID].publishExit(-1, errors.New("bridge disconnected"))
	descriptor, err := service.StartOrReconnectInteractiveTerminal(context.Background(), started.ID, terminalID, domain.TerminalTargetHost, ".", false, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	if descriptor.TerminalID != terminalID || len(host.terminals) != 2 {
		t.Fatalf("host transport exit did not reconnect stable PTY: descriptor=%#v count=%d", descriptor, len(host.terminals))
	}
}

func TestInteractiveHostTerminalRebindsStableIDToNewSessionForSameProject(t *testing.T) {
	root := t.TempDir()
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), &interactiveRecordingRunner{})
	firstSession, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	secondSession, err := service.StartSession(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	host := &interactiveRecordingRunner{}
	service.hostRunner = host
	const terminalID = "pty_project_rebind"
	if _, err := service.StartOrReconnectInteractiveTerminal(context.Background(), firstSession.ID, terminalID, domain.TerminalTargetHost, ".", false, 80, 24); err != nil {
		t.Fatal(err)
	}
	descriptor, err := service.StartOrReconnectInteractiveTerminal(context.Background(), secondSession.ID, terminalID, domain.TerminalTargetHost, ".", false, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	if descriptor.TerminalID != terminalID || len(host.terminals) != 1 {
		t.Fatalf("same-project session refresh created a duplicate PTY: descriptor=%#v count=%d", descriptor, len(host.terminals))
	}
	if err := service.WriteInteractiveTerminal(secondSession.ID, terminalID, "echo rebound\n"); err != nil {
		t.Fatalf("new project session did not own the rebound PTY: %v", err)
	}
	if err := service.WriteInteractiveTerminal(firstSession.ID, terminalID, "echo stale\n"); err == nil {
		t.Fatal("previous session still owned the PTY after project-level rebind")
	}
}

func TestInteractiveHostTerminalRejectsStableIDRebindAcrossProjects(t *testing.T) {
	service := NewService(session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), fakePlanner{}, policy.NewEngine(), &interactiveRecordingRunner{})
	firstSession, err := service.StartSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	secondSession, err := service.StartSession(context.Background(), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	host := &interactiveRecordingRunner{}
	service.hostRunner = host
	const terminalID = "pty_cross_project"
	if _, err := service.StartOrReconnectInteractiveTerminal(context.Background(), firstSession.ID, terminalID, domain.TerminalTargetHost, ".", false, 80, 24); err != nil {
		t.Fatal(err)
	}
	if _, err := service.StartOrReconnectInteractiveTerminal(context.Background(), secondSession.ID, terminalID, domain.TerminalTargetHost, ".", false, 80, 24); err == nil || err.Error() != "terminal id is already owned by another session" {
		t.Fatalf("cross-project terminal id rebind error = %v", err)
	}
}
