package sandbox

import (
	"context"
	"crypto/rand"
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

// ServeHostPTYBridge owns durable human PTYs behind a checkout-scoped Unix socket.
// Socket disconnects detach clients; only an explicit close frame kills a shell.
func ServeHostPTYBridge(ctx context.Context, socketPath string) error {
	listener, err := listenHostPTYSocket(socketPath)
	if err != nil {
		return err
	}
	registry := &hostPTYRegistry{sessions: make(map[string]*hostPTYSession), generation: rand.Text()}
	defer func() {
		_ = listener.Close()
		_ = os.Remove(socketPath)
		registry.closeAll()
	}()
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
		go registry.handleConnection(conn)
	}
}

func listenHostPTYSocket(socketPath string) (net.Listener, error) {
	socketPath = strings.TrimSpace(socketPath)
	if socketPath == "" || !filepath.IsAbs(socketPath) {
		return nil, errors.New("host PTY bridge socket must be an absolute path")
	}
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o700); err != nil {
		return nil, fmt.Errorf("prepare host PTY bridge directory: %w", err)
	}
	if info, err := os.Lstat(socketPath); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return nil, fmt.Errorf("refusing to replace non-socket host PTY bridge path %s", socketPath)
		}
		probe, dialErr := net.DialTimeout("unix", socketPath, 250*time.Millisecond)
		if dialErr == nil {
			_ = probe.Close()
			return nil, fmt.Errorf("host PTY bridge is already listening on %s", socketPath)
		}
		if err := os.Remove(socketPath); err != nil {
			return nil, fmt.Errorf("remove stale host PTY bridge socket: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("listen host PTY bridge: %w", err)
	}
	if err := os.Chmod(socketPath, 0o600); err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("secure host PTY bridge socket: %w", err)
	}
	return listener, nil
}

func (r *hostPTYRegistry) handleConnection(conn net.Conn) {
	defer conn.Close()
	decoder := json.NewDecoder(conn)
	encoder := json.NewEncoder(conn)
	var sendMu sync.Mutex
	send := func(frame hostPTYFrame) error {
		sendMu.Lock()
		defer sendMu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
		err := encoder.Encode(frame)
		_ = conn.SetWriteDeadline(time.Time{})
		return err
	}
	var start hostPTYFrame
	if err := decoder.Decode(&start); err != nil || start.Type != "start" {
		_ = send(hostPTYFrame{Type: "error", Message: "host PTY session must begin with a valid start frame"})
		return
	}
	session, err := r.open(start)
	if err != nil {
		frame := hostPTYFrame{Type: "error", Message: err.Error()}
		var expired *TerminalExpiredError
		if errors.As(err, &expired) {
			frame.Generation = expired.Generation
		}
		_ = send(frame)
		return
	}
	subscriber, err := session.attach(send)
	if err != nil {
		_ = send(hostPTYFrame{Type: "error", Message: err.Error()})
		return
	}
	defer session.detach(subscriber)
	for {
		var frame hostPTYFrame
		if err := decoder.Decode(&frame); err != nil {
			return
		}
		switch frame.Type {
		case "input":
			if len(frame.Data) > maxHostPTYInputBytes {
				_ = send(hostPTYFrame{Type: "error", Message: fmt.Sprintf("host PTY input exceeds %d bytes", maxHostPTYInputBytes)})
				return
			}
			if len(frame.Data) > 0 {
				if err := session.terminal.Write(frame.Data); err != nil {
					_ = send(hostPTYFrame{Type: "error", Message: err.Error()})
					return
				}
			}
		case "resize":
			if frame.Cols > 0 && frame.Rows > 0 {
				if err := session.terminal.Resize(frame.Cols, frame.Rows); err != nil {
					_ = send(hostPTYFrame{Type: "error", Message: err.Error()})
					return
				}
			}
		case "close":
			r.close(session)
			return
		default:
			_ = send(hostPTYFrame{Type: "error", Message: "unsupported host PTY bridge frame"})
			return
		}
	}
}
