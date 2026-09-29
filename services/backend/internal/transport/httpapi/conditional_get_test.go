package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func snapshotHandler(body string) http.Handler {
	return conditionalGET(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
}

func TestConditionalGETAnswersUnchangedSnapshotWithNotModified(t *testing.T) {
	handler := snapshotHandler(`{"files":[]}`)
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/api/sessions/ses_1/files", nil))
	tag := first.Header().Get("ETag")
	if first.Code != http.StatusOK || tag == "" || first.Body.String() != `{"files":[]}` {
		t.Fatalf("first poll must return the snapshot with a validator: %d %q %q", first.Code, tag, first.Body.String())
	}
	request := httptest.NewRequest(http.MethodGet, "/api/sessions/ses_1/files", nil)
	request.Header.Set("If-None-Match", tag)
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, request)
	if second.Code != http.StatusNotModified || second.Body.Len() != 0 {
		t.Fatalf("unchanged snapshot must be 304 without a body, got %d with %d bytes", second.Code, second.Body.Len())
	}
}

func TestConditionalGETSendsChangedSnapshot(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/chat-agent/tasks", nil)
	request.Header.Set("If-None-Match", `"stale"`)
	response := httptest.NewRecorder()
	snapshotHandler(`{"tasks":[1]}`).ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != `{"tasks":[1]}` {
		t.Fatalf("changed snapshot must be delivered, got %d %q", response.Code, response.Body.String())
	}
}

func TestConditionalGETLeavesOtherRoutesAndErrorsUntouched(t *testing.T) {
	response := httptest.NewRecorder()
	snapshotHandler(`{}`).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/sessions/ses_1/bundle", nil))
	if response.Header().Get("ETag") != "" {
		t.Fatal("routes outside the polled snapshot set must stream untouched")
	}
	failing := conditionalGET(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{}}`))
	}))
	response = httptest.NewRecorder()
	failing.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/sessions/missing", nil))
	if response.Code != http.StatusNotFound || response.Header().Get("ETag") != "" || response.Body.String() != `{"error":{}}` {
		t.Fatalf("errors must pass through without a validator, got %d %q", response.Code, response.Body.String())
	}
}
