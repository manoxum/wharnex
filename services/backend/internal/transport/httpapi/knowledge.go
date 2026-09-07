package httpapi

import (
	"errors"
	"net/http"

	"kernl.local/harness/backend/internal/session"
)

func (a *API) projectKnowledge(w http.ResponseWriter, r *http.Request) {
	current, err := a.store.Get(r.PathValue("id"))
	if err != nil {
		if errors.Is(err, session.ErrNotFound) {
			writeError(w, http.StatusNotFound, "session_not_found", "session not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "session_read_failed", err.Error())
		return
	}
	knowledge, ok, err := a.store.GetProjectKnowledge(current.ProjectPath)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "knowledge_read_failed", err.Error())
		return
	}
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"knowledge": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"knowledge": knowledge})
}

func (a *API) requestKnowledge(w http.ResponseWriter, r *http.Request) {
	current, err := a.store.Get(r.PathValue("id"))
	if err != nil {
		if errors.Is(err, session.ErrNotFound) {
			writeError(w, http.StatusNotFound, "session_not_found", "session not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "session_read_failed", err.Error())
		return
	}
	requestID := r.PathValue("request_id")
	snapshot, ok := current.RequestKnowledge[requestID]
	if !ok {
		writeError(w, http.StatusNotFound, "request_knowledge_not_found", "request knowledge snapshot not found")
		return
	}
	if a.bus != nil {
		a.bus.Publish(current.ID, "knowledge.attached", map[string]any{"request_id": requestID, "transport": "desktop_archive", "state": snapshot.State, "version": snapshot.Version, "sha256": snapshot.SHA256})
	}
	writeJSON(w, http.StatusOK, map[string]any{"knowledge": snapshot})
}
