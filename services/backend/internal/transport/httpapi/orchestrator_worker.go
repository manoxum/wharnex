package httpapi

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

func (a *API) orchestratorWorkerStart(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WorkerTaskID string `json:"worker_task_id"`
		Owner        string `json:"owner"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, err := a.service.StartOrchestratorWorkerTask(r.Context(), r.PathValue("id"), r.PathValue("task_id"), body.WorkerTaskID, body.Owner)
	if err != nil {
		writeError(w, http.StatusConflict, "orchestrator_worker_start_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, result)
}

func (a *API) orchestratorWorkerBundle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WorkerTaskID string `json:"worker_task_id"`
		Owner        string `json:"owner"`
		Filename     string `json:"filename"`
		Base64       string `json:"content_base64"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 24<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "orchestrator_worker_bundle_invalid", err.Error())
		return
	}
	if strings.TrimSpace(body.Filename) == "" || strings.TrimSpace(body.Base64) == "" {
		writeError(w, http.StatusBadRequest, "orchestrator_worker_bundle_invalid", "filename and content_base64 are required")
		return
	}
	raw, err := base64.StdEncoding.DecodeString(body.Base64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "orchestrator_worker_bundle_invalid", "content_base64 is invalid")
		return
	}
	result, err := a.service.SubmitOrchestratorWorkerBundle(r.Context(), r.PathValue("id"), r.PathValue("task_id"), body.WorkerTaskID, body.Owner, body.Filename, raw)
	if err != nil {
		writeError(w, http.StatusConflict, "orchestrator_worker_bundle_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}
