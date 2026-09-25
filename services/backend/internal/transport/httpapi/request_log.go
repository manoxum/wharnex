package httpapi

import (
	"net/http"
	"regexp"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/ids"
	"kernl.local/harness/backend/internal/oplog"
)

// TraceHeader carries one operation's correlation id between the Desktop and
// the backend; the backend echoes it and generates one when it is absent.
const TraceHeader = "X-Wharnex-Trace"

var traceID = regexp.MustCompile(`^[A-Za-z0-9:_.-]{1,120}$`)

// requestLog records every completed call in the operational log through
// oplog.HTTPDisposition (adr/ADR-0075). It wraps the mux directly, so the
// matched route pattern and path values are available once the handler ran.
func requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		trace := r.Header.Get(TraceHeader)
		if !traceID.MatchString(trace) {
			trace = ids.New("trc")
		}
		w.Header().Set(TraceHeader, trace)
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		started := time.Now()
		next.ServeHTTP(recorder, r)
		call := oplog.HTTPCall{
			Method: r.Method, Pattern: r.Pattern, Path: r.URL.Path, Status: recorder.status, Duration: time.Since(started),
			BytesIn: max(r.ContentLength, 0), BytesOut: recorder.bytes, TraceID: trace, Remote: r.Header.Get("X-Wharnex-Remote") == "1",
			RequestID: r.PathValue("request_id"),
		}
		correlateRoute(&call, r)
		oplog.Default().ObserveHTTP(call)
	})
}

// correlateRoute maps the route's {id} to the entity it names.
func correlateRoute(call *oplog.HTTPCall, r *http.Request) {
	id := r.PathValue("id")
	route := call.Pattern
	switch {
	case id == "":
	case strings.Contains(route, " /api/sessions/{id}"):
		call.SessionID = id
	case strings.Contains(route, " /api/chat-agent/tasks/{id}"):
		call.TaskID = id
	case strings.Contains(route, " /api/workspace-chats/{id}"):
		call.ChatID = id
	}
	if call.RequestID == "" {
		call.RequestID = r.URL.Query().Get("request_id")
	}
}

// statusRecorder captures status and size while staying a Flusher, which the
// live event stream asserts on its ResponseWriter.
type statusRecorder struct {
	http.ResponseWriter
	status      int
	bytes       int64
	wroteHeader bool
}

func (s *statusRecorder) WriteHeader(status int) {
	if !s.wroteHeader {
		s.status, s.wroteHeader = status, true
	}
	s.ResponseWriter.WriteHeader(status)
}

func (s *statusRecorder) Write(p []byte) (int, error) {
	s.wroteHeader = true
	n, err := s.ResponseWriter.Write(p)
	s.bytes += int64(n)
	return n, err
}

func (s *statusRecorder) Flush() {
	if flusher, ok := s.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }
