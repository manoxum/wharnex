package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInteractiveHostTerminalRequiresDedicatedConfirmation(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/sessions/session-1/terminal/sessions?target=host", strings.NewReader(`{"cwd":".","cols":80,"rows":24}`))
	request.SetPathValue("id", "session-1")
	response := httptest.NewRecorder()
	(&API{}).openInteractiveTerminal(response, request)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "host_terminal_confirmation_required") {
		t.Fatalf("Host PTY opened without dedicated confirmation: status=%d body=%s", response.Code, response.Body.String())
	}
}
