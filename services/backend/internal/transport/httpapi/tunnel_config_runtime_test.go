package httpapi

import (
	"testing"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/config"
)

func TestTunnelRuntimeDiffersDetectsConfigurationNotLoadedByRuntime(t *testing.T) {
	document := config.TunnelDocument{Version: 1, Instances: []config.TunnelInstanceConfig{
		{ID: "quick-primary", Provider: "trycloudflare", Priority: 10},
		{ID: "ngrok-secondary", Provider: "ngrok", Priority: 20},
	}}
	runtime := app.RemoteInputStatus{Instances: []app.RemoteInputInstanceStatus{
		{ID: "ngrok-secondary", Provider: "ngrok", Priority: 20},
	}}
	if !tunnelRuntimeDiffers(document, runtime) {
		t.Fatal("stored configuration drift must require a restart")
	}
}

func TestTunnelRuntimeDiffersAcceptsOrderedRuntimeMatch(t *testing.T) {
	document := config.TunnelDocument{Version: 1, Instances: []config.TunnelInstanceConfig{{ID: "quick", Provider: "trycloudflare", Priority: 10}}}
	runtime := app.RemoteInputStatus{Instances: []app.RemoteInputInstanceStatus{{ID: "quick", Provider: "trycloudflare", Priority: 10}}}
	if tunnelRuntimeDiffers(document, runtime) {
		t.Fatal("matching runtime must not require a restart")
	}
}

func TestConfiguredTunnelRootsFillStatusFromOlderDaemonResponses(t *testing.T) {
	document := config.TunnelDocument{Instances: []config.TunnelInstanceConfig{{ID: "ngrok", PublicURL: "https://stable.ngrok.app/"}}}
	status := app.RemoteInputStatus{Instances: []app.RemoteInputInstanceStatus{{ID: "ngrok", Available: true}}}
	status = mergeConfiguredTunnelURLs(document, status)
	if status.Instances[0].PublicURL != "https://stable.ngrok.app" {
		t.Fatalf("configured public root was not restored: %#v", status.Instances[0])
	}
}
