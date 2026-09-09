package app

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"sync"
)

// projectExecutionQueue is the single scheduling seam for every Agent plan
// execution. It preserves FIFO ordering within one project while allowing
// unrelated projects to execute independently.
//
// Capacity is one by default, which is the historical behavior. Protected
// verification itself does not need exclusivity — it runs in an isolated
// temporary clone, and the only host-facing write (pushing the verified
// integration branch into the host .git) is serialized separately under the
// project apply lock. Capacity therefore exists as an operator knob for
// machines with the disk and RAM headroom to verify two chats at once: each
// concurrent runner claims a full container memory allowance plus a complete
// project clone, so raising it on a small machine trades queueing delay for
// the far worse out-of-disk/out-of-memory failures this codebase already
// classifies as unrepairable.
type projectExecutionQueue struct {
	capacity int
	mu       sync.Mutex
	projects map[string]*projectExecutionQueueState
}

type projectExecutionQueueState struct {
	active  int
	waiters []*executionQueueWaiter
}

// defaultProjectExecutionConcurrency preserves the original strict FIFO
// behavior. WHARNESS_PROJECT_EXECUTION_CONCURRENCY raises it.
const defaultProjectExecutionConcurrency = 1

func projectExecutionConcurrency() int {
	raw := os.Getenv("WHARNESS_PROJECT_EXECUTION_CONCURRENCY")
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed < 1 {
		return defaultProjectExecutionConcurrency
	}
	if parsed > 8 {
		return 8
	}
	return parsed
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
	return &projectExecutionQueue{capacity: projectExecutionConcurrency(), projects: make(map[string]*projectExecutionQueueState)}
}

func (q *projectExecutionQueue) acquire(ctx context.Context, projectPath, sessionID string, onQueued ...func(int)) (executionQueueTicket, error) {
	project := filepath.Clean(projectPath)
	q.mu.Lock()
	state := q.projects[project]
	if state == nil {
		state = &projectExecutionQueueState{}
		q.projects[project] = state
	}
	if state.active < q.capacity {
		state.active++
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
		state.active--
		if state.active <= 0 {
			delete(q.projects, project)
		}
		return
	}
	// The released slot transfers directly to the next waiter, so active
	// stays at its current level rather than dipping and being re-taken.
	next := state.waiters[0]
	state.waiters = state.waiters[1:]
	close(next.ready)
}
