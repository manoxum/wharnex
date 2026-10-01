package app

import (
	"errors"
	"sync"
	"time"

	"kernl.local/harness/backend/internal/domain"
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
	Generation string                `json:"generation,omitempty"`
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
	projectPath string
	generation  string
	target      domain.TerminalTarget
	terminal    sandbox.InteractiveTerminal
	frames      []TerminalFrame
	replayBytes int
	subscribers map[chan TerminalFrame]struct{}
	orphanTimer *time.Timer
	exited      bool
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
