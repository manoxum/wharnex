package sandbox

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"
)

const maxHostPTYInputBytes = 64 * 1024

type hostPTYFrame struct {
	Type    string `json:"type"`
	ID      string `json:"id,omitempty"`
	Root    string `json:"root,omitempty"`
	Cwd     string `json:"cwd,omitempty"`
	Cols    uint16 `json:"cols,omitempty"`
	Rows    uint16 `json:"rows,omitempty"`
	Data    []byte `json:"data,omitempty"`
	Code    int    `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

type bridgedHostTerminal struct {
	conn     net.Conn
	encoder  *json.Encoder
	writeMu  sync.Mutex
	stateMu  sync.Mutex
	closed   bool
	exitOnce sync.Once
	onExit   func(int, error)
}

func startBridgedHostTerminal(socketPath string, workspace Workspace, options TerminalOptions, onOutput func([]byte), onExit func(int, error)) (InteractiveTerminal, error) {
	conn, err := net.DialTimeout("unix", socketPath, 2*time.Second)
	if err != nil {
		return nil, fmt.Errorf("connect host PTY bridge %s: %w", socketPath, err)
	}
	terminal := &bridgedHostTerminal{conn: conn, encoder: json.NewEncoder(conn), onExit: onExit}
	start := hostPTYFrame{Type: "start", ID: options.ID, Root: workspace.Path, Cwd: options.Cwd, Cols: options.Cols, Rows: options.Rows}
	if err := terminal.send(start); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("start host PTY bridge: %w", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	decoder := json.NewDecoder(conn)
	var first hostPTYFrame
	if err := decoder.Decode(&first); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("host PTY bridge handshake: %w", err)
	}
	_ = conn.SetReadDeadline(time.Time{})
	if first.Type == "error" {
		_ = conn.Close()
		if first.Message == "" {
			first.Message = "host PTY bridge rejected the session"
		}
		return nil, errors.New(first.Message)
	}
	if first.Type != "started" {
		_ = conn.Close()
		return nil, fmt.Errorf("host PTY bridge returned unexpected handshake frame %q", first.Type)
	}
	go terminal.readFrames(decoder, onOutput)
	return terminal, nil
}

func (t *bridgedHostTerminal) send(frame hostPTYFrame) error {
	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	return t.encoder.Encode(frame)
}

func (t *bridgedHostTerminal) Write(data []byte) error {
	if len(data) == 0 {
		return nil
	}
	if len(data) > maxHostPTYInputBytes {
		return fmt.Errorf("host PTY input exceeds %d bytes", maxHostPTYInputBytes)
	}
	if t.isClosed() {
		return errors.New("host PTY is closed")
	}
	return t.send(hostPTYFrame{Type: "input", Data: data})
}

func (t *bridgedHostTerminal) Resize(cols, rows uint16) error {
	if cols == 0 || rows == 0 {
		return errors.New("host PTY dimensions must be non-zero")
	}
	if t.isClosed() {
		return errors.New("host PTY is closed")
	}
	return t.send(hostPTYFrame{Type: "resize", Cols: cols, Rows: rows})
}

func (t *bridgedHostTerminal) Close() error {
	if !t.markClosed() {
		return nil
	}
	_ = t.send(hostPTYFrame{Type: "close"})
	return t.conn.Close()
}

func (t *bridgedHostTerminal) Detach() error {
	if !t.markClosed() {
		return nil
	}
	return t.conn.Close()
}

func (t *bridgedHostTerminal) isClosed() bool {
	t.stateMu.Lock()
	defer t.stateMu.Unlock()
	return t.closed
}

func (t *bridgedHostTerminal) markClosed() bool {
	t.stateMu.Lock()
	defer t.stateMu.Unlock()
	if t.closed {
		return false
	}
	t.closed = true
	return true
}

func (t *bridgedHostTerminal) finish(code int, err error) {
	t.exitOnce.Do(func() {
		wasOpen := t.markClosed()
		_ = t.conn.Close()
		if wasOpen && t.onExit != nil {
			t.onExit(code, err)
		}
	})
}

func (t *bridgedHostTerminal) readFrames(decoder *json.Decoder, onOutput func([]byte)) {
	for {
		var frame hostPTYFrame
		if err := decoder.Decode(&frame); err != nil {
			if !t.isClosed() {
				t.finish(-1, fmt.Errorf("host PTY bridge disconnected: %w", err))
			}
			return
		}
		switch frame.Type {
		case "output":
			if len(frame.Data) > 0 && onOutput != nil {
				onOutput(frame.Data)
			}
		case "exit":
			var err error
			if frame.Message != "" {
				err = errors.New(frame.Message)
			}
			t.finish(frame.Code, err)
			return
		case "error":
			message := strings.TrimSpace(frame.Message)
			if message == "" {
				message = "host PTY bridge error"
			}
			t.finish(-1, errors.New(message))
			return
		}
	}
}
