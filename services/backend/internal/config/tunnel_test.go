package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTunnelConfigMigratesTryCloudflareFromStorageOnly(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "remote-storage.json")
	if err := os.WriteFile(legacy, []byte(`{"version":1,"instances":[{"id":"drive","provider":"rclone","priority":1,"rclone_remote":"drive-main"},{"id":"tunnel","provider":"trycloudflare","priority":10}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	document, err := ReadTunnelDocument(TunnelConfig{ConfigFile: filepath.Join(root, "tunnel-providers.json"), LegacyStorageFile: legacy})
	if err != nil {
		t.Fatal(err)
	}
	if len(document.Instances) != 1 || document.Instances[0].ID != "tunnel" || document.Instances[0].Provider != "trycloudflare" {
		t.Fatalf("unexpected migrated tunnel config: %#v", document)
	}
}

func TestTunnelConfigRoundTripsAndRejectsStorageDrivers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "tunnel-providers.json")
	cfg := TunnelConfig{ConfigFile: path}
	document := TunnelDocument{Version: 1, InstanceName: "Oficina", Instances: []TunnelInstanceConfig{{ID: "primary", Provider: "trycloudflare", Priority: 10}}}
	if err := SaveTunnelDocument(cfg, document); err != nil {
		t.Fatal(err)
	}
	loaded, err := ReadTunnelDocument(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Instances) != 1 || loaded.Instances[0] != document.Instances[0] {
		t.Fatalf("unexpected tunnel round trip: %#v", loaded)
	}
	if _, err := DecodeTunnelDocument([]byte(`{"version":1,"instances":[{"id":"drive","provider":"drive","priority":10}]}`)); err == nil {
		t.Fatal("storage driver was accepted as a tunnel provider")
	}
}

func TestTunnelConfigDropsLegacyDesktopDirectPseudoProvider(t *testing.T) {
	document, err := DecodeTunnelDocument([]byte(`{"version":1,"instances":[{"id":"desktop-direct","provider":"desktop_direct","priority":1000}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(document.Instances) != 0 {
		t.Fatalf("desktop transport leaked into tunnel provider config: %#v", document)
	}
}

func TestTunnelConfigRequiresSafeInstanceNameWhenSaved(t *testing.T) {
	cfg := TunnelConfig{ConfigFile: filepath.Join(t.TempDir(), "tunnel-providers.json")}
	if err := SaveTunnelDocument(cfg, TunnelDocument{Version: 1}); err == nil {
		t.Fatal("saved tunnel configuration without an instance name")
	}
	if err := SaveTunnelDocument(cfg, TunnelDocument{Version: 1, InstanceName: "bad\nname"}); err == nil {
		t.Fatal("saved tunnel configuration with a control character")
	}
}

// pyjam.as allocates its own address, peer and slug on every run, so the
// document may never carry an origin or account field a restart would falsify.
func TestTunnelConfigTreatsPyjamasAsTemporary(t *testing.T) {
	valid := []byte(`{"version":1,"instances":[{"id":"pyjamas","provider":"pyjamas","priority":40}]}`)
	if _, err := DecodeTunnelDocument(valid); err != nil {
		t.Fatalf("valid pyjam.as config rejected: %v", err)
	}
	invalid := []byte(`{"version":1,"instances":[{"id":"pyjamas","provider":"pyjamas","priority":40,"public_url":"https://a1b2c3.tunnel.pyjam.as"}]}`)
	if _, err := DecodeTunnelDocument(invalid); err == nil {
		t.Fatal("pyjam.as instance accepted a pinned public origin")
	}
}

func TestTunnelConfigAcceptsOnlyConfiguredTailscaleFunnelOrigin(t *testing.T) {
	valid := []byte(`{"version":1,"instances":[{"id":"tailnet","provider":"tailscale_funnel","priority":1,"public_url":"https://node.example.ts.net","local_port":43127}]}`)
	if _, err := DecodeTunnelDocument(valid); err != nil {
		t.Fatalf("valid Tailscale Funnel config rejected: %v", err)
	}
	invalid := []byte(`{"version":1,"instances":[{"id":"tailnet","provider":"tailscale_funnel","priority":1,"public_url":"https://example.com","local_port":43127}]}`)
	if _, err := DecodeTunnelDocument(invalid); err == nil {
		t.Fatal("non-.ts.net Tailscale Funnel origin accepted")
	}
}
