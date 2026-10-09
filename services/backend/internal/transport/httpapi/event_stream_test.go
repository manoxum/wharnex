package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"kernl.local/harness/backend/internal/audit"
)

// The SSE stream replays a catch-up before it starts following live events.
// That replay used to be unbounded while the REST history endpoint beside it
// was capped, so opening the stream on a long-lived session delivered its
// entire ledger as one burst - thousands of frames a renderer has to absorb
// before it can paint. Both catch-ups share one bound.
func TestEventStreamCatchUpIsBoundedLikeTheHistoryEndpoint(t *testing.T) {
	bus := audit.NewBus()
	for i := 0; i < maxHistoryEvents+137; i++ {
		bus.Publish("ses-stream", "command.output", map[string]any{"run_id": "run", "text": "line"})
	}
	api := &API{bus: bus}

	// A cancelled context lets the handler finish the catch-up and then leave
	// the follow loop immediately instead of blocking on live events.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest(http.MethodGet, "/api/sessions/ses-stream/events", nil).WithContext(ctx)
	request.SetPathValue("id", "ses-stream")
	response := httptest.NewRecorder()

	api.events(response, request)

	frames := strings.Count(response.Body.String(), "data:")
	if frames != maxHistoryEvents {
		t.Fatalf("catch-up frames = %d, want %d", frames, maxHistoryEvents)
	}
}

func TestEventStreamDoesNotReplayOldGitInvalidations(t *testing.T) {
	bus := audit.NewBus()
	bus.Publish("ses-stream", "git.changed", map[string]any{})
	bus.Publish("ses-stream", "plan.received", map[string]any{})
	api := &API{bus: bus}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest(http.MethodGet, "/api/sessions/ses-stream/events", nil).WithContext(ctx)
	request.SetPathValue("id", "ses-stream")
	response := httptest.NewRecorder()
	api.events(response, request)
	if got := response.Body.String(); strings.Contains(got, "git.changed") || !strings.Contains(got, "plan.received") {
		t.Fatalf("unexpected catch-up: %s", got)
	}
}
