package taskclaim

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"kernl.local/harness/backend/internal/automationhold"
	"kernl.local/harness/backend/internal/session"
)

var catalog = automationhold.Catalog{TaskTypes: []string{"BOT_WRITE", "RENAME_CHAT", "UI_TEST_RUN"}}

type recordingClaimer struct{ options session.ChatAgentClaimOptions }

func (c *recordingClaimer) ClaimChatAgentTaskWithOptions(_ string, _ time.Duration, options session.ChatAgentClaimOptions) (*session.ChatAgentTask, error) {
	c.options = options
	return nil, nil
}

func claim(t *testing.T, claimer Claimer, holds automationhold.Store) *httptest.ResponseRecorder {
	t.Helper()
	mux := http.NewServeMux()
	Register(mux, claimer, holds, catalog)
	recorder := httptest.NewRecorder()
	body := `{"owner":"desktop:supervisor-1","role":"supervisor","excluded_types":["RENAME_CHAT"]}`
	mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/chat-agent/tasks/claim", strings.NewReader(body)))
	return recorder
}

func TestClaimExcludesEveryHeldTaskTypeWhateverThePool(t *testing.T) {
	holds := automationhold.NewMemory(catalog)
	for _, taskType := range []string{"UI_TEST_RUN", "BOT_WRITE"} {
		if _, err := holds.Set(context.Background(), automationhold.Hold{Name: automationhold.TaskHold(taskType), Active: true}); err != nil {
			t.Fatal(err)
		}
	}
	claimer := &recordingClaimer{}
	if recorder := claim(t, claimer, holds); recorder.Code != http.StatusOK {
		t.Fatalf("claim failed: %d %s", recorder.Code, recorder.Body)
	}
	got := strings.Join(claimer.options.ExcludedTypes, ",")
	if got != "RENAME_CHAT,BOT_WRITE,UI_TEST_RUN" {
		t.Fatalf("held types must join the caller's exclusions for a Supervisor too, got %s", got)
	}
}

func TestClaimKeepsCallerExclusionsWithoutHold(t *testing.T) {
	claimer := &recordingClaimer{}
	claim(t, claimer, automationhold.NewMemory(catalog))
	if got := strings.Join(claimer.options.ExcludedTypes, ","); got != "RENAME_CHAT" {
		t.Fatalf("no hold must add nothing, got %s", got)
	}
}

type failingHolds struct{}

func (failingHolds) Get(context.Context, string) (automationhold.Hold, error) {
	return automationhold.Hold{}, context.DeadlineExceeded
}
func (failingHolds) Set(context.Context, automationhold.Hold) (automationhold.Hold, error) {
	return automationhold.Hold{}, context.DeadlineExceeded
}
func (failingHolds) List(context.Context) ([]automationhold.Hold, error) {
	return nil, context.DeadlineExceeded
}

func TestClaimFailsClosedWhenHoldsCannotBeRead(t *testing.T) {
	claimer := &recordingClaimer{}
	if recorder := claim(t, claimer, failingHolds{}); recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("an unreadable hold must refuse the claim, got %d", recorder.Code)
	}
	if claimer.options.ExcludedTypes != nil {
		t.Fatal("nothing may be claimed while holds are unreadable")
	}
}
