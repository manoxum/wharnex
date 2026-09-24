package sandbox

import (
	"errors"
	"sync"
)

const maxHostPTYReplayBytes = 256 * 1024

type hostPTYRegistry struct {
	mu       sync.Mutex
	sessions map[string]*hostPTYSession
}

type hostPTYSubscriber struct {
	send func(hostPTYFrame) error
}

type hostPTYSession struct {
	mu          sync.Mutex
	id          string
	root        string
	terminal    InteractiveTerminal
	subscriber  *hostPTYSubscriber
	backlog     []hostPTYFrame
	backlogSize int
	exited      bool
}

func (r *hostPTYRegistry) open(start hostPTYFrame) (*hostPTYSession, error) {
	if !validHostPTYID(start.ID) {
		return nil, errors.New("host PTY id is invalid")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if existing := r.sessions[start.ID]; existing != nil {
		existing.mu.Lock()
		exited := existing.exited
		existing.mu.Unlock()
		if exited {
			delete(r.sessions, start.ID)
		} else {
			if existing.root != start.Root {
				return nil, errors.New("host PTY id belongs to a different workspace")
			}
			return existing, nil
		}
	}
	workspace := Workspace{Path: start.Root, SourcePath: start.Root}
	options := TerminalOptions{ID: start.ID, Cwd: start.Cwd, Cols: start.Cols, Rows: start.Rows}
	cmd, err := localTerminalCommand(workspace, options)
	if err != nil {
		return nil, err
	}
	if options.Cols == 0 {
		options.Cols = 80
	}
	if options.Rows == 0 {
		options.Rows = 24
	}
	session := &hostPTYSession{id: start.ID, root: start.Root}
	started := make(chan struct{})
	terminal, err := startProcessTerminal(cmd, options, nil, func(data []byte) {
		<-started
		session.deliver(hostPTYFrame{Type: "output", Data: data})
	}, func(code int, waitErr error) {
		<-started
		message := ""
		if waitErr != nil {
			message = waitErr.Error()
		}
		session.markExited()
		session.deliver(hostPTYFrame{Type: "exit", Code: code, Message: message})
		r.remove(session)
	})
	if err != nil {
		close(started)
		return nil, err
	}
	session.terminal = terminal
	r.sessions[start.ID] = session
	close(started)
	return session, nil
}

func (s *hostPTYSession) attach(send func(hostPTYFrame) error) (*hostPTYSubscriber, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := send(hostPTYFrame{Type: "started", ID: s.id}); err != nil {
		return nil, err
	}
	for _, frame := range s.backlog {
		if err := send(frame); err != nil {
			return nil, err
		}
	}
	s.backlog = nil
	s.backlogSize = 0
	subscriber := &hostPTYSubscriber{send: send}
	s.subscriber = subscriber
	return subscriber, nil
}

func (s *hostPTYSession) detach(subscriber *hostPTYSubscriber) {
	s.mu.Lock()
	if s.subscriber == subscriber {
		s.subscriber = nil
	}
	s.mu.Unlock()
}

func (s *hostPTYSession) deliver(frame hostPTYFrame) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.subscriber != nil {
		if err := s.subscriber.send(frame); err == nil {
			return
		}
		s.subscriber = nil
	}
	s.backlog = append(s.backlog, frame)
	s.backlogSize += len(frame.Data)
	for len(s.backlog) > 256 || s.backlogSize > maxHostPTYReplayBytes {
		s.backlogSize -= len(s.backlog[0].Data)
		s.backlog = s.backlog[1:]
	}
}

func (s *hostPTYSession) markExited() {
	s.mu.Lock()
	s.exited = true
	s.mu.Unlock()
}

func (r *hostPTYRegistry) remove(session *hostPTYSession) {
	r.mu.Lock()
	if r.sessions[session.id] == session {
		delete(r.sessions, session.id)
	}
	r.mu.Unlock()
}

func (r *hostPTYRegistry) close(session *hostPTYSession) {
	r.mu.Lock()
	if r.sessions[session.id] == session {
		delete(r.sessions, session.id)
	}
	r.mu.Unlock()
	_ = session.terminal.Close()
}

func (r *hostPTYRegistry) closeAll() {
	r.mu.Lock()
	sessions := make([]*hostPTYSession, 0, len(r.sessions))
	for _, session := range r.sessions {
		sessions = append(sessions, session)
	}
	r.sessions = make(map[string]*hostPTYSession)
	r.mu.Unlock()
	for _, session := range sessions {
		_ = session.terminal.Close()
	}
}

func validHostPTYID(id string) bool {
	if len(id) < 1 || len(id) > 128 {
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
