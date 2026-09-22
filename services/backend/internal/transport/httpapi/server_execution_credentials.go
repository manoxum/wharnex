package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"kernl.local/harness/backend/internal/app"
)

func (a *API) execute(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Approved     bool   `json:"approved"`
		SudoPassword string `json:"sudo_password"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	result, item, err := a.service.ExecuteAuthorized(r.Context(), r.PathValue("id"), body.Approved, body.SudoPassword)
	if err != nil {
		status := 400
		if errors.Is(err, app.ErrApprovalRequired) || errors.Is(err, app.ErrSudoCredentialRequired) {
			status = 409
		}
		writeJSON(w, status, map[string]any{"error": map[string]any{"code": "execution_failed", "message": err.Error()}, "result": result, "session": item})
		return
	}
	writeJSON(w, 200, map[string]any{"result": result, "session": item})
}

func (a *API) resumeInterruptedExecution(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SudoPassword string `json:"sudo_password"`
	}
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "invalid_body", err.Error())
			return
		}
	}
	result, err := a.service.ResumeInterruptedExecutionAuthorized(r.PathValue("id"), body.SudoPassword)
	if err != nil {
		writeError(w, http.StatusConflict, "execution_recovery_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, result)
}
