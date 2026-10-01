package httpapi

import "net/http"

func (a *API) orchestratorTaskDetail(w http.ResponseWriter, r *http.Request) {
	detail, err := a.service.OrchestratorTaskDetail(r.Context(), r.PathValue("id"), r.PathValue("task_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "orchestrator_task_detail_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, detail)
}
