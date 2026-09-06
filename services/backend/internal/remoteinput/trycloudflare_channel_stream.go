package remoteinput

import (
	"io"
	"net/http"
	"time"
)

func (p *TryCloudflareProvider) removeChannelSubscriber(channelID string, subscriber chan []byte) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if active := p.channels[channelID]; active != nil {
		delete(active.subscribers, subscriber)
	}
}

func (p *TryCloudflareProvider) streamChannelEvents(w http.ResponseWriter, r *http.Request, flusher http.Flusher, subscriber <-chan []byte) {
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case raw, open := <-subscriber:
			if !open {
				return
			}
			if _, err := w.Write(raw); err != nil {
				return
			}
			flusher.Flush()
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			if _, err := io.WriteString(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
