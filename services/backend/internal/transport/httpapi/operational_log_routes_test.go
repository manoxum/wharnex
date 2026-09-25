package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/session"
)

func operationalLogHandler() http.Handler {
	mux := http.NewServeMux()
	(&API{store: session.NewStore()}).registerOperationalLogRoutes(mux)
	return mux
}

func TestOperationalLogIsRefusedThroughTheRemoteIngress(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		request := httptest.NewRequest(method, "/api/operational-log", strings.NewReader(`{"records":[]}`))
		request.Header.Set("X-Wharnex-Remote", "1")
		response := httptest.NewRecorder()
		operationalLogHandler().ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatalf("%s through the remote ingress: status %d", method, response.Code)
		}
	}
}

func TestOperationalLogIngestAcceptsOnlyClientSources(t *testing.T) {
	body := `{"records":[
		{"source":"desktop","event":"chatgpt-upload","message":"confirmed"},
		{"source":"frontend","event":"frontend-renderer","level":"error"},
		{"source":"backend","event":"forged.backend_event"}]}`
	request := httptest.NewRequest(http.MethodPost, "/api/operational-log", strings.NewReader(body))
	response := httptest.NewRecorder()
	operationalLogHandler().ServeHTTP(response, request)
	var result struct {
		Accepted int `json:"accepted"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || response.Code != http.StatusOK {
		t.Fatalf("status %d body %s", response.Code, response.Body.String())
	}
	if result.Accepted != 2 {
		t.Fatalf("a client may not write backend records: accepted=%d", result.Accepted)
	}
}

func TestOperationalLogIngestBoundsTheBatch(t *testing.T) {
	records := strings.TrimSuffix(strings.Repeat(`{"source":"desktop","event":"x"},`, 501), ",")
	request := httptest.NewRequest(http.MethodPost, "/api/operational-log", strings.NewReader(`{"records":[`+records+`]}`))
	response := httptest.NewRecorder()
	operationalLogHandler().ServeHTTP(response, request)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized batch: status %d", response.Code)
	}
}

func TestOperationalLogExportIsALocalDownloadableDossier(t *testing.T) {
	response := httptest.NewRecorder()
	operationalLogHandler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/operational-log/export?min_level=warning", nil))
	var dossier struct {
		Protocol string         `json:"protocol"`
		Filter   map[string]any `json:"filter"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &dossier); err != nil || response.Code != http.StatusOK {
		t.Fatalf("status %d body %s", response.Code, response.Body.String())
	}
	if dossier.Protocol != "wharnex.operational-log-dossier/v1" || dossier.Filter["min_level"] != "warning" {
		t.Fatalf("unexpected dossier header: %#v", dossier)
	}
	if !strings.HasPrefix(response.Header().Get("Content-Disposition"), `attachment; filename="wharnex-diario-`) {
		t.Fatalf("export must download as a file: %q", response.Header().Get("Content-Disposition"))
	}
	remote := httptest.NewRequest(http.MethodGet, "/api/operational-log/export", nil)
	remote.Header.Set("X-Wharnex-Remote", "1")
	refused := httptest.NewRecorder()
	operationalLogHandler().ServeHTTP(refused, remote)
	if refused.Code != http.StatusForbidden {
		t.Fatalf("remote export status %d", refused.Code)
	}
}
