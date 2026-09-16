package httpapi

import (
	"net/http"

	"kernl.local/harness/backend/internal/app"
)

// registerConflictRoutes exposes the human-owned conflict workspace. These
// routes never accept arbitrary project paths: every path must already belong
// to the active conflict recorded by the backend.
func (a *API) registerConflictRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/sessions/{id}/conflict", a.conflictWorkbench)
	mux.HandleFunc("POST /api/sessions/{id}/conflict/manual", a.resolveConflictManually)
	mux.HandleFunc("POST /api/sessions/{id}/conflict/delegate", a.delegateConflictToGPT)
}

func (a *API) conflictWorkbench(w http.ResponseWriter, r *http.Request) {
	workbench, err := a.service.ConflictWorkbench(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusConflict, "conflict_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, workbench)
}

func (a *API) resolveConflictManually(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Resolutions []app.ConflictManualResolution `json:"resolutions"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, err := a.service.ResolveConflictManually(r.Context(), r.PathValue("id"), body.Resolutions)
	if err != nil {
		writeJSONError(w, http.StatusConflict, "conflict_manual_failed", err.Error(), result)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) delegateConflictToGPT(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Resolutions []app.ConflictManualResolution `json:"resolutions"`
		Guidance    string                         `json:"guidance"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	item, err := a.service.DelegateConflictToGPT(r.Context(), r.PathValue("id"), body.Resolutions, body.Guidance)
	if err != nil {
		writeError(w, http.StatusConflict, "conflict_delegate_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, item)
}
