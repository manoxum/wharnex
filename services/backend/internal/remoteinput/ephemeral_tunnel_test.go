package remoteinput

import (
	"net/url"
	"testing"
)

func TestEphemeralTunnelProfilesOnlyAcceptTheirOwnHTTPSOrigins(t *testing.T) {
	tests := []struct{ provider, accepted, rejected string }{
		{"zrok", "https://demo.share.zrok.io", "https://demo.example.com"},
		{"localxpose", "https://demo.loclx.io", "https://demo.example.com"},
		{"localhost_run", "https://demo.lhr.life", "https://demo.example.com"},
		{"pinggy", "https://demo.free.pinggy.net", "https://demo.example.com"},
		{"serveo", "https://demo.serveo.net", "https://demo.example.com"},
	}
	for _, test := range tests {
		t.Run(test.provider, func(t *testing.T) {
			profile := ephemeralTunnelProfiles()[test.provider]
			accepted, _ := url.Parse(test.accepted)
			rejected, _ := url.Parse(test.rejected)
			if !profile.validHost(accepted.Hostname()) || profile.validHost(rejected.Hostname()) {
				t.Fatalf("unexpected hostname policy for %s", test.provider)
			}
		})
	}
}

func TestPinggyAcceptsBothCurrentPublicDomains(t *testing.T) {
	profile := ephemeralTunnelProfiles()["pinggy"]
	for _, candidate := range []string{"https://demo.free.pinggy.net", "https://demo.run.pinggy-free.link"} {
		parsed, _ := url.Parse(candidate)
		if !profile.validHost(parsed.Hostname()) {
			t.Fatalf("Pinggy public host was rejected: %s", candidate)
		}
	}
}
