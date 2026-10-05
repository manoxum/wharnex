package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
)

func TestSyncRecapturesAMissingContextArchive(t *testing.T) {
	sessions := session.NewStore()
	routes, err := New(sessions, t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "context.zip")
	if err := os.WriteFile(archive, []byte("context"), 0o600); err != nil {
		t.Fatal(err)
	}
	stale := domain.Session{ID: "ses_restart", ProjectPath: t.TempDir(), Context: domain.ContextBundle{Manifest: domain.ContextManifest{SHA256: strings.Repeat("c", 64)}}}
	if err := sessions.Put(stale); err != nil {
		t.Fatal(err)
	}
	refreshed := 0
	routes.SetContextRefresher(func(id string) (domain.Session, error) {
		refreshed++
		fresh := stale
		fresh.Context.ZipPath = archive
		return fresh, nil
	})
	mux := http.NewServeMux()
	routes.Register(mux)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/sessions/ses_restart/ui-testing/sync", nil))
	if response.Code != http.StatusAccepted || refreshed != 1 {
		t.Fatalf("status=%d refreshed=%d body=%s", response.Code, refreshed, response.Body.String())
	}
}
