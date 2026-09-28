package httpapi

import (
	"encoding/json"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/orchestrator"
)

func TestWorkspaceAttentionResponseTransportsOrchestratorConclusions(t *testing.T) {
	completedAt := time.Date(2026, time.September, 28, 4, 10, 0, 0, time.UTC)
	response := workspaceAttentionResponse{
		Records: []app.AttentionRecord{},
		OrchestratorConclusions: []orchestrator.TaskConclusion{{
			RunID: "run-1", TaskID: "task-1", Title: "Build projection", Status: orchestrator.TaskReview, CompletedAt: completedAt,
		}},
	}
	raw, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Records                 []app.AttentionRecord         `json:"records"`
		OrchestratorConclusions []orchestrator.TaskConclusion `json:"orchestrator_conclusions"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Records == nil || len(decoded.OrchestratorConclusions) != 1 {
		t.Fatalf("workspace attention transport lost compact collections: %s", raw)
	}
	got := decoded.OrchestratorConclusions[0]
	if got.RunID != "run-1" || got.TaskID != "task-1" || got.Title != "Build projection" || got.Status != orchestrator.TaskReview || !got.CompletedAt.Equal(completedAt) {
		t.Fatalf("workspace attention transport changed conclusion identity: %#v", got)
	}
}
