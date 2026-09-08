package httpapi

import (
	"errors"
	"net/http"

	"kernl.local/harness/backend/internal/session"
)

// archiveChat is an instant, idempotent state flip (see ADR-0031) — it never
// blocks on the throttled compaction sweep, which runs later on its own.
func (a *API) archiveChat(w http.ResponseWriter, r *http.Request) {
	updated, err := a.service.ArchiveChat(r.PathValue("id"))
	if err != nil {
		if errors.Is(err, session.ErrNotFound) {
			writeError(w, http.StatusNotFound, "session_not_found", "session not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "chat_archive_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// restoreChat is a fast state flip before compaction, or a synchronous
// extract-and-restore once the chat has been compacted — see
// Service.RestoreChat. The slow path can take a few seconds; the response
// itself is the completion signal, and mid-flight progress is published on
// the session's existing event stream (session.restore_extracting).
func (a *API) restoreChat(w http.ResponseWriter, r *http.Request) {
	updated, err := a.service.RestoreChat(r.Context(), r.PathValue("id"))
	if err != nil {
		if errors.Is(err, session.ErrNotFound) {
			writeError(w, http.StatusNotFound, "session_not_found", "session not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "chat_restore_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, updated)
}
