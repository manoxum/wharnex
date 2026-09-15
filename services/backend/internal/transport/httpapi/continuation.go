package httpapi

import (
	"encoding/base64"
	"errors"
	"net/http"

	"kernl.local/harness/backend/internal/session"
)

// requestContinuation exposes one request's compact continuation state plus
// its cumulative execution and response history so the Desktop can expand
// them into the outer ChatGPT archive alongside the knowledge records.
//
// The payload is a fixed set of Wharnex-generated names with base64 content.
// The renderer never supplies a path and never learns a filesystem location:
// these are values Wharnex produced, not files it is asked to go and read.
func (a *API) requestContinuation(w http.ResponseWriter, r *http.Request) {
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
	artifacts := a.service.RequestContinuationArtifactsWithHistory(r.Context(), current.ID, requestID)
	files := make([]map[string]any, 0, len(artifacts))
	for _, artifact := range artifacts {
		files = append(files, map[string]any{
			"path":           artifact.Name,
			"content_base64": base64.StdEncoding.EncodeToString(artifact.Raw),
			"bytes":          len(artifact.Raw),
		})
	}
	if a.bus != nil && len(files) > 0 {
		a.bus.Publish(current.ID, "continuation.attached", map[string]any{
			"request_id": requestID, "transport": "desktop_archive", "files": len(files),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"request_id": requestID, "files": files})
}
