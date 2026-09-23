package remoteinput

import (
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"kernl.local/harness/backend/internal/config"
)

// NewDegradedTunnelManager returns an empty pool still bound to cfg. A daemon
// whose saved configuration could not be built uses it to keep serving, so the
// operator can correct the document and have it adopted through
// ReloadRemoteInput instead of being left with a dead tunnel service.
func NewDegradedTunnelManager(cfg config.TunnelConfig) *Manager {
	manager := NewPool(nil, cfg.IndexFile)
	manager.source = cfg
	return manager
}

func NewTunnelManager(cfg config.TunnelConfig) (*Manager, error) {
	document, err := config.ReadTunnelDocument(cfg)
	if err != nil {
		return nil, err
	}
	configs := append([]config.TunnelInstanceConfig(nil), document.Instances...)
	landing := TunnelLanding{InstanceName: document.InstanceName, Origins: configuredTunnelOrigins(configs)}
	sort.SliceStable(configs, func(i, j int) bool { return configs[i].Priority < configs[j].Priority })
	instances := make([]Instance, 0, len(configs))
	for _, instanceConfig := range configs {
		if strings.EqualFold(instanceConfig.Provider, "desktop_direct") {
			continue
		}
		provider, err := tunnelProvider(instanceConfig, filepath.Dir(cfg.IndexFile), cfg.SecretsDir, landing)
		if err != nil {
			return nil, fmt.Errorf("tunnel instance %s: %w", instanceConfig.ID, err)
		}
		instances = append(instances, Instance{ID: instanceConfig.ID, Priority: instanceConfig.Priority, Provider: provider, Config: instanceConfig})
	}
	manager := NewPool(instances, cfg.IndexFile)
	manager.source = cfg
	return manager, nil
}

func configuredTunnelOrigins(configs []config.TunnelInstanceConfig) []string {
	origins := make([]string, 0, len(configs))
	seen := make(map[string]struct{}, len(configs))
	for _, instance := range configs {
		origin := strings.TrimSpace(instance.PublicURL)
		if origin == "" {
			continue
		}
		if _, exists := seen[origin]; !exists {
			seen[origin] = struct{}{}
			origins = append(origins, origin)
		}
	}
	return origins
}

func tunnelProvider(cfg config.TunnelInstanceConfig, stateDir, secretsDir string, landing TunnelLanding) (Provider, error) {
	storageDir := filepath.Join(stateDir, "tunnel-inputs", cfg.ID)
	switch strings.ToLower(strings.TrimSpace(cfg.Provider)) {
	case "trycloudflare":
		return NewTryCloudflareProvider(TryCloudflareConfig{StorageDir: storageDir, Landing: landing})
	case "zrok", "localxpose", "localhost_run", "pinggy", "serveo":
		return NewEphemeralTunnelProvider(strings.ToLower(strings.TrimSpace(cfg.Provider)), storageDir, landing)
	case "pyjamas":
		return NewPyjamasTunnelProvider(storageDir, landing)
	case "tailscale_funnel":
		return NewTailscaleFunnelProvider(AccountTunnelConfig{StorageDir: storageDir, PublicURL: cfg.PublicURL, LocalPort: cfg.LocalPort, Landing: landing})
	case "cloudflare_named", "ngrok":
		return NewAccountTunnelProvider(AccountTunnelConfig{Provider: cfg.Provider, StorageDir: storageDir, SecretsDir: secretsDir, CredentialRef: cfg.CredentialRef, PublicURL: cfg.PublicURL, LocalPort: cfg.LocalPort, Landing: landing})
	default:
		return nil, errors.New("unsupported tunnel provider")
	}
}
