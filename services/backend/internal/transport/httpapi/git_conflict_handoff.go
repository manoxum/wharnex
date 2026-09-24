package httpapi

import (
	"net/http"
	"strings"
)

// gitConflictHandoff moves the session's Git-origin conflict into the
// dedicated session named in the body and returns that session.
func (a *API) gitConflictHandoff(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TargetSessionID string `json:"target_session_id"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	updated, err := a.service.HandOffGitConflict(r.Context(), r.PathValue("id"), strings.TrimSpace(body.TargetSessionID))
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_conflict_handoff_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}
