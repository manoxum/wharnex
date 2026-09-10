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

// maxProjectExecutionConcurrency caps the operator knob. Each concurrent
// runner claims a full container memory allowance plus a complete project
// clone, so an unbounded value trades queueing delay — which is recoverable —
// for out-of-disk and out-of-memory failures, which this codebase already
// classifies as unrepairable by any source patch.
const maxProjectExecutionConcurrency = 8

func newProjectExecutionQueue() *projectExecutionQueue {
	return &projectExecutionQueue{capacity: projectExecutionConcurrency(), projects: make(map[string]*projectExecutionQueueState)}
}

// currentCapacity reports the configured number of plans one project may
// verify at a time.
func (q *projectExecutionQueue) currentCapacity() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.capacity
}

// setCapacity adjusts how many plans one project may verify concurrently.
//
// Lowering it never interrupts work already running: an over-capacity project
// simply admits nobody new until it drains back under the new limit, because
// admission compares against the live capacity. Raising it releases exactly
// the number of waiters the new headroom allows, in FIFO order, so a queue
// that is already waiting benefits immediately instead of only affecting
// plans submitted afterwards.
func (q *projectExecutionQueue) setCapacity(capacity int) int {
	if capacity < 1 {
		capacity = 1
	}
	if capacity > maxProjectExecutionConcurrency {
		capacity = maxProjectExecutionConcurrency
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	q.capacity = capacity
	for _, state := range q.projects {
		q.admitWaiters(state)
	}
	return q.capacity
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
	state.active--
	q.admitWaiters(state)
	if state.active <= 0 && len(state.waiters) == 0 {
		delete(q.projects, project)
	}
}

// admitWaiters releases as many queued plans as the current capacity allows,
// in FIFO order. Callers hold q.mu.
//
// Draining against the live capacity — rather than handing a freed slot
// straight to the next waiter — is what makes the capacity knob safe to lower
// while work is in flight: an over-capacity project admits nobody until it has
// drained back under the new limit, and a raised capacity immediately benefits
// plans that are already waiting instead of only later submissions.
func (q *projectExecutionQueue) admitWaiters(state *projectExecutionQueueState) {
	for state.active < q.capacity && len(state.waiters) > 0 {
		next := state.waiters[0]
		state.waiters = state.waiters[1:]
		state.active++
		close(next.ready)
	}
}
