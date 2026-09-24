package remoteinput

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A tunnel document is a credential-bearing lease: restarting the backend must
// reconnect with that lease, rather than allocating a different public slug.
func TestPyjamasProviderReusesPersistedTunnelConfigAfterRestart(t *testing.T) {
	storage := t.TempDir()
	if err := os.WriteFile(filepath.Join(storage, pyjamasConfigFileName), []byte(pyjamasSampleConfig), 0o600); err != nil {
		t.Fatal(err)
	}
	starts := 0
	provisions := 0
	starter := pyjamasStarter{configPath: filepath.Join(storage, pyjamasConfigFileName), forward: func(context.Context, pyjamasConfig, uint16, string) (pyjamasStopper, error) {
		starts++
		return func() {}, nil
	}, provision: func(context.Context, *http.Client, int) (pyjamasConfig, string, error) {
		provisions++
		return pyjamasConfig{}, "", errors.New("unexpected tunnel provisioning")
	}, ready: func(context.Context, *url.URL) error { return nil }}
	provider, err := newPyjamasTunnelProvider(storage, TunnelLanding{InstanceName: "wharnex"}, starter)
	if err != nil {
		t.Fatalf("restore provider: %v", err)
	}
	if provider.listenAddr != "127.0.0.1:43127" {
		t.Fatalf("restarted provider did not restore its tunnel port: %s", provider.listenAddr)
	}
	provider.ready = func(context.Context, *url.URL) error { return nil }
	if err := provider.StartSession(context.Background()); err != nil {
		t.Fatalf("restart provider: %v", err)
	}
	defer provider.StopSession(context.Background())
	if starts != 1 {
		t.Fatalf("expected persisted WireGuard config to start once, got %d starts", starts)
	}
	if provisions != 0 {
		t.Fatalf("restart provisioned a new tunnel %d times", provisions)
	}
	if got := provider.PublicURL(); got != "https://a1b2c3.tunnel.pyjam.as" {
		t.Fatalf("restart changed the public URL: %s", got)
	}
}

func TestPyjamasProviderAcceptsOnlyItsOwnOrigins(t *testing.T) {
	provider, err := NewPyjamasTunnelProvider(t.TempDir(), TunnelLanding{InstanceName: "wharnex"})
	if err != nil {
		t.Fatalf("build pyjam.as provider: %v", err)
	}
	if provider.Name() != "pyjamas" {
		t.Fatalf("unexpected provider name %s", provider.Name())
	}
	if provider.persistentDNS {
		t.Fatal("pyjam.as was registered as a permanent-DNS provider")
	}
	if !strings.HasPrefix(provider.listenAddr, "127.0.0.1:") {
		t.Fatalf("object server left loopback: %s", provider.listenAddr)
	}
	accepted, _ := url.Parse("https://a1b2c3.tunnel.pyjam.as")
	if !provider.validatePublic(accepted) {
		t.Fatal("legitimate pyjam.as origin rejected")
	}
	for _, raw := range []string{"https://tunnel.pyjam.as", "https://a1b2c3.tunnel.pyjam.as.example.com", "http://a1b2c3.tunnel.pyjam.as"} {
		candidate, _ := url.Parse(raw)
		if provider.validatePublic(candidate) {
			t.Fatalf("accepted foreign origin %s", raw)
		}
	}
}

// The starter must refuse anything that is not a bounded loopback origin before
// it reaches the network.
func TestPyjamasStarterRequiresABoundedLocalPort(t *testing.T) {
	for _, origin := range []string{"", "http://127.0.0.1", "http://127.0.0.1:80", "not a url"} {
		if _, _, err := (pyjamasStarter{}).Start(context.Background(), origin); err == nil {
			t.Fatalf("accepted unusable origin %q", origin)
		}
	}
}

func TestPyjamasStarterRefreshesAnUnreachableSavedLease(t *testing.T) {
	storage := t.TempDir()
	configPath := filepath.Join(storage, pyjamasConfigFileName)
	if err := os.WriteFile(configPath, []byte(pyjamasSampleConfig), 0o600); err != nil {
		t.Fatal(err)
	}
	parsed, err := parsePyjamasConfig(pyjamasSampleConfig)
	if err != nil {
		t.Fatal(err)
	}
	starts, provisions, probes := 0, 0, 0
	starter := pyjamasStarter{
		configPath: configPath,
		forward: func(context.Context, pyjamasConfig, uint16, string) (pyjamasStopper, error) {
			starts++
			return func() {}, nil
		},
		provision: func(context.Context, *http.Client, int) (pyjamasConfig, string, error) {
			provisions++
			return parsed, pyjamasSampleConfig, nil
		},
		ready: func(context.Context, *url.URL) error {
			probes++
			if probes == 1 {
				return errors.New("saved lease is unreachable")
			}
			return nil
		},
	}
	if err := starter.load(); err != nil {
		t.Fatal(err)
	}
	if _, stop, err := starter.Start(context.Background(), "http://127.0.0.1:43127"); err != nil {
		t.Fatalf("refresh saved lease: %v", err)
	} else {
		stop()
	}
	if starts != 2 || provisions != 1 || probes != 2 {
		t.Fatalf("starts=%d provisions=%d probes=%d, want 2, 1, 2", starts, provisions, probes)
	}
}

// The userspace stack carries IPv4 only, matching what the service allocates.
func TestUserspaceNetRejectsNonIPv4Addresses(t *testing.T) {
	if device, err := newUserspaceNet(netip.MustParseAddr("fd00::1")); err == nil {
		device.Close()
		t.Fatal("IPv6 address accepted for the userspace tunnel")
	}
}

// A userspace listener must never appear as a socket on the host.
func TestUserspaceNetListensOutsideTheHostNetwork(t *testing.T) {
	device, err := newUserspaceNet(netip.MustParseAddr("10.101.0.7"))
	if err != nil {
		t.Fatalf("create userspace stack: %v", err)
	}
	defer device.Close()
	listener, err := device.ListenTCP(43127)
	if err != nil {
		t.Fatalf("listen inside userspace stack: %v", err)
	}
	defer listener.Close()
	if probe, err := net.DialTimeout("tcp", "127.0.0.1:43127", 250*time.Millisecond); err == nil {
		probe.Close()
		t.Fatal("userspace tunnel listener was reachable on the host loopback")
	}
}
