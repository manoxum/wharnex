package sandbox

import (
	"strings"
	"sync"
)

type StreamCallback func(stream, text string)

type streamCapture struct {
	mu       sync.Mutex
	stream   string
	buffer   strings.Builder
	callback StreamCallback
}

func newStreamCapture(stream string, callback StreamCallback) *streamCapture {
	return &streamCapture{stream: stream, callback: callback}
}

func (w *streamCapture) Write(p []byte) (int, error) {
	w.mu.Lock()
	_, _ = w.buffer.Write(p)
	callback := w.callback
	stream := w.stream
	text := string(append([]byte(nil), p...))
	w.mu.Unlock()
	if callback != nil && text != "" {
		callback(stream, text)
	}
	return len(p), nil
}

func (w *streamCapture) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buffer.String()
}
