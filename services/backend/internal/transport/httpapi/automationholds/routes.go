// Package automationholds owns the operator/Desktop transport for durable
// automation holds: one per browser task type, plus the ChatGPT upload limit.
package automationholds

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"kernl.local/harness/backend/internal/automationhold"
	"kernl.local/harness/backend/internal/session"
)

// defaultHeldTaskTypes are account-maintenance and title work, suspended
// until the operator explicitly decides otherwise (AGENTS.md §8).
var defaultHeldTaskTypes = []string{
	"ORGANIZE_CHAT", "RENAME_CHAT", "ARCHIVE_CHAT", "DELETE_CHAT", "DELETE_TEMP_CHAT", "DELETE_BUNDLE",
	"TITLE_DISCOVER", "TITLE_GENERATE_TEMP", "TITLE_AWAIT",
}

// Catalog is the closed set of holds, derived from the queue's own task types
// so a browser task type can never escape policy control.
func Catalog() automationhold.Catalog {
	kinds := session.ChatAgentTaskCatalog()
	types := make([]string, 0, len(kinds))
	for _, kind := range kinds {
		types = append(types, kind.Type)
	}
	return automationhold.Catalog{TaskTypes: types, DefaultHeld: defaultHeldTaskTypes}
}

// Provider reads the durable Worker rate-limit cooldown.
type Provider interface {
	ChatAgentProviderState() (session.ChatAgentProviderState, error)
}

type update struct {
	Active bool       `json:"active"`
	Until  *time.Time `json:"until"`
	Level  int        `json:"level"`
	Reason string     `json:"reason"`
	Source string     `json:"source"`
}

// Register mounts GET /api/automation-holds and PUT /api/automation-holds/{name}.
func Register(mux *http.ServeMux, holds automationhold.Store, catalog automationhold.Catalog, provider Provider) {
	mux.HandleFunc("GET /api/automation-holds", func(w http.ResponseWriter, r *http.Request) {
		upload, err := holds.Get(r.Context(), automationhold.ChatGPTUpload)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "automation_hold_failed", err.Error())
			return
		}
		taskHolds, err := automationhold.TaskHolds(r.Context(), holds, catalog)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "automation_hold_failed", err.Error())
			return
		}
		pause := automationhold.ProviderPause{}
		if state, err := provider.ChatAgentProviderState(); err == nil {
			pause = automationhold.ProviderPause{Paused: state.Paused, Until: state.PausedUntil, Reason: state.Reason}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"holds":         map[string]automationhold.Hold{automationhold.ChatGPTUpload: upload},
			"task_policies": automationhold.TaskPolicies(taskKinds(), taskHolds, pause, upload, time.Now().UTC()),
		})
	})
	mux.HandleFunc("PUT /api/automation-holds/{name}", func(w http.ResponseWriter, r *http.Request) {
		var body update
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_json", err.Error())
			return
		}
		hold, err := holds.Set(r.Context(), automationhold.Hold{
			Name: r.PathValue("name"), Active: body.Active, Until: body.Until, Level: body.Level, Reason: body.Reason, Source: body.Source,
		})
		switch {
		case errors.Is(err, automationhold.ErrUnknownHold):
			writeError(w, http.StatusNotFound, "automation_hold_not_found", err.Error())
		case errors.Is(err, automationhold.ErrInvalidHold):
			writeError(w, http.StatusBadRequest, "invalid_automation_hold", err.Error())
		case err != nil:
			writeError(w, http.StatusInternalServerError, "automation_hold_failed", err.Error())
		default:
			writeJSON(w, http.StatusOK, hold)
		}
	})
}

func taskKinds() []automationhold.TaskKind {
	catalog := session.ChatAgentTaskCatalog()
	kinds := make([]automationhold.TaskKind, 0, len(catalog))
	for _, kind := range catalog {
		kinds = append(kinds, automationhold.TaskKind{Type: kind.Type, Pool: kind.Pool, Uploads: kind.Uploads})
	}
	return kinds
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
