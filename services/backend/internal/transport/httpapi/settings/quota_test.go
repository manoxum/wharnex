package settings_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/config"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/transport/httpapi/settings"
)

func TestBundleQuotaHTTPLabelsDevelopmentFallbackAndReconcilesBreakdown(t *testing.T) {
	now := time.Now().UTC()
	requestID := "req_20261006T150000_1111111111111111"
	store := session.NewStore()
	if err := store.Put(domain.Session{ID: "quota-session", ProjectPath: t.TempDir(), CreatedAt: now, Artifacts: []domain.ArtifactRecord{
		{ID: "sent", RequestID: requestID, Direction: "input", Kind: "bundle", Bundle: true, Name: "whx_bundle_req_chat_" + requestID + ".zip", CreatedAt: now},
		{ID: "received", RequestID: requestID, Direction: "output", Kind: "bundle", Bundle: true, Name: "whx_bundle_res_chat_" + requestID + ".zip", CreatedAt: now},
	}}); err != nil {
		t.Fatal(err)
	}
	service := app.NewService(store, audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20), manual.New(), policy.NewEngine(), sandbox.NewLocalRunner())
	service.SetBundleWindowLimit(1)
	response := httptest.NewRecorder()
	settings.New(service, config.Config{}).BundleQuota(response, httptest.NewRequest(http.MethodGet, "/api/bundle-quota", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("quota status = %d", response.Code)
	}
	var quota app.BundleQuota
	if err := json.Unmarshal(response.Body.Bytes(), &quota); err != nil {
		t.Fatal(err)
	}
	if quota.Source != "artifacts" || quota.Sent != 1 || quota.Received != 1 || quota.Total != 2 || quota.EstimatedReceived != 1 || !quota.Warning {
		t.Fatalf("development fallback must remain explicit: %#v", quota)
	}
	if len(quota.ByTaskType) != 1 || quota.ByTaskType[0].Type != "AGENT_REQUEST" || quota.ByTaskType[0].Total != quota.Total {
		t.Fatalf("HTTP breakdown does not reconcile: %#v", quota.ByTaskType)
	}
}
