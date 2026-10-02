package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
)

var desktopChatCacheKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

func TestSyncUsesTaskIDAsDesktopSafeChatCacheKey(t *testing.T) {
	sessions := session.NewStore()
	routes, err := New(sessions, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "context.zip")
	if err := os.WriteFile(archive, []byte("context"), 0o600); err != nil {
		t.Fatal(err)
	}
	item := domain.Session{
		ID: "ses_ui", ProjectPath: t.TempDir(),
		Context: domain.ContextBundle{ZipPath: archive, Manifest: domain.ContextManifest{SHA256: "ctx-sha"}},
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
}

func TestRunUsesTaskIDAsDesktopSafeChatCacheKey(t *testing.T) {
	sessions := session.NewStore()
	routes, err := New(sessions, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	doc := uitesting.Document{
		ContextSHA256: "ctx-sha",
		Environments:  []uitesting.Environment{{ID: "web", Name: "Web", URL: "https://example.test"}},
	}
	testCase := uitesting.TestCase{ID: "smoke", Title: "Smoke", Goal: "Open the page", EnvironmentID: "web"}
	taskID, err := routes.enqueueRun("ses_ui", t.TempDir(), testCase, doc)
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
