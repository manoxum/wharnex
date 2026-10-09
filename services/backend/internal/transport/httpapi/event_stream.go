package httpapi

import (
	"net/http"
	"time"

	"kernl.local/harness/backend/internal/domain"
)

// events replays a bounded catch-up and then follows the session's live
// events over the negotiated live-stream transport.
func (a *API) events(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")
	a.serveLiveStream(w, r, func(stream liveStream) {
		// Subscribe before reading history: a publisher cannot fall into the
		// gap between replay and live follow. IDs suppress any overlap.
		live, cancel := a.bus.Subscribe(sessionID)
		defer cancel()
		history := a.bus.History(sessionID)
		if len(history) > maxHistoryEvents {
			history = history[len(history)-maxHistoryEvents:]
		}
		seen := make(map[string]struct{}, len(history))
		for _, event := range history {
			seen[event.ID] = struct{}{}
			// A reconnect reloads authoritative Git state once. Replaying every
			// historical cache invalidation would generate a request burst.
			if event.Type == "git.changed" {
				continue
			}
			if stream.send(event) != nil {
				return
			}
		}
		if a.gitHub != nil && a.store != nil {
			if item, err := a.store.Get(sessionID); err == nil {
				release := a.gitHub.Acquire(item.ProjectPath, sessionID)
				defer release()
			}
		}
		pumpSessionEvents(stream, live, seen)
	})
}

func pumpSessionEvents(stream liveStream, live <-chan domain.Event, seen map[string]struct{}) {
	ticker := time.NewTicker(liveStreamHeartbeat)
	defer ticker.Stop()
	for {
		select {
		case event, ok := <-live:
			if !ok {
				return
			}
			if _, replayed := seen[event.ID]; replayed {
				continue
			}
			if stream.send(event) != nil {
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
