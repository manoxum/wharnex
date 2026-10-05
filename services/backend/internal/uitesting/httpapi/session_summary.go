package httpapi

import (
	"context"
	"net/http"
	"time"

	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/sessionvault"
)

func (h *Routes) clearBrowserSessions(w http.ResponseWriter, r *http.Request) {
	item, err := h.sessions.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	filter := sessionvault.Filter{EnvironmentID: r.URL.Query().Get("environment_id"), TestID: r.URL.Query().Get("test_id")}
	if _, err := h.vault.Delete(r.Context(), item.ProjectPath, filter); err != nil {
		writeErr(w, 500, err)
		return
	}
	doc, err := h.store.Load(item.ProjectPath)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, h.withSessions(r.Context(), doc))
}

// withSessions adds the non-secret summary of persisted sessions.
func (h *Routes) withSessions(ctx context.Context, doc uitesting.Document) uitesting.Document {
	doc.Sessions = []uitesting.SessionSummary{}
	snapshots, err := h.vault.List(ctx, doc.ProjectID, time.Now().UTC())
	if err != nil {
		return doc
	}
	digests := currentDigests(doc)
	for _, snapshot := range snapshots {
		valid := environmentURL(doc, snapshot.EnvironmentID) != ""
		if origin, err := environmentOrigin(environmentURL(doc, snapshot.EnvironmentID)); err != nil || origin != snapshot.Origin {
			valid = false
		}
		for _, id := range snapshot.Covers {
			valid = valid && digests[id] != "" && digests[id] == snapshot.Digests[id]
		}
		doc.Sessions = append(doc.Sessions, uitesting.SessionSummary{ID: snapshot.SID, EnvironmentID: snapshot.EnvironmentID, TestID: snapshot.TestID,
			ProfileID: snapshot.ProfileID, Covers: snapshot.Covers, Valid: valid, CapturedAt: snapshot.CapturedAt, ExpiresAt: snapshot.ExpiresAt})
	}
	return doc
}
