package remoteinput

import (
	"context"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/config"
)

// ReloadRemoteInput rebuilds the pool from the saved tunnel document without
// restarting the process, so a configuration saved from the UI takes effect
// immediately.
//
// Reconciliation is deliberately conservative. An instance whose configuration
// did not change keeps the provider it is already running, because that
// provider owns a live public URL and the channel resources of requests still
// in flight; rebuilding it would invalidate both for a save that only touched a
// sibling. Only added, changed and removed instances are acted on.
func (m *Manager) ReloadRemoteInput(ctx context.Context) error {
	if m == nil {
		return nil
	}
	document, err := config.ReadTunnelDocument(m.source)
	if err != nil {
		return err
	}
	desired := reloadableTunnelInstances(document)
	landing := TunnelLanding{InstanceName: document.InstanceName, Origins: configuredTunnelOrigins(desired)}

	m.mu.Lock()
	existing := make(map[string]Instance, len(m.instances))
	for _, instance := range m.instances {
		existing[instance.ID] = instance
	}
	m.mu.Unlock()

	reconciled, err := m.reconcileTunnelInstances(desired, existing, landing)
	if err != nil {
		return err
	}

	m.mu.Lock()
	m.instances = reconciled.next
	for id := range m.disabled {
		if _, kept := instanceIndexByID(reconciled.next, id); !kept {
			delete(m.disabled, id)
		}
	}
	m.mu.Unlock()

	stopRetiredTunnelInstances(ctx, reconciled.retired)
	m.startReloadedInstances(ctx, reconciled.created)
	return nil
}

// startReloadedInstances connects the instances this reload introduced, so an
// added tunnel publishes its URL immediately instead of waiting for the first
// request. A provider that cannot connect is recorded as unavailable with its
// reason and reported through Status; it never fails the reload, because the
// remaining pool is still serving and the operator needs the daemon alive to
// correct the configuration.
func (m *Manager) startReloadedInstances(ctx context.Context, created []Instance) {
	for _, instance := range created {
		session, ok := instance.Provider.(SessionProvider)
		if !ok {
			continue
		}
		err := session.StartSession(ctx)
		m.mu.Lock()
		if err != nil {
			m.disabled[instance.ID] = err
		} else {
			delete(m.disabled, instance.ID)
		}
		m.mu.Unlock()
	}
}

// tunnelReconciliation is the outcome of comparing the saved document with the
// running pool: what the pool becomes, what it gained, and what it lost.
type tunnelReconciliation struct {
	next    []Instance
	created []Instance
	retired []Instance
}

// reconcileTunnelInstances builds every new provider before anything is
// swapped in, so a provider that fails to build leaves the running pool exactly
// as it was instead of half-applied.
func (m *Manager) reconcileTunnelInstances(desired []config.TunnelInstanceConfig, existing map[string]Instance, landing TunnelLanding) (tunnelReconciliation, error) {
	next := make([]Instance, 0, len(desired))
	created := make([]Instance, 0, len(desired))
	keptIDs := make(map[string]struct{}, len(desired))
	for _, instanceConfig := range desired {
		if current, found := existing[instanceConfig.ID]; found && sameTunnelInstanceConfig(current.Config, instanceConfig) {
			// Priority is pure ordering, so it is adopted without a rebuild.
			current.Priority = instanceConfig.Priority
			current.Config = instanceConfig
			applyTunnelLanding(current.Provider, landing)
			next = append(next, current)
			keptIDs[instanceConfig.ID] = struct{}{}
			continue
		}
		provider, err := tunnelProvider(instanceConfig, filepath.Dir(m.indexPath), m.source.SecretsDir, landing)
		if err != nil {
			stopRetiredTunnelInstances(context.Background(), created)
			return tunnelReconciliation{}, fmt.Errorf("tunnel instance %s: %w", instanceConfig.ID, err)
		}
		instance := Instance{ID: instanceConfig.ID, Priority: instanceConfig.Priority, Provider: provider, Config: instanceConfig}
		next = append(next, instance)
		created = append(created, instance)
	}
	retired := make([]Instance, 0, len(existing))
	for id, instance := range existing {
		if _, kept := keptIDs[id]; !kept {
			retired = append(retired, instance)
		}
	}
	sort.SliceStable(next, func(i, j int) bool { return next[i].Priority < next[j].Priority })
	return tunnelReconciliation{next: next, created: created, retired: retired}, nil
}

func reloadableTunnelInstances(document config.TunnelDocument) []config.TunnelInstanceConfig {
	instances := make([]config.TunnelInstanceConfig, 0, len(document.Instances))
	for _, instance := range document.Instances {
		if strings.EqualFold(instance.Provider, "desktop_direct") {
			continue
		}
		instances = append(instances, instance)
	}
	sort.SliceStable(instances, func(i, j int) bool { return instances[i].Priority < instances[j].Priority })
	return instances
}

// sameTunnelInstanceConfig ignores priority because reordering the pool never
// requires a provider to be torn down and reconnected.
func sameTunnelInstanceConfig(current, next config.TunnelInstanceConfig) bool {
	return strings.EqualFold(current.Provider, next.Provider) &&
		current.PublicURL == next.PublicURL &&
		current.CredentialRef == next.CredentialRef &&
		current.LocalPort == next.LocalPort
}

// stopRetiredTunnelInstances stops the connector of every instance that left
// the configuration. It deliberately stops rather than clears: erasing stored
// channel resources stays an explicit operator action.
func stopRetiredTunnelInstances(ctx context.Context, retired []Instance) {
	for _, instance := range retired {
		if session, ok := instance.Provider.(SessionProvider); ok {
			_ = session.StopSession(ctx)
		}
	}
}

func instanceIndexByID(instances []Instance, id string) (int, bool) {
	for index, instance := range instances {
		if instance.ID == id {
			return index, true
		}
	}
	return 0, false
}

// applyTunnelLanding refreshes the discovery page of a provider that survived a
// reload, so renaming the instance or adding a sibling origin is reflected
// without dropping the tunnel.
func applyTunnelLanding(provider Provider, landing TunnelLanding) {
	if updater, ok := provider.(interface{ UpdateLanding(TunnelLanding) }); ok {
		updater.UpdateLanding(landing)
	}
}

func (p *TryCloudflareProvider) UpdateLanding(landing TunnelLanding) {
	page := landing.HTML()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.landingPage = page
}
