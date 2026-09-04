package remoteinput

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"kernl.local/harness/backend/internal/app"
)

type Instance struct {
	ID       string
	Priority int
	Limits   app.RemoteInputLimits
	Provider Provider
}

type Manager struct {
	instances []Instance
	indexPath string
	now       func() time.Time
	mu        sync.Mutex
}

func NewManager(provider Provider, indexPath string) *Manager {
	if provider == nil {
		return NewPool(nil, indexPath)
	}
	return NewPool([]Instance{{ID: "default", Priority: 100, Provider: provider}}, indexPath)
}

func NewPool(instances []Instance, indexPath string) *Manager {
	ordered := append([]Instance(nil), instances...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Priority < ordered[j].Priority })
	return &Manager{instances: ordered, indexPath: indexPath, now: time.Now}
}

func (m *Manager) Status() app.RemoteInputStatus {
	if m == nil || len(m.instances) == 0 {
		return app.RemoteInputStatus{Mode: "local_attachments"}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	state, _ := m.load()
	statuses := make([]app.RemoteInputInstanceStatus, 0, len(m.instances))
	for _, instance := range m.instances {
		usage := m.usage(instance, state, m.now().UTC())
		statuses = append(statuses, app.RemoteInputInstanceStatus{ID: instance.ID, Provider: instance.Provider.Name(), Priority: instance.Priority, Limits: instance.Limits, Usage: usage})
	}
	provider := "pool"
	if len(m.instances) == 1 {
		provider = m.instances[0].Provider.Name()
	}
	return app.RemoteInputStatus{Enabled: true, Provider: provider, Mode: "remote_url", Instances: statuses}
}

func (m *Manager) Publish(ctx context.Context, object app.RemoteInputObject) (app.RemoteInputPublication, error) {
	if m == nil || len(m.instances) == 0 {
		return app.RemoteInputPublication{}, errors.New("remote storage is not configured")
	}
	if err := validateObjectName(object.ObjectName); err != nil {
		return app.RemoteInputPublication{}, err
	}
	if object.Bytes < 0 || object.FileCount < 0 || object.MaxFileSize < 0 {
		return app.RemoteInputPublication{}, errors.New("remote input shape cannot contain negative values")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now().UTC()
	cleanupErr := m.cleanupLocked(ctx, now.Add(-app.RemoteInputRetention))
	state, err := m.load()
	if err != nil {
		return app.RemoteInputPublication{}, err
	}
	var failures error
	for _, instance := range m.instances {
		if reason := m.ineligible(instance, state, object, now); reason != "" {
			failures = errors.Join(failures, fmt.Errorf("instance %s: %s", instance.ID, reason))
			continue
		}
		publication, err := instance.Provider.Put(ctx, object.ObjectName, object.FilePath)
		if err != nil {
			failures = errors.Join(failures, fmt.Errorf("instance %s publication failed: %w", instance.ID, err))
			continue
		}
		state.Records = append(state.Records, record{InstanceID: instance.ID, ObjectName: object.ObjectName, CreatedAt: now, Bytes: object.Bytes})
		state.Requests[instance.ID] = append(m.activeRequests(instance, state.Requests[instance.ID], now), now)
		if err := m.save(state); err != nil {
			_ = instance.Provider.Delete(ctx, object.ObjectName)
			return app.RemoteInputPublication{}, fmt.Errorf("persist remote input usage: %w", err)
		}
		warning := publication.CleanupWarning
		if cleanupErr != nil {
			warning = "remote retention cleanup failed"
		}
		return app.RemoteInputPublication{Provider: instance.Provider.Name(), InstanceID: instance.ID, URL: publication.URL, ExpiresAt: publication.ExpiresAt, CleanupWarning: warning}, nil
	}
	if failures == nil {
		failures = errors.New("no remote storage instance is available")
	}
	return app.RemoteInputPublication{}, failures
}

func (m *Manager) ineligible(instance Instance, state managerState, object app.RemoteInputObject, now time.Time) string {
	limits := instance.Limits
	usage := m.usage(instance, state, now)
	if limits.MaxRequests > 0 && usage.RequestsInWindow >= limits.MaxRequests {
		return "request window limit reached"
	}
	if limits.MaxFiles > 0 && object.FileCount > limits.MaxFiles {
		return "file count limit exceeded"
	}
	if limits.MaxFileBytes > 0 && object.MaxFileSize > limits.MaxFileBytes {
		return "per-file size limit exceeded"
	}
	if limits.MaxInputBytes > 0 && object.Bytes > limits.MaxInputBytes {
		return "input size limit exceeded"
	}
	if limits.MaxStoredObjects > 0 && usage.StoredObjects >= limits.MaxStoredObjects {
		return "stored object limit reached"
	}
	if limits.MaxStorageBytes > 0 && (usage.StorageBytes >= limits.MaxStorageBytes || object.Bytes > limits.MaxStorageBytes-usage.StorageBytes) {
		return "storage capacity limit exceeded"
	}
	return ""
}

func (m *Manager) usage(instance Instance, state managerState, now time.Time) app.RemoteInputUsage {
	usage := app.RemoteInputUsage{RequestsInWindow: len(m.activeRequests(instance, state.Requests[instance.ID], now))}
	for _, item := range state.Records {
		if item.InstanceID == instance.ID {
			usage.StoredObjects++
			usage.StorageBytes += item.Bytes
		}
	}
	return usage
}

func (m *Manager) activeRequests(instance Instance, requests []time.Time, now time.Time) []time.Time {
	if instance.Limits.MaxRequests <= 0 || instance.Limits.WindowSeconds <= 0 {
		return nil
	}
	cutoff := now.Add(-time.Duration(instance.Limits.WindowSeconds) * time.Second)
	active := make([]time.Time, 0, len(requests))
	for _, requestedAt := range requests {
		if requestedAt.After(cutoff) {
			active = append(active, requestedAt)
		}
	}
	return active
}

func (m *Manager) Cleanup(ctx context.Context, cutoff time.Time) error {
	if m == nil || len(m.instances) == 0 {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.cleanupLocked(ctx, cutoff)
}

func (m *Manager) cleanupLocked(ctx context.Context, cutoff time.Time) error {
	state, err := m.load()
	if err != nil {
		return err
	}
	providers := make(map[string]Provider, len(m.instances))
	for _, instance := range m.instances {
		providers[instance.ID] = instance.Provider
		state.Requests[instance.ID] = m.activeRequests(instance, state.Requests[instance.ID], m.now().UTC())
	}
	kept := state.Records[:0]
	var cleanupErr error
	for _, item := range state.Records {
		if !item.CreatedAt.Before(cutoff) {
			kept = append(kept, item)
			continue
		}
		provider := providers[item.InstanceID]
		if provider == nil || validateObjectName(item.ObjectName) != nil {
			cleanupErr = errors.Join(cleanupErr, fmt.Errorf("cannot clean recorded object for instance %s", item.InstanceID))
			kept = append(kept, item)
			continue
		}
		if err := provider.Delete(ctx, item.ObjectName); err != nil {
			cleanupErr = errors.Join(cleanupErr, fmt.Errorf("instance %s cleanup failed: %w", item.InstanceID, err))
			kept = append(kept, item)
		}
	}
	state.Records = kept
	if err := m.save(state); err != nil {
		cleanupErr = errors.Join(cleanupErr, err)
	}
	return cleanupErr
}
