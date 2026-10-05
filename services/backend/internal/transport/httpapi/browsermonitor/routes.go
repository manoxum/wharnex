package browsermonitor

import (
	"context"
	"encoding/json"
	"net/http"

	"kernl.local/harness/backend/internal/app/browsermonitor"
)

// Register owns the read-only durable browser catalog transport.
func Register(mux *http.ServeMux, catalog func(context.Context) ([]browsermonitor.Chat, error)) {
	mux.HandleFunc("GET /api/browser-monitor/chats", func(w http.ResponseWriter, r *http.Request) {
		chats, err := catalog(r.Context())
		status := http.StatusOK
		var body any = map[string]any{"chats": chats}
		if err != nil {
			status = http.StatusInternalServerError
			body = map[string]any{"error": map[string]string{"code": "browser_monitor_catalog_failed", "message": err.Error()}}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	})
}
