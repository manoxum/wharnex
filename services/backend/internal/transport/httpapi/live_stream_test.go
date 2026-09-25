package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/websocket"

	"kernl.local/harness/backend/internal/audit"
	"kernl.local/harness/backend/internal/config"
)

// middlewareWriter mimics middleware that wraps the ResponseWriter the way the
// request log does: it stays a Flusher and exposes Unwrap, but is not itself
// an http.Hijacker.
type middlewareWriter struct{ http.ResponseWriter }

func (w middlewareWriter) Flush()                      { w.ResponseWriter.(http.Flusher).Flush() }
func (w middlewareWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func liveStreamServer(t *testing.T, bus *audit.Bus, serverTimeout time.Duration) *httptest.Server {
	t.Helper()
	api := &API{bus: bus, cfg: config.Config{FrontendOrigin: "http://127.0.0.1:6969"}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/sessions/{id}/events", api.events)
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mux.ServeHTTP(middlewareWriter{w}, r)
	}))
	server.Config.ReadTimeout = serverTimeout
	server.Config.WriteTimeout = serverTimeout
	server.Start()
	t.Cleanup(server.Close)
	return server
}

func dialLiveStream(server *httptest.Server, origin string) (*websocket.Conn, error) {
	endpoint := "ws" + strings.TrimPrefix(server.URL, "http") + "/api/sessions/ses-live/events"
	return websocket.Dial(endpoint, "", origin)
}

func receiveEventType(t *testing.T, conn *websocket.Conn) string {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	var raw string
	if err := websocket.Message.Receive(conn, &raw); err != nil {
		t.Fatalf("receive: %v", err)
	}
	var event struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal([]byte(raw), &event); err != nil {
		t.Fatalf("message is not an event: %q", raw)
	}
	return event.Type
}

// The WebSocket transport carries exactly what SSE carried: the bounded
// catch-up first, then live events, one JSON event per message.
func TestSessionEventsStreamOverWebSocket(t *testing.T) {
	bus := audit.NewBus()
	bus.Publish("ses-live", "context.refreshed", map[string]any{})
	bus.Publish("ses-live", "planner.started", map[string]any{})
	conn, err := dialLiveStream(liveStreamServer(t, bus, 0), "http://127.0.0.1:6969")
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	if first, second := receiveEventType(t, conn), receiveEventType(t, conn); first != "context.refreshed" || second != "planner.started" {
		t.Fatalf("catch-up = %s, %s", first, second)
	}
	bus.Publish("ses-live", "artifact.persisted", map[string]any{})
	if live := receiveEventType(t, conn); live != "artifact.persisted" {
		t.Fatalf("live event = %s", live)
	}
}

// Browsers do not apply CORS to WebSockets, so the handshake is the only
// thing stopping an unrelated page from reading session events.
func TestLiveStreamRefusesForeignOrigins(t *testing.T) {
	server := liveStreamServer(t, audit.NewBus(), 0)
	if conn, err := dialLiveStream(server, "https://attacker.example"); err == nil {
		conn.Close()
		t.Fatal("a foreign origin opened the session event stream")
	}
	sameOrigin, err := dialLiveStream(server, server.URL)
	if err != nil {
		t.Fatalf("same-origin page refused: %v", err)
	}
	sameOrigin.Close()
}

// The http.Server's write timeout (30 minutes in production) periodically
// cut the SSE streams. A WebSocket stream must outlive it.
func TestLiveStreamOutlivesServerTimeouts(t *testing.T) {
	bus := audit.NewBus()
	conn, err := dialLiveStream(liveStreamServer(t, bus, 150*time.Millisecond), "http://127.0.0.1:6969")
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	time.Sleep(400 * time.Millisecond)
	bus.Publish("ses-live", "turn.received", map[string]any{})
	if live := receiveEventType(t, conn); live != "turn.received" {
		t.Fatalf("live event = %s", live)
	}
}

// Clients that do not ask to upgrade keep receiving SSE.
func TestLiveStreamFallsBackToServerSentEvents(t *testing.T) {
	bus := audit.NewBus()
	bus.Publish("ses-live", "context.refreshed", map[string]any{})
	server := liveStreamServer(t, bus, 0)
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get(server.URL + "/api/sessions/ses-live/events")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer response.Body.Close()
	if contentType := response.Header.Get("Content-Type"); contentType != "text/event-stream" {
		t.Fatalf("content type = %q", contentType)
	}
	buffer := make([]byte, 512)
	n, _ := response.Body.Read(buffer)
	if !strings.HasPrefix(string(buffer[:n]), "data: ") || !strings.Contains(string(buffer[:n]), "context.refreshed") {
		t.Fatalf("SSE catch-up = %q", buffer[:n])
	}
}
