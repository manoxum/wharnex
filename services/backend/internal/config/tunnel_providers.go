package config

// Tunnel provider classification. This is the catalogue's single answer to
// "is this provider admitted" and "does it keep a stable public origin across
// restarts", kept apart from document decoding so adding a provider touches
// one small file.

// permanentTunnelProviders keep the same public origin across a restart, so
// their instances carry account and origin configuration.
var permanentTunnelProviders = map[string]struct{}{
	"cloudflare_named": {},
	"ngrok":            {},
	"tailscale_funnel": {},
}

// temporaryTunnelProviders allocate a fresh public origin on every run, so
// their instances may not carry origin or account fields at all.
var temporaryTunnelProviders = map[string]struct{}{
	"trycloudflare": {},
	"zrok":          {},
	"localxpose":    {},
	"localhost_run": {},
	"pinggy":        {},
	"serveo":        {},
	"pyjamas":       {},
}

func supportedTunnelProvider(provider string) bool {
	if _, exists := permanentTunnelProviders[provider]; exists {
		return true
	}
	return ephemeralTunnelProvider(provider)
}

func ephemeralTunnelProvider(provider string) bool {
	_, exists := temporaryTunnelProviders[provider]
	return exists
}
