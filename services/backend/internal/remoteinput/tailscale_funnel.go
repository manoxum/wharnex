package remoteinput

import (
	"context"
	"errors"
	"net/url"
	"strconv"
	"strings"
)

// NewTailscaleFunnelProvider serves the Wharness loopback resource server on
// a port that the user has explicitly configured in Tailscale Funnel. We do
// not invoke `tailscale funnel` ourselves: it changes shared tailnet ingress
// state and could overwrite an operator's existing Funnel configuration.
func NewTailscaleFunnelProvider(cfg AccountTunnelConfig) (*TryCloudflareProvider, error) {
	publicText, err := normalizeTunnelPublicURL(cfg.PublicURL)
	if err != nil {
		return nil, err
	}
	public, _ := url.Parse(publicText)
	if !strings.HasSuffix(strings.ToLower(public.Hostname()), ".ts.net") {
		return nil, errors.New("Tailscale Funnel public URL must use a .ts.net hostname")
	}
	if cfg.LocalPort < 1024 || cfg.LocalPort > 65535 {
		return nil, errors.New("Tailscale Funnel requires a local port between 1024 and 65535")
	}
	return newTunnelProvider(cfg.StorageDir, "tailscale_funnel", "127.0.0.1:"+strconv.Itoa(cfg.LocalPort), true, staticTunnelStarter{public: public}, cfg.Landing, func(candidate *url.URL) bool {
		return candidate != nil && candidate.String() == public.String()
	})
}

type staticTunnelStarter struct{ public *url.URL }

func (starter staticTunnelStarter) Start(_ context.Context, _ string) (*url.URL, func(), error) {
	return starter.public, func() {}, nil
}
