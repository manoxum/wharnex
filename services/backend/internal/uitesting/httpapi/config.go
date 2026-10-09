package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/sessionvault"
)

type configInput struct {
	EnvironmentID string  `json:"environment_id"`
	ProfileID     string  `json:"profile_id"`
	URL           string  `json:"url"`
	Username      string  `json:"username"`
	Password      string  `json:"password"`
	Notes         *string `json:"notes"`
}

func (h *Routes) configure(w http.ResponseWriter, r *http.Request) {
	item, err := h.sessions.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, 404, err)
		return
	}
	var input configInput
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input) != nil {
		writeErr(w, 400, errors.New("invalid UI testing configuration"))
		return
	}
	if input.EnvironmentID == "" {
		writeErr(w, 400, errors.New("environment_id is required"))
		return
	}
	before, err := h.store.Load(item.ProjectPath)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	doc, err := h.store.Configure(item.ProjectPath, input.EnvironmentID, input.ProfileID, input.URL, input.Username, input.Password)
	if err == nil && input.Notes != nil {
		doc, err = h.store.SetNotes(item.ProjectPath, input.EnvironmentID, *input.Notes)
	}
	if err != nil {
		writeErr(w, 400, err)
		return
	}
	// A session captured against another URL, or under credentials that were
	// just replaced, no longer describes what a rerun would do.
	if environmentURL(before, input.EnvironmentID) != environmentURL(doc, input.EnvironmentID) {
		_, _ = h.vault.Delete(r.Context(), item.ProjectPath, sessionvault.Filter{EnvironmentID: input.EnvironmentID})
	} else if input.ProfileID != "" && input.Username != "" {
		_, _ = h.vault.Delete(r.Context(), item.ProjectPath, sessionvault.Filter{EnvironmentID: input.EnvironmentID, ProfileID: input.ProfileID})
	}
	writeJSON(w, 200, h.withSessions(r.Context(), doc))
}

func environmentURL(doc uitesting.Document, environmentID string) string {
	for _, env := range doc.Environments {
		if env.ID == environmentID {
			return strings.TrimSpace(env.URL)
		}
	}
	return ""
}
