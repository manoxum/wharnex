package tunneldaemon

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/app"
)

func TestClientReturnsDecodedProviderAndPublicationResponses(t *testing.T) {
	const token = "test-token"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+token {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case APIPathProviders:
			_ = json.NewEncoder(w).Encode(map[string]any{"providers": []app.TunnelProviderDescriptor{{ID: "trycloudflare", Available: true}}})
		case APIPathPublish:
			_ = json.NewEncoder(w).Encode(app.RemoteInputPublication{Provider: "trycloudflare", URL: "https://example.test/input.zip"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	client := &Client{baseURL: server.URL, token: token, http: server.Client()}
	providers, err := client.Providers(context.Background())
	if err != nil || len(providers) != 1 || providers[0].ID != "trycloudflare" {
		t.Fatalf("unexpected providers: %#v err=%v", providers, err)
	}
	publication, err := client.Publish(context.Background(), app.RemoteInputObject{ObjectName: "input.zip"})
	if err != nil || publication.Provider != "trycloudflare" || !strings.HasPrefix(publication.URL, "https://") {
		t.Fatalf("unexpected publication: %#v err=%v", publication, err)
	}
}

func TestClientStopDoesNotContactDaemon(t *testing.T) {
	client := &Client{baseURL: "http://127.0.0.1:1", token: "unused", http: http.DefaultClient}
	if err := client.StopRemoteInputSession(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestValidateBaseURLRejectsExternalOrigins(t *testing.T) {
	for _, candidate := range []string{"https://tunnel:8090", "http://example.com:8090", "http://backend:8090"} {
		if _, err := validateBaseURL(candidate); err == nil {
			t.Fatalf("expected %q to be rejected", candidate)
		}
	}
	if got, err := validateBaseURL("http://tunnel:8090/"); err != nil || got != "http://tunnel:8090" {
		t.Fatalf("unexpected internal URL validation: %q %v", got, err)
	}
}

func TestServerSourceValidationIsBridgeBound(t *testing.T) {
	bridge := t.TempDir()
	server, err := NewServer(nil, nil, nil, bridge)
	if err != nil {
		t.Fatal(err)
	}
	inside := bridge + "/resource.bin"
	if err := os.WriteFile(inside, []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	insideRecorder := httptest.NewRecorder()
	if !server.validateSourcePath(insideRecorder, inside) {
		t.Fatalf("bridge file rejected: %s", insideRecorder.Body.String())
	}
	outside := t.TempDir() + "/outside.bin"
	if err := os.WriteFile(outside, []byte("no"), 0o600); err != nil {
		t.Fatal(err)
	}
	outsideRecorder := httptest.NewRecorder()
	if server.validateSourcePath(outsideRecorder, outside) || outsideRecorder.Code != http.StatusBadRequest {
		t.Fatalf("outside path should fail closed: code=%d", outsideRecorder.Code)
	}
}
