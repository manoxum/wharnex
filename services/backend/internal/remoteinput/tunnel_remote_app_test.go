package remoteinput

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTunnelProxiesOrdinaryApplicationRoutes(t *testing.T) {
	var method, path, body, marker string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, path, marker = r.Method, r.URL.Path, r.Header.Get("X-Wharnex-Tunnel")
		raw, _ := io.ReadAll(r.Body)
		body = string(raw)
		w.WriteHeader(http.StatusAccepted)
	}))
	defer upstream.Close()

	provider := &TryCloudflareProvider{objects: map[string]string{}, remoteAppOrigin: upstream.URL}
	request := httptest.NewRequest(http.MethodPost, "/api/pairing/claim", strings.NewReader(`{"code":"abc"}`))
	response := httptest.NewRecorder()
	provider.serveHTTP(response, request)

	if response.Code != http.StatusAccepted || method != http.MethodPost || path != "/api/pairing/claim" || body != `{"code":"abc"}` || marker != "1" {
		t.Fatalf("unexpected proxy request: status=%d method=%q path=%q body=%q marker=%q", response.Code, method, path, body, marker)
	}
}

func TestTunnelStatusStillTakesPrecedenceOverRemoteApp(t *testing.T) {
	upstreamCalled := false
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { upstreamCalled = true }))
	defer upstream.Close()
	provider := &TryCloudflareProvider{objects: map[string]string{}, remoteAppOrigin: upstream.URL}
	response := httptest.NewRecorder()
	provider.serveHTTP(response, httptest.NewRequest(http.MethodGet, "/status", nil))
	if response.Code != http.StatusOK || upstreamCalled {
		t.Fatalf("status route lost precedence: status=%d upstream=%v", response.Code, upstreamCalled)
	}
}
