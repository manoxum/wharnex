package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
)

var desktopChatCacheKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func TestSyncUsesTaskIDAsDesktopSafeChatCacheKey(t *testing.T) {
	sessions := session.NewStore()
	routes, err := New(sessions, t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "context.zip")
	if err := os.WriteFile(archive, []byte("context"), 0o600); err != nil {
		t.Fatal(err)
	}
	contextSHA := strings.Repeat("a", 64)
	item := domain.Session{
		ID: "ses_ui", ProjectPath: t.TempDir(),
		Context: domain.ContextBundle{ZipPath: archive, Manifest: domain.ContextManifest{SHA256: contextSHA}},
	}
	if err := sessions.Put(item); err != nil {
		t.Fatal(err)
	}

	mux := http.NewServeMux()
	routes.Register(mux)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/sessions/ses_ui/ui-testing/sync", nil))
	if response.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	var doc uitesting.Document
	if err := json.NewDecoder(response.Body).Decode(&doc); err != nil {
		t.Fatal(err)
	}
	task, err := sessions.GetChatAgentTask(doc.SyncTaskID)
	if err != nil {
		t.Fatal(err)
	}
	assertDesktopSafeTaskChatID(t, task)
	var payload discoveryTaskPayload
	if err := json.Unmarshal(task.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Protocol != uitesting.DiscoveryRequestProtocolV2 || payload.Request.CatalogSHA256 == "" || payload.Request.ContextSHA256 != contextSHA || payload.Request.ResultFilename == "" || payload.ArchiveBase64 == "" {
		t.Fatalf("unexpected UI discovery transport payload: %#v", payload)
	}
}

func TestRunUsesTaskIDAsDesktopSafeChatCacheKey(t *testing.T) {
	sessions := session.NewStore()
	routes, err := New(sessions, t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	testCase := uitesting.TestCase{ID: "smoke", Title: "Smoke", Goal: "Open the page", EnvironmentID: "web"}
	doc := uitesting.Document{
		ContextSHA256: "ctx-sha",
		Environments:  []uitesting.Environment{{ID: "web", Name: "Web", URL: "https://example.test"}},
		Tests:         []uitesting.TestCase{testCase},
	}
	taskID, err := routes.enqueueRun(context.Background(), "ses_ui", t.TempDir(), testCase, doc, nil)
	if err != nil {
		t.Fatal(err)
	}
	task, err := sessions.GetChatAgentTask(taskID)
	if err != nil {
		t.Fatal(err)
	}
	assertDesktopSafeTaskChatID(t, task)
}

func assertDesktopSafeTaskChatID(t *testing.T, task session.ChatAgentTask) {
	t.Helper()
	if task.ChatID != task.TaskID {
		t.Fatalf("chat_id=%q task_id=%q", task.ChatID, task.TaskID)
	}
	if !desktopChatCacheKeyPattern.MatchString(task.ChatID) {
		t.Fatalf("chat_id %q is not accepted by Desktop cache-key validation", task.ChatID)
	}
}
