package synclifecycle_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/httpapi"
)

func TestCatalogReportsDurableDiscoveryActivity(t *testing.T) {
	for _, state := range []string{"queued", "running", "waiting", "failed"} {
		t.Run(state, func(t *testing.T) {
			root, project := t.TempDir(), t.TempDir()
			sessions := session.NewStore()
			if err := sessions.Put(domain.Session{ID: "ses_sync", ProjectPath: project}); err != nil {
				t.Fatal(err)
			}
			routes, err := httpapi.New(sessions, root, "")
			if err != nil {
				t.Fatal(err)
			}
			store, err := uitesting.NewStore(filepath.Join(root, "ui-testing"))
			if err != nil {
				t.Fatal(err)
			}
			task, err := sessions.EnqueueChatAgentTask(session.ChatAgentTask{
				Type: "UI_TEST_DISCOVER", ProjectID: project, ChatID: "discovery",
				Payload: json.RawMessage(`{"archive_base64":"private-context-marker"}`),
			})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := store.SetSyncing(project, task.TaskID); err != nil {
				t.Fatal(err)
			}
			owner := "desktop-test:worker-5"
			if state != "queued" {
				if _, err := sessions.ClaimChatAgentTask(owner, time.Minute); err != nil {
					t.Fatal(err)
				}
				if _, err := sessions.StartChatAgentTask(task.TaskID, owner); err != nil {
					t.Fatal(err)
				}
			}
			if state == "waiting" {
				_, err = sessions.WaitChatAgentTask(task.TaskID, owner, time.Now().Add(time.Minute), "provider cooldown", true)
			} else if state == "failed" {
				_, err = sessions.FailChatAgentTask(task.TaskID, owner, "discovery timed out", true)
			}
			if err != nil {
				t.Fatal(err)
			}
			mux := http.NewServeMux()
			routes.Register(mux)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/sessions/ses_sync/ui-testing", nil))
			if response.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			var view struct {
				SyncStatus string `json:"sync_status"`
				SyncError  string `json:"sync_error"`
				Activity   *struct {
					State     string     `json:"state"`
					Worker    int        `json:"worker"`
					Reason    string     `json:"reason"`
					NotBefore *time.Time `json:"not_before"`
				} `json:"sync_activity"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &view); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(response.Body.String(), "private-context-marker") {
				t.Fatal("activity response exposed the task payload")
			}
			if state == "failed" {
				if view.SyncStatus != "failed" || view.SyncError != "discovery timed out" || view.Activity != nil {
					t.Fatalf("terminal view=%+v", view)
				}
				return
			}
			if view.SyncStatus != "syncing" || view.Activity == nil || view.Activity.State != state {
				t.Fatalf("discovery must report %s instead of an undifferentiated syncing state: %s", state, response.Body.String())
			}
			if state == "running" && view.Activity.Worker != 5 {
				t.Fatalf("running activity=%+v", view.Activity)
			}
			if state == "waiting" && (view.Activity.Reason != "provider cooldown" || view.Activity.NotBefore == nil) {
				t.Fatalf("waiting activity=%+v", view.Activity)
			}
		})
	}
}
