package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/sandbox"
)

const (
	maxTerminalInputBytes = 64 * 1024
	maxTerminalFrames     = 256
	maxTerminalReplay     = 256 * 1024
)

type TerminalSessionDescriptor struct {
	TerminalID string                `json:"terminal_id"`
	Target     domain.TerminalTarget `json:"target"`
}

type TerminalFrame struct {
	Type    string `json:"type"`
	Data    string `json:"data,omitempty"`
	Code    *int   `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

type terminalSessionState struct {
	mu          sync.Mutex
	sessionID   string
	target      domain.TerminalTarget
	terminal    sandbox.InteractiveTerminal
	frames      []TerminalFrame
	replayBytes int
	subscribers map[chan TerminalFrame]struct{}
	orphanTimer *time.Timer
	exited      bool
}

func (s *Service) StartInteractiveTerminal(ctx context.Context, sessionID string, target domain.TerminalTarget, cwd string, network bool, cols, rows int) (TerminalSessionDescriptor, error) {
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
	id := ids.New("pty")
	state := &terminalSessionState{sessionID: sessionID, target: target, subscribers: make(map[chan TerminalFrame]struct{})}
	s.terminalMu.Lock()
	s.terminals[id] = state
	s.terminalMu.Unlock()
	handle, err := interactive.StartInteractive(workspace, sandbox.TerminalOptions{ID: id, Cwd: cwd, Network: network, Cols: uint16(cols), Rows: uint16(rows)}, state.publishOutput, func(code int, exitErr error) {
		state.publishExit(code, exitErr)
		s.bus.Publish(sessionID, "terminal.session_exited", map[string]any{"terminal_id": id, "target": target, "exit_code": code})
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
		state.frames = append(state.frames, TerminalFrame{Type: "ready"})
		state.orphanTimer = time.AfterFunc(30*time.Second, func() {
			state.mu.Lock()
			hasSubscribers := len(state.subscribers) > 0
			state.mu.Unlock()
			if !hasSubscribers {
				_ = s.CloseInteractiveTerminal(sessionID, id)
			}
		})
	}
	state.mu.Unlock()
	if alreadyExited {
		_ = handle.Close()
		return TerminalSessionDescriptor{}, errors.New("terminal session was closed while starting")
	}
	s.bus.Publish(sessionID, "terminal.session_started", map[string]any{"terminal_id": id, "target": target, "network": network})
	return TerminalSessionDescriptor{TerminalID: id, Target: target}, nil
}

func (s *Service) WriteInteractiveTerminal(sessionID, terminalID, data string) error {
	if len(data) == 0 || len(data) > maxTerminalInputBytes {
		return errors.New("terminal input must contain between 1 and 65536 bytes")
	}
	state, err := s.ownedTerminal(sessionID, terminalID)
	if err != nil {
		return err
	}
	state.mu.Lock()
	handle, exited := state.terminal, state.exited
	state.mu.Unlock()
	if handle == nil || exited {
		return errors.New("terminal session is closed")
	}
	return handle.Write([]byte(data))
}

func (s *Service) ResizeInteractiveTerminal(sessionID, terminalID string, cols, rows int) error {
	state, err := s.ownedTerminal(sessionID, terminalID)
	if err != nil {
		return err
	}
	cols, rows = clampTerminalSize(cols, rows)
	state.mu.Lock()
	handle, exited := state.terminal, state.exited
	state.mu.Unlock()
	if handle == nil || exited {
		return errors.New("terminal session is closed")
	}
	return handle.Resize(uint16(cols), uint16(rows))
}

func (s *Service) SubscribeInteractiveTerminal(sessionID, terminalID string) ([]TerminalFrame, <-chan TerminalFrame, func(), error) {
	state, err := s.ownedTerminal(sessionID, terminalID)
	if err != nil {
		return nil, nil, nil, err
	}
	channel := make(chan TerminalFrame, 64)
	state.mu.Lock()
	replay := append([]TerminalFrame(nil), state.frames...)
	if state.orphanTimer != nil {
		state.orphanTimer.Stop()
		state.orphanTimer = nil
	}
	state.subscribers[channel] = struct{}{}
	state.mu.Unlock()
	cancel := func() {
		state.mu.Lock()
		delete(state.subscribers, channel)
		if len(state.subscribers) == 0 && !state.exited {
			if state.orphanTimer != nil {
				state.orphanTimer.Stop()
			}
			state.orphanTimer = time.AfterFunc(30*time.Second, func() {
				_ = s.CloseInteractiveTerminal(sessionID, terminalID)
			})
		}
		state.mu.Unlock()
	}
	return replay, channel, cancel, nil
}

func (s *Service) CloseInteractiveTerminal(sessionID, terminalID string) error {
	state, err := s.ownedTerminal(sessionID, terminalID)
	if err != nil {
		return err
	}
	s.terminalMu.Lock()
	delete(s.terminals, terminalID)
	s.terminalMu.Unlock()
	state.mu.Lock()
	handle := state.terminal
	wasOpen := !state.exited
	state.exited = true
	if state.orphanTimer != nil {
		state.orphanTimer.Stop()
		state.orphanTimer = nil
	}
	state.mu.Unlock()
	if wasOpen {
		code := -1
		state.publish(TerminalFrame{Type: "exit", Code: &code, Message: "terminal session closed"})
	}
	if handle != nil {
		_ = handle.Close()
	}
	s.bus.Publish(sessionID, "terminal.session_closed", map[string]any{"terminal_id": terminalID, "target": state.target})
	return nil
}

func (s *Service) closeInteractiveTerminals(sessionID string) {
	s.terminalMu.Lock()
	states := make([]*terminalSessionState, 0)
	for id, state := range s.terminals {
		if state.sessionID == sessionID {
			states = append(states, state)
			delete(s.terminals, id)
		}
	}
	s.terminalMu.Unlock()
	for _, state := range states {
		state.mu.Lock()
		handle := state.terminal
		wasOpen := !state.exited
		state.exited = true
		if state.orphanTimer != nil {
			state.orphanTimer.Stop()
			state.orphanTimer = nil
		}
		state.mu.Unlock()
		if wasOpen {
			code := -1
			state.publish(TerminalFrame{Type: "exit", Code: &code, Message: "terminal session closed"})
		}
		if handle != nil {
			_ = handle.Close()
		}
	}
}
