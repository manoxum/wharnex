package httpapi

import "net/http"

// registerRemoteWorkspaceRoutes keeps the paired remote-control surface in one
// place instead of growing the already-large root router. The pairing middleware
// remains the authority that protects every remote API except its public claim
// handshake.
func (a *API) registerRemoteWorkspaceRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/tunnel/control", a.controlTunnel)
	mux.HandleFunc("POST /api/pairing/start", a.startPairing)
	mux.HandleFunc("POST /api/pairing/claim", a.claimPairing)
	mux.HandleFunc("GET /api/pairing/status", a.pairingStatus)
	mux.HandleFunc("DELETE /api/pairing/session", a.endPairingSession)
	mux.HandleFunc("POST /api/sessions/{id}/remote-dispatch", a.remoteDispatch)
}
