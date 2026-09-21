package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/domain"
)

func TestEventHistoryReturnsBoundedDurableSnapshotShape(t *testing.T) {
	bus := audit.NewBus()
	for i := 0; i < 2003; i++ {
		bus.Publish("ses-logs", "command.output", map[string]any{"run_id": "run", "text": "line"})
	}
	api := &API{bus: bus}
	request := httptest.NewRequest(http.MethodGet, "/api/sessions/ses-logs/events/history", nil)
	request.SetPathValue("id", "ses-logs")
	response := httptest.NewRecorder()

	api.eventHistory(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var payload struct {
		Events    []domain.Event `json:"events"`
		Total     int            `json:"total"`
		Truncated bool           `json:"truncated"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Total != 2003 || !payload.Truncated || len(payload.Events) != 2000 {
		t.Fatalf("unexpected event snapshot: total=%d truncated=%t events=%d", payload.Total, payload.Truncated, len(payload.Events))
	}
}

func TestEventHistoryCanReturnCompleteDurableLedgerOnDemand(t *testing.T) {
	bus := audit.NewBus()
	for i := 0; i < 2003; i++ {
		bus.Publish("ses-full-logs", "command.output", map[string]any{"run_id": "run", "text": "line"})
	}
	api := &API{bus: bus}
	request := httptest.NewRequest(http.MethodGet, "/api/sessions/ses-full-logs/events/history?full=1", nil)
	request.SetPathValue("id", "ses-full-logs")
	response := httptest.NewRecorder()

	api.eventHistory(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	var payload struct {
		Events    []domain.Event `json:"events"`
		Total     int            `json:"total"`
		Truncated bool           `json:"truncated"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if payload.Total != 2003 || payload.Truncated || len(payload.Events) != 2003 {
		t.Fatalf("unexpected full event snapshot: total=%d truncated=%t events=%d", payload.Total, payload.Truncated, len(payload.Events))
	}
}
