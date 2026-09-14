package sandbox

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const maxHostPTYInputBytes = 64 * 1024

type hostPTYFrame struct {
	Type    string `json:"type"`
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
	if err := terminal.send(hostPTYFrame{Type: "start", Root: workspace.Path, Cwd: options.Cwd, Cols: options.Cols, Rows: options.Rows}); err != nil {
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
	t.stateMu.Lock()
	closed := t.closed
	t.stateMu.Unlock()
	if closed {
		return errors.New("host PTY is closed")
	}
	return t.send(hostPTYFrame{Type: "input", Data: data})
}

func (t *bridgedHostTerminal) Resize(cols, rows uint16) error {
	if cols == 0 || rows == 0 {
		return errors.New("host PTY dimensions must be non-zero")
	}
	t.stateMu.Lock()
	closed := t.closed
	t.stateMu.Unlock()
	if closed {
		return errors.New("host PTY is closed")
	}
	return t.send(hostPTYFrame{Type: "resize", Cols: cols, Rows: rows})
}

func (t *bridgedHostTerminal) Close() error {
	t.stateMu.Lock()
	if t.closed {
		t.stateMu.Unlock()
		return nil
	}
	t.closed = true
	t.stateMu.Unlock()
	_ = t.send(hostPTYFrame{Type: "close"})
	return t.conn.Close()
}

func (t *bridgedHostTerminal) finish(code int, err error) {
	t.exitOnce.Do(func() {
		t.stateMu.Lock()
		closed := t.closed
		t.closed = true
		t.stateMu.Unlock()
		_ = t.conn.Close()
		if !closed && t.onExit != nil {
			t.onExit(code, err)
		}
	})
}

func (t *bridgedHostTerminal) readFrames(decoder *json.Decoder, onOutput func([]byte)) {
	for {
		var frame hostPTYFrame
		if err := decoder.Decode(&frame); err != nil {
			t.stateMu.Lock()
			closed := t.closed
			t.stateMu.Unlock()
			if !closed {
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

// ServeHostPTYBridge owns host-side PTYs for stack mode. It is intentionally
// launched by the Desktop lifecycle coordinator, so every shell inherits the
// logged-in operating-system user's environment and hostname instead of the
// backend control container's runtime identity.
func ServeHostPTYBridge(ctx context.Context, socketPath string) error {
	socketPath = strings.TrimSpace(socketPath)
	if socketPath == "" || !filepath.IsAbs(socketPath) {
		return errors.New("host PTY bridge socket must be an absolute path")
	}
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o700); err != nil {
		return fmt.Errorf("prepare host PTY bridge directory: %w", err)
	}
	if info, err := os.Lstat(socketPath); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return fmt.Errorf("refusing to replace non-socket host PTY bridge path %s", socketPath)
		}
		probe, dialErr := net.DialTimeout("unix", socketPath, 250*time.Millisecond)
		if dialErr == nil {
			_ = probe.Close()
			return fmt.Errorf("host PTY bridge is already listening on %s", socketPath)
		}
		if err := os.Remove(socketPath); err != nil {
			return fmt.Errorf("remove stale host PTY bridge socket: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return fmt.Errorf("listen host PTY bridge: %w", err)
	}
	defer func() {
		_ = listener.Close()
		_ = os.Remove(socketPath)
	}()
	if err := os.Chmod(socketPath, 0o600); err != nil {
		return fmt.Errorf("secure host PTY bridge socket: %w", err)
	}
	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("accept host PTY bridge connection: %w", err)
		}
		go handleHostPTYConnection(conn)
	}
}

func handleHostPTYConnection(conn net.Conn) {
	defer conn.Close()
	decoder := json.NewDecoder(conn)
	encoder := json.NewEncoder(conn)
	var sendMu sync.Mutex
	send := func(frame hostPTYFrame) error {
		sendMu.Lock()
		defer sendMu.Unlock()
		return encoder.Encode(frame)
	}

	var start hostPTYFrame
	if err := decoder.Decode(&start); err != nil {
		_ = send(hostPTYFrame{Type: "error", Message: "invalid host PTY start frame"})
		return
	}
	if start.Type != "start" {
		_ = send(hostPTYFrame{Type: "error", Message: "host PTY session must begin with start"})
		return
	}
	workspace := Workspace{Path: start.Root, SourcePath: start.Root}
	cmd, err := localTerminalCommand(workspace, TerminalOptions{Cwd: start.Cwd, Cols: start.Cols, Rows: start.Rows})
	if err != nil {
		_ = send(hostPTYFrame{Type: "error", Message: err.Error()})
		return
	}
	options := TerminalOptions{ID: "host-bridge", Cwd: start.Cwd, Cols: start.Cols, Rows: start.Rows}
	if options.Cols == 0 {
		options.Cols = 80
	}
	if options.Rows == 0 {
		options.Rows = 24
	}
	started := make(chan struct{})
	terminal, err := startProcessTerminal(cmd, options, nil, func(data []byte) {
		<-started
		_ = send(hostPTYFrame{Type: "output", Data: data})
	}, func(code int, waitErr error) {
		<-started
		message := ""
		if waitErr != nil {
			message = waitErr.Error()
		}
		_ = send(hostPTYFrame{Type: "exit", Code: code, Message: message})
		_ = conn.Close()
	})
	if err != nil {
		_ = send(hostPTYFrame{Type: "error", Message: err.Error()})
		close(started)
		return
	}
	if err := send(hostPTYFrame{Type: "started"}); err != nil {
		close(started)
		_ = terminal.Close()
		return
	}
	close(started)
	defer terminal.Close()

	for {
		var frame hostPTYFrame
		if err := decoder.Decode(&frame); err != nil {
			return
		}
		switch frame.Type {
		case "input":
			if len(frame.Data) == 0 {
				continue
			}
			if len(frame.Data) > maxHostPTYInputBytes {
				_ = send(hostPTYFrame{Type: "error", Message: fmt.Sprintf("host PTY input exceeds %d bytes", maxHostPTYInputBytes)})
				return
			}
			if err := terminal.Write(frame.Data); err != nil {
				_ = send(hostPTYFrame{Type: "error", Message: err.Error()})
				return
			}
		case "resize":
			if frame.Cols == 0 || frame.Rows == 0 {
				continue
			}
			if err := terminal.Resize(frame.Cols, frame.Rows); err != nil {
				_ = send(hostPTYFrame{Type: "error", Message: err.Error()})
				return
			}
		case "close":
			return
		default:
			_ = send(hostPTYFrame{Type: "error", Message: "unsupported host PTY bridge frame"})
			return
		}
	}
}
