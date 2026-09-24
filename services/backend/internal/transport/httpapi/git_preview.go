package httpapi

import (
	"net/http"

	"kernl.local/harness/backend/internal/app"
)

func (a *API) gitPreview(w http.ResponseWriter, r *http.Request) {
	var body app.GitPreviewRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	preview, err := a.service.PreviewGitOperation(r.Context(), r.PathValue("id"), body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "git_preview_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, preview)
}
