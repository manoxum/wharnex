package app

import "errors"

func (s *Service) ownedTerminal(sessionID, terminalID string) (*terminalSessionState, error) {
	s.terminalMu.Lock()
	state := s.terminals[terminalID]
	s.terminalMu.Unlock()
	if state == nil || state.sessionID != sessionID {
		return nil, errors.New("terminal session not found")
	}
	return state, nil
}

func (state *terminalSessionState) publishOutput(data []byte) {
	state.publish(TerminalFrame{Type: "output", Data: string(data)})
}

func (state *terminalSessionState) publishExit(code int, err error) {
	state.mu.Lock()
	if state.exited {
		state.mu.Unlock()
		return
	}
	state.exited = true
	state.mu.Unlock()
	frame := TerminalFrame{Type: "exit", Code: &code}
	if err != nil && code < 0 {
		frame.Message = err.Error()
	}
	state.publish(frame)
}

func (state *terminalSessionState) publish(frame TerminalFrame) {
	state.mu.Lock()
	state.frames = append(state.frames, frame)
	state.replayBytes += len(frame.Data)
	for len(state.frames) > maxTerminalFrames || state.replayBytes > maxTerminalReplay {
		state.replayBytes -= len(state.frames[0].Data)
		state.frames = state.frames[1:]
	}
	for subscriber := range state.subscribers {
		select {
		case subscriber <- frame:
		default:
		}
	}
	state.mu.Unlock()
}

func clampTerminalSize(cols, rows int) (int, int) {
	if cols < 20 {
		cols = 80
	} else if cols > 300 {
		cols = 300
	}
	if rows < 8 {
		rows = 24
	} else if rows > 120 {
		rows = 120
	}
	return cols, rows
}
