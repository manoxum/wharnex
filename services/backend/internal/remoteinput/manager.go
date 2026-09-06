package remoteinput

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
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
	disabled  map[string]error
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
	return &Manager{instances: ordered, indexPath: indexPath, now: time.Now, disabled: make(map[string]error)}
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
		disabledErr := m.disabled[instance.ID]
		status := app.RemoteInputInstanceStatus{ID: instance.ID, Provider: instance.Provider.Name(), Priority: instance.Priority, Available: disabledErr == nil, Limits: instance.Limits, Usage: usage}
		if disabledErr != nil {
			status.Error = disabledErr.Error()
		}
		statuses = append(statuses, status)
	}
	provider := "pool"
	if len(m.instances) == 1 {
		provider = m.instances[0].Provider.Name()
	}
	return app.RemoteInputStatus{Enabled: true, Provider: provider, Mode: "tunnel", Instances: statuses}
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
		if disabledErr := m.disabled[instance.ID]; disabledErr != nil {
			failures = errors.Join(failures, fmt.Errorf("instance %s is unavailable: %w", instance.ID, disabledErr))
			continue
		}
		if reason := m.ineligible(instance, state, object, now); reason != "" {
			failures = errors.Join(failures, fmt.Errorf("instance %s: %s", instance.ID, reason))
			continue
		}
		publication, err := instance.Provider.Put(ctx, object.ObjectName, object.FilePath)
		if err != nil {
			failures = errors.Join(failures, fmt.Errorf("instance %s publication failed: %w", instance.ID, err))
			continue
		}
		state.Records = replaceRecord(state.Records, record{InstanceID: instance.ID, ObjectName: object.ObjectName, CreatedAt: now, Bytes: object.Bytes})
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

func (m *Manager) PublishRemoteInputChannel(ctx context.Context, channel app.RemoteInputChannel) (app.RemoteInputPublication, error) {
	if m == nil || len(m.instances) == 0 || validateObjectName(channel.ChannelID) != nil {
		return app.RemoteInputPublication{}, errors.New("invalid remote input channel")
	}
	shape := app.RemoteInputObject{ObjectName: "channel-" + channel.ChannelID, Bytes: channel.Bytes, FileCount: channel.FileCount, MaxFileSize: channel.MaxFileSize}
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
		if disabledErr := m.disabled[instance.ID]; disabledErr != nil {
			failures = errors.Join(failures, fmt.Errorf("instance %s is unavailable: %w", instance.ID, disabledErr))
			continue
		}
		provider, ok := instance.Provider.(ChannelProvider)
		if !ok {
			continue
		}
		if reason := m.ineligible(instance, state, shape, now); reason != "" {
			failures = errors.Join(failures, fmt.Errorf("instance %s: %s", instance.ID, reason))
			continue
		}
		publication, publishErr := provider.PublishChannel(ctx, channel)
		if publishErr != nil {
			failures = errors.Join(failures, fmt.Errorf("instance %s channel publication failed: %w", instance.ID, publishErr))
			continue
		}
		state.Records = replaceRecord(state.Records, record{InstanceID: instance.ID, ObjectName: shape.ObjectName, CreatedAt: now, Bytes: channel.Bytes})
		state.Requests[instance.ID] = append(m.activeRequests(instance, state.Requests[instance.ID], now), now)
		if saveErr := m.save(state); saveErr != nil {
			_ = provider.CloseChannel(ctx, channel.ChannelID)
			return app.RemoteInputPublication{}, fmt.Errorf("persist remote input channel usage: %w", saveErr)
		}
		warning := publication.CleanupWarning
		if cleanupErr != nil {
			warning = "remote retention cleanup failed"
		}
		return app.RemoteInputPublication{Provider: instance.Provider.Name(), InstanceID: instance.ID, URL: publication.URL, ExpiresAt: publication.ExpiresAt, CleanupWarning: warning}, nil
	}
	if failures == nil {
		failures = errors.New("no transient remote channel provider is available")
	}
	return app.RemoteInputPublication{}, failures
}

// PublishRemoteInputChannelSet mirrors one request namespace to every usable
// channel provider. The ordered Manager instances define the fallback order.
func (m *Manager) PublishRemoteInputChannelSet(ctx context.Context, channel app.RemoteInputChannel) ([]app.RemoteInputPublication, error) {
	if m == nil || validateObjectName(channel.ChannelID) != nil {
		return nil, errors.New("invalid remote input channel")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	cleanupErr := m.cleanupLocked(ctx, m.now().UTC().Add(-app.RemoteInputRetention))
	state, err := m.load()
	if err != nil {
		return nil, err
	}
	now := m.now().UTC()
	shape := app.RemoteInputObject{ObjectName: "channel-" + channel.ChannelID, Bytes: channel.Bytes, FileCount: channel.FileCount, MaxFileSize: channel.MaxFileSize}
	publications := make([]app.RemoteInputPublication, 0, len(m.instances))
	var failures error
	for _, instance := range m.instances {
		if disabled := m.disabled[instance.ID]; disabled != nil {
			failures = errors.Join(failures, fmt.Errorf("instance %s is unavailable: %w", instance.ID, disabled))
			continue
		}
		provider, ok := instance.Provider.(ChannelProvider)
		if !ok || m.ineligible(instance, state, shape, now) != "" {
			continue
		}
		publication, publishErr := provider.PublishChannel(ctx, channel)
		if publishErr != nil {
			failures = errors.Join(failures, fmt.Errorf("instance %s channel publication failed: %w", instance.ID, publishErr))
			continue
		}
		publications = append(publications, app.RemoteInputPublication{Provider: instance.Provider.Name(), InstanceID: instance.ID, URL: publication.URL, ExpiresAt: publication.ExpiresAt, CleanupWarning: publication.CleanupWarning})
		state.Records = replaceRecord(state.Records, record{InstanceID: instance.ID, ObjectName: shape.ObjectName, CreatedAt: now, Bytes: channel.Bytes})
		state.Requests[instance.ID] = append(m.activeRequests(instance, state.Requests[instance.ID], now), now)
		if cleanupErr != nil {
			publications[len(publications)-1].CleanupWarning = "remote retention cleanup failed"
		}
	}
	if len(publications) == 0 {
		if failures == nil {
			failures = errors.New("no remote channel provider is available")
		}
		return nil, failures
	}
	if err := m.save(state); err != nil {
		for _, publication := range publications {
			_ = m.closeChannelLocked(ctx, publication.InstanceID, channel.ChannelID)
		}
		return nil, fmt.Errorf("persist remote input usage: %w", err)
	}
	return publications, nil
}

func (m *Manager) UpdateRemoteInputChannelSet(ctx context.Context, instanceIDs []string, update app.RemoteInputChannelUpdate) error {
	var result error
	for _, id := range instanceIDs {
		if err := m.UpdateRemoteInputChannel(ctx, id, update); err != nil {
			result = errors.Join(result, fmt.Errorf("instance %s: %w", id, err))
		}
	}
	return result
}

func (m *Manager) CloseRemoteInputChannelSet(ctx context.Context, instanceIDs []string, channelID string) error {
	var result error
	for _, id := range instanceIDs {
		if err := m.CloseRemoteInputChannel(ctx, id, channelID); err != nil {
			result = errors.Join(result, fmt.Errorf("instance %s: %w", id, err))
		}
	}
	return result
}

func (m *Manager) closeChannelLocked(ctx context.Context, instanceID, channelID string) error {
	provider, err := m.channelProvider(instanceID)
	if err != nil {
		return err
	}
	return provider.CloseChannel(ctx, channelID)
}

func (m *Manager) SupportsRemoteInputChannels() bool {
	if m == nil || len(m.instances) == 0 {
		return false
	}
	for _, instance := range m.instances {
		if _, ok := instance.Provider.(ChannelProvider); !ok {
			// Mixed durable/transient pools retain the ordinary priority/failover
			// contract through Publish rather than silently skipping a preferred
			// durable instance.
			return false
		}
	}
	return true
}

func (m *Manager) UpdateRemoteInputChannel(ctx context.Context, instanceID string, update app.RemoteInputChannelUpdate) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	provider, err := m.channelProvider(instanceID)
	if err != nil {
		return err
	}
	return provider.UpdateChannel(ctx, update)
}

func (m *Manager) CloseRemoteInputChannel(ctx context.Context, instanceID, channelID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	provider, err := m.channelProvider(instanceID)
	if err != nil {
		return err
	}
	if err := provider.CloseChannel(ctx, channelID); err != nil {
		return err
	}
	state, loadErr := m.load()
	if loadErr != nil {
		return loadErr
	}
	objectName := "channel-" + channelID
	kept := state.Records[:0]
	for _, item := range state.Records {
		if item.InstanceID != instanceID || item.ObjectName != objectName {
			kept = append(kept, item)
		}
	}
	state.Records = kept
	return m.save(state)
}

func (m *Manager) StartRemoteInputSession(ctx context.Context) error {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	clear(m.disabled)
	var failures error
	available := 0
	for _, instance := range m.instances {
		provider, ok := instance.Provider.(SessionProvider)
		if !ok {
			available++
			continue
		}
		if err := provider.StartSession(ctx); err != nil {
			m.disabled[instance.ID] = err
			failures = errors.Join(failures, fmt.Errorf("instance %s session start failed: %w", instance.ID, err))
			continue
		}
		available++
	}
	if available > 0 {
		return nil
	}
	return failures
}

func (m *Manager) StopRemoteInputSession(ctx context.Context) error {
	return m.visitSessionProviders(ctx, "stop", func(provider SessionProvider) error { return provider.StopSession(ctx) })
}

func (m *Manager) ClearRemoteInputSession(ctx context.Context) error {
	return m.visitSessionProviders(ctx, "clear", func(provider SessionProvider) error { return provider.ClearSession(ctx) })
}

func (m *Manager) visitSessionProviders(ctx context.Context, operation string, visit func(SessionProvider) error) error {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var result error
	for _, instance := range m.instances {
		provider, ok := instance.Provider.(SessionProvider)
		if !ok {
			continue
		}
		if err := visit(provider); err != nil {
			result = errors.Join(result, fmt.Errorf("instance %s session %s failed: %w", instance.ID, operation, err))
		}
	}
	return result
}

func (m *Manager) channelProvider(instanceID string) (ChannelProvider, error) {
	for _, instance := range m.instances {
		if instance.ID != instanceID {
			continue
		}
		provider, ok := instance.Provider.(ChannelProvider)
		if !ok {
			return nil, errors.New("remote input instance does not support request channels")
		}
		return provider, nil
	}
	return nil, errors.New("remote input channel instance is not configured")
}

// RetainRemoteInput ties an optional transient provider endpoint to an active
// Wharness request. It is deliberately separate from publication so regular
// object retention policies continue to apply unchanged.
func (m *Manager) RetainRemoteInput(instanceID, objectName string) error {
	return m.updateRequestLease(instanceID, objectName, true)
}

// ReleaseRemoteInput permits a transient endpoint to close only after its
// request reaches a terminal state or is superseded.
func (m *Manager) ReleaseRemoteInput(instanceID, objectName string) error {
	return m.updateRequestLease(instanceID, objectName, false)
}

func (m *Manager) updateRequestLease(instanceID, objectName string, retain bool) error {
	if m == nil || validateObjectName(objectName) != nil {
		return errors.New("invalid remote input lease")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, instance := range m.instances {
		if instance.ID != instanceID {
			continue
		}
		provider, ok := instance.Provider.(RequestLeaseProvider)
		if !ok {
			return nil
		}
		if retain {
			return provider.Retain(objectName)
		}
		return provider.Release(objectName)
	}
	return errors.New("remote input lease instance is not configured")
}

func (m *Manager) ineligible(instance Instance, state managerState, object app.RemoteInputObject, now time.Time) string {
	limits := instance.Limits
	usage := m.usage(instance, state, now)
	existingBytes, replacing := existingObject(state.Records, instance.ID, object.ObjectName)
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
	if limits.MaxStoredObjects > 0 && !replacing && usage.StoredObjects >= limits.MaxStoredObjects {
		return "stored object limit reached"
	}
	prospectiveBytes := usage.StorageBytes - existingBytes + object.Bytes
	if limits.MaxStorageBytes > 0 && prospectiveBytes > limits.MaxStorageBytes {
		return "storage capacity limit exceeded"
	}
	return ""
}

func existingObject(records []record, instanceID, objectName string) (int64, bool) {
	for _, item := range records {
		if item.InstanceID == instanceID && item.ObjectName == objectName {
			return item.Bytes, true
		}
	}
	return 0, false
}

func replaceRecord(records []record, replacement record) []record {
	for index, item := range records {
		if item.InstanceID == replacement.InstanceID && item.ObjectName == replacement.ObjectName {
			records[index] = replacement
			return records
		}
	}
	return append(records, replacement)
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
		var deleteErr error
		if channelProvider, ok := provider.(ChannelProvider); ok && strings.HasPrefix(item.ObjectName, "channel-") {
			deleteErr = channelProvider.CloseChannel(ctx, strings.TrimPrefix(item.ObjectName, "channel-"))
		} else {
			deleteErr = provider.Delete(ctx, item.ObjectName)
		}
		if deleteErr != nil {
			cleanupErr = errors.Join(cleanupErr, fmt.Errorf("instance %s cleanup failed: %w", item.InstanceID, deleteErr))
			kept = append(kept, item)
		}
	}
	state.Records = kept
	if err := m.save(state); err != nil {
		cleanupErr = errors.Join(cleanupErr, err)
	}
	return cleanupErr
}
