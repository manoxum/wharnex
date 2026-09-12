package httpapi

import (
	"encoding/json"
	"net/http"
)

func (a *API) checkpointChatAgentTask(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Owner   string          `json:"owner"`
		Payload json.RawMessage `json:"payload"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	task, err := a.store.CheckpointChatAgentTask(r.PathValue("id"), body.Owner, body.Payload)
	if err != nil {
		writeChatAgentTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, task)
}
