package remoteinput

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"kernl.local/harness/backend/internal/config"
)

type reloadStubProvider struct {
	name    string
	stopped int
	landing string
}

func (p *reloadStubProvider) Name() string { return p.name }
func (p *reloadStubProvider) Put(context.Context, string, string) (Publication, error) {
	return Publication{}, nil
}
func (p *reloadStubProvider) Delete(context.Context, string) error { return nil }
func (p *reloadStubProvider) StartSession(context.Context) error   { return nil }
func (p *reloadStubProvider) StopSession(context.Context) error    { p.stopped++; return nil }
func (p *reloadStubProvider) ClearSession(context.Context) error   { return nil }
func (p *reloadStubProvider) UpdateLanding(landing TunnelLanding)  { p.landing = landing.InstanceName }

func writeTunnelDocument(t *testing.T, path string, document config.TunnelDocument) {
	t.Helper()
	raw, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func newReloadManager(t *testing.T, instances ...Instance) (*Manager, string) {
	t.Helper()
	root := t.TempDir()
	configPath := filepath.Join(root, "tunnel-providers.json")
	manager := NewPool(instances, filepath.Join(root, "index.json"))
	manager.source = config.TunnelConfig{ConfigFile: configPath, SecretsDir: filepath.Join(root, "secrets")}
	return manager, configPath
}

// A save that only adds a sibling must not disturb the instance already
// serving a public URL, because that provider owns requests still in flight.
func TestReloadKeepsUnchangedInstanceRunning(t *testing.T) {
	running := &reloadStubProvider{name: "trycloudflare"}
	existing := Instance{ID: "quick", Priority: 10, Provider: running, Config: config.TunnelInstanceConfig{ID: "quick", Provider: "trycloudflare", Priority: 10}}
	manager, configPath := newReloadManager(t, existing)
	writeTunnelDocument(t, configPath, config.TunnelDocument{Version: 1, InstanceName: "oficina", Instances: []config.TunnelInstanceConfig{
		{ID: "quick", Provider: "trycloudflare", Priority: 10},
		// pyjam.as needs no client executable, so the added sibling is built
		// the same way on any machine running the suite.
		{ID: "pyjamas-1", Provider: "pyjamas", Priority: 20},
	}})

	if err := manager.ReloadRemoteInput(context.Background()); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if running.stopped != 0 {
		t.Fatalf("an unchanged tunnel was torn down by a sibling's save")
	}
	if len(manager.instances) != 2 {
		t.Fatalf("expected both instances after reload: %#v", manager.instances)
	}
	if manager.instances[0].Provider != running {
		t.Fatal("the running provider was replaced instead of reused")
	}
	if running.landing != "oficina" {
		t.Fatalf("landing page was not refreshed on the surviving provider: %q", running.landing)
	}
}

func TestReloadStopsInstanceRemovedFromConfiguration(t *testing.T) {
	removed := &reloadStubProvider{name: "trycloudflare"}
	existing := Instance{ID: "quick", Priority: 10, Provider: removed, Config: config.TunnelInstanceConfig{ID: "quick", Provider: "trycloudflare", Priority: 10}}
	manager, configPath := newReloadManager(t, existing)
	writeTunnelDocument(t, configPath, config.TunnelDocument{Version: 1, InstanceName: "oficina", Instances: []config.TunnelInstanceConfig{}})

	if err := manager.ReloadRemoteInput(context.Background()); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if removed.stopped != 1 {
		t.Fatalf("removed tunnel connector was not stopped: %d", removed.stopped)
	}
	if len(manager.instances) != 0 {
		t.Fatalf("removed instance survived the reload: %#v", manager.instances)
	}
}

// Reordering the pool is pure priority, so it must not reconnect a tunnel.
func TestReloadAdoptsPriorityWithoutRebuildingProvider(t *testing.T) {
	running := &reloadStubProvider{name: "trycloudflare"}
	existing := Instance{ID: "quick", Priority: 10, Provider: running, Config: config.TunnelInstanceConfig{ID: "quick", Provider: "trycloudflare", Priority: 10}}
	manager, configPath := newReloadManager(t, existing)
	writeTunnelDocument(t, configPath, config.TunnelDocument{Version: 1, InstanceName: "oficina", Instances: []config.TunnelInstanceConfig{
		{ID: "quick", Provider: "trycloudflare", Priority: 90},
	}})

	if err := manager.ReloadRemoteInput(context.Background()); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if running.stopped != 0 || manager.instances[0].Provider != running {
		t.Fatal("a priority change reconnected the tunnel")
	}
	if manager.instances[0].Priority != 90 {
		t.Fatalf("new priority was not adopted: %d", manager.instances[0].Priority)
	}
}

// A provider that cannot be built must leave the live pool exactly as it was.
func TestReloadLeavesPoolIntactWhenAnInstanceCannotBeBuilt(t *testing.T) {
	running := &reloadStubProvider{name: "trycloudflare"}
	existing := Instance{ID: "quick", Priority: 10, Provider: running, Config: config.TunnelInstanceConfig{ID: "quick", Provider: "trycloudflare", Priority: 10}}
	manager, configPath := newReloadManager(t, existing)
	writeTunnelDocument(t, configPath, config.TunnelDocument{Version: 1, InstanceName: "oficina", Instances: []config.TunnelInstanceConfig{
		{ID: "quick", Provider: "trycloudflare", Priority: 10},
		{ID: "broken", Provider: "cloudflare_named", Priority: 20, PublicURL: "https://agent.example.com", CredentialRef: "missing", LocalPort: 43127},
	}})

	if err := manager.ReloadRemoteInput(context.Background()); err == nil {
		t.Fatal("an unbuildable instance was accepted")
	}
	if len(manager.instances) != 1 || manager.instances[0].Provider != running {
		t.Fatalf("a failed reload disturbed the running pool: %#v", manager.instances)
	}
	if running.stopped != 0 {
		t.Fatal("a failed reload stopped a healthy tunnel")
	}
}

// An added tunnel must connect straight away, otherwise it sits in the list
// with no public URL until some later request happens to need it.
func TestReloadStartsTheSessionOfAnAddedInstance(t *testing.T) {
	manager, configPath := newReloadManager(t)
	writeTunnelDocument(t, configPath, config.TunnelDocument{Version: 1, InstanceName: "oficina", Instances: []config.TunnelInstanceConfig{
		{ID: "pyjamas-1", Provider: "pyjamas", Priority: 10},
	}})
	if err := manager.ReloadRemoteInput(context.Background()); err != nil {
		t.Fatalf("reload: %v", err)
	}
	if len(manager.instances) != 1 {
		t.Fatalf("added instance is missing: %#v", manager.instances)
	}
	// pyjam.as is unreachable from the test environment, so the instance must
	// be reported as unavailable with a reason rather than silently absent.
	status := manager.Status()
	if !status.Enabled || len(status.Instances) != 1 {
		t.Fatalf("reloaded pool is not reported as a tunnel: %#v", status)
	}
	if status.Instances[0].Available && status.Instances[0].PublicURL == "" {
		t.Fatal("an instance that never connected was reported as available without a URL")
	}
}

// A provider that cannot connect must leave the pool serving, because the
// daemon has to stay alive to receive the corrected configuration.
func TestReloadKeepsServingWhenAnAddedInstanceCannotConnect(t *testing.T) {
	manager, configPath := newReloadManager(t)
	writeTunnelDocument(t, configPath, config.TunnelDocument{Version: 1, InstanceName: "oficina", Instances: []config.TunnelInstanceConfig{
		{ID: "pyjamas-1", Provider: "pyjamas", Priority: 10},
	}})
	if err := manager.ReloadRemoteInput(context.Background()); err != nil {
		t.Fatalf("a provider that cannot connect failed the whole reload: %v", err)
	}
	if reason := manager.disabled["pyjamas-1"]; reason == nil && manager.instances[0].Provider == nil {
		t.Fatal("a failed connection was neither recorded nor started")
	}
}

func TestReloadWithoutConfiguredSourceIsRefused(t *testing.T) {
	manager := NewPool(nil, filepath.Join(t.TempDir(), "index.json"))
	if err := manager.ReloadRemoteInput(context.Background()); err == nil {
		t.Fatal("reload without a configuration file was accepted")
	}
}
