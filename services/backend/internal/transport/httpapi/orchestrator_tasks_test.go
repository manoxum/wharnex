package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"kernl.local/harness/backend/internal/orchestrator"
)

func TestOrchestratorClientOverviewOmitsTerminalTasksButKeepsCounts(t *testing.T) {
	overview := orchestrator.Overview{
		Tasks: []orchestrator.Task{
			{ID: "ready", Status: orchestrator.TaskReady},
			{ID: "complete", Status: orchestrator.TaskComplete},
			{ID: "archived", Status: orchestrator.TaskArchived},
		},
		TaskCounts: map[orchestrator.TaskStatus]int{
			orchestrator.TaskReady: 1, orchestrator.TaskComplete: 1, orchestrator.TaskArchived: 1,
		},
	}
	projected := orchestratorClientOverview(overview)
	if len(projected.Tasks) != 1 || projected.Tasks[0].ID != "ready" {
		t.Fatalf("terminal tasks leaked into client overview: %#v", projected.Tasks)
	}
	if projected.TaskCounts[orchestrator.TaskComplete] != 1 || projected.TaskCounts[orchestrator.TaskArchived] != 1 {
		t.Fatalf("terminal counts were lost: %#v", projected.TaskCounts)
	}
	if len(overview.Tasks) != 3 {
		t.Fatal("client projection mutated the source overview slice")
	}
}

func TestOrchestratorTasksRejectsInvalidPageLimitBeforeServiceAccess(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/sessions/ses/orchestrator/tasks?limit=0", nil)
	request.SetPathValue("id", "ses")
	response := httptest.NewRecorder()
	(&API{}).orchestratorTasks(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}
