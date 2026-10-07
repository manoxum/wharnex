package automationholds

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/automationhold"
	"kernl.local/harness/backend/internal/session"
)

type fakeProvider struct {
	state session.ChatAgentProviderState
}

func (f fakeProvider) ChatAgentProviderState() (session.ChatAgentProviderState, error) {
	return f.state, nil
}

func serve(mux *http.ServeMux, method, path, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, httptest.NewRequest(method, path, strings.NewReader(body)))
	return recorder
}

func policies(t *testing.T, mux *http.ServeMux) map[string]automationhold.TaskPolicy {
	t.Helper()
	var body struct {
		TaskPolicies []automationhold.TaskPolicy `json:"task_policies"`
	}
	if err := json.Unmarshal(serve(mux, http.MethodGet, "/api/automation-holds", "").Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	byType := map[string]automationhold.TaskPolicy{}
	for _, policy := range body.TaskPolicies {
		byType[policy.Type] = policy
	}
	return byType
}

func TestEveryQueueTaskTypeIsListedWithItsEffectiveState(t *testing.T) {
	until := time.Now().UTC().Add(5 * time.Minute)
	catalog := Catalog()
	mux := http.NewServeMux()
	Register(mux, automationhold.NewMemory(catalog), catalog, fakeProvider{state: session.ChatAgentProviderState{Paused: true, PausedUntil: &until, Reason: "rate limit"}})
	byType := policies(t, mux)
	for _, kind := range session.ChatAgentTaskCatalog() {
		if _, ok := byType[kind.Type]; !ok {
			t.Fatalf("browser task type %s escaped policy control", kind.Type)
		}
	}
	if byType["RENAME_CHAT"].State != automationhold.StateSuspended || !byType["RENAME_CHAT"].Hold.Default {
		t.Fatalf("account maintenance starts suspended by default: %+v", byType["RENAME_CHAT"])
	}
	if byType["TODO_CLASSIFY"].State != automationhold.StateCooldown {
		t.Fatalf("a Worker type is in the rate-limit cooldown: %+v", byType["TODO_CLASSIFY"])
	}
	if byType["BOT_WRITE"].State != automationhold.StateActive {
		t.Fatalf("the rate-limit cooldown never reaches a Supervisor type: %+v", byType["BOT_WRITE"])
	}
	if got := serve(mux, http.MethodPut, "/api/automation-holds/task:BOT_WRITE", `{"active":true,"reason":"operator","source":"policies"}`); got.Code != http.StatusOK {
		t.Fatalf("suspend BOT_WRITE: %d %s", got.Code, got.Body)
	}
	if got := serve(mux, http.MethodPut, "/api/automation-holds/task:RENAME_CHAT", `{"active":false}`); got.Code != http.StatusOK {
		t.Fatalf("resume RENAME_CHAT: %d %s", got.Code, got.Body)
	}
	byType = policies(t, mux)
	if byType["BOT_WRITE"].State != automationhold.StateSuspended || byType["RENAME_CHAT"].State != automationhold.StateCooldown {
		t.Fatalf("operator decisions must show: BOT_WRITE=%+v RENAME_CHAT=%+v", byType["BOT_WRITE"], byType["RENAME_CHAT"])
	}
}

func TestHoldRoutesRefuseUnknownAndInvalid(t *testing.T) {
	catalog := Catalog()
	mux := http.NewServeMux()
	Register(mux, automationhold.NewMemory(catalog), catalog, fakeProvider{})
	if got := serve(mux, http.MethodPut, "/api/automation-holds/task:NOT_A_TYPE", `{"active":true}`); got.Code != http.StatusNotFound {
		t.Fatalf("unknown hold must be 404, got %d", got.Code)
	}
	past := `{"active":true,"until":"2000-01-01T00:00:00Z"}`
	if got := serve(mux, http.MethodPut, "/api/automation-holds/chatgpt_upload", past); got.Code != http.StatusBadRequest {
		t.Fatalf("expired deadline must be 400, got %d", got.Code)
	}
	if got := serve(mux, http.MethodPut, "/api/automation-holds/task:BOT_WRITE", `{"active":false,"surprise":1}`); got.Code != http.StatusBadRequest {
		t.Fatalf("unknown fields must be refused, got %d", got.Code)
	}
}
