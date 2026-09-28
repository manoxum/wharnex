package httpapi

import (
	"context"
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

func (a *API) orchestratorWorkerConversation(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WorkerTaskID    string `json:"worker_task_id"`
		Owner           string `json:"owner"`
		ConversationURL string `json:"conversation_url"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	url, err := a.service.RecordOrchestratorWorkerConversation(r.Context(), r.PathValue("id"), r.PathValue("task_id"), body.WorkerTaskID, body.Owner, body.ConversationURL)
	if err != nil {
		writeError(w, http.StatusConflict, "orchestrator_worker_conversation_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"conversation_url": url})
}

// orchestratorTaskBundle receives a task's response bundle from the agentic
// supervision that captured it; a task has no renderer to deliver it.
func (a *API) orchestratorTaskBundle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Filename string `json:"filename"`
		Base64   string `json:"content_base64"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 24<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "orchestrator_task_bundle_invalid", err.Error())
		return
	}
	if strings.TrimSpace(body.Filename) == "" || strings.TrimSpace(body.Base64) == "" {
		writeError(w, http.StatusBadRequest, "orchestrator_task_bundle_invalid", "filename and content_base64 are required")
		return
	}
	raw, err := base64.StdEncoding.DecodeString(body.Base64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "orchestrator_task_bundle_invalid", "content_base64 is invalid")
		return
	}
	// Ingestion runs the Protected sandbox, verification and Apply. It must
	// finish even if the Desktop connection drops: cancelling it mid-way left
	// the task's execution cancelled and its bundle already consumed.
	result, err := a.service.SubmitOrchestratorTaskBundle(context.WithoutCancel(r.Context()), r.PathValue("task_id"), body.Filename, raw)
	if err != nil {
		writeError(w, http.StatusConflict, "orchestrator_task_bundle_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *API) orchestratorTaskFailRun(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Error string `json:"error"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	task, err := a.service.FailOrchestratorTaskRun(r.Context(), r.PathValue("task_id"), body.Error)
	if err != nil {
		writeError(w, http.StatusConflict, "orchestrator_task_fail_run_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, task)
}
