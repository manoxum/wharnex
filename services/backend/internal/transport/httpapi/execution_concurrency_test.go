package httpapi

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/config"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func TestUpdateExecutionConcurrencyPersistsBeforeApplying(t *testing.T) {
	settingsFile := filepath.Join(t.TempDir(), "execution-settings.json")
	service := app.NewService(
		session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20),
		manual.New(), policy.NewEngine(), sandbox.NewLocalRunner(),
	)
	api := &API{service: service, cfg: config.Config{ExecutionSettingsFile: settingsFile}}
	request := httptest.NewRequest(http.MethodPut, "/api/execution-concurrency", strings.NewReader(`{"concurrency":3}`))
	response := httptest.NewRecorder()

	api.updateExecutionConcurrency(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
	if service.ExecutionConcurrency() != 3 {
		t.Fatalf("live concurrency = %d, want 3", service.ExecutionConcurrency())
	}
	stored, err := config.ReadExecutionSettings(settingsFile, 1)
	if err != nil {
		t.Fatal(err)
	}
	if stored.ProjectConcurrency != 3 {
		t.Fatalf("stored concurrency = %d, want 3", stored.ProjectConcurrency)
	}
}
