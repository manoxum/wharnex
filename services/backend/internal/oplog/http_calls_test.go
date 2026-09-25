package oplog

import (
	"testing"
	"time"
)

func TestHTTPDispositionRecordsWhatDiagnosisNeedsAndAggregatesPolling(t *testing.T) {
	cases := []struct {
		name       string
		call       HTTPCall
		individual bool
		level      string
	}{
		{"server error", HTTPCall{Method: "GET", Pattern: "GET /api/health", Status: 503}, true, LevelError},
		{"client error", HTTPCall{Method: "POST", Pattern: "POST /api/chat-agent/tasks/claim", Status: 409}, true, LevelWarning},
		{"slow read", HTTPCall{Method: "GET", Pattern: "GET /api/sessions/{id}", Status: 200, Duration: 3 * time.Second}, true, LevelWarning},
		{"healthy claim", HTTPCall{Method: "POST", Pattern: "POST /api/chat-agent/tasks/claim", Status: 200}, false, LevelDebug},
		{"slow claim", HTTPCall{Method: "POST", Pattern: "POST /api/chat-agent/tasks/claim", Status: 200, Duration: 5 * time.Second}, true, LevelWarning},
		{"bundle input", HTTPCall{Method: "GET", Pattern: "GET /api/sessions/{id}/bundle", Status: 200}, true, LevelInfo},
		{"mutation", HTTPCall{Method: "POST", Pattern: "POST /api/sessions/{id}/artifacts", Status: 201}, true, LevelSuccess},
		{"stream", HTTPCall{Method: "GET", Pattern: "GET /api/sessions/{id}/events", Status: 200, Duration: time.Hour}, true, LevelDebug},
		{"fast read", HTTPCall{Method: "GET", Pattern: "GET /api/sessions/{id}/git/head", Status: 200}, false, LevelDebug},
	}
	for _, tc := range cases {
		individual, level := HTTPDisposition(tc.call)
		if individual != tc.individual || level != tc.level {
			t.Errorf("%s: got individual=%v level=%s, want %v %s", tc.name, individual, level, tc.individual, tc.level)
		}
	}
}

func TestAggregatedCallsBecomeOneRecordPerRoute(t *testing.T) {
	store := &memoryStore{}
	writer := NewWriter(store, 0)
	for i := 0; i < 3; i++ {
		writer.ObserveHTTP(HTTPCall{Method: "POST", Pattern: "POST /api/chat-agent/tasks/claim", Status: 200, Duration: time.Duration(10*(i+1)) * time.Millisecond, BytesOut: 5})
	}
	writer.ObserveHTTP(HTTPCall{Method: "GET", Pattern: "GET /api/sessions/{id}/git/head", Status: 200})
	writer.ObserveHTTP(HTTPCall{Method: "POST", Pattern: "POST /api/sessions/{id}/artifacts", Status: 201, SessionID: "ses_1", TraceID: "task:cat_1:1"})
	writer.Close()
	records := store.all()
	if len(records) != 3 {
		t.Fatalf("expected one individual and two aggregate records, got %d: %#v", len(records), records)
	}
	individual := records[0]
	if individual.Event != "http.request" || individual.SessionID != "ses_1" || individual.TraceID != "task:cat_1:1" || individual.Level != LevelSuccess {
		t.Fatalf("individual call lost its correlation: %#v", individual)
	}
	claims := records[2]
	if claims.Event != "http.calls_aggregated" || claims.Data["count"] != int64(3) || claims.Data["max_ms"] != int64(30) || claims.Data["avg_ms"] != int64(20) {
		t.Fatalf("claim aggregate is wrong: %#v", claims.Data)
	}
}
