package tunneldaemon

import (
	"net/http"

	"kernl.local/harness/backend/internal/app"
)

// reloadConfig adopts the tunnel configuration the backend has just saved.
//
// The daemon, not the backend, owns provider process lifetime, so the backend
// asks for this instead of restarting anything itself. The daemon re-reads the
// shared configuration document from its own read-only mount, which keeps the
// backend from ever handing provider definitions across the boundary.
func (s *Server) reloadConfig(w http.ResponseWriter, r *http.Request) {
	if err := s.manager.ReloadRemoteInput(r.Context()); err != nil {
		respond(w, app.RemoteInputStatus{}, err)
		return
	}
	// Read the status only after the reload, so the caller is answered with the
	// pool it just asked for rather than the one being replaced.
	respond(w, s.manager.Status(), nil)
}
