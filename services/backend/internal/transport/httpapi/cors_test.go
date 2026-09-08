package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAllowedOriginsIncludesConfiguredFrontendOrigin(t *testing.T) {
	origins := allowedOrigins("http://127.0.0.1:5175")
	want := map[string]bool{"http://localhost:5173": true, "http://127.0.0.1:5173": true, "http://127.0.0.1:5175": true}
	if len(origins) != len(want) {
		t.Fatalf("allowedOrigins() = %v, want %d entries", origins, len(want))
	}
	for _, origin := range origins {
		if !want[origin] {
			t.Fatalf("allowedOrigins() included unexpected origin %q", origin)
		}
	}
}

func TestAllowedOriginsDoesNotDuplicateTheDefaultPort(t *testing.T) {
	origins := allowedOrigins("http://127.0.0.1:5173")
	if len(origins) != 2 {
		t.Fatalf("allowedOrigins(default) = %v, want exactly the 2 historical entries with no duplicate", origins)
	}
}

func TestCORSReflectsOnlyAllowlistedOrigins(t *testing.T) {
	handler := cors(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }), allowedOrigins("http://127.0.0.1:5175"))

	// A checkout running its frontend on a non-default port (e.g. wharnex-legacy
	// on 5175) must still receive Access-Control-Allow-Origin, or every fetch()
	// from that origin fails in-browser as "Failed to fetch".
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "http://127.0.0.1:5175")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:5175" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want the configured frontend origin", got)
	}

	// An unrelated origin must not be reflected back.
	req = httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "http://evil.example")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want empty for an unlisted origin", got)
	}
}
