package remoteinput

import (
	"context"
	"errors"
	"strings"
)

func (m *Manager) ControlRemoteInput(ctx context.Context, instanceID, action string) error {
	if m == nil {
		return errors.New("remote input manager is unavailable")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	instance := m.instanceByID(instanceID)
	if instance == nil {
		return errors.New("remote input instance is not configured")
	}
	provider, ok := instance.Provider.(SessionProvider)
	if !ok {
		return errors.New("remote input instance does not support lifecycle control")
	}
	state, err := m.load()
	if err != nil {
		return err
	}
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "pause":
		if err := provider.StopSession(ctx); err != nil {
			return err
		}
		m.paused[instanceID] = true
		delete(m.disabled, instanceID)
		return nil
	case "stop":
		if err := provider.StopSession(ctx); err != nil {
			return err
		}
		state.Stopped[instanceID] = true
		delete(m.paused, instanceID)
		delete(m.disabled, instanceID)
		return m.save(state)
	case "resume":
		delete(state.Stopped, instanceID)
		if err := m.save(state); err != nil {
			return err
		}
		if err := provider.StartSession(ctx); err != nil {
			m.disabled[instanceID] = err
			return err
		}
		delete(m.paused, instanceID)
		delete(m.disabled, instanceID)
		return nil
	default:
		return errors.New("tunnel action must be pause, stop, or resume")
	}
}

func (m *Manager) instanceByID(instanceID string) *Instance {
	for index := range m.instances {
		if m.instances[index].ID == instanceID {
			return &m.instances[index]
		}
	}
	return nil
}
