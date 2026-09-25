package httpapi

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/websocket"
)

// Live streams (session events, interactive terminal frames) are served over
// WebSocket when the client asks to upgrade and as SSE otherwise (see
// adr/ADR-0076). A renderer holds these connections open indefinitely, and on
// plain HTTP/1.1 every one of them occupies one of the browser's six
// per-host sockets: a few windows and terminals were enough to leave ordinary
// requests - returned artifact previews among them - queued for minutes.
// WebSocket connections are not drawn from that pool.
const (
	liveStreamHeartbeat          = 20 * time.Second
	liveStreamWriteTimeout       = 15 * time.Second
	liveStreamClientMessageLimit = 4 << 10
)

type liveStream interface {
	send(value any) error
	heartbeat() error
	done() <-chan struct{}
}

// serveLiveStream negotiates the transport and hands the open stream to run.
// Anything that can fail with an HTTP status (an unknown terminal, say) must
// be resolved before calling it, because a WebSocket has no status to report.
func (a *API) serveLiveStream(w http.ResponseWriter, r *http.Request, run func(liveStream)) {
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		websocket.Server{Handshake: a.liveStreamHandshake, Handler: func(conn *websocket.Conn) {
			stream := newSocketStream(conn)
			defer conn.Close()
			run(stream)
		}}.ServeHTTP(middlewareHijacker{w}, r)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "stream_unsupported", "streaming unavailable")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	run(&sseStream{w: w, flusher: flusher, request: r})
}

// pumpLiveStream follows source until it closes, the client leaves, or a
// write fails.
func pumpLiveStream[T any](stream liveStream, source <-chan T) {
	ticker := time.NewTicker(liveStreamHeartbeat)
	defer ticker.Stop()
	for {
		select {
		case value, ok := <-source:
			if !ok || stream.send(value) != nil {
				return
			}
		case <-ticker.C:
			if stream.heartbeat() != nil {
				return
			}
		case <-stream.done():
			return
		}
	}
}

// liveStreamHandshake is the WebSocket counterpart of CORS: browsers do not
// apply CORS to WebSockets, so without it any page the operator visits could
// subscribe to session events. A browser always sends Origin; its absence
// means a non-browser client, which an origin check cannot constrain anyway.
func (a *API) liveStreamHandshake(_ *websocket.Config, r *http.Request) error {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return nil
	}
	for _, allowed := range allowedOrigins(a.cfg.FrontendOrigin) {
		if origin == allowed {
			return nil
		}
	}
	parsed, err := url.Parse(origin)
	if err == nil && parsed.Host != "" && (strings.EqualFold(parsed.Host, r.Host) || strings.EqualFold(parsed.Host, r.Header.Get("X-Forwarded-Host"))) {
		return nil
	}
	log.Printf("live-stream: refused websocket origin %q for %s", origin, r.URL.Path)
	return fmt.Errorf("websocket origin %q is not allowed", origin)
}

// middlewareHijacker lets the WebSocket server hijack through middleware that
// wraps the ResponseWriter (the request log's recorder, for one). The server
// type-asserts http.Hijacker directly; ResponseController instead follows
// the wrappers' Unwrap chain, the net/http convention.
type middlewareHijacker struct{ http.ResponseWriter }

func (h middlewareHijacker) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return http.NewResponseController(h.ResponseWriter).Hijack()
}

type sseStream struct {
	w       http.ResponseWriter
	flusher http.Flusher
	request *http.Request
}

func (s *sseStream) send(value any) error {
	writeSSE(s.w, value)
	s.flusher.Flush()
	return nil
}

func (s *sseStream) heartbeat() error {
	fmt.Fprint(s.w, ": heartbeat\n\n")
	s.flusher.Flush()
	return nil
}

func (s *sseStream) done() <-chan struct{} { return s.request.Context().Done() }

type socketStream struct {
	conn   *websocket.Conn
	closed chan struct{}
}

func newSocketStream(conn *websocket.Conn) *socketStream {
	conn.MaxPayloadBytes = liveStreamClientMessageLimit
	// Conn.Write is used only for heartbeats; data goes through Message.Send,
	// which carries its own frame type.
	conn.PayloadType = websocket.PingFrame
	stream := &socketStream{conn: conn, closed: make(chan struct{})}
	go stream.drain()
	return stream
}

// drain reads until the client closes: the client sends nothing, but reading
// is how a close frame or a dead peer is observed and how pings are answered.
func (s *socketStream) drain() {
	defer close(s.closed)
	for {
		var discard []byte
		if err := websocket.Message.Receive(s.conn, &discard); err != nil {
			return
		}
	}
}

// Every write carries its own deadline so a client that stops reading is
// dropped instead of blocking the stream's goroutine forever.
func (s *socketStream) send(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if err := s.conn.SetWriteDeadline(time.Now().Add(liveStreamWriteTimeout)); err != nil {
		return err
	}
	return websocket.Message.Send(s.conn, string(data))
}

func (s *socketStream) heartbeat() error {
	if err := s.conn.SetWriteDeadline(time.Now().Add(liveStreamWriteTimeout)); err != nil {
		return err
	}
	if _, err := s.conn.Write(nil); err != nil {
		return errors.Join(errors.New("websocket heartbeat failed"), err)
	}
	return nil
}

func (s *socketStream) done() <-chan struct{} { return s.closed }
