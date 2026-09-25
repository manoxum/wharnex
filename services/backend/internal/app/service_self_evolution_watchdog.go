package app

import (
	"errors"
	"reflect"
	"sync"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/selfevolution"
)

// errSessionUnchanged aborts a store update whose projection changed nothing,
// so the session is neither rewritten nor announced again.
var errSessionUnchanged = errors.New("session projection unchanged")

// updateSessionIfChanged applies fn and persists only when it changed the
// session. Self-evolution status is reconciled on every session read; without
// this guard each read rewrote the whole session row and appended another
// batch_state/status_reconciled event — 1008 of them for one stuck activation.
func (s *Service) updateSessionIfChanged(id string, fn func(*domain.Session) error) (domain.Session, bool, error) {
	updated, err := s.store.Update(id, func(current *domain.Session) error {
		before := *current
		if err := fn(current); err != nil {
			return err
		}
		if reflect.DeepEqual(before, *current) {
			return errSessionUnchanged
		}
		return nil
	})
	if errors.Is(err, errSessionUnchanged) {
		current, getErr := s.store.Get(id)
		return current, false, getErr
	}
	return updated, err == nil, err
}

// reconcileAbandonedActivation surfaces a dead activation supervisor as the
// retryable restart_failed phase before the status is projected onto sessions.
func (s *Service) reconcileAbandonedActivation() {
	status, changed, err := s.selfEvolution.ReconcileAbandonedActivation(time.Now().UTC(), supervisorProbe.running)
	if err != nil || !changed {
		return
	}
	s.bus.Publish(status.SessionID, "self_evolution.activation_abandoned", map[string]any{
		"plan_id": status.PlanID, "transaction": status.Transaction, "detail": status.Detail,
	})
}

// cachedSupervisorProbe keeps a still-running but slow supervisor from costing
// one docker inspect per session read.
type cachedSupervisorProbe struct {
	mu    sync.Mutex
	key   string
	at    time.Time
	alive bool
	known bool
	probe selfevolution.SupervisorProbe
}

var supervisorProbe = &cachedSupervisorProbe{probe: selfevolution.DockerSupervisorProbe}

func (c *cachedSupervisorProbe) running(transaction string) (bool, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.key == transaction && time.Since(c.at) < 30*time.Second {
		return c.alive, c.known
	}
	c.alive, c.known = c.probe(transaction)
	c.key, c.at = transaction, time.Now()
	return c.alive, c.known
}
