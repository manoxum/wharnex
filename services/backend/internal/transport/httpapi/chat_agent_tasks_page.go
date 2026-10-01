package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"kernl.local/harness/backend/internal/session"
)

func (a *API) listUnifiedTasks(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	scope := strings.TrimSpace(query.Get("scope"))
	if scope == "" {
		a.listUnifiedTasksLegacy(w, r)
		return
	}
	limit := 0
	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			http.Error(w, "limit must be a positive integer", http.StatusBadRequest)
			return
		}
		limit = parsed
	}
	page, err := a.store.ListUnifiedTaskPage(session.UnifiedTaskPageFilter{
		ProjectID: query.Get("project_id"),
		Scope:     scope,
		Status:    query.Get("status"),
		Limit:     limit,
		Cursor:    query.Get("cursor"),
	})
	if err != nil {
		if errors.Is(err, session.ErrUnifiedTaskPageFilter) {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (a *API) listUnifiedTasksLegacy(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	active := strings.TrimSpace(r.URL.Query().Get("active"))
	items, err := a.store.ListUnifiedTasks(session.ChatAgentTaskFilter{
		ProjectID:  r.URL.Query().Get("project_id"),
		Status:     r.URL.Query().Get("status"),
		ActiveOnly: active == "1" || strings.EqualFold(active, "true"),
		Limit:      limit,
	})
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	if items == nil {
		items = []session.ChatAgentTask{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": items})
}
