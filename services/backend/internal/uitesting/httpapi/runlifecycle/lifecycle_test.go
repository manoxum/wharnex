package runlifecycle_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/httpapi"
)

func TestCatalogTracksActualTaskActivity(t *testing.T) {
	sessions := session.NewStore()
	stateDir, project := t.TempDir(), t.TempDir()
	if err := sessions.Put(domain.Session{ID: "ses_activity", ProjectPath: project}); err != nil {
		t.Fatal(err)
	}
	routes, err := httpapi.New(sessions, stateDir, "")
	if err != nil {
		t.Fatal(err)
	}
	store, err := uitesting.NewStore(filepath.Join(stateDir, "ui-testing"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.SaveDiscovery(project, uitesting.Discovery{Environments: []uitesting.Environment{{ID: "web", Name: "Web"}}, Tests: []uitesting.TestCase{{ID: "open", Title: "Open", Goal: "Open", EnvironmentID: "web", Access: "public"}}})
	if err != nil {
		t.Fatal(err)
	}
	task, err := sessions.EnqueueChatAgentTask(session.ChatAgentTask{Type: "UI_TEST_RUN", ChatID: "ui_activity", RequestID: "req_activity", RootRequestID: "req_activity", ProjectID: project, SessionID: "ses_activity", MaxAttempts: 3})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.BeginRun(project, uitesting.Run{ID: "run_activity", TestID: "open", TaskID: task.TaskID, Status: "queued", StartedAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	routes.Register(mux)
	assertStatus := func(want string) {
		t.Helper()
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest("GET", "/api/sessions/ses_activity/ui-testing", nil))
		var doc uitesting.Document
		if err := json.Unmarshal(response.Body.Bytes(), &doc); err != nil {
			t.Fatal(err)
		}
		if response.Code != 200 || len(doc.Tests) != 1 || doc.Tests[0].Status != want || doc.Runs[0].Status != want {
			t.Fatalf("expected %s for catalog and run, got response %d: %s", want, response.Code, response.Body.String())
		}
	}
	assertStatus("queued")
	claimed, err := sessions.ClaimChatAgentTask("worker-1", time.Minute)
	if err != nil || claimed == nil {
		t.Fatalf("claim: %v", err)
	}
	assertStatus("queued")
	if _, err := sessions.StartChatAgentTask(task.TaskID, "worker-1"); err != nil {
		t.Fatal(err)
	}
	assertStatus("running")
	if _, err := sessions.WaitChatAgentTask(task.TaskID, "worker-1", time.Now().Add(time.Hour), "upload cooldown", true); err != nil {
		t.Fatal(err)
	}
	assertStatus("waiting")
	if _, err := sessions.CancelChatAgentLineage(task.RootRequestID); err != nil {
		t.Fatal(err)
	}
	assertStatus("failed")
}
