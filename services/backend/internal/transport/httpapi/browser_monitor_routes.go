package httpapi

import "net/http"

func (a *API) registerBrowserMonitorRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/browser-monitor/chats", a.browserMonitorChats)
}

func (a *API) browserMonitorChats(w http.ResponseWriter, r *http.Request) {
	chats, err := a.service.BrowserMonitorChats(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "browser_monitor_catalog_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chats": chats})
}
