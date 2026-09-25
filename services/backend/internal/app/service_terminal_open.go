package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/sandbox"
)

func (s *Service) StartInteractiveTerminal(ctx context.Context, sessionID string, target domain.TerminalTarget, cwd string, network bool, cols, rows int) (TerminalSessionDescriptor, error) {
	return s.StartOrReconnectInteractiveTerminal(ctx, sessionID, "", target, cwd, network, cols, rows)
}

func (s *Service) StartOrReconnectInteractiveTerminal(ctx context.Context, sessionID, requestedID string, target domain.TerminalTarget, cwd string, network bool, cols, rows int) (TerminalSessionDescriptor, error) {
	item, err := s.store.Get(sessionID)
	if err != nil {
		return TerminalSessionDescriptor{}, err
	}
	if target == "" {
		target = domain.TerminalTargetSandbox
	}
	if !domain.ValidTerminalTarget(target) {
		return TerminalSessionDescriptor{}, fmt.Errorf("unsupported terminal target %q", target)
	}
	if target == domain.TerminalTargetHost && network {
		return TerminalSessionDescriptor{}, errors.New("host terminal inherits host networking")
	}
	requestedID = strings.TrimSpace(requestedID)
	if requestedID != "" {
		if target != domain.TerminalTargetHost {
			return TerminalSessionDescriptor{}, errors.New("only host terminals can reconnect by id")
		}
		if !validReconnectTerminalID(requestedID) {
			return TerminalSessionDescriptor{}, errors.New("terminal id is invalid")
		}
		if descriptor, ok, err := s.activeTerminalDescriptor(sessionID, requestedID, item.ProjectPath, target); ok || err != nil {
			return descriptor, err
		}
	}
	if strings.TrimSpace(cwd) == "" {
		cwd = "."
	}
	cols, rows = clampTerminalSize(cols, rows)

	runner := s.runner
	var workspace sandbox.Workspace
	if target == domain.TerminalTargetHost {
		runner = s.hostRunner
		workspace, err = runner.Prepare(ctx, item.ProjectPath)
	} else {
		workspace, err = s.ensureDevspace(ctx, sessionID, item.ProjectPath)
	}
	if err != nil {
		return TerminalSessionDescriptor{}, err
	}
	interactive, ok := runner.(sandbox.InteractiveTerminalRunner)
	if !ok {
		return TerminalSessionDescriptor{}, errors.New("configured runner does not support interactive terminals")
	}
	id := requestedID
	if id == "" {
		id = ids.New("pty")
	}
	state := &terminalSessionState{
		sessionID:   sessionID,
		projectPath: item.ProjectPath,
		target:      target,
		frames:      []TerminalFrame{{Type: "ready"}},
		subscribers: make(map[chan TerminalFrame]struct{}),
	}
	s.terminalMu.Lock()
	if s.terminals[id] != nil {
		s.terminalMu.Unlock()
		return TerminalSessionDescriptor{}, errors.New("terminal id is already in use")
	}
	s.terminals[id] = state
	s.terminalMu.Unlock()
	handle, err := interactive.StartInteractive(workspace, sandbox.TerminalOptions{ID: id, Cwd: cwd, Network: network, Cols: uint16(cols), Rows: uint16(rows)}, state.publishOutput, func(code int, exitErr error) {
		state.publishExit(code, exitErr)
		s.terminalMu.Lock()
		ownerSessionID := state.sessionID
		s.terminalMu.Unlock()
		s.bus.Publish(ownerSessionID, "terminal.session_exited", map[string]any{"terminal_id": id, "target": target, "exit_code": code})
	})
	if err != nil {
		s.terminalMu.Lock()
		delete(s.terminals, id)
		s.terminalMu.Unlock()
		return TerminalSessionDescriptor{}, err
	}
	state.mu.Lock()
	alreadyExited := state.exited
	if !alreadyExited {
		state.terminal = handle
		if target != domain.TerminalTargetHost {
			state.orphanTimer = s.newTerminalOrphanTimer(sessionID, id, state)
		}
	}
	state.mu.Unlock()
	if alreadyExited {
		_ = handle.Close()
		return TerminalSessionDescriptor{}, errors.New("terminal session was closed while starting")
	}
	s.bus.Publish(sessionID, "terminal.session_started", map[string]any{"terminal_id": id, "target": target, "network": network, "reconnect": requestedID != ""})
	return TerminalSessionDescriptor{TerminalID: id, Target: target}, nil
}

func (s *Service) activeTerminalDescriptor(sessionID, terminalID, projectPath string, target domain.TerminalTarget) (TerminalSessionDescriptor, bool, error) {
	s.terminalMu.Lock()
	state := s.terminals[terminalID]
	if state == nil {
		s.terminalMu.Unlock()
		return TerminalSessionDescriptor{}, false, nil
	}
	if state.target != target {
		s.terminalMu.Unlock()
		return TerminalSessionDescriptor{}, true, errors.New("terminal id is already owned by another session")
	}
	if state.sessionID != sessionID {
		if target != domain.TerminalTargetHost || state.projectPath != projectPath {
			s.terminalMu.Unlock()
			return TerminalSessionDescriptor{}, true, errors.New("terminal id is already owned by another session")
		}
		state.sessionID = sessionID
	}
	s.terminalMu.Unlock()
	state.mu.Lock()
	exited := state.exited
	state.mu.Unlock()
	if exited && target == domain.TerminalTargetHost {
		s.terminalMu.Lock()
		if s.terminals[terminalID] == state {
			delete(s.terminals, terminalID)
		}
		s.terminalMu.Unlock()
		return TerminalSessionDescriptor{}, false, nil
	}
	if exited {
		return TerminalSessionDescriptor{}, true, errors.New("terminal session is closed")
	}
	return TerminalSessionDescriptor{TerminalID: terminalID, Target: target}, true, nil
}

func validReconnectTerminalID(id string) bool {
	if len(id) < 5 || len(id) > 128 || !strings.HasPrefix(id, "pty_") {
		return false
	}
	for _, ch := range id {
		if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-' {
			continue
		}
		return false
	}
	return true
}
