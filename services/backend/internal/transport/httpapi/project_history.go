package httpapi

import (
	"net/http"

	"kernl.local/harness/backend/internal/domain"
)

func (a *API) projectHistory(w http.ResponseWriter, _ *http.Request) {
	projects, err := a.service.ProjectHistory()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "project_history_failed", err.Error())
		return
	}
	if projects == nil {
		projects = []domain.KnownProjectRef{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": projects})
}

func (a *API) rememberProjectOpened(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProjectPath string `json:"project_path"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if err := a.service.RememberProjectOpened(body.ProjectPath); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_project_path", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
