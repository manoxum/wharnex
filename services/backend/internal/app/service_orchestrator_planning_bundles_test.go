package app

import (
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// The planning detail shows the ZIPs exchanged for that one request, the
// request before the response, and nothing from other requests.
func TestOrchestratorPlanningBundlesListOnlyThisRequestRequestFirst(t *testing.T) {
	now := time.Date(2026, 9, 29, 7, 0, 0, 0, time.UTC)
	artifacts := []domain.ArtifactRecord{
		{ID: "a1", RequestID: "orp_x", Direction: "output", Kind: "bundle", Name: "whx_bundle_res_orchestrator_orp_x.zip", CreatedAt: now.Add(time.Minute)},
		{ID: "a2", RequestID: "orp_x", Direction: "input", Kind: "bundle", Name: "whx_bundle_req_orchestrator_orp_x.zip", CreatedAt: now},
		{ID: "a3", RequestID: "orp_y", Direction: "input", Kind: "bundle", Name: "other.zip", CreatedAt: now},
		{ID: "a4", RequestID: "orp_x", Direction: "input", Kind: "context", Name: "context.zip", CreatedAt: now},
	}
	bundles := orchestratorPlanningBundles(artifacts, "orp_x")
	if len(bundles) != 2 || bundles[0].ID != "a2" || bundles[1].ID != "a1" {
		t.Fatalf("bundles = %#v", bundles)
	}
}
