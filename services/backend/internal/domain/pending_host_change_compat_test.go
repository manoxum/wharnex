package domain

import (
	"encoding/json"
	"testing"
)

// Candidates persisted by the first submodule-native engine used
// integration_units. Losing those records on upgrade makes the advisory
// preflight see the owned gitlink as an ordinary services/app conflict again.
func TestPendingHostChangeDecodesLegacyIntegrationUnits(t *testing.T) {
	raw := []byte(`{
  "integration_branch": "whx/req_legacy",
  "integration_commit": "root-commit",
  "integration_units": [
    {"path":"services/app","branch":"whx/req_legacy","commit":"app-commit"},
    {"path":"","branch":"whx/req_legacy","commit":"root-commit","pointer_updates":["services/app"]}
  ]
}`)
	var change PendingHostChange
	if err := json.Unmarshal(raw, &change); err != nil {
		t.Fatal(err)
	}
	if len(change.SubmoduleIntegrations) != 1 {
		t.Fatalf("legacy candidate lost its nested repository records: %+v", change.SubmoduleIntegrations)
	}
	integration := change.SubmoduleIntegrations[0]
	if integration.Path != "services/app" || integration.Branch != "whx/req_legacy" || integration.Commit != "app-commit" {
		t.Fatalf("legacy nested candidate was decoded incorrectly: %+v", integration)
	}
	if integration.TargetBranch != "" || integration.BaseCommit != "" {
		t.Fatalf("decoder invented checkout identity that old records did not contain: %+v", integration)
	}
}
