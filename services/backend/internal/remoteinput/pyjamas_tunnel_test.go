package remoteinput

import (
	"context"
	"net"
	"net/netip"
	"net/url"
	"strings"
	"testing"
	"time"
)

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
