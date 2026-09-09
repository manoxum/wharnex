package httpapi

import "net/http"

func (a *API) artifactPresentation(w http.ResponseWriter, r *http.Request) {
	presentation, err := a.service.ArtifactPresentation(r.Context(), r.PathValue("id"), r.PathValue("artifact_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "artifact_presentation_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, presentation)
}
