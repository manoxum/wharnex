package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"regexp"
	"strings"
	"sync"
)

// polledSnapshotRoutes are the read-only JSON snapshots the Desktop polls on
// a timer. Most polls find nothing changed, yet each one used to ship the whole
// document again — the project tree alone is megabytes every 4.5 seconds per
// open explorer — and every renderer re-parsed and re-rendered it. These
// routes answer a matching If-None-Match with 304 and no body instead.
var polledSnapshotRoutes = regexp.MustCompile(`^/api/(sessions/[^/]+(/files|/git/overview|/git/head|/orchestrator/overview)?|chat-agent/tasks(/summary)?|chat-agent/provider|workspace-attention)$`)

var snapshotBuffers = sync.Pool{New: func() any { return new(bytes.Buffer) }}

// maxPooledSnapshotBuffer keeps one oversized response from pinning its
// buffer in the pool for the rest of the process.
const maxPooledSnapshotBuffer = 4 << 20

func conditionalGET(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.Header.Get("Range") != "" || !polledSnapshotRoutes.MatchString(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		buffer := snapshotBuffers.Get().(*bytes.Buffer)
		buffer.Reset()
		defer func() {
			if buffer.Cap() <= maxPooledSnapshotBuffer {
				snapshotBuffers.Put(buffer)
			}
		}()
		recorder := &snapshotRecorder{header: make(http.Header), body: buffer, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		for key, values := range recorder.header {
			w.Header()[key] = values
		}
		if recorder.status != http.StatusOK {
			w.WriteHeader(recorder.status)
			_, _ = w.Write(buffer.Bytes())
			return
		}
		sum := sha256.Sum256(buffer.Bytes())
		tag := `"` + hex.EncodeToString(sum[:16]) + `"`
		w.Header().Set("ETag", tag)
		w.Header().Set("Cache-Control", "no-cache")
		if etagMatches(r.Header.Get("If-None-Match"), tag) {
			w.Header().Del("Content-Length")
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(buffer.Bytes())
	})
}

func etagMatches(header, tag string) bool {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimPrefix(strings.TrimSpace(candidate), "W/")
		if candidate == tag || candidate == "*" {
			return true
		}
	}
	return false
}

// snapshotRecorder buffers one snapshot response so its validator can be
// computed before anything reaches the client.
type snapshotRecorder struct {
	header      http.Header
	body        *bytes.Buffer
	status      int
	wroteHeader bool
}

func (s *snapshotRecorder) Header() http.Header { return s.header }

func (s *snapshotRecorder) WriteHeader(status int) {
	if !s.wroteHeader {
		s.status, s.wroteHeader = status, true
	}
}

func (s *snapshotRecorder) Write(data []byte) (int, error) {
	s.wroteHeader = true
	return s.body.Write(data)
}
