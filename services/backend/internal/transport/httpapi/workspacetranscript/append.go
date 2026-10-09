package workspacetranscript

import (
	"encoding/json"
	"net/http"

	"kernl.local/harness/backend/internal/domain"
)

type Service interface {
	AppendWorkspaceChatItems(string, []domain.WorkspaceChatItem) error
}

// Append uses the existing transcript payload and body bound. The API's
// common middleware applies the same local/scoped authorization as PUT.
func Append(service Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Items []domain.WorkspaceChatItem `json:"items"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20))
		if err := decoder.Decode(&body); err != nil {
			http.Error(w, "invalid transcript body", http.StatusBadRequest)
			return
		}
		if err := service.AppendWorkspaceChatItems(r.PathValue("id"), body.Items); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "count": len(body.Items)})
	}
}
