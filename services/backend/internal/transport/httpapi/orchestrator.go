package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"kernl.local/harness/backend/internal/app"
	"kernl.local/harness/backend/internal/domain"
	"kernl.local/harness/backend/internal/orchestrator"
)

// Transport-level bound for a planning response bundle, mirroring the decoder's
// own limit so an oversized upload is refused before it is buffered.
const orchestratorPlanBundleLimit = 2 << 20

func (a *API) orchestratorOverview(w http.ResponseWriter, r *http.Request) {
	overview, err := a.service.OrchestratorOverview(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "orchestrator_overview_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (a *API) orchestratorProposePlan(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Objective          string                               `json:"objective"`
		IncludeContext     bool                                 `json:"include_context,omitempty"`
		ProjectFiles       []string                             `json:"project_files,omitempty"`
		AttachmentCacheKey string                               `json:"attachment_cache_key,omitempty"`
		Attachments        []app.OrchestratorPlanningAttachment `json:"attachments,omitempty"`
		TodoIDs            []string                             `json:"todo_ids,omitempty"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, err := a.service.ProposeOrchestratorPlan(r.Context(), r.PathValue("id"), body.Objective, app.OrchestratorComposerContext{
		IncludeContext: body.IncludeContext, ProjectFiles: body.ProjectFiles,
		AttachmentCacheKey: body.AttachmentCacheKey, Attachments: body.Attachments, TodoIDs: body.TodoIDs,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, "orchestrator_plan_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (a *API) orchestratorImportPlan(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RequestID string                `json:"request_id"`
		Proposal  orchestrator.Proposal `json:"proposal"`
	}
	decoder := json.NewDecoder(io.LimitReader(r.Body, (2<<20)+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "orchestrator_import_invalid", err.Error())
		return
	}
	result, err := a.service.ImportOrchestratorProposal(r.Context(), r.PathValue("id"), body.RequestID, body.Proposal)
	if err != nil {
		writeError(w, http.StatusBadRequest, "orchestrator_import_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

// orchestratorImportPlanBundle ingests the planning result as the project's
// standard response bundle: the Desktop uploads the downloaded ZIP verbatim and
// never opens it, so the archive is validated in exactly one place.
func (a *API) orchestratorImportPlanBundle(w http.ResponseWriter, r *http.Request) {
	requestID := strings.TrimSpace(r.URL.Query().Get("request_id"))
	if requestID == "" {
		writeError(w, http.StatusBadRequest, "orchestrator_import_invalid", "request_id is required")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, orchestratorPlanBundleLimit+1)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "orchestrator_import_invalid", err.Error())
		return
	}
	if int64(len(raw)) > orchestratorPlanBundleLimit {
		writeError(w, http.StatusBadRequest, "orchestrator_import_invalid", "orchestrator plan bundle is too large")
		return
	}
	result, err := a.service.ImportOrchestratorProposalBundle(r.Context(), r.PathValue("id"), requestID, raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, "orchestrator_import_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (a *API) orchestratorRetryPlan(w http.ResponseWriter, r *http.Request) {
	result, err := a.service.RetryOrchestratorPlanning(r.PathValue("id"), r.PathValue("request_id"))
	if err != nil {
		writeError(w, http.StatusConflict, "orchestrator_retry_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (a *API) orchestratorApprovePlan(w http.ResponseWriter, r *http.Request) {
	overview, err := a.service.ApproveOrchestratorPlan(r.Context(), r.PathValue("id"), r.PathValue("plan_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "orchestrator_approve_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (a *API) orchestratorRejectPlan(w http.ResponseWriter, r *http.Request) {
	overview, err := a.service.RejectOrchestratorPlan(r.Context(), r.PathValue("id"), r.PathValue("plan_id"))
	if err != nil {
		writeError(w, http.StatusConflict, "orchestrator_reject_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (a *API) orchestratorRevisePlan(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Guidance string `json:"guidance"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	result, err := a.service.ReviseOrchestratorPlan(r.Context(), r.PathValue("id"), r.PathValue("plan_id"), body.Guidance)
	if err != nil {
		writeError(w, http.StatusConflict, "orchestrator_revise_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

func (a *API) orchestratorCreateTask(w http.ResponseWriter, r *http.Request) {
	var body app.OrchestratorTaskInput
	if !decodeJSON(w, r, &body) {
		return
	}
	task, err := a.service.CreateOrchestratorTask(r.Context(), r.PathValue("id"), body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "orchestrator_task_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, task)
}

func (a *API) orchestratorTransitionTask(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Status orchestrator.TaskStatus `json:"status"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if strings.TrimSpace(string(body.Status)) == "" {
		writeError(w, http.StatusBadRequest, "orchestrator_transition_invalid", "status is required")
		return
	}
	task, err := a.service.TransitionOrchestratorTask(r.Context(), r.PathValue("id"), r.PathValue("task_id"), body.Status)
	if err != nil {
		writeError(w, http.StatusConflict, "orchestrator_transition_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (a *API) orchestratorTaskEffort(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ReasoningEffort domain.ReasoningEffort `json:"reasoning_effort"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	task, err := a.service.SetOrchestratorTaskEffort(r.Context(), r.PathValue("id"), r.PathValue("task_id"), body.ReasoningEffort)
	if err != nil {
		writeError(w, http.StatusConflict, "orchestrator_effort_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, task)
}

func (a *API) orchestratorRetryTask(w http.ResponseWriter, r *http.Request) {
	var input orchestrator.TaskRetryContext
	if !decodeJSON(w, r, &input) {
		return
	}
	task, err := a.service.RetryOrchestratorTask(r.Context(), r.PathValue("id"), r.PathValue("task_id"), input)
	if err != nil {
		writeError(w, http.StatusConflict, "orchestrator_retry_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, task)
}

func (a *API) orchestratorStartTask(w http.ResponseWriter, r *http.Request) {
	result, err := a.service.StartOrchestratorTask(r.Context(), r.PathValue("id"), r.PathValue("task_id"))
	if err != nil {
		writeError(w, http.StatusConflict, "orchestrator_start_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, result)
}

func (a *API) orchestratorTaskRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := a.service.OrchestratorTaskRuns(r.Context(), r.PathValue("id"), r.PathValue("task_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "orchestrator_runs_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"runs": runs})
}
