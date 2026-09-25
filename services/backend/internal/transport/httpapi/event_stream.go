package httpapi

import "net/http"

// events replays a bounded catch-up and then follows the session's live
// events over the negotiated live-stream transport.
func (a *API) events(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")
	a.serveLiveStream(w, r, func(stream liveStream) {
		history := a.bus.History(sessionID)
		if len(history) > maxHistoryEvents {
			history = history[len(history)-maxHistoryEvents:]
		}
		for _, event := range history {
			if stream.send(event) != nil {
				return
			}
		}
		live, cancel := a.bus.Subscribe(sessionID)
		defer cancel()
		pumpLiveStream(stream, live)
	})
}
