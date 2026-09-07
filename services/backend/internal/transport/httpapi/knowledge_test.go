package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
)

func TestProjectKnowledgeReturnsCurrentProjectDocument(t *testing.T) {
	store := session.NewStore()
	if err := store.Put(domain.Session{ID: "ses-knowledge", ProjectPath: "/workspace/demo"}); err != nil {
		t.Fatal(err)
	}
	saved, err := store.AppendProjectKnowledge("/workspace/demo", "# Conhecimento\n\n- API local.", "req-review")
	if err != nil {
		t.Fatal(err)
	}
	api := &API{store: store}
	request := httptest.NewRequest(http.MethodGet, "/api/sessions/ses-knowledge/knowledge", nil)
	request.SetPathValue("id", "ses-knowledge")
	response := httptest.NewRecorder()

	api.projectKnowledge(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var payload struct {
		Knowledge *domain.ProjectKnowledge `json:"knowledge"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Knowledge == nil || payload.Knowledge.Content != saved.Content || payload.Knowledge.Version != 1 {
		t.Fatalf("unexpected knowledge payload: %#v", payload.Knowledge)
	}
}

func TestProjectKnowledgeReturnsNullBeforeFirstReview(t *testing.T) {
	store := session.NewStore()
	if err := store.Put(domain.Session{ID: "ses-empty", ProjectPath: "/workspace/empty"}); err != nil {
		t.Fatal(err)
	}
	api := &API{store: store}
	request := httptest.NewRequest(http.MethodGet, "/api/sessions/ses-empty/knowledge", nil)
	request.SetPathValue("id", "ses-empty")
	response := httptest.NewRecorder()

	api.projectKnowledge(response, request)

	if response.Code != http.StatusOK || response.Body.String() != "{\"knowledge\":null}\n" {
		t.Fatalf("unexpected empty response: status=%d body=%q", response.Code, response.Body.String())
	}
}
