package app

import (
	"context"
	"path/filepath"
	"sync"
)

// projectExecutionQueue is the single scheduling seam for every Agent plan
// execution. It preserves FIFO ordering within one project while allowing
// unrelated projects to execute independently.
type projectExecutionQueue struct {
	mu       sync.Mutex
	projects map[string]*projectExecutionQueueState
}

type projectExecutionQueueState struct {
	active  bool
	waiters []*executionQueueWaiter
}

type executionQueueWaiter struct {
	sessionID string
	ready     chan struct{}
}

type executionQueueTicket struct {
	queue    *projectExecutionQueue
	project  string
	position int
	queued   bool
	once     *sync.Once
}

func newProjectExecutionQueue() *projectExecutionQueue {
	return &projectExecutionQueue{projects: make(map[string]*projectExecutionQueueState)}
}

func (q *projectExecutionQueue) acquire(ctx context.Context, projectPath, sessionID string, onQueued ...func(int)) (executionQueueTicket, error) {
	project := filepath.Clean(projectPath)
	q.mu.Lock()
	state := q.projects[project]
	if state == nil {
		state = &projectExecutionQueueState{}
		q.projects[project] = state
	}
	if !state.active {
		state.active = true
		q.mu.Unlock()
		return executionQueueTicket{queue: q, project: project, once: &sync.Once{}}, nil
	}
	waiter := &executionQueueWaiter{sessionID: sessionID, ready: make(chan struct{})}
	state.waiters = append(state.waiters, waiter)
	position := len(state.waiters)
	q.mu.Unlock()
	if len(onQueued) > 0 && onQueued[0] != nil {
		onQueued[0](position)
	}

	select {
	case <-waiter.ready:
		return executionQueueTicket{queue: q, project: project, position: position, queued: true, once: &sync.Once{}}, nil
	case <-ctx.Done():
		q.mu.Lock()
		removed := false
		for index, candidate := range state.waiters {
			if candidate == waiter {
				state.waiters = append(state.waiters[:index], state.waiters[index+1:]...)
				removed = true
				break
			}
		}
		q.mu.Unlock()
		if !removed {
			<-waiter.ready
			q.release(project)
		}
		return executionQueueTicket{}, ctx.Err()
	}
}

func (ticket *executionQueueTicket) release() {
	if ticket == nil || ticket.queue == nil || ticket.once == nil {
		return
	}
	ticket.once.Do(func() { ticket.queue.release(ticket.project) })
}

func (q *projectExecutionQueue) release(project string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	state := q.projects[project]
	if state == nil {
		return
	}
	if len(state.waiters) == 0 {
		delete(q.projects, project)
		return
	}
	next := state.waiters[0]
	state.waiters = state.waiters[1:]
	close(next.ready)
}
