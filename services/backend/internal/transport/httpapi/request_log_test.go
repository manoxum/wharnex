package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"kernl.local/harness/backend/internal/oplog"
)

type capturedLog struct {
	mu      sync.Mutex
	records []oplog.Record
}

func (c *capturedLog) AppendOperationalLog(_ context.Context, records []oplog.Record) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.records = append(c.records, records...)
	return nil
}

func withCapturedLog(t *testing.T) (*capturedLog, *oplog.Writer) {
	t.Helper()
	store := &capturedLog{}
	writer := oplog.NewWriter(store, 0)
	oplog.SetDefault(writer)
	t.Cleanup(func() { oplog.SetDefault(nil) })
	return store, writer
}

func TestRequestLogRecordsRouteStatusCorrelationAndTrace(t *testing.T) {
	store, writer := withCapturedLog(t)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/sessions/{id}/artifacts", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	handler := requestLog(mux)

	request := httptest.NewRequest(http.MethodPost, "/api/sessions/ses_1/artifacts", nil)
	request.Header.Set(TraceHeader, "prepare:req_1:1")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	generated := httptest.NewRecorder()
	handler.ServeHTTP(generated, httptest.NewRequest(http.MethodPost, "/api/sessions/ses_2/artifacts", nil))
	writer.Close()

	if response.Header().Get(TraceHeader) != "prepare:req_1:1" || generated.Header().Get(TraceHeader) == "" {
		t.Fatal("the trace must be echoed, or generated when absent")
	}
	if len(store.records) != 2 {
		t.Fatalf("expected two individual mutation records, got %d", len(store.records))
	}
	record := store.records[0]
	if record.Data["route"] != "POST /api/sessions/{id}/artifacts" || record.Data["status"] != int(http.StatusCreated) ||
		record.SessionID != "ses_1" || record.TraceID != "prepare:req_1:1" || record.Data["bytes_out"] != int64(11) {
		t.Fatalf("call evidence incomplete: %#v", record)
	}
}

func TestRequestLogKeepsTheEventStreamFlushable(t *testing.T) {
	withCapturedLog(t)
	flushable := false
	handler := requestLog(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, flushable = w.(http.Flusher)
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/sessions/ses_1/events", nil))
	if !flushable {
		t.Fatal("the live event stream asserts http.Flusher on its writer")
	}
}

func TestRequestLogRejectsForgedTraceValues(t *testing.T) {
	withCapturedLog(t)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Header.Set(TraceHeader, "bad trace\nX-Injected: 1")
	requestLog(http.NotFoundHandler()).ServeHTTP(response, request)
	if got := response.Header().Get(TraceHeader); got == "" || got == request.Header.Get(TraceHeader) {
		t.Fatalf("a malformed trace must be replaced, got %q", got)
	}
}
