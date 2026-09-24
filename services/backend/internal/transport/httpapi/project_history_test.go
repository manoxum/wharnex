package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/contextbundle"
	"kernl.local/harness/backend/internal/planner/manual"
	"kernl.local/harness/backend/internal/policy"
	"kernl.local/harness/backend/internal/sandbox"
	"kernl.local/harness/backend/internal/session"
)

func projectHistoryAPI() *API {
	service := app.NewService(
		session.NewStore(), audit.NewBus(), contextbundle.NewBuilder(1<<20, 1<<20),
		manual.New(), policy.NewEngine(), sandbox.NewLocalRunner(),
	)
	return &API{service: service}
}

func TestProjectHistoryRecordsDesktopOpenWithoutSession(t *testing.T) {
	api := projectHistoryAPI()
	post := httptest.NewRequest(http.MethodPost, "/api/projects/history", strings.NewReader(`{"project_path":"/work/remember-me"}`))
	postResponse := httptest.NewRecorder()
	api.rememberProjectOpened(postResponse, post)
	if postResponse.Code != http.StatusNoContent {
		t.Fatalf("post status = %d body=%s", postResponse.Code, postResponse.Body.String())
	}

	getResponse := httptest.NewRecorder()
	api.projectHistory(getResponse, httptest.NewRequest(http.MethodGet, "/api/projects/history", nil))
	if getResponse.Code != http.StatusOK {
		t.Fatalf("get status = %d body=%s", getResponse.Code, getResponse.Body.String())
	}
	var body struct {
		Projects []struct {
			ProjectPath string `json:"project_path"`
		} `json:"projects"`
	}
	if err := json.Unmarshal(getResponse.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Projects) != 1 || body.Projects[0].ProjectPath != "/work/remember-me" {
		t.Fatalf("unexpected history response: %#v", body.Projects)
	}
}

func TestProjectHistoryRejectsRelativePaths(t *testing.T) {
	api := projectHistoryAPI()
	request := httptest.NewRequest(http.MethodPost, "/api/projects/history", strings.NewReader(`{"project_path":"relative/project"}`))
	response := httptest.NewRecorder()
	api.rememberProjectOpened(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
}
