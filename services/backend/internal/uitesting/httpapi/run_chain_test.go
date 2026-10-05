package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/sessionvault"
)

func chainFixture(t *testing.T) (*Routes, *http.ServeMux, string) {
	t.Helper()
	sessions := session.NewStore()
	routes, err := New(sessions, t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	project := t.TempDir()
	if err := sessions.Put(domain.Session{ID: "ses_chain", ProjectPath: project}); err != nil {
		t.Fatal(err)
	}
	_, err = routes.store.SaveDiscovery(project, uitesting.Discovery{Origin: uitesting.DiscoveryOriginSync, ContextSHA256: "ctx",
		Environments: []uitesting.Environment{{ID: "web", Name: "Web", Profiles: []uitesting.Profile{{ID: "admin", Label: "Admin", Role: "admin"}}}},
		Tests: []uitesting.TestCase{
			{ID: "login", Title: "Login", Goal: "Sign in", EnvironmentID: "web", Access: uitesting.AccessAuthenticated, ProfileID: "admin"},
			{ID: "create-item", Title: "Criar", Goal: "Create", EnvironmentID: "web", Access: uitesting.AccessAuthenticated, DependsOn: []string{"login"}},
		}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := routes.store.Configure(project, "web", "admin", "https://app.test", "alice", "secret"); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	routes.Register(mux)
	return routes, mux, project
}

func call(t *testing.T, mux *http.ServeMux, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(body)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(method, path, bytes.NewReader(raw)))
	return response
}

func runOnly(t *testing.T, routes *Routes, mux *http.ServeMux, testID string) runPayload {
	t.Helper()
	response := call(t, mux, http.MethodPost, "/api/sessions/ses_chain/ui-testing/run", runInput{TestIDs: []string{testID}})
	if response.Code != http.StatusAccepted {
		t.Fatalf("run status=%d body=%s", response.Code, response.Body.String())
	}
	var queued struct{ Queued []string }
	_ = json.NewDecoder(response.Body).Decode(&queued)
	task, err := routes.sessions.GetChatAgentTask(queued.Queued[0])
	if err != nil {
		t.Fatal(err)
	}
	var payload runPayload
	if err := json.Unmarshal(task.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	// The run is finished; a later identical selection must queue a new task.
	if _, err := routes.sessions.CancelChatAgentLineage(task.RootRequestID); err != nil {
		t.Fatal(err)
	}
	return payload
}

func TestDependentRunExecutesPrerequisiteThenResumesFromItsSession(t *testing.T) {
	routes, mux, project := chainFixture(t)
	first := runOnly(t, routes, mux, "create-item")
	if first.Restore != nil || len(first.Chain) != 2 || first.Chain[0].Test.ID != "login" || first.Chain[1].RunID != first.RunID || first.Profile.ID != "admin" {
		t.Fatalf("first run must execute login then create-item: %#v", first)
	}
	taskPath := "/api/ui-testing/tasks/cat_" + strings.TrimPrefix(first.RunID, "run_")
	state := json.RawMessage(`{"url":"https://app.test/dashboard","cookies":[{"name":"sid","value":"token","domain":"app.test"}],"local_storage":{},"session_storage":{}}`)
	if response := call(t, mux, http.MethodPost, taskPath+"/session", sessionInput{RunID: first.Chain[0].RunID, State: state}); response.Code != http.StatusConflict {
		t.Fatalf("a session saved before its run passed: %d", response.Code)
	}
	if response := call(t, mux, http.MethodPost, taskPath+"/result", map[string]any{"run_id": first.Chain[0].RunID, "result": uitesting.RunResult{Status: "passed"}}); response.Code != 200 {
		t.Fatalf("result status=%d body=%s", response.Code, response.Body.String())
	}
	if response := call(t, mux, http.MethodPost, taskPath+"/session", sessionInput{RunID: first.Chain[0].RunID, State: state}); response.Code != 200 {
		t.Fatalf("save status=%d body=%s", response.Code, response.Body.String())
	}

	second := runOnly(t, routes, mux, "create-item")
	if second.Restore == nil || second.Restore.TestID != "login" || len(second.Chain) != 1 || len(second.FullChain) != 2 {
		t.Fatalf("second run must resume from the login session: %#v", second)
	}
	restorePath := "/api/ui-testing/tasks/cat_" + strings.TrimPrefix(second.RunID, "run_") + "/session/restore"
	response := call(t, mux, http.MethodPost, restorePath, sessionInput{RunID: second.RunID})
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"token"`) || response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("restore status=%d body=%s", response.Code, response.Body.String())
	}

	doc := call(t, mux, http.MethodGet, "/api/sessions/ses_chain/ui-testing", nil).Body.String()
	if strings.Contains(doc, "token") || !strings.Contains(doc, `"test_id":"login"`) {
		t.Fatalf("document must summarize sessions without their state: %s", doc)
	}

	// Changing the login definition invalidates every session that covers it.
	if _, err := routes.store.SaveDiscovery(project, uitesting.Discovery{Origin: uitesting.DiscoveryOriginSync, Tests: []uitesting.TestCase{
		{ID: "login", Title: "Login", Goal: "Sign in with SSO", EnvironmentID: "web", Access: uitesting.AccessAuthenticated, ProfileID: "admin"},
	}}); err != nil {
		t.Fatal(err)
	}
	if response := call(t, mux, http.MethodPost, restorePath, sessionInput{RunID: second.RunID}); response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "session_invalid") {
		t.Fatalf("stale session restored: %d %s", response.Code, response.Body.String())
	}
	if third := runOnly(t, routes, mux, "create-item"); third.Restore != nil {
		t.Fatal("a session covering a changed definition was planned for reuse")
	}
}

func TestSelectingAPrerequisiteRunsItInsideItsDependent(t *testing.T) {
	routes, _, project := chainFixture(t)
	doc, _ := routes.store.Load(project)
	queued, err := routes.enqueueSelection(context.Background(), "ses_chain", project, doc, []string{"login", "create-item"}, true)
	if err != nil || len(queued) != 1 {
		t.Fatalf("queued=%v err=%v", queued, err)
	}
	task, _ := routes.sessions.GetChatAgentTask(queued[0])
	var payload runPayload
	_ = json.Unmarshal(task.Payload, &payload)
	if payload.Test.ID != "create-item" || len(payload.Chain) != 2 || payload.Restore != nil {
		t.Fatalf("explicitly selected prerequisite must run in its dependent's chain: %#v", payload)
	}
}

func TestChangingTheEnvironmentURLDropsItsSessions(t *testing.T) {
	routes, mux, project := chainFixture(t)
	now := time.Now().UTC()
	if _, err := routes.vault.Save(context.Background(), sessionvault.Snapshot{Project: project, EnvironmentID: "web", TestID: "login",
		Origin: "https://app.test", Sealed: "x", CapturedAt: now, ExpiresAt: now.Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if response := call(t, mux, http.MethodPut, "/api/sessions/ses_chain/ui-testing/config", configInput{EnvironmentID: "web", URL: "https://other.test"}); response.Code != 200 {
		t.Fatalf("configure status=%d", response.Code)
	}
	if left, _ := routes.vault.List(context.Background(), project, now); len(left) != 0 {
		t.Fatalf("sessions for the old URL survived: %d", len(left))
	}
}
