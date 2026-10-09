package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/session"
	"kernl.local/harness/backend/internal/uitesting"
	"kernl.local/harness/backend/internal/uitesting/httpapi/synclifecycle"
	"kernl.local/harness/backend/internal/uitesting/sessionvault"
)

type Routes struct {
	sessions *session.Store
	store    *uitesting.Store
	vault    sessionvault.Vault
	pending  *pendingExchanges
	refresh  func(sessionID string) (domain.Session, error)
}

// SetContextRefresher lets discovery recapture a session's project context
// when its archive is not available (for example after a backend restart).
func (h *Routes) SetContextRefresher(refresh func(string) (domain.Session, error)) {
	h.refresh = refresh
}

// New wires the UI Lab routes. Browser sessions persist in PostgreSQL when a
// database URL is configured; without one (unit tests, bare development) they
// live in memory and end with the process.
func New(sessions *session.Store, stateDir, databaseURL string) (*Routes, error) {
	store, err := uitesting.NewStore(filepath.Join(stateDir, "ui-testing"))
	if err != nil {
		return nil, err
	}
	var vault sessionvault.Vault = sessionvault.NewMemory()
	if strings.TrimSpace(databaseURL) != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		postgres, err := sessionvault.OpenPostgres(ctx, databaseURL)
		if err != nil {
			return nil, err
		}
		vault = postgres
	}
	return &Routes{sessions: sessions, store: store, vault: vault, pending: newPendingExchanges(filepath.Join(stateDir, "ui-testing", "pending"))}, nil
}

// Mount creates the UI Lab routes and registers them. Discovery may recapture
// a session's project context itself through refresh: after a backend restart
// the session no longer knows where its archive is, and synchronizing must not
// depend on another surface having refreshed it first.
func Mount(mux *http.ServeMux, sessions *session.Store, stateDir, databaseURL string, refresh func(string) (domain.Session, error)) error {
	routes, err := New(sessions, stateDir, databaseURL)
	if err != nil {
		return err
	}
	if refresh != nil {
		routes.SetContextRefresher(refresh)
	}
	routes.Register(mux)
	return nil
}

func (h *Routes) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/sessions/{id}/ui-testing", h.get)
	mux.HandleFunc("POST /api/sessions/{id}/ui-testing/sync", h.sync)
	mux.HandleFunc("POST /api/sessions/{id}/ui-testing/design", h.design)
	mux.HandleFunc("DELETE /api/sessions/{id}/ui-testing/design/{task}", h.dismissDesign)
	mux.HandleFunc("PUT /api/sessions/{id}/ui-testing/config", h.configure)
	mux.HandleFunc("POST /api/sessions/{id}/ui-testing/run", h.run)
	mux.HandleFunc("DELETE /api/sessions/{id}/ui-testing/browser-sessions", h.clearBrowserSessions)
	mux.HandleFunc("POST /api/ui-testing/tasks/{id}/discovery", h.discovery)
	mux.HandleFunc("POST /api/ui-testing/tasks/{id}/credential", h.credential)
	mux.HandleFunc("POST /api/ui-testing/tasks/{id}/result", h.result)
	mux.HandleFunc("POST /api/ui-testing/tasks/{id}/step", h.stepRequest)
	mux.HandleFunc("POST /api/ui-testing/tasks/{id}/step/result", h.stepAnswer)
	mux.HandleFunc("POST /api/ui-testing/tasks/{id}/guide", h.guideRequest)
	mux.HandleFunc("POST /api/ui-testing/tasks/{id}/guide/result", h.guideAnswer)
	mux.HandleFunc("POST /api/ui-testing/tasks/{id}/session", h.saveBrowserSession)
	mux.HandleFunc("POST /api/ui-testing/tasks/{id}/session/restore", h.restoreBrowserSession)
	mux.HandleFunc("POST /api/ui-testing/tasks/{id}/session/invalidate", h.invalidateBrowserSession)
	mux.HandleFunc("GET /api/sessions/{id}/ui-testing/assets/{run}/{name}", h.asset)
}

func (h *Routes) get(w http.ResponseWriter, r *http.Request) {
	item, err := h.sessions.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	doc, err := h.store.Load(item.ProjectPath)
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	if doc, err = h.reconcileSyncTask(item.ProjectPath, doc); err != nil {
		writeErr(w, 500, err)
		return
	}
	if doc, err = h.reconcileRunTasks(item.ProjectPath, doc); err != nil {
		writeErr(w, 500, err)
		return
	}
	if doc, err = h.reconcileDesignTasks(item.ProjectPath, doc); err != nil {
		writeErr(w, 500, err)
		return
	}
	view, err := synclifecycle.Project(h.withSessions(r.Context(), doc), h.sessions, time.Now().UTC())
	if err != nil {
		writeErr(w, 500, err)
		return
	}
	writeJSON(w, 200, view)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
