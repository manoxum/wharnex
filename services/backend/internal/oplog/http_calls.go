package oplog

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

// SlowHTTPCall is the duration from which any call is recorded individually.
const SlowHTTPCall = 2 * time.Second

// HTTPCall is one completed backend request.
type HTTPCall struct {
	Method, Pattern, Path                         string
	Status                                        int
	Duration                                      time.Duration
	BytesIn, BytesOut                             int64
	TraceID, SessionID, RequestID, TaskID, ChatID string
	Remote                                        bool
}

// pollingRoutes are high-frequency calls whose healthy outcomes are only
// aggregated. Measured on 2026-09-25: claims alone ran at ~12.5 per second.
var pollingRoutes = map[string]bool{
	"POST /api/chat-agent/tasks/claim":          true,
	"POST /api/chat-agent/tasks/{id}/heartbeat": true,
	"POST /api/sessions/{id}/git/fetch":         true,
	"POST /api/operational-log":                 true,
}

// transportRoutes carry a request's inputs and artifacts; every call is
// individually recorded because their timing is what a stalled request needs.
var transportRoutes = map[string]bool{
	"GET /api/sessions/{id}/bundle":                             true,
	"GET /api/sessions/{id}/context/maps":                       true,
	"GET /api/sessions/{id}/git/context":                        true,
	"GET /api/sessions/{id}/requests/{request_id}/knowledge":    true,
	"GET /api/sessions/{id}/requests/{request_id}/continuation": true,
	"GET /api/sessions/{id}/artifacts/{artifact_id}":            true,
}

var streamRoutes = map[string]bool{
	"GET /api/sessions/{id}/events":                                 true,
	"GET /api/sessions/{id}/terminal/sessions/{terminal_id}/events": true,
}

// HTTPDisposition decides whether a call is recorded on its own and at which
// level. Errors and slow calls are always individual.
func HTTPDisposition(call HTTPCall) (individual bool, level string) {
	route := strings.TrimSpace(call.Pattern)
	mutation := call.Method != "GET" && call.Method != "HEAD" && call.Method != "OPTIONS"
	switch {
	case call.Status >= 500:
		return true, LevelError
	case call.Status >= 400:
		return true, LevelWarning
	case streamRoutes[route]:
		return true, LevelDebug
	case call.Duration >= SlowHTTPCall:
		return true, LevelWarning
	case pollingRoutes[route]:
		return false, LevelDebug
	case transportRoutes[route]:
		return true, LevelInfo
	case mutation:
		return true, LevelSuccess
	default:
		return false, LevelDebug
	}
}

func (call HTTPCall) record(level string) Record {
	route := call.Pattern
	if route == "" {
		route = call.Method + " (unmatched)"
	}
	return Record{
		Event: "http.request", Component: "http", Category: "runtime", Level: level,
		Message:   fmt.Sprintf("%s %s → %d em %d ms", call.Method, call.Path, call.Status, call.Duration.Milliseconds()),
		SessionID: call.SessionID, RequestID: call.RequestID, TaskID: call.TaskID, ChatID: call.ChatID, TraceID: call.TraceID,
		Data: map[string]any{
			"method": call.Method, "route": route, "path": call.Path, "status": call.Status, "duration_ms": call.Duration.Milliseconds(),
			"bytes_in": call.BytesIn, "bytes_out": call.BytesOut, "remote": call.Remote,
		},
	}
}

type httpAggregate struct {
	count, errors            int64
	totalMs, maxMs, bytesOut int64
}

// httpAggregator folds non-individual calls into per-route minute counters.
type httpAggregator struct {
	mu     sync.Mutex
	routes map[string]*httpAggregate
	since  time.Time
}

func (a *httpAggregator) add(call HTTPCall) {
	route := call.Pattern
	if route == "" {
		route = call.Method + " (unmatched)"
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.routes == nil {
		a.routes, a.since = map[string]*httpAggregate{}, time.Now().UTC()
	}
	entry := a.routes[route]
	if entry == nil {
		entry = &httpAggregate{}
		a.routes[route] = entry
	}
	ms := call.Duration.Milliseconds()
	entry.count++
	entry.totalMs += ms
	entry.bytesOut += call.BytesOut
	if ms > entry.maxMs {
		entry.maxMs = ms
	}
	if call.Status >= 400 {
		entry.errors++
	}
}

// drain returns one debug record per route observed since the last drain.
func (a *httpAggregator) drain(now time.Time) []Record {
	a.mu.Lock()
	routes, since := a.routes, a.since
	a.routes = nil
	a.mu.Unlock()
	names := make([]string, 0, len(routes))
	for name := range routes {
		names = append(names, name)
	}
	sort.Strings(names)
	records := make([]Record, 0, len(names))
	for _, name := range names {
		entry := routes[name]
		records = append(records, Record{
			Event: "http.calls_aggregated", Component: "http", Category: "runtime", Level: LevelDebug, OccurredAt: now,
			Message: fmt.Sprintf("%s: %d chamadas", name, entry.count),
			Data: map[string]any{
				"route": name, "count": entry.count, "errors": entry.errors, "avg_ms": entry.totalMs / entry.count,
				"max_ms": entry.maxMs, "bytes_out": entry.bytesOut, "window_start": since.Format(time.RFC3339),
			},
		})
	}
	return records
}
